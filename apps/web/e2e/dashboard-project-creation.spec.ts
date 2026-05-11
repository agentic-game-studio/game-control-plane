import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * E2E tests for dashboard project creation with workspace path support.
 * Tests absolute path input, relative path input, path validation, and error cases.
 * Requires backend (port 3001) and frontend (port 3000) running.
 */

const API_KEY = "change_this_to_a_random_secret";
const BASE_URL = "http://localhost:3001";

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

interface Project {
  id: string;
  name: string;
  workspacePath: string | null;
  engine: string | null;
}

const createdProjectIds: string[] = [];

async function cleanupProjects(request: import("@playwright/test").APIRequestContext) {
  try {
    for (const id of createdProjectIds) {
      await request.delete(`${BASE_URL}/api/dashboard/projects/${id}`, {
        headers: { "x-api-key": API_KEY },
      });
    }
  } catch {
    // Ignore cleanup errors
  }
  createdProjectIds.length = 0;
}

// ─── API-level tests (no browser needed) ───

test.describe("API: Path Validation", () => {
  test("returns valid for existing directory", async ({ request }) => {
    const resp = await request.post(`${BASE_URL}/api/dashboard/validate-path`, {
      headers: { "x-api-key": API_KEY },
      data: { path: "/tmp" },
    });
    expect(resp.ok()).toBe(true);
    const result = await resp.json();
    expect(result.success).toBe(true);
    expect(result.data.valid).toBe(true);
    expect(result.data.exists).toBe(true);
    expect(result.data.isDirectory).toBe(true);
    expect(result.data.resolved).toBe("/tmp");
  });

  test("returns invalid for non-existent directory", async ({ request }) => {
    const resp = await request.post(`${BASE_URL}/api/dashboard/validate-path`, {
      headers: { "x-api-key": API_KEY },
      data: { path: "/absolutely/does/not/exist" },
    });
    expect(resp.ok()).toBe(true);
    const result = await resp.json();
    expect(result.success).toBe(true);
    expect(result.data.valid).toBe(false);
    expect(result.data.exists).toBe(false);
  });

  test("returns invalid for path traversal", async ({ request }) => {
    const resp = await request.post(`${BASE_URL}/api/dashboard/validate-path`, {
      headers: { "x-api-key": API_KEY },
      data: { path: "../../etc/passwd" },
    });
    expect(resp.ok()).toBe(true);
    const result = await resp.json();
    expect(result.success).toBe(true);
    expect(result.data.valid).toBe(false);
  });

  test("returns error for missing path", async ({ request }) => {
    const resp = await request.post(`${BASE_URL}/api/dashboard/validate-path`, {
      headers: { "x-api-key": API_KEY },
      data: {},
    });
    expect(resp.status()).toBe(400);
  });
});

test.describe("API: Project Creation Validation", () => {
  test.afterEach(async ({ request }) => {
    await cleanupProjects(request);
  });

  test("blocks path traversal in workspacePath", async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/dashboard/projects`, {
      headers: { "x-api-key": API_KEY },
      data: { name: "Traversal Project", workspacePath: "../../etc" },
    });
    expect(response.ok()).toBe(false);
    expect(response.status()).toBe(400);
    const result = await response.json();
    expect(result.error).toContain("traversal");
  });

  test("blocks non-existent absolute path", async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/dashboard/projects`, {
      headers: { "x-api-key": API_KEY },
      data: { name: "Bad Path", workspacePath: "/this/directory/does/not/exist" },
    });
    expect(response.ok()).toBe(false);
    expect(response.status()).toBe(400);
    const result = await response.json();
    expect(result.error).toContain("does not exist");
  });

  test("allows relative path without existence check", async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/dashboard/projects`, {
      headers: { "x-api-key": API_KEY },
      data: { name: "Future Project", workspacePath: "future-game-dir" },
    });
    expect(response.ok()).toBe(true);
    const result: ApiResponse<Project> = await response.json();
    expect(result.success).toBe(true);
    expect(result.data.workspacePath).toBe("future-game-dir");
    createdProjectIds.push(result.data.id);
  });

  test("allows project without workspace path", async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/dashboard/projects`, {
      headers: { "x-api-key": API_KEY },
      data: { name: "No Workspace Project" },
    });
    expect(response.ok()).toBe(true);
    const result: ApiResponse<Project> = await response.json();
    expect(result.success).toBe(true);
    expect(result.data.workspacePath).toBeNull();
    createdProjectIds.push(result.data.id);
  });

  test("creates project with valid absolute workspace path", async ({ request }) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-abs-"));
    try {
      const response = await request.post(`${BASE_URL}/api/dashboard/projects`, {
        headers: { "x-api-key": API_KEY },
        data: { name: "Abs Path Project", workspacePath: tmpDir },
      });
      expect(response.ok()).toBe(true);
      const result: ApiResponse<Project> = await response.json();
      expect(result.success).toBe(true);
      expect(result.data.workspacePath).toBe(tmpDir);
      createdProjectIds.push(result.data.id);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─── UI tests ───

test.describe("UI: Dashboard Project Creation", () => {
  test.afterEach(async ({ request }) => {
    await cleanupProjects(request);
  });

  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard");
    // Wait for dashboard to fully load
    await page.waitForSelector("text=ACTIVE_DIRECTORIES", { timeout: 15_000 });
  });

  test("can create a project with relative workspace path via UI", async ({ page, request }) => {
    // Click + NEW_PROJ button to open modal
    await page.click('button:has-text("NEW_PROJ")');
    await expect(page.getByText("NEW PROJECT")).toBeVisible();

    // Fill in project details
    const projectName = `E2E Relative ${Date.now()}`;
    await page.fill('input[placeholder="Enter project name..."]', projectName);
    await page.fill('input[placeholder*="my-game"]', "e2e-test-project");

    // Submit the modal form (CREATE button is inside the modal overlay)
    await page.locator('.fixed.z-50 button:has-text("CREATE")').click();

    // Modal should close and project should appear
    await expect(page.getByText(projectName).first()).toBeVisible({ timeout: 10_000 });

    // Verify via API
    const listResp = await request.get(`${BASE_URL}/api/dashboard/projects`, {
      headers: { "x-api-key": API_KEY },
    });
    const result: ApiResponse<Project[]> = await listResp.json();
    const created = result.data.find((p) => p.name === projectName);
    expect(created).toBeDefined();
    if (created) {
      expect(created.workspacePath).toBe("e2e-test-project");
      createdProjectIds.push(created.id);
    }
  });

  test("can create a project with absolute workspace path via UI", async ({ page, request }) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-ui-abs-"));

    try {
      // Click + NEW_PROJ button
      await page.click('button:has-text("NEW_PROJ")');
      await expect(page.getByText("NEW PROJECT")).toBeVisible();

      const projectName = `E2E Absolute ${Date.now()}`;
      await page.fill('input[placeholder="Enter project name..."]', projectName);
      await page.fill('input[placeholder*="my-game"]', tmpDir);

      // Click CHECK to validate the path
      await page.click('button:has-text("CHECK")');

      // Wait for validation to complete (green border or just wait)
      await page.waitForTimeout(2000);

      // Submit
      await page.locator('.fixed.z-50 button:has-text("CREATE")').click();

      // Project should appear in grid
      await expect(page.getByText(projectName).first()).toBeVisible({ timeout: 10_000 });

      // Verify via API
      const listResp = await request.get(`${BASE_URL}/api/dashboard/projects`, {
        headers: { "x-api-key": API_KEY },
      });
      const result: ApiResponse<Project[]> = await listResp.json();
      const created = result.data.find((p) => p.name === projectName);
      expect(created).toBeDefined();
      if (created) {
        expect(created.workspacePath).toBe(tmpDir);
        createdProjectIds.push(created.id);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("shows red validation for non-existent absolute path", async ({ page }) => {
    // Click + NEW_PROJ button
    await page.click('button:has-text("NEW_PROJ")');
    await expect(page.getByText("NEW PROJECT")).toBeVisible();

    // Fill in a non-existent absolute path
    await page.fill('input[placeholder="Enter project name..."]', "Bad Path");
    await page.fill('input[placeholder*="my-game"]', "/nonexistent/path/that/does/not/exist");

    // Click CHECK to validate
    await page.click('button:has-text("CHECK")');

    // Should show red cancel icon
    await expect(page.locator(".fixed.z-50").getByText("cancel")).toBeVisible({ timeout: 5_000 });
  });
});

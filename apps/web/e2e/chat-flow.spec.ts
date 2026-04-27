import { test, expect } from "@playwright/test";

/**
 * E2E test for the chat flow.
 * These tests require the backend (port 3001) and frontend (port 3000) to be running.
 */

test.describe("Chat Flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/chat");
    // Wait for command input to be ready
    await page.waitForSelector("textarea", { timeout: 15_000 });
  });

  test("chat page loads with Producer session", async ({ page }) => {
    // Should show BOARD_ROOM heading (use role to avoid strict mode violation with tab + header)
    await expect(page.getByRole("heading", { name: "BOARD_ROOM" })).toBeVisible({ timeout: 10_000 });
    // Should show welcome message
    await expect(page.getByText(/Producer/i).first()).toBeVisible();
  });

  test("can type and send a message to Producer", async ({ page }) => {
    const input = page.locator("textarea").first();
    await input.fill("Hello Producer");
    await input.press("Enter");

    // Message should appear in the thread as user message
    await expect(page.getByText("Hello Producer").first()).toBeVisible({ timeout: 10_000 });
  });

  test("spawn command creates agent session", async ({ page }) => {
    const input = page.locator("textarea").first();
    await input.fill("spawn creative-director");
    await input.press("Enter");

    // Wait a moment for UI to update
    await page.waitForTimeout(5000);

    // Take screenshot to see what's rendered
    await page.screenshot({ path: "test-results/spawn-debug.png", fullPage: true });

    // Should show spawn confirmation — uses underscores in UI: CREATIVE_DIRECTOR
    await expect(page.getByText(/CREATIVE_DIRECTOR/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test("slash command /help shows available commands", async ({ page }) => {
    const input = page.locator("textarea").first();
    // Trailing space avoids autocomplete intercepting Enter
    await input.fill("/help ");
    await input.press("Enter");

    // Should show help text — handled client-side
    await expect(page.getByText(/Available commands/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test("can switch between agent tabs", async ({ page }) => {
    const input = page.locator("textarea").first();
    await input.fill("spawn lead-programmer");
    await input.press("Enter");

    // Wait for agent tab to appear
    await expect(page.getByText(/LEAD_PROGRAMMER/i).first()).toBeVisible({ timeout: 15_000 });

    // Click on the agent tab
    const agentTab = page.getByRole("button", { name: /LEAD_PROGRAMMER/i }).first();
    if (await agentTab.isVisible()) {
      await agentTab.click();
      // Should show Agent Session label
      await expect(page.getByText("Agent Session")).toBeVisible({ timeout: 5_000 });
    }
  });
});

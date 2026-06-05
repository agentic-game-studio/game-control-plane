import { defineConfig } from "@playwright/test";
import path from "path";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    viewport: { width: 1280, height: 720 },
    actionTimeout: 10_000,
  },
  // 16-C-ci-e2e-missing-api: e2e tests call http://localhost:3001/api/*
  // for setup/teardown (create projects, delete chat sessions, etc.).
  // The previous config only started the Next.js dev server — every
  // spec that hit the API silently got ECONNREFUSED and the suite
  // would fail at the first request. Two webServer entries start
  // both processes in parallel before tests run; Playwright waits
  // for both ports to be reachable.
  //
  // The API env vars match what the e2e CI step sets on the runner
  // (see .github/workflows/ci.yml). Locally, developers can set
  // these in their shell or .env. The auth secret defaults to the
  // dev value baked into the API config when E2E_API_KEY is unset.
  webServer: [
    {
      command: "npx next dev --turbopack",
      port: 3000,
      reuseExistingServer: true,
      timeout: 30_000,
      cwd: path.resolve(__dirname),
    },
    {
      command: "pnpm --filter @game-studio/api dev",
      port: 3001,
      reuseExistingServer: true,
      timeout: 30_000,
      cwd: path.resolve(__dirname, "../.."),
      env: {
        ENABLE_TEST_ENDPOINTS: "true",
        E2E_API_KEY: process.env.E2E_API_KEY || "e2e-test-only-not-a-secret",
        API_PORT: "3001",
      },
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});

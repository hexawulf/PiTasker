import { defineConfig, devices } from "@playwright/test";

// README screenshots (npm run screenshots): tests/screenshots against the E2E
// harness, as in playwright.config.ts. SCREENSHOT_URL points at a harness
// that is already running (then no server is started here).
const PORT = Number(process.env.E2E_PORT || 5027);
const baseURL = process.env.SCREENSHOT_URL || `http://localhost:${PORT}`;
const executablePath = process.env.PW_CHROMIUM || undefined;

export default defineConfig({
  testDir: "tests/screenshots",
  outputDir: "test-results/screenshots",
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    extraHTTPHeaders: { "X-Forwarded-Proto": "https" },
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  webServer: process.env.SCREENSHOT_URL
    ? undefined
    : { command: "bash scripts/e2e-server.sh", url: `${baseURL}/healthz`, reuseExistingServer: false, timeout: 240_000, stdout: "pipe" },
});

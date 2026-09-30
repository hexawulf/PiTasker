import { defineConfig, devices } from "@playwright/test";

// E2E runs against a separate build on :5027 (scripts/e2e-server.sh): its own
// scratch database and a fake crontab — never prod (:5007), never the real
// crontab. X-Forwarded-Proto mimics nginx so the Secure session cookie is set.
// PW_CHROMIUM: a browser binary to use instead of Playwright's download.
const PORT = Number(process.env.E2E_PORT || 5027);
const baseURL = `http://localhost:${PORT}`; // Chrome keeps Secure cookies on http://localhost
const executablePath = process.env.PW_CHROMIUM || undefined;

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL,
    extraHTTPHeaders: { "X-Forwarded-Proto": "https" },
    screenshot: "only-on-failure",
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "chromium", use: { ...devices["Desktop Chrome"], storageState: ".e2e/state.json" }, dependencies: ["setup"], testIgnore: /auth\.setup\.ts/ },
  ],
  webServer: {
    command: "bash scripts/e2e-server.sh",
    url: `${baseURL}/healthz`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: "pipe",
  },
});

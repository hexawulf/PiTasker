// README screenshots from the E2E harness (scripts/e2e-server.sh): the demo
// crontab, the fixture fleet and the scratch database, never a real host.
//   npm run screenshots        (PITASKER_TEST_PG_URL set, as for test:e2e)
// Every page is checked for real-looking identifiers before it is captured;
// run the harness on a host with a neutral name (the header and the hub's
// Fleet chip show the server's host name).
import fs from "fs";
import path from "path";
import { expect, test, type Page } from "@playwright/test";
import { resetState } from "../e2e/helpers";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const OUT = path.join(ROOT, "docs", "screenshots");
const DEMO = fs.readFileSync(path.join(ROOT, "tests", "fixtures", "crontab.demo"), "utf8");
// Anything that looks like a private address, an email or a non-demo host name.
const FORBIDDEN = /\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d+\.\d+|@[a-z0-9-]+\.[a-z]{2,}|\bpi?apps\d*\b|\blinux(?:svr|ws)\d*\b/i;

async function login(page: Page) {
  const password = fs.readFileSync(path.join(ROOT, ".e2e", "password"), "utf8").trim();
  await page.goto("/login");
  await page.getByTestId("login-username").fill("admin");
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/tasks$/);
}

async function capture(page: Page, file: string) {
  await page.waitForLoadState("networkidle");
  const text = await page.locator("body").innerText();
  expect(text.match(FORBIDDEN)?.[0] ?? null, `${file}: real-looking identifier on the page`).toBeNull();
  await page.screenshot({ path: path.join(OUT, file) });
}

test.use({ viewport: { width: 1280, height: 800 }, colorScheme: "light" });

test.beforeAll(async () => {
  await resetState(DEMO);
});

test("tasks, fleet (light) and tasks (dark)", async ({ page }) => {
  await login(page);
  const json = { "Content-Type": "application/json" };
  expect((await page.request.post("/api/crontab/import", { data: {}, headers: json })).ok()).toBe(true);
  const own = await page.request.post("/api/tasks", {
    data: { name: "Queue health ping", cronSchedule: "*/10 * * * *", command: "echo queue ok", isSystemManaged: false },
    headers: json,
  });
  expect(own.status()).toBe(201);
  const { id } = (await own.json()) as { id: number };
  expect((await page.request.post(`/api/tasks/${id}/run`, { data: {}, headers: json })).status()).toBe(202);

  await page.goto("/tasks");
  await expect(page.getByText("Queue health ping")).toBeVisible();
  await expect(page.getByText("Nightly database backup")).toBeVisible();
  await capture(page, "tasks.png");

  await page.goto("/fleet");
  await expect(page.getByTestId("host-chip").first()).toBeVisible();
  await capture(page, "fleet.png");

  await page.evaluate(() => localStorage.setItem("pitasker-ui-theme", "dark"));
  await page.goto("/tasks");
  await expect(page.getByText("Queue health ping")).toBeVisible();
  await capture(page, "tasks-dark.png");
});

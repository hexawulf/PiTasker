import AxeBuilder from "@axe-core/playwright";
import { expect, expectNoHorizontalScroll, test } from "./helpers";

test("logs widget lists PiTasker's log files and shows the tail", async ({ page }) => {
  await page.goto("/logs");
  await expect(page.getByTestId("log-select")).toHaveValue(/pitasker-\d{4}-\d{2}-\d{2}\.log/);
  await expect(page.getByTestId("log-content")).toContainText("PiTasker started");
});

test("theme toggle switches and persists", async ({ page }) => {
  await page.goto("/tasks");
  const html = page.locator("html");
  const before = (await html.getAttribute("class"))?.includes("dark") ? "dark" : "light";
  await page.getByTestId("theme-toggle").click();
  await expect(html).toHaveClass(before === "dark" ? /light/ : /dark/);
  await page.reload();
  await expect(html).toHaveClass(before === "dark" ? /light/ : /dark/);
});

test("keyboard shortcuts: ? help, g c / g t, n new task", async ({ page }) => {
  await page.goto("/tasks");
  await expect(page.getByTestId("new-task")).toBeVisible();
  await page.keyboard.press("?");
  await expect(page.getByTestId("shortcuts-help")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("shortcuts-help")).toHaveCount(0);
  await page.keyboard.press("g");
  await page.keyboard.press("c");
  await expect(page).toHaveURL(/\/crontab$/);
  await page.keyboard.press("g");
  await page.keyboard.press("t");
  await expect(page).toHaveURL(/\/tasks$/);
  await page.keyboard.press("n");
  await expect(page.getByTestId("task-editor")).toBeVisible();
});

test("the CSP is enforced and nothing violates it", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  const res = await page.goto("/tasks");
  expect(res?.headers()["content-security-policy"]).toContain("script-src 'self' 'sha256-");
  await expect(page.getByTestId("new-task")).toBeVisible();
  expect(violations).toEqual([]);
});

for (const theme of ["light", "dark"] as const) {
  for (const path of ["/tasks", "/crontab", "/logs", "/settings"]) {
    test(`axe: ${path} (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("pitasker-ui-theme", t), theme);
      await page.request.post("/api/crontab/import", { data: {}, headers: { "Content-Type": "application/json" } });
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
    });
  }
}

test.describe("mobile (390 px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  for (const path of ["/tasks", "/crontab", "/logs", "/settings"]) {
    test(`no horizontal scroll: ${path}`, async ({ page }) => {
      await page.request.post("/api/crontab/import", { data: {}, headers: { "Content-Type": "application/json" } });
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expectNoHorizontalScroll(page);
    });
  }
  test("task editor fits", async ({ page }) => {
    await page.goto("/tasks");
    await page.getByTestId("new-task").click();
    await expect(page.getByTestId("task-editor")).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});

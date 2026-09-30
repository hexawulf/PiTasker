// Fleet page (P3, read-only) against real agents from dist-e2e/agent.mjs on
// fixture hosts (scripts/e2e-server.sh): beta :5028 (Europe/Berlin), gamma
// :5029 (Asia/Singapore, production, bin ahead), delta (closed port, saved
// snapshot), badtoken (wrong token). Nothing here writes anything.
import AxeBuilder from "@axe-core/playwright";
import { expect, expectNoHorizontalScroll, test } from "./helpers";

const chip = (page: import("@playwright/test").Page, id: string) => page.locator(`[data-testid="host-chip"][data-host="${id}"]`);

test.beforeEach(async ({ page }) => {
  await page.goto("/fleet");
  await expect(page.getByTestId("fleet-summary")).toContainText("hosts");
});

test("host chips: status, zone, production, offline 'as of', wrong token", async ({ page }) => {
  await expect(chip(page, "local")).toHaveAttribute("data-status", "online");
  await expect(chip(page, "local")).toContainText("Asia/Taipei");
  await expect(chip(page, "beta")).toHaveAttribute("data-status", "online");
  await expect(chip(page, "beta")).toContainText("Europe/Berlin");
  await expect(chip(page, "gamma")).toContainText("Asia/Singapore");
  await expect(chip(page, "gamma")).toContainText("production");
  await expect(chip(page, "gamma")).toContainText("(differs)");
  await expect(chip(page, "delta")).toHaveAttribute("data-status", "offline");
  await expect(chip(page, "delta")).toContainText("as of");
  await expect(chip(page, "badtoken")).toHaveAttribute("data-status", "auth-error");
  await expect(chip(page, "badtoken")).toContainText("token rejected");
});

test("by host: sections per host, the offline one from its saved snapshot, per-source errors inline", async ({ page }) => {
  const beta = page.locator('[data-testid="host-section"][data-host="beta"]');
  await expect(beta).toContainText("zk crontab");
  await expect(beta).toContainText("cron.d/certbot");
  await expect(beta).toContainText("timer logrotate.timer");
  await expect(beta.getByTestId("host-errors")).toContainText("root crontab");
  const delta = page.locator('[data-testid="host-section"][data-host="delta"]');
  await expect(delta).toContainText("offline");
  await expect(delta).toContainText("as of");
  await expect(delta.getByTestId("host-errors")).toContainText("user timers");
  // Collapsible
  await beta.getByRole("button", { expanded: true }).click();
  await expect(beta.getByTestId("fleet-row")).toHaveCount(0);
});

test("all jobs: one table, schedules in the host's zone, filters and search kept in the URL", async ({ page }) => {
  await page.getByTestId("view-jobs").click();
  await expect(page).toHaveURL(/view=jobs/);
  const table = page.getByTestId("fleet-table");
  await expect(table).toBeVisible();
  const total = await table.getByTestId("fleet-table-row").count();
  expect(total).toBeGreaterThan(20);

  await page.getByTestId("filter-host").selectOption("beta");
  await expect(page).toHaveURL(/host=beta/);
  const rows = table.getByTestId("fleet-table-row");
  await expect(rows.first()).toContainText("beta (Berlin)");
  expect(await rows.count()).toBeLessThan(total);
  await expect(table).toContainText("Europe/Berlin");

  await page.getByTestId("filter-source").selectOption("timer");
  await expect(rows).toHaveCount(2); // logrotate, certbot
  await page.getByTestId("filter-source").selectOption("");
  await page.getByTestId("fleet-search").fill("certbot");
  await expect(rows).toHaveCount(2); // cron.d line + the timer
  await page.reload();
  await expect(page.getByTestId("fleet-search")).toHaveValue("certbot");
  await expect(page.getByTestId("filter-host")).toHaveValue("beta");
  await expect(page.getByTestId("fleet-table").getByTestId("fleet-table-row")).toHaveCount(2);
});

test("hints: same job on two hosts, script not in bin.git, disabled", async ({ page }) => {
  await page.getByTestId("view-jobs").click();
  await page.getByTestId("filter-hint").selectOption("same-job");
  const rows = page.getByTestId("fleet-table").getByTestId("fleet-table-row");
  await expect(rows.filter({ hasText: "status-poll" }).first()).toBeVisible();
  const hosts = new Set(await rows.locator("td:first-child").allInnerTexts());
  expect(hosts.size).toBeGreaterThanOrEqual(2);

  await page.getByTestId("filter-hint").selectOption("not-in-bin");
  await expect(rows.filter({ hasText: "old-sync" }).first()).toContainText("missing"); // beta runs it; bin.git doesn't have it
  await expect(rows.filter({ hasText: "e2scrub" })).toHaveCount(0); // package jobs never get it

  await page.getByTestId("filter-hint").selectOption("disabled");
  await expect(rows.filter({ hasText: "old-sync" })).not.toHaveCount(0);
});

test("read-only: no edit/run/delete/toggle controls; secrets never shown; piapps' zk crontab links to the Crontab tab", async ({ page }) => {
  const main = page.locator("#main");
  for (const view of ["view-hosts", "view-jobs"]) {
    await page.getByTestId(view).click();
    await expect(main.getByRole("button", { name: /\b(edit|delete|remove|run|enable|disable|toggle|save|restore)\b/i })).toHaveCount(0);
    const text = await main.innerText();
    for (const secret of ["hcpingtoken123", "supersecret-token-value", "abc123def", "hunter2"]) expect(text).not.toContain(secret);
  }
  await page.getByTestId("view-hosts").click();
  const local = page.locator('[data-testid="host-section"][data-host="local"]');
  await expect(local.getByRole("link", { name: "Open in Crontab" }).first()).toHaveAttribute("href", "/crontab");
  const beta = page.locator('[data-testid="host-section"][data-host="beta"]');
  await expect(beta.getByRole("link", { name: "Open in Crontab" })).toHaveCount(0);
});

test("refresh and the g f shortcut", async ({ page }) => {
  await page.goto("/tasks");
  await expect(page.getByTestId("new-task")).toBeVisible();
  await page.keyboard.press("g");
  await page.keyboard.press("f");
  await expect(page).toHaveURL(/\/fleet$/);
  const req = page.waitForRequest((r) => r.url().includes("/api/fleet?refresh=1"));
  await page.getByTestId("fleet-refresh").click();
  expect((await req).method()).toBe("GET");
});

for (const theme of ["light", "dark"] as const) {
  for (const view of ["hosts", "jobs"]) {
    test(`axe: fleet ${view} (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("pitasker-ui-theme", t), theme);
      await page.goto(`/fleet${view === "jobs" ? "?view=jobs" : ""}`);
      await expect(page.getByTestId("host-chip").first()).toBeVisible();
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
    });
  }
}

test.describe("mobile (390 px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  for (const view of ["hosts", "jobs"]) {
    test(`fleet ${view}: no horizontal scroll; cards instead of the table`, async ({ page }) => {
      await page.goto(`/fleet${view === "jobs" ? "?view=jobs" : ""}`);
      await expect(page.getByTestId("host-chip").first()).toBeVisible();
      await expect(page.getByTestId("fleet-row").first()).toBeVisible();
      if (view === "jobs") await expect(page.getByTestId("fleet-table")).toBeHidden();
      await expectNoHorizontalScroll(page);
    });
  }
});

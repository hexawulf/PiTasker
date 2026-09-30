import { CURATED, crontab, expect, test, toastText } from "./helpers";

test("the crontab view shows every line as written", async ({ page }) => {
  await page.goto("/crontab");
  const lines = page.getByTestId("crontab-lines").locator("li");
  await expect(lines).toHaveCount(CURATED.trimEnd().split("\n").length);
  await expect(page.locator('[data-kind="disabled"]')).toHaveCount(2);
  await expect(page.locator('[data-kind="section"]').first()).toBeVisible();
  await expect(page.locator('[data-managed="true"]')).toHaveCount(1);
});

test("import reads the crontab without changing it; export of the same is a no-op", async ({ page }) => {
  await page.goto("/crontab");
  await page.getByTestId("crontab-import").click();
  const dlg = page.getByTestId("import-dialog");
  await expect(dlg.getByText("new", { exact: true })).toHaveCount(7);
  await expect(dlg.getByText("disabled", { exact: true })).toHaveCount(2);
  await dlg.getByTestId("import-confirm").click();
  await expect(toastText(page, "7 new, 0 updated")).toBeVisible();
  expect(crontab()).toBe(CURATED);

  await page.getByTestId("crontab-export").click();
  await expect(toastText(page, "Already in sync")).toBeVisible();
  await expect(page.getByTestId("diff-dialog")).toHaveCount(0);
  expect(crontab()).toBe(CURATED);

  await page.goto("/tasks");
  await expect(page.getByTestId("task-card")).toHaveCount(7);
  await expect(page.getByTestId("task-counts")).toContainText("7 tasks · 7 by cron · 0 by PiTasker");
});

import { CURATED, crontab, expect, test, toastText } from "./helpers";

test("create a crontab task: diff first, then only the new lines are added", async ({ page }) => {
  await page.goto("/tasks");
  await page.getByTestId("new-task").click();
  const ed = page.getByTestId("task-editor");
  await ed.getByTestId("task-name").fill("E2E hello");
  await ed.getByTestId("task-command").fill("/home/zk/bin/e2e-hello");
  await ed.getByRole("button", { name: "Daily 03:00" }).click();
  await expect(ed.getByTestId("cron-preview")).toContainText("daily 03:00");
  await expect(ed.getByTestId("cron-preview")).toContainText("Asia/Taipei");
  await ed.getByTestId("task-save").click();

  const diff = page.getByTestId("diff-dialog");
  await expect(diff).toBeVisible();
  await expect(diff.getByTestId("diff")).toContainText("0 3 * * * /home/zk/bin/e2e-hello");
  expect(crontab()).toBe(CURATED); // nothing written before Confirm
  await diff.getByTestId("diff-confirm").click();

  const card = page.getByTestId("task-card").filter({ hasText: "E2E hello" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("daily 03:00");
  await expect(card.getByTestId("next-runs")).toBeVisible();
  const text = crontab();
  expect(text.startsWith(CURATED)).toBe(true);
  expect(text.slice(CURATED.length)).toMatch(/^# PITASKER_ID:[0-9a-f-]{36}\n# PITASKER_COMMENT:E2E hello\n0 3 \* \* \* \/home\/zk\/bin\/e2e-hello\n$/);
});

test("invalid schedules are explained and block saving", async ({ page }) => {
  await page.goto("/tasks");
  await page.getByTestId("new-task").click();
  const ed = page.getByTestId("task-editor");
  await ed.getByTestId("task-name").fill("x");
  await ed.getByTestId("task-command").fill("echo x");
  await ed.getByTestId("cron-expr").fill("61 * * * *");
  await expect(ed.getByTestId("cron-preview")).toContainText("outside 0–59");
  await expect(ed.getByTestId("task-save")).toBeDisabled();
  await ed.getByTestId("runner-pitasker").check();
  await ed.getByTestId("cron-expr").fill("@reboot");
  await expect(ed.getByTestId("cron-preview")).toContainText("choose the crontab");
});

test("warns about scripts outside bin/ or not committed", async ({ page }) => {
  await page.goto("/tasks");
  await page.getByTestId("new-task").click();
  const ed = page.getByTestId("task-editor");
  await ed.getByTestId("task-command").fill("/tmp/some-script.sh");
  await expect(ed.getByTestId("script-warnings")).toContainText("is not in");
  const bin = await page.evaluate(() => fetch("/api/meta").then((r) => r.json()).then((m) => m.binDir));
  await ed.getByTestId("task-command").fill(`${bin}/uncommitted-job --flag`);
  await expect(ed.getByTestId("script-warnings")).toContainText("not committed to bin.git");
  await ed.getByTestId("task-command").fill(`${bin}/committed-job`);
  await expect(ed.getByTestId("script-warnings")).toHaveCount(0);
});

test("a PiTasker task: run now, see exit code, duration and output; move it to the crontab and back", async ({ page }) => {
  await page.goto("/tasks");
  await page.getByTestId("new-task").click();
  const ed = page.getByTestId("task-editor");
  await ed.getByTestId("task-name").fill("E2E own");
  await ed.getByTestId("task-command").fill("echo hello-out; echo hello-err >&2; exit 2");
  await ed.getByTestId("runner-pitasker").check();
  await ed.getByRole("button", { name: "Hourly" }).click();
  await ed.getByTestId("task-save").click();
  await expect(page.getByTestId("diff-dialog")).toHaveCount(0); // PiTasker runner: crontab untouched
  expect(crontab()).toBe(CURATED);

  const card = page.getByTestId("task-card").filter({ hasText: "E2E own" });
  await expect(card).toContainText("PiTasker");
  await card.getByRole("button", { name: /Run E2E own now/ }).click();
  await expect(card).toContainText("exit 2");
  await card.getByRole("button", { name: /Runs of E2E own/ }).click();
  const hist = page.getByTestId("run-history");
  await expect(hist.getByTestId("run-output")).toHaveText("hello-out");
  await hist.getByRole("tab", { name: "stderr" }).click();
  await expect(hist.getByTestId("run-output")).toHaveText("hello-err");
  await expect(hist).toContainText("exit 2");
  await page.keyboard.press("Escape");

  await card.getByRole("button", { name: /Let the crontab run E2E own/ }).click();
  await page.getByTestId("diff-confirm").click();
  await expect.poll(crontab).toContain("0 * * * * echo hello-out; echo hello-err >&2; exit 2");
  await expect(card.getByTitle("The crontab runs this task")).toBeVisible();

  await card.getByRole("button", { name: /Let PiTasker run E2E own/ }).click();
  await page.getByTestId("diff-confirm").click();
  await expect.poll(crontab).toBe(CURATED);
  await expect(card.getByTitle("PiTasker's scheduler runs this task")).toBeVisible();
});

test("edit and delete a task imported from the crontab", async ({ page }) => {
  await page.request.post("/api/crontab/import", { data: {}, headers: { "Content-Type": "application/json" } });
  await page.goto("/tasks");
  await page.getByTestId("task-search").fill("disk-watch");
  const card = page.getByTestId("task-card");
  await expect(card).toHaveCount(1);
  await card.getByRole("button", { name: /Edit/ }).click();
  const ed = page.getByTestId("task-editor");
  await ed.getByRole("button", { name: "Every 5 minutes" }).click();
  await ed.getByTestId("task-save").click();
  await page.getByTestId("diff-confirm").click();
  await expect(card).toContainText("every 5 min");
  await expect.poll(crontab).toContain("*/5 * * * * /home/zk/bin/disk-watch --quiet");
  expect(crontab()).not.toContain("*/15  *  * * *   /home/zk/bin/disk-watch");

  await card.getByRole("button", { name: /Delete/ }).click();
  await page.getByTestId("confirm-dialog").getByRole("button", { name: "Delete" }).click();
  await page.getByTestId("diff-confirm").click();
  await expect(page.getByTestId("task-card")).toHaveCount(0);
  await expect.poll(crontab).not.toContain("disk-watch");
  expect(crontab()).toContain("# ── Monitoring ──");
});

test("a backup restores the previous crontab", async ({ page }) => {
  await page.goto("/tasks");
  await page.getByTestId("new-task").click();
  const ed = page.getByTestId("task-editor");
  await ed.getByTestId("task-name").fill("tmp");
  await ed.getByTestId("task-command").fill("/home/zk/bin/tmp");
  await ed.getByTestId("task-save").click();
  await page.getByTestId("diff-confirm").click();
  await expect(page.getByTestId("task-card")).toHaveCount(1);

  await page.goto("/crontab");
  await page.getByTestId("backups").getByRole("button", { name: /Restore/ }).first().click();
  await page.getByTestId("diff-confirm").click();
  await expect(toastText(page, "Crontab restored")).toBeVisible();
  await expect.poll(crontab).toBe(CURATED);
});

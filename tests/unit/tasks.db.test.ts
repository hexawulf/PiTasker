import fs from "fs";
import path from "path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { listBackups } from "../../server/crontab/store";
import { taskScheduler } from "../../server/services/taskScheduler";
import { storage } from "../../server/storage";
import { hasPg } from "../setup/pg";
import { crontabText, resetDb, setCrontab, startApp, type Client } from "./helpers/app";

const CURATED = fs.readFileSync(path.join(__dirname, "..", "fixtures", "crontab.curated"), "utf8");
const BACKUP_DIR = () => path.join(process.env.PITASKER_STATE_DIR!, "crontab-backups");

let c: Client;
beforeEach(async () => {
  c?.close();
  await resetDb();
  fs.rmSync(BACKUP_DIR(), { recursive: true, force: true });
  delete process.env.FAKE_CRONTAB_FAIL_WRITE;
  setCrontab(CURATED);
  c = await startApp();
});
afterAll(() => {
  c?.close();
  taskScheduler.stopAll();
});

const waitRun = async (runId: number) => {
  for (let i = 0; i < 100; i++) {
    const r = await c.req("GET", `/api/runs/${runId}`);
    if (r.body.status !== "running") return r.body;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error("run did not finish");
};

describe.skipIf(!hasPg)("import / export against the fake crontab", () => {
  it("import leaves the crontab byte-identical and is idempotent", async () => {
    const first = await c.req("POST", "/api/crontab/import", {});
    expect(first.status).toBe(200);
    expect(first.body.imported).toBe(7);
    expect(first.body.items.filter((i: { action: string }) => i.action === "disabled")).toHaveLength(2);
    expect(crontabText()).toBe(CURATED);

    const second = await c.req("POST", "/api/crontab/import", {});
    expect(second.body).toMatchObject({ imported: 0, updated: 0, skipped: 9 }); // 7 unchanged + 2 disabled
    const tasks = await storage.getAllTasks();
    expect(tasks).toHaveLength(7);
    expect(tasks.every((t) => t.isSystemManaged && t.crontabId)).toBe(true);
    expect(tasks.find((t) => t.command.includes("pg-backup"))!.name).toBe("Nightly DB backup");
    expect(taskScheduler.scheduledIds()).toEqual([]); // cron runs them, not PiTasker
  });

  it("export of an unchanged crontab writes nothing (byte-identical, no backup)", async () => {
    await c.req("POST", "/api/crontab/import", {});
    const r = await c.req("POST", "/api/crontab/export", {});
    expect(r.body).toMatchObject({ changed: false, written: false, exported: 0, unchanged: 7 });
    expect(crontabText()).toBe(CURATED);
    expect(listBackups()).toEqual([]);
  });

  it("an edit changes only its own line (plus markers), with a backup", async () => {
    await c.req("POST", "/api/crontab/import", {});
    const t = (await storage.getAllTasks()).find((x) => x.command.includes("disk-watch"))!;
    const r = await c.req("PATCH", `/api/tasks/${t.id}`, { cronSchedule: "*/20 * * * *" });
    expect(r.status).toBe(200);
    expect(crontabText()).toBe(
      CURATED.replace("*/15  *  * * *   /home/zk/bin/disk-watch --quiet", `# PITASKER_ID:${t.crontabId}\n# PITASKER_COMMENT:disk-watch\n*/20 * * * * /home/zk/bin/disk-watch --quiet`),
    );
    expect(listBackups()).toHaveLength(1);
    // …and a second import sees that line as the same task.
    const again = await c.req("POST", "/api/crontab/import", {});
    expect(again.body.imported).toBe(0);
  });

  it("a hand edit in the crontab updates the task on import", async () => {
    await c.req("POST", "/api/crontab/import", {});
    setCrontab(CURATED.replace("4 7 * * * /home/zk/bin/pg-backup", "5 7 * * * /home/zk/bin/pg-backup"));
    const r = await c.req("POST", "/api/crontab/import", {});
    expect(r.body).toMatchObject({ imported: 0, updated: 1 });
    expect((await storage.getAllTasks()).find((t) => t.command.includes("pg-backup"))!.cronSchedule).toBe("5 7 * * *");
  });

  it("flags a task whose line vanished", async () => {
    await c.req("POST", "/api/crontab/import", {});
    setCrontab(CURATED.replace("@daily /home/zk/bin/rotate-reports\n", ""));
    const r = await c.req("POST", "/api/crontab/import", {});
    expect(r.body.missing).toHaveLength(1);
    const view = (await c.req("GET", "/api/tasks")).body.find((t: { command: string }) => t.command.includes("rotate-reports"));
    expect(view.cronState).toBe("missing");
  });

  it("dry-run import lists what would happen and changes nothing", async () => {
    const r = await c.req("POST", "/api/crontab/import?dryRun=1", {});
    expect(r.body.items.filter((i: { action: string }) => i.action === "import")).toHaveLength(7);
    expect(await storage.getAllTasks()).toHaveLength(0);
  });

  it("GET /api/crontab returns every line as written", async () => {
    const r = await c.req("GET", "/api/crontab");
    expect(r.body.text).toBe(CURATED);
    expect(r.body.lines.map((l: { raw: string }) => l.raw).join("\n") + "\n").toBe(CURATED);
    expect(r.body.lines.find((l: { kind: string; managed?: boolean }) => l.kind === "job" && l.managed)).toBeTruthy();
  });
});

describe.skipIf(!hasPg)("one runner per task", () => {
  const cronTask = { name: "Hello", cronSchedule: "*/10 * * * *", command: "/home/zk/bin/hello" };

  it("a crontab-run task is written to the crontab and not scheduled", async () => {
    const r = await c.req("POST", "/api/tasks", cronTask);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ runner: "cron", cronState: "active" });
    expect(crontabText()).toBe(`${CURATED}# PITASKER_ID:${r.body.crontabId}\n# PITASKER_COMMENT:Hello\n*/10 * * * * /home/zk/bin/hello\n`);
    expect(taskScheduler.isScheduled(r.body.id)).toBe(false);
  });

  it("dry run returns the diff and writes nothing", async () => {
    const r = await c.req("POST", "/api/tasks?dryRun=1", cronTask);
    expect(r.body).toMatchObject({ dryRun: true, changed: true, before: CURATED });
    expect(r.body.after).toContain("/home/zk/bin/hello");
    expect(crontabText()).toBe(CURATED);
    expect(await storage.getAllTasks()).toHaveLength(0);
  });

  it("refuses a write when the crontab changed since the dry run", async () => {
    const dry = await c.req("POST", "/api/tasks?dryRun=1", cronTask);
    setCrontab(`${CURATED}# edited meanwhile\n`);
    const r = await c.req("POST", `/api/tasks?expectedHash=${dry.body.hash}`, cronTask);
    expect(r.status).toBe(409);
    expect(await storage.getAllTasks()).toHaveLength(0);
  });

  it("a PiTasker-run task is scheduled and leaves the crontab alone", async () => {
    const r = await c.req("POST", "/api/tasks", { ...cronTask, isSystemManaged: false });
    expect(r.status).toBe(201);
    expect(r.body.runner).toBe("pitasker");
    expect(taskScheduler.isScheduled(r.body.id)).toBe(true);
    expect(crontabText()).toBe(CURATED);
  });

  it("refuses a PiTasker-run task whose command the crontab already runs", async () => {
    const r = await c.req("POST", "/api/tasks", { name: "dup", cronSchedule: "0 * * * *", command: "/home/zk/bin/rotate-reports", isSystemManaged: false });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/run twice/);
  });

  it("@reboot only with the crontab as runner", async () => {
    const r = await c.req("POST", "/api/tasks", { ...cronTask, cronSchedule: "@reboot", isSystemManaged: false });
    expect(r.status).toBe(400);
  });

  it("moving the runner (un)schedules immediately and edits the crontab", async () => {
    const created = (await c.req("POST", "/api/tasks", cronTask)).body;
    const toPi = await c.req("POST", `/api/tasks/${created.id}/runner`, { runner: "pitasker" });
    expect(toPi.status).toBe(200);
    expect(toPi.body.runner).toBe("pitasker");
    expect(taskScheduler.isScheduled(created.id)).toBe(true);
    expect(crontabText()).toBe(CURATED);

    const toCron = await c.req("POST", `/api/tasks/${created.id}/toggle-system-managed`, {});
    expect(toCron.body.runner).toBe("cron");
    expect(taskScheduler.isScheduled(created.id)).toBe(false);
    expect(crontabText()).toContain("*/10 * * * * /home/zk/bin/hello");
  });

  it("a failed crontab write keeps the task with PiTasker (still scheduled, DB unchanged)", async () => {
    const created = (await c.req("POST", "/api/tasks", { ...cronTask, isSystemManaged: false })).body;
    process.env.FAKE_CRONTAB_FAIL_WRITE = "1";
    const r = await c.req("POST", `/api/tasks/${created.id}/runner`, { runner: "cron" });
    expect(r.status).toBe(502);
    expect(taskScheduler.isScheduled(created.id)).toBe(true);
    expect((await storage.getTask(created.id))!.isSystemManaged).toBe(false);
    expect(crontabText()).toBe(CURATED);
  });

  it("a failed crontab write on create stores no task", async () => {
    process.env.FAKE_CRONTAB_FAIL_WRITE = "1";
    const r = await c.req("POST", "/api/tasks", cronTask);
    expect(r.status).toBe(502);
    expect(await storage.getAllTasks()).toHaveLength(0);
  });

  it("delete removes the line and markers (keepLine=1 keeps it)", async () => {
    const a = (await c.req("POST", "/api/tasks", cronTask)).body;
    expect((await c.req("DELETE", `/api/tasks/${a.id}`)).status).toBe(204);
    expect(crontabText()).toBe(CURATED);

    await c.req("POST", "/api/crontab/import", {});
    const rot = (await storage.getAllTasks()).find((t) => t.command.includes("rotate-reports"))!;
    await c.req("DELETE", `/api/tasks/${rot.id}?keepLine=1`);
    expect(crontabText()).toBe(CURATED);
  });

  it("never re-enables a line disabled by hand", async () => {
    await c.req("POST", "/api/crontab/import", {});
    const t = (await storage.getAllTasks()).find((x) => x.command.includes("rotate-reports"))!;
    setCrontab(CURATED.replace("@daily /home/zk/bin/rotate-reports", "# DISABLED: @daily /home/zk/bin/rotate-reports"));
    const r = await c.req("PATCH", `/api/tasks/${t.id}`, { cronSchedule: "@weekly" });
    expect(r.status).toBe(409);
    const exp = await c.req("POST", "/api/crontab/export", {});
    expect(exp.body.skipped).toEqual([{ taskId: t.id, reason: "line is disabled in the crontab" }]);
    expect(crontabText()).toContain("# DISABLED: @daily /home/zk/bin/rotate-reports");
  });

  it("restores a backup (with a diff first)", async () => {
    await c.req("POST", "/api/tasks", cronTask);
    const [b] = (await c.req("GET", "/api/crontab/backups")).body;
    const dry = await c.req("POST", `/api/crontab/backups/${b.name}/restore?dryRun=1`, {});
    expect(dry.body).toMatchObject({ dryRun: true, changed: true, after: CURATED });
    const r = await c.req("POST", `/api/crontab/backups/${b.name}/restore?expectedHash=${dry.body.hash}`, {});
    expect(r.body.written).toBe(true);
    expect(crontabText()).toBe(CURATED);
  });
});

describe.skipIf(!hasPg)("runs", () => {
  it("records exit code, duration and both streams", async () => {
    const t = (await c.req("POST", "/api/tasks", { name: "r", cronSchedule: "0 0 1 1 *", command: "echo out; echo err >&2; exit 4", isSystemManaged: false })).body;
    const start = await c.req("POST", `/api/tasks/${t.id}/run`, {});
    expect(start.status).toBe(202);
    const run = await waitRun(start.body.runId);
    expect(run).toMatchObject({ status: "failed", exitCode: 4, stdout: "out\n", stderr: "err\n", trigger: "manual" });
    expect(run.durationMs).toBeGreaterThanOrEqual(0);
    const view = (await c.req("GET", `/api/tasks/${t.id}`)).body;
    expect(view.lastRunInfo).toMatchObject({ status: "failed", exitCode: 4 });
    expect(view.status).toBe("failed");
    expect(view.output).toBe("out\n[stderr]\nerr\n[exit 4]");
    expect((await c.req("GET", `/api/tasks/${t.id}/runs`)).body).toHaveLength(1);
  });

  it("refuses a second start while running", async () => {
    const t = (await c.req("POST", "/api/tasks", { name: "slow", cronSchedule: "0 0 1 1 *", command: "sleep 0.5", isSystemManaged: false })).body;
    const a = await c.req("POST", `/api/tasks/${t.id}/run`, {});
    const b = await c.req("POST", `/api/tasks/${t.id}/run`, {});
    expect(b.status).toBe(409);
    await waitRun(a.body.runId);
  });

  it("stale state is reset at start", async () => {
    const t = await storage.createTask({ name: "stuck", cronSchedule: "* * * * *", command: "x", status: "running", isSystemManaged: true, lastRun: new Date(Date.now() + 30 * 86400_000) });
    const own = await storage.createTask({ name: "own", cronSchedule: "* * * * *", command: "y", status: "running", isSystemManaged: false });
    const run = await storage.createRun(own.id, "schedule");
    const r = await storage.resetStaleState();
    expect(r).toEqual({ runs: 1, cronTasks: 1, ownTasks: 1, futureLastRun: 1 });
    expect((await storage.getTask(t.id))!).toMatchObject({ status: "pending", lastRun: null });
    expect((await storage.getTask(own.id))!.status).toBe("failed");
    expect((await storage.getRun(run.id))!.status).toBe("interrupted");
  });
});

describe.skipIf(!hasPg)("auth", () => {
  it("login, me, logout", async () => {
    expect((await c.req("GET", "/api/auth/me")).body.user.username).toBe("admin");
    expect((await c.req("POST", "/api/auth/logout", {})).status).toBe(200);
    expect((await c.req("GET", "/api/auth/me")).status).toBe(401);
  });

  it("change-password enforces the rules", async () => {
    const bad = await c.req("POST", "/api/auth/change-password", { currentPassword: "correct horse battery staple", newPassword: "short", confirmNewPassword: "short" });
    expect(bad.status).toBe(400);
    const wrong = await c.req("POST", "/api/auth/change-password", { currentPassword: "nope", newPassword: "a-much-better-passphrase", confirmNewPassword: "a-much-better-passphrase" });
    expect(wrong.status).toBe(401);
    const ok = await c.req("POST", "/api/auth/change-password", { currentPassword: "correct horse battery staple", newPassword: "a-much-better-passphrase", confirmNewPassword: "a-much-better-passphrase" });
    expect(ok.status).toBe(200);
  });

  it("rate-limits login attempts", async () => {
    const anon = await startApp({ login: false });
    const { loginLimiter } = await import("../../server/routes/auth");
    loginLimiter.reset();
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await anon.req("POST", "/api/auth/login", { username: "admin", password: "wrong" })).status;
    expect(last).toBe(429);
    loginLimiter.reset();
    anon.close();
  });
});

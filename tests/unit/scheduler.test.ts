import { afterEach, describe, expect, it, vi } from "vitest";
import { schedule } from "node-cron";
import type { Task } from "@shared/schema";
import { TaskScheduler, runsInPiTasker } from "../../server/services/taskScheduler";
import type { TaskRunner } from "../../server/services/taskRunner";

vi.mock("node-cron", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node-cron")>();
  return { ...actual, schedule: vi.fn(actual.schedule) };
});

const task = (over: Partial<Task> = {}): Task => ({
  id: 1,
  name: "t",
  cronSchedule: "*/5 * * * *",
  command: "true",
  status: "pending",
  lastRun: null,
  output: null,
  createdAt: new Date(),
  crontabId: null,
  syncedToCrontab: false,
  crontabSyncedAt: null,
  source: "pitasker",
  isSystemManaged: false,
  ...over,
});

function fakeRunner() {
  return { isRunning: vi.fn(() => false), start: vi.fn(async () => ({})) } as unknown as TaskRunner & { start: ReturnType<typeof vi.fn> };
}

let s: TaskScheduler;
afterEach(() => s?.stopAll());

describe("one runner per task", () => {
  it("PiTasker schedules only tasks it runs", () => {
    expect(runsInPiTasker(task())).toBe(true);
    expect(runsInPiTasker(task({ isSystemManaged: true }))).toBe(false);
    expect(runsInPiTasker(task({ isSystemManaged: null }))).toBe(false); // DB default = crontab
    expect(runsInPiTasker(task({ cronSchedule: "@reboot" }))).toBe(false);
    expect(runsInPiTasker(task({ cronSchedule: "@daily" }))).toBe(true);
  });

  it("sync schedules and unschedules as the runner changes", () => {
    s = new TaskScheduler(fakeRunner(), async () => undefined);
    s.sync(task());
    expect(s.isScheduled(1)).toBe(true);
    s.sync(task({ isSystemManaged: true }));
    expect(s.isScheduled(1)).toBe(false);
    s.sync(task());
    expect(s.scheduledIds()).toEqual([1]);
  });

  it("syncAll drops tasks that no longer exist", () => {
    s = new TaskScheduler(fakeRunner(), async () => undefined);
    s.syncAll([task({ id: 1 }), task({ id: 2 }), task({ id: 3, isSystemManaged: true })]);
    expect(s.scheduledIds()).toEqual([1, 2]);
    s.syncAll([task({ id: 2 })]);
    expect(s.scheduledIds()).toEqual([2]);
  });

  it("at fire time a task moved to the crontab does not run (and is unscheduled)", async () => {
    const runner = fakeRunner();
    s = new TaskScheduler(runner, async () => task({ isSystemManaged: true }));
    s.sync(task());
    await s.fire(1);
    expect(runner.start).not.toHaveBeenCalled();
    expect(s.isScheduled(1)).toBe(false);
  });

  it("at fire time a PiTasker task runs with the fresh row", async () => {
    const runner = fakeRunner();
    const fresh = task({ command: "echo new" });
    s = new TaskScheduler(runner, async () => fresh);
    s.sync(task());
    await s.fire(1);
    expect(runner.start).toHaveBeenCalledWith(fresh, "schedule");
  });

  it("skips a start while the previous run is still going", async () => {
    const runner = fakeRunner();
    (runner.isRunning as ReturnType<typeof vi.fn>).mockReturnValue(true);
    s = new TaskScheduler(runner, async () => task());
    await s.fire(1);
    expect(runner.start).not.toHaveBeenCalled();
  });

  it("uses the host time zone, not UTC", async () => {
    s = new TaskScheduler(fakeRunner(), async () => undefined);
    s.sync(task({ id: 9 }));
    expect(vi.mocked(schedule).mock.calls.at(-1)?.[2]).toMatchObject({ timezone: "Asia/Taipei" });
  });
});

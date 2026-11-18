import { describe, expect, it } from "vitest";
import {
  AgentHealthSchema,
  CrontabSourceSchema,
  EntrySchema,
  SnapshotSchema,
} from "@shared/fleet";
import {
  commandSchema,
  cronScheduleSchema,
  insertUserSchema,
  taskInputSchema,
  taskPatchSchema,
} from "@shared/schema";

describe("Zod 4 schema validation", () => {
  it("validates cron schedules and reports custom issue messages", () => {
    expect(cronScheduleSchema.safeParse("*/5 * * * *").success).toBe(true);
    expect(cronScheduleSchema.safeParse("@daily").success).toBe(true);

    const bad = cronScheduleSchema.safeParse("invalid cron");
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues.length).toBeGreaterThan(0);
      expect(bad.error.issues[0].message).toMatch(/5 fields/);
    }
  });

  it("validates commandSchema and rejects multi-line or empty commands", () => {
    expect(commandSchema.safeParse("/usr/bin/true").success).toBe(true);
    expect(commandSchema.safeParse("   ").success).toBe(false);
    expect(commandSchema.safeParse("echo a\necho b").success).toBe(false);
    expect(commandSchema.safeParse("x".repeat(1001)).success).toBe(false);
  });

  it("validates taskInputSchema and rejects @reboot for PiTasker runner", () => {
    const ok = taskInputSchema.safeParse({
      name: "Nightly backup",
      cronSchedule: "0 3 * * *",
      command: "/usr/local/bin/backup.sh",
    });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.isSystemManaged).toBe(true);
    }

    const rebootOwn = taskInputSchema.safeParse({
      name: "Boot task",
      cronSchedule: "@reboot",
      command: "/usr/local/bin/boot.sh",
      isSystemManaged: false,
    });
    expect(rebootOwn.success).toBe(false);
    if (!rebootOwn.success) {
      expect(rebootOwn.error.issues[0].path).toEqual(["cronSchedule"]);
      expect(rebootOwn.error.issues[0].message).toMatch(/@reboot needs the crontab/);
    }
  });

  it("validates taskPatchSchema in strict mode and rejects unknown keys", () => {
    expect(taskPatchSchema.safeParse({ name: "Renamed" }).success).toBe(true);
    const extra = taskPatchSchema.safeParse({ name: "Renamed", unknownField: 123 });
    expect(extra.success).toBe(false);
  });

  it("names failing fields without echoing secret values in error messages", () => {
    const secretValue = "super-secret-password-value-999";
    const bad = insertUserSchema.safeParse({ username: "", password: secretValue });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      const serialized = JSON.stringify(bad.error.issues);
      expect(serialized).toContain("username");
      expect(serialized).not.toContain(secretValue);
    }
  });

  it("validates Fleet SnapshotSchema and AgentHealthSchema", () => {
    const health = AgentHealthSchema.safeParse({
      version: "2.2.2",
      host: "node-a",
      tz: "UTC",
      capabilities: { cron: true, write: false },
    });
    expect(health.success).toBe(true);

    const entry = EntrySchema.safeParse({
      id: "abc12345",
      line: "*/5 * * * * /usr/bin/true",
      schedule: "*/5 * * * *",
      command: "/usr/bin/true",
      disabled: false,
      nextRuns: ["2026-10-01T00:05:00.000Z"],
    });
    expect(entry.success).toBe(true);

    const source = CrontabSourceSchema.safeParse({
      kind: "crontab",
      owner: "zk",
      hash: "deadbeef",
      entries: [entry.success ? entry.data : []],
    });
    expect(source.success).toBe(true);

    const snap = SnapshotSchema.safeParse({
      host: "node-a",
      tz: "UTC",
      generatedAt: "2026-10-01T00:00:00.000Z",
      agentVersion: "2.2.2",
      bin: null,
      sources: source.success ? [source.data] : [],
      errors: [],
    });
    expect(snap.success).toBe(true);
  });
});

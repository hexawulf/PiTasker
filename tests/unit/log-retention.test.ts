// Log retention (server/services/logRetentionService.ts): which dated log files
// count as "within retention", and what cleanup() deletes. cleanup() only
// ever touches *-YYYY-MM-DD.log files older than the window, in one dir.
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config, parseRetentionDays } from "../../server/config";
import { LogRetentionService } from "../../server/services/logRetentionService";

// 2026-03-10 at noon local time; with 7 days the window is 03-04 … 03-10.
const NOW = () => new Date(2026, 2, 10, 12, 0, 0);

describe("parseRetentionDays", () => {
  it("defaults to 7 and floors to whole days, at least 1", () => {
    expect(parseRetentionDays(undefined)).toBe(7);
    expect(parseRetentionDays("14")).toBe(14);
    expect(parseRetentionDays("2.9")).toBe(2);
    expect(parseRetentionDays("0.5")).toBe(1);
  });

  it("falls back to 7 on invalid values and says so", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const raw of ["", "0", "-3", "abc", "Infinity"]) expect(parseRetentionDays(raw)).toBe(7);
    expect(warn).toHaveBeenCalledTimes(5);
    warn.mockRestore();
  });
});

describe("config log settings", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("read LOG_DIR, LOG_RETENTION_DAYS and LOG_CLEANUP_DRY_RUN", () => {
    process.env.LOG_DIR = "/srv/pt-logs";
    process.env.LOG_RETENTION_DAYS = "3";
    process.env.LOG_CLEANUP_DRY_RUN = "true";
    expect(config.logDir).toBe("/srv/pt-logs");
    expect(config.logRetentionDays).toBe(3);
    expect(config.logCleanupDryRun).toBe(true);
  });

  it("default the log dir under the home directory, not a fixed user", () => {
    delete process.env.LOG_DIR;
    delete process.env.LOG_CLEANUP_DRY_RUN;
    expect(config.logDir).toBe(path.join(os.homedir(), "logs", "pitasker"));
    expect(config.logCleanupDryRun).toBe(false);
  });
});

describe("isWithinRetention", () => {
  const svc = new LogRetentionService({ retentionDays: 7, now: NOW, logDir: "/unused" });

  it("keeps the last N calendar days, today included", () => {
    expect(svc.isWithinRetention("pitasker-2026-03-10.log")).toBe(true);
    expect(svc.isWithinRetention("pitasker-2026-03-04.log")).toBe(true);
    expect(svc.isWithinRetention("pitasker-2026-03-03.log")).toBe(false);
    expect(svc.isWithinRetention("pitasker-2025-12-31.log")).toBe(false);
  });

  it("keeps files it cannot date (active log, other names, impossible dates)", () => {
    expect(svc.isWithinRetention("pitasker.log")).toBe(true);
    expect(svc.isWithinRetention("notes.txt")).toBe(true);
    expect(svc.isWithinRetention("pitasker-2026-02-30.log")).toBe(true);
    expect(svc.isWithinRetention("pitasker-2026-13-01.log")).toBe(true);
  });

  it("with 1 day keeps only today", () => {
    const one = new LogRetentionService({ retentionDays: 1, now: NOW, logDir: "/unused" });
    expect(one.isWithinRetention("pitasker-2026-03-10.log")).toBe(true);
    expect(one.isWithinRetention("pitasker-2026-03-09.log")).toBe(false);
  });
});

describe("cleanup", () => {
  let dir: string;
  const files = [
    "pitasker-2026-03-10.log", // today: keep
    "pitasker-2026-03-04.log", // oldest kept day
    "pitasker-2026-03-03.log", // old: delete
    "error-2026-01-15.log", // old: delete
    "pitasker.log", // undated: keep
    "pitasker-2026-01-01.log.gz", // not *.log: keep
  ];
  const left = () => fs.readdirSync(dir).sort();

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pitasker-retention-"));
    for (const f of files) fs.writeFileSync(path.join(dir, f), "x\n");
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("dry run deletes nothing and reports what it would delete", async () => {
    const svc = new LogRetentionService({ logDir: dir, retentionDays: 7, dryRun: true, now: NOW });
    expect(await svc.cleanup()).toEqual({ scanned: 5, deleted: 2 });
    expect(left()).toEqual([...files].sort());
  });

  it("deletes only dated *.log files older than the window", async () => {
    const svc = new LogRetentionService({ logDir: dir, retentionDays: 7, dryRun: false, now: NOW });
    expect(await svc.cleanup()).toEqual({ scanned: 5, deleted: 2 });
    expect(left()).toEqual(
      ["pitasker-2026-01-01.log.gz", "pitasker-2026-03-04.log", "pitasker-2026-03-10.log", "pitasker.log"].sort(),
    );
  });

  it("removes a symlink, never the file it points to", async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pitasker-outside-"));
    const target = path.join(outside, "keep-me.log");
    fs.writeFileSync(target, "precious\n");
    fs.symlinkSync(target, path.join(dir, "link-2026-01-02.log"));
    const svc = new LogRetentionService({ logDir: dir, retentionDays: 7, dryRun: false, now: NOW });
    await svc.cleanup();
    expect(fs.existsSync(path.join(dir, "link-2026-01-02.log"))).toBe(false);
    expect(fs.readFileSync(target, "utf8")).toBe("precious\n");
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("a missing log dir is skipped, not an error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const svc = new LogRetentionService({ logDir: path.join(dir, "nope"), dryRun: false, now: NOW });
    expect(await svc.cleanup()).toEqual({ scanned: 0, deleted: 0 });
    expect(warn).toHaveBeenCalled();
  });

  it("never rejects: a read error is logged and cleanup resolves", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(fs.promises, "readdir").mockRejectedValueOnce(new Error("EACCES"));
    const svc = new LogRetentionService({ logDir: dir, dryRun: false, now: NOW });
    await expect(svc.cleanup()).resolves.toEqual({ scanned: 0, deleted: 0 });
    expect(err).toHaveBeenCalled();
    expect(left()).toEqual([...files].sort());
  });
});

import fs from "fs";
import os from "os";
import path from "path";
import type { Request, Response } from "express";
import { describe, expect, it } from "vitest";
import { parseCron } from "../../shared/cron";
import { commandSchema, cronScheduleSchema, taskInputSchema, taskPatchSchema } from "../../shared/schema";
import { createFailureLimiter } from "../../server/agent/auth";
import { createRateLimiter } from "../../server/middleware/rateLimitLogin";
import { isValidLog, resolveSafeLogPath } from "../../server/routes/pitasker-logs";
import { cspDirectives, inlineScriptHashes } from "../../server/security";

describe("cspDirectives & inlineScriptHashes", () => {
  it("builds a baseline CSP with script hashes", () => {
    const d = cspDirectives(["'sha256-abc'"], { firebase: false });
    expect(d["default-src"]).toEqual(["'self'"]);
    expect(d["script-src"]).toContain("'sha256-abc'");
    expect(d["object-src"]).toEqual(["'none'"]);
    expect(d["frame-ancestors"]).toEqual(["'none'"]);
    expect(d["report-uri"]).toEqual(["/csp-report"]);
    expect(d["connect-src"]).not.toContain("https://identitytoolkit.googleapis.com");
  });

  it("includes Firebase domains when firebase option is true", () => {
    const d = cspDirectives(["'sha256-abc'"], { firebase: true });
    expect(d["script-src"]).toContain("https://apis.google.com");
    expect(d["connect-src"]).toContain("https://apis.google.com");
    expect(d["connect-src"]).toContain("https://identitytoolkit.googleapis.com");
    expect(d["frame-src"]).toContain("https://accounts.google.com");
    expect(d["img-src"]).toContain("https://*.googleusercontent.com");
  });

  it("hashes the inline theme script in client/index.html", () => {
    const html = fs.readFileSync(path.resolve("client/index.html"), "utf8");
    const hashes = inlineScriptHashes(html);
    expect(hashes.length).toBe(1);
    expect(hashes[0]).toMatch(/^'sha256-[A-Za-z0-9+/=]+'$/);
    expect(html).toContain("pitasker-ui-theme");
  });
});

describe("input control-character & newline guards", () => {
  it("rejects schedules containing newlines or control characters", () => {
    expect(parseCron("*\n* * * *").ok).toBe(false);
    expect(parseCron("*\r* * * *").ok).toBe(false);
    expect(parseCron("* * * * *\0").ok).toBe(false);
    expect(cronScheduleSchema.safeParse("*\n* * * *").success).toBe(false);
    expect(cronScheduleSchema.safeParse("*/5 * * * *").success).toBe(true);
  });

  it("rejects NUL bytes and control characters in task names and commands", () => {
    expect(commandSchema.safeParse("echo ok\0injected").success).toBe(false);
    expect(commandSchema.safeParse("echo ok\x07bell").success).toBe(false);
    expect(commandSchema.safeParse("echo ok\nsecond").success).toBe(false);
    expect(commandSchema.safeParse("echo\tok").success).toBe(true);

    expect(
      taskInputSchema.safeParse({
        name: "bad\0name",
        cronSchedule: "0 * * * *",
        command: "echo ok",
      }).success,
    ).toBe(false);
    expect(
      taskInputSchema.safeParse({
        name: "bad\n# PITASKER_ID:spoof",
        cronSchedule: "0 * * * *",
        command: "echo ok",
      }).success,
    ).toBe(false);
    expect(taskPatchSchema.safeParse({ name: "bad\x1bname" }).success).toBe(false);
  });
});

describe("log file validation & symlink protection", () => {
  it("rejects leading dashes, dots, and path traversal in log filenames", () => {
    expect(isValidLog("pitasker-2026-10-01.log")).toBe(true);
    expect(isValidLog("-f.log")).toBe(false);
    expect(isValidLog("--help.log")).toBe(false);
    expect(isValidLog(".hidden.log")).toBe(false);
    expect(isValidLog("../etc/passwd.log")).toBe(false);
  });

  it("refuses symlinks inside LOG_DIR", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pitasker-log-test-"));
    const outside = path.join(os.tmpdir(), `pitasker-outside-${process.pid}.txt`);
    try {
      const realLog = path.join(dir, "app-2026-10-01.log");
      fs.writeFileSync(realLog, "ok\n");
      fs.writeFileSync(outside, "secret\n");
      const symlinkLog = path.join(dir, "symlink-2026-10-01.log");
      fs.symlinkSync(outside, symlinkLog);

      expect(resolveSafeLogPath("app-2026-10-01.log", dir)).toBe(fs.realpathSync(realLog));
      expect(resolveSafeLogPath("symlink-2026-10-01.log", dir)).toBeNull();
      expect(resolveSafeLogPath("-f.log", dir)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(outside, { force: true });
    }
  });
});

describe("rate limiters", () => {
  it("bounds login rate limiter bucket size and resets key on success", () => {
    const limiter = createRateLimiter(2, 60_000, 3);
    const call = (ip: string) => {
      let status = 200;
      const req = { ip, headers: {} } as unknown as Request;
      const res = {
        setHeader: () => {},
        status: (s: number) => {
          status = s;
          return { json: () => {} };
        },
      } as unknown as Response;
      limiter(req, res, () => {});
      return status;
    };

    expect(call("10.0.0.1")).toBe(200);
    expect(call("10.0.0.1")).toBe(200);
    expect(call("10.0.0.1")).toBe(429);

    limiter.resetKey({ ip: "10.0.0.1", headers: {} });
    expect(call("10.0.0.1")).toBe(200);

    call("10.0.0.2");
    call("10.0.0.3");
    call("10.0.0.4");
    expect(limiter.size()).toBeLessThanOrEqual(3);
  });

  it("evicts oldest entry in agent failure limiter without clearing other blocked IPs", () => {
    const lim = createFailureLimiter({ max: 2, windowMs: 60_000, maxKeys: 3 });
    lim.fail("10.0.0.1");
    lim.fail("10.0.0.2");
    lim.fail("10.0.0.2");
    expect(lim.blocked("10.0.0.2")).toBe(true);

    lim.fail("10.0.0.3");
    lim.fail("10.0.0.4"); // evicts 10.0.0.1 (oldest), keeps 10.0.0.2 blocked
    expect(lim.blocked("10.0.0.2")).toBe(true);
  });
});

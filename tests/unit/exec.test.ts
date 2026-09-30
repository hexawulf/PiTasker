import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { cronCommand, execCommand, jobEnv } from "../../server/services/exec";
import { summarizeOutput } from "../../server/services/taskRunner";

const opts = { timeoutMs: 10_000, cap: 64 * 1024 };

describe("cronCommand (% handling as cron does it)", () => {
  it.each([
    ["echo hi", "echo hi", null],
    ["date +\\%F", "date +%F", null],
    ["cat %line one%line two", "cat ", "line one\nline two\n"],
    ["printf x\\%y %a\\%b", "printf x%y ", "a%b\n"],
  ])("%s", (input, cmd, stdin) => {
    expect(cronCommand(input)).toEqual({ command: cmd, stdin });
  });
});

describe("execCommand", () => {
  it("keeps stdout and stderr separately, with the exit code and duration", async () => {
    const r = await execCommand("echo out; echo err >&2; exit 3", opts);
    expect(r).toMatchObject({ status: "failed", exitCode: 3, stdout: "out\n", stderr: "err\n", truncated: false });
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("success on exit 0", async () => {
    expect(await execCommand("true", opts)).toMatchObject({ status: "success", exitCode: 0 });
  });

  it("feeds % text as stdin", async () => {
    expect((await execCommand("cat %hello%world", opts)).stdout).toBe("hello\nworld\n");
  });

  it("keeps the tail when output exceeds the cap", async () => {
    const r = await execCommand("seq 1 5000", { ...opts, cap: 1024 });
    expect(r.truncated).toBe(true);
    expect(r.stdout.length).toBe(1024);
    expect(r.stdout.endsWith("5000\n")).toBe(true);
  });

  it("kills the whole process group on timeout", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pitasker-exec-"));
    const pidFile = path.join(dir, "child.pid");
    const r = await execCommand(`sleep 30 & echo $! > ${pidFile}; sleep 30`, { timeoutMs: 300, cap: 1024, killGraceMs: 200 });
    expect(r.status).toBe("timeout");
    const pid = Number(fs.readFileSync(pidFile, "utf8"));
    await new Promise((res) => setTimeout(res, 100));
    // Gone, or a zombie waiting for a reaper (containers often lack an init that reaps).
    const state = fs.existsSync(`/proc/${pid}/stat`) ? fs.readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]?.[0] : "gone";
    expect(["gone", "Z", "X"]).toContain(state);
  });

  it("does not pass PiTasker's secrets to the job", async () => {
    process.env.SESSION_SECRET = "top-secret-value";
    const r = await execCommand("env", opts);
    expect(r.stdout).not.toContain("top-secret-value");
    expect(r.stdout).not.toContain("DATABASE_URL");
    expect(Object.keys(jobEnv()).sort()).toEqual(expect.arrayContaining(["HOME", "LOGNAME", "PATH", "SHELL", "USER"]));
  });

  it("reports a command that cannot start", async () => {
    const r = await execCommand("/nonexistent/binary-xyz", opts);
    expect(r.status).toBe("failed");
    expect(r.exitCode).toBe(127);
    expect(r.stderr).toMatch(/not found/);
  });
});

describe("summarizeOutput", () => {
  it("labels stderr and the exit status", () => {
    expect(summarizeOutput({ stdout: "a\n", stderr: "b\n", status: "failed", exitCode: 2, signal: null })).toBe("a\n[stderr]\nb\n[exit 2]");
    expect(summarizeOutput({ stdout: "", stderr: "", status: "timeout", exitCode: null, signal: "SIGTERM" })).toBe("[timed out: process group killed]");
  });
});

describe("crontab env lines", () => {
  it("parses NAME=value lines, strips quotes, skips MAILTO", async () => {
    const { crontabEnvVars } = await import("../../server/services/exec");
    const lines = ["SHELL=/bin/bash", 'PATH="/home/zk/bin:/usr/bin:/bin"', 'MAILTO=""', "FOO = bar baz ", "# X=1"].map((raw) => ({ raw, kind: raw.startsWith("#") ? "comment" : "env" }));
    expect(crontabEnvVars(lines)).toEqual({ SHELL: "/bin/bash", PATH: "/home/zk/bin:/usr/bin:/bin", FOO: "bar baz" });
  });

  it("stdin is never a socket (bash would source ~/.bashrc), with or without % input", async () => {
    const probe = '[ -S /dev/stdin ] && echo socket || echo not-a-socket; cat';
    const none = await execCommand(probe, { ...opts, crontabEnv: { SHELL: "/bin/bash" } });
    expect(none.stdout).toBe("not-a-socket\n");
    const withInput = await execCommand(`${probe}%line one%line two`, { ...opts, crontabEnv: { SHELL: "/bin/bash" } });
    expect(withInput.stdout).toBe("not-a-socket\nline one\nline two\n");
  });

  it("runs with the crontab's SHELL and PATH", async () => {
    const r = await execCommand('echo "$0|$PATH|$FOO"', { ...opts, crontabEnv: { SHELL: "/bin/bash", PATH: "/usr/bin:/bin", FOO: "x" } });
    expect(r.stdout).toBe("/bin/bash|/usr/bin:/bin|x\n");
  });
});

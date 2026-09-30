// Run one command the way cron would, and capture what happened.
//
//   command (crontab syntax) ─► cronCommand() ─► $SHELL -c <cmd> (default /bin/sh), stdin = text after the first unescaped %
//                                               own process group (detached), cron-like env + the crontab's env lines
//   stdout ─┐ each kept separately, the last `cap` bytes (truncated flag)
//   stderr ─┘
//   timeout ─► SIGTERM to the whole group, SIGKILL 5 s later
//   result  ─► status success | failed | timeout, exit code, signal, duration
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

export type ExecResult = {
  status: "success" | "failed" | "timeout";
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
};

export type ExecOptions = {
  timeoutMs: number;
  cap: number;
  killGraceMs?: number;
  cwd?: string;
  /** Variables from the crontab's own env lines (SHELL, PATH, …), as cron would set them. */
  crontabEnv?: Record<string, string>;
};

/**
 * Crontab command syntax → shell command + stdin, as cron does it:
 * `\%` is a literal %, the first unescaped % ends the command and the rest is
 * stdin, where further unescaped % become newlines.
 */
export function cronCommand(command: string): { command: string; stdin: string | null } {
  let cmd = "";
  let stdin: string | null = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === "\\" && command[i + 1] === "%") {
      if (stdin === null) cmd += "%";
      else stdin += "%";
      i++;
    } else if (c === "%") {
      if (stdin === null) stdin = "";
      else stdin += "\n";
    } else if (stdin === null) cmd += c;
    else stdin += c;
  }
  return { command: cmd, stdin: stdin === null ? null : `${stdin}\n` };
}

/** NAME=value lines of a crontab → variables (quotes stripped; MAILTO is cron's business). */
export function crontabEnvVars(lines: { kind: string; raw: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of lines) {
    if (l.kind !== "env") continue;
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(l.raw.replace(/\r$/, ""));
    if (!m || m[1] === "MAILTO" || m[1] === "CRON_TZ") continue;
    out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

/** What cron gives a job: no PiTasker secrets (SESSION_SECRET, DATABASE_URL …) ever reach it. */
/**
 * A job's stdin as a real file (the % text), never a socket. Node's "pipe"
 * is a socketpair, and bash takes a socket on stdin for sshd and sources
 * ~/.bashrc (interactive PATH, aliases) — cron never does that.
 */
function stdinFile(text: string): number {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pitasker-stdin-"));
  try {
    const file = path.join(dir, "stdin");
    fs.writeFileSync(file, text, { mode: 0o600 });
    return fs.openSync(file, "r");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true }); // the open fd keeps the data
  }
}

export function jobEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {
    HOME: env.HOME || os.homedir(),
    LOGNAME: env.LOGNAME || env.USER || os.userInfo().username,
    USER: env.USER || os.userInfo().username,
    SHELL: "/bin/sh",
    PATH: "/usr/bin:/bin", // cron's default; a crontab PATH= line overrides it
  };
  for (const k of ["LANG", "LC_ALL", "TZ"]) if (env[k]) out[k] = env[k];
  return out;
}

class Tail {
  private s = "";
  truncated = false;
  constructor(private cap: number) {}
  push(chunk: Buffer | string) {
    this.s += chunk.toString();
    if (this.s.length > this.cap * 2) this.trim();
  }
  private trim() {
    if (this.s.length > this.cap) {
      this.s = this.s.slice(this.s.length - this.cap);
      this.truncated = true;
    }
  }
  value() {
    this.trim();
    return this.s;
  }
}

export function execCommand(command: string, opts: ExecOptions): Promise<ExecResult> {
  const { command: cmd, stdin } = cronCommand(command);
  const started = Date.now();
  return new Promise((resolve) => {
    const out = new Tail(opts.cap);
    const err = new Tail(opts.cap);
    let timedOut = false;
    let done = false;
    const env = { ...jobEnv(), ...(opts.crontabEnv ?? {}) };
    const shell = env.SHELL && env.SHELL.startsWith("/") ? env.SHELL : "/bin/sh";
    const stdinFd = stdin === null ? null : stdinFile(stdin);
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(shell, ["-c", cmd], {
        detached: true, // own process group: a timeout kills everything the job started
        cwd: opts.cwd ?? env.HOME,
        env,
        stdio: [stdinFd ?? "ignore", "pipe", "pipe"],
      });
    } finally {
      if (stdinFd !== null) fs.closeSync(stdinFd); // the child has its own copy
    }
    const killGroup = (sig: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(-child.pid, sig);
      } catch {
        /* already gone */
      }
    };
    let killTimer: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup("SIGTERM");
      killTimer = setTimeout(() => killGroup("SIGKILL"), opts.killGraceMs ?? 5_000);
    }, opts.timeoutMs);

    const finish = (code: number | null, signal: NodeJS.Signals | null, spawnError?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (spawnError) err.push(`${spawnError.message}\n`);
      resolve({
        status: timedOut ? "timeout" : code === 0 ? "success" : "failed",
        exitCode: code,
        signal: signal ?? null,
        durationMs: Date.now() - started,
        stdout: out.value(),
        stderr: err.value(),
        truncated: out.truncated || err.truncated,
      });
    };

    child.stdout!.on("data", (d) => out.push(d));
    child.stderr!.on("data", (d) => err.push(d));
    child.on("error", (e) => finish(null, null, e));
    // "close" waits for the pipes; a job that leaves a background child holding
    // them open is reported 2 s after the shell itself exited.
    child.on("exit", (code, signal) => setTimeout(() => finish(code, signal), 2_000).unref());
    child.on("close", (code, signal) => finish(code, signal));
  });
}

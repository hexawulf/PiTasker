// The only way the fleet collector runs a program: execFile with a fixed argv
// (never a shell, never a path or argument from a request), a timeout and an
// output cap.
//
// Tests (VITEST / PITASKER_E2E set): systemctl, journalctl, timedatectl and
// crontab must resolve to a file inside PITASKER_FAKE_BIN_DIR (the fakes in
// tests/fakes/), and the fixture paths (PITASKER_ETC_DIR, PITASKER_BIN_DIR,
// PITASKER_ROOT_CRON_SNAPSHOT) must not be the real ones — otherwise the
// collector refuses to run. git is allowed (it only reads the scratch bin repo).
import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

export const testMode = () => Boolean(process.env.VITEST || process.env.PITASKER_E2E);

export type FleetPaths = {
  etcDir: string;
  binDir: string;
  rootSnapshot: string;
  /** zk's home (the parent of binDir): ~ and $HOME in zk's jobs. */
  homeDir: string;
  user: string;
  uid: number;
};

/** `v` is `dir` or a path inside it. */
function within(v: string, dir: string): boolean {
  const r = path.resolve(v);
  return r === dir || r.startsWith(dir + "/");
}

export function fleetPaths(env: NodeJS.ProcessEnv = process.env): FleetPaths {
  const binDir = env.PITASKER_BIN_DIR || "/home/zk/bin";
  const p: FleetPaths = {
    etcDir: env.PITASKER_ETC_DIR || "/etc",
    binDir,
    rootSnapshot: env.PITASKER_ROOT_CRON_SNAPSHOT || "/var/lib/pitasker/root-crontab",
    homeDir: path.dirname(binDir),
    user: os.userInfo().username,
    uid: os.userInfo().uid,
  };
  if (testMode()) {
    const real = [
      ["PITASKER_ETC_DIR", p.etcDir, (v: string) => path.resolve(v) === "/etc"],
      // The real bin dir only (a checkout under /home/zk must still be able to run the E2E fixtures).
      ["PITASKER_BIN_DIR", p.binDir, (v: string) => within(v, "/home/zk/bin")],
      ["PITASKER_ROOT_CRON_SNAPSHOT", p.rootSnapshot, (v: string) => within(v, "/var/lib/pitasker")],
    ] as const;
    for (const [name, value, isReal] of real) {
      if (!env[name] || isReal(value)) throw new Error(`refusing to read the real ${name} (${value}) in a test: set it to a fixture path`);
    }
  }
  return p;
}

const GUARDED = new Set(["systemctl", "journalctl", "timedatectl", "crontab"]);

function which(name: string): string | null {
  for (const dir of (process.env.PATH || "").split(":")) {
    if (!dir) continue;
    const f = path.join(dir, name);
    try {
      fs.accessSync(f, fs.constants.X_OK);
      return f;
    } catch {
      /* next */
    }
  }
  return null;
}

/** The binary to run for `name`; in tests only the fakes. */
export function toolPath(name: string): string {
  if (!testMode() || !GUARDED.has(name)) return name;
  const fakeDir = process.env.PITASKER_FAKE_BIN_DIR;
  const found = which(name);
  if (!fakeDir || !found || path.dirname(path.resolve(found)) !== path.resolve(fakeDir)) {
    throw new Error(`refusing to run the real ${name} in a test (put the fake from tests/fakes/ first on PATH and set PITASKER_FAKE_BIN_DIR)`);
  }
  if (name === "crontab" && !process.env.FAKE_CRONTAB_FILE) throw new Error("refusing to run crontab in a test without FAKE_CRONTAB_FILE");
  return found;
}

function fakeEnv(): NodeJS.ProcessEnv {
  if (!testMode()) return {};
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith("FAKE_")));
}

export class ToolError extends Error {
  constructor(
    message: string,
    public code: number | string | null,
    public stderr: string,
  ) {
    super(message);
  }
}

export type RunOpts = { timeoutMs?: number; maxBytes?: number; env?: NodeJS.ProcessEnv };

/** execFile(name, argv) → stdout. Rejects with ToolError (exit code + first stderr line). */
export function runTool(name: string, argv: readonly string[], opts: RunOpts = {}): Promise<string> {
  let bin: string;
  try {
    bin = toolPath(name);
  } catch (e) {
    return Promise.reject(e);
  }
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      [...argv],
      {
        timeout: opts.timeoutMs ?? 10_000,
        maxBuffer: opts.maxBytes ?? 4 * 1024 * 1024,
        // A minimal environment (no PiTasker settings reach the tools); in tests
        // the fakes also get their FAKE_* settings.
        env: { PATH: process.env.PATH, LANG: "C.UTF-8", HOME: os.homedir(), ...fakeEnv(), ...(opts.env ?? {}) },
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        if (!err) return resolve(String(stdout));
        const e = err as NodeJS.ErrnoException & { code?: number | string };
        const first = String(stderr).split("\n").find((l) => l.trim()) ?? "";
        const why = e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ? "output too large" : first || e.message;
        reject(new ToolError(`${name} failed: ${why.slice(0, 200)}`, e.code ?? null, String(stderr)));
      },
    );
  });
}

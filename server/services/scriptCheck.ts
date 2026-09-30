// Operator rule: cron-invoked scripts live in /home/zk/bin (bin.git) and are
// committed BEFORE the job goes live. The editor warns when a command breaks it.
//
//   command ─► the program it runs (first word; `bash x.sh`/`sh x`/… → x) ─► checks:
//     outside    not under PITASKER_BIN_DIR
//     missing    under it but no such file
//     untracked  not in bin.git (git ls-files)
//     modified   tracked but has uncommitted changes (git status --porcelain)
// A command that runs a plain system program (echo, pg_dump …) gets no warning.
import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { config } from "../config";

export type ScriptWarning = { code: "outside" | "missing" | "untracked" | "modified" | "not-a-repo"; message: string };
export type ScriptCheck = { script: string | null; warnings: ScriptWarning[] };

const INTERPRETERS = new Set(["bash", "sh", "zsh", "python", "python3", "node", "perl", "env", "nice", "ionice", "flock", "timeout"]);

/** The script a command runs, or null for a bare system program. */
export function scriptOf(command: string, binDir = config.binDir): string | null {
  const words = command.trim().split(/\s+/);
  let i = 0;
  // Skip leading VAR=value assignments and wrappers (nice -n 10, flock -n lock, timeout 60 …).
  while (i < words.length) {
    const w = words[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) {
      i++;
      continue;
    }
    const base = path.basename(w);
    if (INTERPRETERS.has(base)) {
      i++;
      while (i < words.length && (words[i].startsWith("-") || /^\d+[smhd]?$/.test(words[i]))) i++;
      if (base === "flock" && i < words.length && !words[i].includes("/bin/")) i++; // the lock file
      continue;
    }
    break;
  }
  const w = words[i];
  if (!w) return null;
  const expanded = w.replace(/^~(?=\/)/, path.dirname(binDir)).replace(/^\$HOME(?=\/)/, path.dirname(binDir));
  if (expanded.includes("/")) return path.resolve(path.dirname(binDir), expanded);
  // A bare name: if bin/ has it, that's what PATH=/home/zk/bin:… would run.
  const inBin = path.join(binDir, expanded);
  return fs.existsSync(inBin) ? inBin : null;
}

function git(args: string[], cwd: string): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, timeout: 5_000 }, (err, stdout) => resolve({ ok: !err, out: String(stdout) }));
  });
}

export async function checkCommand(command: string, binDir = config.binDir): Promise<ScriptCheck> {
  const script = scriptOf(command, binDir);
  if (!script) return { script: null, warnings: [] };
  const warnings: ScriptWarning[] = [];
  const root = path.resolve(binDir);
  if (!(script === root || script.startsWith(root + path.sep))) {
    warnings.push({ code: "outside", message: `${script} is not in ${binDir}: cron-invoked scripts belong in ${binDir} (bin.git).` });
    return { script, warnings };
  }
  if (!fs.existsSync(script)) {
    warnings.push({ code: "missing", message: `${script} does not exist.` });
    return { script, warnings };
  }
  const rel = path.relative(root, script);
  const repo = await git(["rev-parse", "--is-inside-work-tree"], root);
  if (!repo.ok) {
    warnings.push({ code: "not-a-repo", message: `${binDir} is not a git repository: cannot check that the script is committed.` });
    return { script, warnings };
  }
  const tracked = await git(["ls-files", "--error-unmatch", "--", rel], root);
  if (!tracked.ok) {
    warnings.push({ code: "untracked", message: `${rel} is not committed to bin.git. Commit it before the job goes live.` });
    return { script, warnings };
  }
  const status = await git(["status", "--porcelain", "--", rel], root);
  if (status.ok && status.out.trim()) warnings.push({ code: "modified", message: `${rel} has uncommitted changes in bin.git.` });
  return { script, warnings };
}

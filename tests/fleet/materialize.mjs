#!/usr/bin/env node
// Author:      0xWulf (zk@hexawulf.dev)
// Description: Turn a fleet fixture host (tests/fixtures/fleet/<name>) into a
//              scratch host for tests: the fixture files with @HOME@ replaced
//              by a scratch home, and a scratch git repo as that home's bin/
//              (the bin.git replica). Never touches /etc, /home/zk or a real
//              crontab. Used by the unit tests (import) and scripts/e2e-server.sh (CLI).
//                <out>/fleet/   FAKE_FLEET_DIR (timers, show, journal, timezone …)
//                <out>/fleet/etc                     PITASKER_ETC_DIR
//                <out>/fleet/crontab                 FAKE_CRONTAB_FILE (zk crontab)
//                <out>/fleet/root-crontab            PITASKER_ROOT_CRON_SNAPSHOT
//                <out>/home/bin (git)                PITASKER_BIN_DIR
// Modified:    2026-10-01
// Usage:       node tests/fleet/materialize.mjs <fixture> <out-dir>   # prints the env as KEY=value lines
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Scripts every host's bin.git has (same content + fixed dates → the same HEAD everywhere). */
const BIN_SCRIPTS = ["status-poll", "status-poll2", "backup-db", "dirty-job", "on-boot", "berlin-report", "notes-sync", "nightly", "taipei-morning"];

function copyTree(src, dst, home) {
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dst, name);
    const st = fs.statSync(s);
    if (st.isDirectory()) copyTree(s, d, home);
    else {
      fs.writeFileSync(d, fs.readFileSync(s, "utf8").replaceAll("@HOME@", home).replaceAll("@USER@", os.userInfo().username));
      fs.chmodSync(d, st.mode & 0o777);
    }
  }
}

function git(dir, args, env = {}) {
  execFileSync("git", ["-C", dir, ...args], {
    stdio: "ignore",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "fixture",
      GIT_AUTHOR_EMAIL: "fixture@localhost",
      GIT_COMMITTER_NAME: "fixture",
      GIT_COMMITTER_EMAIL: "fixture@localhost",
      GIT_AUTHOR_DATE: "2026-09-01T00:00:00Z",
      GIT_COMMITTER_DATE: "2026-09-01T00:00:00Z",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      ...env,
    },
  });
}

export function materialize(fixture, out, { binAhead = fixture === "gamma" } = {}) {
  const src = path.join(ROOT, "tests", "fixtures", "fleet", fixture);
  if (!fs.existsSync(src)) throw new Error(`no fixture ${fixture}`);
  fs.rmSync(out, { recursive: true, force: true });
  const home = path.join(out, "home");
  const fleet = path.join(out, "fleet");
  copyTree(src, fleet, home);

  const bin = path.join(home, "bin");
  fs.mkdirSync(bin, { recursive: true });
  for (const s of BIN_SCRIPTS) fs.writeFileSync(path.join(bin, s), `#!/bin/sh\necho ${s}\n`, { mode: 0o755 });
  git(bin, ["init", "-q", "-b", "main"]);
  git(bin, ["add", "-A"]);
  git(bin, ["commit", "-q", "-m", "fixture bin"]);
  if (binAhead) {
    fs.writeFileSync(path.join(bin, "newer-script"), "#!/bin/sh\n", { mode: 0o755 });
    git(bin, ["add", "newer-script"]);
    git(bin, ["commit", "-q", "-m", "newer"], { GIT_COMMITTER_DATE: "2026-09-02T00:00:00Z", GIT_AUTHOR_DATE: "2026-09-02T00:00:00Z" });
  }
  fs.appendFileSync(path.join(bin, "dirty-job"), "# local edit, not committed\n"); // tracked + dirty
  fs.writeFileSync(path.join(bin, "untracked-job"), "#!/bin/sh\n", { mode: 0o755 }); // not in bin.git
  fs.mkdirSync(path.join(home, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(home, "scripts", "outside-bin.sh"), "#!/bin/sh\n", { mode: 0o755 });
  fs.mkdirSync(path.join(home, "logs"), { recursive: true });
  const log = path.join(home, "logs", "status-poll.log");
  fs.writeFileSync(log, "ok\n");
  fs.utimesSync(log, new Date("2026-10-01T01:55:30Z"), new Date("2026-10-01T01:55:30Z"));

  return {
    FAKE_FLEET_DIR: fleet,
    FAKE_CRONTAB_FILE: path.join(fleet, "crontab"),
    PITASKER_ETC_DIR: path.join(fleet, "etc"),
    PITASKER_BIN_DIR: bin,
    PITASKER_ROOT_CRON_SNAPSHOT: path.join(fleet, "root-crontab"),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [fixture, out] = process.argv.slice(2);
  if (!fixture || !out) {
    console.error("usage: materialize.mjs <fixture> <out-dir>");
    process.exit(64);
  }
  const env = materialize(fixture, path.resolve(out));
  for (const [k, v] of Object.entries(env)) console.log(`${k}=${v}`);
}

import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SnapshotSchema, type CrontabSource, type FileSource, type Snapshot, type TimerSource } from "@shared/fleet";
import { collectSnapshot, execStartArgv, parseJournal, parseShow, scriptPath, timerSpecs, usecToIso } from "../../server/fleet/collector";
import { fleetPaths, toolPath } from "../../server/fleet/tools";
// @ts-expect-error — plain ESM test helper
import { materialize } from "../fleet/materialize.mjs";

const NOW = new Date("2026-10-01T02:00:00Z"); // 10:00 Taipei, 04:00 Berlin (CEST)
const KEYS = ["FAKE_FLEET_DIR", "FAKE_CRONTAB_FILE", "PITASKER_ETC_DIR", "PITASKER_BIN_DIR", "PITASKER_ROOT_CRON_SNAPSHOT"];
const saved: Record<string, string | undefined> = {};
let out = "";

function host(fixture: string) {
  out = fs.mkdtempSync(path.join(os.tmpdir(), `pitasker-fleet-${fixture}-`));
  const env = materialize(fixture, out) as Record<string, string>;
  Object.assign(process.env, env);
  return env;
}
const collect = () => collectSnapshot({ version: "2.1.0-test", now: NOW });
const crontab = (s: Snapshot, owner: "zk" | "root") => s.sources.find((x): x is CrontabSource => x.kind === "crontab" && x.owner === owner)!;
const timer = (s: Snapshot, unit: string) => s.sources.find((x): x is TimerSource => x.kind === "timer" && x.unit === unit)!;
const zkEntry = (s: Snapshot, needle: string) => crontab(s, "zk").entries.find((e) => e.command.includes(needle))!;

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  delete process.env.FAKE_JOURNAL_FAIL;
  if (out) fs.rmSync(out, { recursive: true, force: true });
});

describe("alpha (systemd 259, Asia/Taipei)", () => {
  it("produces a valid snapshot with every source and no errors", async () => {
    host("alpha");
    const s = await collect();
    expect(SnapshotSchema.parse(s)).toBeTruthy();
    expect(s.tz).toBe("Asia/Taipei");
    expect(s.errors).toEqual([]);
    expect(s.sources.map((x) => (x.kind === "crontab" ? `crontab:${x.owner}` : x.kind === "timer" ? `timer:${x.scope}:${x.unit}` : x.kind === "run-parts" ? x.dir : `${x.kind}:${x.file}`))).toEqual([
      "crontab:zk",
      "crontab:root",
      "etc-crontab:crontab",
      "cron.d:e2scrub_all",
      "cron.d:sysstat",
      "cron.d:zk-extra",
      "cron.hourly",
      "cron.daily",
      "timer:system:logrotate.timer",
      "timer:system:fstrim.timer",
      "timer:system:pitasker-root-cron-snapshot.timer",
      "timer:user:notes-sync.timer",
    ]);
  });

  it("zk crontab: entries, hash of the raw text, next runs in the host zone", async () => {
    const env = host("alpha");
    const s = await collect();
    const zk = crontab(s, "zk");
    const raw = fs.readFileSync(env.FAKE_CRONTAB_FILE, "utf8");
    expect(zk.hash).toBe(require("crypto").createHash("sha256").update(raw).digest("hex"));
    expect(zk.entries).toHaveLength(9);
    const poll = zkEntry(s, "status-poll >>");
    expect(poll.nextRuns).toEqual(["2026-10-01T02:05:00.000Z", "2026-10-01T02:10:00.000Z", "2026-10-01T02:15:00.000Z"]);
    // 0 3 * * * in Asia/Taipei = 19:00Z the day before
    expect(zkEntry(s, "backup-db").nextRuns[0]).toBe("2026-10-01T19:00:00.000Z");
    expect(zkEntry(s, "on-boot")).toMatchObject({ schedule: "@reboot", nextRuns: [] });
  });

  it("honours CRON_TZ for the lines below it (Europe/Berlin, CEST)", async () => {
    host("alpha");
    const e = zkEntry(await collect(), "berlin-report");
    expect(e.env).toEqual({ tz: "Europe/Berlin" });
    expect(e.nextRuns[0]).toBe("2026-10-01T07:00:00.000Z"); // 09:00 CEST
  });

  it("disabled lines are listed, marked, with no next runs", async () => {
    host("alpha");
    const e = zkEntry(await collect(), "old-sync");
    expect(e).toMatchObject({ disabled: true, nextRuns: [], schedule: "*/10 * * * *" });
  });

  it("redacts secrets in commands, lines and env values before they leave", async () => {
    host("alpha");
    const s = await collect();
    const json = JSON.stringify(s);
    for (const secret of ["supersecret-token-value", "abc123def", "hcpingtoken123", "hunter2", "abcdef123456"]) expect(json).not.toContain(secret);
    expect(zkEntry(s, "backup-db").command).toContain("API_KEY=[REDACTED]");
    expect(zkEntry(s, "backup-db").line).toContain("API_KEY=[REDACTED]");
    expect(crontab(s, "zk").envLines).toContainEqual({ name: "HC_TOKEN", value: "[REDACTED]" });
    expect(crontab(s, "zk").envLines).toContainEqual({ name: "MAILTO", value: '""' });
    expect(timer(s, "notes-sync.timer").command).toContain("--token=[REDACTED]");
  });

  it("last run from the cron journal (newest start), else the log file's mtime", async () => {
    host("alpha");
    const s = await collect();
    expect(zkEntry(s, "status-poll >>").lastRun).toEqual({ at: "2026-10-01T01:55:00.000Z", source: "journal" });
    expect(zkEntry(s, "backup-db").lastRun).toEqual({ at: "2026-09-30T22:00:00.000Z", source: "journal" });
    expect(zkEntry(s, "dirty-job").lastRun).toBeUndefined();
    const etc = s.sources.find((x): x is FileSource => x.kind === "etc-crontab")!;
    expect(etc.entries[0]).toMatchObject({ user: "root", lastRun: { source: "journal", at: "2026-10-01T01:17:00.000Z" } });
  });

  it("script detection: in bin, tracked, dirty, untracked, missing, outside bin, none for packages", async () => {
    const env = host("alpha");
    const s = await collect();
    const bin = env.PITASKER_BIN_DIR;
    expect(zkEntry(s, "status-poll >>").script).toEqual({ path: `${bin}/status-poll`, exists: true, inBin: true, tracked: true, dirty: false });
    expect(zkEntry(s, "dirty-job").script).toMatchObject({ tracked: true, dirty: true });
    expect(zkEntry(s, "untracked-job").script).toMatchObject({ path: `${bin}/untracked-job`, inBin: true, tracked: false });
    expect(zkEntry(s, "old-sync").script).toMatchObject({ exists: false, inBin: true, tracked: false });
    expect(zkEntry(s, "outside-bin").script).toMatchObject({ inBin: false, exists: true, tracked: null });
    expect(zkEntry(s, "curl").script).toBeUndefined();
    const e2 = s.sources.find((x): x is FileSource => x.kind === "cron.d" && x.file === "e2scrub_all")!;
    expect(e2.entries.every((e) => !e.script || !e.script.inBin)).toBe(true);
    expect(s.bin).toMatchObject({ dirty: true, path: bin });
    expect(s.bin!.head).toMatch(/^[0-9a-f]{40}$/);
  });

  it("system crontabs: the user field, cron.d name rules, env values redacted", async () => {
    host("alpha");
    const s = await collect();
    const etc = s.sources.find((x): x is FileSource => x.kind === "etc-crontab")!;
    expect(etc.entries.map((e) => [e.schedule, e.user])).toEqual([
      ["17 * * * *", "root"],
      ["25 6 * * *", "root"],
      ["47 6 * * 7", "root"],
      ["52 6 1 * *", "root"],
    ]);
    const files = s.sources.filter((x): x is FileSource => x.kind === "cron.d").map((x) => x.file);
    expect(files).toEqual(["e2scrub_all", "sysstat", "zk-extra"]); // not .placeholder, not certbot.dpkg-old
    const zkExtra = s.sources.find((x): x is FileSource => x.kind === "cron.d" && x.file === "zk-extra")!;
    expect(zkExtra.envLines).toEqual([{ name: "DB_PASSWORD", value: "[REDACTED]" }]);
    expect(zkExtra.entries[0]).toMatchObject({ user: "zk", script: { inBin: true, tracked: true } });
  });

  it("run-parts: executable, run-parts-named scripts only", async () => {
    host("alpha");
    const s = await collect();
    expect(s.sources.filter((x) => x.kind === "run-parts")).toEqual([
      { kind: "run-parts", dir: "cron.hourly", scripts: [] },
      { kind: "run-parts", dir: "cron.daily", scripts: ["logrotate", "man-db"] },
    ]);
  });

  it("root crontab from the snapshot file, with its age", async () => {
    const env = host("alpha");
    fs.utimesSync(env.PITASKER_ROOT_CRON_SNAPSHOT, new Date("2026-10-01T01:45:00Z"), new Date("2026-10-01T01:45:00Z"));
    const root = crontab(await collect(), "root");
    expect(root.snapshotAt).toBe("2026-10-01T01:45:00.000Z");
    expect(root.entries.map((e) => [e.schedule, e.user])).toEqual([
      ["0 2 * * 0", "root"],
      ["@reboot", "root"],
    ]);
  });

  it("timers (259): next/last from the µs timestamps (never left/passed), calendar, service result", async () => {
    host("alpha");
    const s = await collect();
    expect(timer(s, "logrotate.timer")).toMatchObject({
      scope: "system",
      activates: "logrotate.service",
      calendar: ["OnCalendar=*-*-* 00:00:00"],
      next: "2026-10-01T00:00:00.000Z",
      last: "2026-09-30T00:00:00.123Z",
      result: "success",
      exitStatus: 0,
      user: "root",
      command: "/usr/sbin/logrotate /etc/logrotate.conf",
    });
    expect(timer(s, "fstrim.timer")).toMatchObject({ last: null, next: "2026-10-05T00:00:00.000Z" });
    expect(timer(s, "pitasker-root-cron-snapshot.timer")).toMatchObject({ next: null, calendar: ["OnUnitActiveSec=15min", "OnBootSec=2min"] });
    expect(timer(s, "notes-sync.timer")).toMatchObject({ scope: "user", result: "exit-code", exitStatus: 2, user: os.userInfo().username, script: { inBin: true, tracked: true } });
  });
});

describe("beta (systemd 255, Europe/Berlin)", () => {
  it("255 timers with 0 = none; a missing root snapshot is an error, not a failure", async () => {
    host("beta");
    const s = await collect();
    expect(SnapshotSchema.parse(s)).toBeTruthy();
    expect(s.tz).toBe("Europe/Berlin");
    expect(timer(s, "certbot.timer")).toMatchObject({ next: null, last: null, calendar: ["OnCalendar=*-*-* 00,12:00:00"] });
    expect(timer(s, "logrotate.timer").next).toBe("2026-10-01T00:00:00.000Z");
    expect(s.errors).toEqual([{ source: "root crontab", message: expect.stringContaining("no root crontab snapshot") }]);
    expect(s.sources.some((x) => x.kind === "crontab" && x.owner === "root")).toBe(false);
  });

  it("next runs in Europe/Berlin across the DST change", async () => {
    host("beta");
    const s = await collectSnapshot({ version: "t", now: new Date("2026-10-24T12:00:00Z") });
    const nightly = zkEntry(s, "nightly");
    // 02:30 CEST on the 25th (the repeated hour runs once), then 02:30 CET
    expect(nightly.nextRuns.slice(0, 2)).toEqual(["2026-10-25T00:30:00.000Z", "2026-10-26T01:30:00.000Z"]);
  });

  it("the cron.d certbot line gets no script", async () => {
    host("beta");
    const c = (await collect()).sources.find((x): x is FileSource => x.kind === "cron.d" && x.file === "certbot")!;
    expect(c.entries).toHaveLength(1);
    expect(c.entries[0].script).toBeUndefined();
    expect(c.entries[0].nextRuns[0]).toBe("2026-10-01T10:00:00.000Z"); // 12:00 CEST
  });
});

describe("gamma (Asia/Singapore) and delta (Etc/UTC)", () => {
  it("Asia/Singapore, with a TZ= line switching the zone for later lines", async () => {
    host("gamma");
    const s = await collect();
    expect(s.tz).toBe("Asia/Singapore");
    expect(zkEntry(s, "status-poll").nextRuns[0]).toBe("2026-10-02T00:00:00.000Z"); // Fri 08:00 SGT
    expect(zkEntry(s, "taipei-morning")).toMatchObject({ env: { tz: "Asia/Taipei" }, nextRuns: expect.arrayContaining(["2026-10-02T00:00:00.000Z"]) });
  });

  it("delta: no timedated → /etc/timezone; no zk crontab; no user bus → an error for that source only", async () => {
    host("delta");
    const s = await collect();
    expect(s.tz).toBe("Etc/UTC");
    expect(crontab(s, "zk")).toMatchObject({ entries: [], hash: expect.any(String) });
    expect(crontab(s, "root").entries).toEqual([]);
    expect(s.errors.map((e) => e.source)).toEqual(["user timers"]);
  });

  it("an unreadable journal is one error; entries fall back to log files", async () => {
    host("alpha");
    process.env.FAKE_JOURNAL_FAIL = "1";
    const s = await collect();
    expect(s.errors.map((e) => e.source)).toEqual(["journal"]);
    expect(zkEntry(s, "status-poll >>").lastRun).toEqual({ at: "2026-10-01T01:55:30.000Z", source: "logfile" });
  });
});

describe("guards: tests never reach the real system", () => {
  it("refuses the real /etc, /home/zk/bin and /var/lib/pitasker", () => {
    expect(() => fleetPaths({ ...process.env, PITASKER_ETC_DIR: "/etc" })).toThrow(/refusing/);
    expect(() => fleetPaths({ ...process.env, PITASKER_BIN_DIR: "/home/zk/bin" })).toThrow(/refusing/);
    expect(() => fleetPaths({ ...process.env, PITASKER_ROOT_CRON_SNAPSHOT: "/var/lib/pitasker/root-crontab" })).toThrow(/refusing/);
    const env = { ...process.env };
    delete env.PITASKER_ETC_DIR;
    expect(() => fleetPaths(env)).toThrow(/refusing/);
  });

  it("refuses systemctl / journalctl / timedatectl that aren't the fakes", () => {
    const saved = process.env.PITASKER_FAKE_BIN_DIR;
    process.env.PITASKER_FAKE_BIN_DIR = "/usr/bin";
    try {
      for (const t of ["systemctl", "journalctl", "timedatectl"]) expect(() => toolPath(t)).toThrow(/refusing to run the real/);
    } finally {
      process.env.PITASKER_FAKE_BIN_DIR = saved;
    }
    expect(toolPath("systemctl")).toContain("pitasker-unit-");
  });
});

describe("parsers", () => {
  it("parseShow keeps repeated keys and splits units", () => {
    const m = parseShow("Id=a.timer\nTimersCalendar={ OnCalendar=daily ; next_elapse=x }\nTimersCalendar={ OnCalendar=Mon 10:00 ; next_elapse=y }\n\nId=b.timer\nTimersMonotonic={ OnBootUSec=5min ; next_elapse=0 }\n");
    expect(timerSpecs(m.get("a.timer")!.get("TimersCalendar"))).toEqual(["OnCalendar=daily", "OnCalendar=Mon 10:00"]);
    expect(timerSpecs(m.get("b.timer")!.get("TimersMonotonic"))).toEqual(["OnBootSec=5min"]);
  });

  it("execStartArgv", () => {
    expect(execStartArgv(["{ path=/bin/x ; argv[]=/bin/x -a ; b ; ignore_errors=no ; start_time=[n/a] }"])).toBe("/bin/x -a ; b");
    expect(execStartArgv([""])).toBeNull();
  });

  it("usecToIso: 0, null and garbage are none", () => {
    expect(usecToIso(0)).toBeNull();
    expect(usecToIso(null)).toBeNull();
    expect(usecToIso("x")).toBeNull();
    expect(usecToIso(1790812800000000)).toBe("2026-10-01T00:00:00.000Z");
    expect(usecToIso("1790812800000000")).toBe("2026-10-01T00:00:00.000Z");
  });

  it("parseJournal: newest start per user and command; ignores non-CMD and binary messages", () => {
    const j = parseJournal(
      [
        '{"__REALTIME_TIMESTAMP":"1000000","MESSAGE":"(zk) CMD (a)"}',
        '{"__REALTIME_TIMESTAMP":"3000000","MESSAGE":"(zk) CMD (a)"}',
        '{"__REALTIME_TIMESTAMP":"2000000","MESSAGE":"(root) CMD (b)"}',
        '{"__REALTIME_TIMESTAMP":"2000000","MESSAGE":[1,2]}',
        "garbage",
      ].join("\n"),
    );
    expect(j.get("zk")!.get("a")).toBe(3000);
    expect(j.get("root")!.get("b")).toBe(2000);
  });

  it.each([
    ["/home/zk/bin/x --y", "/home/zk", "/home/zk/bin/x"],
    ["cd /tmp && ~/bin/x", "/home/zk", "/home/zk/bin/x"],
    ["cd /tmp; bash $HOME/bin/job.sh", "/home/zk", "/home/zk/bin/job.sh"],
    ["FOO=1 nice -n 10 python3 /opt/tool/run.py", "/home/zk", "/opt/tool/run.py"],
    ["flock -n /tmp/l /home/zk/bin/x", "/home/zk", "/home/zk/bin/x"],
    ["timeout 60 ${HOME}/bin/y", "/home/zk", "/home/zk/bin/y"],
    ["run-parts --report /etc/cron.hourly", "/home/zk", null],
    ["test -x /usr/sbin/anacron || x", "/home/zk", null],
    ["~/bin/x", null, null],
  ])("scriptPath(%s)", (cmd, home, want) => expect(scriptPath(cmd, home)).toBe(want));
});

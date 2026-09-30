import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  DisabledLineError,
  derivedId,
  listJobs,
  parseCrontab,
  removeJob,
  serializeCrontab,
  upsertJob,
} from "../../server/crontab/document";

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "..", "fixtures", name), "utf8");
const CURATED = fixture("crontab.curated");

describe("crontab round-trip", () => {
  const cases: Record<string, string> = {
    curated: CURATED,
    "no final newline": fixture("crontab.nonewline"),
    empty: "",
    "only newline": "\n",
    "blank lines only": "\n\n\n",
    crlf: "MAILTO=x\r\n*/5 * * * * /bin/true\r\n",
    "trailing spaces": "*/5 * * * * /bin/true   \n  # indented comment \n",
    "invalid line kept": "this is not cron\n61 * * * * /bin/false\n",
    "orphan marker": "# PITASKER_ID:abc\n\n0 * * * * /bin/x\n",
    tabs: "0\t3\t*\t*\t*\t/bin/tabbed\targ\n",
  };
  for (const [name, text] of Object.entries(cases)) {
    it(`is byte-identical: ${name}`, () => {
      expect(serializeCrontab(parseCrontab(text))).toBe(text);
    });
  }
});

describe("classification", () => {
  const doc = parseCrontab(CURATED);
  const kinds = (k: string) => doc.lines.filter((l) => l.kind === k);

  it("keeps env lines, comments and blanks", () => {
    expect(kinds("env").map((l) => l.envName)).toEqual(["SHELL", "PATH", "MAILTO", "TZ"]);
    expect(kinds("comment").length).toBeGreaterThanOrEqual(8);
    expect(kinds("blank").length).toBe(3);
  });

  it("finds jobs including macros and % escapes", () => {
    const jobs = listJobs(doc).filter((j) => !j.disabled);
    expect(jobs.map((j) => j.schedule)).toEqual([
      "*/5 * * * *",
      "*/15 * * * *",
      "4 7 * * *",
      "@reboot",
      "@daily",
      "0 3 * * 1-5",
      "30 2 1 * *",
    ]);
    const report = jobs.find((j) => j.command.includes("report --date"))!;
    expect(report.command).toBe('/home/zk/bin/report --date "$(date +\\%Y-\\%m-\\%d)" > /home/zk/logs/report-$(date +\\%F).log 2>&1');
  });

  it("keeps the command's own whitespace", () => {
    const disk = listJobs(doc).find((j) => j.command.startsWith("/home/zk/bin/disk-watch"))!;
    expect(disk.command).toBe("/home/zk/bin/disk-watch --quiet");
  });

  it("recognises disabled lines but not ordinary comments", () => {
    const disabled = listJobs(doc).filter((j) => j.disabled);
    expect(disabled.map((j) => `${j.schedule} ${j.command}`)).toEqual([
      "*/10 * * * * /home/zk/bin/old-sync",
      "0 4 * * 0 /home/zk/bin/weekly-legacy",
    ]);
  });

  it("attaches PiTasker markers to the line below", () => {
    const backup = listJobs(doc).find((j) => j.command.includes("pg-backup"))!;
    expect(backup).toMatchObject({ managed: true, id: "0b5a2c1e-6f7d-4e3a-9c1b-2a3d4e5f6a7b", name: "Nightly DB backup" });
    expect(backup.markerIdx).toHaveLength(2);
    const poll = listJobs(doc).find((j) => j.command.includes("linuxsvr-status-poll"))!;
    expect(poll.managed).toBe(false);
    expect(poll.id).toBe(derivedId(poll.command));
  });

  it("gives unmarked lines stable ids across parses", () => {
    const a = listJobs(parseCrontab(CURATED)).map((j) => j.id);
    const b = listJobs(parseCrontab(CURATED)).map((j) => j.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });

  it("gives a repeated command a different id", () => {
    const jobs = listJobs(parseCrontab("0 1 * * * /bin/x\n0 2 * * * /bin/x\n"));
    expect(jobs[0].id).not.toBe(jobs[1].id);
  });
});

describe("edits touch only their own lines", () => {
  const doc = parseCrontab(CURATED);

  it("upsert of an unchanged unmarked line is a no-op (no markers added)", () => {
    const poll = listJobs(doc).find((j) => j.command.includes("linuxsvr-status-poll"))!;
    const next = upsertJob(doc, { id: poll.id, schedule: poll.schedule, command: poll.command, name: "Status poll" });
    expect(next).toBe(doc);
    expect(serializeCrontab(next)).toBe(CURATED);
  });

  it("upsert of an unchanged managed line is a no-op", () => {
    const next = upsertJob(doc, {
      id: "0b5a2c1e-6f7d-4e3a-9c1b-2a3d4e5f6a7b",
      schedule: "4 7 * * *",
      command: "/home/zk/bin/pg-backup pitasker >> /home/zk/logs/pg-backup.log 2>&1",
      name: "Nightly DB backup",
    });
    expect(serializeCrontab(next)).toBe(CURATED);
  });

  it("changing a schedule rewrites that line (plus markers) and nothing else", () => {
    const poll = listJobs(doc).find((j) => j.command.includes("linuxsvr-status-poll"))!;
    const next = serializeCrontab(upsertJob(doc, { id: poll.id, schedule: "*/10 * * * *", command: poll.command, name: "Status poll" }));
    const expected = CURATED.replace(
      "*/5 * * * * /home/zk/bin/linuxsvr-status-poll",
      `# PITASKER_ID:${poll.id}\n# PITASKER_COMMENT:Status poll\n*/10 * * * * /home/zk/bin/linuxsvr-status-poll`,
    );
    expect(next).toBe(expected);
  });

  it("renaming a managed task rewrites only its comment marker, keeping the job line's spacing", () => {
    const d = parseCrontab("# PITASKER_ID:x1\n# PITASKER_COMMENT:Old\n0  1 * * *  /bin/a\n");
    const next = serializeCrontab(upsertJob(d, { id: "x1", schedule: "0 1 * * *", command: "/bin/a", name: "New" }));
    expect(next).toBe("# PITASKER_ID:x1\n# PITASKER_COMMENT:New\n0  1 * * *  /bin/a\n");
  });

  it("a new job is appended with markers", () => {
    const next = serializeCrontab(upsertJob(doc, { id: "new-1", schedule: "@hourly", command: "/home/zk/bin/new", name: "New\njob" }));
    expect(next).toBe(`${CURATED}# PITASKER_ID:new-1\n# PITASKER_COMMENT:New job\n@hourly /home/zk/bin/new\n`);
  });

  it("appending to a crontab without a final newline keeps its last line intact", () => {
    const text = fixture("crontab.nonewline");
    const next = serializeCrontab(upsertJob(parseCrontab(text), { id: "n", schedule: "0 0 * * *", command: "/bin/n" }));
    expect(next).toBe(`${text}\n# PITASKER_ID:n\n0 0 * * * /bin/n\n`);
  });

  it("never re-enables a disabled line", () => {
    const legacy = listJobs(doc).find((j) => j.command.includes("weekly-legacy"))!;
    expect(() => upsertJob(doc, { id: legacy.id, schedule: legacy.schedule, command: legacy.command })).toThrow(DisabledLineError);
  });

  it("removing a managed job drops its markers and line only", () => {
    const next = serializeCrontab(removeJob(doc, "0b5a2c1e-6f7d-4e3a-9c1b-2a3d4e5f6a7b"));
    expect(next).toBe(
      CURATED.replace(
        "# PITASKER_ID:0b5a2c1e-6f7d-4e3a-9c1b-2a3d4e5f6a7b\n# PITASKER_COMMENT:Nightly DB backup\n4 7 * * * /home/zk/bin/pg-backup pitasker >> /home/zk/logs/pg-backup.log 2>&1\n",
        "",
      ),
    );
  });

  it("removing an unknown id is a no-op", () => {
    expect(removeJob(doc, "nope")).toBe(doc);
  });

  it("finds an unmarked line by command when the id is unknown", () => {
    const next = serializeCrontab(removeJob(doc, "unknown", "/home/zk/bin/rotate-reports"));
    expect(next).toBe(CURATED.replace("@daily /home/zk/bin/rotate-reports\n", ""));
  });
});

describe("system crontabs (/etc/crontab, /etc/cron.d: a user field)", () => {
  const fleet = path.join(__dirname, "..", "fixtures", "fleet");
  const files = ["alpha/etc/crontab", "alpha/etc/cron.d/e2scrub_all", "alpha/etc/cron.d/sysstat", "alpha/etc/cron.d/zk-extra", "beta/etc/cron.d/certbot", "beta/etc/crontab"];
  for (const f of files) {
    it(`round-trips byte-identically: ${f}`, () => {
      const text = fs.readFileSync(path.join(fleet, f), "utf8");
      expect(serializeCrontab(parseCrontab(text, { system: true }))).toBe(text);
    });
  }

  it("reads the user field (tabs, macros, disabled lines)", () => {
    const doc = parseCrontab(
      "17 *\t* * *\troot\tcd / && run-parts --report /etc/cron.hourly\n@reboot zk /home/zk/bin/x\n# 0 3 * * * www-data /usr/bin/php cron.php\n5 * * * * bad user! x\n",
      { system: true },
    );
    expect(doc.lines.map((l) => [l.kind, l.schedule, l.user, l.command])).toEqual([
      ["job", "17 * * * *", "root", "cd / && run-parts --report /etc/cron.hourly"],
      ["job", "@reboot", "zk", "/home/zk/bin/x"],
      ["disabled", "0 3 * * *", "www-data", "/usr/bin/php cron.php"],
      ["job", "5 * * * *", "bad", "user! x"],
    ]);
  });

  it("a line with no command after the user is invalid", () => {
    expect(parseCrontab("0 * * * * root\n", { system: true }).lines[0].kind).toBe("invalid");
  });

  it("user mode is unchanged: the user field stays part of the command", () => {
    const [l] = parseCrontab("17 * * * * root run-parts x\n").lines;
    expect(l).toMatchObject({ kind: "job", command: "root run-parts x" });
    expect(l.user).toBeUndefined();
  });
});

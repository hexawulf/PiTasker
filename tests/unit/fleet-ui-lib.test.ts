import { describe, expect, it } from "vitest";
import type { FleetResponse } from "@shared/fleet";
import { applyFilters, buildRows, describeTimer, filtersToSearch, parseFilters } from "@/lib/fleet";

const data: FleetResponse = {
  generatedAt: "2026-10-01T02:00:00.000Z",
  binMaster: "b",
  hints: [
    { kind: "same-job", message: "Same job on 2 hosts (A, B)", targets: ["local:e1", "b:e2"] },
    { kind: "bin-differs", message: "bin.git at 1234567", targets: ["b"] },
    { kind: "disabled", message: "Disabled", targets: ["b:e3"] },
  ],
  hosts: [
    {
      id: "local", label: "A", local: true, production: false, status: "online", lastSeen: null, version: "2.1.0", tz: "Asia/Taipei", binHead: null, asOf: null,
      snapshot: {
        host: "a", tz: "Asia/Taipei", generatedAt: "x", agentVersion: "2.1.0", bin: null, errors: [],
        sources: [
          { kind: "crontab", owner: "zk", hash: "h", entries: [{ id: "e1", line: "*/5 * * * * /x", schedule: "*/5 * * * *", command: "/home/zk/bin/poll", disabled: false, nextRuns: ["2026-10-01T02:05:00.000Z"] }] },
          { kind: "run-parts", dir: "cron.daily", scripts: ["logrotate"] },
        ],
      },
    },
    {
      id: "b", label: "B", local: false, production: true, status: "offline", lastSeen: null, version: "2.1.0", tz: "Europe/Berlin", binHead: "1234567", asOf: "2026-09-30T00:00:00.000Z",
      snapshot: {
        host: "b", tz: "Europe/Berlin", generatedAt: "x", agentVersion: "2.1.0", bin: null, errors: [],
        sources: [
          { kind: "crontab", owner: "zk", hash: "h", entries: [
            { id: "e2", line: "", schedule: "@reboot", command: "~/bin/poll", disabled: false, nextRuns: [] },
            { id: "e3", line: "", schedule: "0 1 * * *", command: "/home/zk/bin/old", disabled: true, nextRuns: [] },
          ] },
          { kind: "timer", scope: "system", unit: "logrotate.timer", activates: "logrotate.service", calendar: ["OnCalendar=*-*-* 00:00:00"], next: "2026-10-01T22:00:00.000Z", last: null, result: "exit-code", exitStatus: 1, user: "root", command: "/usr/sbin/logrotate" },
        ],
      },
    },
  ],
};

describe("fleet page model", () => {
  it("one row per entry, run-parts script and timer, with hints and host state", () => {
    const rows = buildRows(data);
    expect(rows.map((r) => [r.hostId, r.group, r.schedule])).toEqual([
      ["local", "zk", "every 5 min"],
      ["local", "system", "daily (run-parts / anacron)"],
      ["b", "zk", "at boot"],
      ["b", "zk", "daily 01:00"],
      ["b", "timer", "daily 00:00"],
    ]);
    expect(rows[0]).toMatchObject({ editableHere: true, hints: [{ kind: "same-job" }] });
    expect(rows[2]).toMatchObject({ editableHere: false, hostDown: true, hostTz: "Europe/Berlin" });
    expect(rows[4].result).toBe("exit-code (exit 1)");
  });

  it("filters: host, source, hint (bin-differs by host), search", () => {
    const rows = buildRows(data);
    const bin = new Set(["b"]);
    const f = parseFilters("");
    expect(applyFilters(rows, { ...f, host: "b" }, bin)).toHaveLength(3);
    expect(applyFilters(rows, { ...f, source: "timer" }, bin)).toHaveLength(1);
    expect(applyFilters(rows, { ...f, hint: "same-job" }, bin).map((r) => r.key)).toEqual(["local:e1", "b:e2"]);
    expect(applyFilters(rows, { ...f, hint: "bin-differs" }, bin)).toHaveLength(3);
    expect(applyFilters(rows, { ...f, hint: "disabled" }, bin).map((r) => r.command)).toEqual(["/home/zk/bin/old"]);
    expect(applyFilters(rows, { ...f, q: "LOGROTATE" }, bin)).toHaveLength(2);
    expect(applyFilters(rows, { ...f, q: "*/5" }, bin)).toHaveLength(1);
  });

  it("filters round-trip through the URL; junk is ignored", () => {
    const f = { view: "jobs" as const, host: "b", source: "timer" as const, hint: "not-in-bin" as const, q: "poll x" };
    expect(parseFilters(filtersToSearch(f))).toEqual(f);
    expect(filtersToSearch(parseFilters(""))).toBe("");
    expect(parseFilters("?view=x&source=etc&hint=nope")).toEqual({ view: "hosts", host: "", source: "", hint: "", q: "" });
  });

  it.each([
    ["OnCalendar=*-*-* 00:00:00", "daily 00:00"],
    ["OnCalendar=Mon *-*-* 03:30:00", "Mon 03:30"],
    ["OnCalendar=Mon..Fri *-*-* 08:00", "Mon–Fri 08:00"],
    ["OnCalendar=*-*-* 00,12:00:00", "daily at 00:00, 12:00"],
    ["OnCalendar=weekly", "weekly"],
    ["OnCalendar=*-*-01 04:00:00", "*-*-01 04:00:00"],
    ["OnUnitActiveSec=15min", "every 15min"],
    ["OnBootSec=2min", "2min after boot"],
  ])("describeTimer(%s)", (spec, text) => expect(describeTimer(spec)).toBe(text));
});

import { describe, expect, it } from "vitest";
import { describeCron, isValidCron, nextRuns, parseCron, toFiveFields } from "@shared/cron";

describe("parseCron", () => {
  it.each([
    "* * * * *",
    "*/5 * * * *",
    "0 3 * * 1-5",
    "0,30 8-18/2 1,15 jan-jun mon-fri",
    "0 0 * * 7",
    "@reboot",
    "@daily",
    "@HOURLY",
  ])("accepts %s", (e) => expect(isValidCron(e)).toBe(true));

  it.each([
    ["", /empty/],
    ["* * * *", /5 fields/],
    ["60 * * * *", /outside/],
    ["* 24 * * *", /outside/],
    ["* * 0 * *", /outside/],
    ["5/10 * * * *", /step needs/],
    ["10-5 * * * *", /backwards/],
    ["*/0 * * * *", /step/],
    ["@often", /Unknown macro/],
    ["a * * * *", /not a number/],
  ])("rejects %j", (e, msg) => {
    const p = parseCron(e);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.error).toMatch(msg);
  });

  it("expands macros for node-cron, but not @reboot", () => {
    expect(toFiveFields("@daily")).toBe("0 0 * * *");
    expect(toFiveFields("@reboot")).toBeNull();
    expect(toFiveFields("*/5  *  * * *")).toBe("*/5 * * * *");
  });
});

describe("describeCron", () => {
  it.each([
    ["*/5 * * * *", "every 5 min"],
    ["* * * * *", "every minute"],
    ["0 * * * *", "hourly"],
    ["15 * * * *", "hourly at :15"],
    ["4 7 * * *", "daily 07:04"],
    ["0 6,18 * * *", "daily 06:00, 18:00"],
    ["0 */4 * * *", "every 4 h at :00"],
    ["0 8 * * 1-5", "weekdays 08:00"],
    ["0 10 * * 0,6", "weekends 10:00"],
    ["0 3 * * 1", "Mon 03:00"],
    ["0 5 1 * *", "monthly on day 1 at 05:00"],
    ["0 0 1 1 *", "yearly on Jan 1 at 00:00"],
    ["@reboot", "at boot"],
    ["@daily", "daily 00:00"],
    ["7 3 */2 * *", "7 3 */2 * *"],
  ])("%s → %s", (e, text) => expect(describeCron(e)).toBe(text));
});

describe("nextRuns", () => {
  const from = new Date("2026-09-30T02:35:10Z"); // 10:35 in Taipei (UTC+8, no DST)

  it("uses the host time zone", () => {
    const runs = nextRuns("4 7 * * *", "Asia/Taipei", 2, from);
    expect(runs.map((d) => d.toISOString())).toEqual(["2026-09-30T23:04:00.000Z", "2026-10-01T23:04:00.000Z"]);
    const utc = nextRuns("4 7 * * *", "UTC", 1, from);
    expect(utc[0].toISOString()).toBe("2026-09-30T07:04:00.000Z");
  });

  it("every 5 minutes", () => {
    expect(nextRuns("*/5 * * * *", "UTC", 3, from).map((d) => d.toISOString())).toEqual([
      "2026-09-30T02:40:00.000Z",
      "2026-09-30T02:45:00.000Z",
      "2026-09-30T02:50:00.000Z",
    ]);
  });

  it("day-of-month OR day-of-week when both are restricted (Vixie)", () => {
    // 1st of the month or any Monday; 2026-10-01 is a Thursday, 2026-10-05 a Monday.
    const runs = nextRuns("0 0 1 * 1", "UTC", 2, from).map((d) => d.toISOString().slice(0, 10));
    expect(runs).toEqual(["2026-10-01", "2026-10-05"]);
  });

  it("finds a yearly run and handles Feb 29", () => {
    expect(nextRuns("0 0 29 2 *", "UTC", 1, from)[0].toISOString()).toBe("2028-02-29T00:00:00.000Z");
  });

  it("has no runs for @reboot or invalid", () => {
    expect(nextRuns("@reboot", "UTC", 3, from)).toEqual([]);
    expect(nextRuns("nope", "UTC", 3, from)).toEqual([]);
  });

  it("crosses a DST change (Europe/Berlin, 2026-10-25)", () => {
    const runs = nextRuns("30 2 * * *", "Europe/Berlin", 2, new Date("2026-10-24T12:00:00Z"));
    // 02:30 CEST (UTC+2) on the 25th happens (the hour repeats); then 02:30 CET.
    expect(runs[0].toISOString()).toBe("2026-10-25T00:30:00.000Z");
    expect(runs[1].toISOString()).toBe("2026-10-26T01:30:00.000Z");
  });
});

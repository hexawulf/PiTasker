import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Snapshot } from "@shared/fleet";
import { collectSnapshot } from "../../server/fleet/collector";
import { computeHints, normalizeCommand } from "../../server/fleet/hints";
// @ts-expect-error — plain ESM test helper
import { materialize } from "../fleet/materialize.mjs";

const NOW = new Date("2026-10-01T02:00:00Z");
const snaps: Record<string, Snapshot> = {};
const dirs: string[] = [];
const KEYS = ["FAKE_FLEET_DIR", "FAKE_CRONTAB_FILE", "PITASKER_ETC_DIR", "PITASKER_BIN_DIR", "PITASKER_ROOT_CRON_SNAPSHOT"];

beforeAll(async () => {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const f of ["alpha", "beta", "gamma"]) {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), `pitasker-hints-${f}-`));
    dirs.push(out);
    Object.assign(process.env, materialize(f, out));
    snaps[f] = await collectSnapshot({ version: "t", now: NOW });
  }
  for (const k of KEYS) process.env[k] = saved[k];
});
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const hosts = () => ["alpha", "beta", "gamma"].map((id) => ({ id, label: id.toUpperCase(), snapshot: snaps[id] }));

describe("normalizeCommand", () => {
  it.each([
    ["/home/zk/bin/x  >> /home/zk/logs/x.log 2>&1", null, "~/bin/x"],
    ["~/bin/x >>~/logs/x.log", null, "~/bin/x"],
    ["$HOME/bin/x --a  --b", null, "~/bin/x --a --b"],
    ["/tmp/h/home/bin/x > /dev/null", "/tmp/h/home", "~/bin/x"],
    ["curl -fsS https://hc-ping.com/abc", null, "curl -fsS https://hc-ping.com/abc"],
  ])("%s", (cmd, home, want) => expect(normalizeCommand(cmd, home)).toBe(want));
});

describe("computeHints", () => {
  it("same job on two hosts: equal after normalizing, or the same bin script", () => {
    const same = computeHints(hosts(), "alpha").filter((h) => h.kind === "same-job");
    const poll = same.find((h) => h.message.includes("~/bin/status-poll") || h.targets.some((t) => t.startsWith("beta:")));
    expect(poll).toBeTruthy();
    const withBeta = same.filter((h) => h.targets.some((t) => t.startsWith("beta:")) && h.targets.some((t) => t.startsWith("alpha:")));
    // status-poll (different spacing, ~ vs absolute, both redirected) and the hc-ping curl
    expect(withBeta.length).toBeGreaterThanOrEqual(2);
    // package jobs (run-parts in /etc/crontab on every host) are not flagged
    expect(same.every((h) => !h.message.includes("run-parts"))).toBe(true);
    for (const h of same) {
      const ids = h.targets.map((t) => t.split(":")[0]);
      expect(new Set(ids).size).toBeGreaterThanOrEqual(2);
    }
  });

  it("script not in bin.git: outside, untracked, dirty, missing — never for package scripts", () => {
    const hints = computeHints(hosts(), "alpha").filter((h) => h.kind === "not-in-bin" && h.targets[0].startsWith("alpha:"));
    const msgs = hints.map((h) => h.message).sort();
    expect(msgs).toEqual(
      [
        "script has uncommitted changes in bin.git", // dirty-job
        "script is missing", // old-sync (a disabled line still says so)
        "script is not committed to bin.git", // untracked-job
        "script is outside ~/bin (not in bin.git)", // ~/scripts/outside-bin.sh
      ].sort(),
    );
    const all = computeHints(hosts(), "alpha");
    expect(all.some((h) => h.kind === "disabled")).toBe(true);
  });

  it("bin replica differs from the master", () => {
    const hints = computeHints(hosts(), "alpha").filter((h) => h.kind === "bin-differs");
    expect(hints.map((h) => h.targets[0])).toEqual(["gamma"]);
    expect(computeHints(hosts(), null).filter((h) => h.kind === "bin-differs")).toEqual([]);
    expect(computeHints(hosts(), "nosuchhost").filter((h) => h.kind === "bin-differs")).toEqual([]);
  });

  it("an offline host without a snapshot adds nothing", () => {
    expect(computeHints([{ id: "x", label: "x", snapshot: null }], null)).toEqual([]);
  });
});

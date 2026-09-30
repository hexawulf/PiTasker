// Cross-host hints for the Fleet page, computed on the hub over every host's
// snapshot (docs/plans/2.1-fleet-view.md › Hub › Hints). Pure functions.
//
//   same-job     the same job on two hosts: normalized command equal
//                (whitespace collapsed, the host's home → ~, output
//                redirections dropped) or the same bin script. Only jobs
//                people schedule: zk/root crontabs, cron.d/etc lines run as a
//                non-root user, user timers — not package jobs (run-parts,
//                certbot, e2scrub …) which every host has.
//   not-in-bin   a zk/root job (or zk user timer) whose script is under the
//                home but outside bin/, untracked, dirty or missing.
//                Package scripts (/usr/…, /sbin/…) never get it.
//   bin-differs  the host's bin HEAD differs from the master's (piapps2).
//   disabled     a commented-out line (shown muted, not hidden).
import path from "path";
import { entryKey, timerKey, type Entry, type Hint, type ScriptInfo, type Snapshot, type Source } from "@shared/fleet";

export type HostSnap = { id: string; label: string; snapshot: Snapshot | null };

const homeOf = (s: Snapshot) => (s.bin?.path ? path.dirname(s.bin.path) : null);

/** Compare commands across hosts: whitespace, home, redirections. */
export function normalizeCommand(command: string, home: string | null): string {
  let c = ` ${command} `;
  if (home) c = c.split(home + "/").join("~/");
  c = c
    .replace(/(^|\s)(\$HOME|\$\{HOME\}|\/home\/zk)\//g, "$1~/")
    .replace(/\s\d?&?>>?\s*\S+/g, " ") // > f, >> f, 2> f, &> f, 2>&1
    .replace(/\s+/g, " ")
    .trim();
  return c;
}

const normalizeScript = (p: string, home: string | null) => (home && p.startsWith(home + "/") ? `~/${p.slice(home.length + 1)}` : p);

type Job = { key: string; hostId: string; command: string; script?: ScriptInfo; peopleJob: boolean; ownerHome: boolean; disabled: boolean; label: string };

function jobsOf(h: HostSnap): Job[] {
  const s = h.snapshot;
  if (!s) return [];
  const out: Job[] = [];
  const push = (src: Source, e: Entry) => {
    const user = e.user;
    const people = src.kind === "crontab" || ((src.kind === "etc-crontab" || src.kind === "cron.d") && !!user && user !== "root");
    out.push({
      key: entryKey(h.id, e.id),
      hostId: h.id,
      command: e.command,
      script: e.script,
      peopleJob: people,
      ownerHome: src.kind === "crontab" || (people && user !== "root"),
      disabled: e.disabled,
      label: e.command,
    });
  };
  for (const src of s.sources) {
    if (src.kind === "crontab" || src.kind === "etc-crontab" || src.kind === "cron.d") for (const e of src.entries) push(src, e);
    if (src.kind === "timer" && src.command) {
      out.push({
        key: timerKey(h.id, src),
        hostId: h.id,
        command: src.command,
        script: src.script,
        peopleJob: src.scope === "user",
        ownerHome: src.scope === "user",
        disabled: false,
        label: src.unit,
      });
    }
  }
  return out;
}

function scriptProblem(sc: ScriptInfo | undefined, home: string | null): string | null {
  if (!sc || !home || !(sc.path === home || sc.path.startsWith(home + "/"))) return null;
  if (!sc.inBin) return "script is outside ~/bin (not in bin.git)";
  if (!sc.exists) return "script is missing";
  if (sc.tracked === false) return "script is not committed to bin.git";
  if (sc.dirty) return "script has uncommitted changes in bin.git";
  return null;
}

export function computeHints(hosts: HostSnap[], binMaster: string | null): Hint[] {
  const hints: Hint[] = [];
  const byHost = new Map(hosts.map((h) => [h.id, h]));

  // same-job
  const groups = new Map<string, Job[]>();
  for (const h of hosts) {
    const home = h.snapshot ? homeOf(h.snapshot) : null;
    for (const j of jobsOf(h)) {
      if (!j.peopleJob || j.disabled) continue;
      const keys = new Set([`cmd:${normalizeCommand(j.command, home)}`]);
      if (j.script?.inBin) keys.add(`script:${normalizeScript(j.script.path, home)}`);
      for (const k of keys) groups.set(k, [...(groups.get(k) ?? []), j]);
    }
  }
  const seenSets = new Set<string>();
  for (const [k, jobs] of groups) {
    const hostIds = [...new Set(jobs.map((j) => j.hostId))];
    if (hostIds.length < 2) continue;
    const targets = [...new Set(jobs.map((j) => j.key))].sort();
    const sig = targets.join("|");
    if (seenSets.has(sig)) continue;
    seenSets.add(sig);
    const labels = hostIds.map((id) => byHost.get(id)?.label ?? id).join(", ");
    hints.push({ kind: "same-job", message: `Same job on ${hostIds.length} hosts (${labels})${k.startsWith("script:") ? `: ${k.slice(7)}` : ""}`, targets });
  }

  // not-in-bin + disabled
  for (const h of hosts) {
    const home = h.snapshot ? homeOf(h.snapshot) : null;
    for (const j of jobsOf(h)) {
      if (j.disabled) hints.push({ kind: "disabled", message: "Disabled (commented out)", targets: [j.key] });
      const problem = scriptProblem(j.script, home);
      if (problem && (j.peopleJob || j.ownerHome)) hints.push({ kind: "not-in-bin", message: problem, targets: [j.key] });
    }
  }

  // bin-differs
  const master = binMaster ? byHost.get(binMaster)?.snapshot?.bin?.head : null;
  if (binMaster && master) {
    for (const h of hosts) {
      const head = h.snapshot?.bin?.head;
      if (h.id !== binMaster && head && head !== master) {
        hints.push({ kind: "bin-differs", message: `bin.git at ${head.slice(0, 7)}, ${byHost.get(binMaster)?.label ?? binMaster} at ${master.slice(0, 7)}`, targets: [h.id] });
      }
    }
  }
  return hints;
}

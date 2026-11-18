// View helpers for fleet snapshots, without zod (the client imports these;
// shared/fleet.ts holds the zod schemas the hub validates with).

export type TimerKeyInput = { scope: "system" | "user"; unit: string };

export type SourceLike =
  | { kind: "crontab"; owner: "zk" | "root" }
  | { kind: "etc-crontab" }
  | { kind: "cron.d"; file: string }
  | { kind: "run-parts"; dir: "cron.hourly" | "cron.daily" | "cron.weekly" | "cron.monthly" }
  | ({ kind: "timer" } & TimerKeyInput);

/** "zk" | "root" | "system" | "timer": the Fleet page's source filter. */
export type SourceGroup = "zk" | "root" | "system" | "timer";

export function sourceGroup(s: SourceLike): SourceGroup {
  if (s.kind === "crontab") return s.owner;
  if (s.kind === "timer") return "timer";
  return "system";
}

export function sourceLabel(s: SourceLike): string {
  switch (s.kind) {
    case "crontab":
      return s.owner === "zk" ? "zk crontab" : "root crontab";
    case "etc-crontab":
      return "/etc/crontab";
    case "cron.d":
      return `cron.d/${s.file}`;
    case "run-parts":
      return s.dir;
    case "timer":
      return `${s.scope === "user" ? "user timer" : "timer"} ${s.unit}`;
  }
}

/** The key a hint targets: host + entry id, or host + timer unit. */
export const entryKey = (hostId: string, entryId: string) => `${hostId}:${entryId}`;
export const timerKey = (hostId: string, t: TimerKeyInput) => `${hostId}:timer:${t.scope}:${t.unit}`;

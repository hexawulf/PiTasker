// View helpers for fleet snapshots, without zod (the client imports these;
// shared/fleet.ts holds the zod schemas the hub validates with).
import type { Source, TimerSource } from "./fleet";

/** "zk" | "root" | "system" | "timer": the Fleet page's source filter. */
export type SourceGroup = "zk" | "root" | "system" | "timer";

export function sourceGroup(s: Source): SourceGroup {
  if (s.kind === "crontab") return s.owner;
  if (s.kind === "timer") return "timer";
  return "system";
}

export function sourceLabel(s: Source): string {
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
export const timerKey = (hostId: string, t: Pick<TimerSource, "scope" | "unit">) => `${hostId}:timer:${t.scope}:${t.unit}`;

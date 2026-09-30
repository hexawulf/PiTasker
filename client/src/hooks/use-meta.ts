import { useQuery } from "@tanstack/react-query";

export type Meta = { version: string; hostname: string; user: string; timeZone: string; binDir: string; runTimeoutMs: number; cronJournal: boolean };

export function useMeta() {
  return useQuery<Meta>({ queryKey: ["/api/meta"], staleTime: 10 * 60_000 });
}

/** The host's zone (what cron and PiTasker schedule in); the browser's until /api/meta answers. */
export function useHostTimeZone(): string {
  return useMeta().data?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

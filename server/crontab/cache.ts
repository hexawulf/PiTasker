// A 3-second read cache of the crontab for the list views (tasks, crontab).
// Every route that writes the crontab calls invalidateCrontabCache().
import { readCrontab } from "./store";

type Snapshot = Awaited<ReturnType<typeof readCrontab>>;

let cache: { at: number; value: Snapshot | null } | null = null;
let inflight: Promise<Snapshot | null> | null = null;

export function invalidateCrontabCache() {
  cache = null;
  inflight = null;
}

/** The crontab as of at most 3 s ago; null when it cannot be read. */
export async function cachedCrontab(): Promise<Snapshot | null> {
  if (cache && Date.now() - cache.at < 3_000) return cache.value;
  inflight ??= readCrontab()
    .then((value) => {
      cache = { at: Date.now(), value };
      return value;
    })
    .catch((e) => {
      console.warn(`[tasks] cannot read the crontab: ${(e as Error).message}`);
      cache = { at: Date.now(), value: null };
      return null;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

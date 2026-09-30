// The hub side of the fleet view (read-only).
//
//   browser ─► GET /api/fleet[?refresh=1]      GET /api/fleet/:host[?refresh=1]
//                │ local: collector in-process (cache 60 s)
//                │ remote: the host from PITASKER_HOSTS only (never a URL from the client)
//                ▼
//              agent GET <url>/api/agent/cron   Authorization: Bearer <token>
//                no cookies, no client headers · 5 s · 1 MB · JSON only · no redirects
//                every host in parallel; one slow host never holds up the others
//                ▼
//              200 → SnapshotSchema (zod) → saved to PITASKER_STATE_DIR/fleet/<id>.json (0600)
//              else → status only (offline / auth-error / version-mismatch), never the
//                     agent's text; the last saved snapshot is shown ("as of")
//
// Remote hosts are fetched at most once per cache window (60 s) unless refresh.
import fs from "fs";
import os from "os";
import path from "path";
import { SnapshotSchema, type FleetHost, type FleetHostStatus, type FleetResponse, type Snapshot } from "@shared/fleet";
import { computeHints } from "./hints";
import type { FleetHostEntry } from "./hosts";

export type Outcome = { kind: "ok"; body: unknown } | { kind: "offline" } | { kind: "auth" } | { kind: "bad" };

export type FleetHubOptions = {
  hosts: FleetHostEntry[];
  collectLocal: (force: boolean) => Promise<Snapshot>;
  stateDir: string;
  hubVersion: string;
  binMaster: string | null;
  fetchImpl?: typeof fetch;
  now?: () => number;
  localLabel?: string;
  cacheMs?: number;
  timeoutMs?: number;
  maxBytes?: number;
  staleMs?: number;
};

type State = {
  status: FleetHostStatus;
  lastSeen: number | null;
  version: string | null;
  snapshot: Snapshot | null;
  asOf: string | null;
  checkedAt: number;
  loaded: boolean;
  inflight?: Promise<void>;
};

const major = (v: string | null | undefined) => (v && /^(\d+)\./.exec(v)?.[1]) ?? null;

/** One GET to an agent (PiDeck's hosts.ts agentGet). Every failure becomes a kind; nothing throws. */
export async function agentGet(fetchImpl: typeof fetch, url: string, token: string, timeoutMs: number, maxBytes: number): Promise<Outcome> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs); // covers the body too
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      signal: ctrl.signal,
      redirect: "error",
    });
    if (res.status === 401 || res.status === 403 || res.status === 429) {
      await res.body?.cancel().catch(() => {});
      return { kind: "auth" };
    }
    const type = res.headers.get("content-type") || "";
    const length = Number(res.headers.get("content-length") || 0);
    if (!res.ok || !/^application\/json\b/i.test(type) || length > maxBytes || !res.body) {
      await res.body?.cancel().catch(() => {});
      return { kind: "bad" };
    }
    const reader = res.body.getReader();
    const aborted = new Promise<never>((_r, reject) => {
      if (ctrl.signal.aborted) reject(new Error("timeout"));
      ctrl.signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true });
    });
    aborted.catch(() => {});
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted]).catch(async (e) => {
        await reader.cancel().catch(() => {});
        throw e;
      });
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { kind: "bad" };
      }
      chunks.push(value);
    }
    try {
      return { kind: "ok", body: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
    } catch {
      return { kind: "bad" };
    }
  } catch {
    return { kind: "offline" }; // refused, DNS, reset, timeout (abort), redirect
  } finally {
    clearTimeout(timer);
  }
}

export function createFleetHub(o: FleetHubOptions) {
  const fetchImpl = o.fetchImpl ?? fetch;
  const now = o.now ?? Date.now;
  const cacheMs = o.cacheMs ?? 60_000;
  const timeoutMs = o.timeoutMs ?? 5_000;
  const maxBytes = o.maxBytes ?? 1024 * 1024;
  const staleMs = o.staleMs ?? 10 * 60_000;
  const localLabel = o.localLabel ?? os.hostname();
  const dir = path.join(o.stateDir, "fleet");
  const byId = new Map(o.hosts.map((h) => [h.id, h]));
  const state = new Map<string, State>(o.hosts.map((h) => [h.id, { status: "offline", lastSeen: null, version: null, snapshot: null, asOf: null, checkedAt: -Infinity, loaded: false }]));
  let local: { at: number; snap: Snapshot } | null = null;

  const fileOf = (id: string) => path.join(dir, `${id}.json`);

  function load(id: string, s: State) {
    if (s.loaded) return;
    s.loaded = true;
    try {
      const raw = JSON.parse(fs.readFileSync(fileOf(id), "utf8")) as { savedAt?: unknown; snapshot?: unknown };
      const snap = SnapshotSchema.safeParse(raw.snapshot);
      if (snap.success && !s.snapshot) {
        s.snapshot = snap.data;
        s.asOf = snap.data.generatedAt;
        s.lastSeen = typeof raw.savedAt === "number" ? raw.savedAt : null;
        s.version = snap.data.agentVersion;
      }
    } catch {
      /* none saved yet */
    }
  }

  function save(id: string, snap: Snapshot) {
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const tmp = `${fileOf(id)}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ savedAt: now(), snapshot: snap }), { mode: 0o600 });
      fs.renameSync(tmp, fileOf(id));
    } catch (e) {
      console.warn(`[fleet] could not save the snapshot of ${id}: ${(e as Error).message}`);
    }
  }

  async function check(h: FleetHostEntry) {
    const s = state.get(h.id)!;
    const out = await agentGet(fetchImpl, `${h.url}/api/agent/cron`, h.token, timeoutMs, maxBytes);
    s.checkedAt = now();
    if (out.kind === "offline") return void (s.status = "offline");
    if (out.kind === "auth") return void (s.status = "auth-error");
    const parsed = out.kind === "ok" ? SnapshotSchema.safeParse(out.body) : null;
    if (!parsed || !parsed.success) {
      // It answered, but not with a snapshot this hub understands.
      s.status = "version-mismatch";
      s.lastSeen = now();
      const v = (out.kind === "ok" && (out.body as { agentVersion?: unknown })?.agentVersion) || null;
      s.version = typeof v === "string" ? v.slice(0, 32) : s.version;
      return;
    }
    const snap = parsed.data;
    s.lastSeen = now();
    s.version = snap.agentVersion;
    s.snapshot = snap;
    s.asOf = snap.generatedAt;
    save(h.id, snap);
    const hubMajor = major(o.hubVersion);
    const agentMajor = major(snap.agentVersion);
    if (hubMajor && agentMajor && hubMajor !== agentMajor) s.status = "version-mismatch";
    else if (now() - Date.parse(snap.generatedAt) > staleMs) s.status = "stale";
    else s.status = "online";
  }

  function refresh(h: FleetHostEntry, force: boolean): Promise<void> {
    const s = state.get(h.id)!;
    load(h.id, s);
    if (!force && now() - s.checkedAt < cacheMs) return Promise.resolve();
    s.inflight ??= check(h).finally(() => (s.inflight = undefined));
    return s.inflight;
  }

  async function localSnap(force: boolean): Promise<Snapshot> {
    if (!force && local && now() - local.at < cacheMs) return local.snap;
    const snap = await o.collectLocal(force);
    local = { at: now(), snap };
    return snap;
  }

  const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());

  function remoteView(h: FleetHostEntry): FleetHost {
    const s = state.get(h.id)!;
    return {
      id: h.id,
      label: h.label,
      local: false,
      production: h.production,
      status: s.status,
      lastSeen: iso(s.lastSeen),
      version: s.version,
      tz: s.snapshot?.tz ?? null,
      binHead: s.snapshot?.bin?.head ?? null,
      asOf: s.asOf,
      snapshot: s.snapshot,
    };
  }

  async function localView(force: boolean): Promise<FleetHost> {
    const snap = await localSnap(force);
    return {
      id: "local",
      label: localLabel,
      local: true,
      production: false,
      status: "online",
      lastSeen: iso(now()),
      version: o.hubVersion,
      tz: snap.tz,
      binHead: snap.bin?.head ?? null,
      asOf: snap.generatedAt,
      snapshot: snap,
    };
  }

  return {
    has: (id: string) => id === "local" || byId.has(id),

    async list(force = false): Promise<FleetResponse> {
      const [localHost] = await Promise.all([localView(force), ...o.hosts.map((h) => refresh(h, force))]);
      const hosts = [localHost, ...o.hosts.map(remoteView)];
      return { generatedAt: iso(now())!, binMaster: o.binMaster, hosts, hints: computeHints(hosts, o.binMaster) };
    },

    async one(id: string, force = false): Promise<FleetHost | null> {
      if (id === "local") return localView(force);
      const h = byId.get(id);
      if (!h) return null;
      await refresh(h, force);
      return remoteView(h);
    },
  };
}

export type FleetHub = ReturnType<typeof createFleetHub>;

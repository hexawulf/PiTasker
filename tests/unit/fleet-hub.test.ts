import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Snapshot } from "@shared/fleet";
import { hostTokenKey, parseFleetHosts, type FleetHostEntry } from "../../server/fleet/hosts";
import { createFleetHub } from "../../server/fleet/hub";

const TOKEN = "hub-test-token-0123456789abcdef";
const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  host: "remote",
  tz: "Europe/Berlin",
  generatedAt: new Date(NOW).toISOString(),
  agentVersion: "2.1.0",
  bin: { head: "a".repeat(40), dirty: false, path: "/home/zk/bin" },
  sources: [{ kind: "crontab", owner: "zk", hash: "h", entries: [{ id: "e1", line: "* * * * * /home/zk/bin/x", schedule: "* * * * *", command: "/home/zk/bin/x", disabled: false, nextRuns: [] }] }],
  errors: [],
  ...over,
});
const NOW = Date.parse("2026-10-01T02:00:00Z");
const LOCAL = (): Snapshot => ({ ...snap(), host: "hub", tz: "Asia/Taipei", bin: { head: "b".repeat(40), dirty: false, path: "/home/zk/bin" } });
const host = (id: string, extra: Partial<FleetHostEntry> = {}): FleetHostEntry => ({ id, label: id, url: `http://${id}.test:5017`, token: TOKEN, production: false, ...extra });

describe("parseFleetHosts", () => {
  it("reads hosts, tokens, labels and production; skips bad entries without printing tokens", () => {
    const warnings: string[] = [];
    const hosts = parseFleetHosts(
      {
        PITASKER_HOSTS: "piapps2=http://192.168.50.120:5017, hwca-ap02=http://10.77.0.5:5017/, BAD=http://x, local=http://y, nopath=http://z:1/x, cred=http://u:p@h, notoken=http://n",
        [hostTokenKey("piapps2")]: TOKEN,
        [hostTokenKey("hwca-ap02")]: TOKEN,
        [hostTokenKey("nopath")]: TOKEN,
        [hostTokenKey("cred")]: TOKEN,
        PITASKER_HOST_LABELS: "piapps2=piapps2 (LAN),ghost=x",
        PITASKER_HOST_PRODUCTION: "hwca-ap02",
      },
      (m) => warnings.push(m),
    );
    expect(hosts).toEqual([
      { id: "piapps2", label: "piapps2 (LAN)", url: "http://192.168.50.120:5017", token: TOKEN, production: false },
      { id: "hwca-ap02", label: "hwca-ap02", url: "http://10.77.0.5:5017", token: TOKEN, production: true },
    ]);
    expect(hostTokenKey("hwca-ap02")).toBe("PITASKER_HOST_TOKEN_HWCA_AP02");
    expect(warnings).toHaveLength(6);
    expect(warnings.join("\n")).not.toContain(TOKEN);
    expect(parseFleetHosts({}, () => {})).toEqual([]);
  });
});

type Reply = (url: string, init: RequestInit) => Promise<Response> | Response;
const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

describe("fleet hub", () => {
  let dir = "";
  let t = NOW;
  let calls: { url: string; init: RequestInit }[] = [];
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pitasker-hub-"));
    t = NOW;
    calls = [];
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const make = (hosts: FleetHostEntry[], reply: Reply, extra = {}) =>
    createFleetHub({
      hosts,
      collectLocal: async () => LOCAL(),
      stateDir: dir,
      hubVersion: "2.1.0",
      binMaster: "local",
      localLabel: "piapps",
      now: () => t,
      timeoutMs: 200,
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return reply(url, init);
      }) as unknown as typeof fetch,
      ...extra,
    });

  it("online: validated snapshot, saved 0600, fixed path, only the bearer header, no redirects", async () => {
    const hub = make([host("piapps2", { production: true })], () => json(snap()));
    const r = await hub.list();
    expect(r.hosts.map((h) => [h.id, h.status, h.local])).toEqual([
      ["local", "online", true],
      ["piapps2", "online", false],
    ]);
    expect(r.hosts[1]).toMatchObject({ tz: "Europe/Berlin", version: "2.1.0", production: true, asOf: new Date(NOW).toISOString(), binHead: "a".repeat(40) });
    expect(calls[0].url).toBe("http://piapps2.test:5017/api/agent/cron");
    expect(calls[0].init.headers).toEqual({ authorization: `Bearer ${TOKEN}`, accept: "application/json" });
    expect(calls[0].init.redirect).toBe("error");
    const f = path.join(dir, "fleet", "piapps2.json");
    expect(fs.statSync(f).mode & 0o777).toBe(0o600);
    expect(r.hints.filter((h) => h.kind === "bin-differs").map((h) => h.targets)).toEqual([["piapps2"]]);
  });

  it("auth-error on 401/403/429, offline on no answer; never the agent's text", async () => {
    const hub = make([host("a"), host("b"), host("c"), host("d")], (url) => {
      if (url.startsWith("http://a.")) return json({ message: "Unauthorized secret detail" }, { status: 401 });
      if (url.startsWith("http://b.")) return json({}, { status: 429 });
      if (url.startsWith("http://c.")) throw new Error("ECONNREFUSED");
      return new Response("<html>proxy</html>", { status: 200, headers: { "content-type": "text/html" } });
    });
    const r = await hub.list();
    expect(r.hosts.slice(1).map((h) => [h.id, h.status, h.snapshot])).toEqual([
      ["a", "auth-error", null],
      ["b", "auth-error", null],
      ["c", "offline", null],
      ["d", "version-mismatch", null],
    ]);
    expect(JSON.stringify(r)).not.toContain("secret detail");
  });

  it("an invalid snapshot, a different major version, or an old snapshot", async () => {
    const hub = make([host("bad"), host("old"), host("stale")], (url) => {
      if (url.startsWith("http://bad.")) return json({ host: "x", sources: "nope" });
      if (url.startsWith("http://old.")) return json(snap({ agentVersion: "1.9.0" }));
      return json(snap({ generatedAt: new Date(NOW - 11 * 60_000).toISOString() }));
    });
    const r = await hub.list();
    expect(r.hosts.slice(1).map((h) => [h.id, h.status])).toEqual([
      ["bad", "version-mismatch"],
      ["old", "version-mismatch"],
      ["stale", "stale"],
    ]);
    expect(r.hosts[1].snapshot).toBeNull(); // never shows data it couldn't validate
  });

  it("caps the body at 1 MB (content-length or streamed)", async () => {
    const big = "x".repeat(2048);
    const hub = make([host("a"), host("b")], (url) =>
      url.startsWith("http://a.")
        ? new Response(big, { headers: { "content-type": "application/json", "content-length": "5000000" } })
        : new Response(JSON.stringify({ pad: big }), { headers: { "content-type": "application/json" } }),
      { maxBytes: 1024 },
    );
    const r = await hub.list();
    expect(r.hosts.slice(1).map((h) => h.status)).toEqual(["version-mismatch", "version-mismatch"]);
  });

  it("one slow host never holds up the others (timeout → offline)", async () => {
    const hub = make([host("slow"), host("fast")], (url, init) =>
      url.startsWith("http://slow.")
        ? new Promise<Response>((_res, rej) => init.signal!.addEventListener("abort", () => rej(new Error("aborted"))))
        : json(snap()),
    );
    const started = Date.now();
    const r = await hub.list();
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(r.hosts.slice(1).map((h) => [h.id, h.status])).toEqual([
      ["slow", "offline"],
      ["fast", "online"],
    ]);
  });

  it("60 s cache; ?refresh=1 bypasses it", async () => {
    const hub = make([host("a")], () => json(snap()));
    await hub.list();
    await hub.list();
    expect(calls).toHaveLength(1);
    t += 61_000;
    await hub.list();
    expect(calls).toHaveLength(2);
    await hub.one("a", true);
    expect(calls).toHaveLength(3);
    expect(await hub.one("nope")).toBeNull();
    expect(hub.has("local")).toBe(true);
  });

  it("an offline host shows its last saved snapshot, also after a restart", async () => {
    let up = true;
    const hub = make([host("a")], () => {
      if (!up) throw new Error("down");
      return json(snap());
    });
    await hub.list();
    up = false;
    t += 61_000;
    const r = await hub.list();
    expect(r.hosts[1]).toMatchObject({ status: "offline", asOf: new Date(NOW).toISOString() });
    expect(r.hosts[1].snapshot?.sources).toHaveLength(1);

    const restarted = make([host("a")], () => {
      throw new Error("still down");
    });
    const r2 = await restarted.list();
    expect(r2.hosts[1]).toMatchObject({ status: "offline", asOf: new Date(NOW).toISOString(), lastSeen: new Date(NOW).toISOString() });
    expect(r2.hosts[1].snapshot).not.toBeNull();
  });
});

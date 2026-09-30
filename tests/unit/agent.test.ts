import { execFileSync, spawn, type ChildProcess } from "child_process";
import fs from "fs";
import http from "http";
import net from "net";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentHealthSchema, SnapshotSchema, type Snapshot } from "@shared/fleet";
import { createAgentHandler } from "../../server/agent/app";
import { createFailureLimiter, sha256Hex } from "../../server/agent/auth";
import { agentConfig } from "../../server/agent/config";
// @ts-expect-error — plain ESM test helper
import { materialize } from "../fleet/materialize.mjs";

const ROOT = path.resolve(__dirname, "..", "..");
const TOKEN = "agent-test-token-0123456789abcdef0123456789abcdef";
const HASH = sha256Hex(TOKEN);
const ADDR = new Set(["127.0.0.1", "192.168.50.120", "::1", "10.77.0.4"]);

describe("agentConfig: refuses to start rather than listen wrongly", () => {
  const ok = { PITASKER_AGENT_BIND: "192.168.50.120", PITASKER_AGENT_TOKEN_SHA256: HASH };
  it("accepts a local address and a hash; port defaults to 5017", () => {
    expect(agentConfig(ok, ADDR)).toEqual({ bind: "192.168.50.120", port: 5017, tokenSha256: HASH });
    expect(agentConfig({ ...ok, PITASKER_AGENT_PORT: "6000" }, ADDR)).toMatchObject({ port: 6000 });
  });
  it.each([
    [{ PITASKER_AGENT_TOKEN_SHA256: HASH }, /BIND is not set/],
    [{ ...ok, PITASKER_AGENT_BIND: "0.0.0.0" }, /every interface/],
    [{ ...ok, PITASKER_AGENT_BIND: "::" }, /every interface/],
    [{ ...ok, PITASKER_AGENT_BIND: "10.77.0.9" }, /not an address of this host/],
    [{ ...ok, PITASKER_AGENT_TOKEN_SHA256: "" }, /64-hex/],
    [{ ...ok, PITASKER_AGENT_TOKEN_SHA256: TOKEN }, /64-hex/],
    [{ ...ok, PITASKER_AGENT_PORT: "70000" }, /1-65535/],
    [{ ...ok, PITASKER_AGENT_PORT: "5017x" }, /1-65535/],
  ])("%j", (env, msg) => {
    const r = agentConfig(env as NodeJS.ProcessEnv, ADDR);
    expect("error" in r && r.error).toMatch(msg);
  });
  it("never echoes the token", () => {
    const r = agentConfig({ PITASKER_AGENT_BIND: "127.0.0.1", PITASKER_AGENT_TOKEN_SHA256: TOKEN }, ADDR);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
});

// ─── the handler ───────────────────────────────────────────────────────────

const SNAP: Snapshot = { host: "h", tz: "Asia/Taipei", generatedAt: "2026-10-01T02:00:00.000Z", agentVersion: "t", bin: null, sources: [], errors: [] };
let server: http.Server;
let base = "";
let collected = 0;

beforeAll(async () => {
  server = http.createServer(
    createAgentHandler({
      tokenSha256: HASH,
      version: "2.1.0",
      snapshot: async () => {
        collected++;
        return SNAP;
      },
      timeZone: async () => "Asia/Taipei",
      limiter: createFailureLimiter({ max: 3 }),
      log: () => {},
    }),
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
});
afterAll(() => server?.close());

const call = (p: string, init: RequestInit & { token?: string | null } = {}) =>
  fetch(base + p, { ...init, headers: { ...(init.token === null ? {} : { authorization: `Bearer ${init.token ?? TOKEN}` }), ...(init.headers ?? {}) } });

describe("agent HTTP: auth first, GET only, no parameters, two paths", () => {
  it("health and cron with the token", async () => {
    const h = await call("/api/agent/health");
    expect(h.status).toBe(200);
    expect(h.headers.get("cache-control")).toBe("no-store");
    expect(AgentHealthSchema.parse(await h.json())).toMatchObject({ version: "2.1.0", tz: "Asia/Taipei", capabilities: { cron: true, write: false } });
    const c = await call("/api/agent/cron");
    expect(SnapshotSchema.parse(await c.json())).toEqual(SNAP);
  });

  it("401 without or with a wrong token, for every path and method (paths stay hidden)", async () => {
    const attempts: [string, RequestInit & { token?: string | null }][] = [
      ["/api/agent/cron", { token: null }],
      ["/nope", { token: null }],
      ["/api/agent/cron", { method: "POST", token: null }],
      ["/api/agent/cron", { method: "DELETE", token: null }],
      ["/api/agent/cron", { token: "wrong-token-wrong-token-wrong" }],
      ["/api/agent/cron", { headers: { authorization: `Basic ${TOKEN}` }, token: null }],
    ];
    for (const [p, init] of attempts) {
      expect((await call(p, init)).status).toBe(401);
      await call("/api/agent/health"); // a good request clears the failure count (limit is 3 here)
    }
  });

  it("429 after repeated failures; the right token still gets through and clears it", async () => {
    let last = 0;
    for (let i = 0; i < 5; i++) last = (await call("/api/agent/health", { token: "bad-bad-bad-bad-bad" })).status;
    expect(last).toBe(429);
    expect((await call("/api/agent/health", { token: "bad-bad-bad-bad-bad" })).headers.get("retry-after")).toMatch(/^\d+$/);
    expect((await call("/api/agent/health")).status).toBe(200);
    expect((await call("/api/agent/health", { token: "bad-bad-bad-bad-bad" })).status).toBe(401);
  });

  it("only GET/HEAD", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const r = await call("/api/agent/cron", { method, body: method === "DELETE" ? undefined : "{}" });
      expect(r.status).toBe(405);
      expect(r.headers.get("allow")).toBe("GET, HEAD");
    }
    expect((await call("/api/agent/health", { method: "HEAD" })).status).toBe(200);
  });

  it("no request parameters at all", async () => {
    const before = collected;
    for (const p of ["/api/agent/cron?refresh=1", "/api/agent/cron?path=/etc/shadow", "/api/agent/health?x"]) expect((await call(p)).status).toBe(400);
    expect(collected).toBe(before);
  });

  it("anything else is 404", async () => {
    for (const p of ["/", "/api/agent", "/api/agent/cron/", "/api/agent//cron", "/api/tasks", "/api/agent/write"]) expect((await call(p)).status).toBe(404);
  });
});

// ─── dist/agent.mjs ────────────────────────────────────────────────────────

describe("dist/agent.mjs (the bundle itself)", () => {
  const bundle = path.join(ROOT, "dist", "agent.mjs");
  let out = "";
  let proc: ChildProcess | null = null;

  beforeAll(() => {
    execFileSync(process.execPath, [path.join(ROOT, "scripts", "build-agent.mjs")], { cwd: ROOT, stdio: "ignore" });
    out = fs.mkdtempSync(path.join(os.tmpdir(), "pitasker-agent-bundle-"));
  });
  afterAll(() => {
    proc?.kill();
    fs.rmSync(out, { recursive: true, force: true });
  });

  it("is self-contained and read-only: node: built-ins only, no write/spawn code", () => {
    const src = fs.readFileSync(bundle, "utf8");
    const imports = [...src.matchAll(/^import\s.*?from\s+"([^"]+)";?$/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const i of imports) expect(["http", "crypto", "fs", "os", "path", "child_process"]).toContain(i.replace(/^node:/, ""));
    expect(src).not.toMatch(/\brequire\(/);
    for (const forbidden of ["writeFile", "appendFile", "unlinkSync", "rmSync", "renameSync", "spawn(", "execSync", "zod", "express"]) expect(src).not.toContain(forbidden);
    expect(src).toContain("execFile(");
  });

  const env = (extra: Record<string, string>) => ({
    PATH: process.env.PATH,
    PITASKER_E2E: "1",
    PITASKER_FAKE_BIN_DIR: process.env.PITASKER_FAKE_BIN_DIR,
    ...extra,
  });
  const run = (e: NodeJS.ProcessEnv) =>
    new Promise<{ code: number | null; err: string }>((resolve) => {
      const p = spawn(process.execPath, [bundle], { env: e });
      let err = "";
      p.stderr.on("data", (d) => (err += d));
      p.on("exit", (code) => resolve({ code, err }));
    });

  it("refuses to start without PITASKER_MODE=agent, on 0.0.0.0, or without a token hash", async () => {
    expect((await run(env({ PITASKER_AGENT_BIND: "127.0.0.1", PITASKER_AGENT_TOKEN_SHA256: HASH }))).err).toMatch(/PITASKER_MODE=agent/);
    const any = await run(env({ PITASKER_MODE: "agent", PITASKER_AGENT_BIND: "0.0.0.0", PITASKER_AGENT_TOKEN_SHA256: HASH }));
    expect(any.code).toBe(1);
    expect(any.err).toMatch(/every interface/);
    expect((await run(env({ PITASKER_MODE: "agent", PITASKER_AGENT_BIND: "127.0.0.1" }))).err).toMatch(/64-hex/);
  });

  it("serves a valid snapshot of a fixture host (fakes, scratch bin.git)", async () => {
    const port = await new Promise<number>((r) => {
      const s = net.createServer().listen(0, "127.0.0.1", () => {
        const p = (s.address() as net.AddressInfo).port;
        s.close(() => r(p));
      });
    });
    const fx = materialize("alpha", out) as Record<string, string>;
    proc = spawn(process.execPath, [bundle], {
      env: env({ ...fx, PITASKER_MODE: "agent", PITASKER_AGENT_BIND: "127.0.0.1", PITASKER_AGENT_PORT: String(port), PITASKER_AGENT_TOKEN_SHA256: HASH }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise<void>((resolve, reject) => {
      proc!.stdout!.on("data", (d) => String(d).includes("read-only") && resolve());
      proc!.on("exit", (c) => reject(new Error(`agent exited ${c}`)));
    });
    const r = await fetch(`http://127.0.0.1:${port}/api/agent/cron`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(r.status).toBe(200);
    const snap = SnapshotSchema.parse(await r.json());
    expect(snap.tz).toBe("Asia/Taipei");
    expect(snap.errors).toEqual([]);
    expect(snap.agentVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(JSON.stringify(snap)).not.toContain("supersecret-token-value");
    const h = await fetch(`http://127.0.0.1:${port}/api/agent/health`);
    expect(h.status).toBe(401);
  });
});

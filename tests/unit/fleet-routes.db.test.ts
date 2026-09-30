// /api/fleet with a login (the unauthenticated side is in route-auth.test.ts).
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Snapshot } from "@shared/fleet";
import { createFleetHub } from "../../server/fleet/hub";
import { hasPg } from "../setup/pg";
import { resetDb, startApp, type Client } from "./helpers/app";

const local: Snapshot = { host: "hub", tz: "Asia/Taipei", generatedAt: "2026-10-01T02:00:00.000Z", agentVersion: "2.1.0", bin: null, sources: [], errors: [] };
let c: Client;
let dir = "";
let collects = 0;

beforeAll(async () => {
  if (!hasPg) return;
  await resetDb();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pitasker-fleet-routes-"));
  const hub = createFleetHub({
    hosts: [{ id: "piapps2", label: "piapps2", url: "http://127.0.0.1:1", token: "x".repeat(32), production: false }],
    collectLocal: async () => {
      collects++;
      return local;
    },
    stateDir: dir,
    hubVersion: "2.1.0",
    binMaster: "piapps2",
    timeoutMs: 300,
  });
  c = await startApp({ app: { fleetHub: hub } });
});
afterAll(() => {
  c?.close();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!hasPg)("GET /api/fleet", () => {
  it("lists the hub and the configured hosts", async () => {
    const r = await c.req("GET", "/api/fleet");
    expect(r.status).toBe(200);
    expect(r.body.hosts.map((h: { id: string; status: string }) => [h.id, h.status])).toEqual([
      ["local", "online"],
      ["piapps2", "offline"],
    ]);
  });

  it("one host, refresh bypasses the cache; unknown hosts are 404", async () => {
    const before = collects;
    expect((await c.req("GET", "/api/fleet/local")).body.tz).toBe("Asia/Taipei");
    expect(collects).toBe(before);
    await c.req("GET", "/api/fleet/local?refresh=1");
    expect(collects).toBe(before + 1);
    expect((await c.req("GET", "/api/fleet/nope")).status).toBe(404);
    expect((await c.req("GET", "/api/fleet/..%2Fetc")).status).toBe(404);
  });

  it("no write verbs", async () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) expect((await c.req(m, "/api/fleet/piapps2", {})).status).toBe(404);
  });
});

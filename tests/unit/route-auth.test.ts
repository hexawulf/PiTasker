// Walks every route the app registers and calls it without a session: each
// /api route must answer 401, except the short PUBLIC list. A new route that
// forgets isAuthenticated fails this test. Also verifies sameOrigin CSRF
// checks across every state-changing /api route.
import fs from "fs";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";

const PUBLIC = new Set([
  "POST /api/auth/login",
  "POST /api/auth/firebase-login",
  "GET /api/auth/config",
]);

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

type Layer = {
  route?: { path: string; methods: Record<string, boolean> };
  name?: string;
  handle?: { stack?: Layer[] };
  regexp?: RegExp;
};

function mountPath(layer: Layer): string {
  const src = layer.regexp?.source ?? "";
  if (src === "^\\/?(?=\\/|$)" || src === "^\\/?$") return "";
  return src
    .replace(/^\^/, "")
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, "")
    .replace(/\\\//g, "/");
}

export function listRoutes(stack: Layer[], prefix = ""): string[] {
  const out: string[] = [];
  for (const layer of stack) {
    if (layer.route) {
      for (const m of Object.keys(layer.route.methods)) out.push(`${m.toUpperCase()} ${prefix}${layer.route.path}`);
    } else if (layer.name === "router" && layer.handle?.stack) {
      out.push(...listRoutes(layer.handle.stack, prefix + mountPath(layer)));
    }
  }
  return out;
}

let server: Server;
let base = "";
let routes: string[] = [];

beforeAll(async () => {
  const app = createApp({ sessionSecret: "route-auth-test-secret-0123456789" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  routes = listRoutes((app as any)._router.stack).filter((r) => r.split(" ")[1].startsWith("/api"));
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server?.close());

describe("every /api route requires a login", () => {
  it("finds the routes", () => {
    expect(routes.length).toBeGreaterThan(25);
    for (const r of ["GET /api/tasks", "POST /api/tasks/:id/runner", "GET /api/crontab/", "POST /api/crontab/backups/:name/restore", "GET /api/pitasker-logs/file", "GET /api/fleet", "GET /api/fleet/:host"]) {
      expect(routes).toContain(r);
    }
  });

  it("answers 401 without a session (except the public list)", async () => {
    const open: string[] = [];
    for (const r of routes) {
      if (PUBLIC.has(r)) continue;
      const [method, routePath] = r.split(" ");
      const url = base + routePath.replace(/:[^/]+/g, "1");
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", "X-Forwarded-Proto": "https" },
        body: method === "GET" || method === "HEAD" ? undefined : "{}",
      });
      if (res.status !== 401) open.push(`${r} → ${res.status}`);
    }
    expect(open).toEqual([]);
  });

  it("the public login route exists and rejects an empty body", async () => {
    const res = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(res.status).toBe(400);
  });

  it("the public firebase login route exists and rejects an empty body", async () => {
    const res = await fetch(`${base}/api/auth/firebase-login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(res.status).toBe(400);
  });

  it("the public config route exists and returns firebase public config", async () => {
    const res = await fetch(`${base}/api/auth/config`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("firebase");
  });
});

describe("request guards", () => {
  it("enforces sameOrigin (JSON Content-Type, Origin, Referer, Sec-Fetch-Site) on EVERY state-changing /api route", async () => {
    const mutating = routes.filter((r) => !SAFE_METHODS.has(r.split(" ")[0]));
    expect(mutating.length).toBeGreaterThanOrEqual(13);

    const failures: string[] = [];
    for (const r of mutating) {
      const [method, routePath] = r.split(" ");
      const url = base + routePath.replace(/:[^/]+/g, "1");

      const formRes = await fetch(url, {
        method,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "a=b",
      });
      if (formRes.status !== 415) failures.push(`${r} (form) → ${formRes.status}`);

      const crossSiteRes = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" },
        body: "{}",
      });
      if (crossSiteRes.status !== 403) failures.push(`${r} (sec-fetch-site) → ${crossSiteRes.status}`);

      const foreignOriginRes = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
        body: "{}",
      });
      if (foreignOriginRes.status !== 403) failures.push(`${r} (foreign Origin) → ${foreignOriginRes.status}`);

      const foreignRefererRes = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", Referer: "https://evil.example/csrf" },
        body: "{}",
      });
      if (foreignRefererRes.status !== 403) failures.push(`${r} (foreign Referer) → ${foreignRefererRes.status}`);
    }
    expect(failures).toEqual([]);
  });

  it("the fleet view is read-only: every /api/fleet route is a GET", () => {
    const fleet = routes.filter((r) => r.includes("/api/fleet"));
    expect(fleet.length).toBeGreaterThan(0);
    expect(fleet.every((r) => r.startsWith("GET "))).toBe(true);
  });

  it("no /api path ends in .log (nginx answers 403 to those)", () => {
    expect(routes.filter((r) => /\.log$|:filename/.test(r))).toEqual([]);
  });

  it("health is public and says little", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(Object.keys(await res.json()).sort()).toEqual(["status", "uptime"]);
  });

  it("sends security headers and attaches CSP to /api and /health when staticDir is present", async () => {
    const tmpStatic = fs.mkdtempSync(path.join(os.tmpdir(), "pitasker-csp-test-"));
    fs.writeFileSync(path.join(tmpStatic, "index.html"), "<!doctype html><script>window.__x=1;</script>");
    const cspApp = createApp({ sessionSecret: "route-auth-csp-secret-0123456789", staticDir: tmpStatic });
    const cspServer = cspApp.listen(0);
    const cspBase = `http://127.0.0.1:${(cspServer.address() as AddressInfo).port}`;
    try {
      const res = await fetch(`${cspBase}/api/auth/config`);
      expect(res.status).toBe(200);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
      expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
      expect(res.headers.get("cross-origin-opener-policy")).toBeNull();
      expect(res.headers.get("x-powered-by")).toBeNull();
      const csp = res.headers.get("content-security-policy-report-only") || res.headers.get("content-security-policy") || "";
      expect(csp).toContain("frame-ancestors 'none'");
    } finally {
      cspServer.close();
      fs.rmSync(tmpStatic, { recursive: true, force: true });
    }
  });
});

describe("originAllowed", () => {
  it("accepts the Host, X-Forwarded-Host or the configured public origin", async () => {
    const { originAllowed } = await import("../../server/middleware/sameOrigin");
    expect(originAllowed("https://pitasker.piapps.dev", { headers: { host: "127.0.0.1:5007" } })).toBe(true); // nginx without Host
    expect(originAllowed("https://a.example", { headers: { host: "127.0.0.1:5007", "x-forwarded-host": "a.example" } })).toBe(true);
    expect(originAllowed("http://localhost:5027", { headers: { host: "localhost:5027" } })).toBe(true);
    expect(originAllowed("https://evil.example", { headers: { host: "127.0.0.1:5007" } })).toBe(false);
    expect(originAllowed("null", { headers: { host: "x" } })).toBe(false);
  });
});

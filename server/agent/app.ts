// The PiTasker agent's HTTP handler (read-only, docs/plans/2.1-fleet-view.md).
//
//   request ─► bearer token (sha256, timingSafeEqual; 429 after repeated
//              failures per address) ─► GET/HEAD only (else 405)
//              ─► no query string (else 400) ─► exactly one of:
//                   /api/agent/health   { version, host, tz, capabilities: { cron: true, write: false } }
//                   /api/agent/cron     the snapshot (collector, cached 30 s)
//              ─► anything else 404
//
// node:http only: no Express, no sessions, no database, no files served, no
// request parameters of any kind, and no write code (P4 adds that later).
import os from "os";
import type { IncomingMessage, ServerResponse } from "http";
import type { AgentHealth, Snapshot } from "@shared/fleet";
import { bearerToken, createFailureLimiter, tokenMatches, type FailureLimiter } from "./auth";

export type AgentDeps = {
  tokenSha256: string;
  version: string;
  snapshot: () => Promise<Snapshot>;
  timeZone: () => Promise<string>;
  limiter?: FailureLimiter;
  log?: (msg: string) => void;
};

export const AGENT_PATHS = ["/api/agent/health", "/api/agent/cron"] as const;

export function createAgentHandler(deps: AgentDeps) {
  const limiter = deps.limiter ?? createFailureLimiter();
  const log = deps.log ?? ((m: string) => console.error(m));

  const send = (res: ServerResponse, status: number, body: unknown, headOnly = false, extra: Record<string, string> = {}) => {
    const json = JSON.stringify(body);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(json),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    });
    res.end(headOnly ? undefined : json);
  };

  return async (req: IncomingMessage, res: ServerResponse) => {
    req.resume(); // never read a body
    const key = req.socket.remoteAddress || "unknown";
    const head = req.method === "HEAD";

    // Auth first, so an unauthenticated caller can't learn which paths exist.
    if (!tokenMatches(deps.tokenSha256, bearerToken(req.headers.authorization))) {
      if (limiter.blocked(key)) return send(res, 429, { message: "Too many attempts" }, head, { "Retry-After": String(limiter.retryAfterSec(key)) });
      limiter.fail(key);
      return send(res, 401, { message: "Unauthorized" }, head);
    }
    limiter.reset(key);

    if (req.method !== "GET" && !head) return send(res, 405, { message: "Method not allowed" }, false, { Allow: "GET, HEAD" });
    const url = req.url ?? "/";
    if (url.includes("?") || url.includes("#")) return send(res, 400, { message: "The agent takes no parameters" }, head);

    try {
      if (url === "/api/agent/health") {
        const health: AgentHealth = { version: deps.version, host: os.hostname().slice(0, 128), tz: await deps.timeZone(), capabilities: { cron: true, write: false } };
        return send(res, 200, health, head);
      }
      if (url === "/api/agent/cron") return send(res, 200, await deps.snapshot(), head);
      return send(res, 404, { message: "Not found" }, head);
    } catch (e) {
      log(`[agent] ${url}: ${(e as Error).message}`);
      return send(res, 500, { message: "Internal error" }, head);
    }
  };
}

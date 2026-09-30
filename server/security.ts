// Security headers (helmet) and the Content-Security-Policy for the SPA — the
// same scheme as PiDeck:
//   startup: read <staticDir>/index.html ─► sha256 of each inline <script>
//                                         ─► script-src 'self' 'sha256-…'
//   request: every response gets the CSP (Report-Only while CSP_ENFORCE !== "true");
//            violations are POSTed to /csp-report and logged as one line.
import crypto from "crypto";
import fs from "fs";
import path from "path";
import express, { type Express } from "express";
import helmet from "helmet";

const INLINE_SCRIPT_RE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

// Cloudflare Web Analytics (injected at the edge for proxied pages).
export const CLOUDFLARE_INSIGHTS = {
  script: "https://static.cloudflareinsights.com",
  connect: "https://cloudflareinsights.com",
};

export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const m of html.matchAll(INLINE_SCRIPT_RE)) {
    hashes.push(`'sha256-${crypto.createHash("sha256").update(m[1], "utf8").digest("base64")}'`);
  }
  return hashes;
}

export function cspDirectives(scriptHashes: string[]): Record<string, string[]> {
  return {
    "default-src": ["'self'"],
    "script-src": ["'self'", ...scriptHashes, CLOUDFLARE_INSIGHTS.script],
    // Radix (popper positioning) writes inline style attributes.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", CLOUDFLARE_INSIGHTS.connect],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    "report-uri": ["/csp-report"],
  };
}

/** helmet's other headers (no CSP here: installCsp adds it once the build is known). */
export function installSecurityHeaders(app: Express): void {
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      hsts: false, // nginx/Cloudflare own HSTS for the domain
    }),
  );
}

export function installCsp(app: Express, staticDir: string): void {
  const html = fs.readFileSync(path.join(staticDir, "index.html"), "utf8");
  const hashes = inlineScriptHashes(html);
  const reportOnly = process.env.CSP_ENFORCE !== "true";
  app.post(
    "/csp-report",
    express.json({ type: ["application/csp-report", "application/reports+json", "application/json"], limit: "8kb" }),
    (req, res) => {
      const r = (req.body && (req.body["csp-report"] ?? req.body)) || {};
      const pick = (k: string) => String(r[k] ?? "").replace(/[\r\n]/g, " ").slice(0, 200);
      console.warn(`[csp] ${reportOnly ? "report-only" : "blocked"} directive=${pick("violated-directive")} blocked=${pick("blocked-uri")} page=${pick("document-uri")}`);
      res.sendStatus(204);
    },
  );
  app.use(helmet.contentSecurityPolicy({ useDefaults: false, reportOnly, directives: cspDirectives(hashes) }));
  console.log(`[csp] ${reportOnly ? "Report-Only" : "enforcing"}; ${hashes.length} inline script hash(es)`);
}

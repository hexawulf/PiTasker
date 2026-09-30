import type { NextFunction, Request, Response } from "express";

// CSRF guard for state-changing /api requests (the session cookie is
// SameSite=Lax; this is the second layer):
//   - Content-Type must be application/json, body or not (a cross-site <form>
//     or no-cors fetch cannot send it without a CORS preflight, which
//     PiTasker never answers);
//   - Sec-Fetch-Site, when the browser sends it, must not be "cross-site";
//   - Origin, when present, must be this host (Host or X-Forwarded-Host, as
//     nginx passes it) or PITASKER_ORIGIN (default https://pitasker.piapps.dev).
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export function originAllowed(origin: string, req: Pick<Request, "headers">, publicOrigin = process.env.PITASKER_ORIGIN || "https://pitasker.piapps.dev"): boolean {
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    return false;
  }
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.split(",")[0].trim();
  const hosts = [first(req.headers["x-forwarded-host"]), req.headers.host].filter(Boolean);
  if (hosts.includes(o.host)) return true;
  try {
    return new URL(publicOrigin).origin === o.origin;
  } catch {
    return false;
  }
}

export function sameOrigin(req: Request, res: Response, next: NextFunction) {
  if (SAFE.has(req.method)) return next();
  if (req.headers["sec-fetch-site"] === "cross-site") return res.status(403).json({ message: "Cross-site request refused" });
  const origin = req.headers.origin;
  if (origin && !originAllowed(origin, req)) return res.status(403).json({ message: "Cross-origin request refused" });
  const ct = String(req.headers["content-type"] ?? "");
  if (!/^application\/json\b/i.test(ct)) return res.status(415).json({ message: "Send JSON (Content-Type: application/json)" });
  return next();
}

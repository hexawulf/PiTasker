import type { NextFunction, Request, Response } from "express";

// CSRF guard for state-changing /api requests (the session cookie is
// SameSite=Lax; this is the second layer):
//   - Content-Type must be application/json, body or not (a cross-site <form>
//     or no-cors fetch cannot send it without a CORS preflight, which
//     PiTasker never answers);
//   - Sec-Fetch-Site, when the browser sends it, must not be "cross-site";
//   - Origin, when present, must be this host.
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export function sameOrigin(req: Request, res: Response, next: NextFunction) {
  if (SAFE.has(req.method)) return next();
  if (req.headers["sec-fetch-site"] === "cross-site") return res.status(403).json({ message: "Cross-site request refused" });
  const origin = req.headers.origin;
  if (origin) {
    let host = "";
    try {
      host = new URL(origin).host;
    } catch {
      /* refused below */
    }
    if (host !== req.headers.host) return res.status(403).json({ message: "Cross-origin request refused" });
  }
  const ct = String(req.headers["content-type"] ?? "");
  if (!/^application\/json\b/i.test(ct)) return res.status(415).json({ message: "Send JSON (Content-Type: application/json)" });
  return next();
}

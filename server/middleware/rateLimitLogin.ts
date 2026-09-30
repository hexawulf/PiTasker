import type { NextFunction, Request, Response } from "express";
import { config } from "../config";

// Login / change-password attempts per client address: 10 per 10 minutes.
// Behind Cloudflare (PITASKER_CLOUDFLARE=1) the client is CF-Connecting-IP;
// otherwise req.ip (trust proxy 1 → the address nginx saw). Without the flag
// the header is client-controlled and ignored.
const WINDOW_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 10;

type Entry = { count: number; reset: number };

export function clientKey(req: Pick<Request, "headers" | "ip">, trustCloudflare = config.trustCloudflare): string {
  if (trustCloudflare) {
    const cf = req.headers["cf-connecting-ip"];
    const v = Array.isArray(cf) ? cf[0] : cf;
    if (v && v.trim()) return v.trim();
  }
  return req.ip || "unknown";
}

export function createRateLimiter(max = MAX_ATTEMPTS, windowMs = WINDOW_MS) {
  const bucket = new Map<string, Entry>();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, e] of bucket) if (now > e.reset) bucket.delete(k);
  }, 60_000);
  sweep.unref();
  const limiter = (req: Request, res: Response, next: NextFunction) => {
    const key = clientKey(req);
    const now = Date.now();
    const e = bucket.get(key) ?? { count: 0, reset: now + windowMs };
    if (now > e.reset) {
      e.count = 0;
      e.reset = now + windowMs;
    }
    e.count += 1;
    bucket.set(key, e);
    if (e.count > max) {
      res.setHeader("Retry-After", Math.ceil((e.reset - now) / 1000).toString());
      return res.status(429).json({ message: "Too many attempts. Try again later." });
    }
    return next();
  };
  return Object.assign(limiter, { reset: () => bucket.clear() });
}

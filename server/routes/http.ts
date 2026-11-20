// Helpers shared by the route modules.
import type { NextFunction, Request, Response } from "express";
import type { MutateOptions } from "../crontab/store";
import type { HttpError } from "../errors";

type Handler = (req: Request, res: Response) => Promise<unknown>;

/**
 * Wrap an async handler: an error with a 4xx/5xx `status` (or one `toStatus`
 * maps) becomes `{ message }` with that status; anything else is logged under
 * `[tag]` and passed on to the app's error handler (500).
 */
export function wrapWith(tag: string, toStatus?: (e: unknown) => number | undefined) {
  return (fn: Handler) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch((e: unknown) => {
      const err = e as HttpError;
      const status = toStatus?.(e) ?? err?.status;
      if (status && status >= 400 && status < 600) return res.status(status).json({ message: err.message });
      console.error(`[${tag}] ${req.method} ${req.path}:`, e);
      next(e);
    });
}

/** ?dryRun=1|true and ?expectedHash= (with `body`: also read from the JSON body). */
export function writeOpts(req: Request, opts: { body?: boolean } = {}): MutateOptions {
  const body = opts.body ? req.body : undefined;
  const dry = req.query.dryRun ?? body?.dryRun;
  const hash = req.query.expectedHash ?? body?.expectedHash;
  return {
    dryRun: dry === "1" || dry === "true" || dry === true,
    expectedHash: typeof hash === "string" && hash ? hash : undefined,
  };
}

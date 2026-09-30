// The Express app, built by a factory so tests can create it with their own
// session store (tests/unit/*.test.ts) without starting the server.
//
//   helmet headers ─► JSON body (100 kb) ─► session (pitasker.sid, SameSite=Lax, Secure)
//     ─► /health, /healthz (public)
//     ─► /api/*: sameOrigin (CSRF) ─► routes, each behind isAuthenticated
//                except POST /api/auth/login (rate limited)
//     ─► static SPA + CSP (when a build exists)
import fs from "fs";
import path from "path";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import session from "express-session";
import { installCsp, installSecurityHeaders } from "./security";
import { sameOrigin } from "./middleware/sameOrigin";
import authRoutes from "./routes/auth";
import crontabRoutes from "./routes/crontab";
import { fleetRoutes } from "./routes/fleet";
import type { FleetHub } from "./fleet/hub";
import logsRoutes from "./routes/pitasker-logs";
import systemRoutes from "./routes/system";
import taskRoutes from "./routes/tasks";

export type AppOptions = {
  sessionStore?: session.Store;
  /** Directory with the built SPA (index.html); omit for API-only (tests). */
  staticDir?: string | null;
  sessionSecret?: string;
  /** The fleet hub (tests inject one; default: from the environment, on first use). */
  fleetHub?: FleetHub;
};

export function createApp(opts: AppOptions = {}): Express {
  const app = express();
  app.disable("x-powered-by");
  // nginx (and Cloudflare in front of it) terminate TLS: trust one proxy hop.
  app.set("trust proxy", 1);
  installSecurityHeaders(app);

  app.use(express.json({ limit: "100kb" }));
  app.use(
    session({
      store: opts.sessionStore,
      name: "pitasker.sid",
      secret: opts.sessionSecret ?? process.env.SESSION_SECRET!,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        secure: true,
        sameSite: "lax", // same origin: the SPA and the API share pitasker.piapps.dev
        maxAge: 1000 * 60 * 60 * 24,
      },
    }),
  );

  const health = (_req: Request, res: Response) => res.json({ status: "ok", uptime: Math.round(process.uptime()) });
  app.get("/health", health);
  app.get("/healthz", health);

  app.use("/api", sameOrigin);
  app.use(authRoutes);
  app.use(taskRoutes);
  app.use(systemRoutes);
  app.use("/api/crontab", crontabRoutes);
  app.use(opts.fleetHub ? fleetRoutes(() => opts.fleetHub!) : fleetRoutes());
  app.use("/api/pitasker-logs", logsRoutes);
  app.use("/api", (_req, res) => res.status(404).json({ message: "Not found" }));

  if (opts.staticDir) {
    installCsp(app, opts.staticDir);
    app.use(express.static(opts.staticDir, { index: false, maxAge: "1h", setHeaders: (res, file) => {
      if (/\/assets\//.test(file)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    } }));
    const indexHtml = path.join(opts.staticDir, "index.html");
    app.get("*", (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(indexHtml);
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error & { status?: number; type?: string }, _req: Request, res: Response, _next: NextFunction) => {
    if (err.type === "entity.parse.failed") return res.status(400).json({ message: "Invalid JSON" });
    if (err.type === "entity.too.large") return res.status(413).json({ message: "Request too large" });
    console.error("[server]", err);
    res.status(err.status && err.status < 600 ? err.status : 500).json({ message: "Internal server error" });
  });
  return app;
}

/** dist/public next to the bundle, or client/dist for older layouts. */
export function findStaticDir(baseDir: string): string | null {
  const root = path.resolve(baseDir, "..");
  const candidates = [path.join(baseDir, "public"), path.join(root, "dist", "public"), path.join(root, "client", "dist")];
  return candidates.find((d) => fs.existsSync(path.join(d, "index.html"))) ?? null;
}

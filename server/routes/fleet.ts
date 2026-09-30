// GET /api/fleet[?refresh=1]        every host (hub + PITASKER_HOSTS) + cross-host hints
// GET /api/fleet/:host[?refresh=1]  one host ("local" = the hub)
// Read-only: there are no other fleet routes. Behind isAuthenticated (the
// route-auth test walks them).
import express, { type NextFunction, type Request, type Response } from "express";
import { cachedCollector } from "../fleet/collector";
import { createFleetHub, type FleetHub } from "../fleet/hub";
import { binMasterId, parseFleetHosts } from "../fleet/hosts";
import { stateDir } from "../crontab/store";
import { isAuthenticated } from "../middleware/authMiddleware";
import { version } from "../version";

let defaultHub: FleetHub | null = null;
/** The hub from the environment, made on first use (so importing this never runs a collector). */
export function hubFromEnv(): FleetHub {
  if (!defaultHub) {
    const collect = cachedCollector({ version, ttlMs: 60_000 });
    defaultHub = createFleetHub({
      hosts: parseFleetHosts(),
      collectLocal: (force) => collect(force),
      stateDir: stateDir(),
      hubVersion: version,
      binMaster: binMasterId(),
    });
  }
  return defaultHub;
}

export function fleetRoutes(getHub: () => FleetHub = hubFromEnv) {
  const router = express.Router();
  router.use("/api/fleet", isAuthenticated);
  const force = (req: Request) => req.query.refresh === "1";
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

  router.get(
    "/api/fleet",
    wrap(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await getHub().list(force(req)));
    }),
  );
  router.get(
    "/api/fleet/:host",
    wrap(async (req, res) => {
      const id = req.params.host;
      if (!/^[a-z0-9-]{1,32}$/.test(id) || !getHub().has(id)) return res.status(404).json({ message: "No such host" });
      res.setHeader("Cache-Control", "no-store");
      res.json(await getHub().one(id, force(req)));
    }),
  );
  return router;
}

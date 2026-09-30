// PiTasker agent entry (PITASKER_MODE=agent) → dist/agent.mjs, one
// self-contained file (scripts/build-agent.mjs): only node: built-ins, no
// node_modules, no native modules. Run by the pitasker-agent systemd unit as
// zk (deploy/systemd/pitasker-agent.service.template).
import http from "http";
import { cachedCollector, hostTimeZone } from "../fleet/collector";
import { fleetPaths } from "../fleet/tools";
import { createAgentHandler } from "./app";
import { agentConfig } from "./config";

declare const __PITASKER_VERSION__: string | undefined;
export const AGENT_VERSION = typeof __PITASKER_VERSION__ === "string" ? __PITASKER_VERSION__ : "dev";

function fatal(msg: string): never {
  console.error(`[agent] FATAL: ${msg}`);
  process.exit(1);
}

if (process.env.PITASKER_MODE !== "agent") fatal("PITASKER_MODE=agent is not set (this is the PiTasker agent; the hub is dist/index.js)");
const cfg = agentConfig();
if ("error" in cfg) fatal(cfg.error);
try {
  fleetPaths(); // refuses test/real path mix-ups early
} catch (e) {
  fatal((e as Error).message);
}

const snapshot = cachedCollector({ version: AGENT_VERSION, ttlMs: 30_000 });
let tz: { at: number; value: string } | null = null;
const timeZone = async () => {
  if (!tz || Date.now() - tz.at > 10 * 60_000) tz = { at: Date.now(), value: await hostTimeZone(fleetPaths()) };
  return tz.value;
};

const server = http.createServer(createAgentHandler({ tokenSha256: cfg.tokenSha256, version: AGENT_VERSION, snapshot: () => snapshot(), timeZone }));
server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 50;
server.on("clientError", (_e, socket) => socket.destroy());
server.listen(cfg.port, cfg.bind, () => {
  console.log(`[agent] PiTasker agent ${AGENT_VERSION} (read-only) on ${cfg.bind}:${cfg.port}`);
});
const stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

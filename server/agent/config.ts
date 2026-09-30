// Agent settings (PITASKER_MODE=agent, dist/agent.mjs). The agent refuses to
// start rather than listen somewhere it shouldn't:
//   PITASKER_AGENT_BIND          required; an address of this host; never 0.0.0.0 / ::
//   PITASKER_AGENT_TOKEN_SHA256  required; 64 hex digits (the token's SHA-256)
//   PITASKER_AGENT_PORT          default 5017
import os from "os";
import { SHA256_HEX_RE } from "./auth";

export type AgentConfig = { bind: string; port: number; tokenSha256: string };

export const DEFAULT_AGENT_PORT = 5017;

/** Every address on this host's interfaces (IPv4 and IPv6, without zone ids). */
export function localAddresses(): Set<string> {
  const out = new Set<string>();
  for (const list of Object.values(os.networkInterfaces())) for (const a of list ?? []) out.add(a.address.split("%")[0].toLowerCase());
  return out;
}

export function agentConfig(env: NodeJS.ProcessEnv = process.env, addresses: Set<string> = localAddresses()): AgentConfig | { error: string } {
  const bind = (env.PITASKER_AGENT_BIND || "").trim().toLowerCase();
  if (!bind) return { error: "PITASKER_AGENT_BIND is not set: give the LAN or tunnel address the agent listens on (scripts/install-agent.sh --bind)" };
  if (bind === "0.0.0.0" || bind === "::" || bind === "[::]" || bind === "*") {
    return { error: `PITASKER_AGENT_BIND=${bind} would listen on every interface: use the LAN or tunnel address` };
  }
  if (!addresses.has(bind)) return { error: `PITASKER_AGENT_BIND=${bind.slice(0, 64)} is not an address of this host (is the tunnel up?)` };
  const tokenSha256 = (env.PITASKER_AGENT_TOKEN_SHA256 || "").trim().toLowerCase();
  if (!SHA256_HEX_RE.test(tokenSha256)) {
    return { error: "PITASKER_AGENT_TOKEN_SHA256 must be the 64-hex-digit SHA-256 of the agent token (scripts/install-agent.sh sets it)" };
  }
  const portRaw = (env.PITASKER_AGENT_PORT || String(DEFAULT_AGENT_PORT)).trim();
  const port = Number(portRaw);
  if (!/^\d+$/.test(portRaw) || port < 1 || port > 65535) return { error: `PITASKER_AGENT_PORT must be 1-65535 (got "${portRaw.slice(0, 20)}")` };
  return { bind, port, tokenSha256 };
}

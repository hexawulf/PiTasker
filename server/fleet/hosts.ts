// The hub's fleet hosts (mirrors PiDeck's server/config.ts parseHosts):
//   PITASKER_HOSTS=piapps2=http://192.168.50.120:5017,piapps4=http://10.77.0.4:5017
//   PITASKER_HOST_TOKEN_<ID>     the agent's token (id upper-cased, "-" → "_")
//   PITASKER_HOST_LABELS=piapps2=piapps2 (LAN),…
//   PITASKER_HOST_PRODUCTION=hwca-ap02            marked "production" in the UI
//   PITASKER_BIN_MASTER=piapps2                   bin.git master for "bin replica differs"
// Strict: ids [a-z0-9-]{1,32} ("local" is the hub itself), URLs plain
// http(s)://host[:port] (no credentials, path, query or fragment), a host
// without a usable token is skipped. Warnings never include a token.
// Empty PITASKER_HOSTS = the hub alone (the Fleet page still works).

export type FleetHostEntry = { id: string; label: string; url: string; token: string; production: boolean };

export const hostTokenKey = (id: string) => `PITASKER_HOST_TOKEN_${id.toUpperCase().replace(/-/g, "_")}`;

const HOST_ID = /^[a-z0-9-]{1,32}$/;

function pairs(value: string | undefined, name: string, warn: (m: string) => void): [string, string][] {
  const out: [string, string][] = [];
  for (const raw of (value || "").split(",")) {
    const item = raw.trim();
    if (!item) continue;
    const eq = item.indexOf("=");
    if (eq <= 0) {
      warn(`[config] ${name}: ignoring "${item.slice(0, 40)}" (expected id=value)`);
      continue;
    }
    out.push([item.slice(0, eq).trim(), item.slice(eq + 1).trim()]);
  }
  return out;
}

export function parseFleetHosts(env: NodeJS.ProcessEnv = process.env, warn: (msg: string) => void = (m) => console.warn(m)): FleetHostEntry[] {
  const production = new Set((env.PITASKER_HOST_PRODUCTION || "").split(",").map((s) => s.trim()).filter(Boolean));
  const hosts: FleetHostEntry[] = [];
  for (const [id, rawUrl] of pairs(env.PITASKER_HOSTS, "PITASKER_HOSTS", warn)) {
    if (!HOST_ID.test(id) || id === "local") {
      warn(`[config] PITASKER_HOSTS: ignoring host "${id.slice(0, 40)}" (id must be [a-z0-9-]{1,32}, not "local")`);
      continue;
    }
    if (hosts.some((h) => h.id === id)) {
      warn(`[config] PITASKER_HOSTS: ignoring duplicate host "${id}"`);
      continue;
    }
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      warn(`[config] PITASKER_HOSTS: ignoring host "${id}" (not a URL)`);
      continue;
    }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash || !/^\/?$/.test(url.pathname) || rawUrl.includes("#") || rawUrl.includes("?")) {
      warn(`[config] PITASKER_HOSTS: ignoring host "${id}" (URL must be http(s)://host[:port] with no path, credentials or query)`);
      continue;
    }
    const token = (env[hostTokenKey(id)] || "").trim();
    if (!/^[\x21-\x7e]{16,512}$/.test(token)) {
      warn(`[config] PITASKER_HOSTS: ignoring host "${id}" (${hostTokenKey(id)} is missing or not a valid token)`);
      continue;
    }
    hosts.push({ id, label: id, url: url.origin, token, production: production.has(id) });
  }
  for (const [id, label] of pairs(env.PITASKER_HOST_LABELS, "PITASKER_HOST_LABELS", warn)) {
    const host = hosts.find((h) => h.id === id);
    if (!host) warn(`[config] PITASKER_HOST_LABELS: no host "${id.slice(0, 40)}"`);
    else if (label) host.label = label.slice(0, 64);
  }
  return hosts;
}

export const binMasterId = (env: NodeJS.ProcessEnv = process.env) => (env.PITASKER_BIN_MASTER ?? "piapps2").trim() || null;

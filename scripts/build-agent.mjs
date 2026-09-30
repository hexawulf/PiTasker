#!/usr/bin/env node
// Author:      0xWulf (zk@hexawulf.dev)
// Description: Build dist/agent.mjs — the PiTasker agent as ONE file: every
//              import inlined, only node: built-ins left, no native modules
//              (runs on Node 22 and 24, arm64 and x86_64, with no
//              node_modules on the host). Fails if anything from
//              node_modules or a non-node: import would end up in it.
//              Also writes dist/agent.build-commit (git HEAD).
// Modified:    2026-10-01
// Usage:       node scripts/build-agent.mjs      (npm run build:agent)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const outfile = path.join(root, "dist", "agent.mjs");
let commit = "unknown";
try {
  commit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
} catch {
  /* not a checkout */
}

const r = await build({
  entryPoints: [path.join(root, "server", "agent", "index.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: ["node22"],
  alias: { "@shared": path.join(root, "shared") },
  define: { __PITASKER_VERSION__: JSON.stringify(pkg.version) },
  banner: { js: `// PiTasker agent ${pkg.version} (${commit.slice(0, 7)}) — built by scripts/build-agent.mjs; do not edit.` },
  legalComments: "none",
  metafile: true,
  logLevel: "warning",
});

const inputs = Object.keys(r.metafile.inputs);
const fromModules = inputs.filter((i) => i.includes("node_modules"));
const builtins = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
const imports = r.metafile.outputs[path.relative(process.cwd(), outfile)]?.imports ?? Object.values(r.metafile.outputs)[0].imports;
const foreign = imports.filter((i) => !builtins.has(i.path));
if (fromModules.length || foreign.length) {
  fs.rmSync(outfile, { force: true });
  console.error(`[build-agent] refused: the agent must be self-contained.\n  from node_modules: ${fromModules.join(", ") || "-"}\n  non-built-in imports: ${foreign.map((i) => i.path).join(", ") || "-"}`);
  process.exit(1);
}
fs.writeFileSync(path.join(root, "dist", "agent.build-commit"), `${commit}\n`);
console.log(`[build-agent] dist/agent.mjs ${(fs.statSync(outfile).size / 1024).toFixed(1)} kB from ${inputs.length} files (${commit.slice(0, 7)})`);

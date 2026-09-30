#!/usr/bin/env bash
# Author:      0xWulf (zk@hexawulf.dev)
# Description: Build PiTasker into dist-e2e/ and serve it on :5027 for the
#              Playwright suite. Never touches prod: not dist/ (pm2 serves
#              that on :5007), not the pitasker database (a scratch
#              pitasker_e2e is re-created from PITASKER_TEST_PG_URL), not the
#              real crontab (tests/fakes/crontab is first on PATH as
#              `crontab`, FAKE_CRONTAB_FILE=.e2e/crontab; PITASKER_E2E=1 makes
#              the server refuse to run without it).
#              The admin password is random, in .e2e/password.
#              Fleet (P3): the hub reads itself from the "alpha" fixture
#              (tests/fixtures/fleet, with the fakes for systemctl/journalctl/
#              timedatectl) and talks to real agents from dist-e2e/agent.mjs:
#                beta    :5028  fixture beta  (Europe/Berlin, systemd 255)
#                gamma   :5029  fixture gamma (Asia/Singapore; bin ahead; "production")
#                delta   :5030  closed port → offline, shown from a saved snapshot
#                badtoken:5028  wrong token → auth-error
# Modified:    2026-10-01
# Usage:       PITASKER_TEST_PG_URL=postgres://… scripts/e2e-server.sh [--dry-run]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist-e2e"
E2E="$ROOT/.e2e"
PORT="${E2E_PORT:-5027}"
ADMIN_URL="${PITASKER_TEST_PG_URL:?set PITASKER_TEST_PG_URL (admin URL allowed to CREATE DATABASE)}"
DB_URL="$(node -e 'const u=new URL(process.argv[1]); u.pathname="/pitasker_e2e"; console.log(u.toString())' "$ADMIN_URL")"

if [ "${1:-}" = "--dry-run" ]; then
  echo "would build → $OUT, re-create database pitasker_e2e, serve on :$PORT with a fake crontab ($E2E/crontab)"
  exit 0
fi
case "$OUT" in */dist) echo "refusing to build into prod dist/" >&2; exit 1 ;; esac

mkdir -p "$E2E"; chmod 700 "$E2E"
[ -s "$E2E/password" ] || { (umask 077; openssl rand -base64 24 | tr -d '/+=' > "$E2E/password"); }

cd "$ROOT"
npx vite build --outDir "$OUT/public" --emptyOutDir >"$E2E/build.log" 2>&1
npx esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir="$OUT" >>"$E2E/build.log" 2>&1
node scripts/build-agent.mjs --outdir "$OUT" >>"$E2E/build.log" 2>&1

# Fake crontab, state, logs, a bin.git with one committed script.
mkdir -p "$E2E/fake-bin" "$E2E/state" "$E2E/logs"
for f in "$ROOT"/tests/fakes/*; do ln -sf "$f" "$E2E/fake-bin/$(basename "$f")"; done
cp "$ROOT/tests/fixtures/crontab.curated" "$E2E/crontab"
rm -rf "$E2E/state/crontab-backups"
printf '2026-09-30T08:00:00Z [express] PiTasker started\n2026-09-30T08:00:01Z [scheduler] ok\n' > "$E2E/logs/pitasker-$(date +%F).log"
if [ ! -d "$E2E/bin/.git" ]; then
  mkdir -p "$E2E/bin"
  printf '#!/bin/sh\necho committed\n' > "$E2E/bin/committed-job"
  chmod +x "$E2E/bin/committed-job"
  git -C "$E2E/bin" init -q && git -C "$E2E/bin" add committed-job
  git -C "$E2E/bin" -c user.name=e2e -c user.email=e2e@localhost commit -q -m init
fi
printf '#!/bin/sh\necho new\n' > "$E2E/bin/uncommitted-job"

# Scratch database: dropped and re-created, migrated, one admin.
node -e '
const pg = require("pg");
(async () => {
  const a = new pg.Client({ connectionString: process.argv[1] }); await a.connect();
  await a.query("DROP DATABASE IF EXISTS pitasker_e2e WITH (FORCE)");
  await a.query("CREATE DATABASE pitasker_e2e"); await a.end();
})().catch((e) => { console.error(e.message); process.exit(1); });' "$ADMIN_URL"
DATABASE_URL="$DB_URL" node scripts/migrate.mjs
DATABASE_URL="$DB_URL" PITASKER_ADMIN_PASSWORD="$(cat "$E2E/password")" npx tsx server/seed.ts >/dev/null

# ── Fleet: fixture hosts and agents (never the real system) ──────────────
FLEET="$E2E/fleet"
rm -rf "$FLEET" "$E2E/state/fleet"
mkdir -p "$FLEET" "$E2E/state/fleet"
fixture_env() { node "$ROOT/tests/fleet/materialize.mjs" "$1" "$FLEET/$1"; }
AGENT_TOKEN="e2e-fleet-agent-token-test-only-0123456789abcdef"
AGENT_HASH="$(printf '%s' "$AGENT_TOKEN" | sha256sum | cut -d' ' -f1)"
AGENT_PIDS=()
trap 'kill "${AGENT_PIDS[@]}" 2>/dev/null' EXIT INT TERM
start_agent() { # start_agent FIXTURE PORT
  local envs=()
  mapfile -t envs < <(fixture_env "$1")
  env -i PATH="$E2E/fake-bin:$PATH" HOME="$FLEET/$1/home" PITASKER_E2E=1 PITASKER_FAKE_BIN_DIR="$E2E/fake-bin" "${envs[@]}" \
    PITASKER_MODE=agent PITASKER_AGENT_BIND=127.0.0.1 PITASKER_AGENT_PORT="$2" PITASKER_AGENT_TOKEN_SHA256="$AGENT_HASH" \
    node "$OUT/agent.mjs" >>"$E2E/agents.log" 2>&1 &
  AGENT_PIDS+=("$!")
  for _ in $(seq 1 50); do curl -s -o /dev/null "http://127.0.0.1:$2/" && return 0; sleep 0.1; done
  echo "agent $1 did not start (see $E2E/agents.log)" >&2; exit 1
}
start_agent beta 5028
start_agent gamma 5029
# delta: run once, save its snapshot as the hub would, stop it → offline with data "as of".
start_agent delta 5030
curl -s -H "Authorization: Bearer $AGENT_TOKEN" http://127.0.0.1:5030/api/agent/cron \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{process.stdout.write(JSON.stringify({savedAt:Date.now()-3600e3,snapshot:JSON.parse(s)}))})' \
  > "$E2E/state/fleet/delta.json"
chmod 600 "$E2E/state/fleet/delta.json"
kill "${AGENT_PIDS[-1]}"; unset 'AGENT_PIDS[-1]'
mapfile -t HUB_FLEET < <(fixture_env alpha | grep -Ev '^(FAKE_CRONTAB_FILE|PITASKER_BIN_DIR)=')

echo "serving dist-e2e on :$PORT (fake crontab: $E2E/crontab; fleet agents on :5028/:5029)"
env PATH="$E2E/fake-bin:$PATH" FAKE_CRONTAB_FILE="$E2E/crontab" FAKE_CRONTAB_LOG="$E2E/crontab.log" \
  PITASKER_CRONTAB_BIN="$E2E/fake-bin/crontab" PITASKER_E2E=1 PITASKER_STATE_DIR="$E2E/state" \
  PITASKER_BIN_DIR="$E2E/bin" LOG_DIR="$E2E/logs" PITASKER_TZ=Asia/Taipei \
  PITASKER_FAKE_BIN_DIR="$E2E/fake-bin" "${HUB_FLEET[@]}" \
  PITASKER_HOSTS="beta=http://127.0.0.1:5028,gamma=http://127.0.0.1:5029,delta=http://127.0.0.1:5030,badtoken=http://127.0.0.1:5028" \
  PITASKER_HOST_TOKEN_BETA="$AGENT_TOKEN" PITASKER_HOST_TOKEN_GAMMA="$AGENT_TOKEN" PITASKER_HOST_TOKEN_DELTA="$AGENT_TOKEN" \
  PITASKER_HOST_TOKEN_BADTOKEN="wrong-token-test-only-0123456789abcdef" \
  PITASKER_HOST_LABELS="beta=beta (Berlin),gamma=gamma (Singapore),delta=delta (offline),badtoken=bad token" \
  PITASKER_HOST_PRODUCTION=gamma PITASKER_BIN_MASTER=beta \
  NODE_ENV=production CSP_ENFORCE=true PORT="$PORT" HOST=127.0.0.1 DATABASE_URL="$DB_URL" \
  SESSION_SECRET="e2e-session-secret-test-only-0123456789abcdef" \
  node "$OUT/index.js"

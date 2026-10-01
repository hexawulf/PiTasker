#!/usr/bin/env bash
# Author:      0xWulf (zk@hexawulf.dev)
# Description: Install / update / roll back / remove the read-only PiTasker
#              agent (docs/plans/2.1-fleet-view.md) on a fleet host, as the
#              user it runs as (zk). The agent is ONE file (dist/agent.mjs,
#              built on piapps and copied here); no git clone, no npm.
#                ~/pitasker-agent/{agent.mjs,agent.mjs.prev,.build-commit,.env}
#                /etc/systemd/system/pitasker-agent.service   (systemd-analyze verified)
#                /usr/local/lib/pitasker/root-cron-snapshot   (root-owned) + its
#                  .service/.path/.timer: root's crontab for the agent, no sudo
#                optional ufw rule: port only from the hub
#              Records what it did in ~/.config/pitasker/install-agent;
#              --uninstall removes exactly that. --dry-run prints every action
#              and changes nothing. Never adds a sudoers rule.
# Modified:    2026-10-01
# Usage:       scripts/install-agent.sh --dry-run --bind 192.168.50.120 --bundle ~/agent.mjs
#              scripts/install-agent.sh --bind 192.168.50.120 --ufw-allow-from 192.168.50.102 --bundle ~/agent.mjs
#              scripts/install-agent.sh --bind 10.77.0.4 --ufw-allow-from 10.77.0.1 --ufw-interface wg-pideck \
#                                       --after wg-quick@wg-pideck.service --memory-max 128M --bundle ~/agent.mjs
#              scripts/install-agent.sh --update --bundle ~/agent.mjs    # swap the bundle, keep .env
#              scripts/install-agent.sh --rollback                       # back to agent.mjs.prev
#              scripts/install-agent.sh --uninstall
#              scripts/install-agent.sh --root-snapshot-only             # the hub (piapps): only the root snapshot units
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TS="$(date +%Y%m%d-%H%M%S)"
# Test hooks only (tests/install/run.sh): system paths under a fake root.
ETC="${PITASKER_ETC_DIR:-/etc}"
LIB_DIR="${PITASKER_LIB_DIR:-/usr/local/lib/pitasker}"
VAR_DIR="${PITASKER_VAR_DIR:-/var/lib/pitasker}"
AGENT_DIR="${PITASKER_AGENT_DIR:-$HOME/pitasker-agent}"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/pitasker"
MARKER="$CONFIG_DIR/install-agent"
TOKEN_FILE="$CONFIG_DIR/agent-token"
UNIT=pitasker-agent
SNAP=pitasker-root-cron-snapshot

MODE=install
DRY_RUN=0
BIND=""
PORT=5017
UFW_FROM=""
UFW_IFACE=""
AFTER=""
MEMORY_MAX=128M
BUNDLE=""
SKIP_HEALTH=0

usage() {
  cat <<'EOF'
PiTasker agent installer — scripts/install-agent.sh [options]

  --dry-run                print every action, change nothing (do this first)
  --bind IP                address the agent listens on (required): the LAN or
                           tunnel address; never 0.0.0.0
  --port N                 agent port (default 5017)
  --bundle PATH            the agent.mjs built on piapps (npm run build:agent → dist/agent.mjs)
  --ufw-allow-from IP      add: ufw allow [in on IF] from IP to any port N proto tcp
  --ufw-interface IF       with --ufw-allow-from: only on this interface (e.g. wg-pideck)
  --after UNIT             start after (and pull in) UNIT, e.g. wg-quick@wg-pideck.service
  --memory-max SIZE        systemd MemoryMax= (default 128M; at least 64M)
  --update                 swap in --bundle (old one kept as agent.mjs.prev), keep .env, restart
  --rollback               go back to agent.mjs.prev, restart
  --uninstall              remove exactly what the installer recorded
  --root-snapshot-only     only the root-crontab snapshot units (the hub, piapps)
  --skip-health            don't call the agent after starting it
  -h, --help               this help
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --bind) BIND="${2:?--bind needs an IP}"; shift ;;
    --port) PORT="${2:?--port needs a number}"; shift ;;
    --bundle) BUNDLE="${2:?--bundle needs a path}"; shift ;;
    --ufw-allow-from) UFW_FROM="${2:?--ufw-allow-from needs an IP}"; shift ;;
    --ufw-interface) UFW_IFACE="${2:?--ufw-interface needs an interface}"; shift ;;
    --after) AFTER="${2:?--after needs a unit}"; shift ;;
    --memory-max) MEMORY_MAX="${2:?--memory-max needs a size}"; shift ;;
    --update) MODE=update ;;
    --rollback) MODE=rollback ;;
    --uninstall) MODE=uninstall ;;
    --root-snapshot-only) MODE=snapshot ;;
    --skip-health) SKIP_HEALTH=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 64 ;;
  esac
  shift
done

# ── validation (before anything is touched) ────────────────────────────
is_ip() { [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || [[ "$1" =~ ^[0-9a-fA-F:]+$ && "$1" == *:* ]]; }
if [ "$MODE" = install ]; then
  [ -n "$BIND" ] || { echo "--bind IP is required (the LAN or tunnel address)" >&2; exit 64; }
  [ -n "$BUNDLE" ] || { echo "--bundle PATH is required (dist/agent.mjs from piapps)" >&2; exit 64; }
fi
[ "$MODE" = update ] && { [ -n "$BUNDLE" ] || { echo "--update needs --bundle PATH" >&2; exit 64; }; }
if [ -n "$BIND" ]; then
  is_ip "$BIND" || { echo "--bind must be an IP address" >&2; exit 64; }
  case "$BIND" in 0.0.0.0|::) echo "--bind $BIND would listen on every interface: use the LAN or tunnel address" >&2; exit 64 ;; esac
fi
[[ "$PORT" =~ ^[0-9]+$ ]] && [ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || { echo "--port must be 1-65535" >&2; exit 64; }
[ -z "$UFW_FROM" ] || is_ip "$UFW_FROM" || { echo "--ufw-allow-from must be an IP address" >&2; exit 64; }
[ -z "$UFW_IFACE" ] || [[ "$UFW_IFACE" =~ ^[A-Za-z0-9_.@-]{1,15}$ ]] || { echo "--ufw-interface: bad interface name" >&2; exit 64; }
[ -z "$UFW_IFACE" ] || [ -n "$UFW_FROM" ] || { echo "--ufw-interface goes with --ufw-allow-from" >&2; exit 64; }
if [ -n "$AFTER" ] && { ! [[ "$AFTER" =~ ^[A-Za-z0-9:_.@-]{1,200}\.(service|target|device|mount)$ ]] || [[ "$AFTER" == pitasker-agent.* ]]; }; then
  echo "--after must be a unit name like wg-quick@wg-pideck.service" >&2; exit 64
fi
if ! [[ "$MEMORY_MAX" =~ ^([0-9]+)([MG])$ ]]; then echo "--memory-max must look like 128M or 1G" >&2; exit 64; fi
mem_mb=$(( BASH_REMATCH[1] * $([ "${BASH_REMATCH[2]}" = G ] && echo 1024 || echo 1) ))
[ "$mem_mb" -ge 64 ] || { echo "--memory-max must be at least 64M" >&2; exit 64; }

if [ "$(id -u)" -eq 0 ]; then
  echo "Run this as the user the agent runs as (zk), not as root; sudo is used where needed." >&2
  exit 1
fi

# ── output & logging ───────────────────────────────────────────────────
if [ "$DRY_RUN" = 1 ]; then
  LOG="${TMPDIR:-/tmp}/pitasker-agent-install-dryrun-$TS.log"
else
  mkdir -p "$HOME/logs"
  LOG="$HOME/logs/pitasker-agent-install-$TS.log"
fi
exec 3>&1
exec > >(tee -a "$LOG") 2>&1
if [ -t 3 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-}" != dumb ]; then
  B=$'\033[1m'; RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; CYN=$'\033[36m'; RST=$'\033[0m'
else
  B=""; RED=""; GRN=""; YEL=""; CYN=""; RST=""
fi
step() { printf '\n%s==> %s%s\n' "$B$CYN" "$*" "$RST"; }
ok()   { printf '  %s✓%s %s\n' "$GRN" "$RST" "$*"; }
info() { printf '  %s\n' "$*"; }
warn() { printf '  %s!%s %s\n' "$YEL" "$RST" "$*"; }
die()  { printf '%sError:%s %s\n' "$RED" "$RST" "$*"; exit 1; }
dry()  { printf '  %s[dry-run]%s would %s\n' "$YEL" "$RST" "$*"; }
show_cmd() { local out="" a; for a in "$@"; do out+="$(printf '%q' "$a") "; done; printf '%s' "${out% }"; }
run() { local what="$1"; shift; if [ "$DRY_RUN" = 1 ]; then dry "$what: $(show_cmd "$@")"; return 0; fi; info "$what"; "$@"; }
srun() { local what="$1"; shift; run "$what" sudo "$@"; }
have() { command -v "$1" >/dev/null 2>&1; }

# render TEMPLATE OUT KEY=VALUE… — plain string replacement, no sed.
render() {
  local src="$1" out="$2" line kv; shift 2
  : > "$out"
  while IFS= read -r line || [ -n "$line" ]; do
    for kv in "$@"; do line="${line//"${kv%%=*}"/"${kv#*=}"}"; done
    printf '%s\n' "$line" >> "$out"
  done < "$src"
}

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pitasker-agent-install.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT
RUN_USER="$(id -un)"
RUN_GROUP="$(id -gn)"
RUN_UID="$(id -u)"

# The marker: one KEY=value per line, appended as steps happen.
record() {
  [ "$DRY_RUN" = 1 ] && return 0
  install -d -m 700 "$CONFIG_DIR"
  touch "$MARKER"; chmod 600 "$MARKER"
  grep -qxF "$1" "$MARKER" || printf '%s\n' "$1" >> "$MARKER"
}
recorded() { [ -f "$MARKER" ] && grep -qxF "$1" "$MARKER"; }

# sudo install of a file we rendered, owned by root.
root_install() { # root_install SRC DEST MODE
  srun "install $3 root:root $2" install -o root -g root -m "$3" "$1" "$2"
}

# ── pieces ─────────────────────────────────────────────────────────────
preflight() {
  step "Checks"
  have node || die "node is not installed (the agent needs Node 22 or newer)"
  local major; major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge 22 ] || die "Node $major is too old (need 22+)"
  ok "node $(node -v) at $(command -v node)"
  have systemctl || die "systemctl not found: the agent runs under systemd"
  ok "systemd"
  if [ -n "$BIND" ]; then
    if have ip && ip -o addr show 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | grep -qxF "$BIND"; then ok "$BIND is an address of this host"
    else die "$BIND is not an address of this host (is the tunnel up? ip -o addr)"; fi
  fi
  if [ -n "$BUNDLE" ]; then
    [ -f "$BUNDLE" ] || die "--bundle $BUNDLE: no such file"
    head -c 200 "$BUNDLE" | grep -q "PiTasker agent" || die "--bundle $BUNDLE doesn't look like dist/agent.mjs"
    node --check "$BUNDLE" 2>/dev/null || die "--bundle $BUNDLE: node --check failed"
    ok "bundle $(head -n 1 "$BUNDLE" | sed 's#^// ##; s# — built.*##')"
  fi
}

install_bundle() {
  step "Bundle → $AGENT_DIR"
  run "create $AGENT_DIR (0750)" install -d -m 750 "$AGENT_DIR"
  if [ -f "$AGENT_DIR/agent.mjs" ] && cmp -s "$BUNDLE" "$AGENT_DIR/agent.mjs"; then ok "agent.mjs unchanged"; return 0; fi
  if [ -f "$AGENT_DIR/agent.mjs" ]; then run "keep the current bundle as agent.mjs.prev" cp -p "$AGENT_DIR/agent.mjs" "$AGENT_DIR/agent.mjs.prev"; fi
  run "install agent.mjs (0640)" install -m 640 "$BUNDLE" "$AGENT_DIR/agent.mjs"
  local commit=""
  [ -f "$(dirname "$BUNDLE")/agent.build-commit" ] && commit="$(tr -dc '0-9a-f' < "$(dirname "$BUNDLE")/agent.build-commit" | cut -c1-40)"
  [ -n "$commit" ] || commit="sha256:$(sha256sum "$BUNDLE" | cut -d' ' -f1)"
  if [ "$DRY_RUN" = 1 ]; then dry "write $AGENT_DIR/.build-commit ($commit)"; else printf '%s\n' "$commit" > "$AGENT_DIR/.build-commit"; fi
  record "DIR=$AGENT_DIR"
}

TOKEN=""
write_env() {
  step ".env (0600)"
  local env="$AGENT_DIR/.env" hash=""
  [ -f "$env" ] && hash="$(sed -n 's/^PITASKER_AGENT_TOKEN_SHA256=//p' "$env" | head -n 1)"
  if ! [[ "$hash" =~ ^[0-9a-f]{64}$ ]]; then
    if [ "$DRY_RUN" = 1 ]; then dry "generate a token (32 random bytes), keep only its SHA-256 in .env, the token in $TOKEN_FILE (0600)"; hash="(sha256 of a new token)"
    else
      TOKEN="$(openssl rand -hex 32)"
      hash="$(printf '%s' "$TOKEN" | sha256sum | cut -d' ' -f1)"
      install -d -m 700 "$CONFIG_DIR"
      ( umask 077; printf '%s\n' "$TOKEN" > "$TOKEN_FILE" )
      record "TOKEN_FILE=$TOKEN_FILE"
      ok "new token: its hash is in .env; the token is in $TOKEN_FILE (move it to the hub's .env, then shred it)"
    fi
  else ok "token hash kept (the token is unchanged)"; fi
  local tmp="$TMP_DIR/env"
  {
    printf '# PiTasker agent — written by scripts/install-agent.sh (%s)\n' "$TS"
    printf 'PITASKER_MODE=agent\nPITASKER_AGENT_BIND=%s\nPITASKER_AGENT_PORT=%s\nPITASKER_AGENT_TOKEN_SHA256=%s\n' "$BIND" "$PORT" "$hash"
  } > "$tmp"
  if [ "$DRY_RUN" = 1 ]; then dry "write $env (0600): bind $BIND, port $PORT, token hash"; return 0; fi
  install -m 600 "$tmp" "$env"
}

agent_unit() {
  step "Unit $UNIT.service"
  local tmp="$TMP_DIR/$UNIT.service" after_lines=""
  [ -n "$AFTER" ] && after_lines="After=$AFTER"$'\n'"Wants=$AFTER"
  render "$REPO_DIR/deploy/systemd/pitasker-agent.service.template" "$tmp" \
    "@USER@=$RUN_USER" "@GROUP@=$RUN_GROUP" "@UID@=$RUN_UID" "@AGENT_DIR@=$AGENT_DIR" \
    "@NODE@=$(command -v node)" "@MEMORY_MAX@=$MEMORY_MAX" "@AFTER@=$after_lines"
  grep -q '@[A-Z_]*@' "$tmp" && die "unit template has unfilled placeholders"
  if grep -qE '^(NoNewPrivileges|PrivateDevices|ProtectKernel(Tunables|Modules|Logs)|ProtectClock|RestrictNamespaces|RestrictRealtime|RestrictSUIDSGID|LockPersonality|MemoryDenyWriteExecute|SystemCall(Filter|Architectures)|RestrictAddressFamilies|DynamicUser)=' "$tmp"; then
    die "the unit would (imply) NoNewPrivileges=, which breaks setgid crontab -l"
  fi
  if have systemd-analyze; then
    local verr; verr="$(systemd-analyze verify "$tmp" 2>&1)" || die "systemd-analyze verify rejected the unit: $(printf '%s' "$verr" | head -n 3 | tr '\n' ' ')"
    ok "systemd-analyze verify: OK"
  else warn "systemd-analyze not found: unit not verified"; fi
  root_install "$tmp" "$ETC/systemd/system/$UNIT.service" 644
  record "UNIT=$UNIT.service"
  if [ "$DRY_RUN" != 1 ]; then cp "$tmp" "$CONFIG_DIR/$UNIT.service.rendered"; fi
}

snapshot_units() {
  step "Root crontab snapshot (root-owned; no sudoers rule)"
  local script="$TMP_DIR/root-cron-snapshot" svc="$TMP_DIR/$SNAP.service"
  render "$REPO_DIR/deploy/root-cron-snapshot.sh.template" "$script" "@VAR_DIR@=$VAR_DIR" "@GROUP@=$RUN_GROUP" "@USER@=$RUN_USER"
  render "$REPO_DIR/deploy/systemd/$SNAP.service.template" "$svc" "@LIB_DIR@=$LIB_DIR" "@VAR_DIR@=$VAR_DIR"
  if have systemd-analyze; then
    systemd-analyze verify "$svc" >/dev/null 2>&1 || warn "systemd-analyze verify complained about $SNAP.service (checked again when started)"
  fi
  srun "create $LIB_DIR" install -d -o root -g root -m 755 "$LIB_DIR"
  root_install "$script" "$LIB_DIR/root-cron-snapshot" 755
  root_install "$svc" "$ETC/systemd/system/$SNAP.service" 644
  root_install "$REPO_DIR/deploy/systemd/$SNAP.path" "$ETC/systemd/system/$SNAP.path" 644
  root_install "$REPO_DIR/deploy/systemd/$SNAP.timer" "$ETC/systemd/system/$SNAP.timer" 644
  record "SNAPSHOT_SCRIPT=$LIB_DIR/root-cron-snapshot"
  record "SNAPSHOT_UNITS=$SNAP.service $SNAP.path $SNAP.timer"
}

start_units() {
  step "Start"
  srun "systemctl daemon-reload" systemctl daemon-reload
  srun "enable $SNAP.path + .timer" systemctl enable --now "$SNAP.path" "$SNAP.timer"
  srun "take the first root crontab snapshot" systemctl start "$SNAP.service"
  if [ "$MODE" = snapshot ]; then return 0; fi
  if [ "$DRY_RUN" != 1 ] && systemctl is-active --quiet "$UNIT"; then srun "restart $UNIT" systemctl restart "$UNIT"
  else srun "enable and start $UNIT" systemctl enable --now "$UNIT"; fi
}

firewall() {
  step "Firewall"
  if [ -z "$UFW_FROM" ]; then
    info "Allow only the hub (run on this host):  sudo ufw allow from <hub-ip> to any port $PORT proto tcp"
    return 0
  fi
  have ufw || { warn "ufw isn't installed: rule not added; allow only $UFW_FROM → port $PORT in your firewall"; return 0; }
  local args=(allow)
  [ -n "$UFW_IFACE" ] && args+=(in on "$UFW_IFACE")
  args+=(from "$UFW_FROM" to any port "$PORT" proto tcp)
  srun "ufw ${args[*]}" ufw "${args[@]}" comment pitasker-agent
  record "UFW=${args[*]}"
}

health() {
  step "Health check"
  if [ "$SKIP_HEALTH" = 1 ]; then info "skipped"; return 0; fi
  local bind port url code hdr=()
  bind="$(sed -n 's/^PITASKER_AGENT_BIND=//p' "$AGENT_DIR/.env" 2>/dev/null || true)"; bind="${bind:-$BIND}"
  port="$(sed -n 's/^PITASKER_AGENT_PORT=//p' "$AGENT_DIR/.env" 2>/dev/null || true)"; port="${port:-$PORT}"
  url="http://$bind:$port/api/agent/health"
  if [ "$DRY_RUN" = 1 ]; then dry "GET $url with the token (expect 200) and without (expect 401)"; return 0; fi
  local token=""
  [ -f "$TOKEN_FILE" ] && token="$(tr -d '[:space:]' < "$TOKEN_FILE")"
  if [ -n "$token" ]; then
    ( umask 077; printf 'Authorization: Bearer %s\n' "$token" > "$TMP_DIR/hdr" )
    hdr=(-H "@$TMP_DIR/hdr")
  fi
  for _ in $(seq 1 20); do
    code="$(curl -s -o "$TMP_DIR/health.json" -w '%{http_code}' --max-time 3 "${hdr[@]}" "$url" || true)"
    case "$code" in 200|401) break ;; esac
    sleep 1
  done
  if [ -n "$token" ]; then
    [ "$code" = 200 ] || die "$url answered ${code:-nothing} with the token (journalctl -u $UNIT)"
    grep -q '"write":false' "$TMP_DIR/health.json" || die "$url did not answer as a read-only PiTasker agent"
    ok "agent answers with the token: $(sed -n 's/.*"version":"\([^"]*\)".*/PiTasker agent \1/p' "$TMP_DIR/health.json")"
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$url" || true)"
    [ "$code" = 401 ] || die "$url answered $code without a token (expected 401)"
    ok "and refuses requests without it (401)"
  else
    [ "$code" = 401 ] || die "$url answered ${code:-nothing} (expected 401 without a token; journalctl -u $UNIT)"
    ok "agent answers and refuses requests without the token (the token itself isn't on this host any more)"
  fi
}

summary() {
  step "Done"
  info "Agent:   http://$BIND:$PORT (read-only; GET /api/agent/health, /api/agent/cron)"
  info "Service: systemctl status $UNIT · journalctl -u $UNIT"
  info "Log:     $LOG"
  if [ -n "$TOKEN" ]; then
    {
      printf '\n  %sOn the hub (piapps), add to ~/projects/PiTasker/.env:%s\n' "$B" "$RST"
      printf '    PITASKER_HOSTS=…,<id>=http://%s:%s\n    PITASKER_HOST_TOKEN_<ID>=<the token in %s>\n' "$BIND" "$PORT" "$TOKEN_FILE"
      printf '  then: shred -u %s\n' "$TOKEN_FILE"
    } >&3
  fi
}

uninstall() {
  step "Uninstall (only what $MARKER recorded)"
  [ -f "$MARKER" ] || die "nothing recorded in $MARKER: nothing to remove"
  local line
  if recorded "UNIT=$UNIT.service"; then
    srun "stop and disable $UNIT" systemctl disable --now "$UNIT"
    srun "remove the unit" rm -f "$ETC/systemd/system/$UNIT.service"
  fi
  if grep -q '^SNAPSHOT_UNITS=' "$MARKER"; then
    srun "stop and disable the snapshot units" systemctl disable --now "$SNAP.path" "$SNAP.timer"
    srun "remove the snapshot units" rm -f "$ETC/systemd/system/$SNAP.service" "$ETC/systemd/system/$SNAP.path" "$ETC/systemd/system/$SNAP.timer"
  fi
  line="$(sed -n 's/^SNAPSHOT_SCRIPT=//p' "$MARKER")"
  if [ -n "$line" ]; then
    srun "remove $line" rm -f "$line"
    srun "remove $LIB_DIR if empty" rmdir --ignore-fail-on-non-empty "$LIB_DIR"
    srun "remove the root crontab snapshot" rm -f "$VAR_DIR/root-crontab" "$VAR_DIR/root-crontab.status"
  fi
  srun "systemctl daemon-reload" systemctl daemon-reload
  line="$(sed -n 's/^UFW=//p' "$MARKER")"
  if [ -n "$line" ]; then
    # shellcheck disable=SC2086 # the recorded rule, word by word
    srun "ufw delete $line" ufw delete $line
  fi
  line="$(sed -n 's/^DIR=//p' "$MARKER")"
  if [ -n "$line" ]; then
    run "remove $line" rm -f "$line/agent.mjs" "$line/agent.mjs.prev" "$line/.build-commit" "$line/.env"
    run "remove $line if empty" rmdir --ignore-fail-on-non-empty "$line"
  fi
  line="$(sed -n 's/^TOKEN_FILE=//p' "$MARKER")"
  [ -n "$line" ] && run "remove $line" rm -f "$line"
  run "remove the record" rm -f "$MARKER" "$CONFIG_DIR/$UNIT.service.rendered"
  ok "removed"
}

update() {
  [ -f "$AGENT_DIR/agent.mjs" ] || die "no agent installed in $AGENT_DIR (install it first)"
  preflight
  install_bundle
  step "Restart"
  srun "restart $UNIT" systemctl restart "$UNIT"
  health
}

rollback() {
  [ -f "$AGENT_DIR/agent.mjs.prev" ] || die "no $AGENT_DIR/agent.mjs.prev to roll back to"
  step "Rollback"
  # shellcheck disable=SC2016 # $1 is expanded by the inner bash
  run "swap agent.mjs and agent.mjs.prev" bash -c 'mv "$1/agent.mjs" "$1/agent.mjs.rollback" && mv "$1/agent.mjs.prev" "$1/agent.mjs" && mv "$1/agent.mjs.rollback" "$1/agent.mjs.prev"' _ "$AGENT_DIR"
  srun "restart $UNIT" systemctl restart "$UNIT"
  health
}

[ "$DRY_RUN" = 1 ] && info "DRY RUN — nothing will be changed. Log: $LOG"
case "$MODE" in
  install) preflight; install_bundle; write_env; agent_unit; snapshot_units; start_units; firewall; health; summary ;;
  snapshot) preflight; snapshot_units; start_units; step "Done"; info "root crontab snapshot: $VAR_DIR/root-crontab (the hub reads it)" ;;
  update) update ;;
  rollback) rollback ;;
  uninstall) uninstall ;;
esac

#!/usr/bin/env bash
# Author:      0xWulf (zk@hexawulf.dev)
# Description: Tests for scripts/install-agent.sh and the root-crontab
#              snapshot script, without root and without touching the real
#              system (PiDeck's installer-test style). Each case gets a
#              sandbox: a copy of the installer + deploy/, a fake $HOME, a
#              fake /etc (PITASKER_ETC_DIR), /usr/local/lib/pitasker and
#              /var/lib/pitasker under it, and PATH stubs for sudo,
#              systemctl, systemd-analyze, ufw, curl, ip, id, chown and
#              crontab. Every stubbed call is logged to $W/state/calls.
# Modified:    2026-10-01
# Usage:       tests/install/run.sh            (or: npm run test:install)
set -uo pipefail   # no -e: a failed check is counted, not fatal

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NODE_DIR="$(dirname "$(command -v node)")"
PASS=0; FAIL=0; FAILED=()
ok()   { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
bad()  { FAIL=$((FAIL + 1)); FAILED+=("$CASE: $1"); printf '  FAIL %s\n' "$1"; }
check() { local what="$1"; shift; if "$@"; then ok "$what"; else bad "$what"; fi; }
has()  { grep -qF -- "$2" "$1" 2>/dev/null; }
hasnt() { ! grep -qF -- "$2" "$1" 2>/dev/null; }

new_sandbox() {
  CASE="$1"
  printf '\n%s\n' "$CASE"
  W="$(mktemp -d "${TMPDIR:-/tmp}/pitasker-install-test.XXXXXX")"
  mkdir -p "$W/bin" "$W/home" "$W/root/etc/systemd/system" "$W/root/usr/local/lib" "$W/root/var/lib" "$W/state" "$W/tmp" "$W/src/scripts" "$W/bundles"
  cp "$ROOT/scripts/install-agent.sh" "$W/src/scripts/"
  cp -r "$ROOT/deploy" "$W/src/"
  # An unrelated unit that must survive everything.
  echo "[Unit]" > "$W/root/etc/systemd/system/other.service"
  printf '// PiTasker agent 2.1.0 (aaaaaaa) — built by scripts/build-agent.mjs; do not edit.\nconsole.log("v1");\n' > "$W/bundles/agent-v1.mjs"
  printf '// PiTasker agent 2.1.1 (bbbbbbb) — built by scripts/build-agent.mjs; do not edit.\nconsole.log("v2");\n' > "$W/bundles/agent-v2.mjs"
  echo "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" > "$W/bundles/agent.build-commit"
  write_stubs
}
cleanup() { [ -n "${KEEP:-}" ] && echo "  (kept $W)" && return; [ -n "${W:-}" ] && rm -rf "$W"; }

stub() { local name="$1"; cat > "$W/bin/$name"; chmod +x "$W/bin/$name"; }
write_stubs() {
  local S="$W/state"
  stub id <<EOF
#!/usr/bin/env bash
case "\${1:-}" in -u) echo "\${FAKE_UID:-1000}" ;; -un) echo zk ;; -gn) echo zk ;; *) exec /usr/bin/id "\$@" ;; esac
EOF
  # sudo: record, then run the command as-is (we are "root" in the fake tree);
  # drop install's -o/-g (a test runner that isn't root can't chown).
  stub sudo <<EOF
#!/usr/bin/env bash
echo "sudo \$*" >> "$S/calls"
if [ "\$1" = install ]; then
  args=(); shift
  while [ \$# -gt 0 ]; do case "\$1" in -o|-g) shift 2 ;; *) args+=("\$1"); shift ;; esac; done
  exec install "\${args[@]}"
fi
exec "\$@"
EOF
  stub systemctl <<EOF
#!/usr/bin/env bash
echo "systemctl \$*" >> "$S/calls"
case "\$*" in
  "is-active --quiet "*) [ -f "$S/active-\$3" ]; exit ;;
  "enable --now pitasker-agent") touch "$S/active-pitasker-agent" ;;
  "disable --now pitasker-agent") rm -f "$S/active-pitasker-agent" ;;
esac
exit 0
EOF
  stub systemd-analyze <<EOF
#!/usr/bin/env bash
echo "systemd-analyze \$*" >> "$S/calls"
! grep -q '@[A-Z_]*@' "\${@: -1}"
EOF
  stub ufw <<EOF
#!/usr/bin/env bash
echo "ufw \$*" >> "$S/calls"
EOF
  stub ip <<'EOF'
#!/usr/bin/env bash
printf '1: lo    inet 127.0.0.1/8 scope host lo\n2: eth0    inet 192.168.50.120/24 brd 192.168.50.255 scope global eth0\n3: wg-pideck    inet 10.77.0.4/24 scope global wg-pideck\n'
EOF
  # curl: the agent's /api/agent/health; 200 when the bearer token (from
  # -H @file) hashes to the .env's PITASKER_AGENT_TOKEN_SHA256, else 401.
  stub curl <<EOF
#!/usr/bin/env bash
out="" hfile="" url=""
while [ \$# -gt 0 ]; do
  case "\$1" in
    -o) out="\$2"; shift ;;
    -H) case "\$2" in @*) hfile="\${2#@}" ;; esac; shift ;;
    -w|--max-time) shift ;;
    http*) url="\$1" ;;
  esac
  shift
done
echo "curl \$url" >> "$S/calls"
[ -e "$S/agent-down" ] && { printf 000; exit 7; }
want="\$(sed -n 's/^PITASKER_AGENT_TOKEN_SHA256=//p' "$W/home/pitasker-agent/.env" 2>/dev/null)"
got=""
[ -n "\$hfile" ] && got="\$(sed -n 's/^Authorization: Bearer //p' "\$hfile" | tr -d '\n' | sha256sum | cut -d' ' -f1)"
if [ -n "\$got" ] && [ "\$got" = "\$want" ]; then
  printf '{"version":"2.1.0","host":"piapps2","tz":"Asia/Taipei","capabilities":{"cron":true,"write":false}}' > "\${out:-/dev/stdout}"; printf 200
else printf '{"message":"Unauthorized"}' > "\${out:-/dev/stdout}"; printf 401; fi
EOF
  stub chown <<EOF
#!/usr/bin/env bash
echo "chown \$*" >> "$S/calls"
EOF
  # crontab for the snapshot script: -l -u root → \$S/root-crontab, "none" → no crontab, "fail" → error
  stub crontab <<EOF
#!/usr/bin/env bash
echo "crontab \$*" >> "$S/calls"
[ "\$*" = "-l -u root" ] || { echo "fake crontab: unexpected \$*" >&2; exit 2; }
case "\$(cat "$S/root-mode" 2>/dev/null || echo ok)" in
  none) echo "no crontab for root" >&2; exit 1 ;;
  fail) echo "crontab: permission denied" >&2; exit 1 ;;
  *) cat "$S/root-crontab" ;;
esac
EOF
}

# inst ARGS… — run the installer in the sandbox (as "zk", fake /etc, fake $HOME)
inst() {
  env -i PATH="$W/bin:$NODE_DIR:/usr/local/bin:/usr/bin:/bin" HOME="$W/home" TMPDIR="$W/tmp" NO_COLOR=1 \
    PITASKER_ETC_DIR="$W/root/etc" PITASKER_LIB_DIR="$W/root/usr/local/lib/pitasker" PITASKER_VAR_DIR="$W/root/var/lib/pitasker" \
    FAKE_UID="${FAKE_UID:-1000}" bash "$W/src/scripts/install-agent.sh" "$@" > "$W/state/out" 2>&1
}
tree() { (cd "$W" && find home root -printf '%p %m %s\n' 2>/dev/null | sort); }
calls() { cat "$W/state/calls" 2>/dev/null; }
UNITF() { echo "$W/root/etc/systemd/system/pitasker-agent.service"; }

# ── cases ──────────────────────────────────────────────────────────────
new_sandbox "dry run changes nothing"
before="$(tree)"
inst --dry-run --bind 192.168.50.120 --ufw-allow-from 192.168.50.102 --bundle "$W/bundles/agent-v1.mjs"; rc=$?
check "exit 0" [ "$rc" = 0 ]
check "the fake /etc and \$HOME are untouched" [ "$before" = "$(tree)" ]
check "no mutating call ran" bash -c "! grep -E '^(sudo|systemctl|ufw|chown)' '$W/state/calls'"
check "prints the unit it would install" has "$W/state/out" "would install 644 root:root $W/root/etc/systemd/system/pitasker-agent.service"
check "prints the ufw rule" has "$W/state/out" "ufw allow from 192.168.50.102 to any port 5017 proto tcp"
check "the unit is verified even in a dry run" has "$W/state/calls" "systemd-analyze verify"
cleanup

new_sandbox "install (LAN host)"
inst --bind 192.168.50.120 --ufw-allow-from 192.168.50.102 --bundle "$W/bundles/agent-v1.mjs"; rc=$?
check "exit 0" [ "$rc" = 0 ] || cat "$W/state/out"
A="$W/home/pitasker-agent"
check "agent.mjs installed" cmp -s "$A/agent.mjs" "$W/bundles/agent-v1.mjs"
check ".env is 0600" [ "$(stat -c %a "$A/.env")" = 600 ]
check ".env: mode, bind, port" bash -c "grep -qx PITASKER_MODE=agent '$A/.env' && grep -qx PITASKER_AGENT_BIND=192.168.50.120 '$A/.env' && grep -qx PITASKER_AGENT_PORT=5017 '$A/.env'"
TOK="$W/home/.config/pitasker/agent-token"
check "token file 0600" [ "$(stat -c %a "$TOK")" = 600 ]
check "token is 64 hex" grep -qxE '[0-9a-f]{64}' "$TOK"
check ".env holds only the token's sha256" [ "$(sed -n 's/^PITASKER_AGENT_TOKEN_SHA256=//p' "$A/.env")" = "$(tr -d '\n' < "$TOK" | sha256sum | cut -d' ' -f1)" ]
check "the token itself is not in .env or the log" bash -c "! grep -qF \"\$(cat '$TOK')\" '$A/.env' '$W/home/logs/'pitasker-agent-install-*.log"
U="$(UNITF)"
check "unit installed" [ -f "$U" ]
check "unit: CapabilityBoundingSet= (empty)" grep -qx 'CapabilityBoundingSet=' "$U"
check "unit: AmbientCapabilities= (empty)" grep -qx 'AmbientCapabilities=' "$U"
check "unit: no NoNewPrivileges=" bash -c "! grep -q '^NoNewPrivileges' '$U'"
check "unit: nothing that implies NoNewPrivileges" bash -c "! grep -qE '^(PrivateDevices|ProtectKernel|ProtectClock|RestrictNamespaces|RestrictRealtime|RestrictSUIDSGID|LockPersonality|MemoryDenyWriteExecute|SystemCall|RestrictAddressFamilies|DynamicUser)' '$U'"
check "unit: ProtectSystem=strict, ProtectHome=read-only, PrivateTmp" bash -c "grep -qx ProtectSystem=strict '$U' && grep -qx ProtectHome=read-only '$U' && grep -qx PrivateTmp=yes '$U'"
check "unit: MemoryMax=128M (default), User=zk, runs agent.mjs" bash -c "grep -qx MemoryMax=128M '$U' && grep -qx User=zk '$U' && grep -q 'agent.mjs\$' '$U'"
check "unit: no placeholders left" bash -c "! grep -q '@[A-Z_]*@' '$U'"
check "snapshot script installed 0755" [ "$(stat -c %a "$W/root/usr/local/lib/pitasker/root-cron-snapshot")" = 755 ]
check "snapshot .service/.path/.timer installed" bash -c "for s in service path timer; do [ -f '$W/root/etc/systemd/system/pitasker-root-cron-snapshot.'\$s ] || exit 1; done"
check "snapshot units enabled, first snapshot taken" bash -c "grep -q 'systemctl enable --now pitasker-root-cron-snapshot.path pitasker-root-cron-snapshot.timer' '$W/state/calls' && grep -q 'systemctl start pitasker-root-cron-snapshot.service' '$W/state/calls'"
check "agent enabled" has "$W/state/calls" "systemctl enable --now pitasker-agent"
check "ufw rule exactly as asked" has "$W/state/calls" "ufw allow from 192.168.50.102 to any port 5017 proto tcp comment pitasker-agent"
check "no sudoers file, no sudo -u" bash -c "! find '$W/root/etc' -name 'sudoers*' | grep -q . && ! grep -q 'sudo -u' '$W/state/calls'"
check "health: 200 with the token, 401 without" bash -c "grep -q 'agent answers with the token' '$W/state/out' && grep -q 'refuses requests without it' '$W/state/out'"
check "marker records what was done" bash -c "grep -qx 'UNIT=pitasker-agent.service' '$W/home/.config/pitasker/install-agent' && grep -q '^UFW=allow from 192.168.50.102' '$W/home/.config/pitasker/install-agent'"
check ".build-commit written" [ -s "$A/.build-commit" ]
hash1="$(sed -n 's/^PITASKER_AGENT_TOKEN_SHA256=//p' "$A/.env")"

printf '  (re-run)\n'
: > "$W/state/calls"
inst --bind 192.168.50.120 --ufw-allow-from 192.168.50.102 --bundle "$W/bundles/agent-v1.mjs"; rc=$?
check "re-run: exit 0" [ "$rc" = 0 ]
check "re-run: token unchanged" [ "$(sed -n 's/^PITASKER_AGENT_TOKEN_SHA256=//p' "$A/.env")" = "$hash1" ]
check "re-run: no .prev for the same bundle" [ ! -e "$A/agent.mjs.prev" ]
check "re-run: restart, not enable" has "$W/state/calls" "systemctl restart pitasker-agent"

printf '  (update)\n'
inst --update --bundle "$W/bundles/agent-v2.mjs"; rc=$?
check "update: exit 0" [ "$rc" = 0 ] || cat "$W/state/out"
check "update: new bundle" cmp -s "$A/agent.mjs" "$W/bundles/agent-v2.mjs"
check "update: previous kept as agent.mjs.prev" cmp -s "$A/agent.mjs.prev" "$W/bundles/agent-v1.mjs"
check "update: .env kept" [ "$(sed -n 's/^PITASKER_AGENT_TOKEN_SHA256=//p' "$A/.env")" = "$hash1" ]
check "update: .build-commit from the bundle's build" grep -qx "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" "$A/.build-commit"

printf '  (rollback)\n'
inst --rollback; rc=$?
check "rollback: exit 0" [ "$rc" = 0 ]
check "rollback: v1 is live again" cmp -s "$A/agent.mjs" "$W/bundles/agent-v1.mjs"
check "rollback: v2 is now .prev" cmp -s "$A/agent.mjs.prev" "$W/bundles/agent-v2.mjs"

printf '  (uninstall)\n'
: > "$W/state/calls"
inst --uninstall; rc=$?
check "uninstall: exit 0" [ "$rc" = 0 ] || cat "$W/state/out"
check "uninstall: unit and snapshot units gone" bash -c "! ls '$W/root/etc/systemd/system/' | grep -q pitasker"
check "uninstall: unrelated unit kept" [ -f "$W/root/etc/systemd/system/other.service" ]
check "uninstall: snapshot script gone" [ ! -e "$W/root/usr/local/lib/pitasker/root-cron-snapshot" ]
check "uninstall: the same ufw rule deleted" has "$W/state/calls" "ufw delete allow from 192.168.50.102 to any port 5017 proto tcp"
check "uninstall: agent dir, token file and marker gone" bash -c "[ ! -e '$A' ] && [ ! -e '$TOK' ] && [ ! -e '$W/home/.config/pitasker/install-agent' ]"
check "uninstall: units disabled" bash -c "grep -q 'systemctl disable --now pitasker-agent' '$W/state/calls' && grep -q 'systemctl disable --now pitasker-root-cron-snapshot.path pitasker-root-cron-snapshot.timer' '$W/state/calls'"
cleanup

new_sandbox "install (VPS over the tunnel): --after, --ufw-interface, --memory-max"
inst --bind 10.77.0.4 --ufw-allow-from 10.77.0.1 --ufw-interface wg-pideck --after wg-quick@wg-pideck.service --memory-max 128M --bundle "$W/bundles/agent-v1.mjs"; rc=$?
check "exit 0" [ "$rc" = 0 ] || cat "$W/state/out"
U="$(UNITF)"
check "After= and Wants= the tunnel" bash -c "grep -qx 'After=wg-quick@wg-pideck.service' '$U' && grep -qx 'Wants=wg-quick@wg-pideck.service' '$U'"
check "MemoryMax=128M" grep -qx 'MemoryMax=128M' "$U"
check "ufw only on wg-pideck" has "$W/state/calls" "ufw allow in on wg-pideck from 10.77.0.1 to any port 5017 proto tcp comment pitasker-agent"
cp "$U" "$W/state/rendered.service"
cleanup

new_sandbox "refusals"
inst --bind 0.0.0.0 --bundle "$W/bundles/agent-v1.mjs"; check "0.0.0.0 → exit 64" [ $? = 64 ]
inst --bind 192.168.50.99 --bundle "$W/bundles/agent-v1.mjs"; rc=$?
check "an address not on this host → exit 1" [ "$rc" = 1 ]
check "…with a reason" has "$W/state/out" "is not an address of this host"
inst --bind 192.168.50.120; check "no --bundle → exit 64" [ $? = 64 ]
inst --bind 192.168.50.120 --bundle "$W/nope.mjs"; check "missing bundle → exit 1" [ $? = 1 ]
printf 'console.log(1)\n' > "$W/bundles/random.mjs"
inst --bind 192.168.50.120 --bundle "$W/bundles/random.mjs"; check "not an agent bundle → exit 1" [ $? = 1 ]
inst --bind 192.168.50.120 --after 'x; rm -rf /' --bundle "$W/bundles/agent-v1.mjs"; check "bad --after → exit 64" [ $? = 64 ]
inst --bind 192.168.50.120 --memory-max 32M --bundle "$W/bundles/agent-v1.mjs"; check "--memory-max below 64M → exit 64" [ $? = 64 ]
FAKE_UID=0 inst --bind 192.168.50.120 --bundle "$W/bundles/agent-v1.mjs"; check "as root → exit 1" [ $? = 1 ]
inst --uninstall; check "uninstall with nothing recorded → exit 1" [ $? = 1 ]
inst --rollback; check "rollback with nothing installed → exit 1" [ $? = 1 ]
check "nothing was installed by any refusal" bash -c "! ls '$W/root/etc/systemd/system/' | grep -q pitasker && [ ! -e '$W/home/pitasker-agent' ]"
printf 'PrivateDevices=yes\n' >> "$W/src/deploy/systemd/pitasker-agent.service.template"
inst --bind 192.168.50.120 --bundle "$W/bundles/agent-v1.mjs"; rc=$?
check "a template option that implies NoNewPrivileges is refused" bash -c "[ $rc = 1 ] && grep -q 'breaks setgid crontab' '$W/state/out'"
cleanup

new_sandbox "--root-snapshot-only (the hub)"
inst --root-snapshot-only; rc=$?
check "exit 0" [ "$rc" = 0 ] || cat "$W/state/out"
check "snapshot units installed" [ -f "$W/root/etc/systemd/system/pitasker-root-cron-snapshot.service" ]
check "no agent unit, no agent dir" bash -c "[ ! -e '$(UNITF)' ] && [ ! -e '$W/home/pitasker-agent' ]"
check "agent not started" hasnt "$W/state/calls" "systemctl enable --now pitasker-agent"
cleanup

new_sandbox "the root crontab snapshot script"
S="$W/state"; V="$W/root/var/lib/pitasker"
sed -e "s#@VAR_DIR@#$V#g" -e "s#@GROUP@#zk#g" -e "s#@USER@#zk#g" "$ROOT/deploy/root-cron-snapshot.sh.template" > "$W/snap.sh"
snap() { env -i PATH="$W/bin:/usr/bin:/bin" bash -c "sed -i 's#^PATH=.*#PATH=$W/bin:/usr/bin:/bin#' '$W/snap.sh'; sh '$W/snap.sh'" > "$S/snap-out" 2>&1; }
printf '# root\n0 2 * * 0 /usr/local/sbin/fstrim-all\n' > "$S/root-crontab"
snap; rc=$?
check "exit 0" [ "$rc" = 0 ] || cat "$S/snap-out"
check "copied byte-for-byte" cmp -s "$V/root-crontab" "$S/root-crontab"
check "0640" [ "$(stat -c %a "$V/root-crontab")" = 640 ]
check "group set to zk" has "$S/calls" "chown root:zk"
check "status ok" grep -qx ok "$V/root-crontab.status"
check "no temp files left" bash -c "! ls -A '$V' | grep -q '^\\.'"
echo none > "$S/root-mode"
snap; check "no crontab for root → exit 0" [ $? = 0 ]
check "…an empty file" [ ! -s "$V/root-crontab" ]
check "…status none" grep -qx none "$V/root-crontab.status"
printf '0 1 * * * x\n' > "$S/root-crontab"; echo ok > "$S/root-mode"; snap
echo fail > "$S/root-mode"
snap; check "an error → exit 1" [ $? = 1 ]
check "…and the previous snapshot is kept" cmp -s "$V/root-crontab" "$S/root-crontab"
cleanup

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then printf '  %s\n' "${FAILED[@]}"; exit 1; fi

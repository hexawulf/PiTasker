#!/bin/sh
# Author:      0xWulf (zk@hexawulf.dev)
# Description: A fake `crontab` for tests (unit + E2E). Put it first on PATH
#              (as `crontab`) and point FAKE_CRONTAB_FILE at a scratch file;
#              the real crontab is never touched. Mirrors the real binary's
#              behaviour PiTasker relies on:
#                crontab -l  prints the file, or "no crontab for …" + exit 1
#                crontab -   installs stdin; rejects a missing final newline
#              Test knobs: FAKE_CRONTAB_LOG (append argv per call),
#              FAKE_CRONTAB_FAIL_WRITE=1, FAKE_CRONTAB_MANGLE=1 (store
#              something else than was sent, to exercise the read-back check).
# Modified:    2026-09-30
set -eu
f="${FAKE_CRONTAB_FILE:?FAKE_CRONTAB_FILE is not set: refusing to act as crontab}"
if [ -n "${FAKE_CRONTAB_LOG:-}" ]; then echo "crontab $*" >> "$FAKE_CRONTAB_LOG"; fi
case "${1:-}" in
  -l)
    if [ -e "$f" ]; then cat "$f"; else echo "no crontab for ${USER:-test}" >&2; exit 1; fi
    ;;
  -)
    tmp="$f.tmp.$$"
    cat > "$tmp"
    if [ -n "${FAKE_CRONTAB_FAIL_WRITE:-}" ]; then rm -f "$tmp"; echo "fake crontab: write refused" >&2; exit 1; fi
    if [ -s "$tmp" ] && [ "$(tail -c1 "$tmp" | od -An -c | tr -d ' ')" != '\n' ]; then
      rm -f "$tmp"; echo "\"-\":1: premature EOF" >&2; echo "errors in crontab file, can't install." >&2; exit 1
    fi
    if [ -n "${FAKE_CRONTAB_MANGLE:-}" ]; then echo "# mangled" >> "$tmp"; fi
    mv "$tmp" "$f"
    ;;
  -r) rm -f "$f" ;;
  *) echo "fake crontab: unsupported arguments: $*" >&2; exit 2 ;;
esac

# Changelog

All notable changes to PiTasker. Versions follow semver per phase
(docs/plans/2.0.md): 2.0.0 = P1 + P2.

## [Unreleased] — 2.0.0 (P1 + P2), live on piapps since 2026-09-30

### Added
- **About dialog** (ⓘ in the header, like PiDeck's): tech stack, contact,
  repo, version and release date, and a copyable diagnostics line (version,
  user@host, time zone, tasks per runner, cron journal, RSS, theme, viewport)
- README: version line, screenshot (demo crontab), what's new, roadmap

### Changed
- E2E: toast assertions look inside the toast region only (`toastText()`);
  Radix copies the text into a short-lived `role="status"` announcement, and
  a page-wide `getByText` could match both (strict-mode flake)

### Fixed
- **Jobs ran twice** (hotfix `0b12891` on main, now a tested model): a task
  is run by the crontab *or* by PiTasker. Moving it between the two
  (`POST /api/tasks/:id/runner`, the 1.x toggle route) edits the crontab and
  (un)schedules immediately; a PiTasker-run task whose command an active
  crontab line has is refused; the Crontab tab lists any command that runs
  twice.
- PiTasker's own schedules use the **host's time zone** (was UTC).
- **Crontab writes destroyed the hand-curated crontab**: 1.x rebuilt it
  from parsed entries (dropping comments, sections, env, blank and disabled
  lines) and piped it through a shell. Now every line is kept byte-for-byte,
  writes use `crontab -` via spawn + stdin, with a backup before and a
  read-back check after (restore on mismatch). Import never writes; an
  unchanged export writes nothing.
- Only some crontab lines had `# PITASKER_ID:` markers because import never
  wrote any; ids of unmarked lines stay the derived md5 (stable, as in
  `cd77a22`); markers are added only to lines PiTasker changes or adds.
- **Stuck status**: stale `running` rows are reset at start, a `last_run` in
  the future is cleared, and crontab-run tasks show "run by cron" (plus the
  last start from the job's log file or the cron journal) instead of a
  status PiTasker never saw.
- **Runner** kept only stdout *or* stderr: both are kept (tail, capped),
  with exit code, signal, duration and a run history (`task_runs`); a
  timeout kills the whole process group; jobs no longer inherit PiTasker's
  secrets; `%` works as in cron; the crontab's `SHELL=`/`PATH=` apply.
- The logs API put the file name in the URL path (`…/x.log`), which nginx
  answers with 403: it is a query parameter now.
- Logout cleared the wrong cookie.

### Security
- Login and change-password rate limit; session id regenerated at login;
  cookie SameSite=Lax (was None); same-origin JSON required for changes
  (CSRF); helmet headers; CSP with inline-script hashes (Report-Only until
  `CSP_ENFORCE=true`); `SESSION_SECRET` ≥ 16 characters required;
  password rules (≥ 12 chars, ≤ 72 bytes, not the username/current one),
  other sessions ended on change; `db:seed` no longer creates a user with
  a password from the repository; `/health` no longer reports memory.
- `npm audit --omit=dev`: 11 (2 critical, 6 high) → 0. Firebase removed
  (it never delivered notifications: no service worker).

### Changed
- New UI in the PiDeck 2.0 design language (tokens, light/dark, shortcuts,
  390 px, axe-clean): tasks with plain-language schedules and next runs,
  a schedule builder, run history, the crontab as written with diffs before
  every write, backups with restore. JS bundle 679.8 → 371.0 kB.
- Schema via drizzle migrations (`npm run db:migrate`), with a baseline
  for 1.x databases; the server refuses to start with pending migrations.
- Auth routes are under `/api/auth/*`; `/api/crontab/{sync,raw,status}` and
  `DELETE /api/crontab/:taskId` are gone (import/export/validate/backups and
  the runner route replace them).
- One pm2 file (`ecosystem.config.cjs`); 1.x status docs → `docs/archive/`.

### Added
- Tests: vitest (168 incl. real-Postgres suites and a route-auth walk),
  Playwright E2E against a fake `crontab` and a scratch database.
- Env: `CSP_ENFORCE`, `PITASKER_CLOUDFLARE`, `PITASKER_ORIGIN`, `PITASKER_TZ`,
  `PITASKER_RUN_TIMEOUT_MS`, `PITASKER_OUTPUT_CAP`, `PITASKER_STATE_DIR`,
  `PITASKER_CRONTAB_BIN`, `PITASKER_BIN_DIR`, `PITASKER_CRON_JOURNAL`, `HOST`,
  `PITASKER_ADMIN_USER` / `PITASKER_ADMIN_PASSWORD` (seed).

### Rollout (piapps, operator, in this order)
1. Review in a worktree: `git worktree add ../PiTasker-2.0 feat/2.0-p1p2`,
   `npm ci && npm run check && npm run check:theme`,
   `PITASKER_TEST_PG_URL=… npm test`, `PITASKER_TEST_PG_URL=… npm run test:e2e`
   (fake crontab, database `pitasker_e2e`, port 5027).
2. Record the current state: `crontab -l > ~/pitasker-crontab-before.txt`;
   `psql pitasker -c "select id,name,cron_schedule,is_system_managed,status from tasks order by id"`
   — note tasks with `is_system_managed = false`: their schedules now run in
   Asia/Taipei instead of UTC.
3. Back up the database: `pg_dump -Fc pitasker > ~/backups/pitasker-$(date +%F).dump`.
4. `pm2 stop pitasker` (1.x must not write the crontab during the switch).
5. In `/home/zk/projects/PiTasker`: check out the reviewed commit, `npm ci`.
6. `.env`: remove the `VITE_FIREBASE_*` lines; add `CSP_ENFORCE=false`
   (not `PITASKER_CLOUDFLARE`: piapps' nginx already restores the client IP
   from Cloudflare, so `req.ip` is right and the header would be trusted
   from anyone reaching the origin); make sure `SESSION_SECRET` has ≥ 32 characters
   (`openssl rand -hex 32`; everyone is logged out if it changes).
7. `npm run db:status` (expect "baseline mark first"), then `npm run db:migrate`.
8. `npm run build`.
9. `pm2 delete pitasker && pm2 start ecosystem.config.cjs && pm2 save`
   (the pm2 file changed).
10. Check `pm2 logs pitasker`: `reset stale state: …` (the five stuck tasks),
    `[scheduler] time zone Asia/Taipei; PiTasker runs N task(s), the crontab runs M`,
    `[csp] Report-Only`.
11. `crontab -l | cmp - ~/pitasker-crontab-before.txt` → identical.
12. In the UI: log in; Crontab → Import… preview (existing tasks show
    "already a task"; nothing should say "runs twice"); Export tasks →
    expect "Already in sync" (if a diff appears, read it — Cancel writes
    nothing); Logs tab shows the log; Settings shows Asia/Taipei.
13. For 10 minutes compare `journalctl -u cron --since "-10 min" | grep CMD`
    with `pm2 logs pitasker --lines 200 | grep "\[run\]"`: no command in both.
14. After a day without `[csp]` lines: `CSP_ENFORCE=true`, `pm2 restart pitasker`.
15. Optional: `PITASKER_CRON_JOURNAL=on` if zk can read the journal
    (`journalctl -u cron -n1` works as zk).
16. Then version 2.0.0, CHANGELOG date, tag, GitHub release.

Rollback: `pm2 stop pitasker`, check out `main`, `npm ci && npm run build`,
`pm2 start ecosystem.config.cjs`. Migration 0001 only adds tables, so 1.x
runs on the migrated database; crontab backups are in
`~/.local/state/pitasker/crontab-backups/`.

## 1.0.0
- Initial release (see docs/archive/ for the 1.x notes).

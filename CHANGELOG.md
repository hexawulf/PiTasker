# Changelog

All notable changes to PiTasker. Versions follow semver per phase
(docs/plans/2.0.md): 2.0.0 = P1 + P2.

## [2.4.2] — 2026-11-24 (own domain: pitasker.dev)

### Changed
- **PiTasker has its own domain: [pitasker.dev](https://pitasker.dev/).** The canonical URL, `og:url`, sitemap, robots.txt `Sitemap` line and README link point there (#41). `pitasker.piapps.dev` now redirects to it with a 301.
- The default public origin for the same-origin check (`PITASKER_ORIGIN` when unset) is `https://pitasker.dev` (#41).

### Added
- **About shows the website**: a "Website" entry links to pitasker.dev, above the GitHub repo. The About e2e test checks the link.

## [2.4.1] — 2026-11-24 (log retention: config + tests)

### Changed
- **Log settings go through `server/config.ts`** like every other setting: `LOG_DIR`, `LOG_RETENTION_DAYS` and `LOG_CLEANUP_DRY_RUN` are now `config.logDir`, `config.logRetentionDays` and `config.logCleanupDryRun`. Same values and defaults as before.
- The default `LOG_DIR` and `PITASKER_BIN_DIR` are under the running user's home directory (`~/logs/pitasker`, `~/bin`) instead of a fixed `/home/zk` path. Installs that set them in `.env` are unchanged.

### Added
- Unit tests for log retention: the retention window (today included, 1-day edge, undated and impossible dates kept), dry run deletes nothing, a real run deletes only old dated `*.log` files, a symlink is removed without touching its target, a missing dir is skipped, and `cleanup()` never rejects. The path check and the `.catch()` handlers on the scheduled cleanup stay as defence in depth.

## [2.4.0] — 2026-11-23 (public landing page)

### Added
- **Public landing page on `/`** for signed-out visitors: what PiTasker does (six feature cards from the README), a task list and crontab diff preview drawn with `--pi-*` tokens and demo jobs (no images, so it follows light/dark and never shows a real crontab), the quick-start commands and a teal **Sign in** button. Lazy chunk (~4 KB gzip), same-origin only.
- The PiTasker title on the login page links back to `/`; the landing footer shows the version (Vite `define`, no API call: every `/api` route needs a session).

### Changed
- Signed out, only `/` and `/login` render; every other path (a deep link) still goes to `/login`. Signed in, `/` still goes to `/tasks`.
- E2E: `auth.setup.ts` starts from a deep link (`/tasks` → `/login`) instead of `/`; new `tests/e2e/landing.spec.ts` (same-origin, CSP, console, axe in both themes, 390 px, routing).

### Rollout
Pull `main`, run `npm ci && npm run build`, `pm2 restart pitasker`, and verify `/healthz`, the landing page on `/` when signed out, and the About version (`v2.4.0`).

## [2.3.2] — 2026-11-23 (teal palette & audit cleanup)

### Changed
- **Teal brand palette**: migrated UI accent tokens, logo tile, and favicon from blue to canonical teal (`#0D9488` / `#0F766E` / `#2DD4BF`); updated focus rings (`--ring`), native checkbox/radio `accent-color`, and crontab managed-line caption (`"Lines with a teal edge"`).
- **UI & mobile polish**: restored WCAG-AA outlined semantic status pills (`ok`, `exit N`, `timeout`, `disabled`, `conflict`) that were previously unstyled; added semantic error/warning left-border accents on failing task cards; tightened Fleet `All jobs` table widths so right-edge `Hints` pills no longer clip at `1440px`; aligned `AboutModal` surface, mobile width, scroll cap, and accent links; compacted and auto-scrolled the `390px` mobile tab bar and aligned `TaskCard` runner badges; lightened dark-mode Google sign-in button surface.
- **Dependencies**: bumped `lucide-react` to `^1.76.0` (Dependabot PR #35) and removed the orphaned `@grpc/grpc-js` npm override (`0` vulnerabilities).
- **Docs**: fixed stale API route, CSS path, and layout entries in `AGENTS.md` and `README.md`, and moved misplaced JSDoc in `server/services/exec.ts`.

### Fixed
- **Server & scheduler**: fixed `LOG_RETENTION_DAYS` fallback on empty/invalid values (no longer crashes at import); fixed DST spring-forward bug in `nextRuns()` skipping `00:xx` runs after a 23h day; guarded crontab cache with a monotonic generation counter against stale pre-write reads; skipped redundant cache invalidation on `?dryRun=1`; validated `PORT` (`1..65535`) and added graceful `SIGTERM`/`SIGINT` shutdown; filtered `GET /api/pitasker-logs` via `resolveSafeLogPath()` with `[]` on `ENOENT`; checked `getApps()` before reading Firebase credentials; loaded `.env` in `drizzle.config.ts`.
- **Fleet & installer**: redacted quoted `curl -u "user:pass"` / `'user:pass'` arguments; marked `NaN` `generatedAt` timestamps as `"stale"`; used `os.userInfo().homedir` in the test-mode `PITASKER_BIN_DIR` guard; fixed intermittent `set -o pipefail` SIGPIPE (141) and `exec > >(tee)` exit flush race in `scripts/install-agent.sh`.

### Removed
- Dead API routes (`GET /api/tasks/stats`, `GET /api/crontab/check-access`), unused `insertTaskSchema`/`updateTaskSchema` aliases, dead `client/dist` static fallback, four unused `--pi-chart-*` CSS tokens, and duplicate `.gitignore` entries.

### Rollout
Pull `main`, run `npm ci && npm run build`, `pm2 restart pitasker`, and verify `/healthz` and the About version (`v2.3.2`). Existing Fleet agents remain compatible; an optional agent update picks up quoted `curl -u` redaction.

## [2.3.1] — 2026-11-22 (dependency updates)

### Changed

- Dependabot updates: the minor/patch group (firebase 0.16.7/1.13.11, tanstack-query, drizzle-orm 0.45.4, firebase-admin 14.5.1, pg 8.23.1, wouter 3.13, Playwright 1.65.1, eslint 10.15, typescript 5.9.3 …), vitest 5.1.1, `@types/node` 26, dotenv 18, tailwind-merge 3, lucide-react 1.x; GitHub Actions `checkout` 7 and `setup-node` 7.
- No app or agent changes; `dist/agent.mjs` stays node-built-ins only.

### Rollout

Build in the production checkout, `pm2 restart pitasker`, check `/healthz` and the About version. Agents need no update.

## [2.3.0] — 2026-11-20 (quality pass: leaner code, lint, docs)

### Added
- **Fleet empty states**: with filters set, "No job matches the filters."
  and a *Clear filters* button; without filters, "Nothing is scheduled on any
  host yet." and, when the hub is the only host, a pointer to
  `PITASKER_HOSTS`. Both cases used to read "No job matches the filters.".
- **Lint**: ESLint (`npm run lint`, also in CI) with the recommended rule
  sets of `@eslint/js`, `typescript-eslint` and `eslint-plugin-react-hooks`;
  no stylistic rules.
- **Docs**: README rewrite (badges, features, how it works, configuration,
  deployment), `SECURITY.md`, new screenshots of Tasks, Fleet and the dark
  theme made from the E2E harness with demo data (`npm run screenshots`),
  `engines` (Node ≥ 22) and `.nvmrc`.

### Fixed
- **Firebase login errors**: an unexpected error (database, session store)
  in `POST /api/auth/firebase-login` was answered with 401 and its raw
  message; it is now logged and answered with a generic 500. The
  verifier's own errors (400/401/403/503) are unchanged.
- **Task updates racing a delete**: four task routes answered 500 (a
  TypeError) when the task was deleted during the update; they now answer
  404 "Task not found".

### Changed
- One set of route helpers (`server/routes/http.ts`: error wrapper,
  dry-run/expected-hash options), one `httpError()` (`server/errors.ts`),
  and the crontab read cache in `server/crontab/cache.ts` instead of a route
  file. One `isFirebaseEnabled()` for the CSP and the login; one
  service-account parse.
- React state: the task form mounts on every open instead of resetting
  in an effect; the run history and the log page derive their default
  selection; shortcut handlers no longer read refs during render.
- One `CONTROL_CHARS` pattern for schedules, commands and task names
  (task names still also refuse tabs).
- `.env.example` and the 2.1 fleet-view plan use placeholders (example.com
  addresses, documentation IP ranges, generic host ids) instead of real
  ones.

### Removed
- `docs/archive/` (ten 1.x notes, ~5,800 lines; still in git history, last
  at tag `v2.2.3`).
- The `re2js` override (no longer in the dependency tree).

## [2.2.3] — 2026-11-18 (Security hardening, performance & codebase slimming)

### Added
- **CI & Dependabot (`PT-A10`)**: Added GitHub Actions workflow (`.github/workflows/ci.yml`) running `check`, `check:theme`, `check:shell`, `test`, `test:install`, `build`, and `test:e2e` on Node 22 with PostgreSQL 16, and `.github/dependabot.yml` for weekly npm and GitHub Actions updates.

### Changed
- **Performance (`PT-A16`–`PT-A21`)**: Lazy-loaded secondary routes (`CrontabPage`, `FleetPage`, `LogsPage`, `SettingsPage`, `LoginPage`) via `React.lazy` and dynamically imported the Firebase Auth SDK chunk only when `firebaseEnabled` is active; shared a 3s TTL + in-flight deduplicated `cachedCrontab()` across `/api/tasks`, `/api/crontab`, and `/api/crontab/validate`; narrowed `cronSeen.ts` `journalctl` query to `-o short-unix --grep` with parallel log `stat`; parallelized `collector.ts`, `scriptCheck.ts`, and `sync.ts` I/O; cached `Intl` formatters and gated `/api/auth/config` on unauthenticated sessions.
- **Dependencies & slimming (`PT-A10`, `PT-A22`–`PT-A26`)**: Replaced the umbrella `firebase` package with `@firebase/app` + `@firebase/auth`, removed unused `@tailwindcss/typography` and `tailwindcss-animate`, deleted dead `client/src/lib/notify.ts`, `server/services/notificationService.ts`, and `docs/archive/verify-crontab-integration.sh`, removed unused storage methods, Radix re-exports, and 1.x CSS classes, broke the `shared/fleet.ts` ↔ `shared/fleet-view.ts` circular import, and losslessly palettized `docs/screenshots/tasks.png`.

### Security
- **Authentication & session hardening (`PT-A01`, `PT-A02`, `PT-A06`)**: Enforced `checkRevoked: true` and `email_verified === true` in Firebase `verifyIdToken()`, failed closed when `FIREBASE_ENABLED=true` and service account credentials are missing, bounded the login rate-limiter Map (`10,000` keys with expired/LRU eviction) and reset caller count on successful login, bounded auth input lengths, checked `req.session.save` errors, and matched cookie attributes on `res.clearCookie`.
- **CSRF, CSP, input validation & log route hardening (`PT-A03`, `PT-A05`, `PT-A07`, `PT-A08`, `PT-A11`–`PT-A14`)**: Checked `Referer` in `sameOrigin` when `Origin` is absent; mounted `installCsp` before `/api/*` routes; rejected embedded `\r`/`\n` and C0 control characters in `parseCron`, task names, and commands; rejected symlinks and leading-`-` filenames in `/api/pitasker-logs/file`; delegated unexpected 500 errors in `/api/crontab` to `next(e)`; destroyed child stdout/stderr streams on post-exit timeout; bounded agent failure rate-limiter Map with LRU eviction.
- **Fleet redaction (`PT-A09`)**: Expanded `server/fleet/redact.ts` to redact space-separated CLI secret flags (`--password`, `--token`, `--secret`, `--api-key`, `-u user:pass`), common API token prefixes (`ghp_`, `github_pat_`, `sk-`, `xox[baprs]-`), and `CREDENTIAL`/`COOKIE`/`WEBHOOK` environment variables.
- **Dependency advisories (`PT-A04`, `PT-A10`)**: Upgraded `zod` to `^4.6.7` (`GHSA-mrhx-c7xc-m3w5`), `vite` to `^8.3.8`, `vitest` to `^5.1.0`, and pinned patched transitive versions via `overrides` (`npm audit --omit=dev` → 0 vulnerabilities).

## [2.2.2] — 2026-10-04 (Fix Google Auth popup COOP & Referrer-Policy)

### Fixed
- **Authentication**: Disabled helmet default `Cross-Origin-Opener-Policy: same-origin` and configured `Referrer-Policy: strict-origin-when-cross-origin`. This prevents the browser from severing `window.opener` during Google OAuth popup flows, resolving `Firebase: Error (auth/popup-closed-by-user)`.

## [2.2.0] — 2026-10-04 (Google Firebase authentication & break-glass fallback)

### Added
- **Authentication**: Google Firebase Authentication with strict server-side email allowlist (`FIREBASE_ALLOWED_EMAILS`).
- **Break-glass access**: Retained local username & password authentication as an offline break-glass fallback.
- **Security & CSP**: Updated helmet Content-Security-Policy to allow Firebase Auth domains in `script-src`, `connect-src`, `frame-src`, and `img-src`.
- **API**: Added `GET /api/auth/config` for client initialization and `POST /api/auth/firebase-login` with rate limiting and session regeneration.

## [2.1.0] — 2026-10-01 (P3: read-only fleet view)

Live on the hub with agents on four hosts (one on the LAN, three over a
WireGuard tunnel); PiDeck watches `pitasker-agent` on the agent hosts.

### Added
- **Fleet tab** (`g f`): every host's zk + root crontab, /etc/crontab,
  cron.d, run-parts and system + user timers; schedules and next runs in
  each host's zone (CRON_TZ/TZ honoured), last run (cron journal, log
  file, systemd), hints (same job on two hosts, script not in bin.git, bin
  replica differs, disabled), by-host and all-jobs views, filters in the
  URL, offline hosts from their saved snapshot. Read-only: no edit, run or
  toggle controls.
- **PiTasker agent** (`dist/agent.mjs`, one self-contained file): GET-only
  `/api/agent/health` + `/api/agent/cron`, bearer token (SHA-256 on the
  agent, timingSafeEqual, 429), refuses 0.0.0.0 or a foreign bind address,
  redaction before anything leaves the host, 30 s cache.
- Hub: `GET /api/fleet[?refresh=1]`, `GET /api/fleet/:host`; agents fetched
  in parallel (5 s, 1 MB, no redirects, zod-validated); snapshots saved to
  `PITASKER_STATE_DIR/fleet/<id>.json` (0600). No DB migration.
- `scripts/install-agent.sh` (+ `deploy/`): agent unit with an empty
  capability bounding set (no sudo from the agent) and no NoNewPrivileges
  (setgid crontab -l); root crontab via a root-owned snapshot service/path/
  timer (no sudoers rule); `--dry-run`, `--update`, `--rollback`,
  `--uninstall`, `--root-snapshot-only`.
- Parser: system-crontab mode (a user field), with round-trip tests.
- Tests: fakes for systemctl/journalctl/timedatectl, four fixture hosts
  (systemd 255 + 259; Asia/Taipei, Asia/Singapore, Europe/Berlin, Etc/UTC),
  installer tests (`npm run test:install`), E2E with two real agents.
- Env (hub): `PITASKER_HOSTS`, `PITASKER_HOST_TOKEN_<ID>`,
  `PITASKER_HOST_LABELS`, `PITASKER_HOST_PRODUCTION`, `PITASKER_BIN_MASTER`,
  `PITASKER_ROOT_CRON_SNAPSHOT`, `PITASKER_ETC_DIR`. Agent (written by the
  installer): `PITASKER_MODE=agent`, `PITASKER_AGENT_BIND`,
  `PITASKER_AGENT_PORT`, `PITASKER_AGENT_TOKEN_SHA256`.

### Changed
- `tests/fake-crontab.sh` moved to `tests/fakes/crontab`.
- E2E About test waits for the dialog animation before axe (was timing-dependent).
- About dialog: fleet view in the description and stack, release date October 2026.

## [2.0.0] — 2026-09-30 (P1 + P2)

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

### Rollout (production host, operator, in this order)
1. Review in a worktree: `git worktree add ../PiTasker-2.0 feat/2.0-p1p2`,
   `npm ci && npm run check && npm run check:theme`,
   `PITASKER_TEST_PG_URL=… npm test`, `PITASKER_TEST_PG_URL=… npm run test:e2e`
   (fake crontab, database `pitasker_e2e`, port 5027).
2. Record the current state: `crontab -l > ~/pitasker-crontab-before.txt`;
   `psql pitasker -c "select id,name,cron_schedule,is_system_managed,status from tasks order by id"`
   — note tasks with `is_system_managed = false`: their schedules now run in
   the host's time zone instead of UTC.
3. Back up the database: `pg_dump -Fc pitasker > ~/backups/pitasker-$(date +%F).dump`.
4. `pm2 stop pitasker` (1.x must not write the crontab during the switch).
5. In the live checkout: check out the reviewed commit, `npm ci`.
6. `.env`: remove the `VITE_FIREBASE_*` lines; add `CSP_ENFORCE=false`
   (not `PITASKER_CLOUDFLARE`: the production nginx already restores the client IP
   from Cloudflare, so `req.ip` is right and the header would be trusted
   from anyone reaching the origin); make sure `SESSION_SECRET` has ≥ 32 characters
   (`openssl rand -hex 32`; everyone is logged out if it changes).
7. `npm run db:status` (expect "baseline mark first"), then `npm run db:migrate`.
8. `npm run build`.
9. `pm2 delete pitasker && pm2 start ecosystem.config.cjs && pm2 save`
   (the pm2 file changed).
10. Check `pm2 logs pitasker`: `reset stale state: …` (the five stuck tasks),
    `[scheduler] time zone <host zone>; PiTasker runs N task(s), the crontab runs M`,
    `[csp] Report-Only`.
11. `crontab -l | cmp - ~/pitasker-crontab-before.txt` → identical.
12. In the UI: log in; Crontab → Import… preview (existing tasks show
    "already a task"; nothing should say "runs twice"); Export tasks →
    expect "Already in sync" (if a diff appears, read it — Cancel writes
    nothing); Logs tab shows the log; Settings shows the host's time zone.
13. For 10 minutes compare `journalctl -u cron --since "-10 min" | grep CMD`
    with `pm2 logs pitasker --lines 200 | grep "\[run\]"`: no command in both.
14. After a day without `[csp]` lines: `CSP_ENFORCE=true`, `pm2 restart pitasker`.
15. Optional: `PITASKER_CRON_JOURNAL=on` if the PiTasker user can read the
    journal (`journalctl -u cron -n1` works as that user).
16. Then version 2.0.0, CHANGELOG date, tag, GitHub release.

Rollback: `pm2 stop pitasker`, check out `main`, `npm ci && npm run build`,
`pm2 start ecosystem.config.cjs`. Migration 0001 only adds tables, so 1.x
runs on the migrated database; crontab backups are in
`~/.local/state/pitasker/crontab-backups/`.

## 1.0.0
- Initial release (the 1.x notes were kept in `docs/archive/` up to tag `v2.2.3`).

# PiTasker

The cron editor for the HexaWulf homelab: see, edit and run the jobs in a
user's crontab from a web UI, and let PiTasker itself run the jobs that
should not live in cron. Runs on piapps as the pm2 app `pitasker`
(<https://pitasker.piapps.dev>, port 5007 behind nginx + Cloudflare).

Version 2.0 (this branch) is a fix-and-refresh release; the plan, including
the fleet view (P3) and fleet editing (P4), is in [docs/plans/2.0.md](docs/plans/2.0.md).

## What it does

- **One runner per task.** A task runs from the **crontab** (PiTasker keeps
  its line in sync) **or** from **PiTasker's scheduler** — never both.
  Moving a task between runners edits the crontab and (un)schedules at once.
  PiTasker's own schedules use the host's time zone.
- **The crontab stays yours.** Comments, section headers, env lines
  (`MAILTO=`, `PATH=`, `TZ=`), blank lines, `@reboot`/`@daily`, `\%`
  escapes and `# DISABLED …` lines are kept byte-for-byte. Importing never
  writes the crontab; an unchanged export writes nothing. PiTasker only adds
  its own `# PITASKER_ID:` / `# PITASKER_COMMENT:` markers above lines it
  changes or adds, and never re-enables a line you commented out.
- **Every crontab write is shown first** as a diff, then sent with the hash
  of what you saw (refused if the crontab changed meanwhile). Before each
  write the old crontab is saved to `~/.local/state/pitasker/crontab-backups/`
  (newest 50), and after it the crontab is read back and compared; on a
  mismatch the old one is restored. Backups can be restored from the UI.
- **Runs PiTasker starts** (scheduled or *Run now*) are recorded: exit code,
  duration, stdout and stderr (tail kept), timeout kills the whole process
  group. The job gets a cron-like environment (no PiTasker secrets).
  For crontab-run jobs PiTasker shows when cron last started them where it
  can tell (the job's log file, or the cron journal with
  `PITASKER_CRON_JOURNAL=on`).
- **Readable schedules**: "every 5 min", "daily 07:04 Asia/Taipei", next
  three runs, an editor with presets, per-field inputs and live validation,
  and a warning when a script is outside `/home/zk/bin` or not committed to
  bin.git (the operator rule).

## Stack

React 18 + Vite + Tailwind (PiDeck 2.0 tokens) · Express 4 · PostgreSQL
(drizzle-orm, migrations in `migrations/`) · node-cron · Node 22.
Memory: about 120–135 MB RSS on piapps (pm2 limit 256 MB).

## Setup

```bash
npm ci
cp .env.example .env        # PORT, DATABASE_URL, SESSION_SECRET (openssl rand -hex 32), …
npm run db:migrate          # creates or upgrades the schema (baselines a 1.x database)
npm run db:seed             # first install only: creates "admin" (random password printed once,
                            # or PITASKER_ADMIN_PASSWORD)
npm run build
pm2 start ecosystem.config.cjs && pm2 save
```

The server refuses to start while migrations are pending. Every setting is
listed in [.env.example](.env.example); new in 2.0: `CSP_ENFORCE`,
`PITASKER_CLOUDFLARE`, `PITASKER_ORIGIN`, `PITASKER_TZ`, `PITASKER_RUN_TIMEOUT_MS`,
`PITASKER_OUTPUT_CAP`, `PITASKER_STATE_DIR`, `PITASKER_CRONTAB_BIN`,
`PITASKER_BIN_DIR`, `PITASKER_CRON_JOURNAL`, `HOST`,
`PITASKER_ADMIN_USER`/`PITASKER_ADMIN_PASSWORD` (seed only). The Firebase
variables are gone.

## Security

Login required for every `/api` route except login itself (a test walks the
router to enforce it). Login and password changes are rate-limited
(10 / 10 min per client; `PITASKER_CLOUDFLARE=1` counts per
CF-Connecting-IP — only when the proxy in front does *not* already restore the
client IP; piapps' nginx does, so it stays off there). Session cookie `pitasker.sid`: Secure, HttpOnly,
SameSite=Lax, new id at login. State-changing requests must be same-origin
JSON. helmet headers and a CSP with hashes of the inline scripts (Report-Only
until `CSP_ENFORCE=true`; violations are logged as `[csp]` lines). New
passwords: at least 12 characters, not the username or the current one;
changing it logs out other sessions.

## Development and tests

```bash
npm run dev                 # tsx server/index.ts (needs a build for the UI, or run vite separately)
npm run check               # tsc
npm run check:theme         # no raw colours outside the --pi-* tokens
npm test                    # vitest; DB suites need PITASKER_TEST_PG_URL (admin URL, creates pitasker_test_*)
npm run test:e2e            # Playwright; needs PITASKER_TEST_PG_URL; serves dist-e2e/ on :5027
```

Tests never touch the real crontab or database: a fake `crontab`
(`tests/fake-crontab.sh`) is first on PATH with `FAKE_CRONTAB_FILE`, and the
crontab code refuses to run under vitest/E2E without it; `server/db.ts`
refuses any database but `pitasker_test_*` / `pitasker_e2e*` in a test run.

## Layout

```
client/src/        React SPA (pages: tasks, crontab, logs, settings)
server/app.ts      Express app factory (routes, session, CSRF guard, CSP)
server/crontab/    document.ts (line-preserving parser/editor), store.ts (crontab IO,
                   backups, read-back), sync.ts (tasks ⇄ crontab)
server/services/   exec.ts (runs a command), taskRunner.ts, taskScheduler.ts,
                   cronSeen.ts, scriptCheck.ts
shared/cron.ts     cron validation, plain-language descriptions, next runs (server + client)
shared/schema.ts   tables and validation
migrations/        drizzle SQL; scripts/migrate*.mjs apply them
docs/plans/2.0.md  the 2.0 plan; docs/archive/ the 1.x notes
```

## License

MIT — see [LICENSE](LICENSE).

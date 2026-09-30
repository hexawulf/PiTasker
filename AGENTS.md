# PiTasker — agent instructions

PiTasker edits a real user's crontab and runs shell commands. Treat both as
production: the hand-curated zk crontab on piapps must survive every change.

## Commands

```bash
npm ci
npm run check                      # tsc (must pass)
npm run check:theme                # UI colours only from --pi-* tokens
PITASKER_TEST_PG_URL=postgres://postgres:…@127.0.0.1:5432/postgres npm test
PITASKER_TEST_PG_URL=… npm run test:e2e     # PW_CHROMIUM=/path/to/chrome if browsers aren't installed
npm run build                      # client + server + dist/agent.mjs
npm run test:install               # installer tests (stubs; no root)
npm run check:shell                # shellcheck
npm run db:generate                # after editing shared/schema.ts (then review the SQL)
npm run db:migrate | db:status     # never `drizzle-kit push` against a real database
```

## Rules

- **Never run the real `crontab` or touch a real database from tests.** Use
  the fake (`tests/fakes/crontab`, `FAKE_CRONTAB_FILE`) and scratch
  databases (`pitasker_test_*`, `pitasker_e2e`). The code enforces this
  under `VITEST` / `PITASKER_E2E`; don't weaken those guards.
- **Crontab edits go through `server/crontab/`.** `document.ts` keeps every
  line byte-for-byte; add operations there (pure functions on the doc), and
  write via `mutateCrontab()` (lock, dry run, expected hash, backup,
  read-back, restore). Never build crontab text by joining parsed entries,
  never pipe through a shell. Add a round-trip test for any new line shape.
- **One runner per task**: `isSystemManaged` true = the crontab runs it,
  false = PiTasker. Every route that changes a task calls
  `taskScheduler.sync()`/`unschedule()`; keep the order in
  `server/routes/tasks.ts` (header comment) so a failed crontab write
  never leaves a task running twice or not at all.
- **Every `/api` route needs `isAuthenticated`** except `POST /api/auth/login`;
  `tests/unit/route-auth.test.ts` fails otherwise. State-changing requests
  are JSON (`sameOrigin`).
- **The fleet view is read-only (P3).** The agent (`server/agent/`) has
  exactly `GET /api/agent/health` and `GET /api/agent/cron`, no request
  parameters, no write code; `/api/fleet*` routes are GET only (the
  route-auth test checks). The collector runs programs only through
  `runTool()` (execFile, fixed argv) and redacts before returning. Never
  add sudo, a sudoers rule, or `NoNewPrivileges=` (or an option that
  implies it) to the agent unit — setgid `crontab -l` needs it absent.
- `dist/agent.mjs` must stay self-contained (node: built-ins only):
  import only types from `shared/fleet.ts` in agent code; the build fails otherwise.
- Jobs run with `jobEnv()` — never pass `process.env` (secrets) to them.
- Schema changes: edit `shared/schema.ts`, `npm run db:generate`, commit
  the SQL + snapshot; never edit an applied migration.
- UI: PiDeck 2.0 design language — tokens in `client/src/index.css`,
  primitives in `components/ui`, `ConfirmDialog` for anything destructive,
  the diff dialog (`useCrontabWrite`) for anything that writes the crontab.
  Keep 390 px free of horizontal scroll and axe clean (E2E checks both).
- Commit messages: conventional (`fix(scope): …`), say why. Don't bump the
  version, tag or deploy unless asked; releases are done from the CLI.

## Deploy (operator, CLI)

pm2 app `pitasker` runs `/home/zk/projects/PiTasker/dist/index.js`;
building in that checkout deploys. See the rollout steps in the CHANGELOG
entry for the release.

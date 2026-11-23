import { Link } from "wouter";
import { CalendarClock, FileDiff, History, Layers, ListTodo, LogIn, Network, ShieldCheck, Terminal } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

// Public landing page for signed-out visitors on "/" (lazy chunk: signed-in users never load it).
// Same-origin only: no images, fonts or scripts from elsewhere; external sites are plain links.
// The preview is drawn with theme tokens and made-up demo jobs, so it follows light/dark and
// never shows a real crontab.

declare const __APP_VERSION__: string;
const APP_VERSION = typeof __APP_VERSION__ === "undefined" ? "dev" : __APP_VERSION__;

const REPO_URL = "https://github.com/hexawulf/PiTasker";

/** GitHub mark (lucide has no brand icons); currentColor, so it follows the theme. */
function GitHubMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

const FEATURES = [
  {
    icon: Layers,
    title: "One runner per task",
    text: "Each job runs from the crontab or from PiTasker's scheduler, never both. Moving a job between them edits the crontab and the scheduler in one step.",
  },
  {
    icon: FileDiff,
    title: "A diff before every write",
    text: "See exactly what changes before the crontab is written. The old one is backed up first, the new one is read back, and a mismatch is rolled back.",
  },
  {
    icon: ShieldCheck,
    title: "Your crontab stays yours",
    text: "Comments, section headers, env lines, @reboot and commented-out jobs are kept byte for byte. PiTasker only adds its own markers above its lines.",
  },
  {
    icon: History,
    title: "Run history",
    text: "Exit code, duration, stdout and stderr for every run PiTasker starts, and the last start of cron-run jobs from their logs or the cron journal.",
  },
  {
    icon: CalendarClock,
    title: "Readable schedules",
    text: "“every 5 min”, “weekdays 06:30”, the next three runs in the host's time zone, and an editor with presets and live validation.",
  },
  {
    icon: Network,
    title: "Fleet view, read-only",
    text: "Every crontab, /etc/cron.d, cron.daily and systemd timer on every host in one page, with hints like same job on two hosts or script not in git.",
  },
] as const;

function DemoJob({ name, schedule, runner, status }: { name: string; schedule: string; runner: string; status: "ok" | "fail" }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <span className="min-w-0">
        <span className="block truncate font-mono text-xs text-pi-text">{name}</span>
        <span className="block text-[11px] text-pi-text-muted">{schedule}</span>
      </span>
      <span className="flex flex-shrink-0 items-center gap-2">
        <span className="rounded border border-pi-border px-1.5 py-0.5 text-[10px] text-pi-text-muted">{runner}</span>
        <span
          className={`h-2 w-2 rounded-full ${status === "ok" ? "bg-pi-success" : "bg-pi-warning"}`}
          aria-hidden="true"
        />
      </span>
    </li>
  );
}

/** Decorative preview, drawn with tokens and demo data. */
function TasksPreview() {
  return (
    <figure
      className="rounded-xl border border-pi-border bg-pi-darker p-3 shadow-2xl sm:p-4"
      aria-label="Example PiTasker task list and crontab diff with demo data"
      data-testid="landing-preview"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded bg-pi-brand">
            <ListTodo className="h-3.5 w-3.5 text-pi-on-accent" aria-hidden="true" />
          </span>
          <span className="text-sm font-semibold text-pi-text">Tasks</span>
          <span className="text-xs text-pi-text-muted">· demo-host</span>
        </div>
        <span className="rounded border border-pi-border px-1.5 py-0.5 font-mono text-[10px] text-pi-text-muted">?</span>
      </div>
      <div className="rounded-md border border-pi-border bg-pi-card px-3">
        <ul className="divide-y divide-pi-border">
          <DemoJob name="backup-photos.sh" schedule="daily 03:40 · next in 5 h" runner="cron" status="ok" />
          <DemoJob name="disk-report.sh" schedule="weekdays 06:30" runner="cron" status="ok" />
          <DemoJob name="cert-check.sh" schedule="every 6 h" runner="PiTasker" status="ok" />
          <DemoJob name="sync-notes.sh" schedule="every 15 min · exit 1" runner="PiTasker" status="fail" />
        </ul>
      </div>
      <div className="mt-2 rounded-md bg-pi-terminal-bg p-3 font-mono text-[11px] leading-relaxed text-pi-terminal-text">
        <div className="text-pi-terminal-muted">crontab diff · 1 change</div>
        <div className="text-pi-terminal-muted"># PITASKER_ID: 7</div>
        <div>
          <span className="text-pi-terminal-muted">- </span>
          <span className="line-through opacity-70">0 6 * * 1-5 ~/bin/disk-report.sh</span>
        </div>
        <div>
          <span className="text-pi-terminal-muted">+ </span>30 6 * * 1-5 ~/bin/disk-report.sh
        </div>
      </div>
      <figcaption className="sr-only">Demo data only</figcaption>
    </figure>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-pi-dark text-pi-text">
      <header className="border-b border-pi-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-center gap-2" aria-label="PiTasker home">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-pi-brand">
              <ListTodo className="h-5 w-5 text-pi-on-accent" aria-hidden="true" />
            </span>
            <span className="text-lg font-bold">PiTasker</span>
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link
              href="/login"
              className="rounded-md border border-pi-border px-3 py-2 text-sm font-semibold text-pi-text hover:bg-pi-card-hover"
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-12 sm:px-6 md:py-16 lg:grid-cols-2">
          <div>
            <p className="mb-4 inline-block rounded-full bg-pi-success-soft px-3 py-1 text-xs font-semibold text-pi-text">
              Self-hosted · Raspberry Pi &amp; Linux · MIT
            </p>
            <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">PiTasker</h1>
            <p className="mt-4 max-w-xl text-lg text-pi-text-muted">
              A web UI for the crontab on your Raspberry Pi or Linux server: see, edit and run your jobs with a diff
              before every write, keep a run history, and see what's scheduled across your whole fleet.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-md bg-pi-accent px-5 py-3 font-semibold text-pi-on-accent hover:bg-pi-accent-hover"
                data-testid="landing-signin"
              >
                <LogIn className="h-4 w-4" aria-hidden="true" /> Sign in
              </Link>
              <a
                href={REPO_URL}
                className="inline-flex items-center gap-2 rounded-md border border-pi-border bg-pi-card px-5 py-3 font-semibold text-pi-text hover:bg-pi-card-hover"
                rel="noopener noreferrer"
              >
                <GitHubMark className="h-4 w-4" /> View on GitHub
              </a>
            </div>
          </div>
          <TasksPreview />
        </section>

        <section className="border-t border-pi-border bg-pi-darker" aria-labelledby="features-heading">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
            <h2 id="features-heading" className="text-2xl font-bold">
              What it does
            </h2>
            <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, text }) => (
                <li key={title} className="rounded-lg border border-pi-border bg-pi-card p-5">
                  <Icon className="h-5 w-5 text-pi-accent-text" aria-hidden="true" />
                  <h3 className="mt-3 font-semibold">{title}</h3>
                  <p className="mt-2 text-sm text-pi-text-muted">{text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-2" aria-labelledby="install-heading">
          <div>
            <h2 id="install-heading" className="text-2xl font-bold">
              Self-host it
            </h2>
            <p className="mt-3 text-pi-text-muted">
              Node 22+, PostgreSQL and a user crontab. The server refuses to start while database migrations are
              pending, and the seed step prints the first admin password once.
            </p>
            <p className="mt-4 flex items-start gap-2 text-sm text-pi-text-muted">
              <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-pi-accent-text" aria-hidden="true" />
              Google sign-in limited to an email allowlist, a local break-glass password, every API route behind a
              session, and fleet agents that are read-only.
            </p>
            <p className="mt-4 flex items-start gap-2 text-sm text-pi-text-muted">
              <Terminal className="mt-0.5 h-4 w-4 flex-shrink-0 text-pi-accent-text" aria-hidden="true" />
              Light and dark themes, keyboard shortcuts (press ?), and it works at phone width.
            </p>
            <a
              href={`${REPO_URL}#quick-start`}
              className="mt-6 inline-block font-semibold text-pi-accent-text underline underline-offset-4"
              rel="noopener noreferrer"
            >
              Read the quick start
            </a>
          </div>
          <pre
            className="self-start overflow-x-auto rounded-lg bg-pi-terminal-bg p-5 font-mono text-sm leading-relaxed text-pi-terminal-text"
            aria-label="Install commands"
            // Scrolls sideways on phones: focusable so keyboard users can scroll it (axe scrollable-region-focusable).
            tabIndex={0}
          >
            <code>
              git clone {REPO_URL}.git
              {"\n"}cd PiTasker && npm ci
              {"\n"}cp .env.example .env
              <span className="text-pi-terminal-muted">   # PORT, DATABASE_URL, …</span>
              {"\n"}npm run db:migrate
              {"\n"}npm run db:seed
              <span className="text-pi-terminal-muted">      # first install only</span>
              {"\n"}npm run build
              {"\n"}pm2 start ecosystem.config.cjs && pm2 save
            </code>
          </pre>
        </section>
      </main>

      <footer className="border-t border-pi-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-pi-text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>
            PiTasker v{APP_VERSION} · MIT License · Built by{" "}
            <a href="https://0xwulf.dev" className="underline underline-offset-4 hover:text-pi-text" rel="noopener noreferrer">
              0xWulf
            </a>
          </span>
          <span className="flex gap-4">
            <a href={REPO_URL} className="hover:text-pi-text" rel="noopener noreferrer">
              GitHub
            </a>
            <a href={`${REPO_URL}/releases`} className="hover:text-pi-text" rel="noopener noreferrer">
              Releases
            </a>
            <Link href="/login" className="hover:text-pi-text">
              Sign in
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}

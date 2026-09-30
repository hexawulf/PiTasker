import { useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, ExternalLink, RefreshCw, Search } from "lucide-react";
import type { FleetHost, FleetResponse, HintKind } from "@shared/fleet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useHostTimeZone } from "@/hooks/use-meta";
import { useShortcutAction } from "@/shortcuts/use-shortcuts";
import { api } from "@/lib/api";
import { applyFilters, buildRows, filtersToSearch, HINT_LABEL, parseFilters, UP, type Filters, type Row } from "@/lib/fleet";
import { formatDateTime, formatRunTime, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/*
 * Fleet (P3, read-only): everything scheduled on every host — crontabs,
 * /etc/crontab, cron.d, run-parts and systemd timers — in each host's own
 * time zone, with cross-host hints. There is deliberately no edit, run,
 * delete or toggle control on this page; piapps' own zk crontab links to the
 * Crontab tab, where editing lives.
 */

const FLEET_KEY = ["/api/fleet"];
const selectCls = "h-10 rounded-md border border-pi-border bg-pi-input px-2 text-sm text-pi-text";
const pill = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";

const STATUS: Record<FleetHost["status"], { label: string; dot: string }> = {
  online: { label: "online", dot: "bg-pi-success" },
  stale: { label: "stale data", dot: "bg-pi-warning" },
  offline: { label: "offline", dot: "bg-pi-error" },
  "auth-error": { label: "token rejected", dot: "bg-pi-error" },
  "version-mismatch": { label: "version mismatch", dot: "bg-pi-warning" },
};

const HINT_STYLE: Record<HintKind, string> = {
  "same-job": "status-restart",
  "not-in-bin": "status-offline",
  "bin-differs": "status-restart",
  disabled: "bg-pi-darker text-pi-text-muted",
};

function HintBadges({ hints }: { hints: Row["hints"] }) {
  const seen = new Set<string>();
  return (
    <>
      {hints
        .filter((h) => !seen.has(h.kind + h.message) && seen.add(h.kind + h.message))
        .map((h) => (
          <span key={h.kind + h.message} className={cn(pill, HINT_STYLE[h.kind])} title={h.message} data-hint={h.kind}>
            {h.kind !== "disabled" && <AlertTriangle className="h-3 w-3" aria-hidden />}
            {h.kind === "not-in-bin" ? h.message.replace(/^script /, "") : HINT_LABEL[h.kind]}
            <span className="sr-only">: {h.message}</span>
          </span>
        ))}
    </>
  );
}

function NextRun({ row, hubTz }: { row: Row; hubTz: string }) {
  if (row.disabled) return <span className="text-pi-text-muted">—</span>;
  if (!row.next) return <span className="text-pi-text-muted">{row.scheduleRaw === "@reboot" ? "at next boot" : "—"}</span>;
  return (
    <span title={`${formatDateTime(row.next, hubTz)} (${hubTz}, the hub)`}>
      {formatRunTime(row.next, row.hostTz)} <span className="text-pi-text-muted">{row.hostTz}</span>
    </span>
  );
}

function LastRun({ row }: { row: Row }) {
  if (!row.last) return <span className="text-pi-text-muted">{row.result ?? "—"}</span>;
  return (
    <span title={`${formatDateTime(row.last.at)} (${row.last.source === "logfile" ? "log file written" : row.last.source === "journal" ? "cron journal: started" : "systemd"})`}>
      {relativeTime(row.last.at)}
      {row.result && row.result !== "ok" ? <span className="ml-1 text-pi-error">{row.result}</span> : null}
    </span>
  );
}

function RowCard({ row, hubTz, showHost }: { row: Row; hubTz: string; showHost: boolean }) {
  return (
    <li className={cn("min-w-0 rounded-lg border border-pi-border bg-pi-card p-3", row.disabled && "opacity-70")} data-testid="fleet-row" data-host={row.hostId} data-disabled={row.disabled || undefined}>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-pi-text-muted">
        {showHost && <span className="font-semibold text-pi-text">{row.hostLabel}</span>}
        <span>{row.source}</span>
        {row.user && <span>· {row.user}</span>}
        <HintBadges hints={row.hints} />
      </div>
      <p className={cn("mt-1 text-sm font-medium", row.disabled && "line-through")}>
        {row.schedule} <code className="font-normal text-xs text-pi-text-muted">{row.scheduleRaw}</code>
      </p>
      <code className="mt-1 block break-all rounded bg-pi-darker px-2 py-1 font-mono text-xs">{row.command}</code>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="uppercase tracking-wide text-pi-text-muted">Next</dt>
          <dd>
            <NextRun row={row} hubTz={hubTz} />
          </dd>
        </div>
        <div>
          <dt className="uppercase tracking-wide text-pi-text-muted">Last</dt>
          <dd>
            <LastRun row={row} />
          </dd>
        </div>
      </dl>
      {row.editableHere && (
        <Link href="/crontab" className="mt-2 inline-flex items-center gap-1 text-xs text-pi-accent-text underline-offset-2 hover:underline">
          <ExternalLink className="h-3 w-3" aria-hidden /> Open in Crontab
        </Link>
      )}
    </li>
  );
}

function JobsTable({ rows, hubTz }: { rows: Row[]; hubTz: string }) {
  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border border-pi-border bg-pi-card md:block">
        <table className="w-full text-left text-sm" data-testid="fleet-table">
          <caption className="sr-only">All scheduled jobs</caption>
          <thead className="border-b border-pi-border text-xs uppercase tracking-wide text-pi-text-muted">
            <tr>
              <th scope="col" className="px-3 py-2">Host</th>
              <th scope="col" className="px-3 py-2">Source</th>
              <th scope="col" className="px-3 py-2">Schedule</th>
              <th scope="col" className="px-3 py-2">Next run</th>
              <th scope="col" className="px-3 py-2">Last run</th>
              <th scope="col" className="px-3 py-2">Command</th>
              <th scope="col" className="px-3 py-2">Hints</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={cn("border-b border-pi-border align-top last:border-0", (r.disabled || r.hostDown) && "opacity-70")} data-testid="fleet-table-row">
                <td className="whitespace-nowrap px-3 py-2 font-medium">{r.hostLabel}</td>
                <td className="px-3 py-2 text-pi-text-muted">
                  {r.source}
                  {r.user ? ` · ${r.user}` : ""}
                </td>
                <td className={cn("px-3 py-2", r.disabled && "line-through")} title={r.scheduleRaw}>
                  {r.schedule}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <NextRun row={r} hubTz={hubTz} />
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <LastRun row={r} />
                </td>
                <td className="max-w-[28rem] px-3 py-2">
                  <code className="break-all font-mono text-xs">{r.command}</code>
                  {r.editableHere && (
                    <Link href="/crontab" className="ml-2 text-xs text-pi-accent-text underline-offset-2 hover:underline">
                      Crontab
                    </Link>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    <HintBadges hints={r.hints} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="grid grid-cols-1 gap-2 md:hidden" aria-label="All scheduled jobs">
        {rows.map((r) => (
          <RowCard key={r.key} row={r} hubTz={hubTz} showHost />
        ))}
      </ul>
    </>
  );
}

function HostChip({ host, active, onClick, binDiffers }: { host: FleetHost; active: boolean; onClick: () => void; binDiffers: boolean }) {
  const st = STATUS[host.status];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid="host-chip"
      data-host={host.id}
      data-status={host.status}
      className={cn("min-w-0 rounded-xl border bg-pi-card p-3 text-left text-sm transition-colors", active ? "border-pi-accent" : "border-pi-border hover:bg-pi-card-hover", !UP.has(host.status) && "opacity-80")}
    >
      <span className="flex flex-wrap items-center gap-2">
        <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", st.dot)} aria-hidden />
        <span className="font-semibold">{host.label}</span>
        {host.local && <span className={cn(pill, "bg-pi-darker text-pi-text-muted")}>hub</span>}
        {host.production && <span className={cn(pill, "status-offline")}>production</span>}
        <span className="text-xs text-pi-text-muted">{st.label}</span>
      </span>
      <span className="mt-1 block text-xs text-pi-text-muted">
        {host.tz ?? "—"} · {host.version ? `v${host.version}` : "version ?"} · bin {host.binHead ? host.binHead.slice(0, 7) : "—"}
        {binDiffers && <span className="text-pi-warning"> (differs)</span>}
      </span>
      <span className="block text-xs text-pi-text-muted">
        {UP.has(host.status) ? `seen ${relativeTime(host.lastSeen)}` : host.asOf ? `as of ${formatDateTime(host.asOf)}` : "no data yet"}
      </span>
    </button>
  );
}

function HostSection({ host, rows, hubTz, filtered }: { host: FleetHost; rows: Row[]; hubTz: string; filtered: boolean }) {
  const [open, setOpen] = useState(true);
  const sources = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of rows) m.set(r.source, [...(m.get(r.source) ?? []), r]);
    return [...m.entries()];
  }, [rows]);
  const errors = host.snapshot?.errors ?? [];
  const root = host.snapshot?.sources.find((s) => s.kind === "crontab" && s.owner === "root");
  const down = !UP.has(host.status);
  if (filtered && rows.length === 0) return null;
  return (
    <section className={cn("rounded-xl border border-pi-border bg-pi-dark", down && "opacity-80")} aria-labelledby={`fleet-${host.id}`} data-testid="host-section" data-host={host.id}>
      <h3 id={`fleet-${host.id}`}>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full flex-wrap items-center gap-2 rounded-t-xl bg-pi-card px-4 py-3 text-left">
          <ChevronDown className={cn("h-4 w-4 transition-transform", !open && "-rotate-90")} aria-hidden />
          <span className="font-semibold">{host.label}</span>
          <span className="text-sm text-pi-text-muted">
            {rows.length} job{rows.length === 1 ? "" : "s"} · {host.tz ?? ""}
          </span>
          {down && (
            <span className={cn(pill, "status-offline")}>
              {STATUS[host.status].label}
              {host.asOf ? ` · as of ${formatDateTime(host.asOf)}` : " · no data"}
            </span>
          )}
        </button>
      </h3>
      {open && (
        <div className="space-y-3 p-3">
          {errors.length > 0 && (
            <ul className="rounded-lg border border-pi-warning bg-pi-warning-soft p-2 text-xs text-pi-text" data-testid="host-errors">
              {errors.map((e, i) => (
                <li key={i}>
                  <strong>{e.source}:</strong> {e.message}
                </li>
              ))}
            </ul>
          )}
          {!host.snapshot && <p className="text-sm text-pi-text-muted">No data from this host yet.</p>}
          {sources.map(([label, list]) => (
            <div key={label}>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-pi-text-muted">
                {label}
                {label === "root crontab" && root && root.kind === "crontab" && root.snapshotAt ? ` · snapshot ${relativeTime(root.snapshotAt)}` : ""}
              </h4>
              <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                {list.map((r) => (
                  <RowCard key={r.key} row={r} hubTz={hubTz} showHost={false} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function FleetPage() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const hubTz = useHostTimeZone();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const fleet = useQuery<FleetResponse>({ queryKey: FLEET_KEY, staleTime: 60_000, refetchInterval: 5 * 60_000 });
  const f = parseFilters(search);
  const setF = (patch: Partial<Filters>) => navigate(`/fleet${filtersToSearch({ ...f, ...patch })}`, { replace: true });

  const refresh = async () => {
    setRefreshing(true);
    try {
      qc.setQueryData(FLEET_KEY, await api<FleetResponse>("GET", "/api/fleet?refresh=1"));
    } finally {
      setRefreshing(false);
    }
  };
  useShortcutAction("search", () => document.getElementById("fleet-search")?.focus());

  const rows = useMemo(() => (fleet.data ? buildRows(fleet.data) : []), [fleet.data]);
  const binHintHosts = useMemo(() => new Set((fleet.data?.hints ?? []).filter((h) => h.kind === "bin-differs").flatMap((h) => h.targets)), [fleet.data]);
  const shown = useMemo(() => applyFilters(rows, f, binHintHosts), [rows, f.host, f.source, f.hint, f.q, binHintHosts]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => {
    const c: Record<HintKind, number> = { "same-job": 0, "not-in-bin": 0, "bin-differs": binHintHosts.size, disabled: 0 };
    for (const r of rows) for (const k of new Set(r.hints.map((h) => h.kind))) if (k !== "bin-differs") c[k]++;
    return c;
  }, [rows, binHintHosts]);
  const filtering = Boolean(f.host || f.source || f.hint || f.q);

  return (
    <section aria-labelledby="fleet-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="fleet-heading" className="text-2xl font-bold text-pi-text">
            Fleet
          </h2>
          <p className="text-sm text-pi-text-muted" data-testid="fleet-summary">
            {fleet.data ? `${rows.length} scheduled jobs on ${fleet.data.hosts.length} host${fleet.data.hosts.length === 1 ? "" : "s"} · read-only` : "Everything scheduled on every host · read-only"}
          </p>
        </div>
        <Button variant="outline" className="border-pi-border bg-transparent text-pi-text hover:bg-pi-card-hover" onClick={refresh} disabled={refreshing} data-testid="fleet-refresh">
          <RefreshCw className={cn(refreshing && "animate-spin")} /> Refresh
        </Button>
      </div>

      {fleet.isLoading && <Skeleton className="h-24 w-full bg-pi-card" />}
      {fleet.isError && <p className="text-pi-error">Could not load the fleet: {(fleet.error as Error).message}</p>}

      {fleet.data && (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5" role="group" aria-label="Hosts (select to filter)">
            {fleet.data.hosts.map((h) => (
              <HostChip key={h.id} host={h} active={f.host === h.id} binDiffers={binHintHosts.has(h.id)} onClick={() => setF({ host: f.host === h.id ? "" : h.id })} />
            ))}
          </div>

          <div className="flex flex-wrap gap-2 text-xs" aria-label="Hints">
            {(Object.keys(counts) as HintKind[]).map((k) =>
              counts[k] ? (
                <button key={k} type="button" onClick={() => setF({ hint: f.hint === k ? "" : k })} aria-pressed={f.hint === k} className={cn(pill, HINT_STYLE[k], "border", f.hint === k ? "border-pi-accent" : "border-transparent")} data-testid={`hint-${k}`}>
                  {counts[k]} {HINT_LABEL[k]}
                </button>
              ) : null,
            )}
          </div>

          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div role="group" aria-label="View" className="flex gap-1 rounded-xl bg-pi-card p-1">
              {(
                [
                  ["hosts", "By host"],
                  ["jobs", "All jobs"],
                ] as const
              ).map(([v, label]) => (
                <button key={v} type="button" aria-pressed={f.view === v} onClick={() => setF({ view: v })} className={cn("tab-button", f.view === v && "active")} data-testid={`view-${v}`}>
                  {label}
                </button>
              ))}
            </div>
            <div className="relative flex-1" role="search">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-pi-text-muted" aria-hidden />
              <Input id="fleet-search" value={f.q} onChange={(e) => setF({ q: e.target.value })} placeholder="Search command, schedule ( / )" aria-label="Search jobs" className="border-pi-border bg-pi-input pl-9 text-pi-text" data-testid="fleet-search" />
            </div>
            <div className="grid grid-cols-3 gap-2 lg:flex">
              <select aria-label="Host" value={f.host} onChange={(e) => setF({ host: e.target.value })} className={selectCls} data-testid="filter-host">
                <option value="">All hosts</option>
                {fleet.data.hosts.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.label}
                  </option>
                ))}
              </select>
              <select aria-label="Source" value={f.source} onChange={(e) => setF({ source: e.target.value as Filters["source"] })} className={selectCls} data-testid="filter-source">
                <option value="">All sources</option>
                <option value="zk">zk crontab</option>
                <option value="root">root crontab</option>
                <option value="system">system (/etc)</option>
                <option value="timer">timers</option>
              </select>
              <select aria-label="Hint" value={f.hint} onChange={(e) => setF({ hint: e.target.value as Filters["hint"] })} className={selectCls} data-testid="filter-hint">
                <option value="">Any hint</option>
                <option value="same-job">On 2+ hosts</option>
                <option value="not-in-bin">Not in bin.git</option>
                <option value="bin-differs">bin differs</option>
                <option value="disabled">Disabled</option>
              </select>
            </div>
          </div>

          <p className="text-xs text-pi-text-muted" data-testid="fleet-count" aria-live="polite">
            {shown.length} of {rows.length} jobs
          </p>

          {f.view === "jobs" ? (
            <JobsTable rows={shown} hubTz={hubTz} />
          ) : (
            <div className="space-y-3">
              {fleet.data.hosts.map((h) => (
                <HostSection key={h.id} host={h} rows={shown.filter((r) => r.hostId === h.id)} hubTz={hubTz} filtered={filtering} />
              ))}
            </div>
          )}
          {shown.length === 0 && <p className="rounded-xl border border-dashed border-pi-border p-6 text-center text-pi-text-muted">No job matches the filters.</p>}
        </>
      )}
    </section>
  );
}


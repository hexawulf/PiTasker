import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Download, History, Loader2, RefreshCw, RotateCcw, Upload } from "lucide-react";
import { DiffDiagram, isCancelled, useCrontabWrite } from "@/components/diff-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { TASKS_KEY } from "@/hooks/use-tasks";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Line = {
  n: number;
  kind: "blank" | "comment" | "marker" | "env" | "job" | "disabled" | "invalid";
  raw: string;
  id?: string;
  managed?: boolean;
  schedule?: string;
  command?: string;
  description?: string;
  taskId?: number | null;
};
type CrontabView = { text: string; hash: string; lines: Line[]; doubleRuns: { taskId: number; line: string }[] };
type ImportItem = { id: string; schedule: string; command: string; name: string; action: "import" | "update" | "unchanged" | "conflict" | "disabled"; reason?: string };
type ImportResult = { imported: number; updated: number; skipped: number; missing: number[]; items: ImportItem[]; errors: string[] };
type Backup = { name: string; size: number; createdAt: string };

const CRONTAB_KEY = ["/api/crontab"];
const outlineBtn = "border-pi-border bg-transparent text-pi-text hover:bg-pi-card-hover";

/** A comment line that looks like a section header ("# ── Monitoring ──", "# === X ===", "# ---"). */
const isSection = (l: Line) => l.kind === "comment" && /^\s*#\s*([─═=\-*#]{2,}|.*[─═]{2,})/.test(l.raw);

function CrontabLines({ lines }: { lines: Line[] }) {
  return (
    <ol className="overflow-x-auto rounded-xl border border-pi-border bg-pi-card py-2 text-xs sm:text-sm" aria-label="Crontab lines" data-testid="crontab-lines">
      {lines.map((l) => {
        const kind = isSection(l) ? "section" : l.kind;
        return (
          <li
            key={l.n}
            className="cron-line grid grid-cols-[2.5rem_minmax(0,1fr)] gap-2 px-2 py-0.5"
            data-kind={kind}
            data-managed={l.managed ? "true" : undefined}
            title={l.kind === "job" ? `${l.description}${l.managed ? " · PiTasker-managed" : ""}${l.taskId ? ` · task #${l.taskId}` : ""}` : undefined}
          >
            <span aria-hidden className="select-none text-right text-pi-text-muted">{l.n}</span>
            <span>
              {l.raw || " "}
              {l.kind === "job" && (
                <span className="ml-2 whitespace-nowrap rounded bg-pi-darker px-1.5 font-sans text-xs text-pi-text-muted">
                  {l.description}
                  {l.managed ? " · managed" : ""}
                </span>
              )}
              {l.kind === "disabled" && <span className="sr-only"> (disabled)</span>}
            </span>
          </li>
        );
      })}
      {lines.length === 0 && <li className="px-4 py-2 text-pi-text-muted">The crontab is empty.</li>}
    </ol>
  );
}

function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const preview = useQuery<ImportResult>({
    queryKey: ["/api/crontab/import", "preview"],
    queryFn: () => api("POST", "/api/crontab/import?dryRun=1"),
    enabled: open,
    staleTime: 0,
    gcTime: 0,
  });
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState(false);
  const actionable = (preview.data?.items ?? []).filter((i) => i.action === "import" || i.action === "update");
  const chosen = picked ?? new Set(actionable.map((i) => i.id));

  const run = async () => {
    setBusy(true);
    try {
      const r = await api<ImportResult>("POST", "/api/crontab/import", { ids: [...chosen] });
      toast({ title: "Imported", description: `${r.imported} new, ${r.updated} updated. The crontab was not changed.` });
      await qc.invalidateQueries({ queryKey: TASKS_KEY });
      await qc.invalidateQueries({ queryKey: CRONTAB_KEY });
      onOpenChange(false);
      setPicked(null);
    } catch (e) {
      toast({ title: "Import failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const label: Record<ImportItem["action"], string> = { import: "new", update: "update", unchanged: "already a task", conflict: "runs twice!", disabled: "disabled" };
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] w-[calc(100%-1rem)] max-w-3xl overflow-y-auto border-pi-border bg-pi-card p-4 text-pi-text sm:p-6" data-testid="import-dialog">
        <DialogHeader>
          <DialogTitle>Import from the crontab</DialogTitle>
          <DialogDescription className="text-pi-text-muted">
            Active lines become tasks run by cron. Importing only reads the crontab — nothing in it changes.
          </DialogDescription>
        </DialogHeader>
        {preview.isLoading && <Skeleton className="h-32 w-full bg-pi-darker" />}
        {preview.data && (
          <ul className="max-h-[55vh] space-y-1 overflow-y-auto text-sm">
            {preview.data.items.map((i) => {
              const can = i.action === "import" || i.action === "update";
              return (
                <li key={i.id} className="flex items-start gap-2 rounded-md border border-pi-border p-2">
                  <input
                    type="checkbox"
                    disabled={!can}
                    checked={can && chosen.has(i.id)}
                    aria-label={`Import ${i.name}`}
                    onChange={(e) => {
                      const next = new Set(chosen);
                      if (e.target.checked) next.add(i.id);
                      else next.delete(i.id);
                      setPicked(next);
                    }}
                    className="mt-1"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{i.name}</span>
                      <span className={cn("rounded-full px-2 text-xs", i.action === "conflict" ? "status-offline" : i.action === "disabled" ? "status-restart" : can ? "status-online" : "bg-pi-darker text-pi-text-muted")}>
                        {label[i.action]}
                      </span>
                    </span>
                    <code className="block truncate font-mono text-xs text-pi-text-muted" title={`${i.schedule} ${i.command}`}>
                      {i.schedule} {i.command}
                    </code>
                    {i.reason && <span className="block text-xs text-pi-text-muted">{i.reason}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" className={outlineBtn} onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={run} disabled={busy || chosen.size === 0} className="bg-pi-accent text-pi-on-accent hover:bg-pi-accent-hover" data-testid="import-confirm">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}Import {chosen.size}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BackupsCard() {
  const backups = useQuery<Backup[]>({ queryKey: ["/api/crontab/backups"] });
  const [viewing, setViewing] = useState<string | null>(null);
  const current = useQuery<CrontabView>({ queryKey: CRONTAB_KEY });
  const content = useQuery<{ text: string }>({ queryKey: ["/api/crontab/backups", viewing ?? ""], enabled: viewing !== null });
  const write = useCrontabWrite();
  const qc = useQueryClient();
  const { toast } = useToast();

  const restore = async (name: string) => {
    try {
      await write({ method: "POST", url: `/api/crontab/backups/${encodeURIComponent(name)}/restore`, title: `Restore ${name}`, confirmLabel: "Restore this crontab", destructive: true });
      toast({ title: "Crontab restored", description: `${name} (the replaced crontab was backed up too)` });
      await Promise.all([qc.invalidateQueries({ queryKey: CRONTAB_KEY }), qc.invalidateQueries({ queryKey: ["/api/crontab/backups"] }), qc.invalidateQueries({ queryKey: TASKS_KEY })]);
      setViewing(null);
    } catch (e) {
      if (!isCancelled(e)) toast({ title: "Restore failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <section aria-labelledby="backups-heading" className="rounded-xl border border-pi-border bg-pi-card p-4">
      <h3 id="backups-heading" className="mb-2 flex items-center gap-2 font-semibold">
        <History className="h-4 w-4" aria-hidden /> Backups
      </h3>
      <p className="mb-3 text-sm text-pi-text-muted">One per write PiTasker made, newest 50 kept.</p>
      {backups.data?.length === 0 && <p className="text-sm text-pi-text-muted">None yet.</p>}
      <ul className="max-h-80 space-y-1 overflow-y-auto text-sm" data-testid="backups">
        {backups.data?.map((b) => (
          <li key={b.name} className="flex items-center justify-between gap-2">
            <button type="button" className="min-w-0 truncate text-left underline-offset-2 hover:underline" onClick={() => setViewing(b.name)}>
              {formatDateTime(b.createdAt)}
            </button>
            <Button variant="outline" size="sm" className={cn(outlineBtn, "h-7 px-2")} onClick={() => restore(b.name)} aria-label={`Restore backup from ${formatDateTime(b.createdAt)}`}>
              <RotateCcw /> Restore
            </Button>
          </li>
        ))}
      </ul>
      <Dialog open={viewing !== null} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-h-[92vh] w-[calc(100%-1rem)] max-w-3xl overflow-y-auto border-pi-border bg-pi-card text-pi-text">
          <DialogHeader>
            <DialogTitle>Backup {viewing}</DialogTitle>
            <DialogDescription className="text-pi-text-muted">Difference from the backup to the current crontab.</DialogDescription>
          </DialogHeader>
          {content.data && current.data && <DiffDiagram before={content.data.text} after={current.data.text} />}
        </DialogContent>
      </Dialog>
    </section>
  );
}

export default function CrontabPage() {
  const crontab = useQuery<CrontabView>({ queryKey: CRONTAB_KEY, refetchInterval: 30_000 });
  const validate = useQuery<{ isValid: boolean; discrepancies: { type: string; details: string }[] }>({ queryKey: ["/api/crontab/validate"] });
  const [importing, setImporting] = useState(false);
  const write = useCrontabWrite();
  const qc = useQueryClient();
  const { toast } = useToast();
  const counts = useMemo(() => {
    const l = crontab.data?.lines ?? [];
    return { jobs: l.filter((x) => x.kind === "job").length, managed: l.filter((x) => x.kind === "job" && x.managed).length, disabled: l.filter((x) => x.kind === "disabled").length };
  }, [crontab.data]);

  const exportAll = async () => {
    try {
      const r = (await write({ method: "POST", url: "/api/crontab/export", title: "Write PiTasker's crontab tasks to the crontab", confirmLabel: "Write crontab" })) as { changed: boolean; exported?: number };
      toast({ title: r.changed ? "Crontab updated" : "Already in sync", description: r.changed ? `${r.exported ?? 0} line(s) written` : "Nothing to write." });
      await Promise.all([qc.invalidateQueries({ queryKey: CRONTAB_KEY }), qc.invalidateQueries({ queryKey: TASKS_KEY }), qc.invalidateQueries({ queryKey: ["/api/crontab/backups"] })]);
    } catch (e) {
      if (!isCancelled(e)) toast({ title: "Export failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <section aria-labelledby="crontab-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="crontab-heading" className="text-2xl font-bold text-pi-text">
            Crontab
          </h2>
          <p className="text-sm text-pi-text-muted">
            As written: {counts.jobs} jobs · {counts.managed} managed by PiTasker · {counts.disabled} disabled
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className={outlineBtn} onClick={() => void qc.invalidateQueries({ queryKey: CRONTAB_KEY })} aria-label="Reload crontab">
            <RefreshCw />
          </Button>
          <Button variant="outline" className={outlineBtn} onClick={() => setImporting(true)} data-testid="crontab-import">
            <Download /> Import…
          </Button>
          <Button className="bg-pi-accent text-pi-on-accent hover:bg-pi-accent-hover" onClick={exportAll} data-testid="crontab-export">
            <Upload /> Export tasks
          </Button>
        </div>
      </div>

      {crontab.data?.doubleRuns.length ? (
        <div role="alert" className="rounded-xl border border-pi-error bg-pi-error-soft p-3 text-sm text-pi-text">
          <AlertTriangle className="mr-1 inline h-4 w-4 text-pi-error" aria-hidden /> These commands run twice (crontab and PiTasker):
          <ul className="mt-1 list-inside list-disc font-mono text-xs">
            {crontab.data.doubleRuns.map((d) => (
              <li key={d.taskId}>{d.line}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {validate.data && !validate.data.isValid && (
        <details className="rounded-xl border border-pi-warning bg-pi-warning-soft p-3 text-sm text-pi-text" data-testid="discrepancies">
          <summary className="cursor-pointer">{validate.data.discrepancies.length} difference(s) between tasks and the crontab</summary>
          <ul className="mt-2 list-inside list-disc">
            {validate.data.discrepancies.map((d, i) => (
              <li key={i}>{d.details}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0">
          {crontab.isLoading && <Skeleton className="h-64 w-full bg-pi-card" />}
          {crontab.isError && <p className="text-pi-error">Cannot read the crontab: {(crontab.error as Error).message}</p>}
          {crontab.data && <CrontabLines lines={crontab.data.lines} />}
          <p className="mt-2 text-xs text-pi-text-muted">
            Lines with a blue edge are managed by PiTasker (<code># PITASKER_ID</code> markers). Everything else is shown and kept exactly as written.
          </p>
        </div>
        <BackupsCard />
      </div>
      <ImportDialog open={importing} onOpenChange={setImporting} />
    </section>
  );
}

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { api, ApiError } from "@/lib/api";
import { diffLines, hunks } from "@/lib/diff";
import { cn } from "@/lib/utils";

/*
 * Every write to the crontab is shown first:
 *   write({ method, url, body }) ─► same request with ?dryRun=1
 *        ├─ no crontab change ─► the real request right away
 *        └─ change ─► dialog with the diff ─► Confirm ─► real request with
 *                     ?expectedHash=<hash of what was shown> (409 if the
 *                     crontab changed meanwhile: shown, nothing written)
 */
type Preview = { dryRun: true; changed: boolean; before?: string; after?: string; hash?: string };
type Request = { method: string; url: string; body?: unknown; title: string; confirmLabel: string; destructive?: boolean };
type Pending = Request & { preview: Preview; resolve: (v: unknown) => void; reject: (e: unknown) => void };

const Ctx = createContext<((r: Request) => Promise<unknown>) | null>(null);

const SCRIM = "fixed inset-0 z-50 bg-black/60"; // theme-ok: a scrim, the same in both themes

const withQuery = (url: string, q: string) => `${url}${url.includes("?") ? "&" : "?"}${q}`;

export function DiffDiagram({ before, after }: { before: string; after: string }) {
  const rows = useMemo(() => hunks(diffLines(before, after)), [before, after]);
  return (
    <div className="max-h-[50vh] overflow-auto rounded-md border border-pi-border bg-pi-darker p-2 text-xs" data-testid="diff">
      {rows.map((d, i) =>
        d === null ? (
          <div key={i} className="px-2 py-0.5 text-pi-text-muted">⋯</div>
        ) : (
          <div key={i} className={cn("diff-line flex gap-2 px-2", d.kind === "add" && "diff-add", d.kind === "del" && "diff-del")}>
            <span aria-hidden className="w-4 shrink-0 select-none text-pi-text-muted">{d.kind === "add" ? "+" : d.kind === "del" ? "−" : " "}</span>
            <span className="sr-only">{d.kind === "add" ? "added: " : d.kind === "del" ? "removed: " : ""}</span>
            <span>{d.text || " "}</span>
          </div>
        ),
      )}
    </div>
  );
}

export function CrontabWriteProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const cancelRef = useRef<HTMLButtonElement>(null);

  const write = useCallback(async (r: Request) => {
    const preview = await api<Preview | unknown>(r.method, withQuery(r.url, "dryRun=1"), r.body);
    const p = preview as Preview;
    if (!p || p.dryRun !== true || !p.changed) return api(r.method, r.url, r.body);
    return new Promise((resolve, reject) => setPending({ ...r, preview: p, resolve, reject }));
  }, []);

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const url = pending.preview.hash ? withQuery(pending.url, `expectedHash=${encodeURIComponent(pending.preview.hash)}`) : pending.url;
      const res = await api(pending.method, url, pending.body);
      pending.resolve(res);
      setPending(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) toast({ title: "Crontab changed", description: e.message, variant: "destructive" });
      pending.reject(e);
      setPending(null);
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    if (busy || !pending) return;
    pending.reject(new ApiError(0, "cancelled", null));
    setPending(null);
  };

  return (
    <Ctx.Provider value={write}>
      {children}
      <DialogPrimitive.Root open={pending !== null} onOpenChange={(o) => !o && cancel()}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className={SCRIM} />
          <DialogPrimitive.Content
            data-testid="diff-dialog"
            className="fixed left-1/2 top-1/2 z-50 grid max-h-[90vh] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border border-pi-border bg-pi-card p-4 text-pi-text shadow-lg sm:p-6"
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              cancelRef.current?.focus();
            }}
          >
            <DialogPrimitive.Title className="text-lg font-semibold">{pending?.title}</DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-sm text-pi-text-muted">
              This is the change to your crontab. A backup of the current crontab is saved before it is written.
            </DialogPrimitive.Description>
            {pending && <DiffDiagram before={pending.preview.before ?? ""} after={pending.preview.after ?? ""} />}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button ref={cancelRef} type="button" disabled={busy} onClick={cancel} className="inline-flex h-9 items-center justify-center rounded-md border border-pi-border px-4 text-sm hover:bg-pi-card-hover disabled:opacity-50">
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={confirm}
                data-testid="diff-confirm"
                className={cn(
                  "inline-flex h-9 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium disabled:opacity-70",
                  pending?.destructive ? "bg-red-700 text-pi-on-accent hover:bg-red-800" : "bg-pi-accent text-pi-on-accent hover:bg-pi-accent-hover",
                )}
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                {pending?.confirmLabel}
              </button>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </Ctx.Provider>
  );
}

/** write(req) resolves with the real response, or rejects (ApiError status 0 = cancelled by the user). */
export function useCrontabWrite() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCrontabWrite needs CrontabWriteProvider");
  return ctx;
}

export const isCancelled = (e: unknown) => e instanceof ApiError && e.status === 0;

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "@/components/theme-provider";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isDialogOpen, isTypingTarget, resolveKey, SEQUENCE_TIMEOUT_MS, SHORTCUTS, type ShortcutId } from "./shortcuts";

type Handlers = Map<ShortcutId, Set<() => void>>;
const Ctx = createContext<{ handlers: Handlers; openHelp: () => void } | null>(null);

const TABS: Partial<Record<ShortcutId, string>> = { "go-tasks": "/tasks", "go-crontab": "/crontab", "go-fleet": "/fleet", "go-logs": "/logs", "go-settings": "/settings" };

/** Global keys (see shortcuts.ts); pages add their own actions with useShortcutAction. */
export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const handlers = useRef<Handlers>(new Map()).current;
  const [help, setHelp] = useState(false);
  const [, navigate] = useLocation();
  const { toggleTheme } = useTheme();
  const qc = useQueryClient();

  useEffect(() => {
    let pending: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      const r = resolveKey(e, pending, { typing: isTypingTarget(e.target), dialogOpen: isDialogOpen() });
      pending = r.pending;
      clearTimeout(timer);
      if (pending) timer = setTimeout(() => (pending = null), SEQUENCE_TIMEOUT_MS);
      if (!r.action) return;
      e.preventDefault();
      if (r.action === "help") setHelp(true);
      else if (r.action === "theme") toggleTheme();
      else if (r.action === "refresh") void qc.invalidateQueries();
      else if (TABS[r.action]) navigate(TABS[r.action]!);
      else handlers.get(r.action)?.forEach((h) => h());
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(timer);
    };
  }, [handlers, navigate, toggleTheme, qc]);

  const groups = ["General", "Go to", "Tasks"] as const;
  return (
    <Ctx.Provider value={{ handlers, openHelp: () => setHelp(true) }}>
      {children}
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-md border-pi-border bg-pi-card text-pi-text" data-testid="shortcuts-help">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription className="text-pi-text-muted">Not active while typing or while a dialog is open.</DialogDescription>
          </DialogHeader>
          {groups.map((g) => (
            <div key={g}>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-pi-text-muted">{g}</h3>
              <dl className="space-y-1 text-sm">
                {SHORTCUTS.filter((s) => s.group === g).map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-4">
                    <dt>{s.label}</dt>
                    <dd className="flex gap-1">
                      {s.keys.map((k) => (
                        <kbd key={k} className="rounded border border-pi-border bg-pi-darker px-1.5 py-0.5 text-xs">
                          {k}
                        </kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </DialogContent>
      </Dialog>
    </Ctx.Provider>
  );
}

export function useShortcutAction(id: ShortcutId, fn: () => void) {
  const ctx = useContext(Ctx);
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!ctx) return;
    const h = () => ref.current();
    if (!ctx.handlers.has(id)) ctx.handlers.set(id, new Set());
    ctx.handlers.get(id)!.add(h);
    return () => void ctx.handlers.get(id)?.delete(h);
  }, [ctx, id]);
}

export function useOpenShortcutHelp() {
  return useContext(Ctx)?.openHelp ?? (() => undefined);
}

/*
 * Keyboard shortcuts (the PiDeck 2.0 scheme): the one table (the ? help sheet
 * renders it) and a pure resolver the global keydown handler calls.
 *   keydown ─┬─ a dialog is open ───────────────► ignore (dialogs own keys)
 *            ├─ Ctrl/⌘/Alt combo ───────────────► ignore (browser/OS keep them)
 *            ├─ typing (input/textarea/select) ──► ignore
 *            ├─ "?" ─────────────────────────────► help sheet
 *            ├─ Shift+letter ────────────────────► ignore
 *            ├─ pending "g" + t/c/l/s ──────────► go to tab
 *            └─ single key n / r t, or "g" (starts a 1.5 s sequence)
 * Nothing destructive is a shortcut.
 */
export type ShortcutId = "help" | "theme" | "refresh" | "new-task" | "search" | "go-tasks" | "go-crontab" | "go-logs" | "go-settings";

export type Shortcut = { id: ShortcutId; keys: string[]; label: string; group: "General" | "Go to" | "Tasks" };

export const SHORTCUTS: readonly Shortcut[] = [
  { id: "help", keys: ["?"], label: "Show keyboard shortcuts", group: "General" },
  { id: "theme", keys: ["t"], label: "Toggle light / dark theme", group: "General" },
  { id: "refresh", keys: ["r"], label: "Refresh now", group: "General" },
  { id: "go-tasks", keys: ["g", "t"], label: "Go to Tasks", group: "Go to" },
  { id: "go-crontab", keys: ["g", "c"], label: "Go to Crontab", group: "Go to" },
  { id: "go-logs", keys: ["g", "l"], label: "Go to Logs", group: "Go to" },
  { id: "go-settings", keys: ["g", "s"], label: "Go to Settings", group: "Go to" },
  { id: "new-task", keys: ["n"], label: "New task", group: "Tasks" },
  { id: "search", keys: ["/"], label: "Search tasks", group: "Tasks" },
];

export const SEQUENCE_TIMEOUT_MS = 1500;

export type KeyLike = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;
export type KeyContext = { typing: boolean; dialogOpen: boolean };
export type Resolution = { action: ShortcutId | null; pending: string | null };

export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable === true;
}

export function isDialogOpen(doc: Document = document): boolean {
  return doc.querySelector('[role="dialog"], [role="alertdialog"]') !== null;
}

const SINGLE = new Map(SHORTCUTS.filter((s) => s.keys.length === 1 && s.keys[0] !== "?").map((s) => [s.keys[0], s.id]));
const AFTER_G = new Map(SHORTCUTS.filter((s) => s.keys.length === 2 && s.keys[0] === "g").map((s) => [s.keys[1], s.id]));

export function resolveKey(e: KeyLike, pending: string | null, ctx: KeyContext): Resolution {
  const key = e.key;
  if (ctx.dialogOpen || e.ctrlKey || e.metaKey || e.altKey || ctx.typing) return { action: null, pending: null };
  if (key === "?") return { action: "help", pending: null };
  if (e.shiftKey) return { action: null, pending: null };
  if (pending === "g") return { action: AFTER_G.get(key) ?? null, pending: null };
  if (key === "g") return { action: null, pending: "g" };
  return { action: SINGLE.get(key) ?? null, pending: null };
}

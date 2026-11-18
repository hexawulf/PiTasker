import * as React from "react";
import type { ToastProps } from "@/components/ui/toast";

const TOAST_LIMIT = 1;
const TOAST_REMOVE_DELAY = 5_000;

export type ToasterToast = ToastProps & {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
};

type State = { toasts: ToasterToast[] };

let count = 0;
let memoryState: State = { toasts: [] };
const listeners = new Set<(state: State) => void>();
const timeouts = new Map<string, ReturnType<typeof setTimeout>>();

function notify() {
  for (const l of listeners) l(memoryState);
}

function scheduleRemove(id: string) {
  if (timeouts.has(id)) return;
  timeouts.set(
    id,
    setTimeout(() => {
      timeouts.delete(id);
      memoryState = { toasts: memoryState.toasts.filter((t) => t.id !== id) };
      notify();
    }, TOAST_REMOVE_DELAY),
  );
}

function dismissToast(toastId?: string) {
  for (const t of memoryState.toasts) {
    if (!toastId || t.id === toastId) scheduleRemove(t.id);
  }
  memoryState = {
    toasts: memoryState.toasts.map((t) => (!toastId || t.id === toastId ? { ...t, open: false } : t)),
  };
  notify();
}

export function toast(props: Omit<ToasterToast, "id">) {
  const id = String((count = (count + 1) % Number.MAX_SAFE_INTEGER));
  const dismiss = () => dismissToast(id);
  memoryState = {
    toasts: [{ ...props, id, open: true, onOpenChange: (open: boolean) => !open && dismiss() }, ...memoryState.toasts].slice(0, TOAST_LIMIT),
  };
  notify();
  return { id, dismiss };
}

export function useToast() {
  const [state, setState] = React.useState<State>(memoryState);
  React.useEffect(() => {
    listeners.add(setState);
    return () => {
      listeners.delete(setState);
    };
  }, []);
  return { ...state, toast, dismiss: dismissToast };
}

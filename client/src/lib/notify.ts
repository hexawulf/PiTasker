// Browser notifications for finished runs (the Notification API; no push
// service). 1.x loaded Firebase Cloud Messaging for this, but without a
// service worker it never delivered anything: the notifications users saw
// came from this same local API.
export function requestNotificationPermission(): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission === "default") void Notification.requestPermission().catch(() => undefined);
}

export function showTaskNotification(taskName: string, status: "success" | "failed", when?: string): void {
  if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted") return;
  const time = when ? new Date(when).toLocaleTimeString() : new Date().toLocaleTimeString();
  try {
    new Notification(`PiTasker — ${status === "success" ? "done" : "failed"}`, {
      body: `${status === "success" ? "✅" : "❌"} "${taskName}" at ${time}`,
      tag: "pitasker-notification",
    });
  } catch {
    /* some browsers only allow notifications from a service worker */
  }
}

import { useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, KeyRound, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMeta } from "@/hooks/use-meta";
import { TASKS_KEY } from "@/hooks/use-tasks";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";

const card = "rounded-xl border border-pi-border bg-pi-card p-4";

function ChangePassword() {
  const id = useId();
  const { toast } = useToast();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next !== confirm) return setError("New passwords do not match.");
    setBusy(true);
    try {
      const r = await api<{ otherSessionsEnded?: number }>("POST", "/api/auth/change-password", { currentPassword: cur, newPassword: next, confirmNewPassword: confirm });
      toast({ title: "Password changed", description: r.otherSessionsEnded ? `${r.otherSessionsEnded} other session(s) logged out.` : undefined });
      setCur("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const field = (label: string, key: string, value: string, set: (v: string) => void, auto: string) => (
    <div>
      <label htmlFor={`${id}-${key}`} className="mb-1 block text-sm font-medium">{label}</label>
      <Input id={`${id}-${key}`} type="password" value={value} onChange={(e) => set(e.target.value)} autoComplete={auto} required className="border-pi-border bg-pi-input text-pi-text" />
    </div>
  );
  return (
    <section aria-labelledby={`${id}-h`} className={card}>
      <h3 id={`${id}-h`} className="mb-3 flex items-center gap-2 font-semibold"><KeyRound className="h-4 w-4" aria-hidden /> Change password</h3>
      <form onSubmit={submit} className="space-y-3">
        {field("Current password", "cur", cur, setCur, "current-password")}
        {field("New password", "new", next, setNext, "new-password")}
        {field("Repeat new password", "confirm", confirm, setConfirm, "new-password")}
        <p className="text-xs text-pi-text-muted">At least 12 characters, not containing the username. Other sessions are logged out.</p>
        {error && <p role="alert" className="text-sm text-pi-error">{error}</p>}
        <Button type="submit" disabled={busy} className="bg-pi-accent text-pi-on-accent hover:bg-pi-accent-hover">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}Change password
        </Button>
      </form>
    </section>
  );
}

function About() {
  const meta = useMeta();
  const stats = useQuery<{ uptime: string; cpuUsage: number; memoryUsage: number; cpuTemperature: number | null; processRssMb: number }>({ queryKey: ["/api/system-stats"], refetchInterval: 30_000 });
  const rows: [string, string | undefined][] = [
    ["Version", meta.data?.version],
    ["Host", meta.data ? `${meta.data.hostname} (user ${meta.data.user})` : undefined],
    ["Time zone", meta.data?.timeZone],
    ["Scripts directory", meta.data?.binDir],
    ["Run timeout", meta.data ? `${Math.round(meta.data.runTimeoutMs / 1000)} s` : undefined],
    ["Cron journal", meta.data ? (meta.data.cronJournal ? "read (last started)" : "off") : undefined],
    ["Uptime", stats.data?.uptime],
    ["Load / memory", stats.data ? `${stats.data.cpuUsage.toFixed(0)}% · ${stats.data.memoryUsage.toFixed(0)}%` : undefined],
    ["CPU temperature", stats.data?.cpuTemperature ? `${stats.data.cpuTemperature.toFixed(1)} °C` : "—"],
    ["PiTasker memory (RSS)", stats.data ? `${stats.data.processRssMb} MB` : undefined],
  ];
  return (
    <section aria-labelledby="about-h" className={card}>
      <h3 id="about-h" className="mb-3 font-semibold">About this PiTasker</h3>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-pi-text-muted">{k}</dt>
            <dd className="break-words">{v ?? "…"}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function TasksJson() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const jobs = JSON.parse(await f.text());
      const r = await api<{ imported: number; failed: number; skipped: string[] }>("POST", "/api/import-cronjobs", jobs);
      toast({ title: "Tasks imported", description: `${r.imported} new (run by PiTasker), ${r.skipped.length} skipped as duplicates, ${r.failed} invalid.` });
      await qc.invalidateQueries({ queryKey: TASKS_KEY });
    } catch (e) {
      toast({ title: "Import failed", description: (e as Error).message, variant: "destructive" });
    }
  };
  return (
    <section aria-labelledby="json-h" className={card}>
      <h3 id="json-h" className="mb-2 font-semibold">Tasks as JSON</h3>
      <p className="mb-3 text-sm text-pi-text-muted">A copy of all tasks, or tasks from such a file (imported as PiTasker-run; commands already in a task or the crontab are skipped).</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="border-pi-border bg-transparent text-pi-text hover:bg-pi-card-hover" asChild>
          <a href="/api/tasks/export?pretty=true"><Download /> Export JSON</a>
        </Button>
        <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-pi-border px-4 text-sm hover:bg-pi-card-hover">
          <Upload className="h-4 w-4" aria-hidden /> Import JSON
          <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
      </div>
    </section>
  );
}

export default function SettingsPage() {
  return (
    <section aria-labelledby="settings-heading" className="space-y-4">
      <h2 id="settings-heading" className="text-2xl font-bold text-pi-text">Settings</h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChangePassword />
        <div className="space-y-4">
          <About />
          <TasksJson />
        </div>
      </div>
    </section>
  );
}

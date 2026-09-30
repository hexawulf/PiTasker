import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

/** PiTasker's own log files (LOG_DIR, within LOG_RETENTION_DAYS): the last 100 lines of one. */
export default function LogsPage() {
  const files = useQuery<string[]>({ queryKey: ["/api/pitasker-logs"] });
  const [file, setFile] = useState<string>("");
  useEffect(() => {
    if (!file && files.data?.length) setFile([...files.data].sort().reverse()[0]);
  }, [files.data, file]);
  // ?name=: nginx refuses URL paths ending in .log.
  const content = useQuery<{ content: string }>({
    queryKey: ["/api/pitasker-logs/file", file],
    queryFn: () => api("GET", `/api/pitasker-logs/file?name=${encodeURIComponent(file)}`),
    enabled: Boolean(file),
    refetchInterval: 15_000,
  });

  return (
    <section aria-labelledby="logs-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="logs-heading" className="text-2xl font-bold text-pi-text">Logs</h2>
          <p className="text-sm text-pi-text-muted">PiTasker's log files — the last 100 lines.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Log file"
            value={file}
            onChange={(e) => setFile(e.target.value)}
            className="h-10 max-w-[16rem] rounded-md border border-pi-border bg-pi-input px-2 text-sm text-pi-text"
            data-testid="log-select"
          >
            {files.data?.length === 0 && <option value="">No log files</option>}
            {[...(files.data ?? [])].sort().reverse().map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
          <Button variant="outline" className="border-pi-border bg-transparent text-pi-text hover:bg-pi-card-hover" onClick={() => void content.refetch()} aria-label="Reload log" disabled={!file}>
            <RefreshCw />
          </Button>
          {file && (
            <Button variant="outline" className="border-pi-border bg-transparent text-pi-text hover:bg-pi-card-hover" asChild>
              <a href={`/api/pitasker-logs/file?name=${encodeURIComponent(file)}&download=1`} aria-label={`Download ${file}`}>
                <Download /> Download
              </a>
            </Button>
          )}
        </div>
      </div>
      {files.isError && <p className="text-pi-error">Cannot list logs: {(files.error as Error).message}</p>}
      <pre className="max-h-[70vh] min-h-[12rem] overflow-auto whitespace-pre-wrap break-all rounded-xl bg-pi-terminal-bg p-4 font-mono text-xs text-pi-terminal-text" tabIndex={0} data-testid="log-content">
        {content.data?.content || <span className="text-pi-terminal-muted">{file ? "(empty)" : "Select a log file."}</span>}
      </pre>
    </section>
  );
}

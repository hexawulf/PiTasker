import { useState, useEffect } from 'react';

export default function LogsWidget() {
  const [logs, setLogs] = useState<string[]>([]);
  const [selectedLog, setSelectedLog] = useState<string | null>(null);
  const [logContent, setLogContent] = useState<string>('');

  useEffect(() => {
    fetch('/api/pitasker-logs').then(res => res.json()).then(setLogs);
  }, []);

  const handleClick = (log: string) => {
    setSelectedLog(log);
    fetch(`/api/pitasker-logs/${log}`)
      .then(res => res.json())
      .then(data => setLogContent(data.content));
  };

  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold text-foreground mb-3">📄 Task Logs</h2>
      <div className="bg-card rounded-[var(--radius)] border border-border divide-y">
        {logs.map((log) => (
          <button
            key={log}
            onClick={() => handleClick(log)}
            className="w-full text-left px-4 py-3 hover:bg-muted text-sm text-foreground flex justify-between"
          >
            <span>{log}</span>
            <span className="text-primary text-xs">View</span>
          </button>
        ))}
      </div>

      {selectedLog && (
        <div className="mt-6 bg-muted rounded-[var(--radius)] p-4 overflow-auto max-h-96 border border-border">
          <div className="text-sm text-muted-foreground mb-2 font-semibold">{selectedLog}</div>
          <pre className="whitespace-pre-wrap text-xs text-foreground font-mono">{logContent}</pre>
        </div>
      )}
    </section>
  );
}

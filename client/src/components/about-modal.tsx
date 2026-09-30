import { useQuery } from "@tanstack/react-query";
import { Copy, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTheme } from "@/components/theme-provider";
import { useMeta } from "@/hooks/use-meta";
import { useTasks } from "@/hooks/use-tasks";
import { toast } from "@/hooks/use-toast";
import { diagnosticsLine } from "@/lib/diagnostics";

const RELEASE_DATE = "September 2026";
const REPO = "https://github.com/hexawulf/PiTasker";

function Diagnostics() {
  const meta = useMeta().data;
  const tasks = useTasks().data;
  const stats = useQuery<{ processRssMb: number }>({ queryKey: ["/api/system-stats"], refetchInterval: 30_000 }).data;
  const { resolvedTheme } = useTheme();
  const line = diagnosticsLine({
    version: meta?.version,
    user: meta?.user,
    hostname: meta?.hostname,
    timeZone: meta?.timeZone,
    tasks: tasks && {
      total: tasks.length,
      cron: tasks.filter((t) => t.isSystemManaged).length,
      pitasker: tasks.filter((t) => !t.isSystemManaged).length,
    },
    cronJournal: meta?.cronJournal,
    rssMb: stats?.processRssMb,
    theme: resolvedTheme,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(line);
      toast({ title: "Diagnostics copied" });
    } catch {
      toast({ title: "Couldn't copy", description: "Select the line and copy it by hand.", variant: "destructive" });
    }
  };
  return (
    <div>
      <h2 className="mb-1 font-bold">Diagnostics</h2>
      <div className="flex items-start gap-2">
        <code data-testid="diagnostics-line" className="flex-1 select-all break-words rounded bg-pi-darker px-2 py-1 font-mono text-xs text-pi-text">
          {line}
        </code>
        <Button variant="outline" size="sm" className="h-8 w-8 shrink-0 border-pi-border bg-transparent p-0 hover:bg-pi-card-hover" aria-label="Copy diagnostics" onClick={() => void copy()}>
          <Copy className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

/** Header ⓘ button + dialog, the same layout as PiDeck's About. */
export default function AboutModal() {
  const version = useMeta().data?.version;
  return (
    <Dialog>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="border-pi-border bg-transparent p-2 text-pi-text hover:bg-pi-card-hover" aria-label="About PiTasker">
              <Info className="h-5 w-5" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>About PiTasker</TooltipContent>
      </Tooltip>
      <DialogContent className="p-6 sm:rounded-xl" data-testid="about-dialog">
        <DialogHeader>
          <DialogTitle>About PiTasker</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <p className="text-pi-text-muted">The cron editor for the HexaWulf homelab: see, edit and run the jobs in your crontab, with a diff before every write.</p>
          <div>
            <h2 className="mb-1 font-bold">Tech Stack</h2>
            <ul className="list-outside list-disc space-y-1 pl-5">
              <li>Backend: Node.js, Express.js, TypeScript</li>
              <li>Scheduling: the user&apos;s crontab (no shell, backup + read-back) and node-cron</li>
              <li>Frontend: React 18, Vite, TypeScript</li>
              <li>Styling: TailwindCSS, Shadcn/ui (PiDeck 2.0 design tokens)</li>
              <li>State Management: TanStack Query</li>
              <li>Routing: Wouter (deep-linkable tabs)</li>
              <li>Database: PostgreSQL + Drizzle ORM (migrations)</li>
              <li>Auth: Session-based authentication, helmet + CSP</li>
            </ul>
          </div>
          <div>
            <h2 className="mb-1 font-bold">Contact</h2>
            <p>Author: 0xWulf</p>
            <p>
              Email: <a href="mailto:dev@0xwulf.dev" className="underline">dev@0xwulf.dev</a>
            </p>
          </div>
          <div>
            <h2 className="mb-1 font-bold">GitHub Repo</h2>
            <a href={REPO} className="break-all underline" target="_blank" rel="noopener noreferrer">
              {REPO}
            </a>
          </div>
          <div>
            <p data-testid="about-version">Version: v{version ?? "…"}</p>
            <p>Release Date: {RELEASE_DATE}</p>
          </div>
          <Diagnostics />
        </div>
      </DialogContent>
    </Dialog>
  );
}

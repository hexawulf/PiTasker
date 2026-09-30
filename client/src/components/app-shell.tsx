import { useEffect, type ComponentType } from "react";
import { Link } from "wouter";
import { useQueryClient, useIsFetching } from "@tanstack/react-query";
import { FileText, Keyboard, ListChecks, ListTodo, LogOut, RefreshCw, SettingsIcon, TerminalSquare } from "lucide-react";
import AboutModal from "@/components/about-modal";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { useMeta } from "@/hooks/use-meta";
import { useOpenShortcutHelp } from "@/shortcuts/use-shortcuts";
import { cn } from "@/lib/utils";
import TasksPage from "@/pages/tasks";
import CrontabPage from "@/pages/crontab";
import LogsPage from "@/pages/logs";
import SettingsPage from "@/pages/settings";

export const TABS: { id: string; label: string; icon: ComponentType<{ className?: string }>; component: ComponentType }[] = [
  { id: "tasks", label: "Tasks", icon: ListChecks, component: TasksPage },
  { id: "crontab", label: "Crontab", icon: TerminalSquare, component: CrontabPage },
  { id: "logs", label: "Logs", icon: FileText, component: LogsPage },
  { id: "settings", label: "Settings", icon: SettingsIcon, component: SettingsPage },
];

const iconButton = "p-2 bg-transparent hover:bg-pi-card-hover border-pi-border text-pi-text";

function HeaderButton({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" size="sm" className={iconButton} onClick={onClick} aria-label={label} disabled={disabled}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Header (PiDeck 2.0 layout) + tab links + the active tab. */
export default function AppShell({ tab }: { tab: string }) {
  const { logout, isLogoutPending, user } = useAuth();
  const meta = useMeta();
  const qc = useQueryClient();
  const fetching = useIsFetching() > 0;
  const openHelp = useOpenShortcutHelp();
  const current = TABS.find((t) => t.id === tab) ?? TABS[0];
  const Page = current.component;

  useEffect(() => {
    document.title = current.id === "tasks" ? "PiTasker" : `${current.label} · PiTasker`;
  }, [current]);

  return (
    <div className="min-h-screen bg-pi-dark text-pi-text">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-pi-card focus:p-2">
        Skip to content
      </a>
      <header className="w-full bg-pi-dark px-4 py-3 shadow-md">
        <div className="mx-auto max-w-7xl sm:px-6 lg:px-8">
          <div className="flex h-14 items-center justify-between gap-2">
            <div className="flex min-w-0 items-center space-x-3">
              <Link href="/tasks" tabIndex={-1} aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-pi-accent">
                <ListTodo className="h-5 w-5 text-pi-on-accent" />
              </Link>
              <div className="min-w-0">
                <h1 className="text-xl font-bold">
                  <Link href="/tasks" className="hover:text-pi-accent-text sr-only sm:not-sr-only">
                    PiTasker
                  </Link>
                </h1>
                <p className="hidden truncate text-sm text-pi-text-muted sm:block" data-testid="header-host">
                  Cron &amp; tasks{meta.data ? ` · ${meta.data.user}@${meta.data.hostname}` : ""}
                </p>
              </div>
            </div>

            <div className="hidden items-center space-x-2 md:flex">
              <div className="h-2 w-2 animate-pulse rounded-full bg-pi-success" aria-hidden />
              <span className="whitespace-nowrap text-sm text-pi-text-muted" title="Schedules and next runs use this zone">
                {meta.data?.timeZone ?? ""}
              </span>
            </div>

            <div className="flex items-center space-x-2">
              <AboutModal />
              <HeaderButton label="Keyboard shortcuts (?)" onClick={openHelp}>
                <Keyboard className="h-5 w-5" />
              </HeaderButton>
              <ThemeToggle />
              <HeaderButton label="Refresh (r)" onClick={() => void qc.invalidateQueries()}>
                <RefreshCw className={cn("h-5 w-5", fetching && "animate-spin")} />
              </HeaderButton>
              <HeaderButton label={`Log out${user?.username ? ` ${user.username}` : ""}`} onClick={logout} disabled={isLogoutPending}>
                <LogOut className="h-5 w-5" />
              </HeaderButton>
            </div>
          </div>
        </div>
      </header>

      <main id="main" className="pt-4 sm:pt-8">
        <div className="mx-auto max-w-7xl px-4">
          <nav aria-label="Sections" className="mb-6 flex space-x-1 overflow-x-auto rounded-xl bg-pi-card p-1">
            {TABS.map(({ id, label, icon: Icon }) => (
              <Link key={id} href={`/${id}`} aria-current={id === current.id ? "page" : undefined} className={cn("tab-button flex items-center space-x-2", id === current.id && "active")}>
                <Icon className="h-4 w-4" aria-hidden />
                <span>{label}</span>
              </Link>
            ))}
          </nav>
          <div className="pb-8">
            <Page />
          </div>
        </div>
      </main>
    </div>
  );
}

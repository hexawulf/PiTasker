import { QueryClientProvider } from "@tanstack/react-query";
import { Redirect, Route, Switch } from "wouter";
import AppShell, { TABS } from "@/components/app-shell";
import { CrontabWriteProvider } from "@/components/diff-dialog";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { queryClient } from "@/lib/api";
import LoginPage from "@/pages/login";
import { ShortcutsProvider } from "@/shortcuts/use-shortcuts";

function Routes() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <div className="min-h-screen bg-pi-dark" aria-busy="true" />;
  if (!user) {
    return (
      <Switch>
        <Route path="/login" component={LoginPage} />
        <Route>
          <Redirect to="/login" />
        </Route>
      </Switch>
    );
  }
  return (
    <ShortcutsProvider>
      <CrontabWriteProvider>
        <Switch>
          {TABS.map((t) => (
            <Route key={t.id} path={`/${t.id}`}>
              <AppShell tab={t.id} />
            </Route>
          ))}
          <Route>
            <Redirect to="/tasks" />
          </Route>
        </Switch>
      </CrontabWriteProvider>
    </ShortcutsProvider>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <Routes />
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

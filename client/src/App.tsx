import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/Dashboard";
import NotFound from "@/pages/not-found";
import { LoginPage } from "@/pages/LoginPage"; // Import LoginPage
import { ChangePasswordPage } from "@/pages/ChangePasswordPage"; // Import ChangePasswordPage
import ProtectedRoute from "@/components/ProtectedRoute"; // Import ProtectedRoute

function Router() {
  const isAuthenticated = localStorage.getItem('isAuthenticated') === 'true';

  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <ProtectedRoute path="/dashboard" component={Dashboard} />
      <ProtectedRoute path="/change-password" component={ChangePasswordPage} />

      {/* Default route: redirect to dashboard if authenticated, else to login */}
      <Route path="/">
        {isAuthenticated ? <Redirect to="/dashboard" /> : <Redirect to="/login" />}
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

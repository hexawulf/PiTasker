import { useId, useState } from "react";
import { useLocation } from "wouter";
import { ListTodo, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/theme-toggle";
import { login, useAuth } from "@/hooks/use-auth";
import { signInWithGooglePopup } from "@/lib/firebase";

function GoogleIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" {...props}>
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98Z"
      />
    </svg>
  );
}

export default function LoginPage() {
  const id = useId();
  const [, setLocation] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isGoogleSigningIn, setIsGoogleSigningIn] = useState(false);
  const { firebase, firebaseLogin, isFirebaseLoginPending } = useAuth();

  const isBusy = busy || isFirebaseLoginPending || isGoogleSigningIn;
  const firebaseEnabled = firebase?.enabled === true;

  const handleGoogleLogin = async () => {
    if (!firebase?.enabled) return;
    setIsGoogleSigningIn(true);
    setError(null);
    try {
      const idToken = await signInWithGooglePopup(firebase);
      await firebaseLogin(idToken);
      setLocation("/tasks");
    } catch (err: unknown) {
      let errorMessage = "Google sign-in failed";
      if (err instanceof Error) {
        try {
          const parts = err.message.split(": ");
          const body = parts.length > 1 ? parts.slice(1).join(": ") : parts[0];
          const parsed = JSON.parse(body);
          errorMessage = parsed.message || errorMessage;
        } catch {
          errorMessage = err.message || errorMessage;
        }
      }
      setError(errorMessage);
    } finally {
      setIsGoogleSigningIn(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
      setLocation("/tasks");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-pi-dark px-4">
      <div className="absolute right-4 top-4"><ThemeToggle /></div>
      <div className="w-full max-w-sm rounded-xl border border-pi-border bg-pi-card p-6 text-pi-text shadow-lg">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-pi-accent">
            <ListTodo className="h-5 w-5 text-pi-on-accent" aria-hidden />
          </div>
          <div>
            <h1 className="text-xl font-bold">PiTasker</h1>
            <p className="text-sm text-pi-text-muted">Sign in to manage cron</p>
          </div>
        </div>

        {firebaseEnabled && (
          <div className="mb-6 space-y-4">
            <Button
              type="button"
              variant="outline"
              onClick={handleGoogleLogin}
              disabled={isBusy}
              className="w-full flex items-center justify-center gap-3 py-3 px-4 border-pi-border bg-pi-input hover:bg-pi-card text-pi-text transition-colors duration-200"
              data-testid="google-login-button"
            >
              {isGoogleSigningIn || isFirebaseLoginPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <GoogleIcon className="w-5 h-5 flex-shrink-0" />
              )}
              <span className="font-medium">
                {isGoogleSigningIn || isFirebaseLoginPending
                  ? "Authenticating with Google..."
                  : "Sign in with Google"}
              </span>
            </Button>

            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-pi-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-pi-card px-2 text-pi-text-muted">
                  or break-glass password
                </span>
              </div>
            </div>
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor={`${id}-u`} className="mb-1 block text-sm font-medium">Username</label>
            <Input
              id={`${id}-u`}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              className="border-pi-border bg-pi-input text-pi-text"
              data-testid="login-username"
              disabled={isBusy}
            />
          </div>
          <div>
            <label htmlFor={`${id}-p`} className="mb-1 block text-sm font-medium">
              {firebaseEnabled ? "Local Admin Password (Break-Glass)" : "Password"}
            </label>
            <Input
              id={`${id}-p`}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="border-pi-border bg-pi-input text-pi-text"
              data-testid="login-password"
              disabled={isBusy}
            />
          </div>
          {error && <p role="alert" className="text-sm text-pi-error">{error}</p>}
          <Button
            type="submit"
            disabled={isBusy}
            className="w-full bg-pi-accent text-pi-on-accent hover:bg-pi-accent-hover"
            data-testid="login-submit"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {firebaseEnabled ? "Sign in with Password" : "Sign in"}
          </Button>
        </form>
      </div>
    </main>
  );
}

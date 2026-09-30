import { useId, useState } from "react";
import { ListTodo, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/theme-toggle";
import { login } from "@/hooks/use-auth";

export default function LoginPage() {
  const id = useId();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
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
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor={`${id}-u`} className="mb-1 block text-sm font-medium">Username</label>
            <Input id={`${id}-u`} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required className="border-pi-border bg-pi-input text-pi-text" data-testid="login-username" />
          </div>
          <div>
            <label htmlFor={`${id}-p`} className="mb-1 block text-sm font-medium">Password</label>
            <Input id={`${id}-p`} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required className="border-pi-border bg-pi-input text-pi-text" data-testid="login-password" />
          </div>
          {error && <p role="alert" className="text-sm text-pi-error">{error}</p>}
          <Button type="submit" disabled={busy} className="w-full bg-pi-accent text-pi-on-accent hover:bg-pi-accent-hover" data-testid="login-submit">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}Sign in
          </Button>
        </form>
      </div>
    </main>
  );
}

import { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast'; // Assuming a toast hook exists

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast(); // For displaying success/error messages

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (response.ok) {
        toast({
          title: 'Login Successful',
          description: 'Redirecting to dashboard...',
        });
        // Store authentication status if needed, e.g., in context or localStorage
        // For session-based auth, the cookie is handled by the browser automatically.
        // We might want a global state to reflect login status for UI changes.
        localStorage.setItem('isAuthenticated', 'true'); // Simple flag for now
        navigate(data.redirectTo || '/dashboard');
      } else {
        setError(data.message || 'Login failed. Please check your credentials.');
        toast({
          title: 'Login Failed',
          description: data.message || 'Please check your credentials.',
          variant: 'destructive',
        });
      }
    } catch (err) {
      console.error('Login request error:', err);
      const errorMessage = (err instanceof Error) ? err.message : 'An unexpected network error occurred. Please try again.';
      setError(errorMessage);
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 p-4">
      <Card className="w-full max-w-md bg-slate-900 border-slate-700 text-slate-50">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-teal-300">
            PiTasker Login
          </CardTitle>
          <CardDescription className="text-slate-400">
            Enter your credentials to access your dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="username" className="text-slate-300">Username</Label>
              <Input
                id="username"
                type="text"
                placeholder="admin"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="bg-slate-800 border-slate-600 text-slate-50 placeholder-slate-500 focus:ring-blue-500 focus:border-blue-500"
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password"className="text-slate-300">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="bg-slate-800 border-slate-600 text-slate-50 placeholder-slate-500 focus:ring-blue-500 focus:border-blue-500"
                disabled={isLoading}
              />
            </div>
            {error && (
              <p className="text-sm text-red-400 bg-red-900/30 p-3 rounded-md border border-red-700">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg shadow-md transition duration-150 ease-in-out transform hover:scale-105 focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50" disabled={isLoading}>
              {isLoading ? (
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                'Login'
              )}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="text-center text-sm text-slate-400">
          <p>This is a private system. Unauthorized access is prohibited.</p>
        </CardFooter>
      </Card>
    </div>
  );
}

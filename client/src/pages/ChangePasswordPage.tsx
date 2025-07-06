import { useState, FormEvent } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';

export function ChangePasswordPage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    setSuccessMessage(null);

    if (newPassword !== confirmNewPassword) {
      setError('New passwords do not match.');
      setIsLoading(false);
      toast({ title: 'Error', description: 'New passwords do not match.', variant: 'destructive' });
      return;
    }

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters long.');
      setIsLoading(false);
      toast({ title: 'Error', description: 'New password must be at least 8 characters long.', variant: 'destructive' });
      return;
    }

    try {
      const response = await fetch('/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ currentPassword, newPassword, confirmNewPassword }),
      });

      const data = await response.json();

      if (response.ok) {
        setSuccessMessage(data.message || 'Password changed successfully!');
        toast({
          title: 'Success',
          description: data.message || 'Password changed successfully!',
        });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmNewPassword('');
        // Optionally navigate away or clear form after a delay
        // setTimeout(() => navigate('/dashboard'), 2000);
      } else {
        setError(data.message || 'Failed to change password.');
        toast({
          title: 'Error',
          description: data.message || 'Failed to change password.',
          variant: 'destructive',
        });
      }
    } catch (err) {
      console.error('Change password request error:', err);
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
          <CardTitle className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-400">
            Change Password
          </CardTitle>
          <CardDescription className="text-slate-400">
            Update your account password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="currentPassword" className="text-slate-300">Current Password</Label>
              <Input
                id="currentPassword"
                type="password"
                placeholder="••••••••"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                className="bg-slate-800 border-slate-600 text-slate-50 placeholder-slate-500 focus:ring-purple-500 focus:border-purple-500"
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newPassword" className="text-slate-300">New Password</Label>
              <Input
                id="newPassword"
                type="password"
                placeholder="••••••••"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                className="bg-slate-800 border-slate-600 text-slate-50 placeholder-slate-500 focus:ring-purple-500 focus:border-purple-500"
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmNewPassword" className="text-slate-300">Confirm New Password</Label>
              <Input
                id="confirmNewPassword"
                type="password"
                placeholder="••••••••"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                required
                className="bg-slate-800 border-slate-600 text-slate-50 placeholder-slate-500 focus:ring-purple-500 focus:border-purple-500"
                disabled={isLoading}
              />
            </div>
            {error && (
               <p className="text-sm text-red-400 bg-red-900/30 p-3 rounded-md border border-red-700">
                {error}
              </p>
            )}
            {successMessage && (
              <p className="text-sm text-green-400 bg-green-900/30 p-3 rounded-md border border-green-700">
                {successMessage}
              </p>
            )}
            <Button type="submit" className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 rounded-lg shadow-md transition duration-150 ease-in-out transform hover:scale-105 focus:ring-2 focus:ring-purple-500 focus:ring-opacity-50" disabled={isLoading}>
              {isLoading ? (
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                'Change Password'
              )}
            </Button>
          </form>
        </CardContent>
         <CardFooter className="flex flex-col items-center space-y-2 text-sm text-slate-400">
           <Button variant="link" className="p-0 h-auto text-slate-400 hover:text-slate-200" onClick={() => navigate('/dashboard')}>
            Back to Dashboard
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

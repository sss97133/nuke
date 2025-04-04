import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { ClassicWindow } from '@/components/auth/ClassicWindow';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';

/**
 * ResetPassword component allows users to set a new password
 * after clicking on a password reset link
 */
const ResetPassword: React.FC = () => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate password
    if (password.length < 8) {
      toast({
        title: 'Password Too Short',
        description: 'Password must be at least 8 characters long',
        variant: 'destructive',
      });
      return;
    }

    // Confirm passwords match
    if (password !== confirmPassword) {
      toast({
        title: 'Passwords Do Not Match',
        description: 'Please ensure both passwords match',
        variant: 'destructive',
      });
      return;
    }

    try {
      setLoading(true);
      
      // Update the password
      const { error } = await supabase.auth.updateUser({
        password,
      });

      if (error) {
        throw error;
      }

      toast({
        title: 'Password Updated',
        description: 'Your password has been reset successfully',
      });

      // Redirect to dashboard or home
      navigate('/dashboard', { replace: true });
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown password reset error');
      console.error('Password reset error:', error);
      toast({
        title: 'Password Reset Failed',
        description: error.message || 'An error occurred while resetting your password',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-muted/40">
      <ClassicWindow title="Reset Your Password">
        <div className="p-6">
          <h2 className="text-xl font-semibold mb-4">Set New Password</h2>
          <p className="text-muted-foreground mb-6">
            Please enter a new password for your account.
          </p>

          <form onSubmit={handleResetPassword} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium">
                New Password
              </label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter new password"
                required
                minLength={8}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground">
                Password must be at least 8 characters
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="confirmPassword" className="text-sm font-medium">
                Confirm Password
              </label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                required
                className="w-full"
              />
            </div>

            <div className="pt-2">
              <Button
                type="submit"
                className="w-full"
                disabled={loading}
              >
                {loading ? 'Resetting Password...' : 'Reset Password'}
              </Button>
            </div>

            <div className="text-center mt-4">
              <button
                type="button"
                onClick={() => navigate('/login')}
                className="text-sm text-blue-600 hover:underline"
              >
                Return to login
              </button>
            </div>
          </form>
        </div>
      </ClassicWindow>
    </div>
  );
};

export default ResetPassword;

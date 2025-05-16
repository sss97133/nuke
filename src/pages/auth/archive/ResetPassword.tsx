import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { getSupabaseClient } from '@/integrations/supabase/client';
import { ClassicWindow } from '@/components/auth/ClassicWindow';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';

/**
 * Extract the hash parameters from the URL, since Supabase embeds the token there
 */
const useHashParams = () => {
  const [hashParams, setHashParams] = useState<Record<string, string>>({});
  const location = useLocation();

  useEffect(() => {
    // Parse hash parameters from URL
    const hash = location.hash.substring(1); // Remove the # character
    const params: Record<string, string> = {};
    
    hash.split('&').forEach(pair => {
      const [key, value] = pair.split('=');
      if (key && value) {
        params[key] = decodeURIComponent(value);
      }
    });
    
    setHashParams(params);
  }, [location]);

  return hashParams;
};

/**
 * ResetPassword component allows users to set a new password
 * after clicking on a password reset link
 */
const ResetPassword: React.FC = () => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [tokenValid, setTokenValid] = useState<boolean | null>(null);
  const navigate = useNavigate();
  const hashParams = useHashParams();
  
  // Verify the token is present and valid on component mount
  useEffect(() => {
    const verifyToken = async () => {
      try {
        const accessToken = hashParams.access_token;
        const type = hashParams.type;
        
        if (!accessToken || type !== 'recovery') {
          setTokenValid(false);
          toast({
            title: 'Invalid Reset Link',
            description: 'This password reset link is invalid or has expired',
            variant: 'destructive',
          });
        } else {
          setTokenValid(true);
        }
      } catch (error) {
        console.error('Token verification error:', error);
        setTokenValid(false);
      }
    };
    
    verifyToken();
  }, [hashParams]);



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
    
    // Get the tokens directly from the existing hashParams
    const accessToken = hashParams.access_token || '';
    const refreshToken = hashParams.refresh_token || '';
    const type = hashParams.type || '';
    
    if (!accessToken || type !== 'recovery') {
      throw new Error('Invalid or missing recovery token. Please request a new password reset link.');
    }
    
    const supabase = getSupabaseClient();
    if (!supabase) {
      throw new Error('Error initializing authentication client');
    }
    
    // Set the session using the access token and refresh token from URL
    await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken
    });
    
    // Now update the password using the authenticated session
    const { error } = await supabase.auth.updateUser({
      password
    });

    if (error) {
      throw error;
    }

    toast({
      title: 'Password Updated',
      description: 'Your password has been reset successfully',
    });

    // Redirect to dashboard or login
    navigate('/login', { replace: true });
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
          
          {tokenValid === false ? (
            <div className="text-center py-4">
              <p className="text-red-500 mb-4">
                This password reset link is invalid or has expired.
              </p>
              <Button 
                onClick={() => navigate('/login')}
                className="mt-2"
              >
                Return to Login
              </Button>
            </div>
          ) : tokenValid === true ? (
            <>
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
            </>
          ) : (
            <div className="py-4 text-center">
              <p>Verifying reset link...</p>
              <div className="mt-4 flex justify-center">
                <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full"></div>
              </div>
            </div>
          )}
        </div>
      </ClassicWindow>
    </div>
  );
};

export default ResetPassword;

import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/lib/supabase-client';
import { LoadingScreen } from '@/components/common/LoadingScreen';
import { ClassicWindow } from '@/components/auth/ClassicWindow';
import { toast } from '@/hooks/use-toast';
import { useUserStore } from '@/stores/userStore';

/**
 * AuthCallback component handles auth redirects from Supabase
 * including password reset, email verification, and magic link logins
 */
const AuthCallback: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { getCurrentUser } = useUserStore();

  useEffect(() => {
    const processAuthRedirect = async () => {
      try {
        setLoading(true);
        
        // Log full URL for debugging
        console.log('AUTH CALLBACK URL:', window.location.href);
        console.log('AUTH CALLBACK PATH:', location.pathname);
        console.log('AUTH CALLBACK HASH:', location.hash);
        console.log('AUTH CALLBACK SEARCH:', location.search);
        
        // Different Supabase versions use different formats
        // Some use hash fragments, others use query params
        let accessToken, refreshToken, type, expiresIn;
        
        // Check hash format first (newer Supabase)
        if (location.hash) {
          console.log('Using hash fragment for auth params');
          // Parse the hash fragment
          const hashParams = new URLSearchParams(
            location.hash.substring(1) // Remove the # character
          );
          
          accessToken = hashParams.get('access_token');
          refreshToken = hashParams.get('refresh_token');
          type = hashParams.get('type');
          expiresIn = hashParams.get('expires_in');
        }
        
        // Check query params (older Supabase or redirects)
        if (!accessToken && location.search) {
          console.log('Using query params for auth params');
          const queryParams = new URLSearchParams(location.search);
          
          accessToken = queryParams.get('access_token');
          refreshToken = queryParams.get('refresh_token');
          type = queryParams.get('type');
          expiresIn = queryParams.get('expires_in');
        }
        
        // Check if token is in pathname (direct token pasting)
        if (!accessToken && location.pathname.includes('token=')) {
          console.log('Token appears to be in pathname');
          const tokenIndex = location.pathname.indexOf('token=');
          if (tokenIndex !== -1) {
            const tokenValue = location.pathname.substring(tokenIndex + 6);
            console.log('Extracted token value:', tokenValue);
            accessToken = tokenValue;
            type = 'recovery'; // Assume recovery as default
          }
        }

        // Log what we found for debugging
        console.log('Auth params found:', { accessToken: !!accessToken, refreshToken: !!refreshToken, type, expiresIn });
        
        if (!accessToken) {
          // Try direct Supabase method as last resort
          console.log('No access token found, trying Supabase auth recovery');
          const { data, error } = await supabase.auth.getSession();
          console.log('Current session data:', data);
          
          if (error || !data.session) {
            console.error('Session recovery failed:', error);
            throw new Error('Could not get authentication data from URL or session');
          }
          
          // We have a valid session, update user state
          try {
            await getCurrentUser();
            console.log('User state successfully updated from session');
          } catch (userError) {
            console.error('Error updating user state:', userError);
            // Continue anyway as we have a valid session
          }
          
          // We have a valid session, go to dashboard
          toast({
            title: 'Authentication Successful',
            description: 'You have been authenticated',
          });
          
          navigate('/dashboard', { replace: true });
          return;
        }
        
        if (!type) {
          console.log('No type specified, assuming recovery');
          type = 'recovery';
        }

        console.log(`Processing auth callback of type: ${type}`);

        // Based on the type, handle different auth flows
        switch (type) {
          case 'recovery': // Password reset
            // Set session with the tokens
            console.log('Setting session with access token, recovery flow');
            
            // Try different approaches based on token format
            let sessionResult;
            
            try {
              // Try direct token redemption first - this works better with newer Supabase versions
              console.log('Trying direct token redemption for newer Supabase versions');
              const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
                token_hash: accessToken,
                type: 'recovery',
              });
              
              if (verifyError) {
                console.error('Error in verifyOtp:', verifyError);
                
                // Fall back to setSession for older Supabase versions
                console.log('Falling back to setSession for older Supabase versions');
                sessionResult = await supabase.auth.setSession({
                  access_token: accessToken,
                  refresh_token: refreshToken || '',
                });
              } else {
                console.log('verifyOtp successful:', verifyData);
                // Create a dummy result object to match the expected structure
                sessionResult = { data: verifyData, error: null };
              }
            } catch (authError) {
              console.error('All auth methods failed:', authError);
              
              // Last resort - just navigate to reset password page with error info
              navigate('/reset-password', { 
                replace: true,
                state: { 
                  authError: true,
                  errorMessage: 'Token processing failed' 
                }
              });
              return; // End processing as we're redirecting
            }
            
            const { error: sessionError } = sessionResult;

            if (sessionError) {
              throw new Error(`Session error: ${sessionError.message}`);
            }

            toast({
              title: 'Password Reset Successful',
              description: 'You can now set a new password',
            });
            
            // Navigate to password reset form
            navigate('/reset-password', { replace: true });
            break;

          case 'signup':
          case 'magiclink':
            // Set session with the tokens
            const { error: loginError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken || '',
            });

            if (loginError) {
              throw new Error(`Login error: ${loginError.message}`);
            }

            toast({
              title: 'Authentication Successful',
              description: 'You are now logged in',
            });

            // Redirect to home/dashboard
            navigate('/dashboard', { replace: true });
            break;

          default:
            console.warn(`Unknown auth type: ${type}`);
            // Default to dashboard
            navigate('/dashboard', { replace: true });
        }
      } catch (err: any) {
        console.error('Auth callback error:', err);
        setError(err.message || 'Authentication failed');
        toast({
          title: 'Authentication Error',
          description: err.message || 'An error occurred during authentication',
          variant: 'destructive',
        });
        // Redirect to login on error
        navigate('/login', { replace: true });
      } finally {
        setLoading(false);
      }
    };

    processAuthRedirect();
  }, [location.hash, navigate]);

  if (loading) {
    return <LoadingScreen message="Processing authentication..." />;
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <ClassicWindow title="Authentication Error">
          <div className="p-6 text-center">
            <h2 className="text-xl font-semibold mb-2">Authentication Failed</h2>
            <p className="text-muted-foreground mb-4">{error}</p>
            <button
              className="btn btn-primary"
              onClick={() => navigate('/login')}
            >
              Return to Login
            </button>
          </div>
        </ClassicWindow>
      </div>
    );
  }

  return <LoadingScreen message="Redirecting..." />;
};

export default AuthCallback;

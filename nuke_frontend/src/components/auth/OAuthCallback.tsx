import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

const OAuthCallback = () => {
  const navigate = useNavigate();
  const [isProcessing, setIsProcessing] = useState(true);

  useEffect(() => {
    const handleOAuthCallback = async () => {
      try {
        console.log('Processing OAuth callback...');
        console.log('Current URL:', window.location.href);
        console.log('Hash:', window.location.hash);
        console.log('Search:', window.location.search);
        
        // Supabase handles the OAuth callback automatically via URL hash
        // We just need to wait for it to process and check for session
        const { data, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error('OAuth callback error:', error);
          setIsProcessing(false);
          navigate('/login?error=oauth_failed');
          return;
        }

        if (data.session) {
          console.log('OAuth login successful:', data.session.user);
          setIsProcessing(false);
          navigate('/vehicles');
        } else {
          console.log('No session found, waiting for auth state change...');
          // Don't navigate yet, let the auth state change handler do it
        }
      } catch (err) {
        console.error('OAuth callback error:', err);
        setIsProcessing(false);
        navigate('/login?error=oauth_failed');
      }
    };

    // Listen for auth state changes - this is the primary mechanism
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('Auth state change:', event, session);
      if (event === 'SIGNED_IN' && session) {
        console.log('User signed in via OAuth');
        setIsProcessing(false);
        navigate('/vehicles');
      } else if (event === 'SIGNED_OUT') {
        console.log('User signed out');
        setIsProcessing(false);
        navigate('/login');
      } else if (event === 'TOKEN_REFRESHED') {
        console.log('Token refreshed');
      }
    });

    // Small delay to let Supabase process the URL hash
    setTimeout(handleOAuthCallback, 100);

    return () => {
      subscription.unsubscribe();
    };
  }, [navigate]);

  return (
    <div className="layout">
      <div className="container">
        <div className="main" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
          <div style={{ textAlign: 'center' }}>
            <h2 className="heading-2" style={{ marginBottom: '16px' }}>Completing sign in...</h2>
            <p className="text text-muted">Please wait while we complete your authentication.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OAuthCallback;

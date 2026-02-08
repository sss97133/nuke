import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

const OAuthCallback = () => {
  const navigate = useNavigate();
  const [isProcessing, setIsProcessing] = useState(true);

  useEffect(() => {
    const handleOAuthCallback = async () => {
      try {
        // Supabase handles the OAuth callback automatically via URL hash
        // We just need to wait for it to process and check for session
        const { data, error } = await supabase.auth.getSession();

        if (error) {
          setIsProcessing(false);
          navigate('/login?error=oauth_failed');
          return;
        }

        if (data.session) {
          setIsProcessing(false);
          navigate('/vehicles');
        }
        // If no session yet, let the auth state change handler below handle it
      } catch (err) {
        setIsProcessing(false);
        navigate('/login?error=oauth_failed');
      }
    };

    // Listen for auth state changes - this is the primary mechanism
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        setIsProcessing(false);
        navigate('/vehicles');
      } else if (event === 'SIGNED_OUT') {
        setIsProcessing(false);
        navigate('/login');
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

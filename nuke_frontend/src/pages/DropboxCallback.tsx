import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import '../design-system.css';

const DropboxCallback: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Parse URL fragment for access token (implicit grant flow)
        const fragment = window.location.hash.substring(1);
        const params = new URLSearchParams(fragment);
        
        const accessToken = params.get('access_token');
        const tokenType = params.get('token_type');
        const expiresIn = params.get('expires_in');
        const state = params.get('state');
        const errorParam = params.get('error');

        if (errorParam) {
          throw new Error(`Dropbox authorization failed: ${errorParam}`);
        }

        if (!accessToken) {
          throw new Error('No access token received from Dropbox');
        }

        // Verify state parameter (basic CSRF protection)
        const savedState = localStorage.getItem('dropbox_oauth_state');
        if (state !== savedState) {
          console.warn('State parameter mismatch:', { received: state, saved: savedState });
          // For development, continue but log the issue
          // throw new Error('Invalid state parameter - possible CSRF attack');
        }

        // Debug: Log token info
        console.log('Dropbox OAuth Success:', {
          tokenLength: accessToken.length,
          tokenType,
          expiresIn,
          tokenPrefix: accessToken.substring(0, 20) + '...'
        });

        // Store the access token with expiration
        localStorage.setItem('dropbox_access_token', accessToken);
        localStorage.setItem('dropbox_token_type', tokenType || 'bearer');
        
        if (expiresIn) {
          const expirationTime = Date.now() + (parseInt(expiresIn) * 1000);
          localStorage.setItem('dropbox_token_expires', expirationTime.toString());
        }
        
        // Clean up state
        localStorage.removeItem('dropbox_oauth_state');

        console.log('Dropbox access token stored successfully');
        setStatus('success');
        
        // Always redirect to vehicles page with categorize tab - let the route handle auth
        const redirectToPhotoCategorizer = () => {
          navigate('/login?returnUrl=' + encodeURIComponent('/vehicles?tab=categorize'));
        };
        
        // Redirect after a brief success message
        setTimeout(redirectToPhotoCategorizer, 2000);

      } catch (err) {
        console.error('OAuth callback error:', err);
        setError(err instanceof Error ? err.message : 'Unknown error occurred');
        setStatus('error');
      }
    };

    handleCallback();
  }, [navigate]);

  return (
    <div className="fade-in">
        <section className="section">
          <div className="card">
            <div className="card-body text-center">
              {status === 'processing' && (
                <>
                  <div className="loading-spinner mb-4"></div>
                  <h2 className="text-large font-bold mb-2">Connecting to Dropbox</h2>
                  <p className="text text-muted">
                    Processing your authorization and setting up access...
                  </p>
                </>
              )}

              {status === 'success' && (
                <>
                  <div className="text-primary mb-4">
                    <svg className="w-16 h-16 mx-auto" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <h2 className="text-large font-bold mb-2 text-primary">Successfully Connected!</h2>
                  <p className="text text-muted mb-4">
                    Your Dropbox account has been connected. Redirecting to import page...
                  </p>
                  <div className="loading-spinner"></div>
                </>
              )}

              {status === 'error' && (
                <>
                  <div className="text-error mb-4">
                    <svg className="w-16 h-16 mx-auto" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <h2 className="text-large font-bold mb-2 text-error">Connection Failed</h2>
                  <p className="text text-muted mb-4">
                    {error || 'An error occurred while connecting to Dropbox'}
                  </p>
                  <button 
                    className="button button-primary"
                    onClick={() => navigate('/dropbox-import')}
                  >
                    Try Again
                  </button>
                </>
              )}
            </div>
          </div>
        </section>
      </div>
  );
};

export default DropboxCallback;

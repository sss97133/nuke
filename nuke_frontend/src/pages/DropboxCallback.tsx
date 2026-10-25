import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DROPBOX_OAUTH_STATE_KEY, readPendingDropboxAuthorization } from '../services/dropboxOAuth';
import '../styles/unified-design-system.css';

const DropboxCallback: React.FC = () => {
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [error, setError] = useState<string | null>(null);
  const [returnPath, setReturnPath] = useState<string | null>(null);
  const processed = useRef(false);
  const connectedToken = useRef<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    // React StrictMode replays effects; consume this callback only once per mount.
    if (processed.current) return;
    processed.current = true;
    const handleCallback = () => {
      try {
        // Parse URL fragment for access token (implicit grant flow)
        const fragment = window.location.hash.substring(1);
        const params = new URLSearchParams(fragment);
        window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
        
        const accessToken = params.get('access_token');
        const tokenType = params.get('token_type');
        const expiresIn = params.get('expires_in');
        const state = params.get('state');
        const errorParam = params.get('error');

        if (errorParam) {
          throw new Error('Dropbox authorization was not completed. Return to your organization to connect again.');
        }

        const pending = readPendingDropboxAuthorization(localStorage.getItem(DROPBOX_OAUTH_STATE_KEY));
        if (!state || !pending || state !== pending.state) {
          throw new Error('This Dropbox connection could not be verified. Return to your organization to connect again.');
        }

        if (!accessToken) {
          throw new Error('No access token received from Dropbox. Return to your organization to connect again.');
        }
        const expiresSeconds = expiresIn === null ? null : Number(expiresIn);
        if (expiresSeconds !== null && (!Number.isSafeInteger(expiresSeconds) || expiresSeconds <= 0 || !Number.isSafeInteger(Date.now() + expiresSeconds * 1000))) {
          throw new Error('Dropbox returned an invalid token expiration. Return to your organization to connect again.');
        }

        // Store the access token with expiration
        localStorage.setItem('dropbox_access_token', accessToken);
        localStorage.setItem('dropbox_token_type', tokenType || 'bearer');
        
        if (expiresSeconds !== null) {
          const expirationTime = Date.now() + expiresSeconds * 1000;
          localStorage.setItem('dropbox_token_expires', expirationTime.toString());
        } else {
          localStorage.removeItem('dropbox_token_expires');
        }
        
        // Clean up state
        localStorage.removeItem(DROPBOX_OAUTH_STATE_KEY);

        connectedToken.current = accessToken;
        setReturnPath(pending.returnPath);
        setStatus('success');

      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error occurred');
        setStatus('error');
      }
    };

    handleCallback();
  }, []);

  const startImport = () => {
    if (!returnPath) return;
    try {
      // Another tab may have disconnected or connected a different account while
      // this success screen waited. Do not import through a changed connection.
      if (connectedToken.current && localStorage.getItem('dropbox_access_token') === connectedToken.current) {
        navigate(returnPath);
        return;
      }
    } catch {
      // Unreadable storage cannot establish that this is the verified connection.
    }
    setReturnPath(null);
    setError('The Dropbox connection changed. Return to your organization to connect again.');
    setStatus('error');
  };

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
                    Your Dropbox account has been connected. Starting the import scans your organization's Dropbox inventory and syncs missing vehicle images.
                  </p>
                  <button className="button button-primary" onClick={startImport}>
                    Start Dropbox import
                  </button>
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
                    onClick={() => navigate('/')}
                  >
                    Return home
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

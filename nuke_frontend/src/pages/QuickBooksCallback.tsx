/**
 * QuickBooks OAuth Callback Handler
 *
 * Handles the OAuth redirect from QuickBooks and exchanges the
 * authorization code for access tokens.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';

export default function QuickBooksCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [message, setMessage] = useState('Processing QuickBooks authorization...');

  useEffect(() => {
    handleCallback();
  }, []);

  async function handleCallback() {
    try {
      const code = searchParams.get('code');
      const realmId = searchParams.get('realmId');
      const state = searchParams.get('state');
      const error = searchParams.get('error');

      // Check for OAuth errors
      if (error) {
        setStatus('error');
        setMessage(`QuickBooks authorization failed: ${error}`);
        return;
      }

      // Validate required parameters
      if (!code || !realmId) {
        setStatus('error');
        setMessage('Missing authorization code or realm ID from QuickBooks');
        return;
      }

      // Verify state matches (CSRF protection)
      const storedState = localStorage.getItem('qb_oauth_state');
      if (storedState && state !== storedState) {
        setStatus('error');
        setMessage('Security validation failed. Please try connecting again.');
        return;
      }

      // Clear stored state
      localStorage.removeItem('qb_oauth_state');

      // Exchange code for tokens via our edge function
      const session = (await supabase.auth.getSession()).data.session;
      const headers: Record<string, string> = {};
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/quickbooks-connect?action=callback&code=${encodeURIComponent(code)}&realmId=${encodeURIComponent(realmId)}`,
        { headers }
      );

      const data = await res.json();

      if (data.success) {
        setStatus('success');
        setMessage('QuickBooks connected successfully!');

        // Redirect to business settings after a short delay
        setTimeout(() => {
          navigate('/business/settings');
        }, 2000);
      } else {
        setStatus('error');
        setMessage(data.error || 'Failed to connect QuickBooks');
      }
    } catch (err: any) {
      console.error('Callback error:', err);
      setStatus('error');
      setMessage(err.message || 'An error occurred during authorization');
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <div className="max-w-md w-full mx-4">
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-8 text-center">
          {/* Status Icon */}
          <div className="mb-6">
            {status === 'processing' && (
              <div className="inline-flex p-4 bg-blue-500/10 rounded-full">
                <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
              </div>
            )}
            {status === 'success' && (
              <div className="inline-flex p-4 bg-green-500/10 rounded-full">
                <CheckCircle2 className="w-12 h-12 text-green-500" />
              </div>
            )}
            {status === 'error' && (
              <div className="inline-flex p-4 bg-red-500/10 rounded-full">
                <XCircle className="w-12 h-12 text-red-500" />
              </div>
            )}
          </div>

          {/* Title */}
          <h1 className="text-xl font-bold text-white mb-2">
            {status === 'processing' && 'Connecting QuickBooks'}
            {status === 'success' && 'Connection Successful'}
            {status === 'error' && 'Connection Failed'}
          </h1>

          {/* Message */}
          <p className="text-zinc-400 mb-6">{message}</p>

          {/* Actions */}
          {status === 'error' && (
            <div className="space-y-3">
              <button
                onClick={() => navigate('/business/settings')}
                className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium text-white transition-colors"
              >
                Back to Settings
              </button>
              <button
                onClick={() => window.location.reload()}
                className="w-full px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg font-medium text-white transition-colors"
              >
                Try Again
              </button>
            </div>
          )}

          {status === 'success' && (
            <p className="text-sm text-zinc-500">
              Redirecting to settings...
            </p>
          )}
        </div>

        {/* Security Footer */}
        <p className="text-center text-xs text-zinc-600 mt-4">
          Your connection is encrypted and tokens are stored securely.
        </p>
      </div>
    </div>
  );
}

import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';

interface TwoFactorRequest {
  id: string;
  credential_id: string;
  method: string;
  challenge_data: any;
  expires_at: string;
  status: string;
}

interface TwoFactorModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: TwoFactorRequest;
  platform: string;
  onSuccess?: () => void;
}

const PLATFORM_NAMES: Record<string, string> = {
  bat: 'Bring a Trailer',
  cars_and_bids: 'Cars & Bids',
  pcarmarket: 'PCarMarket',
  collecting_cars: 'Collecting Cars',
};

export default function TwoFactorModal({
  isOpen,
  onClose,
  request,
  platform,
  onSuccess,
}: TwoFactorModalProps) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!request?.expires_at) return;

    const updateTimer = () => {
      const now = new Date().getTime();
      const expiry = new Date(request.expires_at).getTime();
      const remaining = Math.max(0, Math.floor((expiry - now) / 1000));
      setTimeLeft(remaining);

      if (remaining <= 0) {
        onClose();
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [request?.expires_at, onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code || code.length < 6) {
      setError('Please enter a valid 6-digit code');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Submit the 2FA code
      const { error: updateError } = await supabase
        .from('pending_2fa_requests')
        .update({
          user_code: code,
          submitted_at: new Date().toISOString(),
          status: 'submitted',
        })
        .eq('id', request.id);

      if (updateError) throw updateError;

      // Trigger validation with the code
      const { data, error: fnError } = await supabase.functions.invoke('submit-2fa-code', {
        body: {
          request_id: request.id,
          code: code,
        },
      });

      if (fnError) throw fnError;

      if (data.success) {
        onSuccess?.();
        onClose();
      } else {
        setError(data.error || 'Invalid code. Please try again.');
        setCode('');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to verify code');
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '20px',
      }}
    >
      <div
        style={{
          background: 'var(--surface)',
          borderRadius: '8px',
          maxWidth: '400px',
          width: '100%',
          padding: '24px',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <div
            style={{
              width: '64px',
              height: '64px',
              background: '#fef3c7',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
              fontSize: '28pt',
            }}
          >
            🔐
          </div>
          <h2 style={{ margin: '0 0 8px', fontSize: '14pt', fontWeight: 700 }}>
            Two-Factor Authentication
          </h2>
          <p style={{ margin: 0, fontSize: '9pt', color: 'var(--text-secondary)' }}>
            Enter the verification code from your authenticator app to log in to{' '}
            {PLATFORM_NAMES[platform] || platform}
          </p>
        </div>

        {error && (
          <div
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#991b1b',
              padding: '10px 12px',
              borderRadius: '4px',
              marginBottom: '16px',
              fontSize: '9pt',
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                setCode(val);
              }}
              placeholder="000000"
              maxLength={6}
              style={{
                width: '100%',
                padding: '16px',
                fontSize: '24pt',
                fontFamily: 'monospace',
                textAlign: 'center',
                letterSpacing: '0.5em',
                border: '2px solid var(--border)',
                borderRadius: '4px',
              }}
            />
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              marginBottom: '16px',
              fontSize: '8pt',
              color: timeLeft <= 30 ? '#ef4444' : 'var(--text-muted)',
            }}
          >
            <span>Expires in</span>
            <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>
              {formatTime(timeLeft)}
            </span>
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="button"
              style={{ flex: 1, fontSize: '9pt' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || code.length < 6}
              className="button button-primary"
              style={{ flex: 1, fontSize: '9pt' }}
            >
              {loading ? 'Verifying...' : 'Verify'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Hook to watch for pending 2FA requests
export function usePending2FARequests() {
  const { user } = useAuth();
  const [pendingRequest, setPendingRequest] = useState<TwoFactorRequest | null>(null);
  const [platform, setPlatform] = useState<string>('');

  useEffect(() => {
    if (!user) return;

    // Check for existing pending requests
    const checkPending = async () => {
      const { data } = await supabase
        .from('pending_2fa_requests')
        .select(`
          *,
          platform_credentials!inner(platform, user_id)
        `)
        .eq('platform_credentials.user_id', user.id)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        setPendingRequest(data);
        setPlatform(data.platform_credentials?.platform || '');
      }
    };

    checkPending();

    // Subscribe to realtime changes
    const channel = supabase
      .channel('pending_2fa')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'pending_2fa_requests',
        },
        async (payload) => {
          // Check if this request belongs to the current user
          const { data: cred } = await supabase
            .from('platform_credentials')
            .select('user_id, platform')
            .eq('id', payload.new.credential_id)
            .single();

          if (cred?.user_id === user.id) {
            setPendingRequest(payload.new as TwoFactorRequest);
            setPlatform(cred.platform);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const clearRequest = () => {
    setPendingRequest(null);
    setPlatform('');
  };

  return { pendingRequest, platform, clearRequest };
}

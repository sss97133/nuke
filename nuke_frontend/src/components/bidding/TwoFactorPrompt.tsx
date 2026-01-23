import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';

interface TwoFactorPromptProps {
  isOpen: boolean;
  onClose: () => void;
  request: {
    request_id: string;
    method: string;
    challenge_data?: {
      masked_phone?: string;
      email_hint?: string;
      security_question?: string;
    };
    expires_at: string;
    platform: string;
  } | null;
  onVerified?: () => void;
}

export default function TwoFactorPrompt({
  isOpen,
  onClose,
  request,
  onVerified
}: TwoFactorPromptProps) {
  const { user } = useAuth();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Countdown timer
  useEffect(() => {
    if (!request?.expires_at) return;

    const updateTime = () => {
      const remaining = Math.max(0, new Date(request.expires_at).getTime() - Date.now());
      setTimeRemaining(Math.floor(remaining / 1000));
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [request?.expires_at]);

  // Auto-focus input
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !request || !code.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('submit-2fa-code', {
        body: {
          request_id: request.request_id,
          code: code.trim()
        }
      });

      if (fnError) throw fnError;

      if (data.success) {
        onVerified?.();
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

  const getMethodInfo = () => {
    switch (request?.method) {
      case 'totp':
        return {
          title: 'Authenticator Code',
          description: 'Enter the 6-digit code from your authenticator app',
          placeholder: '000000'
        };
      case 'sms':
        return {
          title: 'SMS Code',
          description: request?.challenge_data?.masked_phone
            ? `Enter the code sent to ${request.challenge_data.masked_phone}`
            : 'Enter the code sent to your phone',
          placeholder: '000000'
        };
      case 'email':
        return {
          title: 'Email Code',
          description: request?.challenge_data?.email_hint
            ? `Enter the code sent to ${request.challenge_data.email_hint}`
            : 'Enter the code sent to your email',
          placeholder: '000000'
        };
      case 'security_question':
        return {
          title: 'Security Question',
          description: request?.challenge_data?.security_question || 'Answer your security question',
          placeholder: 'Your answer'
        };
      default:
        return {
          title: 'Verification Code',
          description: 'Enter your verification code',
          placeholder: '000000'
        };
    }
  };

  const getPlatformName = (platform: string) => {
    const names: Record<string, string> = {
      bat: 'Bring a Trailer',
      cars_and_bids: 'Cars & Bids',
      pcarmarket: 'PCarMarket',
      collecting_cars: 'Collecting Cars',
    };
    return names[platform] || platform;
  };

  if (!isOpen || !request) return null;

  const methodInfo = getMethodInfo();
  const isExpired = timeRemaining <= 0;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10001,
        padding: '20px'
      }}
    >
      <div
        style={{
          background: 'var(--surface)',
          borderRadius: '8px',
          maxWidth: '380px',
          width: '100%',
          boxShadow: '0 8px 24px rgba(0,0,0,0.3)'
        }}
      >
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '32px',
              height: '32px',
              background: '#fef3c7',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '14pt'
            }}>
              🔐
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '11pt', fontWeight: 700 }}>
                {methodInfo.title}
              </h2>
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                {getPlatformName(request.platform)}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '16pt',
              cursor: 'pointer',
              padding: '0 4px',
              color: 'var(--text-muted)'
            }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '20px' }}>
          {/* Timer */}
          <div style={{
            background: isExpired ? '#fef2f2' : '#fef3c7',
            border: `1px solid ${isExpired ? '#fecaca' : '#fcd34d'}`,
            padding: '10px 12px',
            borderRadius: '4px',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <span style={{ fontSize: '8pt', color: isExpired ? '#991b1b' : '#92400e' }}>
              {isExpired ? 'Code expired' : 'Time remaining'}
            </span>
            <span style={{
              fontSize: '11pt',
              fontWeight: 700,
              color: isExpired ? '#ef4444' : '#f59e0b',
              fontFamily: 'monospace'
            }}>
              {formatTime(timeRemaining)}
            </span>
          </div>

          {error && (
            <div style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#991b1b',
              padding: '10px 12px',
              borderRadius: '4px',
              marginBottom: '16px',
              fontSize: '9pt'
            }}>
              {error}
            </div>
          )}

          <p style={{
            fontSize: '9pt',
            color: 'var(--text-secondary)',
            marginBottom: '16px'
          }}>
            {methodInfo.description}
          </p>

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: '16px' }}>
              <input
                ref={inputRef}
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={methodInfo.placeholder}
                disabled={isExpired || loading}
                autoComplete="one-time-code"
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  border: '2px solid var(--border)',
                  borderRadius: '4px',
                  fontSize: '16pt',
                  fontFamily: 'monospace',
                  textAlign: 'center',
                  letterSpacing: '8px',
                  fontWeight: 600
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="button"
                style={{ fontSize: '9pt', flex: 1 }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || isExpired || !code.trim()}
                className="button button-primary"
                style={{ fontSize: '9pt', flex: 1 }}
              >
                {loading ? 'Verifying...' : 'Verify'}
              </button>
            </div>
          </form>

          {isExpired && (
            <p style={{
              fontSize: '8pt',
              color: 'var(--text-muted)',
              textAlign: 'center',
              marginTop: '16px'
            }}>
              This code has expired. Please try your action again to receive a new code.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

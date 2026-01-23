import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';

interface PlatformCredentialFormProps {
  isOpen: boolean;
  onClose: () => void;
  platform?: string;
  existingCredential?: {
    id: string;
    platform: string;
    status: string;
    requires_2fa: boolean;
  } | null;
  onSaved?: () => void;
}

const PLATFORMS = [
  { id: 'bat', name: 'Bring a Trailer', icon: '🚗' },
  { id: 'cars_and_bids', name: 'Cars & Bids', icon: '🏎️' },
  { id: 'pcarmarket', name: 'PCarMarket', icon: '🏁' },
  { id: 'collecting_cars', name: 'Collecting Cars', icon: '🇬🇧' },
  { id: 'broad_arrow', name: 'Broad Arrow', icon: '🎯' },
  { id: 'rmsothebys', name: "RM Sotheby's", icon: '🔨' },
  { id: 'gooding', name: 'Gooding & Company', icon: '✨' },
  { id: 'sbx', name: 'SBX Cars', icon: '💎' },
  { id: 'ebay_motors', name: 'eBay Motors', icon: '🛒' },
];

export default function PlatformCredentialForm({
  isOpen,
  onClose,
  platform: initialPlatform,
  existingCredential,
  onSaved
}: PlatformCredentialFormProps) {
  const { user } = useAuth();
  const [platform, setPlatform] = useState(initialPlatform || existingCredential?.platform || '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totpSecret, setTotpSecret] = useState('');
  const [showTotpInput, setShowTotpInput] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<'form' | 'validating' | 'success' | '2fa'>('form');

  useEffect(() => {
    if (isOpen) {
      setStep('form');
      setError(null);
      if (!existingCredential) {
        setUsername('');
        setPassword('');
        setTotpSecret('');
      }
    }
  }, [isOpen, existingCredential]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !platform || !username || !password) return;

    setLoading(true);
    setError(null);
    setStep('validating');

    try {
      // Call edge function to store credentials (encryption happens server-side)
      const { data, error: fnError } = await supabase.functions.invoke('store-platform-credentials', {
        body: {
          platform,
          username,
          password,
          totp_secret: totpSecret || undefined
        }
      });

      if (fnError) throw fnError;

      if (data.status === '2fa_required') {
        setStep('2fa');
      } else if (data.status === 'active') {
        setStep('success');
        onSaved?.();
      } else if (data.status === 'invalid') {
        setError('Invalid credentials. Please check your username and password.');
        setStep('form');
      } else {
        setStep('success');
        onSaved?.();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save credentials');
      setStep('form');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!existingCredential || !confirm('Delete these credentials?')) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from('platform_credentials')
        .delete()
        .eq('id', existingCredential.id);

      if (error) throw error;
      onSaved?.();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to delete');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return '#22c55e';
      case 'expired': return '#f59e0b';
      case '2fa_required': return '#f59e0b';
      case 'invalid': return '#ef4444';
      default: return 'var(--text-muted)';
    }
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
        padding: '20px'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: 'var(--surface)',
          borderRadius: '8px',
          maxWidth: '450px',
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <h2 style={{ margin: 0, fontSize: '12pt', fontWeight: 700 }}>
            {existingCredential ? 'Update Platform Login' : 'Add Platform Login'}
          </h2>
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

          {step === 'form' && (
            <form onSubmit={handleSubmit}>
              {/* Platform selector */}
              {!existingCredential && (
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '8pt', fontWeight: 600, marginBottom: '8px' }}>
                    Platform *
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                    {PLATFORMS.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPlatform(p.id)}
                        style={{
                          padding: '10px 8px',
                          border: `2px solid ${platform === p.id ? 'var(--accent)' : 'var(--border)'}`,
                          background: platform === p.id ? 'var(--accent-dim)' : 'var(--surface)',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          textAlign: 'center'
                        }}
                      >
                        <div style={{ fontSize: '16pt', marginBottom: '4px' }}>{p.icon}</div>
                        <div style={{ fontSize: '7pt', fontWeight: 600 }}>{p.name}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Existing credential status */}
              {existingCredential && (
                <div style={{
                  background: 'var(--surface-hover)',
                  padding: '12px',
                  borderRadius: '4px',
                  marginBottom: '16px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '14pt' }}>
                      {PLATFORMS.find(p => p.id === existingCredential.platform)?.icon}
                    </span>
                    <div>
                      <div style={{ fontSize: '9pt', fontWeight: 600 }}>
                        {PLATFORMS.find(p => p.id === existingCredential.platform)?.name}
                      </div>
                      <div style={{
                        fontSize: '8pt',
                        color: getStatusColor(existingCredential.status)
                      }}>
                        Status: {existingCredential.status}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Username */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '8pt', fontWeight: 600, marginBottom: '4px' }}>
                  Username / Email *
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Your login username"
                  required
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                    fontSize: '9pt'
                  }}
                />
              </div>

              {/* Password */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '8pt', fontWeight: 600, marginBottom: '4px' }}>
                  Password *
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your login password"
                  required
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                    fontSize: '9pt'
                  }}
                />
                <p style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Your credentials are encrypted with AES-256 and stored securely.
                </p>
              </div>

              {/* TOTP Secret (optional) */}
              <div style={{ marginBottom: '16px' }}>
                <button
                  type="button"
                  onClick={() => setShowTotpInput(!showTotpInput)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--accent)',
                    fontSize: '8pt',
                    cursor: 'pointer',
                    padding: 0
                  }}
                >
                  {showTotpInput ? '− Hide 2FA setup' : '+ Add automatic 2FA (optional)'}
                </button>

                {showTotpInput && (
                  <div style={{ marginTop: '8px' }}>
                    <label style={{ display: 'block', fontSize: '8pt', fontWeight: 600, marginBottom: '4px' }}>
                      TOTP Secret Key
                    </label>
                    <input
                      type="text"
                      value={totpSecret}
                      onChange={(e) => setTotpSecret(e.target.value)}
                      placeholder="e.g., JBSWY3DPEHPK3PXP"
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '1px solid var(--border)',
                        borderRadius: '4px',
                        fontSize: '9pt',
                        fontFamily: 'monospace'
                      }}
                    />
                    <p style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '4px' }}>
                      If provided, we can generate 2FA codes automatically.
                      Find this in your authenticator app's setup or account settings.
                    </p>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'space-between' }}>
                {existingCredential && (
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={loading}
                    style={{
                      padding: '10px 16px',
                      border: '1px solid #ef4444',
                      background: 'transparent',
                      color: '#ef4444',
                      borderRadius: '4px',
                      fontSize: '9pt',
                      cursor: 'pointer'
                    }}
                  >
                    Delete
                  </button>
                )}
                <div style={{ display: 'flex', gap: '12px', marginLeft: 'auto' }}>
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={loading}
                    className="button"
                    style={{ fontSize: '9pt' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loading || !platform || !username || !password}
                    className="button button-primary"
                    style={{ fontSize: '9pt' }}
                  >
                    {loading ? 'Saving...' : 'Save & Validate'}
                  </button>
                </div>
              </div>
            </form>
          )}

          {step === 'validating' && (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
              <div style={{
                width: '48px',
                height: '48px',
                border: '3px solid var(--border)',
                borderTopColor: 'var(--accent)',
                borderRadius: '50%',
                margin: '0 auto 16px',
                animation: 'spin 1s linear infinite'
              }} />
              <div style={{ fontSize: '10pt', fontWeight: 600, marginBottom: '8px' }}>
                Validating Credentials
              </div>
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                Attempting to log in to {PLATFORMS.find(p => p.id === platform)?.name}...
              </div>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          )}

          {step === '2fa' && (
            <div style={{ textAlign: 'center', padding: '20px' }}>
              <div style={{
                width: '64px',
                height: '64px',
                background: '#fef3c7',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
                fontSize: '24pt'
              }}>
                🔐
              </div>
              <h3 style={{ fontSize: '11pt', fontWeight: 700, marginBottom: '8px' }}>
                2FA Required
              </h3>
              <p style={{ fontSize: '9pt', color: 'var(--text-secondary)', marginBottom: '20px' }}>
                Your account requires two-factor authentication.
                We'll prompt you for the code when needed.
              </p>
              <button
                type="button"
                className="button button-primary"
                onClick={() => {
                  onSaved?.();
                  onClose();
                }}
                style={{ fontSize: '9pt' }}
              >
                Got it
              </button>
            </div>
          )}

          {step === 'success' && (
            <div style={{ textAlign: 'center', padding: '20px' }}>
              <div style={{
                width: '64px',
                height: '64px',
                background: '#dcfce7',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
                fontSize: '24pt'
              }}>
                ✓
              </div>
              <h3 style={{ fontSize: '11pt', fontWeight: 700, marginBottom: '8px' }}>
                Credentials Saved
              </h3>
              <p style={{ fontSize: '9pt', color: 'var(--text-secondary)', marginBottom: '20px' }}>
                Your {PLATFORMS.find(p => p.id === platform)?.name} login is ready for automated bidding.
              </p>
              <button
                type="button"
                className="button button-primary"
                onClick={onClose}
                style={{ fontSize: '9pt' }}
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

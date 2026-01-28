import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
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

interface PlatformMeta {
  id: string;
  name: string;
  domain?: string;
  color: string;
  shortLabel?: string;
}

const PLATFORMS = [
  { id: 'bat', name: 'Bring a Trailer', domain: 'bringatrailer.com', color: '#d97706', shortLabel: 'BaT' },
  { id: 'cars_and_bids', name: 'Cars & Bids', domain: 'carsandbids.com', color: '#dc2626', shortLabel: 'CB' },
  { id: 'pcarmarket', name: 'PCarMarket', domain: 'pcarmarket.com', color: '#16a34a', shortLabel: 'PCM' },
  { id: 'collecting_cars', name: 'Collecting Cars', domain: 'collectingcars.com', color: '#2563eb', shortLabel: 'CC' },
  { id: 'broad_arrow', name: 'Broad Arrow', domain: 'broadarrowauctions.com', color: '#7c3aed', shortLabel: 'BA' },
  { id: 'rmsothebys', name: "RM Sotheby's", domain: 'rmsothebys.com', color: '#0891b2', shortLabel: 'RM' },
  { id: 'gooding', name: 'Gooding & Company', domain: 'goodingco.com', color: '#ca8a04', shortLabel: 'GC' },
  { id: 'sbx', name: 'SBX Cars', domain: 'sbxcars.com', color: '#db2777', shortLabel: 'SBX' },
  { id: 'ebay_motors', name: 'eBay Motors', domain: 'ebay.com', color: '#0284c7', shortLabel: 'EB' },
];

const faviconFor = (domain?: string) =>
  domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : '';

const getPlatformLabel = (platform: PlatformMeta) => {
  if (platform.shortLabel) return platform.shortLabel;
  const cleaned = platform.name.replace(/[^A-Za-z0-9 ]+/g, ' ').trim();
  const initials = cleaned
    .split(/\s+/)
    .map(word => word[0])
    .join('')
    .toUpperCase();
  return (initials || platform.name).slice(0, 3).toUpperCase();
};

function PlatformFavicon({
  platform,
  size = 20,
  containerSize = 28,
  background = 'var(--surface)'
}: {
  platform: PlatformMeta;
  size?: number;
  containerSize?: number;
  background?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const label = getPlatformLabel(platform);

  useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [platform.domain]);

  const showImage = Boolean(platform.domain) && !failed;

  return (
    <div
      style={{
        width: containerSize,
        height: containerSize,
        borderRadius: '6px',
        background,
        display: 'grid',
        placeItems: 'center',
        position: 'relative',
        overflow: 'hidden',
        flexShrink: 0
      }}
    >
      <span
        style={{
          fontSize: '8pt',
          fontWeight: 700,
          color: platform.color,
          opacity: showImage && loaded ? 0 : 1,
          transition: 'opacity 120ms ease'
        }}
      >
        {label}
      </span>
      {showImage && (
        <img
          src={faviconFor(platform.domain)}
          alt={`${platform.name} favicon`}
          style={{
            width: size,
            height: size,
            position: 'absolute',
            inset: 0,
            margin: 'auto',
            opacity: loaded ? 1 : 0,
            transition: 'opacity 120ms ease'
          }}
          loading="lazy"
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={() => {
            setFailed(true);
            setLoaded(false);
          }}
        />
      )}
    </div>
  );
}

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
  const selectedPlatformInfo = initialPlatform ? PLATFORMS.find(p => p.id === initialPlatform) : undefined;
  const existingPlatformInfo = existingCredential ? PLATFORMS.find(p => p.id === existingCredential.platform) : undefined;
  const activePlatformInfo = PLATFORMS.find(p => p.id === platform);

  useEffect(() => {
    if (isOpen) {
      setStep('form');
      setError(null);
      if (!existingCredential) {
        setUsername('');
        setPassword('');
        setTotpSecret('');
        // Set platform from prop if provided
        if (initialPlatform) {
          setPlatform(initialPlatform);
        }
      }
    }
  }, [isOpen, existingCredential, initialPlatform]);

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

  const modalContent = (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
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
          overflow: 'auto',
          position: 'relative',
          zIndex: 1
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
              {/* Platform selector (only show when not editing and no platform preselected) */}
              {!existingCredential && !initialPlatform && (
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
                        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '6px' }}>
                          <PlatformFavicon
                            platform={p}
                            containerSize={28}
                            size={18}
                            background="transparent"
                          />
                        </div>
                        <div style={{ fontSize: '7pt', fontWeight: 600 }}>{p.name}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Show selected platform when preselected */}
              {!existingCredential && initialPlatform && (
                <div style={{
                  background: 'var(--surface-hover)',
                  padding: '12px',
                  borderRadius: '4px',
                  marginBottom: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px'
                }}>
                  {selectedPlatformInfo && (
                    <PlatformFavicon
                      platform={selectedPlatformInfo}
                      containerSize={32}
                      size={20}
                      background={selectedPlatformInfo.color + '20'}
                    />
                  )}
                  <div>
                    <div style={{ fontSize: '10pt', fontWeight: 600 }}>
                      Connect to {selectedPlatformInfo?.name}
                    </div>
                    <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                      Enter your login credentials to enable automated bidding
                    </div>
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
                    {existingPlatformInfo && (
                      <PlatformFavicon
                        platform={existingPlatformInfo}
                        containerSize={24}
                        size={16}
                        background={existingPlatformInfo.color + '20'}
                      />
                    )}
                    <div>
                      <div style={{ fontSize: '9pt', fontWeight: 600 }}>
                        {existingPlatformInfo?.name}
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
                <label htmlFor="platform-username" style={{ display: 'block', fontSize: '8pt', fontWeight: 600, marginBottom: '4px' }}>
                  Username / Email *
                </label>
                <input
                  id="platform-username"
                  name="username"
                  type="text"
                  autoComplete="username"
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
                <label htmlFor="platform-password" style={{ display: 'block', fontSize: '8pt', fontWeight: 600, marginBottom: '4px' }}>
                  Password *
                </label>
                <input
                  id="platform-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
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
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'center' }}>
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
                <div style={{ display: 'flex', gap: '12px', marginLeft: 'auto', flexWrap: 'wrap' }}>
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
                Attempting to log in to {activePlatformInfo?.name}...
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
                fontSize: '11pt',
                fontWeight: 700,
                color: '#92400e',
                letterSpacing: '0.5px'
              }}>
                2FA
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
                Your {activePlatformInfo?.name} login is ready for automated bidding.
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

  if (typeof document === 'undefined') return modalContent;

  return createPortal(modalContent, document.body);
}

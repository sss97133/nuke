import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import PlatformCredentialForm from './PlatformCredentialForm';
import TwoFactorPrompt from './TwoFactorPrompt';

interface PlatformCredential {
  id: string;
  platform: string;
  status: 'pending' | 'validating' | 'active' | 'expired' | '2fa_required' | 'invalid' | 'suspended';
  requires_2fa: boolean;
  last_validated_at: string | null;
  validation_error: string | null;
  session_expires_at: string | null;
  created_at: string;
}

const PLATFORMS = [
  { id: 'bat', name: 'Bring a Trailer', icon: '🚗', color: '#d97706' },
  { id: 'cars_and_bids', name: 'Cars & Bids', icon: '🏎️', color: '#dc2626' },
  { id: 'pcarmarket', name: 'PCarMarket', icon: '🏁', color: '#16a34a' },
  { id: 'collecting_cars', name: 'Collecting Cars', icon: '🇬🇧', color: '#2563eb' },
  { id: 'broad_arrow', name: 'Broad Arrow', icon: '🎯', color: '#7c3aed' },
  { id: 'rmsothebys', name: "RM Sotheby's", icon: '🔨', color: '#0891b2' },
  { id: 'gooding', name: 'Gooding & Company', icon: '✨', color: '#ca8a04' },
  { id: 'sbx', name: 'SBX Cars', icon: '💎', color: '#db2777' },
  { id: 'ebay_motors', name: 'eBay Motors', icon: '🛒', color: '#0284c7' },
];

export default function ConnectedPlatforms() {
  const [credentials, setCredentials] = useState<PlatformCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingCredential, setEditingCredential] = useState<PlatformCredential | null>(null);
  const [pending2fa, setPending2fa] = useState<any>(null);

  const loadCredentials = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('platform_credentials')
        .select('id, platform, status, requires_2fa, last_validated_at, validation_error, session_expires_at, created_at')
        .order('platform');

      if (!error && data) {
        setCredentials(data);

        // Check for any pending 2FA requests
        const pending2faCheck = data.find(c => c.status === '2fa_required');
        if (pending2faCheck) {
          const { data: request } = await supabase
            .from('pending_2fa_requests')
            .select('*')
            .eq('credential_id', pending2faCheck.id)
            .eq('status', 'pending')
            .gt('expires_at', new Date().toISOString())
            .single();

          if (request) {
            setPending2fa({
              ...request,
              platform: pending2faCheck.platform
            });
          }
        }
      }
    } catch (err) {
      console.error('Failed to load credentials:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCredentials();

    // Subscribe to real-time updates
    const subscription = supabase
      .channel('platform_credentials_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'platform_credentials'
        },
        () => {
          loadCredentials();
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const getStatusBadge = (cred: PlatformCredential) => {
    const styles: Record<string, { bg: string; color: string; label: string }> = {
      active: { bg: '#dcfce7', color: '#16a34a', label: 'Connected' },
      pending: { bg: '#fef3c7', color: '#d97706', label: 'Pending' },
      validating: { bg: '#dbeafe', color: '#2563eb', label: 'Validating...' },
      expired: { bg: '#fef3c7', color: '#d97706', label: 'Expired' },
      '2fa_required': { bg: '#fef3c7', color: '#d97706', label: '2FA Needed' },
      invalid: { bg: '#fef2f2', color: '#dc2626', label: 'Invalid' },
      suspended: { bg: '#fef2f2', color: '#dc2626', label: 'Suspended' },
    };

    const style = styles[cred.status] || styles.pending;

    return (
      <span style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: '10px',
        fontSize: '7pt',
        fontWeight: 600,
        background: style.bg,
        color: style.color
      }}>
        {style.label}
      </span>
    );
  };

  const getPlatformInfo = (platformId: string) => {
    return PLATFORMS.find(p => p.id === platformId) || {
      id: platformId,
      name: platformId,
      icon: '🔗',
      color: '#6b7280'
    };
  };

  const connectedPlatforms = credentials.map(c => c.platform);
  const availablePlatforms = PLATFORMS.filter(p => !connectedPlatforms.includes(p.id));

  return (
    <div className="card">
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 className="text font-bold" style={{ fontSize: '8pt', margin: 0 }}>
          Connected Auction Platforms
        </h3>
        {availablePlatforms.length > 0 && (
          <button
            className="button button-small button-primary"
            onClick={() => setShowAddForm(true)}
            style={{ fontSize: '7pt' }}
          >
            + Add Platform
          </button>
        )}
      </div>
      <div className="card-body">
        <p className="text-small text-muted" style={{ marginBottom: 'var(--space-3)' }}>
          Connect your auction platform accounts to enable automated proxy bidding.
          Your credentials are encrypted with AES-256 and stored securely.
        </p>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontSize: '8pt' }}>
            Loading connected platforms...
          </div>
        ) : credentials.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '30px 20px',
            background: 'var(--surface-hover)',
            borderRadius: '4px'
          }}>
            <div style={{ fontSize: '24pt', marginBottom: '8px' }}>🔐</div>
            <div style={{ fontSize: '9pt', fontWeight: 600, marginBottom: '4px' }}>
              No platforms connected
            </div>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '12px' }}>
              Add your auction platform logins to enable automated bidding
            </div>
            <button
              className="button button-primary"
              onClick={() => setShowAddForm(true)}
              style={{ fontSize: '8pt' }}
            >
              Connect Your First Platform
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {credentials.map(cred => {
              const platform = getPlatformInfo(cred.platform);
              return (
                <div
                  key={cred.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '10px 12px',
                    background: 'var(--surface-hover)',
                    borderRadius: '4px',
                    border: cred.status === '2fa_required' ? '2px solid #f59e0b' : '1px solid var(--border)'
                  }}
                >
                  {/* Platform icon */}
                  <div style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '8px',
                    background: platform.color + '20',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '16pt',
                    flexShrink: 0
                  }}>
                    {platform.icon}
                  </div>

                  {/* Platform info */}
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '9pt', fontWeight: 600 }}>{platform.name}</span>
                      {getStatusBadge(cred)}
                    </div>
                    {cred.status === 'active' && cred.last_validated_at && (
                      <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                        Last verified: {new Date(cred.last_validated_at).toLocaleDateString()}
                      </div>
                    )}
                    {cred.status === 'invalid' && cred.validation_error && (
                      <div style={{ fontSize: '7pt', color: '#dc2626' }}>
                        {cred.validation_error}
                      </div>
                    )}
                    {cred.status === '2fa_required' && (
                      <div style={{ fontSize: '7pt', color: '#d97706' }}>
                        Two-factor authentication code required
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '6px' }}>
                    {cred.status === '2fa_required' && (
                      <button
                        className="button button-small"
                        onClick={() => {
                          // Load the 2FA request
                          supabase
                            .from('pending_2fa_requests')
                            .select('*')
                            .eq('credential_id', cred.id)
                            .eq('status', 'pending')
                            .gt('expires_at', new Date().toISOString())
                            .single()
                            .then(({ data }) => {
                              if (data) {
                                setPending2fa({ ...data, platform: cred.platform });
                              }
                            });
                        }}
                        style={{
                          fontSize: '7pt',
                          background: '#fef3c7',
                          borderColor: '#f59e0b',
                          color: '#92400e'
                        }}
                      >
                        Enter Code
                      </button>
                    )}
                    <button
                      className="button button-small"
                      onClick={() => setEditingCredential(cred)}
                      style={{ fontSize: '7pt' }}
                    >
                      {cred.status === 'invalid' || cred.status === 'expired' ? 'Fix' : 'Edit'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Available platforms hint */}
        {credentials.length > 0 && availablePlatforms.length > 0 && (
          <div style={{
            marginTop: '12px',
            padding: '10px',
            background: 'var(--surface)',
            borderRadius: '4px',
            border: '1px dashed var(--border)'
          }}>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '6px' }}>
              Also available:
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {availablePlatforms.map(p => (
                <button
                  key={p.id}
                  onClick={() => {
                    setShowAddForm(true);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '4px 8px',
                    fontSize: '7pt',
                    background: 'var(--surface-hover)',
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  <span>{p.icon}</span>
                  <span>{p.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Add/Edit form */}
      <PlatformCredentialForm
        isOpen={showAddForm || editingCredential !== null}
        onClose={() => {
          setShowAddForm(false);
          setEditingCredential(null);
        }}
        existingCredential={editingCredential}
        onSaved={() => {
          setShowAddForm(false);
          setEditingCredential(null);
          loadCredentials();
        }}
      />

      {/* 2FA prompt */}
      <TwoFactorPrompt
        isOpen={pending2fa !== null}
        onClose={() => setPending2fa(null)}
        request={pending2fa}
        onVerified={() => {
          setPending2fa(null);
          loadCredentials();
        }}
      />
    </div>
  );
}

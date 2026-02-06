/**
 * API Keys Management Page
 *
 * Allows users to create, view, and revoke API keys.
 * Following Stripe's developer dashboard patterns.
 *
 * Route: /settings/api-keys
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, getSupabaseFunctionsUrl } from '../../lib/supabase';

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  is_active: boolean;
  rate_limit_per_hour: number;
  rate_limit_remaining: number;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
  requests_24h: number;
}

interface NewKey {
  id: string;
  name: string;
  key: string;
  key_prefix: string;
  scopes: string[];
  expires_at: string | null;
  created_at: string;
}

export default function ApiKeysPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyExpiry, setNewKeyExpiry] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<NewKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadKeys();
  }, []);

  const loadKeys = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate('/login');
        return;
      }

      const response = await fetch(`${getSupabaseFunctionsUrl()}/api-keys-manage`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      const result = await response.json();
      if (result.data) {
        setKeys(result.data);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const createKey = async () => {
    setCreating(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch(`${getSupabaseFunctionsUrl()}/api-keys-manage`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: newKeyName,
          expires_in_days: newKeyExpiry,
        }),
      });

      const result = await response.json();
      if (result.data) {
        setNewlyCreatedKey(result.data);
        setShowCreateModal(false);
        setNewKeyName('');
        setNewKeyExpiry(null);
        loadKeys();
      } else {
        setError(result.error || 'Failed to create key');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const revokeKey = async (keyId: string) => {
    if (!confirm('Are you sure you want to revoke this key? This cannot be undone.')) {
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      await fetch(`${getSupabaseFunctionsUrl()}/api-keys-manage/${keyId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      loadKeys();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatDate = (date: string | null) => {
    if (!date) return 'Never';
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatRelative = (date: string | null) => {
    if (!date) return 'Never';
    const d = new Date(date);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return formatDate(date);
  };

  if (loading) {
    return (
      <div style={{ padding: '24px', maxWidth: '1000px', margin: '0 auto' }}>
        <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1000px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '18px', marginBottom: '4px' }}>API Keys</h1>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Manage API keys for programmatic access to your Nuke account
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          style={{
            background: 'var(--accent)',
            color: 'var(--bg)',
            border: 'none',
            padding: '10px 16px',
            fontSize: '12px',
            cursor: 'pointer',
          }}
        >
          + Create Key
        </button>
      </div>

      {error && (
        <div style={{
          background: 'rgba(244, 67, 54, 0.1)',
          border: '1px solid var(--error, #f44336)',
          padding: '12px',
          marginBottom: '16px',
          color: 'var(--error, #f44336)',
          fontSize: '12px',
        }}>
          {error}
        </div>
      )}

      {/* Newly Created Key Warning */}
      {newlyCreatedKey && (
        <div style={{
          background: 'rgba(0, 255, 0, 0.1)',
          border: '1px solid var(--accent)',
          padding: '16px',
          marginBottom: '24px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
            <div>
              <h3 style={{ fontSize: '14px', marginBottom: '4px', color: 'var(--accent)' }}>
                API Key Created
              </h3>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Copy this key now. You won't be able to see it again!
              </p>
            </div>
            <button
              onClick={() => setNewlyCreatedKey(null)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: '16px',
              }}
            >
              x
            </button>
          </div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'var(--bg)',
            padding: '12px',
            fontFamily: 'monospace',
            fontSize: '13px',
          }}>
            <code style={{ flex: 1, wordBreak: 'break-all' }}>{newlyCreatedKey.key}</code>
            <button
              onClick={() => copyToClipboard(newlyCreatedKey.key)}
              style={{
                background: 'var(--accent)',
                color: 'var(--bg)',
                border: 'none',
                padding: '6px 12px',
                fontSize: '11px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {/* Keys Table */}
      {keys.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '48px',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
        }}>
          <div style={{ fontSize: '24px', marginBottom: '12px' }}>[ ]</div>
          <p style={{ color: 'var(--text-muted)', marginBottom: '16px' }}>No API keys yet</p>
          <button
            onClick={() => setShowCreateModal(true)}
            style={{
              background: 'var(--accent)',
              color: 'var(--bg)',
              border: 'none',
              padding: '10px 20px',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            Create Your First Key
          </button>
        </div>
      ) : (
        <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '12px', textAlign: 'left', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 }}>Name</th>
                <th style={{ padding: '12px', textAlign: 'left', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 }}>Key</th>
                <th style={{ padding: '12px', textAlign: 'left', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 }}>Usage (24h)</th>
                <th style={{ padding: '12px', textAlign: 'left', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 }}>Last Used</th>
                <th style={{ padding: '12px', textAlign: 'left', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 }}>Status</th>
                <th style={{ padding: '12px', textAlign: 'right', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '12px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 500 }}>{key.name}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                      Created {formatRelative(key.created_at)}
                    </div>
                  </td>
                  <td style={{ padding: '12px' }}>
                    <code style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      nk_live_{key.key_prefix}...
                    </code>
                  </td>
                  <td style={{ padding: '12px' }}>
                    <div style={{ fontSize: '12px' }}>{key.requests_24h} requests</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                      {key.rate_limit_remaining}/{key.rate_limit_per_hour} remaining
                    </div>
                  </td>
                  <td style={{ padding: '12px', fontSize: '12px', color: 'var(--text-muted)' }}>
                    {formatRelative(key.last_used_at)}
                  </td>
                  <td style={{ padding: '12px' }}>
                    {key.is_active ? (
                      <span style={{
                        fontSize: '10px',
                        padding: '2px 8px',
                        background: 'rgba(76, 175, 80, 0.2)',
                        color: 'var(--success, #4caf50)',
                        borderRadius: '9999px',
                      }}>
                        Active
                      </span>
                    ) : (
                      <span style={{
                        fontSize: '10px',
                        padding: '2px 8px',
                        background: 'rgba(244, 67, 54, 0.2)',
                        color: 'var(--error, #f44336)',
                        borderRadius: '9999px',
                      }}>
                        Revoked
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right' }}>
                    {key.is_active && (
                      <button
                        onClick={() => revokeKey(key.id)}
                        style={{
                          background: 'none',
                          border: '1px solid var(--border)',
                          color: 'var(--text-muted)',
                          padding: '4px 12px',
                          fontSize: '11px',
                          cursor: 'pointer',
                        }}
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Documentation Link */}
      <div style={{
        marginTop: '24px',
        padding: '16px',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
      }}>
        <h3 style={{ fontSize: '12px', marginBottom: '8px' }}>Quick Start</h3>
        <pre style={{
          background: 'var(--bg)',
          padding: '12px',
          fontSize: '11px',
          overflow: 'auto',
          margin: 0,
        }}>
{`curl -X GET "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/api-v1-vehicles" \\
  -H "X-API-Key: YOUR_API_KEY"`}
        </pre>
        <div style={{ marginTop: '12px' }}>
          <a
            href="/developers"
            style={{ fontSize: '12px', color: 'var(--accent)' }}
          >
            View API Documentation →
          </a>
        </div>
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            padding: '24px',
            width: '100%',
            maxWidth: '400px',
          }}>
            <h2 style={{ fontSize: '16px', marginBottom: '16px' }}>Create API Key</h2>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                Key Name
              </label>
              <input
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="e.g., Production, Testing, CI/CD"
                style={{
                  width: '100%',
                  padding: '10px',
                  fontSize: '12px',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                }}
              />
            </div>

            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                Expiration (optional)
              </label>
              <select
                value={newKeyExpiry || ''}
                onChange={(e) => setNewKeyExpiry(e.target.value ? parseInt(e.target.value) : null)}
                style={{
                  width: '100%',
                  padding: '10px',
                  fontSize: '12px',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                }}
              >
                <option value="">Never expires</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="365">1 year</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowCreateModal(false)}
                style={{
                  background: 'none',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                  padding: '10px 16px',
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={createKey}
                disabled={!newKeyName || creating}
                style={{
                  background: 'var(--accent)',
                  color: 'var(--bg)',
                  border: 'none',
                  padding: '10px 16px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  opacity: !newKeyName || creating ? 0.5 : 1,
                }}
              >
                {creating ? 'Creating...' : 'Create Key'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

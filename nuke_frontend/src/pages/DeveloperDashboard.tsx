/**
 * Developer Dashboard
 *
 * API key management, usage stats, and quick links for developers.
 *
 * Route: /developers/dashboard
 */

import { useEffect, useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

interface ApiKeyInfo {
  id: string;
  name: string;
  key_prefix: string;
  is_active: boolean;
  rate_limit_per_hour: number;
  rate_limit_remaining: number | null;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
  requests_24h?: number;
}

export default function DeveloperDashboard() {
  // useAuth now reads from global AuthContext — zero network calls on mount
  const { user, session, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  // loading starts true only when there is no cached session (new/incognito user)
  const [loading, setLoading] = useState(!session);
  const [newKeyName, setNewKeyName] = useState('');
  const [creatingKey, setCreatingKey] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate('/developers/signup');
      return;
    }
    fetchKeys();

    // Auto-generate key if redirected from OAuth signup
    if (searchParams.get('generate_key') === '1') {
      handleCreateKey('My First Key');
    }
  }, [user, authLoading]);

  const fetchKeys = async () => {
    // Use cached session from context — no extra network call
    const token = session?.access_token;
    if (!token) return;

    const { data, error } = await supabase.functions.invoke('api-keys-manage', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!error && data?.keys) {
      setKeys(data.keys);
    }
    setLoading(false);
  };

  const handleCreateKey = async (name?: string) => {
    setCreatingKey(true);
    setError(null);
    const token = session?.access_token;
    if (!token) return;

    const { data, error: err } = await supabase.functions.invoke('api-keys-manage', {
      method: 'POST',
      body: { name: name || newKeyName || 'API Key' },
      headers: { Authorization: `Bearer ${token}` },
    });

    if (err || !data?.key) {
      setError('Failed to create key');
    } else {
      setNewKey(data.key);
      setNewKeyName('');
      fetchKeys();
    }
    setCreatingKey(false);
  };

  const handleRevokeKey = async (keyId: string) => {
    const token = session?.access_token;
    if (!token) return;

    await supabase.functions.invoke(`api-keys-manage/${keyId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchKeys();
  };

  const copyKey = () => {
    if (newKey) {
      navigator.clipboard.writeText(newKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (authLoading || loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', fontFamily: 'Arial, sans-serif', fontSize: 'var(--fs-9, 9px)', color: 'var(--text-secondary)' }}>
        Loading...
      </div>
    );
  }

  const activeKeys = keys.filter(k => k.is_active);
  const totalRequests = keys.reduce((sum, k) => sum + (k.requests_24h || 0), 0);

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 16px', fontFamily: 'Arial, sans-serif', fontSize: 'var(--fs-9, 9px)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 'var(--fs-13, 13px)', fontWeight: 700, margin: 0 }}>Developer Dashboard</h1>
        <Link to="/api" style={{ color: 'var(--accent)', fontSize: 'var(--fs-8, 8px)' }}>API Docs</Link>
      </div>

      {/* Stats Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        <div style={{ background: 'var(--surface)', border: '2px solid var(--border)', padding: 12 }}>
          <div style={{ fontSize: 'var(--fs-11, 11px)', fontWeight: 700, fontFamily: 'monospace' }}>{activeKeys.length}</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-8, 8px)' }}>Active Keys</div>
        </div>
        <div style={{ background: 'var(--surface)', border: '2px solid var(--border)', padding: 12 }}>
          <div style={{ fontSize: 'var(--fs-11, 11px)', fontWeight: 700, fontFamily: 'monospace' }}>{totalRequests.toLocaleString()}</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-8, 8px)' }}>Requests (24h)</div>
        </div>
        <div style={{ background: 'var(--surface)', border: '2px solid var(--border)', padding: 12 }}>
          <div style={{ fontSize: 'var(--fs-11, 11px)', fontWeight: 700, fontFamily: 'monospace' }}>Free</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-8, 8px)' }}>Current Plan</div>
        </div>
      </div>

      {/* New Key Banner */}
      {newKey && (
        <div style={{ background: 'var(--surface)', border: '2px solid var(--accent)', padding: 16, marginBottom: 24 }}>
          <div style={{ fontWeight: 700, marginBottom: 4, color: 'var(--error, #ef4444)' }}>
            Save this key now. You will not see it again.
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: 'var(--fs-8, 8px)', wordBreak: 'break-all', padding: '8px', background: 'var(--bg)', border: '1px solid var(--border)', marginBottom: 8 }}>
            {newKey}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={copyKey} style={{ padding: '6px 12px', background: copied ? 'var(--success, #22c55e)' : 'var(--accent)', color: 'var(--bg)', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 'var(--fs-8, 8px)' }}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <button onClick={() => setNewKey(null)} style={{ padding: '6px 12px', background: 'var(--surface)', color: 'var(--text)', border: '2px solid var(--border)', cursor: 'pointer', fontSize: 'var(--fs-8, 8px)' }}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {error && (
        <div style={{ background: 'var(--error-bg, #fef2f2)', border: '1px solid var(--error, #ef4444)', color: 'var(--error, #ef4444)', padding: '8px 12px', marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Create Key */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <input
          type="text" placeholder="Key name (e.g. Production, Staging)"
          value={newKeyName} onChange={e => setNewKeyName(e.target.value)}
          style={{ flex: 1, padding: '8px 10px', border: '2px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'Arial, sans-serif', fontSize: 'var(--fs-9, 9px)' }}
        />
        <button
          onClick={() => handleCreateKey()} disabled={creatingKey}
          style={{ padding: '8px 16px', background: 'var(--accent)', color: 'var(--bg)', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 'var(--fs-9, 9px)', whiteSpace: 'nowrap' }}
        >
          {creatingKey ? 'Creating...' : 'Create Key'}
        </button>
      </div>

      {/* Keys Table */}
      <div style={{ border: '2px solid var(--border)', marginBottom: 24 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-8, 8px)' }}>
          <thead>
            <tr style={{ background: 'var(--surface)', borderBottom: '2px solid var(--border)' }}>
              <th style={{ padding: '8px', textAlign: 'left', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Name</th>
              <th style={{ padding: '8px', textAlign: 'left', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Key</th>
              <th style={{ padding: '8px', textAlign: 'right', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>24h Requests</th>
              <th style={{ padding: '8px', textAlign: 'right', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Last Used</th>
              <th style={{ padding: '8px', textAlign: 'center', fontWeight: 700 }}></th>
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: 16, textAlign: 'center', color: 'var(--text-secondary)' }}>No API keys yet</td>
              </tr>
            )}
            {keys.map(key => (
              <tr key={key.id} style={{ borderBottom: '1px solid var(--border)', opacity: key.is_active ? 1 : 0.5 }}>
                <td style={{ padding: '8px' }}>
                  {key.name}
                  {!key.is_active && <span style={{ marginLeft: 6, color: 'var(--error, #ef4444)', fontSize: 'var(--fs-7, 7px)', textTransform: 'uppercase' }}>revoked</span>}
                </td>
                <td style={{ padding: '8px', fontFamily: 'monospace' }}>nk_live_{key.key_prefix}...</td>
                <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace' }}>{key.requests_24h || 0}</td>
                <td style={{ padding: '8px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                  {key.last_used_at ? new Date(key.last_used_at).toLocaleDateString() : 'Never'}
                </td>
                <td style={{ padding: '8px', textAlign: 'center' }}>
                  {key.is_active && (
                    <button
                      onClick={() => handleRevokeKey(key.id)}
                      style={{ padding: '4px 8px', background: 'none', border: '1px solid var(--error, #ef4444)', color: 'var(--error, #ef4444)', cursor: 'pointer', fontSize: 'var(--fs-7, 7px)', textTransform: 'uppercase' }}
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

      {/* Quick Links */}
      <h2 style={{ fontSize: 'var(--fs-10, 10px)', fontWeight: 700, marginBottom: 12 }}>Quick Links</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
        {[
          { label: 'API Documentation', to: '/api', desc: 'Endpoints, examples, schemas' },
          { label: 'SDK Reference', to: '/api', desc: 'npm install @nuke1/sdk' },
          { label: 'Webhook Settings', to: '/settings/webhooks', desc: 'Event subscriptions' },
          { label: 'Usage Logs', to: '/settings/usage', desc: 'Request history & analytics' },
        ].map(link => (
          <Link key={link.to + link.label} to={link.to} style={{ background: 'var(--surface)', border: '2px solid var(--border)', padding: 12, textDecoration: 'none' }}>
            <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>{link.label}</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-8, 8px)' }}>{link.desc}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

/**
 * API Keys Management Page
 *
 * Allows users to create, view, and revoke API keys.
 *
 * Route: /settings/api-keys
 */

import { useState, useEffect, useRef } from 'react';
import Link from '../../components/PrefetchLink';
import { useApiKeyManagement, type CreatedKey } from './useApiKeyManagement';
import './credential-settings.css';
import { useAuth } from '../../hooks/useAuth';

function ApiKeysContent({ userId }: { userId: string }) {
  const { session } = useAuth();
  const { keys, loading, readError, actionError, pending, loadKeys, createKey: issueKey, revokeKey: removeKey } = useApiKeyManagement(userId, session?.access_token);
  const creating = pending === 'create';
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyExpiry, setNewKeyExpiry] = useState<number | null>(null);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<CreatedKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!showCreateModal) return;
    dialog.current?.showModal();
    dialog.current?.querySelector<HTMLInputElement>('input[type="text"]')?.focus();
    return () => { if (opener.current?.isConnected) opener.current.focus(); };
  }, [showCreateModal]);

  const createKey = async () => {
    setError('');
    if (!newKeyName.trim()) { setError('Name is required'); return; }
    const result = await issueKey({ name: newKeyName, expires_in_days: newKeyExpiry });
    if (result && alive.current) {
      setNewlyCreatedKey(result); setCopied(false); setShowCreateModal(false); setNewKeyName(''); setNewKeyExpiry(null);
    }
  };
  const revokeKey = async (keyId: string) => {
    if (pending || !confirm('Revoke this API key? Applications using it will lose access.')) return;
    setError('');
    await removeKey(keyId);
  };
  const copyToClipboard = async (text: string) => {
    try { await navigator.clipboard.writeText(text); if (alive.current) setCopied(true); }
    catch { if (alive.current) setError('The key could not be copied. Select and copy it manually.'); }
  };

  const formatDate = (date: string | null) => {
    if (!date) return 'No recorded use';
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatRelative = (date: string | null) => {
    if (!date) return 'No recorded use';
    const d = new Date(date);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return formatDate(date);
  };


  return (
    <div className="credential-settings">
      <nav className="credential-settings-nav"><Link to="/settings">Settings</Link><Link to="/settings/usage">API usage</Link></nav>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '28px', marginBottom: '4px' }}>API Keys</h1>
          <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
            Manage API keys and inspect their granted access.
          </p>
        </div>
        <button
          disabled={!!pending} onClick={(event) => { opener.current = event.currentTarget; setError(''); setShowCreateModal(true); }}
          style={{
            background: 'var(--action)',
            color: 'var(--on-action)',
            border: 'none',
            padding: '10px 16px',
            fontSize: '14px',
            cursor: 'pointer',
          }}
        >
          + Create Key
        </button>
      </div>

      {(error || actionError) && (
        <div style={{
          background: 'rgba(244, 67, 54, 0.1)',
          border: '1px solid var(--error, #f44336)',
          padding: '12px',
          marginBottom: '16px',
          color: 'var(--error, #f44336)',
          fontSize: '14px',
        }}>
          <span role="alert">{error || actionError}</span>
        </div>
      )}

      <div className="credential-settings-refresh"><button type="button" disabled={loading} onClick={() => void loadKeys()}>{loading ? 'Reading keys…' : 'Refresh keys'}</button></div>
      {readError && <div role="alert" className="credential-settings-notice">{readError}<button type="button" disabled={loading} onClick={() => void loadKeys()}>Retry key list</button></div>}
      {loading && <p role="status">Reading access keys…</p>}
      {creating && <p role="status">Creating the key… You can close the dialog while this request finishes.</p>}
      {/* Newly Created Key Warning */}
      {newlyCreatedKey && (
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--accent)',
          padding: '16px',
          marginBottom: '24px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
            <div>
              <h3 style={{ fontSize: '14px', marginBottom: '4px', color: 'var(--accent)' }}>
                API Key Created
              </h3>
              <p>Granted scopes: {newlyCreatedKey.scopes.join(', ')}</p>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Copy this key now. You won't be able to see it again!
              </p>
            </div>
            <button
              aria-label="Dismiss created key" onClick={() => setNewlyCreatedKey(null)}
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
            fontFamily: 'var(--font-mono)',
            fontSize: '13px',
          }}>
            <code style={{ flex: 1, wordBreak: 'break-all' }}>{newlyCreatedKey.key}</code>
            <button
              onClick={() => copyToClipboard(newlyCreatedKey.key)}
              style={{
                background: 'var(--action)',
                color: 'var(--on-action)',
                border: 'none',
                padding: '6px 12px',
                fontSize: '12px',
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
      {keys.length === 0 && (loading || readError) ? null : keys.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '48px',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
        }}>
          <div style={{ fontSize: '24px', marginBottom: '12px' }}>[ ]</div>
          <p style={{ color: 'var(--text-muted)', marginBottom: '16px' }}>No API keys yet</p>
          <button
            disabled={!!pending} onClick={(event) => { opener.current = event.currentTarget; setError(''); setShowCreateModal(true); }}
            style={{
              background: 'var(--action)',
              color: 'var(--on-action)',
              border: 'none',
              padding: '10px 20px',
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            Create Your First Key
          </button>
        </div>
      ) : (
        <div className="credential-settings-table" role="region" aria-label="Access keys" tabIndex={0} style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th scope="col" style={{ padding: '12px', textAlign: 'left', fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500 }}>Name</th>
                <th scope="col" style={{ padding: '12px', textAlign: 'left', fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500 }}>Key</th>
                <th scope="col" style={{ padding: '12px', textAlign: 'left', fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500 }}>Granted scopes</th><th scope="col" style={{ padding: '12px', textAlign: 'left', fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500 }}>Rate limit</th>
                <th scope="col" style={{ padding: '12px', textAlign: 'left', fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500 }}>Last Used</th>
                <th scope="col" style={{ padding: '12px', textAlign: 'left', fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500 }}>Status</th>
                <th scope="col" style={{ padding: '12px', textAlign: 'right', fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td data-label="Name" style={{ padding: '12px' }}>
                    <div style={{ fontSize: '14px', fontWeight: 500 }}>{key.name}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      Created {formatRelative(key.created_at)}
                    </div>
                  </td>
                  <td data-label="Key prefix" style={{ padding: '12px' }}>
                    <code style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      nk_live_{key.key_prefix}...
                    </code>
                  </td>
                  <td data-label="Granted scopes" style={{ padding: '12px' }}>{key.scopes.length ? key.scopes.join(', ') : 'No recorded scopes'}</td>
                  <td data-label="Rate limit" style={{ padding: '12px' }}>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      {key.rate_limit_remaining}/{key.rate_limit_per_hour} remaining · stored snapshot
                    </div>
                  </td>
                  <td data-label="Last used" style={{ padding: '12px', fontSize: '14px', color: 'var(--text-muted)' }}>
                    {formatRelative(key.last_used_at)}
                  </td>
                  <td data-label="Status" style={{ padding: '12px' }}>
                    {key.is_active && key.expires_at && new Date(key.expires_at).getTime() < Date.now() ? <span>Expired</span> : key.is_active ? (
                      <span style={{
                        fontSize: '12px',
                        padding: '2px 8px',
                        background: 'rgba(76, 175, 80, 0.2)',
                        color: 'var(--success, #4caf50)', }}>
                        Active
                      </span>
                    ) : (
                      <span style={{
                        fontSize: '12px',
                        padding: '2px 8px',
                        background: 'rgba(244, 67, 54, 0.2)',
                        color: 'var(--error, #f44336)', }}>
                        Revoked
                      </span>
                    )}
                  </td>
                  <td data-label="Actions" style={{ padding: '12px', textAlign: 'right' }}>
                    {key.is_active && (
                      <button
                        disabled={!!pending} onClick={() => void revokeKey(key.id)}
                        style={{
                          background: 'none',
                          border: '1px solid var(--border)',
                          color: 'var(--text-muted)',
                          padding: '4px 12px',
                          fontSize: '12px',
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
        background: 'var(--surface)',
        border: '1px solid var(--border)',
      }}>
        <h3 style={{ fontSize: '14px', marginBottom: '8px' }}>Quick Start</h3>
        <pre style={{
          background: 'var(--bg)',
          padding: '12px',
          fontSize: '12px',
          overflow: 'auto',
          margin: 0,
        }}>
{`curl -X GET "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/api-v1-vehicles" \\
  -H "X-API-Key: YOUR_API_KEY"`}
        </pre>
        <div style={{ marginTop: '12px' }}>
          <a
            href="/developers"
            style={{ fontSize: '14px', color: 'var(--accent)' }}
          >
            View API Documentation →
          </a>
        </div>
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <dialog ref={dialog} className="credential-settings-dialog" aria-label="Create API key" onCancel={() => setShowCreateModal(false)}>
          <div>
            {(error || actionError) && <p role="alert">{error || actionError}</p>}
            <h2 style={{ fontSize: '22px', marginBottom: '16px' }}>Create API Key</h2>
            <p>This key uses the existing legacy read and write scopes. For vehicle-scoped event access, use <Link to="/settings/connected-agents">Connected Agents</Link>.</p>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                Key Name
              </label>
              <input
                type="text"
                aria-label="Key name" value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="e.g., Production, Testing, CI/CD"
                style={{
                  width: '100%',
                  padding: '10px',
                  fontSize: '14px',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                }}
              />
            </div>

            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                Expiration (optional)
              </label>
              <select
                aria-label="Expiration" value={newKeyExpiry || ''}
                onChange={(e) => setNewKeyExpiry(e.target.value ? parseInt(e.target.value) : null)}
                style={{
                  width: '100%',
                  padding: '10px',
                  fontSize: '14px',
                  background: 'var(--surface)',
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
                  fontSize: '14px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={createKey}
                disabled={!newKeyName || creating}
                style={{
                  background: 'var(--action)',
                  color: 'var(--on-action)',
                  border: 'none',
                  padding: '10px 16px',
                  fontSize: '14px',
                  cursor: 'pointer',
                  opacity: !newKeyName || creating ? 0.5 : 1,
                }}
              >
                {creating ? 'Creating...' : 'Create Key'}
              </button>
            </div>
          </div>
        </dialog>
      )}
    </div>
  );
}

export default function ApiKeysPage() {
  const { user, loading } = useAuth();
  if (loading) return <main className="credential-settings"><p role="status">Checking access…</p></main>;
  if (!user) return <main className="credential-settings"><Link to="/login">Sign in to manage access keys</Link></main>;
  return <ApiKeysContent key={user.id} userId={user.id} />;
}

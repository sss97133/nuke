/**
 * Connected Agents Settings Page
 *
 * Lets a user issue, scope, view, and revoke API keys intended for
 * external LLM agents writing to /v1/events on their behalf.
 *
 * Mirrors ApiKeysPage.tsx (developer-facing keys), but the scope picker
 * is the per-vehicle grammar from `_shared/scopeGrammar.ts`:
 *   - events:write:vehicle:{VIN}  → write to one specific vehicle
 *   - events:write:all            → write to any vehicle the user owns
 *
 * Route: /settings/connected-agents
 *
 * Implementation note:
 *   This page reuses the existing `api-keys-manage` edge function — it accepts
 *   a `scopes: string[]` array in the create payload. No new endpoint needed.
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSupabaseFunctionsUrl } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';

interface AgentKey {
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

interface NewAgentKey {
  id: string;
  name: string;
  key: string;
  key_prefix: string;
  scopes: string[];
  expires_at: string | null;
  created_at: string;
}

type ScopeMode = 'one_vehicle' | 'any_vehicle';

/**
 * Render a single granted scope as a human-readable chip.
 * Falls back to the raw scope string for legacy/unknown shapes so the
 * user always sees the truth, never a silently-hidden grant.
 */
function ScopeChip({ scope }: { scope: string }) {
  let label = scope;
  let tone: 'narrow' | 'broad' | 'legacy' | 'read' = 'narrow';

  if (scope === 'admin') {
    label = 'Admin (full access)';
    tone = 'broad';
  } else if (scope === 'write') {
    label = 'Legacy: write any vehicle';
    tone = 'legacy';
  } else if (scope === 'read') {
    label = 'Legacy: read any vehicle';
    tone = 'legacy';
  } else if (scope === 'events:write:all') {
    label = 'Write to any vehicle';
    tone = 'broad';
  } else if (scope === 'events:read:all') {
    label = 'Read any vehicle';
    tone = 'read';
  } else if (scope.startsWith('events:write:vehicle:')) {
    const vin = scope.split(':')[3] ?? '';
    label = `Write to VIN ${vin}`;
    tone = 'narrow';
  } else if (scope.startsWith('events:read:vehicle:')) {
    const vin = scope.split(':')[3] ?? '';
    label = `Read VIN ${vin}`;
    tone = 'read';
  }

  const palette: Record<typeof tone, { bg: string; fg: string }> = {
    narrow: { bg: 'rgba(76, 175, 80, 0.12)', fg: 'var(--success, #4caf50)' },
    read: { bg: 'rgba(33, 150, 243, 0.12)', fg: '#2196f3' },
    broad: { bg: 'rgba(255, 152, 0, 0.15)', fg: '#ff9800' },
    legacy: { bg: 'rgba(150, 150, 150, 0.15)', fg: 'var(--text-muted)' },
  };
  const { bg, fg } = palette[tone];

  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: '10px',
        padding: '2px 8px',
        marginRight: '4px',
        marginBottom: '2px',
        background: bg,
        color: fg,
        fontFamily: "'Courier New', monospace",
      }}
      title={scope}
    >
      {label}
    </span>
  );
}

export default function ConnectedAgentsPage() {
  const navigate = useNavigate();
  const { session, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(!session);
  const [keys, setKeys] = useState<AgentKey[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [scopeMode, setScopeMode] = useState<ScopeMode>('one_vehicle');
  const [scopeVin, setScopeVin] = useState('');
  const [newKeyExpiry, setNewKeyExpiry] = useState<number>(90); // default 90 days for agent keys
  const [creating, setCreating] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<NewAgentKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (authLoading) return;
    if (!session) {
      navigate('/login');
      return;
    }
    loadKeys();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, authLoading]);

  const loadKeys = async () => {
    setLoading(true);
    try {
      const token = session?.access_token;
      if (!token) {
        navigate('/login');
        return;
      }

      const response = await fetch(`${getSupabaseFunctionsUrl()}/api-keys-manage`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const result = await response.json();
      if (result.data) {
        setKeys(result.data as AgentKey[]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load keys';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const buildScopes = (): string[] | null => {
    if (scopeMode === 'any_vehicle') return ['events:write:all'];
    const vin = scopeVin.trim().toUpperCase();
    if (!vin) return null;
    return [`events:write:vehicle:${vin}`];
  };

  const createKey = async () => {
    setError('');
    const scopes = buildScopes();
    if (!scopes) {
      setError('VIN is required when scoping to one vehicle');
      return;
    }
    if (!newKeyName.trim()) {
      setError('Name is required');
      return;
    }

    setCreating(true);
    try {
      const token = session?.access_token;
      if (!token) return;

      const response = await fetch(`${getSupabaseFunctionsUrl()}/api-keys-manage`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: newKeyName,
          scopes,
          expires_in_days: newKeyExpiry,
        }),
      });

      const result = await response.json();
      if (result.data) {
        setNewlyCreatedKey(result.data as NewAgentKey);
        setShowCreateModal(false);
        setNewKeyName('');
        setScopeVin('');
        setScopeMode('one_vehicle');
        setNewKeyExpiry(90);
        loadKeys();
      } else {
        setError(result.error || 'Failed to create key');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create key';
      setError(msg);
    } finally {
      setCreating(false);
    }
  };

  const revokeKey = async (keyId: string) => {
    if (!confirm('Revoke this agent key? Existing sessions using it will stop working immediately.')) {
      return;
    }
    try {
      const token = session?.access_token;
      if (!token) return;

      await fetch(`${getSupabaseFunctionsUrl()}/api-keys-manage/${keyId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      loadKeys();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to revoke key';
      setError(msg);
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

  const isExpired = (k: AgentKey) =>
    k.expires_at !== null && new Date(k.expires_at).getTime() < Date.now();

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
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '24px',
        }}
      >
        <div>
          <h1 style={{ fontSize: '18px', marginBottom: '4px' }}>Connected Agents</h1>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Issue scoped keys to LLM agents (Claude, ChatGPT, custom) so they can write events to your vehicles on your behalf.
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
          + Connect Agent
        </button>
      </div>

      {error && (
        <div
          style={{
            background: 'rgba(244, 67, 54, 0.1)',
            border: '1px solid var(--error, #f44336)',
            padding: '12px',
            marginBottom: '16px',
            color: 'var(--error, #f44336)',
            fontSize: '12px',
          }}
        >
          {error}
        </div>
      )}

      {/* Newly Created Key Warning */}
      {newlyCreatedKey && (
        <div
          style={{
            background: 'rgba(0, 255, 0, 0.1)',
            border: '1px solid var(--accent)',
            padding: '16px',
            marginBottom: '24px',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              marginBottom: '12px',
            }}
          >
            <div>
              <h3 style={{ fontSize: '14px', marginBottom: '4px', color: 'var(--accent)' }}>
                Agent Key Created
              </h3>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Copy this key now and paste it into your agent's config. You won't be able to see it again.
              </p>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                Header to use: <code>X-API-Key: nk_live_...</code>
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
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: 'var(--bg)',
              padding: '12px',
              fontFamily: "'Courier New', monospace",
              fontSize: '13px',
            }}
          >
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
          <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>
            Scopes:{' '}
            {newlyCreatedKey.scopes.map((s) => (
              <ScopeChip key={s} scope={s} />
            ))}
          </div>
        </div>
      )}

      {/* Keys Table */}
      {keys.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '48px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
          }}
        >
          <div style={{ fontSize: '24px', marginBottom: '12px' }}>[ ]</div>
          <p style={{ color: 'var(--text-muted)', marginBottom: '16px' }}>
            No agents connected yet
          </p>
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
            Connect Your First Agent
          </button>
        </div>
      ) : (
        <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th
                  style={{
                    padding: '12px',
                    textAlign: 'left',
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    fontWeight: 500,
                  }}
                >
                  Name
                </th>
                <th
                  style={{
                    padding: '12px',
                    textAlign: 'left',
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    fontWeight: 500,
                  }}
                >
                  Key
                </th>
                <th
                  style={{
                    padding: '12px',
                    textAlign: 'left',
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    fontWeight: 500,
                  }}
                >
                  Scopes
                </th>
                <th
                  style={{
                    padding: '12px',
                    textAlign: 'left',
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    fontWeight: 500,
                  }}
                >
                  Last Used
                </th>
                <th
                  style={{
                    padding: '12px',
                    textAlign: 'left',
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    fontWeight: 500,
                  }}
                >
                  Expires
                </th>
                <th
                  style={{
                    padding: '12px',
                    textAlign: 'left',
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    fontWeight: 500,
                  }}
                >
                  Status
                </th>
                <th
                  style={{
                    padding: '12px',
                    textAlign: 'right',
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    fontWeight: 500,
                  }}
                >
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => {
                const expired = isExpired(key);
                return (
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
                    <td style={{ padding: '12px', maxWidth: '260px' }}>
                      <div>
                        {(key.scopes || []).length === 0 ? (
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            (no scopes)
                          </span>
                        ) : (
                          (key.scopes || []).map((s) => <ScopeChip key={s} scope={s} />)
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '12px', fontSize: '12px', color: 'var(--text-muted)' }}>
                      {formatRelative(key.last_used_at)}
                    </td>
                    <td style={{ padding: '12px', fontSize: '12px', color: 'var(--text-muted)' }}>
                      {key.expires_at ? formatDate(key.expires_at) : 'No expiry'}
                    </td>
                    <td style={{ padding: '12px' }}>
                      {!key.is_active ? (
                        <span
                          style={{
                            fontSize: '10px',
                            padding: '2px 8px',
                            background: 'rgba(244, 67, 54, 0.2)',
                            color: 'var(--error, #f44336)',
                          }}
                        >
                          Revoked
                        </span>
                      ) : expired ? (
                        <span
                          style={{
                            fontSize: '10px',
                            padding: '2px 8px',
                            background: 'rgba(255, 152, 0, 0.2)',
                            color: '#ff9800',
                          }}
                        >
                          Expired
                        </span>
                      ) : (
                        <span
                          style={{
                            fontSize: '10px',
                            padding: '2px 8px',
                            background: 'rgba(76, 175, 80, 0.2)',
                            color: 'var(--success, #4caf50)',
                          }}
                        >
                          Active
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
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Documentation Link */}
      <div
        style={{
          marginTop: '24px',
          padding: '16px',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
        }}
      >
        <h3 style={{ fontSize: '12px', marginBottom: '8px' }}>Quick Start</h3>
        <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px' }}>
          Once you have a key, your agent can post events to NUKE in one call:
        </p>
        <pre
          style={{
            background: 'var(--bg)',
            padding: '12px',
            fontSize: '11px',
            overflow: 'auto',
            margin: 0,
          }}
        >
{`curl -X POST "https://nuke.ag/v1/events" \\
  -H "X-API-Key: nk_live_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "schema_version": "1.0",
    "event_type": "service",
    "vehicle_ref": { "vin": "6F07C219593" },
    "occurred_at": "2026-05-02T21:47:00Z",
    "submitted_at": "2026-05-02T21:48:12Z",
    "agent": { "id": "claude", "version": "opus-4-7", "session_id": "demo" },
    "payload": {
      "summary": "Engine refresh - peripherals pulled",
      "narrative": "Pulled valve covers, photographed door tag."
    }
  }'`}
        </pre>
        <div style={{ marginTop: '12px' }}>
          <a href="/api/docs" style={{ fontSize: '12px', color: 'var(--accent)' }}>
            Full API documentation -&gt;
          </a>
        </div>
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div
          style={{
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
          }}
        >
          <div
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              padding: '24px',
              width: '100%',
              maxWidth: '480px',
            }}
          >
            <h2 style={{ fontSize: '16px', marginBottom: '16px' }}>Connect a New Agent</h2>

            <div style={{ marginBottom: '16px' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  marginBottom: '4px',
                }}
              >
                Agent Name
              </label>
              <input
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="e.g., Claude (Mustang sessions)"
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

            <div style={{ marginBottom: '16px' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  marginBottom: '8px',
                }}
              >
                Scope
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                  padding: '8px',
                  border: '1px solid var(--border)',
                  marginBottom: '6px',
                  cursor: 'pointer',
                  background: scopeMode === 'one_vehicle' ? 'var(--bg-secondary)' : 'transparent',
                }}
              >
                <input
                  type="radio"
                  name="scope-mode"
                  checked={scopeMode === 'one_vehicle'}
                  onChange={() => setScopeMode('one_vehicle')}
                  style={{ marginTop: '2px' }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '12px', fontWeight: 500 }}>
                    Write to one specific vehicle
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '6px' }}>
                    Recommended. The agent can only write events for this VIN.
                  </div>
                  <input
                    type="text"
                    value={scopeVin}
                    onChange={(e) => setScopeVin(e.target.value)}
                    onFocus={() => setScopeMode('one_vehicle')}
                    placeholder="VIN (e.g., 6F07C219593)"
                    disabled={scopeMode !== 'one_vehicle'}
                    style={{
                      width: '100%',
                      padding: '8px',
                      fontSize: '12px',
                      fontFamily: "'Courier New', monospace",
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)',
                      opacity: scopeMode === 'one_vehicle' ? 1 : 0.4,
                    }}
                  />
                </div>
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                  padding: '8px',
                  border: '1px solid var(--border)',
                  cursor: 'pointer',
                  background: scopeMode === 'any_vehicle' ? 'var(--bg-secondary)' : 'transparent',
                }}
              >
                <input
                  type="radio"
                  name="scope-mode"
                  checked={scopeMode === 'any_vehicle'}
                  onChange={() => setScopeMode('any_vehicle')}
                  style={{ marginTop: '2px' }}
                />
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 500 }}>
                    Write to any vehicle I own
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                    Power-user mode. The agent picks the VIN per submission.
                  </div>
                </div>
              </label>
            </div>

            <div style={{ marginBottom: '24px' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  marginBottom: '4px',
                }}
              >
                Expiration
              </label>
              <select
                value={newKeyExpiry}
                onChange={(e) => setNewKeyExpiry(parseInt(e.target.value, 10))}
                style={{
                  width: '100%',
                  padding: '10px',
                  fontSize: '12px',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                }}
              >
                <option value={30}>30 days</option>
                <option value={90}>90 days (recommended)</option>
                <option value={365}>1 year</option>
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
                disabled={!newKeyName.trim() || creating || (scopeMode === 'one_vehicle' && !scopeVin.trim())}
                style={{
                  background: 'var(--accent)',
                  color: 'var(--bg)',
                  border: 'none',
                  padding: '10px 16px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  opacity:
                    !newKeyName.trim() || creating || (scopeMode === 'one_vehicle' && !scopeVin.trim())
                      ? 0.5
                      : 1,
                }}
              >
                {creating ? 'Creating...' : 'Issue Key'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

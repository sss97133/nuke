import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface SocialConnection {
  id: string;
  platform: string;
  handle: string;
  display_name: string | null;
  profile_url: string | null;
  claimed_at: string;
  metadata: {
    auto_post_enabled?: boolean;
    token_expires_at?: string;
  };
}

const SOCIAL_PLATFORMS = [
  {
    id: 'x',
    name: 'X (Twitter)',
    icon: '𝕏',
    color: '#000000',
    oauthEndpoint: 'twitter', // Uses Supabase built-in provider
    description: 'Auto-post insights and updates'
  },
  {
    id: 'instagram',
    name: 'Instagram',
    icon: '📸',
    color: '#E4405F',
    oauthEndpoint: null, // Coming soon
    description: 'Share to Instagram (coming soon)'
  },
  {
    id: 'threads',
    name: 'Threads',
    icon: '🧵',
    color: '#000000',
    oauthEndpoint: null,
    description: 'Post to Threads (coming soon)'
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    icon: '💼',
    color: '#0A66C2',
    oauthEndpoint: null,
    description: 'Professional updates (coming soon)'
  },
  {
    id: 'youtube',
    name: 'YouTube',
    icon: '▶️',
    color: '#FF0000',
    oauthEndpoint: null,
    description: 'Video content (coming soon)'
  },
];

interface Props {
  userId: string;
}

export default function SocialConnections({ userId }: Props) {
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadConnections = async () => {
    setLoading(true);
    try {
      // Check Supabase Auth for linked identities
      const { data: { user } } = await supabase.auth.getUser();
      const linkedIdentities: SocialConnection[] = [];

      if (user?.identities) {
        for (const identity of user.identities) {
          if (identity.provider === 'twitter') {
            linkedIdentities.push({
              id: identity.id,
              platform: 'x',
              handle: identity.identity_data?.user_name || identity.identity_data?.preferred_username || 'unknown',
              display_name: identity.identity_data?.full_name || identity.identity_data?.name || null,
              profile_url: `https://x.com/${identity.identity_data?.user_name || ''}`,
              claimed_at: identity.created_at || new Date().toISOString(),
              metadata: {
                auto_post_enabled: true,
                provider_id: identity.provider_id
              }
            });
          }
        }
      }

      // Also check external_identities table for any additional connections
      const { data, error } = await supabase
        .from('external_identities')
        .select('id, platform, handle, display_name, profile_url, claimed_at, metadata')
        .eq('claimed_by_user_id', userId)
        .in('platform', SOCIAL_PLATFORMS.map(p => p.id))
        .order('platform');

      if (!error && data) {
        // Merge, avoiding duplicates
        const allConnections = [...linkedIdentities];
        for (const conn of data) {
          if (!allConnections.find(c => c.platform === conn.platform && c.handle === conn.handle)) {
            allConnections.push(conn);
          }
        }
        setConnections(allConnections);
      } else {
        setConnections(linkedIdentities);
      }
    } catch (err) {
      console.error('Failed to load social connections:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (userId) {
      loadConnections();
    }

    // Check URL for OAuth callback result
    const params = new URLSearchParams(window.location.search);
    if (params.get('x_connected') === 'true') {
      const handle = params.get('handle');
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
      loadConnections();
    }
  }, [userId]);

  const initiateOAuth = async (platform: typeof SOCIAL_PLATFORMS[0]) => {
    if (!platform.oauthEndpoint) {
      setError(`${platform.name} connection coming soon`);
      setTimeout(() => setError(null), 3000);
      return;
    }

    setConnecting(platform.id);
    setError(null);

    try {
      // Use Supabase's built-in OAuth with identity linking
      if (platform.id === 'x') {
        const { data, error } = await supabase.auth.linkIdentity({
          provider: 'twitter',
          options: {
            redirectTo: window.location.origin + window.location.pathname,
            scopes: 'tweet.read tweet.write users.read offline.access'
          }
        });

        if (error) throw error;

        // The linkIdentity will redirect to X for authorization
        // No need to do anything else here - browser will redirect
        return;
      }

      // Fallback for other platforms using custom OAuth
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError('Please sign in to connect accounts');
        return;
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${platform.oauthEndpoint}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            user_id: userId,
            redirect_after: window.location.pathname
          })
        }
      );

      const data = await response.json();

      if (data.authorization_url) {
        window.location.href = data.authorization_url;
      } else {
        throw new Error(data.error || 'Failed to start OAuth flow');
      }
    } catch (err: any) {
      console.error('OAuth error:', err);
      setError(err.message || 'Failed to connect');
    } finally {
      setConnecting(null);
    }
  };

  const disconnectPlatform = async (connection: SocialConnection) => {
    if (!confirm(`Disconnect @${connection.handle} from ${connection.platform}?`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('external_identities')
        .update({
          claimed_by_user_id: null,
          claimed_at: null,
          metadata: {
            ...connection.metadata,
            access_token: null,
            refresh_token: null,
            auto_post_enabled: false
          }
        })
        .eq('id', connection.id);

      if (error) throw error;
      loadConnections();
    } catch (err: any) {
      setError(err.message || 'Failed to disconnect');
    }
  };

  const toggleAutoPost = async (connection: SocialConnection) => {
    try {
      const newValue = !connection.metadata?.auto_post_enabled;
      const { error } = await supabase
        .from('external_identities')
        .update({
          metadata: {
            ...connection.metadata,
            auto_post_enabled: newValue
          }
        })
        .eq('id', connection.id);

      if (error) throw error;
      loadConnections();
    } catch (err: any) {
      setError(err.message || 'Failed to update setting');
    }
  };

  const getPlatformInfo = (platformId: string) => {
    return SOCIAL_PLATFORMS.find(p => p.id === platformId) || {
      id: platformId,
      name: platformId,
      icon: '🔗',
      color: '#6b7280',
      oauthEndpoint: null,
      description: ''
    };
  };

  const connectedPlatformIds = connections.map(c => c.platform);

  return (
    <div className="card">
      <div className="card-header">
        <h3 className="text font-bold" style={{ fontSize: '8pt', margin: 0 }}>
          Social Connections
        </h3>
      </div>
      <div className="card-body">
        <p className="text-small text-muted" style={{ marginBottom: 'var(--space-3)' }}>
          Connect your social accounts to auto-post insights and updates from your work.
        </p>

        {error && (
          <div style={{
            padding: '8px 12px',
            marginBottom: '12px',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '4px',
            color: '#dc2626',
            fontSize: '8pt'
          }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontSize: '8pt' }}>
            Loading connections...
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* Connected accounts */}
            {connections.map(conn => {
              const platform = getPlatformInfo(conn.platform);
              const isExpired = conn.metadata?.token_expires_at &&
                new Date(conn.metadata.token_expires_at) < new Date();

              return (
                <div
                  key={conn.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '10px 12px',
                    background: 'var(--surface-hover)',
                    borderRadius: '4px',
                    border: isExpired ? '2px solid #f59e0b' : '1px solid var(--border)'
                  }}
                >
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

                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '9pt', fontWeight: 600 }}>
                        @{conn.handle}
                      </span>
                      <span style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: '10px',
                        fontSize: '7pt',
                        fontWeight: 600,
                        background: isExpired ? '#fef3c7' : '#dcfce7',
                        color: isExpired ? '#d97706' : '#16a34a'
                      }}>
                        {isExpired ? 'Reconnect Needed' : 'Connected'}
                      </span>
                    </div>
                    <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                      {platform.name} • Connected {new Date(conn.claimed_at).toLocaleDateString()}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {/* Auto-post toggle */}
                    <label style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      cursor: 'pointer',
                      fontSize: '7pt'
                    }}>
                      <input
                        type="checkbox"
                        checked={conn.metadata?.auto_post_enabled || false}
                        onChange={() => toggleAutoPost(conn)}
                        style={{ width: '14px', height: '14px' }}
                      />
                      Auto-post
                    </label>

                    {isExpired ? (
                      <button
                        className="button button-small"
                        onClick={() => initiateOAuth(platform)}
                        disabled={connecting === platform.id}
                        style={{ fontSize: '7pt', background: '#fef3c7', borderColor: '#f59e0b', color: '#92400e' }}
                      >
                        {connecting === platform.id ? '...' : 'Reconnect'}
                      </button>
                    ) : (
                      <button
                        className="button button-small"
                        onClick={() => disconnectPlatform(conn)}
                        style={{ fontSize: '7pt' }}
                      >
                        Disconnect
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Available platforms */}
            {SOCIAL_PLATFORMS.filter(p => !connectedPlatformIds.includes(p.id)).map(platform => (
              <div
                key={platform.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 12px',
                  background: 'var(--surface)',
                  borderRadius: '4px',
                  border: '1px dashed var(--border)'
                }}
              >
                <div style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '8px',
                  background: platform.color + '10',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '16pt',
                  flexShrink: 0,
                  opacity: platform.oauthEndpoint ? 1 : 0.5
                }}>
                  {platform.icon}
                </div>

                <div style={{ flex: 1, opacity: platform.oauthEndpoint ? 1 : 0.6 }}>
                  <div style={{ fontSize: '9pt', fontWeight: 600 }}>
                    {platform.name}
                  </div>
                  <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                    {platform.description}
                  </div>
                </div>

                <button
                  className="button button-small button-primary"
                  onClick={() => initiateOAuth(platform)}
                  disabled={!platform.oauthEndpoint || connecting === platform.id}
                  style={{
                    fontSize: '7pt',
                    opacity: platform.oauthEndpoint ? 1 : 0.5
                  }}
                >
                  {connecting === platform.id ? 'Connecting...' : 'Connect'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

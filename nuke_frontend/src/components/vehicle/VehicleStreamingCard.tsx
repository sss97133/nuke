import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { LiveService } from '../../services/liveService';
import { useToast } from '../../hooks/useToast';
import type { LiveSession } from '../../pages/vehicle-profile/types';

type StreamProvider = 'mux' | 'twitch';

interface TwitchIdentity {
  id: string;
  handle: string | null;
  profile_url: string | null;
  display_name: string | null;
  metadata?: Record<string, any> | null;
}

interface VehicleStreamingCardProps {
  vehicleId: string;
  vehicleName?: string | null;
  session: any;
  canManage: boolean;
  liveSession?: LiveSession | null;
  onSessionUpdated?: () => void;
}

const formatProviderLabel = (provider?: string | null, platform?: string | null) => {
  if (provider === 'mux') return 'Nuke Live';
  if (!platform) return 'Live';
  if (platform === 'twitch') return 'Twitch';
  if (platform === 'youtube') return 'YouTube';
  if (platform === 'custom') return 'Live';
  return platform;
};

const VehicleStreamingCard: React.FC<VehicleStreamingCardProps> = ({
  vehicleId,
  vehicleName,
  session,
  canManage,
  liveSession,
  onSessionUpdated
}) => {
  const { showToast } = useToast();
  const [provider, setProvider] = useState<StreamProvider>('mux');
  const [title, setTitle] = useState('');
  const [twitchIdentity, setTwitchIdentity] = useState<TwitchIdentity | null>(null);
  const [twitchUrl, setTwitchUrl] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [muxSettings, setMuxSettings] = useState<any | null>(null);

  const userId = session?.user?.id || null;

  const resolvedTwitchUrl = useMemo(() => {
    const manual = String(twitchUrl || '').trim();
    if (manual) return manual;
    if (twitchIdentity?.profile_url) return twitchIdentity.profile_url;
    if (twitchIdentity?.handle) return `https://www.twitch.tv/${twitchIdentity.handle}`;
    return '';
  }, [twitchUrl, twitchIdentity]);

  const defaultTitle = useMemo(() => {
    const safeName = String(vehicleName || '').trim();
    return safeName ? `Live: ${safeName}` : 'Live vehicle stream';
  }, [vehicleName]);

  useEffect(() => {
    if (!userId || !canManage) return;
    const loadTwitchIdentity = async () => {
      const { data, error } = await supabase
        .from('external_identities')
        .select('id, handle, profile_url, display_name, metadata')
        .eq('platform', 'twitch')
        .eq('claimed_by_user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!error) {
        setTwitchIdentity(data || null);
      }
    };
    loadTwitchIdentity();
  }, [userId, canManage]);

  const handleConnectTwitch = async () => {
    if (!userId) return;
    setActionLoading(true);
    try {
      const redirectUrl = `${window.location.origin}/vehicles/${vehicleId}?twitch_connected=true`;
      const { data, error } = await supabase.functions.invoke('get-twitch-auth-url', {
        body: { user_id: userId, vehicle_id: vehicleId, redirect_url: redirectUrl }
      });
      if (error) throw error;
      if (!data?.auth_url) throw new Error('Missing Twitch auth URL');
      window.location.href = data.auth_url as string;
    } catch (err: any) {
      showToast(err?.message || 'Failed to start Twitch connect', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const loadMuxSettings = async () => {
    if (!userId) return;
    setSettingsLoading(true);
    try {
      const settings = await LiveService.getSettings(userId);
      setMuxSettings(settings || {});
    } catch (err: any) {
      setMuxSettings({ error: err?.message || 'Failed to load Mux settings' });
    } finally {
      setSettingsLoading(false);
    }
  };

  const endActiveSession = async (timestamp: string) => {
    await supabase
      .from('live_streaming_sessions')
      .update({ is_live: false, ended_at: timestamp })
      .eq('vehicle_id', vehicleId)
      .is('ended_at', null);
  };

  const handleGoLive = async () => {
    if (!userId || actionLoading) return;
    setActionLoading(true);
    try {
      const now = new Date().toISOString();
      const sessionTitle = String(title || '').trim() || defaultTitle;

      await endActiveSession(now);

      if (provider === 'mux') {
        await LiveService.getSettings(userId);
        const playbackUrl = await LiveService.getPlaybackUrl(userId);
        if (!playbackUrl) {
          throw new Error('Mux playback not ready yet. Open stream settings first.');
        }

        const startRes = await LiveService.start(userId);
        if (!startRes.ok) {
          throw new Error(startRes.message || 'Failed to mark Mux stream live');
        }

        const { error } = await supabase
          .from('live_streaming_sessions')
          .insert({
            vehicle_id: vehicleId,
            streamer_id: userId,
            platform: 'custom',
            stream_provider: 'mux',
            stream_url: playbackUrl,
            title: sessionTitle,
            description: null,
            is_live: true,
            started_at: now
          });
        if (error) throw error;
      } else {
        const streamUrl = resolvedTwitchUrl;
        if (!streamUrl) {
          throw new Error('Add a Twitch channel URL or connect an account first.');
        }
        const { error } = await supabase
          .from('live_streaming_sessions')
          .insert({
            vehicle_id: vehicleId,
            streamer_id: userId,
            platform: 'twitch',
            stream_provider: 'twitch',
            stream_url: streamUrl,
            title: sessionTitle,
            description: null,
            is_live: true,
            started_at: now,
            external_identity_id: twitchIdentity?.id || null
          });
        if (error) throw error;
      }

      showToast('Live session created', 'success');
      setTitle('');
      onSessionUpdated?.();
    } catch (err: any) {
      showToast(err?.message || 'Failed to start stream', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleStop = async () => {
    if (!userId || !liveSession?.id || actionLoading) return;
    setActionLoading(true);
    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('live_streaming_sessions')
        .update({ is_live: false, ended_at: now })
        .eq('id', liveSession.id);
      if (error) throw error;

      if (liveSession?.stream_provider === 'mux') {
        await LiveService.stop(userId);
      }

      showToast('Live session ended', 'success');
      onSessionUpdated?.();
    } catch (err: any) {
      showToast(err?.message || 'Failed to end stream', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  if (!canManage) return null;

  return (
    <div className="card">
      <div className="card-header">LIVE STREAMING</div>
      <div className="card-body">
        {liveSession ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                background: '#dc2626',
                color: 'white',
                padding: '2px 6px',
                borderRadius: 4,
                fontSize: '10px',
                fontWeight: 700
              }}>
                LIVE
              </span>
              <span style={{ fontSize: '12px', fontWeight: 600 }}>
                {formatProviderLabel(liveSession.stream_provider, liveSession.platform)}
              </span>
              {liveSession.title ? (
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {liveSession.title}
                </span>
              ) : null}
            </div>
            {liveSession.stream_url && (
              <a
                href={liveSession.stream_url}
                target="_blank"
                rel="noopener noreferrer"
                className="button button-small"
                style={{ fontSize: '8pt', width: 'fit-content' }}
              >
                Watch Stream
              </a>
            )}
            <button
              className="button button-small button-secondary"
              onClick={handleStop}
              disabled={actionLoading}
            >
              End Live Session
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ fontSize: '10pt', fontWeight: 600 }}>Stream provider</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as StreamProvider)}
              style={{ padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border)' }}
            >
              <option value="mux">Nuke Live (Mux)</option>
              <option value="twitch">Twitch</option>
            </select>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: '10pt', fontWeight: 600 }}>Live title (optional)</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={defaultTitle}
                style={{ padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border)' }}
              />
            </div>

            {provider === 'twitch' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {twitchIdentity ? (
                  <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>
                    Connected Twitch: <strong>{twitchIdentity.display_name || twitchIdentity.handle}</strong>
                  </div>
                ) : (
                  <button
                    className="button button-small"
                    onClick={handleConnectTwitch}
                    disabled={actionLoading}
                  >
                    Connect Twitch
                  </button>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: '10pt', fontWeight: 600 }}>Twitch channel URL</label>
                  <input
                    value={twitchUrl}
                    onChange={(e) => setTwitchUrl(e.target.value)}
                    placeholder={twitchIdentity?.profile_url || 'https://www.twitch.tv/yourchannel'}
                    style={{ padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border)' }}
                  />
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  className="button button-small button-secondary"
                  onClick={loadMuxSettings}
                  disabled={settingsLoading}
                >
                  {settingsLoading ? 'Loading Mux Settings…' : 'Show Mux Stream Settings'}
                </button>
                {muxSettings && (
                  <div style={{ fontSize: '9pt', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {muxSettings.error ? (
                      <div style={{ color: '#b91c1c' }}>{String(muxSettings.error)}</div>
                    ) : (
                      <>
                        {muxSettings.rtmpUrl && (
                          <div>
                            <div style={{ fontWeight: 600 }}>RTMP URL</div>
                            <div style={{ wordBreak: 'break-all' }}>{muxSettings.rtmpUrl}</div>
                          </div>
                        )}
                        {muxSettings.streamKey ? (
                          <div>
                            <div style={{ fontWeight: 600 }}>Stream Key</div>
                            <div style={{ wordBreak: 'break-all' }}>{muxSettings.streamKey}</div>
                          </div>
                        ) : (
                          <div style={{ color: 'var(--text-muted)' }}>
                            Stream key available only to the stream owner.
                          </div>
                        )}
                        {muxSettings.playbackUrl && (
                          <div>
                            <div style={{ fontWeight: 600 }}>Playback</div>
                            <div style={{ wordBreak: 'break-all' }}>{muxSettings.playbackUrl}</div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            <button
              className="button button-small button-primary"
              onClick={handleGoLive}
              disabled={actionLoading}
            >
              {actionLoading ? 'Starting…' : 'Start Live Session'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default VehicleStreamingCard;

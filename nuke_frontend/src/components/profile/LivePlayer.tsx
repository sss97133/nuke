import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { LiveService } from '../../services/liveService';
import type { LiveStatus } from '../../services/liveService';

interface LivePlayerProps {
  userId: string;
  isOwnProfile: boolean;
}

const LivePlayer: React.FC<LivePlayerProps> = ({ userId, isOwnProfile }) => {
  const [status, setStatus] = useState<LiveStatus>({ live: false });
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<any | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        setLoading(true);
        const [s, url] = await Promise.all([
          LiveService.getStatus(userId),
          LiveService.getPlaybackUrl(userId)
        ]);
        if (!mounted) return;
        setStatus(s);
        setPlaybackUrl(url);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();

    const t = setInterval(load, 15000);
    return () => { mounted = false; clearInterval(t); };
  }, [userId]);

  const reload = async () => {
    setLoading(true);
    try {
      const [s, url] = await Promise.all([
        LiveService.getStatus(userId),
        LiveService.getPlaybackUrl(userId),
      ]);
      setStatus(s);
      setPlaybackUrl(url);
    } finally {
      setLoading(false);
    }
  };

  const handleGoLive = async () => {
    if (actionLoading) return;
    setActionLoading(true);
    setActionMsg(null);
    try {
      const res = await LiveService.start(userId);
      if (!res.ok) setActionMsg(res.message || 'Failed to start stream');
      await reload();
    } finally {
      setActionLoading(false);
    }
  };

  const handleStop = async () => {
    if (actionLoading) return;
    setActionLoading(true);
    setActionMsg(null);
    try {
      const res = await LiveService.stop(userId);
      if (!res.ok) setActionMsg(res.message || 'Failed to stop stream');
      await reload();
    } finally {
      setActionLoading(false);
    }
  };

  const openSettings = async () => {
    setShowSettings(true);
    try {
      const s = await LiveService.getSettings(userId);
      setSettings(s || {});
    } catch (e: any) {
      setSettings({ error: e?.message || 'Failed to load settings' });
    }
  };

  const closeSettings = () => setShowSettings(false);

  return (
    <div className="card">
      <div className="card-body">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className={`badge ${status.live ? 'badge-success' : 'badge-secondary'}`}>
              {status.live ? 'LIVE' : 'Offline'}
            </span>
            {status.nextStart && (
              <span className="text-small text-muted">Next: {new Date(status.nextStart).toLocaleString()}</span>
            )}
          </div>
          {isOwnProfile && (
            <div className="flex items-center gap-2">
              {status.live ? (
                <button
                  className="button button-small"
                  onClick={handleStop}
                  disabled={actionLoading}
                  aria-label="Stop stream"
                >
                  Stop Stream
                </button>
              ) : (
                <button
                  className="button button-small"
                  onClick={handleGoLive}
                  disabled={actionLoading}
                  aria-label="Go live via RTMP"
                >
                  Go Live (RTMP)
                </button>
              )}
              <button
                className="button button-small button-secondary"
                onClick={openSettings}
                disabled={actionLoading}
                aria-label="Open stream settings"
              >
                Stream Settings
              </button>
            </div>
          )}
        </div>

        {actionMsg && (
          <div className="text-small" style={{ color: '#b91c1c', marginBottom: 8 }}>{actionMsg}</div>
        )}

        {loading ? (
          <div className="text-small text-muted">Checking live status…</div>
        ) : playbackUrl ? (
          <div className="aspect-video bg-black rounded overflow-hidden">
            <video
              src={playbackUrl}
              controls
              playsInline
              style={{ width: '100%', height: '100%', background: 'black' }}
            />
          </div>
        ) : (
          <div className="text-small text-muted">No stream available</div>
        )}
      </div>

      {showSettings && ReactDOM.createPortal(
        <div
          role="dialog"
          aria-modal="true"
          onClick={closeSettings}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            padding: '20px'
          }}
        >
          <div
            className="card"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(560px, 92vw)',
              maxHeight: '90vh',
              overflow: 'auto'
            }}
          >
            <div className="card-body">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text font-bold">Stream Settings</h4>
                <button className="button button-small button-secondary" onClick={closeSettings} aria-label="Close settings">Close</button>
              </div>
              {!settings ? (
                <div className="text-small text-muted">Loading…</div>
              ) : settings.error ? (
                <div className="text-small" style={{ color: '#b91c1c' }}>{String(settings.error)}</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {settings.rtmpUrl && (
                    <div>
                      <div className="text-small text-muted">RTMP URL</div>
                      <div className="text-small" style={{ wordBreak: 'break-all' }}>{settings.rtmpUrl}</div>
                    </div>
                  )}
                  {settings.streamKey && (
                    <div>
                      <div className="text-small text-muted">Stream Key</div>
                      <div className="text-small" style={{ wordBreak: 'break-all' }}>{settings.streamKey}</div>
                    </div>
                  )}
                  {playbackUrl && (
                    <div>
                      <div className="text-small text-muted">Playback</div>
                      <div className="text-small" style={{ wordBreak: 'break-all' }}>{playbackUrl}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default LivePlayer;

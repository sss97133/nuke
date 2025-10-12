import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

interface LiveStatusBarProps {
  vehicleId: string;
}

interface PresenceData {
  total_users: number;
  anonymous_users: number;
  authenticated_users: number;
  owners_online: number;
  moderators_online: number;
  live_streams: number;
}

interface LiveStream {
  id: string;
  vehicle_id: string;
  user_id: string;
  stream_title: string;
  stream_description?: string;
  stream_url?: string;
  stream_platform: string;
  viewer_count: number;
  started_at: string;
}

const LiveStatusBar: React.FC<LiveStatusBarProps> = ({ vehicleId }) => {
  const [presence, setPresence] = useState<PresenceData>({
    total_users: 0,
    anonymous_users: 0,
    authenticated_users: 0,
    owners_online: 0,
    moderators_online: 0,
    live_streams: 0
  });
  const [liveStreams, setLiveStreams] = useState<LiveStream[]>([]);
  const sessionIdRef = useRef<string>('');
  const presenceIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const init = async () => {
      await initializePresence();
      await fetchLiveStreams();
    };
    init();
    
    return () => {
      if (presenceIntervalRef.current) {
        clearInterval(presenceIntervalRef.current);
      }
    };
  }, [vehicleId]);

  const initializePresence = async () => {
    // Generate or get session ID for tracking this browser session
    if (!sessionIdRef.current) {
      sessionIdRef.current = sessionStorage.getItem('nuke_presence_session') || 
        (() => {
          const id = crypto.randomUUID();
          sessionStorage.setItem('nuke_presence_session', id);
          return id;
        })();
    }

    await updatePresence();
    presenceIntervalRef.current = setInterval(updatePresence, 10000);
  };

  const updatePresence = async () => {
    // Skip presence updates - RPC doesn't exist
    setPresence({
      total_users: 1,
      anonymous_users: 1,
      authenticated_users: 0,
      owners_online: 0,
      moderators_online: 0,
      live_streams: 0
    });
  };

  const fetchLiveStreams = async () => {
    // Skip live streams - table doesn't exist
    setLiveStreams([]);
  };

  return (
    <div style={{
      position: 'sticky',
      top: 0,
      zIndex: 100,
      backgroundColor: '#f8fafc',
      borderBottom: '1px solid #e2e8f0',
      padding: '8px 16px'
    }}>
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        maxWidth: '100%',
        margin: '0 auto'
      }}>
        {/* User Presence */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: presence.total_users > 0 ? '#10b981' : '#6b7280'
            }} />
            <span style={{ fontSize: '8pt', color: '#374151' }}>
              {presence.total_users} online
            </span>
          </div>

          {/* Moderators - only show if active */}
          {presence.moderators_online > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '8pt', color: '#059669', fontWeight: '500' }}>
                ({presence.moderators_online}) moderator{presence.moderators_online > 1 ? 's' : ''}
              </span>
            </div>
          )}

          {/* Owners - only show if active */}
          {presence.owners_online > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '16px' }}>👑</span>
              <span style={{ fontSize: '8pt', color: '#059669', fontWeight: '500' }}>
                ({presence.owners_online}) owner{presence.owners_online > 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>

        {/* Live Streams */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {liveStreams.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {liveStreams.map((stream) => (
                <div key={stream.id} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{
                    backgroundColor: '#dc2626',
                    color: 'white',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    fontSize: '12px',
                    fontWeight: 'bold'
                  }}>
                    🔴 LIVE
                  </div>
                  <span style={{ fontSize: '8pt', color: '#374151' }}>
                    {stream.stream_title}
                  </span>
                  <span style={{ fontSize: '7pt', color: '#6b7280' }}>
                    ({stream.stream_platform})
                  </span>
                  {stream.stream_url && (
                    <a 
                      href={stream.stream_url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      style={{
                        fontSize: '7pt',
                        color: '#2563eb',
                        textDecoration: 'none'
                      }}
                    >
                      Watch
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

export default LiveStatusBar;

import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';

interface StreamFeedItem {
  stream_id: string;
  title: string;
  description: string;
  stream_type: string;
  status: string;
  streamer_name: string;
  streamer_avatar: string;
  thumbnail_url: string;
  viewer_count: number;
  started_at: string;
  duration_seconds: number;
  tags: string[];
  is_following: boolean;
}

interface LiveStreamFeedProps {
  onStreamSelect?: (streamId: string) => void;
}

const LiveStreamFeed = ({ onStreamSelect }: LiveStreamFeedProps) => {
  const [streams, setStreams] = useState<StreamFeedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<string>('all');

  const streamTypes = [
    { value: 'all', label: 'All Streams', icon: '🔴' },
    { value: 'build_session', label: 'Build Sessions', icon: '🔧' },
    { value: 'garage_tour', label: 'Garage Tours', icon: '🏠' },
    { value: 'dyno_run', label: 'Dyno Runs', icon: '⚡' },
    { value: 'race_event', label: 'Race Events', icon: '🏁' },
    { value: 'tutorial', label: 'Tutorials', icon: '📚' },
    { value: 'q_and_a', label: 'Q&A Sessions', icon: '❓' }
  ];

  useEffect(() => {
    loadStreams();

    const subscription = supabase
      .channel('live_streams_feed')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'live_streams'
        },
        () => {
          loadStreams();
        }
      )
      .subscribe();

    const refreshInterval = setInterval(loadStreams, 30000); // Refresh every 30 seconds

    return () => {
      supabase.removeChannel(subscription);
      clearInterval(refreshInterval);
    };
  }, [filter]);

  const loadStreams = async () => {
    setLoading(true);

    try {
      const { data, error } = await supabase.rpc('get_live_streams_feed', {
        viewer_user_id: null,
        limit_count: 50,
        offset_count: 0
      });

      if (error) {
        console.error('Error loading streams:', error);
      } else {
        let filteredStreams = data || [];

        if (filter !== 'all') {
          filteredStreams = filteredStreams.filter((stream: StreamFeedItem) =>
            stream.stream_type === filter
          );
        }

        setStreams(filteredStreams);
      }
    } catch (error) {
      console.error('Load streams error:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatViewerCount = (count: number) => {
    if (count < 1000) return count.toString();
    if (count < 1000000) return `${(count / 1000).toFixed(1)}K`;
    return `${(count / 1000000).toFixed(1)}M`;
  };

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'live': return '🔴';
      case 'scheduled': return '📅';
      case 'ended': return '⚫';
      default: return '⭕';
    }
  };

  const handleStreamClick = (streamId: string) => {
    if (onStreamSelect) {
      onStreamSelect(streamId);
    }
  };

  return (
    <div style={{
      background: 'var(--bg)',
      border: '1px solid #bdbdbd',
      padding: '16px',
      margin: '16px',
      fontFamily: 'Arial, sans-serif'
    }}>
      <h3 style={{ fontSize: '8pt', fontWeight: 'bold', margin: '0 0 12px 0' }}>
        📺 Live Streams
      </h3>

      {/* Stream Type Filter */}
      <div style={{
        background: 'var(--surface)',
        border: '1px solid #bdbdbd',
        padding: '8px',
        marginBottom: '12px'
      }}>
        <div style={{
          display: 'flex',
          gap: '4px',
          flexWrap: 'wrap',
          alignItems: 'center'
        }}>
          {streamTypes.map(type => (
            <button
              key={type.value}
              onClick={() => setFilter(type.value)}
              style={{
                padding: '4px 8px',
                fontSize: '8pt',
                border: '1px solid #bdbdbd',
                background: filter === type.value ? '#424242' : '#f5f5f5',
                color: filter === type.value ? 'white' : '#424242',
                borderRadius: '0px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <span style={{ fontSize: '7pt' }}>{type.icon}</span>
              {type.label}
            </button>
          ))}
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div style={{
          background: '#e7f3ff',
          border: '1px solid #b8daff',
          padding: '12px',
          textAlign: 'center',
          fontSize: '8pt',
          marginBottom: '12px'
        }}>
          Loading streams...
        </div>
      )}

      {/* Streams Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: '12px',
        maxHeight: '600px',
        overflowY: 'auto'
      }}>
        {streams.map(stream => (
          <div
            key={stream.stream_id}
            onClick={() => handleStreamClick(stream.stream_id)}
            style={{
              background: 'var(--surface)',
              border: '1px solid #bdbdbd',
              padding: '0px',
              cursor: 'pointer',
              position: 'relative'
            }}
          >
            {/* Thumbnail/Preview */}
            <div style={{
              background: '#424242',
              height: '140px',
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              {stream.thumbnail_url ? (
                <img
                  src={stream.thumbnail_url}
                  alt={stream.title}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover'
                  }}
                />
              ) : (
                <div style={{
                  color: 'white',
                  fontSize: '24pt',
                  textAlign: 'center'
                }}>
                  📹
                </div>
              )}

              {/* Status Badge */}
              <div style={{
                position: 'absolute',
                top: '4px',
                left: '4px',
                background: stream.status === 'live' ? '#dc2626' : '#6b7280',
                color: 'white',
                padding: '2px 6px',
                fontSize: '7pt',
                fontWeight: 'bold',
                display: 'flex',
                alignItems: 'center',
                gap: '2px'
              }}>
                {getStatusIcon(stream.status)}
                {stream.status.toUpperCase()}
              </div>

              {/* Viewer Count */}
              {stream.status === 'live' && (
                <div style={{
                  position: 'absolute',
                  bottom: '4px',
                  right: '4px',
                  background: 'rgba(0, 0, 0, 0.8)',
                  color: 'white',
                  padding: '2px 6px',
                  fontSize: '7pt',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '2px'
                }}>
                  👁️ {formatViewerCount(stream.viewer_count)}
                </div>
              )}

              {/* Duration for ended streams */}
              {stream.status === 'ended' && stream.duration_seconds > 0 && (
                <div style={{
                  position: 'absolute',
                  bottom: '4px',
                  right: '4px',
                  background: 'rgba(0, 0, 0, 0.8)',
                  color: 'white',
                  padding: '2px 6px',
                  fontSize: '7pt'
                }}>
                  {formatDuration(stream.duration_seconds)}
                </div>
              )}

              {/* Following Badge */}
              {stream.is_following && (
                <div style={{
                  position: 'absolute',
                  top: '4px',
                  right: '4px',
                  background: '#10b981',
                  color: 'white',
                  padding: '2px 6px',
                  fontSize: '7pt',
                  fontWeight: 'bold'
                }}>
                  ✓ Following
                </div>
              )}
            </div>

            {/* Stream Info */}
            <div style={{ padding: '8px' }}>
              <div style={{
                fontSize: '8pt',
                fontWeight: 'bold',
                marginBottom: '4px',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden'
              }}>
                {stream.title}
              </div>

              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                marginBottom: '4px',
                fontSize: '8pt'
              }}>
                {stream.streamer_avatar && (
                  <img
                    src={stream.streamer_avatar}
                    alt={stream.streamer_name}
                    style={{
                      width: '16px',
                      height: '16px',
                      borderRadius: '50%'
                    }}
                  />
                )}
                <span style={{ fontWeight: 'bold' }}>{stream.streamer_name}</span>
              </div>

              {stream.description && (
                <div style={{
                  fontSize: '7pt',
                  color: '#6b7280',
                  marginBottom: '4px',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden'
                }}>
                  {stream.description}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '7pt' }}>
                <div style={{
                  background: '#dbeafe',
                  color: '#1e40af',
                  padding: '2px 4px',
                  borderRadius: '0px'
                }}>
                  {stream.stream_type.replace('_', ' ')}
                </div>

                {stream.started_at && (
                  <div style={{ color: '#6b7280' }}>
                    {stream.status === 'live' ? 'Started' : 'Ended'} {
                      new Date(stream.started_at).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit'
                      })
                    }
                  </div>
                )}
              </div>

              {/* Tags */}
              {stream.tags && stream.tags.length > 0 && (
                <div style={{ marginTop: '4px', fontSize: '7pt', color: '#6b7280' }}>
                  {stream.tags.slice(0, 3).map(tag => `#${tag}`).join(' ')}
                  {stream.tags.length > 3 && ` +${stream.tags.length - 3}`}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* No Streams Message */}
      {!loading && streams.length === 0 && (
        <div style={{
          background: 'var(--surface)',
          border: '1px solid #bdbdbd',
          padding: '24px',
          textAlign: 'center',
          fontSize: '8pt',
          color: '#757575'
        }}>
          {filter === 'all' ? 'No live streams at the moment' : `No ${filter.replace('_', ' ')} streams available`}
        </div>
      )}
    </div>
  );
};

export default LiveStreamFeed;
import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface Video {
  id: string;
  source: 'facebook' | 'instagram' | 'youtube' | 'upload' | string;
  url?: string;
  thumbnail?: string;
  description?: string;
  created_at?: string;
  external_id?: string;
}

interface VideoSource {
  platform: string;
  isConnected: boolean;
  connectionId?: string;
}

interface VehicleVideosProps {
  vehicleId: string;
  userId?: string;
}

const VehicleVideos: React.FC<VehicleVideosProps> = ({ vehicleId, userId }) => {
  const [videos, setVideos] = useState<Video[]>([]);
  const [videoSources, setVideoSources] = useState<VideoSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [showConnectMenu, setShowConnectMenu] = useState(false);

  useEffect(() => {
    loadVideos();
    loadVideoSources();
  }, [vehicleId, userId]);

  const loadVideos = async () => {
    setLoading(true);
    try {
      // TODO: Replace with actual API call
      // Query from database table that stores videos from all sources
      
      // Mock data for demo - videos from different sources
      const mockVideos: Video[] = [
        {
          id: '1',
          source: 'facebook',
          thumbnail: 'https://via.placeholder.com/320x180?text=Vehicle+Video',
          description: 'Track day video',
          created_at: new Date().toISOString(),
          url: 'https://www.facebook.com/video/1'
        },
        {
          id: '2',
          source: 'upload',
          thumbnail: 'https://via.placeholder.com/320x180?text=Uploaded+Video',
          description: 'Garage walkthrough',
          created_at: new Date().toISOString()
        }
      ];

      // Uncomment when real API is ready:
      // const { data, error } = await supabase
      //   .from('vehicle_videos')
      //   .select('*')
      //   .eq('vehicle_id', vehicleId)
      //   .order('created_at', { ascending: false });
      // if (error) throw error;
      // setVideos(data || []);

      setVideos(mockVideos);
    } catch (error) {
      console.error('Error loading videos:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadVideoSources = async () => {
    if (!userId) return;

    try {
      const { data: identities } = await supabase
        .from('external_identities')
        .select('*')
        .in('platform', ['facebook', 'instagram', 'youtube'])
        .eq('claimed_by_user_id', userId);

      const sources: VideoSource[] = [
        { platform: 'facebook', isConnected: false },
        { platform: 'instagram', isConnected: false },
        { platform: 'youtube', isConnected: false }
      ];

      identities?.forEach(identity => {
        const source = sources.find(s => s.platform === identity.platform);
        if (source) {
          source.isConnected = true;
          source.connectionId = identity.id;
        }
      });

      setVideoSources(sources);
    } catch (error) {
      console.error('Error loading video sources:', error);
    }
  };

  const handleConnectSource = async (platform: string) => {
    setShowConnectMenu(false);
    
    try {
      // Get OAuth URL from edge function
      const { data, error } = await supabase.functions.invoke(`get-${platform}-auth-url`, {
        body: { user_id: userId, vehicle_id: vehicleId }
      });

      if (error) {
        console.error(`Error invoking ${platform} auth function:`, error);
        throw error;
      }

      if (data?.auth_url) {
        window.location.href = data.auth_url;
      } else {
        throw new Error('No auth URL returned');
      }
    } catch (error: any) {
      console.error(`Error connecting ${platform}:`, error);
      const errorMessage = error?.message || 'Unknown error';
      
      // Check if function doesn't exist
      if (errorMessage.includes('404') || errorMessage.includes('not found') || error?.status === 404) {
        alert(`${platform.charAt(0).toUpperCase() + platform.slice(1)} connection is coming soon. The edge function is not yet deployed.`);
      } else {
        alert(`Failed to connect ${platform}. ${errorMessage}`);
      }
    }
  };

  const getSourceBadge = (source: string) => {
    const badges: Record<string, { label: string; color: string }> = {
      facebook: { label: 'Facebook', color: '#1877F2' },
      instagram: { label: 'Instagram', color: '#E4405F' },
      youtube: { label: 'YouTube', color: '#FF0000' },
      upload: { label: 'Uploaded', color: 'var(--text-muted)' }
    };

    return badges[source] || { label: source, color: 'var(--text-muted)' };
  };

  const availableSources = videoSources.filter(s => !s.isConnected);

  return (
    <div style={{ marginTop: '32px' }}>
      {/* Header with Add/Connect button */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '16px'
      }}>
        <h3 style={{ 
          fontSize: '16px', 
          fontWeight: 600,
          color: 'var(--text)'
        }}>
          Videos
        </h3>
        
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowConnectMenu(!showConnectMenu)}
            style={{
              padding: '8px 16px',
              background: 'var(--primary)',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 3V13M3 8H13" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            Add / Connect
          </button>

          {showConnectMenu && (
            <div style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: '8px',
              background: 'var(--surface)',
              border: '1px solid var(--border-light)',
              borderRadius: '8px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              minWidth: '200px',
              zIndex: 1000
            }}>
              {/* Upload option */}
              <button
                onClick={() => {
                  // TODO: Trigger file upload for videos
                  setShowConnectMenu(false);
                  alert('Video upload coming soon');
                }}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  textAlign: 'left',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '1px solid var(--border-light)',
                  cursor: 'pointer',
                  fontSize: '13px',
                  color: 'var(--text)'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--border-light)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                📤 Upload Video
              </button>

              {/* Connect options for unconnected sources */}
              {availableSources.map((source, index) => (
                <button
                  key={source.platform}
                  onClick={() => handleConnectSource(source.platform)}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    textAlign: 'left',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: index === availableSources.length - 1 ? 'none' : '1px solid var(--border-light)',
                    cursor: 'pointer',
                    fontSize: '13px',
                    color: 'var(--text)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--border-light)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  {source.platform === 'facebook' && (
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="#1877F2">
                      <path d="M18.5 0H1.5C0.67 0 0 0.67 0 1.5V18.5C0 19.33 0.67 20 1.5 20H10.62V12.25H8.12V9.25H10.62V7C10.62 4.42 12.04 3.17 14.38 3.17C15.5 3.17 16.58 3.33 16.58 3.33V5.83H15.37C14.17 5.83 13.88 6.5 13.88 7.17V9.25H16.5L16.08 12.25H13.88V20H18.5C19.33 20 20 19.33 20 18.5V1.5C20 0.67 19.33 0 18.5 0Z"/>
                    </svg>
                  )}
                  {source.platform === 'instagram' && (
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="#E4405F">
                      <path d="M10 1.802c2.67 0 2.987.01 4.042.059 2.71.123 3.975 1.409 4.099 4.099.048 1.054.057 1.37.057 4.04 0 2.67-.01 2.986-.059 4.04-.124 2.687-1.387 3.975-4.1 4.099-1.054.048-1.37.058-4.041.058-2.67 0-2.987-.01-4.04-.059-2.717-.124-3.977-1.416-4.1-4.1-.048-1.054-.058-1.37-.058-4.041 0-2.67.01-2.986.058-4.04.124-2.69 1.387-3.977 4.1-4.1 1.054-.048 1.37-.058 4.04-.058zm0-1.802C7.284 0 6.944.012 5.877.06 2.246.227.227 2.242.06 5.877.01 6.944 0 7.284 0 10s.012 3.056.06 4.123c.167 3.632 2.182 5.65 5.817 5.817 1.067.048 1.407.06 4.123.06s3.056-.012 4.123-.06c3.628-.167 5.65-2.182 5.816-5.817.05-1.067.061-1.407.061-4.123s-.012-3.056-.06-4.123C20.227 2.25 18.213.228 14.577.06 13.51.01 13.17 0 10.5 0h-1zm0 4.865a5.135 5.135 0 1 0 0 10.27 5.135 5.135 0 0 0 0-10.27zm0 8.468a3.333 3.333 0 1 1 0-6.666 3.333 3.333 0 0 1 0 6.666zm5.338-9.87a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z"/>
                    </svg>
                  )}
                  {source.platform === 'youtube' && (
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="#FF0000">
                      <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z"/>
                    </svg>
                  )}
                  Connect {source.platform.charAt(0).toUpperCase() + source.platform.slice(1)}
                </button>
              ))}

              {availableSources.length === 0 && (
                <div style={{
                  padding: '12px 16px',
                  fontSize: '12px',
                  color: 'var(--text-muted)',
                  textAlign: 'center'
                }}>
                  All sources connected
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading videos...
        </div>
      ) : videos.length === 0 ? (
        <div style={{ 
          padding: '48px 24px', 
          textAlign: 'center', 
          color: 'var(--text-muted)',
          border: '1px dashed var(--border-light)',
          borderRadius: '8px',
          background: 'var(--surface)'
        }}>
          <p style={{ margin: '0 0 16px 0', fontSize: '14px' }}>
            No videos yet. Click "Add / Connect" to upload videos or connect a source.
          </p>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '16px'
        }}>
          {videos.map((video) => {
            const badge = getSourceBadge(video.source);
            return (
              <div
                key={video.id}
                style={{
                  border: '1px solid var(--border-light)',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  background: 'var(--surface)'
                }}
              >
                {video.thumbnail ? (
                  <div
                    style={{
                      width: '100%',
                      paddingTop: '56.25%', // 16:9 aspect ratio
                      background: 'var(--border-light)',
                      position: 'relative',
                      cursor: video.url ? 'pointer' : 'default'
                    }}
                    onClick={() => video.url && window.open(video.url, '_blank')}
                  >
                    <img
                      src={video.thumbnail}
                      alt={video.description || 'Video thumbnail'}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover'
                      }}
                    />
                    {/* Source badge */}
                    <div style={{
                      position: 'absolute',
                      top: '8px',
                      right: '8px',
                      padding: '4px 8px',
                      background: badge.color,
                      color: 'white',
                      borderRadius: '4px',
                      fontSize: '10px',
                      fontWeight: 600
                    }}>
                      Source: {badge.label}
                    </div>
                    {/* Play button overlay */}
                    {video.url && (
                      <div style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        width: '48px',
                        height: '48px',
                        background: 'rgba(0, 0, 0, 0.6)',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer'
                      }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                          <path d="M8 5v14l11-7z"/>
                        </svg>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{
                    width: '100%',
                    paddingTop: '56.25%',
                    background: 'var(--border-light)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--text-muted)',
                    position: 'relative'
                  }}>
                    Video
                    <div style={{
                      position: 'absolute',
                      top: '8px',
                      right: '8px',
                      padding: '4px 8px',
                      background: badge.color,
                      color: 'white',
                      borderRadius: '4px',
                      fontSize: '10px',
                      fontWeight: 600
                    }}>
                      Source: {badge.label}
                    </div>
                  </div>
                )}
                {video.description && (
                  <div style={{ padding: '12px' }}>
                    <p style={{
                      fontSize: '13px',
                      color: 'var(--text)',
                      margin: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      {video.description}
                    </p>
                    {video.created_at && (
                      <p style={{
                        fontSize: '11px',
                        color: 'var(--text-muted)',
                        margin: '4px 0 0 0'
                      }}>
                        {new Date(video.created_at).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Click outside to close menu */}
      {showConnectMenu && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 999
          }}
          onClick={() => setShowConnectMenu(false)}
        />
      )}
    </div>
  );
};

export default VehicleVideos;

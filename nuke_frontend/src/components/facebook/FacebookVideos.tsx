import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface FacebookVideo {
  id: string;
  source: string;
  description?: string;
  created_time?: string;
  thumbnail?: string;
  link?: string;
}

interface FacebookVideosProps {
  vehicleId: string;
  userId?: string;
}

const FacebookVideos: React.FC<FacebookVideosProps> = ({ vehicleId, userId }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [videos, setVideos] = useState<FacebookVideo[]>([]);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    checkConnectionStatus();
    if (isConnected) {
      loadVideos();
    }
  }, [isConnected]);

  const checkConnectionStatus = async () => {
    if (!userId) return;
    
    try {
      // Check if user has Facebook connected (check external_identities or user metadata)
      const { data: identity } = await supabase
        .from('external_identities')
        .select('*')
        .eq('platform', 'facebook')
        .eq('claimed_by_user_id', userId)
        .maybeSingle();

      setIsConnected(!!identity);
    } catch (error) {
      console.error('Error checking Facebook connection:', error);
    }
  };

  const handleConnectFacebook = async () => {
    setConnecting(true);
    try {
      // Get OAuth URL from edge function
      const { data, error } = await supabase.functions.invoke('get-facebook-auth-url', {
        body: { user_id: userId, vehicle_id: vehicleId }
      });

      if (error) throw error;

      // Redirect to Facebook OAuth
      if (data?.auth_url) {
        window.location.href = data.auth_url;
      }
    } catch (error) {
      console.error('Error connecting Facebook:', error);
      alert('Failed to connect Facebook. Please try again.');
      setConnecting(false);
    }
  };

  const loadVideos = async () => {
    setLoading(true);
    try {
      // TODO: Replace with actual API call when implemented
      // For demo/review: Use mock data or call edge function
      
      // Mock data for demo
      const mockVideos: FacebookVideo[] = [
        {
          id: '1',
          source: 'facebook',
          description: 'Track day video',
          created_time: new Date().toISOString(),
          thumbnail: 'https://via.placeholder.com/320x180?text=Vehicle+Video',
          link: 'https://www.facebook.com/video/1'
        },
        {
          id: '2',
          source: 'facebook',
          description: 'Car show footage',
          created_time: new Date().toISOString(),
          thumbnail: 'https://via.placeholder.com/320x180?text=Vehicle+Video',
          link: 'https://www.facebook.com/video/2'
        }
      ];

      // Uncomment when real API is ready:
      // const { data, error } = await supabase.functions.invoke('get-facebook-videos', {
      //   body: { user_id: userId, vehicle_id: vehicleId }
      // });
      // if (error) throw error;
      // setVideos(data.videos || []);

      setVideos(mockVideos);
    } catch (error) {
      console.error('Error loading videos:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!isConnected) {
    return (
      <div style={{ 
        marginTop: '32px', 
        padding: '24px', 
        border: '1px solid var(--border-light)', 
        borderRadius: '8px',
        background: 'var(--surface)'
      }}>
        <h3 style={{ 
          fontSize: '16px', 
          fontWeight: 600, 
          marginBottom: '8px',
          color: 'var(--text)'
        }}>
          Videos from Facebook
        </h3>
        <p style={{ 
          fontSize: '14px', 
          color: 'var(--text-muted)', 
          marginBottom: '16px' 
        }}>
          Connect your Facebook account to display videos from your profile in this vehicle collection.
        </p>
        <button
          onClick={handleConnectFacebook}
          disabled={connecting || !userId}
          style={{
            padding: '10px 20px',
            background: connecting ? 'var(--text-muted)' : '#1877F2', // Facebook blue
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontSize: '14px',
            fontWeight: 600,
            cursor: connecting ? 'not-allowed' : 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          {connecting ? (
            <>Connecting...</>
          ) : (
            <>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M18.5 0H1.5C0.67 0 0 0.67 0 1.5V18.5C0 19.33 0.67 20 1.5 20H10.62V12.25H8.12V9.25H10.62V7C10.62 4.42 12.04 3.17 14.38 3.17C15.5 3.17 16.58 3.33 16.58 3.33V5.83H15.37C14.17 5.83 13.88 6.5 13.88 7.17V9.25H16.5L16.08 12.25H13.88V20H18.5C19.33 20 20 19.33 20 18.5V1.5C20 0.67 19.33 0 18.5 0Z" fill="white"/>
              </svg>
              Connect Facebook
            </>
          )}
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: '32px' }}>
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
          Videos from Facebook
        </h3>
        <div style={{ 
          fontSize: '12px', 
          color: 'var(--text-muted)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <span style={{ 
            padding: '4px 8px', 
            background: '#1877F2', 
            color: 'white', 
            borderRadius: '4px',
            fontSize: '11px',
            fontWeight: 500
          }}>
            Source: Facebook
          </span>
          <span style={{ fontSize: '12px' }}>
            {videos.length} video{videos.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading videos...
        </div>
      ) : videos.length === 0 ? (
        <div style={{ 
          padding: '24px', 
          textAlign: 'center', 
          color: 'var(--text-muted)',
          border: '1px dashed var(--border-light)',
          borderRadius: '8px'
        }}>
          No videos found. Videos you upload to Facebook will appear here.
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '16px'
        }}>
          {videos.map((video) => (
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
                    cursor: 'pointer'
                  }}
                  onClick={() => video.link && window.open(video.link, '_blank')}
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
                  {/* Play button overlay */}
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
                </div>
              ) : (
                <div style={{
                  width: '100%',
                  paddingTop: '56.25%',
                  background: 'var(--border-light)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-muted)'
                }}>
                  Video
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
                  {video.created_time && (
                    <p style={{
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                      margin: '4px 0 0 0'
                    }}>
                      {new Date(video.created_time).toLocaleDateString()}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default FacebookVideos;

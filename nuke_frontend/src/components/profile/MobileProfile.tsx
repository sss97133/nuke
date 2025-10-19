import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import RapidCameraCapture from '../mobile/RapidCameraCapture';
import '../../design-system.css';

interface MobileProfileProps {
  userId: string;
  isCurrentUser: boolean;
}

export const MobileProfile: React.FC<MobileProfileProps> = ({ userId, isCurrentUser }) => {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<any>(null);
  const [stats, setStats] = useState({
    totalVehicles: 0,
    totalPhotos: 0,
    unassignedPhotos: 0,
    recentActivity: 0
  });
  const [recentVehicles, setRecentVehicles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProfile();
    loadStats();
    loadRecentVehicles();
  }, [userId]);

  const loadProfile = async () => {
    try {
      const { data } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', userId)
        .single();
      
      setProfile(data);
    } catch (error) {
      console.error('Error loading profile:', error);
    }
  };

  const loadStats = async () => {
    try {
      // Get vehicle count
      const { count: vehicleCount } = await supabase
        .from('vehicles')
        .select('*', { count: 'exact', head: true })
        .eq('owner_id', userId);

      // Get photo stats
      const { data: photoStats } = await supabase
        .from('user_photo_statistics')
        .select('*')
        .eq('user_id', userId)
        .single();

      // Get recent activity count
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const { count: activityCount } = await supabase
        .from('timeline_events')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('event_date', thirtyDaysAgo.toISOString());

      setStats({
        totalVehicles: vehicleCount || 0,
        totalPhotos: photoStats?.total_photos || 0,
        unassignedPhotos: photoStats?.unassigned_photos || 0,
        recentActivity: activityCount || 0
      });
    } catch (error) {
      console.error('Error loading stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadRecentVehicles = async () => {
    try {
      const { data } = await supabase
        .from('vehicles')
        .select('id, year, make, model, primary_image_url')
        .eq('owner_id', userId)
        .order('created_at', { ascending: false })
        .limit(6);
      
      setRecentVehicles(data || []);
    } catch (error) {
      console.error('Error loading recent vehicles:', error);
    }
  };

  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh' 
      }}>
        <div className="progress-bar">
          <div className="progress-bar-filled" style={{ width: '50%' }}></div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ 
      minHeight: '100vh',
      background: '#f0f0f0'
    }}>
      {/* Header */}
      <div style={{
        background: '#000080',
        color: 'white',
        padding: '16px',
        position: 'sticky',
        top: 0,
        zIndex: 100
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <div style={{
            width: '60px',
            height: '60px',
            borderRadius: '50%',
            background: '#c0c0c0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '24px'
          }}>
            {profile?.avatar_url ? (
              <img 
                src={profile.avatar_url} 
                alt=""
                style={{ 
                  width: '100%', 
                  height: '100%', 
                  borderRadius: '50%',
                  objectFit: 'cover' 
                }}
              />
            ) : (
              '👤'
            )}
          </div>
          
          <div style={{ flex: 1 }}>
            <h1 style={{ 
              margin: 0, 
              fontSize: '18px',
              fontFamily: '"MS Sans Serif", sans-serif'
            }}>
              {profile?.display_name || 'User Profile'}
            </h1>
            <p style={{ 
              margin: '4px 0 0 0', 
              fontSize: '12px',
              opacity: 0.8
            }}>
              {profile?.profession || 'Car Enthusiast'}
            </p>
          </div>

          {isCurrentUser && (
            <button
              onClick={() => navigate('/profile/edit')}
              style={{
                background: '#c0c0c0',
                border: '2px outset #ffffff',
                padding: '4px 8px',
                fontSize: '12px',
                cursor: 'pointer'
              }}
            >
              Edit
            </button>
          )}
        </div>
      </div>

      {/* Quick Stats */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: '8px',
        padding: '8px'
      }}>
        <div 
          className="window"
          onClick={() => navigate('/vehicles')}
          style={{ cursor: 'pointer' }}
        >
          <div className="window-body" style={{ textAlign: 'center', padding: '12px' }}>
            <div style={{ fontSize: '24px', fontWeight: 'bold' }}>
              {stats.totalVehicles}
            </div>
            <div style={{ fontSize: '11px', marginTop: '4px' }}>Vehicles</div>
          </div>
        </div>

        <div 
          className="window"
          onClick={() => navigate('/my-album')}
          style={{ cursor: 'pointer' }}
        >
          <div className="window-body" style={{ textAlign: 'center', padding: '12px' }}>
            <div style={{ fontSize: '24px', fontWeight: 'bold' }}>
              {stats.totalPhotos}
            </div>
            <div style={{ fontSize: '11px', marginTop: '4px' }}>Photos</div>
            {stats.unassignedPhotos > 0 && (
              <div style={{ 
                fontSize: '10px', 
                color: '#ff6600',
                marginTop: '2px'
              }}>
                {stats.unassignedPhotos} to organize
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div style={{ padding: '8px' }}>
        <div className="window">
          <div className="title-bar">
            <div className="title-bar-text">Quick Actions</div>
          </div>
          <div className="window-body" style={{ padding: '8px' }}>
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '8px'
            }}>
              <button 
                onClick={() => navigate('/add-vehicle')}
                style={{ 
                  padding: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px'
                }}
              >
                <span>➕</span>
                <span>Add Vehicle</span>
              </button>
              
              <button 
                onClick={() => navigate('/my-album')}
                style={{ 
                  padding: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px'
                }}
              >
                <span>📚</span>
                <span>Photo Album</span>
                {stats.unassignedPhotos > 0 && (
                  <span style={{
                    background: '#ff0000',
                    color: 'white',
                    borderRadius: '10px',
                    padding: '2px 6px',
                    fontSize: '10px',
                    marginLeft: 'auto'
                  }}>
                    {stats.unassignedPhotos}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Vehicles */}
      {recentVehicles.length > 0 && (
        <div style={{ padding: '8px' }}>
          <div className="window">
            <div className="title-bar">
              <div className="title-bar-text">Recent Vehicles</div>
              <div className="title-bar-controls">
                <button 
                  aria-label="View All"
                  onClick={() => navigate('/vehicles')}
                  style={{ marginRight: '2px' }}
                >
                  →
                </button>
              </div>
            </div>
            <div className="window-body" style={{ padding: '8px' }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '8px'
              }}>
                {recentVehicles.map(vehicle => (
                  <div
                    key={vehicle.id}
                    onClick={() => navigate(`/vehicle/${vehicle.id}`)}
                    style={{
                      cursor: 'pointer',
                      border: '2px solid #c0c0c0',
                      padding: '4px',
                      background: 'white'
                    }}
                  >
                    {vehicle.primary_image_url ? (
                      <img 
                        src={vehicle.primary_image_url}
                        alt=""
                        style={{
                          width: '100%',
                          height: '80px',
                          objectFit: 'cover'
                        }}
                      />
                    ) : (
                      <div style={{
                        width: '100%',
                        height: '80px',
                        background: '#e0e0e0',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '24px'
                      }}>
                        🚗
                      </div>
                    )}
                    <div style={{
                      fontSize: '11px',
                      marginTop: '4px',
                      textAlign: 'center',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      {vehicle.year} {vehicle.make} {vehicle.model}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Photo Capture Tips */}
      {isCurrentUser && (
        <div style={{ padding: '8px' }}>
          <div className="window">
            <div className="title-bar">
              <div className="title-bar-text">📸 Photo Tips</div>
            </div>
            <div className="window-body" style={{ padding: '12px' }}>
              <ul style={{ 
                margin: 0, 
                paddingLeft: '20px',
                fontSize: '12px',
                lineHeight: 1.6
              }}>
                <li>Use the camera button to quickly capture photos</li>
                <li>Photos are automatically saved to your album</li>
                <li>AI will suggest which vehicle each photo belongs to</li>
                <li>You can organize photos later from your album</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Floating Camera Button */}
      {isCurrentUser && <RapidCameraCapture />}
    </div>
  );
};

export default MobileProfile;
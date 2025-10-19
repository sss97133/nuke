// Profile Stats Component - Display user statistics and metrics
import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { ProfileStats as ProfileStatsType } from '../../types/profile';

interface ProfileStatsProps {
  stats: ProfileStatsType | null;
  isOwnProfile: boolean;
}

const ProfileStats: React.FC<ProfileStatsProps> = ({ stats, isOwnProfile }) => {
  const navigate = useNavigate();

  if (!stats) {
    return (
      <div className="card">
        <div className="card-body">
          <h3 className="text font-bold">Statistics</h3>
          <div style={{ textAlign: 'center', padding: '24px' }}>
            <p className="text-small text-muted">No statistics available yet</p>
          </div>
        </div>
      </div>
    );
  }

  const statItems = [
    {
      label: 'Vehicles',
      value: stats.total_vehicles,
      icon: '🚗',
      color: '#3b82f6'
    },
    {
      label: 'Images',
      value: stats.total_images,
      icon: '📸',
      color: '#10b981'
    },
    {
      label: 'Contributions',
      value: stats.total_contributions,
      icon: '🤝',
      color: '#f59e0b'
    },
    {
      label: 'Timeline Events',
      value: stats.total_timeline_events,
      icon: '📝',
      color: '#8b5cf6'
    },
    {
      label: 'Verifications',
      value: stats.total_verifications,
      icon: '✅',
      color: '#06b6d4'
    },
    {
      label: 'Total Points',
      value: stats.total_points,
      icon: '⭐',
      color: '#f97316'
    }
  ];

  // Only show social stats for own profile or if they exist
  const socialStats = [];
  if (isOwnProfile || stats.profile_views > 0) {
    socialStats.push({
      label: 'Profile Views',
      value: stats.profile_views,
      icon: '👁️',
      color: '#64748b'
    });
  }
  if (isOwnProfile || stats.followers_count > 0) {
    socialStats.push({
      label: 'Followers',
      value: stats.followers_count,
      icon: '👥',
      color: '#ec4899'
    });
  }

  const allStats = [...statItems, ...socialStats];

  return (
    <div className="card">
      <div className="card-body">
        <h3 className="text font-bold">Statistics</h3>
        
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', 
          gap: '12px',
          marginTop: '16px'
        }}>
          {allStats.map(stat => (
            <div 
              key={stat.label}
              style={{
                textAlign: 'center',
                padding: '16px 8px',
                backgroundColor: '#fafafa',
                borderRadius: '8px',
                border: '1px solid #e5e5e5'
              }}
            >
              <div style={{ fontSize: '24px', marginBottom: '4px' }}>
                {stat.icon}
              </div>
              <div 
                className="text font-bold" 
                style={{ color: stat.color, marginBottom: '2px' }}
              >
                {stat.value.toLocaleString()}
              </div>
              <div className="text-small text-muted">
                {stat.label}
              </div>
            </div>
          ))}
        </div>

        {/* Reputation Score */}
        {stats.reputation_score > 0 && (
          <div style={{ 
            marginTop: '16px', 
            padding: '12px', 
            backgroundColor: '#f0f9ff', 
            borderRadius: '8px',
            textAlign: 'center'
          }}>
            <div className="text-small font-bold" style={{ color: '#0369a1', marginBottom: '4px' }}>
              Reputation Score
            </div>
            <div className="text font-bold" style={{ color: '#0369a1' }}>
              {stats.reputation_score}
            </div>
          </div>
        )}

        {/* Last Activity */}
        {stats.last_activity && (
          <div style={{ marginTop: '12px', textAlign: 'center' }}>
            <div className="text-small text-muted">
              Last active: {new Date(stats.last_activity).toLocaleDateString()}
            </div>
          </div>
        )}

        {/* Photo Album Link - Only for own profile */}
        {isOwnProfile && (
          <div style={{ marginTop: '16px', textAlign: 'center' }}>
            <button
              onClick={() => navigate('/photos')}
              className="button button-primary"
              style={{
                width: '100%',
                padding: '10px',
                fontSize: '10pt',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
            >
              <span>📸</span>
              <span>View Photo Album</span>
              {stats.total_images > 0 && (
                <span style={{
                  background: '#ffffff',
                  color: '#000080',
                  padding: '2px 8px',
                  borderRadius: '10px',
                  fontSize: '8pt',
                  fontWeight: 'bold'
                }}>
                  {stats.total_images}
                </span>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProfileStats;

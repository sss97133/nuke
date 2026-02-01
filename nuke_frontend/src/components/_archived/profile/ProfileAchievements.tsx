// Profile Achievements Component - Display user achievements and badges
import React from 'react';
import type { ProfileAchievement } from '../../types/profile';

interface ProfileAchievementsProps {
  achievements: ProfileAchievement[];
  totalPoints: number;
}

const ProfileAchievements: React.FC<ProfileAchievementsProps> = ({ achievements, totalPoints }) => {
  const achievementIcons: Record<string, string> = {
    'first_vehicle': '🚗',
    'profile_complete': '✅',
    'first_image': '📸',
    'contributor': '🤝',
    'vehicle_collector': '🏆',
    'image_enthusiast': 'IMG',
    'community_member': '👥',
    'verified_user': '✓'
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  if (achievements.length === 0) {
    return (
      <div className="card">
        <div className="card-body">
          <h3 className="text font-bold">Achievements</h3>
          <div style={{ textAlign: 'center', padding: '24px' }}>
            <div style={{ fontSize: '48px', marginBottom: '8px' }}>🏆</div>
            <p className="text-small text-muted">No achievements yet</p>
            <p className="text-small text-muted">Complete your profile and add vehicles to earn badges!</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-body">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 className="text font-bold">Achievements</h3>
          <div className="text-small font-bold" style={{ color: '#3b82f6' }}>
            {totalPoints} points
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
          {achievements.map(achievement => (
            <div 
              key={achievement.id}
              style={{
                padding: '12px',
                backgroundColor: '#f8fafc',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
                transition: 'transform 0.2s ease, box-shadow 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <div style={{ fontSize: '24px' }}>
                  {achievementIcons[achievement.achievement_type] || '🏅'}
                </div>
                <div>
                  <div className="text-small font-bold">{achievement.achievement_title}</div>
                  <div className="text-small" style={{ color: '#3b82f6' }}>
                    +{achievement.points_awarded} points
                  </div>
                </div>
              </div>
              
              {achievement.achievement_description && (
                <p className="text-small text-muted" style={{ marginBottom: '8px' }}>
                  {achievement.achievement_description}
                </p>
              )}
              
              <div className="text-small text-muted">
                Earned {formatDate(achievement.earned_at)}
              </div>
            </div>
          ))}
        </div>

        {/* Achievement Progress Hints */}
        <div style={{ marginTop: '16px', padding: '12px', backgroundColor: '#f0f9ff', borderRadius: '4px' }}>
          <div className="text-small font-bold" style={{ color: '#0369a1', marginBottom: '4px' }}>
            💡 Earn More Achievements
          </div>
          <div className="text-small" style={{ color: '#0369a1' }}>
            Add more vehicles (Vehicle Collector), upload images (Image Enthusiast), or complete verification (Verified User)
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfileAchievements;

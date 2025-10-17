import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import UserRatingBadge from './UserRatingBadge';
import type { UserRating, UserContribution } from '../feed/types';
import '../../design-system.css';

interface UserProfileCardProps {
  userId: string;
  userName?: string;
  userAvatar?: string;
  expanded?: boolean;
}

interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  rarity: string;
  earned_at: string;
}

const UserProfileCard = ({ userId, userName, userAvatar, expanded = false }: UserProfileCardProps) => {
  const [userRating, setUserRating] = useState<UserRating | null>(null);
  const [contributions, setContributions] = useState<UserContribution[]>([]);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUserData();
  }, [userId]);

  const fetchUserData = async () => {
    try {
      // Fetch user rating
      const { data: ratingData } = await supabase
        .from('user_ratings')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (ratingData) {
        setUserRating(ratingData);
      }

      // Fetch recent contributions
      const { data: contributionsData } = await supabase
        .from('user_contributions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(5);

      if (contributionsData) {
        setContributions(contributionsData);
      }

      // Fetch earned badges
      const { data: badgesData } = await supabase
        .from('user_badges')
        .select(`
          *,
          badges(
            id,
            name,
            description,
            icon,
            category,
            rarity
          )
        `)
        .eq('user_id', userId)
        .eq('is_displayed', true)
        .order('display_order');

      if (badgesData) {
        const userBadges = badgesData.map(ub => ({
          ...(ub.badges as any),
          earned_at: ub.earned_at
        }));
        setBadges(userBadges);
      }

    } catch (error) {
      console.error('Error fetching user data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getRarityColor = (rarity: string) => {
    switch (rarity) {
      case 'legendary': return '#fbbf24';
      case 'epic': return '#a855f7';
      case 'rare': return '#3b82f6';
      case 'uncommon': return '#10b981';
      default: return '#6b7280';
    }
  };

  const getContributionTypeIcon = (type: string) => {
    switch (type) {
      case 'vehicle_add': return 'VEHICLE';
      case 'image_upload': return 'IMAGE';
      case 'timeline_event': return 'EVENT';
      case 'verification': return 'VERIFIED';
      case 'review': return 'REVIEW';
      case 'data_correction': return 'CORRECTION';
      case 'shop_create': return 'SHOP';
      default: return 'CONTRIBUTION';
    }
  };

  if (loading) {
    return (
      <div style={{
        background: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: '12px',
        padding: '16px',
        textAlign: 'center'
      }}>
        <div className="spinner"></div>
        <p className="text text-muted">Loading profile...</p>
      </div>
    );
  }

  if (!expanded) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }}>
        {userAvatar ? (
          <img
            src={userAvatar}
            alt={userName}
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%'
            }}
          />
        ) : (
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            background: '#e5e7eb',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '14px'
          }}>
            USER
          </div>
        )}
        <div style={{ flex: 1 }}>
          <div className="text text-bold" style={{ fontSize: '14px' }}>
            {userName || 'Anonymous User'}
          </div>
          <UserRatingBadge userId={userId} size="small" />
        </div>
      </div>
    );
  }

  return (
    <div style={{
      background: 'white',
      border: '1px solid #e5e7eb',
      borderRadius: '12px',
      overflow: 'hidden'
    }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        padding: '20px',
        color: 'white',
        textAlign: 'center'
      }}>
        {userAvatar ? (
          <img
            src={userAvatar}
            alt={userName}
            style={{
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              border: '4px solid white',
              marginBottom: '12px'
            }}
          />
        ) : (
          <div style={{
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            background: 'rgba(255, 255, 255, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '32px',
            margin: '0 auto 12px',
            border: '4px solid white'
          }}>
            USER
          </div>
        )}

        <h3 className="heading-3" style={{ margin: '0 0 8px 0', color: 'white' }}>
          {userName || 'Anonymous User'}
        </h3>

        <UserRatingBadge userId={userId} size="medium" showFullInfo />
      </div>

      {/* Stats */}
      {userRating && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '16px',
          padding: '20px',
          borderBottom: '1px solid #f3f4f6'
        }}>
          <div style={{ textAlign: 'center' }}>
            <div className="text text-bold" style={{ fontSize: '18px', color: '#3b82f6' }}>
              {userRating.overall_rating.toFixed(1)}
            </div>
            <div className="text text-muted" style={{ fontSize: '12px' }}>Rating</div>
          </div>

          <div style={{ textAlign: 'center' }}>
            <div className="text text-bold" style={{ fontSize: '18px', color: '#10b981' }}>
              {userRating.reputation_points}
            </div>
            <div className="text text-muted" style={{ fontSize: '12px' }}>Points</div>
          </div>

          <div style={{ textAlign: 'center' }}>
            <div className="text text-bold" style={{ fontSize: '18px', color: '#f59e0b' }}>
              {userRating.contribution_score}
            </div>
            <div className="text text-muted" style={{ fontSize: '12px' }}>Contributions</div>
          </div>

          <div style={{ textAlign: 'center' }}>
            <div className="text text-bold" style={{ fontSize: '18px', color: '#8b5cf6' }}>
              {badges.length}
            </div>
            <div className="text text-muted" style={{ fontSize: '12px' }}>Badges</div>
          </div>
        </div>
      )}

      {/* Badges */}
      {badges.length > 0 && (
        <div style={{ padding: '20px', borderBottom: '1px solid #f3f4f6' }}>
          <h4 className="heading-4" style={{ margin: '0 0 12px 0' }}>Achievements</h4>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '8px'
          }}>
            {badges.slice(0, 6).map(badge => (
              <div
                key={badge.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px',
                  background: '#f8fafc',
                  border: `2px solid ${getRarityColor(badge.rarity)}`,
                  borderRadius: '8px'
                }}
              >
                <span style={{ fontSize: '18px' }}>{badge.icon}</span>
                <div style={{ flex: 1 }}>
                  <div className="text text-bold" style={{ fontSize: '12px' }}>
                    {badge.name}
                  </div>
                  <div className="text text-muted" style={{ fontSize: '10px' }}>
                    {badge.description}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {badges.length > 6 && (
            <div style={{ textAlign: 'center', marginTop: '8px' }}>
              <span className="text text-muted" style={{ fontSize: '12px' }}>
                +{badges.length - 6} more badges
              </span>
            </div>
          )}
        </div>
      )}

      {/* Recent Contributions */}
      {contributions.length > 0 && (
        <div style={{ padding: '20px' }}>
          <h4 className="heading-4" style={{ margin: '0 0 12px 0' }}>Recent Activity</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {contributions.map(contribution => (
              <div
                key={contribution.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px',
                  background: '#f8fafc',
                  borderRadius: '6px'
                }}
              >
                <span style={{ fontSize: '16px' }}>
                  {getContributionTypeIcon(contribution.contribution_type)}
                </span>
                <div style={{ flex: 1 }}>
                  <div className="text" style={{ fontSize: '12px' }}>
                    {contribution.contribution_type.replace('_', ' ')}
                  </div>
                  <div className="text text-muted" style={{ fontSize: '10px' }}>
                    Quality: {contribution.quality_score}/100
                    {contribution.verified && ' VERIFIED'}
                  </div>
                </div>
                <div className="text text-muted" style={{ fontSize: '10px' }}>
                  {new Date(contribution.created_at).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default UserProfileCard;
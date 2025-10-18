import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import type { UserRating } from '../feed/types';
import '../../design-system.css';

interface UserRatingBadgeProps {
  userId: string;
  size?: 'small' | 'medium' | 'large';
  showFullInfo?: boolean;
}

const UserRatingBadge = ({ userId, size = 'medium', showFullInfo = false }: UserRatingBadgeProps) => {
  const [userRating, setUserRating] = useState<UserRating | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUserRating();
  }, [userId]);

  const fetchUserRating = async () => {
    try {
      const { data, error } = await supabase
        .from('user_ratings')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (!error && data) {
        setUserRating(data);
      }
    } catch (error) {
      console.error('Error fetching user rating:', error);
    } finally {
      setLoading(false);
    }
  };

  const getVerificationIcon = (level: string) => {
    switch (level) {
      case 'expert_verified': return '🏆';
      case 'business_verified': return '✅';
      case 'phone_verified': return '📱';
      case 'email_verified': return '📧';
      default: return '👤';
    }
  };

  const getVerificationColor = (level: string) => {
    switch (level) {
      case 'expert_verified': return '#f59e0b';
      case 'business_verified': return '#10b981';
      case 'phone_verified': return '#3b82f6';
      case 'email_verified': return '#6b7280';
      default: return '#9ca3af';
    }
  };

  const getTrustLevelColor = (level: number) => {
    if (level >= 8) return '#f59e0b';
    if (level >= 5) return '#10b981';
    if (level >= 3) return '#3b82f6';
    return '#6b7280';
  };

  const getSizeStyles = () => {
    switch (size) {
      case 'small':
        return { fontSize: '10px', padding: '2px 6px', height: '20px' };
      case 'large':
        return { fontSize: '14px', padding: '6px 12px', height: '32px' };
      default:
        return { fontSize: '12px', padding: '4px 8px', height: '24px' };
    }
  };

  if (loading) {
    return (
      <div style={{
        ...getSizeStyles(),
        background: '#f3f4f6',
        borderRadius: '12px',
        display: 'inline-flex',
        alignItems: 'center',
        color: '#9ca3af'
      }}>
        Loading...
      </div>
    );
  }

  if (!userRating) {
    return (
      <div style={{
        ...getSizeStyles(),
        background: '#f3f4f6',
        borderRadius: '12px',
        display: 'inline-flex',
        alignItems: 'center',
        color: '#9ca3af'
      }}>
        👤 New User
      </div>
    );
  }

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
      {/* Verification Badge */}
      <div style={{
        ...getSizeStyles(),
        background: getVerificationColor(userRating.verification_level),
        color: 'white',
        borderRadius: '12px',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        fontWeight: 'bold'
      }}>
        <span>{getVerificationIcon(userRating.verification_level)}</span>
        {showFullInfo && <span>{userRating.verification_level.replace('_', ' ')}</span>}
      </div>

      {/* Trust Level Badge */}
      <div style={{
        ...getSizeStyles(),
        background: getTrustLevelColor(userRating.trust_level),
        color: 'white',
        borderRadius: '12px',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        fontWeight: 'bold'
      }}>
        <span>⭐</span>
        <span>{userRating.trust_level}</span>
      </div>

      {/* Reputation Points */}
      {showFullInfo && userRating.reputation_points > 0 && (
        <div style={{
          ...getSizeStyles(),
          background: '#8b5cf6',
          color: 'white',
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          fontWeight: 'bold'
        }}>
          <span>🏅</span>
          <span>{userRating.reputation_points}</span>
        </div>
      )}

      {/* Contribution Score */}
      {showFullInfo && userRating.contribution_score > 0 && (
        <div style={{
          ...getSizeStyles(),
          background: '#f59e0b',
          color: 'white',
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          fontWeight: 'bold'
        }}>
          <span>📈</span>
          <span>{userRating.contribution_score}</span>
        </div>
      )}

      {/* Top Badges */}
      {showFullInfo && userRating.badges && userRating.badges.length > 0 && (
        <div style={{
          ...getSizeStyles(),
          background: '#ef4444',
          color: 'white',
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          fontWeight: 'bold'
        }}>
          <span>🎖️</span>
          <span>{userRating.badges.length}</span>
        </div>
      )}
    </div>
  );
};

export default UserRatingBadge;
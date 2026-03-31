import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import type { UserRating } from '../feed/types';
import '../../styles/unified-design-system.css';

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
      case 'expert_verified': return 'var(--warning)';
      case 'business_verified': return 'var(--success)';
      case 'phone_verified': return 'var(--info)';
      case 'email_verified': return 'var(--text-secondary)';
      default: return 'var(--text-disabled)';
    }
  };

  const getTrustLevelColor = (level: number) => {
    if (level >= 8) return 'var(--warning)';
    if (level >= 5) return 'var(--success)';
    if (level >= 3) return 'var(--info)';
    return 'var(--text-secondary)';
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

  if (loading) return null;

  if (!userRating) {
    return (
      <div style={{
        ...getSizeStyles(),
        background: 'var(--bg)', display: 'inline-flex',
        alignItems: 'center',
        color: 'var(--text-disabled)'
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
        color: 'var(--bg)', display: 'flex',
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
        color: 'var(--bg)', display: 'flex',
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
          color: 'var(--bg)', display: 'flex',
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
          background: 'var(--warning)',
          color: 'var(--bg)', display: 'flex',
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
          background: 'var(--error)',
          color: 'var(--bg)', display: 'flex',
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
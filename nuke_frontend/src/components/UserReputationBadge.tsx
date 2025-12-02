/**
 * User Reputation Badge
 * Displays user's contribution tier and stats
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface UserReputationBadgeProps {
  userId: string;
  showDetails?: boolean;
  inline?: boolean;
}

interface ContributionScore {
  user_id: string;
  total_contributions: number;
  total_points: number;
  avg_quality_score: number;
  accuracy_rate: number;
  reputation_tier: 'novice' | 'contributor' | 'trusted' | 'expert' | 'authority';
  verified_contributions: number;
  disputed_contributions: number;
}

const UserReputationBadge: React.FC<UserReputationBadgeProps> = ({ 
  userId, 
  showDetails = false,
  inline = false 
}) => {
  const [score, setScore] = useState<ContributionScore | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    loadScore();
  }, [userId]);

  const loadScore = async () => {
    try {
      const { data, error } = await supabase
        .from('user_contribution_scores')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error && error.code !== 'PGRST116') { // Ignore "not found" errors
        console.error('Error loading reputation:', error);
      }

      setScore(data || null);
    } catch (err) {
      console.error('Error loading reputation:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return null;
  }

  if (!score || score.total_contributions === 0) {
    return null;
  }

  const tierConfig = {
    novice: { label: 'Novice', color: '#9ca3af', icon: '🌱' },
    contributor: { label: 'Contributor', color: '#3b82f6', icon: '⭐' },
    trusted: { label: 'Trusted', color: '#8b5cf6', icon: '💎' },
    expert: { label: 'Expert', color: '#f59e0b', icon: '🏆' },
    authority: { label: 'Authority', color: '#ef4444', icon: '👑' }
  };

  const config = tierConfig[score.reputation_tier];

  if (inline) {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          padding: '2px 6px',
          background: 'var(--white)',
          border: `2px solid ${config.color}`,
          color: config.color,
          fontSize: '11px',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          transition: '0.12s',
          cursor: 'pointer'
        }}
        onClick={() => setExpanded(!expanded)}
        title={`${score.total_points} points • ${score.total_contributions} contributions • ${Math.round(score.accuracy_rate * 100)}% accuracy`}
      >
        <span style={{ fontSize: '12px' }}>{config.icon}</span>
        {config.label}
      </span>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '12px',
        background: 'var(--white)',
        border: `2px solid ${config.color}`,
        transition: '0.12s'
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: showDetails ? 'pointer' : 'default'
        }}
        onClick={() => showDetails && setExpanded(!expanded)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '20px' }}>{config.icon}</span>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: config.color }}>
              {config.label}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--gray-500)' }}>
              {score.total_points} points
            </div>
          </div>
        </div>
        
        {showDetails && (
          <div style={{ fontSize: '18px', color: 'var(--gray-400)' }}>
            {expanded ? '−' : '+'}
          </div>
        )}
      </div>

      {/* Details (expandable) */}
      {showDetails && expanded && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            paddingTop: '8px',
            borderTop: '2px solid var(--border)',
            fontSize: '12px'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--gray-600)' }}>Contributions:</span>
            <span style={{ fontWeight: 600 }}>{score.total_contributions}</span>
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--gray-600)' }}>Verified:</span>
            <span style={{ fontWeight: 600, color: '#10b981' }}>
              {score.verified_contributions}
            </span>
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--gray-600)' }}>Accuracy:</span>
            <span style={{ fontWeight: 600 }}>
              {Math.round(score.accuracy_rate * 100)}%
            </span>
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--gray-600)' }}>Quality:</span>
            <span style={{ fontWeight: 600 }}>
              {Math.round(score.avg_quality_score * 100)}%
            </span>
          </div>

          {score.disputed_contributions > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--gray-600)' }}>Disputed:</span>
              <span style={{ fontWeight: 600, color: '#ef4444' }}>
                {score.disputed_contributions}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default UserReputationBadge;


import React from 'react';
import { Eye, Users, MessageCircle, Activity, TrendingUp } from 'lucide-react';

interface VehicleStatsProps {
  viewCount: number;
  presenceCount: number;
  recentCommentCount: number;
  liveSession?: {
    id: string;
    platform: string;
    stream_url: string;
    title: string;
    stream_provider?: string | null;
  } | null;
  totalComments?: number;
  totalImages?: number;
  totalEvents?: number;
}

/**
 * Live statistics display component for vehicle profiles
 * Shows real-time engagement metrics
 */
const VehicleStats: React.FC<VehicleStatsProps> = ({
  viewCount,
  presenceCount,
  recentCommentCount,
  liveSession,
  totalComments = 0,
  totalImages = 0,
  totalEvents = 0
}) => {
  return (
    <div className="vehicle-stats-bar" style={{
      background: 'var(--surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius)',
      padding: '12px 16px',
      marginBottom: '16px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '16px'
      }}>
        {/* Left: Live Engagement Stats */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '20px'
        }}>
          {/* Views */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}>
            <Eye size={16} style={{ color: 'var(--color-text-muted)' }} />
            <span style={{ fontSize: '14px', color: 'var(--color-text)' }}>
              <strong>{viewCount.toLocaleString()}</strong> views
            </span>
          </div>

          {/* Active Users */}
          {presenceCount > 0 && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <Users size={16} style={{ color: '#10b981' }} />
              <span style={{ fontSize: '14px', color: 'var(--color-text)' }}>
                <strong>{presenceCount}</strong> online
              </span>
            </div>
          )}

          {/* Recent Comments */}
          {recentCommentCount > 0 && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <MessageCircle size={16} style={{ color: '#3b82f6' }} />
              <span style={{ fontSize: '14px', color: 'var(--color-text)' }}>
                <strong>{recentCommentCount}</strong> new comments
              </span>
            </div>
          )}

          {/* Live Stream */}
          {liveSession && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 8px',
              background: '#ef4444',
              borderRadius: '4px'
            }}>
              <Activity size={16} style={{ color: 'white' }} />
              <span style={{ fontSize: '14px', color: 'white', fontWeight: 600 }}>
                LIVE
              </span>
              {liveSession.title && (
                <span style={{ fontSize: '14px', color: 'white' }}>
                  {liveSession.title}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Right: Content Stats */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          fontSize: '13px',
          color: 'var(--color-text-muted)'
        }}>
          {totalImages > 0 && (
            <span>{totalImages} images</span>
          )}
          {totalEvents > 0 && (
            <span>{totalEvents} events</span>
          )}
          {totalComments > 0 && (
            <span>{totalComments} comments</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default VehicleStats;

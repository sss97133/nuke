/**
 * Comprehensive Profile Stats Component
 * BaT-style profile statistics display
 */

import React from 'react';
import { Link } from 'react-router-dom';

interface ProfileStatsProps {
  stats: {
    total_listings: number;
    total_bids: number;
    total_comments: number;
    total_auction_wins?: number;
    total_success_stories?: number;
    member_since: string | null;
  };
  profileType: 'user' | 'organization';
  profileId: string;
  location?: string | null;
}

export const ComprehensiveProfileStats: React.FC<ProfileStatsProps> = ({
  stats,
  profileType,
  profileId,
  location,
}) => {
  const formatDate = (dateString: string | null) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
    return num.toLocaleString();
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-3)',
      padding: 'var(--space-4)',
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: '4px',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 'var(--space-2)',
      }}>
        <div>
          <h2 style={{ fontSize: '10pt', fontWeight: 'bold', margin: 0 }}>
            {profileType === 'user' ? 'Member' : 'Organization'} Profile
          </h2>
          {stats.member_since && (
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '4px' }}>
              Member since {formatDate(stats.member_since)}
            </div>
          )}
        </div>
        {location && (
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', textAlign: 'right' }}>
            <div style={{ fontWeight: 'bold' }}>Location</div>
            <div>{location}</div>
          </div>
        )}
      </div>

      {/* Stats Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
        gap: 'var(--space-3)',
        marginTop: 'var(--space-2)',
      }}>
        <StatCard
          label="Listings"
          value={formatNumber(stats.total_listings)}
          link={`/${profileType === 'user' ? 'profile' : 'organization'}/${profileId}?tab=listings`}
        />
        <StatCard
          label="Bids"
          value={formatNumber(stats.total_bids)}
          link={`/${profileType === 'user' ? 'profile' : 'organization'}/${profileId}?tab=bids`}
        />
        <StatCard
          label="Comments"
          value={formatNumber(stats.total_comments)}
          link={`/${profileType === 'user' ? 'profile' : 'organization'}/${profileId}?tab=comments`}
        />
        {stats.total_auction_wins !== undefined && (
          <StatCard
            label="Auction Wins"
            value={formatNumber(stats.total_auction_wins)}
            link={`/${profileType === 'user' ? 'profile' : 'organization'}/${profileId}?tab=wins`}
          />
        )}
        {stats.total_success_stories !== undefined && (
          <StatCard
            label="Success Stories"
            value={formatNumber(stats.total_success_stories)}
            link={`/${profileType === 'user' ? 'profile' : 'organization'}/${profileId}?tab=stories`}
          />
        )}
      </div>
    </div>
  );
};

const StatCard: React.FC<{ label: string; value: string; link?: string }> = ({ label, value, link }) => {
  const content = (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: 'var(--space-3)',
      background: 'var(--surface-hover)',
      border: '1px solid var(--border)',
      borderRadius: '4px',
      cursor: link ? 'pointer' : 'default',
      transition: 'all 0.12s ease',
    }}
    onMouseEnter={(e) => {
      if (link) {
        e.currentTarget.style.background = 'var(--surface-hover)';
        e.currentTarget.style.borderColor = 'var(--border-hover)';
      }
    }}
    onMouseLeave={(e) => {
      if (link) {
        e.currentTarget.style.background = 'var(--surface-hover)';
        e.currentTarget.style.borderColor = 'var(--border)';
      }
    }}
    >
      <div style={{
        fontSize: '14pt',
        fontWeight: 'bold',
        color: 'var(--text)',
        marginBottom: '4px',
      }}>
        {value}
      </div>
      <div style={{
        fontSize: '8pt',
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
      }}>
        {label}
      </div>
    </div>
  );

  if (link) {
    return <Link to={link} style={{ textDecoration: 'none' }}>{content}</Link>;
  }

  return content;
};


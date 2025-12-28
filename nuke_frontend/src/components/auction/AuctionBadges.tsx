import React from 'react';
import { FaviconIcon } from '../common/FaviconIcon';
import '../../design-system.css';

type AuctionStatus = 'active' | 'sold' | 'ended' | 'expired' | 'cancelled' | 'pending' | 'ending_soon' | 'reserve_not_met';

export const AuctionStatusBadge: React.FC<{ 
  status: AuctionStatus; 
  title?: string;
  endedAt?: string | Date | null;
  fadeAfterDays?: number;
}> = ({ status, title, endedAt, fadeAfterDays = 1 }) => {
  // Mirror the visual language used in VehicleHeader (sold/rnm/live)
  const cfg: Record<AuctionStatus, { text: string; color: string; bg: string }> = {
    sold: { text: 'SOLD', color: '#22c55e', bg: '#dcfce7' },
    reserve_not_met: { text: 'RNM', color: '#f59e0b', bg: '#fef3c7' },
    active: { text: 'LIVE', color: '#3b82f6', bg: '#dbeafe' },
    ending_soon: { text: 'ENDING', color: '#f59e0b', bg: '#fef3c7' },
    ended: { text: 'ENDED', color: '#6b7280', bg: '#f3f4f6' },
    expired: { text: 'EXPIRED', color: '#6b7280', bg: '#f3f4f6' },
    cancelled: { text: 'CANCELLED', color: '#ef4444', bg: '#fee2e2' },
    pending: { text: 'PENDING', color: '#6b7280', bg: '#f3f4f6' },
  };

  const s = cfg[status] || cfg.ended;

  // Calculate fade opacity - fade out badges for ended auctions (especially unsold) after 1 day
  let opacity = 1;
  let display = 'inline-block';
  
  if (endedAt && (status === 'ended' || status === 'reserve_not_met' || status === 'expired')) {
    const endDate = endedAt instanceof Date ? endedAt : new Date(endedAt);
    const daysSinceEnd = (Date.now() - endDate.getTime()) / (1000 * 60 * 60 * 24);
    
    if (daysSinceEnd >= fadeAfterDays) {
      // Fade out completely after fadeAfterDays
      opacity = 0;
      display = 'none';
    } else if (daysSinceEnd > 0) {
      // Gradually fade over the fadeAfterDays period
      opacity = Math.max(0, 1 - (daysSinceEnd / fadeAfterDays));
    }
  }

  // Don't show at all if faded out
  if (opacity === 0) {
    return null;
  }

  return (
    <span
      className="badge"
      title={title || s.text}
      style={{
        background: s.bg,
        color: s.color,
        borderColor: s.color,
        fontWeight: 700,
        fontSize: '10px',
        padding: '3px 8px',
        borderRadius: '4px',
        opacity,
        display,
        transition: 'opacity 0.3s ease',
      }}
    >
      {s.text}
    </span>
  );
};

export const AuctionPlatformBadge: React.FC<{ platform: string; urlForFavicon?: string; label?: string }> = ({
  platform,
  urlForFavicon,
  label,
}) => {
  const pretty = label || platform;
  const faviconUrl =
    urlForFavicon ||
    (platform === 'bat'
      ? 'https://bringatrailer.com'
      : platform === 'cars_and_bids'
        ? 'https://carsandbids.com'
        : platform === 'ebay_motors'
          ? 'https://ebay.com'
          : platform === 'hemmings'
            ? 'https://hemmings.com'
            : platform === 'autotrader'
              ? 'https://autotrader.com'
              : platform === 'facebook_marketplace'
                ? 'https://facebook.com'
                : typeof window !== 'undefined'
                  ? window.location.origin
                  : 'https://n-zero.com');

  return (
    <span
      className="badge badge-secondary"
      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '10px', fontWeight: 700 }}
      title={pretty}
    >
      <FaviconIcon url={faviconUrl} size={14} />
      <span style={{ lineHeight: 1 }}>{pretty}</span>
    </span>
  );
};

export const ParticipantBadge: React.FC<{
  kind: 'user' | 'organization' | 'bat_user';
  label: string;
  href?: string;
  leadingIconUrl?: string;
  title?: string;
}> = ({ kind, label, href, leadingIconUrl, title }) => {
  const content = (
    <span
      className="badge badge-primary"
      title={title || label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '10px',
        fontWeight: 700,
        maxWidth: '100%',
      }}
    >
      {leadingIconUrl ? <FaviconIcon url={leadingIconUrl} size={14} /> : null}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
    </span>
  );

  if (href) {
    return (
      <a href={href} style={{ textDecoration: 'none', color: 'inherit' }} onClick={(e) => e.stopPropagation()}>
        {content}
      </a>
    );
  }

  return content;
};

/**
 * Live Auction Badge
 * Simple, reusable badge for organizations that conduct live auctions (e.g., Mecum, Barrett-Jackson)
 * Checks if organization is an auction house (business_type = 'auction_house')
 */
export const LiveAuctionBadge: React.FC<{
  organization?: {
    business_type?: string;
    organization?: {
      business_type?: string;
    };
  } | null;
  className?: string;
  style?: React.CSSProperties;
}> = ({ organization, className, style }) => {
  // Check if organization is an auction house
  const isAuctionHouse = 
    organization?.business_type === 'auction_house' ||
    organization?.organization?.business_type === 'auction_house';

  if (!isAuctionHouse) {
    return null;
  }

  return (
    <span
      className={className || 'badge'}
      title="Live Auction House"
      style={{
        background: '#dcfce7',
        color: '#166534',
        borderColor: '#166534',
        borderWidth: '1px',
        borderStyle: 'solid',
        fontWeight: 700,
        fontSize: '10px',
        padding: '3px 8px',
        borderRadius: '4px',
        display: 'inline-block',
        ...style,
      }}
    >
      LIVE AUCTION
    </span>
  );
};



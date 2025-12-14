import React from 'react';
import { FaviconIcon } from '../common/FaviconIcon';
import '../../design-system.css';

type AuctionStatus = 'active' | 'sold' | 'ended' | 'expired' | 'cancelled' | 'pending' | 'ending_soon' | 'reserve_not_met';

export const AuctionStatusBadge: React.FC<{ status: AuctionStatus; title?: string }> = ({ status, title }) => {
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



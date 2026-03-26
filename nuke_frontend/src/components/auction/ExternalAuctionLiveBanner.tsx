import React, { useState, useEffect } from 'react';
import { useExternalAuctionSync } from '../../hooks/useExternalAuctionSync';
import { supabase } from '../../lib/supabase';
import PlatformCredentialForm from '../bidding/PlatformCredentialForm';
import { formatCurrencyAmount } from '../../utils/currency';

interface ExternalAuctionLiveBannerProps {
  /** External listing ID */
  externalListingId: string | null;
  /** Platform name (bat, cars_and_bids, etc.) */
  platform: string;
  /** External listing URL */
  listingUrl: string;
  /** Current bid amount in dollars */
  currentBid: number | null;
  /** Optional currency code (USD, EUR, AED, etc.) */
  currencyCode?: string | null;
  /** Number of bids */
  bidCount: number | null;
  /** Number of watchers */
  watcherCount: number | null;
  /** Number of comments (non-bid) */
  commentCount: number | null;
  /** Auction end date (ISO string) */
  endDate: string | null;
  /** Current listing status */
  listingStatus: string | null;
  /** Last update time */
  lastUpdatedAt: string | null;
}

/** Short abbreviation shown in the dark platform badge */
const platformShortNames: Record<string, string> = {
  bat: 'BAT',
  cars_and_bids: 'C&B',
  ebay_motors: 'EBAY',
  hemmings: 'HEM',
  mecum: 'MECUM',
  rm_sothebys: 'RM',
  bonhams: 'BON',
  gooding: 'GOOD',
  pcarmarket: 'PCAR',
  hagerty: 'HAG',
};

type UrgencyLevel = 'ended' | 'lastMinute' | 'critical' | 'urgent' | 'gettingClose' | 'normal';

function formatTimeRemaining(endDate: string | null): { text: string; urgency: UrgencyLevel; ended: boolean } {
  if (!endDate) return { text: 'No end time', urgency: 'normal', ended: false };

  const now = Date.now();
  const end = new Date(endDate).getTime();
  const diff = end - now;

  if (diff <= 0) {
    return { text: 'ENDED', urgency: 'ended', ended: true };
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  // Enhanced urgency levels - NO YELLOW (BaT uses yellow)
  let urgency: UrgencyLevel = 'normal';
  if (diff <= 60000) urgency = 'lastMinute';           // < 1 min - PULSING RED
  else if (diff <= 300000) urgency = 'critical';       // < 5 min - RED
  else if (diff <= 900000) urgency = 'urgent';         // < 15 min - orange
  else if (diff <= 3600000) urgency = 'gettingClose';  // < 1 hour - coral/warm

  if (days > 0) {
    return { text: `${days}d ${hours}h`, urgency, ended: false };
  } else if (hours > 0) {
    return { text: `${hours}h ${minutes}m`, urgency, ended: false };
  } else if (minutes > 0) {
    return { text: `${minutes}m ${seconds}s`, urgency, ended: false };
  } else {
    return { text: `${seconds}s`, urgency, ended: false };
  }
}

// Color mapping for urgency levels - NO YELLOW
const urgencyColors: Record<UrgencyLevel, { color: string; glow?: string }> = {
  lastMinute: { color: 'var(--error)', glow: '0 0 12px rgba(220, 38, 38, 0.7)' },
  critical: { color: 'var(--error)', glow: '0 0 8px rgba(220, 38, 38, 0.5)' },
  urgent: { color: 'var(--orange)', glow: '0 0 6px rgba(234, 88, 12, 0.4)' },
  gettingClose: { color: '#e07960' },
  normal: { color: '#ccc' },
  ended: { color: '#666' },
};

function formatCurrency(amount: number | null, currencyCode?: string | null): string {
  return formatCurrencyAmount(amount, {
    currency: currencyCode ?? undefined,
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
    fallback: '--',
  });
}

export const ExternalAuctionLiveBanner: React.FC<ExternalAuctionLiveBannerProps> = ({
  externalListingId,
  platform,
  listingUrl,
  currentBid: initialBid,
  currencyCode,
  bidCount: initialBidCount,
  watcherCount: initialWatcherCount,
  commentCount,
  endDate: initialEndDate,
  listingStatus,
  lastUpdatedAt,
}) => {
  // Use the sync hook for real-time updates
  const isActive = ['active', 'live'].includes(String(listingStatus || '').toLowerCase());
  const { syncResult, syncing, lastSyncTime, pollingInterval } = useExternalAuctionSync({
    externalListingId,
    endDate: initialEndDate,
    isActive,
    enabled: isActive,
  });

  // Merge initial props with sync results
  const currentBid = syncResult?.current_bid ?? initialBid;
  const bidCount = syncResult?.bid_count ?? initialBidCount;
  const watcherCount = syncResult?.watcher_count ?? initialWatcherCount;
  const endDate = syncResult?.end_date ?? initialEndDate;
  const status = syncResult?.listing_status ?? listingStatus;

  // Platform credential check (kept for future use but not shown in banner)
  const [hasCredential, setHasCredential] = useState<boolean | null>(null);
  const [showCredentialForm, setShowCredentialForm] = useState(false);

  useEffect(() => {
    const checkCredential = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setHasCredential(false);
        return;
      }

      const { data, error } = await supabase
        .from('platform_credentials')
        .select('id, status')
        .eq('user_id', user.id)
        .eq('platform', platform)
        .eq('status', 'active')
        .maybeSingle();

      setHasCredential(!!data && !error);
    };

    if (isActive) {
      checkCredential();
    }
  }, [platform, isActive]);

  // Live countdown timer
  const [timeState, setTimeState] = useState(() => formatTimeRemaining(endDate));
  const [pulsePhase, setPulsePhase] = useState(0);

  useEffect(() => {
    if (!endDate) return;

    const update = () => setTimeState(formatTimeRemaining(endDate));
    update();

    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [endDate]);

  // Pulsing effect for critical urgency
  useEffect(() => {
    if (timeState.urgency === 'lastMinute') {
      const pulseInterval = setInterval(() => {
        setPulsePhase((prev) => (prev + 1) % 2);
      }, 300);
      return () => clearInterval(pulseInterval);
    } else if (timeState.urgency === 'critical') {
      const pulseInterval = setInterval(() => {
        setPulsePhase((prev) => (prev + 1) % 2);
      }, 500);
      return () => clearInterval(pulseInterval);
    }
    setPulsePhase(0);
  }, [timeState.urgency]);

  // Track bid changes for animation
  const [bidChanged, setBidChanged] = useState(false);
  const prevBidRef = React.useRef(currentBid);

  useEffect(() => {
    if (prevBidRef.current !== null && currentBid !== null && currentBid !== prevBidRef.current) {
      setBidChanged(true);
      const timer = setTimeout(() => setBidChanged(false), 2000);
      prevBidRef.current = currentBid;
      return () => clearTimeout(timer);
    }
    prevBidRef.current = currentBid;
  }, [currentBid]);

  const platformShort = platformShortNames[platform] || platform.toUpperCase().slice(0, 4);

  // Don't show banner for non-active auctions
  if (!isActive && !timeState.ended) {
    return null;
  }

  const handleBidNow = () => {
    // Link directly to the listing page -- the platform handles login/auth
    window.open(listingUrl, '_blank', 'noopener,noreferrer');
  };

  const handleViewListing = () => {
    window.open(listingUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      style={{
        background: '#2a2a2a',
        padding: '10px 14px',
        marginBottom: '12px',
        fontSize: '11px',
        color: '#e0e0e0',
      }}
    >
      {/* Header row: LIVE badge + platform badge + timer + action buttons */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* LIVE / ENDED indicator */}
          {isActive && !timeState.ended ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                background: '#1a1a1a',
                border: '2px solid var(--error)',
                padding: '2px 8px',
              }}
            >
              <div
                style={{
                  width: '6px',
                  height: '6px',
                  background: ['lastMinute', 'critical', 'urgent'].includes(timeState.urgency) ? 'var(--error)' : 'var(--success)',
                  animation: 'pulse 1.5s ease-in-out infinite',
                }}
              />
              <span style={{ fontWeight: 700, fontSize: '9px', letterSpacing: '0.5px', color: '#fff' }}>LIVE</span>
            </div>
          ) : (
            <div
              style={{
                background: '#1a1a1a',
                border: '2px solid #555',
                padding: '2px 8px',
              }}
            >
              <span style={{ fontWeight: 700, fontSize: '9px', letterSpacing: '0.5px', color: '#666' }}>ENDED</span>
            </div>
          )}

          {/* Platform abbreviation badge */}
          <div
            style={{
              background: '#1a1a1a',
              border: '2px solid #444',
              padding: '2px 8px',
            }}
          >
            <span
              style={{
                fontWeight: 700,
                fontSize: '9px',
                letterSpacing: '0.5px',
                color: '#999',
                fontFamily: "'Courier New', monospace",
              }}
            >
              {platformShort}
            </span>
          </div>

          {/* Countdown timer */}
          <span
            style={{
              fontFamily: "'Courier New', monospace",
              fontSize: ['lastMinute', 'critical'].includes(timeState.urgency) ? '13px' : '11px',
              fontWeight: 700,
              color: urgencyColors[timeState.urgency].color,
              textShadow: urgencyColors[timeState.urgency].glow || 'none',
              opacity: ['lastMinute', 'critical'].includes(timeState.urgency) ? (pulsePhase === 0 ? 1 : 0.6) : 1,
              transform: timeState.urgency === 'lastMinute' && pulsePhase === 1 ? 'scale(1.05)' : 'scale(1)',
              transition: 'opacity 0.15s, transform 0.15s',
              display: 'inline-block',
            }}
          >
            {timeState.text}
          </span>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* BID NOW - primary action, only for live auctions */}
          {isActive && !timeState.ended && (
            <button
              onClick={handleBidNow}
              style={{
                background: 'var(--success)',
                border: '2px solid var(--success)',
                color: '#000',
                padding: '4px 14px',
                fontSize: '10px',
                fontWeight: 700,
                cursor: 'pointer',
                letterSpacing: '0.5px',
                transition: 'opacity 0.12s ease',
                fontFamily: 'Arial, sans-serif',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85'; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
            >
              BID NOW
            </button>
          )}

          {/* VIEW LISTING - always visible */}
          <button
            onClick={handleViewListing}
            style={{
              background: 'transparent',
              border: '2px solid #555',
              color: '#ccc',
              padding: '4px 14px',
              fontSize: '10px',
              fontWeight: 600,
              cursor: 'pointer',
              letterSpacing: '0.3px',
              transition: 'border-color 0.12s ease, color 0.12s ease',
              fontFamily: 'Arial, sans-serif',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#888';
              e.currentTarget.style.color = '#fff';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#555';
              e.currentTarget.style.color = '#ccc';
            }}
          >
            VIEW LISTING
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        {/* Current bid */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            padding: '6px 10px',
            background: '#1a1a1a',
            border: '2px solid #444',
          }}
        >
          <span style={{ fontSize: '8px', color: '#777', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Current Bid</span>
          <span
            style={{
              fontSize: '16px',
              fontWeight: 700,
              fontFamily: "'Courier New', monospace",
              color: '#fff',
              transition: 'all 0.3s ease',
              transform: bidChanged ? 'scale(1.1)' : 'scale(1)',
              display: 'inline-block',
            }}
          >
            {formatCurrency(currentBid, currencyCode)}
          </span>
        </div>

        {/* Bid count */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            padding: '6px 10px',
            background: '#1a1a1a',
            border: '2px solid #333',
          }}
        >
          <span style={{ fontSize: '8px', color: '#777', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Bids</span>
          <span style={{ fontSize: '13px', fontWeight: 600, fontFamily: "'Courier New', monospace", color: '#ccc' }}>
            {bidCount ?? '--'}
          </span>
        </div>

        {/* Watchers */}
        {watcherCount !== null && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '2px',
              padding: '6px 10px',
              background: '#1a1a1a',
              border: '2px solid #333',
            }}
          >
            <span style={{ fontSize: '8px', color: '#777', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Watching</span>
            <span style={{ fontSize: '13px', fontWeight: 600, fontFamily: "'Courier New', monospace", color: '#ccc' }}>
              {watcherCount.toLocaleString()}
            </span>
          </div>
        )}

        {/* Comments */}
        {commentCount !== null && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '2px',
              padding: '6px 10px',
              background: '#1a1a1a',
              border: '2px solid #333',
            }}
          >
            <span style={{ fontSize: '8px', color: '#777', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Comments</span>
            <span style={{ fontSize: '13px', fontWeight: 600, fontFamily: "'Courier New', monospace", color: '#ccc' }}>
              {commentCount}
            </span>
          </div>
        )}
      </div>

      {/* CSS for pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(0.9); }
        }
      `}</style>

      {/* Platform credential form modal (kept for programmatic use) */}
      <PlatformCredentialForm
        isOpen={showCredentialForm}
        onClose={() => setShowCredentialForm(false)}
        existingCredential={null}
        platform={platform}
        onSaved={() => {
          setShowCredentialForm(false);
          setHasCredential(true);
        }}
      />
    </div>
  );
};

export default ExternalAuctionLiveBanner;

import React, { useState, useEffect } from 'react';
import { useExternalAuctionSync } from '../../hooks/useExternalAuctionSync';
import { supabase } from '../../lib/supabase';
import PlatformCredentialForm from '../bidding/PlatformCredentialForm';

interface ExternalAuctionLiveBannerProps {
  /** External listing ID */
  externalListingId: string | null;
  /** Platform name (bat, cars_and_bids, etc.) */
  platform: string;
  /** External listing URL */
  listingUrl: string;
  /** Current bid amount in dollars */
  currentBid: number | null;
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

const platformNames: Record<string, string> = {
  bat: 'Bring a Trailer',
  cars_and_bids: 'Cars & Bids',
  ebay_motors: 'eBay Motors',
  hemmings: 'Hemmings',
};

const platformColors: Record<string, { bg: string; text: string; accent: string }> = {
  bat: { bg: '#1a1a1a', text: '#ffffff', accent: '#f59e0b' },
  cars_and_bids: { bg: '#dc2626', text: '#ffffff', accent: '#fbbf24' },
  ebay_motors: { bg: '#0064d2', text: '#ffffff', accent: '#f5af02' },
  hemmings: { bg: '#8b0000', text: '#ffffff', accent: '#ffd700' },
};

function formatTimeRemaining(endDate: string | null): { text: string; urgent: boolean; ended: boolean } {
  if (!endDate) return { text: 'No end time', urgent: false, ended: false };

  const now = Date.now();
  const end = new Date(endDate).getTime();
  const diff = end - now;

  if (diff <= 0) {
    return { text: 'ENDED', urgent: false, ended: true };
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  const urgent = diff < 10 * 60 * 1000; // < 10 minutes

  if (days > 0) {
    return { text: `${days}d ${hours}h`, urgent: false, ended: false };
  } else if (hours > 0) {
    return { text: `${hours}h ${minutes}m`, urgent: false, ended: false };
  } else if (minutes > 0) {
    return { text: `${minutes}m ${seconds}s`, urgent, ended: false };
  } else {
    return { text: `${seconds}s`, urgent: true, ended: false };
  }
}

function formatCurrency(amount: number | null): string {
  if (amount === null || amount === undefined) return '--';
  return `$${amount.toLocaleString()}`;
}

export const ExternalAuctionLiveBanner: React.FC<ExternalAuctionLiveBannerProps> = ({
  externalListingId,
  platform,
  listingUrl,
  currentBid: initialBid,
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

  // Platform credential check
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

  useEffect(() => {
    if (!endDate) return;

    const update = () => setTimeState(formatTimeRemaining(endDate));
    update();

    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [endDate]);

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

  const colors = platformColors[platform] || platformColors.bat;
  const platformName = platformNames[platform] || platform.toUpperCase();

  // Don't show banner for non-active auctions
  if (!isActive && !timeState.ended) {
    return null;
  }

  const handleViewOnPlatform = () => {
    window.open(listingUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      style={{
        background: `linear-gradient(135deg, ${colors.bg} 0%, ${colors.bg}ee 100%)`,
        borderRadius: '6px',
        padding: '10px 14px',
        marginBottom: '12px',
        fontSize: '8pt',
        color: colors.text,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Live indicator */}
          {isActive && !timeState.ended && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <div
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: timeState.urgent ? '#ef4444' : '#22c55e',
                  animation: 'pulse 1.5s ease-in-out infinite',
                  boxShadow: `0 0 8px ${timeState.urgent ? '#ef4444' : '#22c55e'}`,
                }}
              />
              <span style={{ fontWeight: 700, fontSize: '7pt', letterSpacing: '0.5px' }}>LIVE</span>
            </div>
          )}

          {timeState.ended && (
            <span
              style={{
                fontWeight: 700,
                fontSize: '7pt',
                background: 'rgba(255,255,255,0.2)',
                padding: '2px 6px',
                borderRadius: '3px',
              }}
            >
              ENDED
            </span>
          )}

          <span style={{ opacity: 0.8, fontSize: '7pt' }}>on {platformName}</span>
        </div>

        {/* Timer */}
        <div
          style={{
            fontFamily: 'monospace',
            fontSize: timeState.urgent ? '11pt' : '9pt',
            fontWeight: 700,
            color: timeState.urgent ? '#fbbf24' : colors.text,
            textShadow: timeState.urgent ? '0 0 10px rgba(251, 191, 36, 0.5)' : 'none',
          }}
        >
          {timeState.text}
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        {/* Current bid */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={{ fontSize: '6pt', opacity: 0.7, textTransform: 'uppercase' }}>Current Bid</span>
          <span
            style={{
              fontSize: '12pt',
              fontWeight: 700,
              color: colors.accent,
              transition: 'all 0.3s ease',
              transform: bidChanged ? 'scale(1.1)' : 'scale(1)',
              textShadow: bidChanged ? `0 0 12px ${colors.accent}` : 'none',
            }}
          >
            {formatCurrency(currentBid)}
          </span>
        </div>

        {/* Bid count */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={{ fontSize: '6pt', opacity: 0.7, textTransform: 'uppercase' }}>Bids</span>
          <span style={{ fontSize: '10pt', fontWeight: 600 }}>{bidCount ?? '--'}</span>
        </div>

        {/* Watchers */}
        {watcherCount !== null && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '6pt', opacity: 0.7, textTransform: 'uppercase' }}>Watching</span>
            <span style={{ fontSize: '10pt', fontWeight: 600 }}>{watcherCount.toLocaleString()}</span>
          </div>
        )}

        {/* Comments */}
        {commentCount !== null && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '6pt', opacity: 0.7, textTransform: 'uppercase' }}>Comments</span>
            <span style={{ fontSize: '10pt', fontWeight: 600 }}>{commentCount}</span>
          </div>
        )}

        {/* Actions */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
          {syncing && (
            <span style={{ fontSize: '6pt', opacity: 0.6 }}>syncing...</span>
          )}
          {pollingInterval && !syncing && (
            <span style={{ fontSize: '6pt', opacity: 0.5 }}>
              {pollingInterval < 10000 ? 'FAST' : pollingInterval < 30000 ? 'MED' : ''} sync
            </span>
          )}

          {/* Connect to Bid button when no credentials */}
          {isActive && !timeState.ended && hasCredential === false && (
            <button
              onClick={() => setShowCredentialForm(true)}
              style={{
                background: colors.accent,
                border: 'none',
                color: '#000',
                padding: '6px 12px',
                borderRadius: '4px',
                fontSize: '7pt',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'scale(1.05)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
              }}
            >
              <span>🔐</span>
              Connect {platformName.split(' ')[0]} to Bid
            </button>
          )}

          {/* Ready to bid indicator when credentials exist */}
          {isActive && !timeState.ended && hasCredential === true && (
            <span
              style={{
                background: 'rgba(34, 197, 94, 0.2)',
                color: '#22c55e',
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '6pt',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <span>✓</span> Ready to Bid
            </span>
          )}

          <button
            onClick={handleViewOnPlatform}
            style={{
              background: 'rgba(255,255,255,0.15)',
              border: 'none',
              color: colors.text,
              padding: '4px 10px',
              borderRadius: '4px',
              fontSize: '7pt',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.25)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.15)';
            }}
          >
            View on {platformName.split(' ')[0]} →
          </button>
        </div>
      </div>

      {/* CSS for pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(0.9); }
        }
      `}</style>

      {/* Platform credential form modal */}
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

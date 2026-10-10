import React, { useState, useEffect } from 'react';
import { useExternalAuctionSync } from '../../hooks/useExternalAuctionSync';
import { supabase } from '../../lib/supabase';
import PlatformCredentialForm from '../bidding/PlatformCredentialForm';
import { formatCurrencyAmount } from '../../utils/currency';
import { HeaderPopover } from '../vehicle/HeaderPopover';
import { useLiveLotTemperature, type CohortCount } from '../../pages/market/useLiveLotTemperature';
import { PrefetchLink as Link } from '../PrefetchLink';
import './ExternalAuctionLiveBanner.css';
import { timeLeft, useSecondClock } from '../../hooks/useSecondClock';

interface ExternalAuctionLiveBannerProps {
  vehicleId?: string;
  sellerStack?: React.ReactNode;
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

/** Short abbreviation shown in the platform badge */
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


/** Mid-rank among the reader's clock-matched retained lots; never a generic vehicle grade. */
export function liveMetricRank(c: CohortCount | undefined, minimum: number): number | null {
  if (!c || !Number.isInteger(c.n) || c.n < minimum || c.n <= 0 ||
      !Number.isInteger(c.below) || !Number.isInteger(c.same) || c.below < 0 || c.same < 0 || c.below + c.same > c.n) return null;
  return Math.round(100 * (c.below + c.same / 2) / c.n);
}

type UrgencyLevel = 'ended' | 'pending' | 'lastMinute' | 'critical' | 'urgent' | 'gettingClose' | 'normal';

function formatTimeRemaining(endDate: string | null, status: string | null): { text: string; urgency: UrgencyLevel; ended: boolean } {
  if (['sold', 'ended', 'reserve_not_met', 'no_sale', 'expired', 'cancelled', 'unsold'].includes(String(status || '').toLowerCase())) {
    return { text: 'ENDED', urgency: 'ended', ended: true };
  }
  if (!endDate) return { text: 'No end time', urgency: 'normal', ended: false };

  const now = Date.now();
  const end = new Date(endDate).getTime();
  const diff = end - now;

  if (!Number.isFinite(diff) || diff <= 0) {
    return { text: 'RESULT PENDING', urgency: 'pending', ended: false };
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

  if (days === 0 && hours === 0 && minutes === 0) return { text: `${seconds}s`, urgency, ended: false };
  return { text: timeLeft(diff), urgency, ended: false };
}

// Color mapping for urgency levels - NO YELLOW
const urgencyColors: Record<UrgencyLevel, { color: string; glow?: string }> = {
  lastMinute: { color: 'var(--error)', glow: '0 0 12px rgba(220, 38, 38, 0.7)' },
  critical: { color: 'var(--error)', glow: '0 0 8px rgba(220, 38, 38, 0.5)' },
  urgent: { color: 'var(--orange)', glow: '0 0 6px rgba(234, 88, 12, 0.4)' },
  gettingClose: { color: '#e07960' },
  normal: { color: 'var(--text-secondary)' },
  ended: { color: 'var(--text-disabled)' },
  pending: { color: 'var(--text-secondary)' },
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
  vehicleId,
  sellerStack,
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
  const isBat = ['bat', 'bringatrailer', 'bring_a_trailer'].includes(platform);
  const { data: temperature, isPending: comparisonPending } = useLiveLotTemperature(isBat ? vehicleId : null);
  const [activeMetric, setActiveMetric] = useState<string | null>(null);
  const metricBoundary = React.useRef<HTMLDivElement>(null);
  useEffect(() => setActiveMetric(null), [vehicleId, listingUrl]);
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
      // Use getSession() instead of getUser() to avoid Web Locks API contention
      // on sb-*-auth-token (cause of 2026-05-24 garage hang). See lib/supabase.ts.
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
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
  // Ticks on the page's one shared 1-second clock.
  useSecondClock(Boolean(endDate));
  const timeState = formatTimeRemaining(endDate, status);
  const resultPending = timeState.urgency === 'pending';
  const observedAt = Date.parse(lastUpdatedAt || '');
  const staleBid = resultPending || !Number.isFinite(observedAt) || Date.now() - observedAt > 15 * 60 * 1000;
  const [pulsePhase, setPulsePhase] = useState(0);

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

  const safeListingUrl = /^https?:\/\//i.test(listingUrl.trim()) ? listingUrl : null;
  const comparisonAgeHours = temperature ? Math.max(0, (Date.now() - temperature.readAt) / 3_600_000) : null;
  const platformShort = platformShortNames[platform] || platform.toUpperCase().slice(0, 4);

  // Don't show banner for non-active auctions
  if (!isActive && !timeState.ended) {
    return null;
  }

  const handleBidNow = () => {
    // Link directly to the listing page -- the platform handles login/auth
    if (safeListingUrl) window.open(safeListingUrl, '_blank', 'noopener,noreferrer');
  };

  const handleViewListing = () => {
    if (safeListingUrl) window.open(safeListingUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      className="external-auction-stack"
      style={{
        background: 'var(--surface)',
        border: '2px solid var(--border)',
        padding: '10px 12px',
        marginBottom: '12px',
        fontSize: '11px',
        color: 'var(--text)',
      }}
    >
      {/* Header row: LIVE badge + platform badge + timer + action buttons */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* LIVE / ENDED indicator */}
          {isActive && !timeState.ended && !resultPending ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                background: 'var(--bg)',
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
              <span style={{ fontWeight: 700, fontSize: '9px', letterSpacing: '0.5px', color: 'var(--text)' }}>LIVE</span>
            </div>
          ) : (
            <div
              style={{
                background: 'var(--bg)',
                border: '2px solid var(--border)',
                padding: '2px 8px',
              }}
            >
              <span style={{ fontWeight: 700, fontSize: '9px', letterSpacing: '0.5px', color: 'var(--text-disabled)' }}>{resultPending ? 'RESULT PENDING' : 'ENDED'}</span>
            </div>
          )}

          <a href={safeListingUrl ?? undefined} target="_blank" rel="noreferrer" aria-label={isBat ? 'Bring a Trailer listing' : `${platformShort} listing`}>
            {isBat ? <img src="/vendor/bat/favicon.ico" alt="Bring a Trailer" width={28} height={28} /> : <span>{platformShort}</span>}
          </a>

          {sellerStack}
          {/* Countdown timer */}
          <span
            style={{
              fontFamily: "'Courier New', monospace",
              fontSize: ['lastMinute', 'critical'].includes(timeState.urgency) ? '13px' : '11px',
              fontWeight: 700,
              color: urgencyColors[timeState.urgency].color,
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
          {isActive && !timeState.ended && !resultPending && (
            <button
              disabled={!safeListingUrl}
              onClick={handleBidNow}
              style={{
                background: 'var(--success)',
                border: '2px solid var(--success)',
                color: '#fff',
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
            disabled={!safeListingUrl}
            onClick={handleViewListing}
            style={{
              background: 'transparent',
              border: '2px solid var(--text)',
              color: 'var(--text)',
              padding: '4px 14px',
              fontSize: '10px',
              fontWeight: 600,
              cursor: 'pointer',
              letterSpacing: '0.3px',
              transition: 'border-color 0.12s ease, color 0.12s ease',
              fontFamily: 'Arial, sans-serif',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--text)';
              e.currentTarget.style.color = 'var(--text)';
              e.currentTarget.style.background = 'var(--surface-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--text)';
              e.currentTarget.style.color = 'var(--text)';
              e.currentTarget.style.background = 'transparent';
            }}
          >
            VIEW LISTING
          </button>
        </div>
      </div>

      <div ref={metricBoundary} className="external-auction-stack__metrics">
        {[
          { key: 'price', label: staleBid ? 'Last observed bid' : 'Current bid', value: formatCurrency(currentBid, currencyCode), count: temperature?.price, agrees: temperature?.price.bid === currentBid },
          { key: 'bids', label: 'Bids', value: bidCount, count: temperature?.bids, agrees: temperature?.bids.value === bidCount },
          { key: 'bidders', label: 'Bidders', value: temperature?.bids.value === bidCount && temperature?.price.bid === currentBid && temperature?.endsAt === Date.parse(endDate || '') ? temperature?.bidders.value : undefined, count: temperature?.bidders, agrees: temperature?.bids.value === bidCount && temperature?.price.bid === currentBid },
          { key: 'watchers', label: 'Watching', value: watcherCount, count: undefined, agrees: false },
          { key: 'comments', label: 'Discussion', value: commentCount, count: undefined, agrees: false },
        ].filter(metric => metric.value != null).map(metric => {
          const p = metric.agrees && temperature && temperature.readAt <= Date.now() && Date.parse(endDate || '') === temperature.endsAt && !timeState.ended && !resultPending
            ? liveMetricRank(metric.count, temperature.minComparables) : null;
          return <button key={metric.key} type="button" className="external-auction-stack__metric"
            aria-label={`Inspect ${metric.label.toLowerCase()} stack`} aria-haspopup="dialog" aria-expanded={activeMetric === metric.key}
            onClick={() => setActiveMetric(active => active === metric.key ? null : metric.key)}>
            <span>{metric.label} ▾</span><strong>{typeof metric.value === 'number' ? metric.value.toLocaleString() : metric.value}</strong>
            <small>{p != null ? `P${p}` : 'Unranked'}</small>
            {p != null && <i aria-hidden="true" style={{ '--rank': `${p}%` } as React.CSSProperties} />}
          </button>;
        })}
        <HeaderPopover open={activeMetric != null} onClose={() => setActiveMetric(null)} title={`${activeMetric === 'watchers' ? 'Watching' : activeMetric === 'comments' ? 'Discussion' : activeMetric === 'price' ? 'Price' : activeMetric === 'bidders' ? 'Bidders' : 'Bids'} stack`}
          width={320} dismissBoundaryRef={metricBoundary}>
          <div className="external-auction-stack__evidence">
            {activeMetric === 'watchers' || activeMetric === 'comments' ? <p>{activeMetric === 'watchers' ? 'Watchers are a listing-page snapshot.' : 'Discussion counts retained non-bid posts for this listing.'} This reader has no age-matched percentile for this metric.</p> : temperature ? (() => {
              const c = activeMetric === 'price' ? temperature.price : activeMetric === 'bidders' ? temperature.bidders : temperature.bids;
              const middle = Math.floor(c.comps.length / 2);
              const peerMedian = c.comps.length % 2 ? c.comps[middle] : (c.comps[middle - 1] + c.comps[middle]) / 2;
              return <><p>{c.n} {activeMetric === 'price' ? 'sold' : 'closed'} {temperature.make} {temperature.model} lots · all model years · {temperature.hoursLeft.toFixed(1)}h before close.</p>
                <p>{c.comps.length > 0 ? `Peer median ${activeMetric === 'price' ? formatCurrency(peerMedian, currencyCode) : peerMedian}.` : 'Peer values unavailable.'}</p>
                <details><summary>Comparison evidence</summary><p>Saved {new Date(temperature.readAt).toLocaleString()}. Latest {temperature.vehiclesCap} vehicle records with exact current make/model text. Retained posted bids replayed at the same time before their recorded close; missing bid history can affect rank. Equal readings share a mid-rank. Minimum {temperature.minComparables} lots.</p><p>Price position measures the standing bid, not expected sale value. Seller-adjusted price weighting is not measured by this reader.</p></details>
              </>;
            })() : <p>Age-matched comparison is unavailable for this recorded listing state.</p>}
            {vehicleId && <Link to={`/stacks/order-book/${vehicleId}`}>Open auction evidence & forecast →</Link>}
          </div>
        </HeaderPopover>
      </div>
      <div className="external-auction-stack__clock">
        {temperature ? <>Comparison {comparisonAgeHours! >= 1 ? `${Math.floor(comparisonAgeHours!)}h old` : `${Math.floor(comparisonAgeHours! * 60)}m old`} · {temperature.hoursLeft.toFixed(1)}h before close at that read</> : <>{isBat && vehicleId && (comparisonPending ? 'Reading comparison · ' : 'Comparison unavailable · ')}Listing state saved {Number.isFinite(observedAt) ? new Date(observedAt).toLocaleString() : 'at an unknown time'}</>}
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

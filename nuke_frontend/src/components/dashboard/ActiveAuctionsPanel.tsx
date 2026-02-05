import React, { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { optimizeImageUrl } from '../../lib/imageOptimizer';
import { FaviconIcon } from '../common/FaviconIcon';

// =============================================================================
// TYPES
// =============================================================================

interface AuctionListing {
  id: string;
  vehicle_id: string;
  platform: string;
  listing_url: string;
  listing_status: string;
  current_bid: number | null;
  bid_count: number;
  watcher_count: number;
  view_count: number;
  end_date: string | null;
  start_date: string | null;
  updated_at: string;
  // Joined vehicle data
  vehicle?: {
    year: number | null;
    make: string | null;
    model: string | null;
    primary_image_url: string | null;
    image_url: string | null;
  };
}

interface PlatformStats {
  platform: string;
  count: number;
  totalBids: number;
  avgBid: number;
}

interface ActiveAuctionsPanelProps {
  onClose: () => void;
  onNavigateToVehicle?: (vehicleId: string) => void;
}

// =============================================================================
// COUNTDOWN TIMER COMPONENT
// =============================================================================

interface CountdownTimerProps {
  endDate: string;
  size?: 'small' | 'medium' | 'large';
}

const CountdownTimer: React.FC<CountdownTimerProps> = ({ endDate, size = 'small' }) => {
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [pulsePhase, setPulsePhase] = useState(0);

  useEffect(() => {
    const update = () => {
      const now = Date.now();
      const end = new Date(endDate).getTime();
      const remaining = Math.max(0, end - now);
      setTimeRemaining(remaining);
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [endDate]);

  // Pulsing effect for critical/last-minute urgency
  useEffect(() => {
    if (timeRemaining > 0 && timeRemaining <= 60000) {
      // Last minute: fast pulse
      const pulseInterval = setInterval(() => {
        setPulsePhase((prev) => (prev + 1) % 2);
      }, 300);
      return () => clearInterval(pulseInterval);
    } else if (timeRemaining > 0 && timeRemaining <= 300000) {
      // Under 5 min: slower pulse
      const pulseInterval = setInterval(() => {
        setPulsePhase((prev) => (prev + 1) % 2);
      }, 500);
      return () => clearInterval(pulseInterval);
    }
    setPulsePhase(0);
  }, [timeRemaining]);

  const formatTime = (ms: number) => {
    if (ms === 0) return 'ENDED';

    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (days > 0) {
      return `${days}D:${hours.toString().padStart(2, '0')}H:${minutes.toString().padStart(2, '0')}M`;
    }
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // Enhanced urgency levels with more granularity
  const getUrgencyLevel = (ms: number): 'ended' | 'lastMinute' | 'critical' | 'urgent' | 'gettingClose' | 'normal' => {
    if (ms === 0) return 'ended';
    if (ms <= 60000) return 'lastMinute';    // < 1 min - PULSING RED
    if (ms <= 300000) return 'critical';      // < 5 min - RED
    if (ms <= 900000) return 'urgent';        // < 15 min - orange-ish
    if (ms <= 3600000) return 'gettingClose'; // < 1 hour - warmer color (coral/salmon)
    return 'normal';
  };

  const urgency = getUrgencyLevel(timeRemaining);

  // Color spectrum: NO YELLOW (BaT uses yellow)
  // Normal -> Coral -> Orange -> Red -> Pulsing Red
  const urgencyStyles: Record<string, { color: string; bg: string; border?: string; glow?: string }> = {
    lastMinute: {
      color: '#dc2626',      // Bright red
      bg: '#fef2f2',
      border: '2px solid #dc2626',
      glow: '0 0 8px rgba(220, 38, 38, 0.6)'
    },
    critical: {
      color: '#dc2626',      // Red
      bg: '#fee2e2',
      border: '1px solid #fca5a5'
    },
    urgent: {
      color: '#ea580c',      // Orange (not yellow!)
      bg: '#fff7ed',
      border: '1px solid #fdba74'
    },
    gettingClose: {
      color: '#e07960',      // Coral/salmon - warmer than neutral but not orange
      bg: '#fef7f5',
      border: '1px solid #f5cdc4'
    },
    normal: {
      color: 'var(--text)',
      bg: 'var(--surface-hover)'
    },
    ended: {
      color: '#6b7280',
      bg: '#f3f4f6'
    },
  };

  const style = urgencyStyles[urgency];
  const fontSize = size === 'small' ? '9px' : size === 'medium' ? '12px' : '16px';
  const padding = size === 'small' ? '2px 6px' : size === 'medium' ? '4px 10px' : '6px 14px';

  // Calculate pulse opacity for last minute / critical
  const isPulsing = urgency === 'lastMinute' || urgency === 'critical';
  const pulseOpacity = isPulsing ? (pulsePhase === 0 ? 1 : 0.6) : 1;
  const pulseScale = urgency === 'lastMinute' && pulsePhase === 1 ? 'scale(1.02)' : 'scale(1)';

  return (
    <div
      style={{
        fontFamily: 'monospace',
        fontSize,
        fontWeight: 700,
        color: style.color,
        background: style.bg,
        padding,
        borderRadius: '4px',
        display: 'inline-block',
        opacity: pulseOpacity,
        transform: pulseScale,
        border: style.border || 'none',
        boxShadow: style.glow || 'none',
        transition: 'opacity 0.15s, transform 0.15s, box-shadow 0.15s',
      }}
    >
      {formatTime(timeRemaining)}
    </div>
  );
};

// =============================================================================
// TIER BADGE COMPONENT
// =============================================================================

interface TierBadgeProps {
  bid: number | null;
  bidCount: number;
}

const TierBadge: React.FC<TierBadgeProps> = ({ bid, bidCount }) => {
  // Calculate tier based on bid amount and activity
  // S: $500k+ with 50+ bids
  // A: $100k+ with 30+ bids or $250k+ with 20+ bids
  // B: $50k+ with 20+ bids or $100k+ with 10+ bids
  // C: $25k+ with 10+ bids or $50k+ with 5+ bids
  // D: Everything else with bids
  // F: No bids yet

  const getTier = (): { tier: string; color: string; bg: string } => {
    const b = bid || 0;
    const c = bidCount || 0;

    if (c === 0) return { tier: 'F', color: '#6b7280', bg: '#f3f4f6' };
    if (b >= 500000 && c >= 50) return { tier: 'S', color: '#7c3aed', bg: '#ede9fe' };
    if ((b >= 100000 && c >= 30) || (b >= 250000 && c >= 20)) return { tier: 'A', color: '#059669', bg: '#d1fae5' };
    if ((b >= 50000 && c >= 20) || (b >= 100000 && c >= 10)) return { tier: 'B', color: '#3b82f6', bg: '#dbeafe' };
    if ((b >= 25000 && c >= 10) || (b >= 50000 && c >= 5)) return { tier: 'C', color: '#f59e0b', bg: '#fef3c7' };
    return { tier: 'D', color: '#6b7280', bg: '#f3f4f6' };
  };

  const { tier, color, bg } = getTier();

  return (
    <div
      style={{
        width: '18px',
        height: '18px',
        borderRadius: '4px',
        background: bg,
        color,
        fontSize: '10px',
        fontWeight: 900,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: `1px solid ${color}`,
      }}
      title={`Tier ${tier} - Based on bid amount and activity`}
    >
      {tier}
    </div>
  );
};

// =============================================================================
// BID TREND ARROW COMPONENT
// =============================================================================

interface BidTrendProps {
  current: number | null;
  previous?: number | null;
}

const BidTrend: React.FC<BidTrendProps> = ({ current }) => {
  // For now, always show up arrow for active auctions (they're going up by nature)
  // In a real implementation, you'd track bid history
  if (!current) return null;

  return (
    <span style={{ color: '#10b981', fontSize: '10px', marginLeft: '2px' }} title="Bid increasing">
      ^
    </span>
  );
};

// =============================================================================
// PLATFORM BREAKDOWN CHART
// =============================================================================

interface PlatformBreakdownChartProps {
  stats: PlatformStats[];
}

const PlatformBreakdownChart: React.FC<PlatformBreakdownChartProps> = ({ stats }) => {
  const maxCount = Math.max(...stats.map((s) => s.count), 1);

  const platformColors: Record<string, string> = {
    bat: '#e67e22',
    cars_and_bids: '#3498db',
    pcarmarket: '#9b59b6',
    ebay_motors: '#e74c3c',
    mecum: '#2ecc71',
    bonhams: '#1abc9c',
    rmsothebys: '#34495e',
    collecting_cars: '#f39c12',
    hagerty: '#e91e63',
    default: '#95a5a6',
  };

  const platformLabels: Record<string, string> = {
    bat: 'BaT',
    cars_and_bids: 'C&B',
    pcarmarket: 'PCM',
    ebay_motors: 'eBay',
    mecum: 'Mecum',
    bonhams: 'Bonhams',
    rmsothebys: 'RM',
    collecting_cars: 'CC',
    hagerty: 'Hagerty',
  };

  return (
    <div style={{ marginTop: 'var(--space-3)' }}>
      <div style={{ fontSize: 'var(--fs-8)', fontWeight: 700, marginBottom: 'var(--space-2)', color: 'var(--text-secondary)' }}>
        AUCTIONS BY PLATFORM
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        {stats.slice(0, 6).map((s) => (
          <div key={s.platform} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <div style={{ width: 40, fontSize: 'var(--fs-8)', fontWeight: 600, color: 'var(--text)' }}>
              {platformLabels[s.platform] || s.platform.substring(0, 4).toUpperCase()}
            </div>
            <div
              style={{
                flex: 1,
                height: 12,
                background: 'var(--surface-hover)',
                borderRadius: 'var(--radius)',
                overflow: 'hidden',
                border: '1px solid var(--border)',
              }}
            >
              <div
                style={{
                  width: `${(s.count / maxCount) * 100}%`,
                  height: '100%',
                  background: platformColors[s.platform] || platformColors.default,
                  borderRadius: 'var(--radius)',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
            <div style={{ width: 30, fontSize: 'var(--fs-8)', fontWeight: 700, textAlign: 'right', color: 'var(--text)' }}>{s.count}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

// =============================================================================
// MARKET HEAT INDICATOR
// =============================================================================

interface MarketHeatIndicatorProps {
  totalBids: number;
  totalAuctions: number;
  avgBid: number;
}

const MarketHeatIndicator: React.FC<MarketHeatIndicatorProps> = ({ totalBids, totalAuctions, avgBid }) => {
  // Calculate heat score based on bid activity
  const bidsPerAuction = totalAuctions > 0 ? totalBids / totalAuctions : 0;

  let heat: 'cold' | 'soft' | 'warm' | 'hot' | 'fire';
  let heatColor: string;
  let heatBg: string;

  if (bidsPerAuction >= 40) {
    heat = 'fire';
    heatColor = '#ef4444';
    heatBg = '#fef2f2';
  } else if (bidsPerAuction >= 25) {
    heat = 'hot';
    heatColor = '#f97316';
    heatBg = '#fff7ed';
  } else if (bidsPerAuction >= 15) {
    heat = 'warm';
    heatColor = '#f59e0b';
    heatBg = '#fef3c7';
  } else if (bidsPerAuction >= 8) {
    heat = 'soft';
    heatColor = '#3b82f6';
    heatBg = '#eff6ff';
  } else {
    heat = 'cold';
    heatColor = '#6b7280';
    heatBg = '#f3f4f6';
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: 'var(--space-2) var(--space-3)',
        background: heatBg,
        border: '2px solid var(--border)',
        borderRadius: 'var(--radius)',
        marginTop: 'var(--space-3)',
      }}
    >
      <div
        style={{
          fontSize: 'var(--fs-12)',
          fontWeight: 900,
          color: heatColor,
          textTransform: 'uppercase',
        }}
      >
        {heat === 'fire' ? 'FIRE' : heat === 'hot' ? 'HOT' : heat === 'warm' ? 'WARM' : heat === 'soft' ? 'SOFT' : 'COLD'}
      </div>
      <div style={{ fontSize: 'var(--fs-9)', color: 'var(--text-secondary)', flex: 1 }}>
        {bidsPerAuction.toFixed(1)} bids/auction avg
      </div>
      <div style={{ fontSize: 'var(--fs-10)', fontWeight: 700, color: 'var(--text)' }}>
        ${(avgBid / 1000).toFixed(0)}K avg
      </div>
    </div>
  );
};

// =============================================================================
// AUCTION CARD COMPONENT (Enhanced)
// =============================================================================

interface AuctionCardProps {
  listing: AuctionListing;
  onNavigate?: () => void;
}

const AuctionCard: React.FC<AuctionCardProps> = ({ listing, onNavigate }) => {
  const vehicle = listing.vehicle;
  const title = vehicle
    ? `${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim()
    : 'Vehicle';

  const rawImg = vehicle?.primary_image_url || vehicle?.image_url || '';
  const img = rawImg ? optimizeImageUrl(rawImg, 'thumbnail') || rawImg : '/n-zero.png';

  const formatCurrency = (value: number | null) => {
    if (!value) return '$0';
    if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
    return `$${value.toLocaleString()}`;
  };

  const platformFavicons: Record<string, string> = {
    bat: 'https://bringatrailer.com',
    cars_and_bids: 'https://carsandbids.com',
    pcarmarket: 'https://pcarmarket.com',
    ebay_motors: 'https://ebay.com',
    mecum: 'https://mecum.com',
    hagerty: 'https://hagerty.com',
  };

  const getPlatformLabel = (platform: string) => {
    const labels: Record<string, string> = {
      bat: 'BaT',
      cars_and_bids: 'C&B',
      pcarmarket: 'PCM',
      ebay_motors: 'eBay',
      mecum: 'Mecum',
      hagerty: 'Hagerty',
    };
    return labels[platform] || platform.toUpperCase();
  };

  return (
    <div
      style={{
        flex: '0 0 auto',
        width: 180,
        border: '2px solid var(--border)',
        background: 'var(--surface)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'transform 0.2s, box-shadow 0.2s',
      }}
      onClick={onNavigate}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      {/* Image with tier badge overlay */}
      <div style={{ width: '100%', paddingBottom: '66%', background: 'var(--surface-hover)', position: 'relative' }}>
        <img
          src={img}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
        {/* Tier badge */}
        <div style={{ position: 'absolute', top: 6, left: 6 }}>
          <TierBadge bid={listing.current_bid} bidCount={listing.bid_count} />
        </div>
        {/* Platform badge - circle with favicon centered */}
        <div
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <FaviconIcon
            url={platformFavicons[listing.platform] || ''}
            size={14}
            circleBadge={true}
            circleBadgeBg="rgba(0,0,0,0.8)"
          />
          <span
            style={{
              fontSize: '8px',
              fontWeight: 700,
              color: 'white',
              background: 'rgba(0,0,0,0.7)',
              padding: '2px 5px',
              borderRadius: 3,
              textShadow: '0 1px 2px rgba(0,0,0,0.5)',
            }}
          >
            {getPlatformLabel(listing.platform)}
          </span>
        </div>
        {/* Countdown overlay at bottom */}
        {listing.end_date && (
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '4px', background: 'rgba(0,0,0,0.6)' }}>
            <CountdownTimer endDate={listing.end_date} size="small" />
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ padding: '8px' }}>
        {/* Title */}
        <div
          style={{
            fontSize: '10px',
            fontWeight: 700,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            marginBottom: 4,
          }}
          title={title}
        >
          {title}
        </div>

        {/* Bid info row - with subtle visual interest */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 4,
            padding: '6px 8px',
            background: 'linear-gradient(135deg, rgba(5, 150, 105, 0.06) 0%, rgba(5, 150, 105, 0.02) 100%)',
            borderRadius: 6,
            border: '1px solid rgba(5, 150, 105, 0.15)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
            <span style={{ fontSize: '12px', fontWeight: 900, color: '#059669' }}>
              {formatCurrency(listing.current_bid)}
            </span>
            <BidTrend current={listing.current_bid} />
          </div>
          <div
            style={{
              fontSize: '9px',
              fontWeight: 600,
              color: '#059669',
              background: 'rgba(5, 150, 105, 0.12)',
              padding: '2px 7px',
              borderRadius: 10,
              border: '1px solid rgba(5, 150, 105, 0.2)',
            }}
            title="Total bids"
          >
            {listing.bid_count} bids
          </div>
        </div>

        {/* Engagement stats */}
        <div style={{ display: 'flex', gap: 'var(--space-2)', fontSize: 'var(--fs-8)', color: 'var(--text-secondary)' }}>
          {listing.watcher_count > 0 && <span title="Watchers">{listing.watcher_count} watching</span>}
          {listing.view_count > 0 && <span title="Views">{listing.view_count.toLocaleString()} views</span>}
        </div>

        {/* CTA Button - design system framing */}
        <button
          style={{
            width: '100%',
            marginTop: 'var(--space-2)',
            padding: 'var(--space-2) var(--space-2)',
            background: 'var(--surface)',
            color: 'var(--text)',
            border: '2px solid var(--border)',
            borderRadius: 'var(--radius)',
            fontSize: 'var(--fs-9)',
            fontWeight: 700,
            cursor: 'pointer',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (listing.listing_url) {
              window.open(listing.listing_url, '_blank');
            }
          }}
        >
          View Auction
        </button>
      </div>
    </div>
  );
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

const PAGE_SIZE = 50;

const ActiveAuctionsPanel: React.FC<ActiveAuctionsPanelProps> = ({ onClose, onNavigateToVehicle }) => {
  const [listings, setListings] = useState<AuctionListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<'ending_soon' | 'most_bids' | 'highest_bid'>('ending_soon');
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const nowIso = useMemo(() => new Date().toISOString(), []);

  const fetchPage = React.useCallback(async (pageIndex: number, append: boolean) => {
    const from = pageIndex * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data: extListings, error: extErr } = await supabase
      .from('external_listings')
      .select(`
        id,
        vehicle_id,
        platform,
        listing_url,
        listing_status,
        current_bid,
        bid_count,
        watcher_count,
        view_count,
        end_date,
        start_date,
        updated_at
      `)
      .eq('listing_status', 'active')
      .gt('end_date', nowIso)
      .order('end_date', { ascending: true })
      .range(from, to);

    if (extErr) throw extErr;

    if (!extListings || extListings.length === 0) {
      return [];
    }

    const vehicleIds = [...new Set(extListings.map((l) => l.vehicle_id))];
    const { data: vehicles } = await supabase
      .from('vehicles')
      .select('id, year, make, model, primary_image_url, image_url')
      .in('id', vehicleIds);

    const vehicleMap = new Map((vehicles || []).map((v) => [v.id, v]));

    return extListings.map((l) => ({
      ...l,
      vehicle: vehicleMap.get(l.vehicle_id) || undefined,
    }));
  }, [nowIso]);

  // Initial load + refresh: fetch first page, order by ending soonest
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);

        const [merged, countRes] = await Promise.all([
          fetchPage(0, false),
          supabase
            .from('external_listings')
            .select('id', { count: 'exact', head: true })
            .eq('listing_status', 'active')
            .gt('end_date', nowIso),
        ]);

        if (cancelled) return;

        setListings(merged);
        setPage(1);
        setHasMore(merged.length === PAGE_SIZE);
        setTotalCount(countRes.count ?? null);
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load auctions');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();

    const interval = setInterval(() => {
      fetchPage(0, false).then((merged) => {
        if (cancelled) return;
        setListings((prev) => (prev.length <= PAGE_SIZE ? merged : prev));
      }).catch(() => {});
    }, 60000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [fetchPage, nowIso]);

  const loadMore = React.useCallback(async () => {
    if (loadingMore || !hasMore) return;
    try {
      setLoadingMore(true);
      const next = await fetchPage(page, true);
      setListings((prev) => [...prev, ...next]);
      setPage((p) => p + 1);
      setHasMore(next.length === PAGE_SIZE);
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [fetchPage, loadingMore, hasMore, page]);

  // Infinite scroll: when sentinel is visible, load more
  useEffect(() => {
    if (!hasMore || loadingMore || loading) return;

    const el = loadMoreRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { root: scrollContainerRef.current, rootMargin: '200px', threshold: 0.1 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, loading, loadMore]);

  // Calculate platform stats
  const platformStats = useMemo((): PlatformStats[] => {
    const byPlatform = new Map<string, { count: number; totalBids: number; totalValue: number }>();

    for (const l of listings) {
      const existing = byPlatform.get(l.platform) || { count: 0, totalBids: 0, totalValue: 0 };
      existing.count++;
      existing.totalBids += l.bid_count || 0;
      existing.totalValue += l.current_bid || 0;
      byPlatform.set(l.platform, existing);
    }

    return Array.from(byPlatform.entries())
      .map(([platform, stats]) => ({
        platform,
        count: stats.count,
        totalBids: stats.totalBids,
        avgBid: stats.count > 0 ? stats.totalValue / stats.count : 0,
      }))
      .sort((a, b) => b.count - a.count);
  }, [listings]);

  // Overall stats
  const overallStats = useMemo(() => {
    const totalBids = listings.reduce((sum, l) => sum + (l.bid_count || 0), 0);
    const totalValue = listings.reduce((sum, l) => sum + (l.current_bid || 0), 0);
    return {
      totalAuctions: listings.length,
      totalBids,
      avgBid: listings.length > 0 ? totalValue / listings.length : 0,
    };
  }, [listings]);

  // Sort listings
  const sortedListings = useMemo(() => {
    const sorted = [...listings];
    switch (sortBy) {
      case 'ending_soon':
        return sorted.sort((a, b) => {
          const aEnd = a.end_date ? new Date(a.end_date).getTime() : Infinity;
          const bEnd = b.end_date ? new Date(b.end_date).getTime() : Infinity;
          return aEnd - bEnd;
        });
      case 'most_bids':
        return sorted.sort((a, b) => (b.bid_count || 0) - (a.bid_count || 0));
      case 'highest_bid':
        return sorted.sort((a, b) => (b.current_bid || 0) - (a.current_bid || 0));
      default:
        return sorted;
    }
  }, [listings, sortBy]);

  const displayListings = sortedListings;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        zIndex: 20000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: 'var(--space-4)',
        overflowY: 'auto',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '1200px',
          background: 'var(--surface)',
          border: '2px solid var(--border)',
          borderRadius: 'var(--radius)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          marginTop: 'var(--space-6)',
          marginBottom: 'var(--space-6)',
          overflow: 'hidden',
          transition: 'max-width 0.3s ease',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header - matches .card-header framing */}
        <div
          style={{
            padding: 'var(--space-3) var(--space-4)',
            borderBottom: '2px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--surface)',
            color: 'var(--text)',
          }}
        >
          <div>
            <div style={{ fontSize: 'var(--fs-12)', fontWeight: 900, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span style={{ animation: 'pulse 2s infinite' }}>LIVE</span>
              Active Auctions
              <span
                style={{
                  fontSize: 'var(--fs-10)',
                  fontWeight: 700,
                  background: 'var(--surface-hover)',
                  padding: '2px var(--space-2)',
                  borderRadius: 'var(--radius)',
                  border: '1px solid var(--border)',
                }}
              >
                {totalCount != null ? `${listings.length}${totalCount > listings.length ? ` / ${totalCount}` : ''}` : listings.length}
              </span>
            </div>
            <div style={{ fontSize: 'var(--fs-10)', color: 'var(--text-secondary)', marginTop: 2 }}>
              Real-time auction data from BaT, C&B, PCM, and more
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <button
              onClick={onClose}
              style={{
                width: 28,
                height: 28,
                background: 'var(--surface)',
                border: '2px solid var(--border)',
                borderRadius: 'var(--radius)',
                color: 'var(--text)',
                fontSize: 'var(--fs-12)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              x
            </button>
          </div>
        </div>

        {/* Content - matches .card-body framing */}
        <div style={{ padding: 'var(--space-4) var(--space-5)' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--text-secondary)' }}>Loading auctions...</div>
          ) : error ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--error)' }}>{error}</div>
          ) : listings.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--text-secondary)' }}>No active auctions found</div>
          ) : (
            <>
              {/* Market Overview - framed sections */}
              <div style={{ display: 'flex', gap: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
                {/* Platform breakdown */}
                <div
                  style={{
                    flex: 1,
                    border: '2px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    background: 'var(--surface)',
                    padding: 'var(--space-3)',
                  }}
                >
                  <PlatformBreakdownChart stats={platformStats} />
                </div>
                {/* Market heat */}
                <div style={{ flex: 1 }}>
                  <MarketHeatIndicator
                    totalBids={overallStats.totalBids}
                    totalAuctions={overallStats.totalAuctions}
                    avgBid={overallStats.avgBid}
                  />
                  {/* Quick stats */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: 'var(--space-2)',
                      marginTop: 'var(--space-3)',
                    }}
                  >
                    <div
                      style={{
                        textAlign: 'center',
                        padding: 'var(--space-2)',
                        background: 'var(--surface)',
                        border: '2px solid var(--border)',
                        borderRadius: 'var(--radius)',
                      }}
                    >
                      <div style={{ fontSize: 'var(--fs-12)', fontWeight: 900, color: 'var(--text)' }}>{overallStats.totalAuctions}</div>
                      <div style={{ fontSize: 'var(--fs-8)', color: 'var(--text-secondary)' }}>AUCTIONS</div>
                    </div>
                    <div
                      style={{
                        textAlign: 'center',
                        padding: 'var(--space-2)',
                        background: 'var(--surface)',
                        border: '2px solid var(--border)',
                        borderRadius: 'var(--radius)',
                      }}
                    >
                      <div style={{ fontSize: 'var(--fs-12)', fontWeight: 900, color: 'var(--text)' }}>{overallStats.totalBids.toLocaleString()}</div>
                      <div style={{ fontSize: 'var(--fs-8)', color: 'var(--text-secondary)' }}>TOTAL BIDS</div>
                    </div>
                    <div
                      style={{
                        textAlign: 'center',
                        padding: 'var(--space-2)',
                        background: 'var(--surface)',
                        border: '2px solid var(--border)',
                        borderRadius: 'var(--radius)',
                      }}
                    >
                      <div style={{ fontSize: 'var(--fs-12)', fontWeight: 900, color: 'var(--text)' }}>
                        ${(overallStats.avgBid / 1000).toFixed(0)}K
                      </div>
                      <div style={{ fontSize: 'var(--fs-8)', color: 'var(--text-secondary)' }}>AVG BID</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Sort controls */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                <span style={{ fontSize: 'var(--fs-9)', fontWeight: 600, color: 'var(--text-secondary)' }}>SORT:</span>
                {(['ending_soon', 'most_bids', 'highest_bid'] as const).map((option) => (
                  <button
                    key={option}
                    onClick={() => setSortBy(option)}
                    style={{
                      padding: 'var(--space-1) var(--space-2)',
                      fontSize: 'var(--fs-9)',
                      fontWeight: 600,
                      border: `2px solid ${sortBy === option ? 'var(--accent)' : 'var(--border)'}`,
                      background: sortBy === option ? 'var(--accent-dim)' : 'var(--surface)',
                      color: sortBy === option ? 'var(--accent)' : 'var(--text-secondary)',
                      borderRadius: 'var(--radius)',
                      cursor: 'pointer',
                    }}
                  >
                    {option === 'ending_soon' ? 'ENDING SOON' : option === 'most_bids' ? 'MOST BIDS' : 'HIGHEST BID'}
                  </button>
                ))}
              </div>

              {/* Auction cards grid - scrollable, ordered by ending soonest; lazy load more on scroll */}
              <div
                ref={scrollContainerRef}
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 'var(--space-3)',
                  paddingBottom: 'var(--space-2)',
                  maxHeight: 'min(65vh, 600px)',
                  overflowY: 'auto',
                  overflowX: 'hidden',
                }}
              >
                {displayListings.map((listing) => (
                  <AuctionCard
                    key={listing.id}
                    listing={listing}
                    onNavigate={() => {
                      if (onNavigateToVehicle) {
                        onNavigateToVehicle(listing.vehicle_id);
                        onClose();
                      }
                    }}
                  />
                ))}
                {/* Sentinel for infinite scroll */}
                <div ref={loadMoreRef} style={{ width: '100%', height: 1, minHeight: 1 }} aria-hidden />
              </div>

              {/* Load more button (fallback if IntersectionObserver doesn't fire) */}
              {hasMore && !loading && !loadingMore && displayListings.length > 0 && (
                <div style={{ textAlign: 'center', marginTop: 'var(--space-3)' }}>
                  <button
                    type="button"
                    onClick={loadMore}
                    disabled={loadingMore}
                    style={{
                      padding: 'var(--space-2) var(--space-6)',
                      background: 'var(--surface)',
                      border: '2px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      fontSize: 'var(--fs-10)',
                      fontWeight: 700,
                      cursor: loadingMore ? 'wait' : 'pointer',
                      color: 'var(--text)',
                    }}
                  >
                    {loadingMore ? 'Loading…' : `Load more (${totalCount != null && totalCount > listings.length ? `${listings.length} of ${totalCount}` : 'more'})`}
                  </button>
                </div>
              )}
              {loadingMore && (
                <div style={{ textAlign: 'center', padding: 'var(--space-2)', fontSize: 'var(--fs-9)', color: 'var(--text-secondary)' }}>
                  Loading more…
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer - matches design system framing */}
        <div
          style={{
            padding: 'var(--space-3) var(--space-4)',
            borderTop: '2px solid var(--border)',
            background: 'var(--surface-hover)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 'var(--fs-9)',
            color: 'var(--text-secondary)',
          }}
        >
          <div>Updated every 60 seconds. Prices and bid counts from source platforms.</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
            <span style={{ width: 6, height: 6, background: 'var(--success)', borderRadius: '50%' }} />
            <span>Live</span>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
};

export default ActiveAuctionsPanel;

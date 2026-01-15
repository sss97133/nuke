import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { Link, useNavigate } from 'react-router-dom';
import { getVehicleIdentityParts } from '../utils/vehicleIdentity';
import '../design-system.css';

// Add pulse animation for LIVE badge
const liveBadgeStyle = `
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }
`;
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = liveBadgeStyle;
  document.head.appendChild(style);
}

interface AuctionListing {
  id: string;
  vehicle_id: string;
  seller_id?: string;
  sale_type?: string;
  source: 'native' | 'external';
  platform?: string;
  listing_url?: string;
  lead_image_url?: string | null;
  current_high_bid_cents: number | null;
  reserve_price_cents: number | null;
  bid_count: number;
  auction_start_time?: string | null;
  auction_end_time: string | null;
  status: string;
  description?: string;
  created_at: string;
  updated_at?: string | null;
  telemetry_stale?: boolean;
  is_flash?: boolean;
  vehicle: {
    id: string;
    year: number;
    make: string;
    model: string;
    trim: string | null;
    mileage: number | null;
    primary_image_url: string | null;
  };
}

type FilterType = 'all' | 'ending_now' | 'ending_soon' | 'flash' | 'no_reserve' | 'new_listings';
type SortType = 'ending_soon' | 'bid_count' | 'price_low' | 'price_high' | 'newest';

export default function AuctionMarketplace() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [listings, setListings] = useState<AuctionListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');
  const [sort, setSort] = useState<SortType>('ending_soon');
  const [searchQuery, setSearchQuery] = useState('');
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  // Default to including 0-bid auctions so marketplace doesn't look empty while bid_count backfills.
  const [includeNoBidAuctions, setIncludeNoBidAuctions] = useState(true);
  const [hiddenNoBidCount, setHiddenNoBidCount] = useState(0);
  const [debugCounts, setDebugCounts] = useState<{ native: number; external: number; bat: number; total: number } | null>(null);
  const endingNowWindowMs = 15 * 60 * 1000;
  const endingSoonWindowMs = 2 * 60 * 60 * 1000;
  const maxReasonableEndMs = 60 * 24 * 60 * 60 * 1000;
  const nowMs = nowTick;

  useEffect(() => {
    loadListings();
    
    // Subscribe to real-time updates
    let scheduled = false;
    const scheduleReload = () => {
      if (scheduled) return;
      scheduled = true;
      window.setTimeout(() => {
        scheduled = false;
        loadListings();
      }, 750);
    };

    const channel = supabase
      .channel('auction-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'vehicle_listings',
          filter: 'status=eq.active',
        },
        scheduleReload,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'external_listings',
        },
        scheduleReload,
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [filter, sort, includeNoBidAuctions]);

  // Refresh time-left labels + "ending soon" buckets.
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, []);

  const loadListings = async () => {
    setLoading(true);
    const nowIso = new Date().toISOString();
    const nowMsLocal = Date.now();
    const maxReasonableEndMs = 60 * 24 * 60 * 60 * 1000; // 60 days
    const externalStaleMs = 6 * 60 * 60 * 1000; // 6 hours
    const allListings: AuctionListing[] = [];
    let hiddenNoBids = 0;

    try {
      const normalizeEndTime = (params: {
        raw: any;
        source: 'native' | 'external';
        status?: any;
        updatedAt?: any;
      }): { endTime: string | null; isStale: boolean } => {
        const raw = params.raw;
        if (!raw) return { endTime: null, isStale: false };
        const end = new Date(raw);
        if (!Number.isFinite(end.getTime())) return { endTime: null, isStale: false };
        const diff = end.getTime() - nowMsLocal;
        if (diff > maxReasonableEndMs) return { endTime: null, isStale: false };

        let stale = false;
        if (params.source === 'external') {
          const updatedAt = params.updatedAt ? new Date(params.updatedAt) : null;
          if (updatedAt && Number.isFinite(updatedAt.getTime())) {
            stale = nowMsLocal - updatedAt.getTime() > externalStaleMs;
          }
          const status = String(params.status || '').toLowerCase();
          if (['active', 'live'].includes(status) && diff < 0) {
            return { endTime: null, isStale: stale };
          }
          if (status && !['active', 'live'].includes(status) && diff < 0) {
            return { endTime: null, isStale: stale };
          }
          // If telemetry is stale and the end time is already in the past, hide it.
          if (stale && diff < -5 * 60 * 1000) {
            return { endTime: null, isStale: stale };
          }
        }

        return { endTime: end.toISOString(), isStale: stale };
      };

      const isFlashAuction = (start?: string | null, end?: string | null, saleType?: string | null) => {
        if (!start || !end) return false;
        if (saleType !== 'live_auction') return false;
        const s = new Date(start).getTime();
        const e = new Date(end).getTime();
        if (!Number.isFinite(s) || !Number.isFinite(e)) return false;
        const durationMs = e - s;
        return durationMs > 0 && durationMs <= 10 * 60 * 1000;
      };

      const parseTitle = (title: any): { year?: number; make?: string; model?: string; trim?: string | null } => {
        const t = typeof title === 'string' ? title.trim() : '';
        // Best-effort: "<year> <make> <model> <trim...>"
        const m = t.match(/\b(19\d{2}|20\d{2})\s+([A-Za-z0-9]+)\s+(.+)$/);
        if (!m) return {};
        const year = Number(m[1]);
        const make = m[2];
        const rest = (m[3] || '').trim();
        // Split rest into model + optional trim (keep it simple)
        const parts = rest.split(/\s+/);
        const model = parts.slice(0, Math.min(2, parts.length)).join(' ');
        const trim = parts.length > 2 ? parts.slice(2).join(' ') : null;
        return {
          year: Number.isFinite(year) ? year : undefined,
          make: make || undefined,
          model: model || undefined,
          trim,
        };
      };

      const normalizeVehicle = (params: {
        vehicleId: string;
        maybeVehicle: any;
        fallbackTitle?: any;
        fallbackImageUrl?: any;
      }) => {
        const v = params.maybeVehicle || null;
        const titleParts = parseTitle(params.fallbackTitle);
        return {
          id: (v?.id as string) || params.vehicleId,
          year: (typeof v?.year === 'number' && v.year > 0 ? v.year : titleParts.year || 0),
          make: (typeof v?.make === 'string' && v.make ? v.make : titleParts.make || 'Unknown'),
          model: (typeof v?.model === 'string' && v.model ? v.model : titleParts.model || 'Vehicle'),
          trim: (v?.trim ?? titleParts.trim ?? null) as string | null,
          mileage: (typeof v?.mileage === 'number' ? v.mileage : null) as number | null,
          primary_image_url: (v?.primary_image_url ?? params.fallbackImageUrl ?? null) as string | null,
        };
      };

      const hasBidSignal = (params: { bidCount: any; currentHighBidCents: any }) => {
        const n = typeof params.bidCount === 'number' ? params.bidCount : Number(params.bidCount || 0);
        if (Number.isFinite(n) && n > 0) return true;
        const bidCents =
          typeof params.currentHighBidCents === 'number'
            ? params.currentHighBidCents
            : Number(params.currentHighBidCents || 0);
        return Number.isFinite(bidCents) && bidCents > 0;
      };

      // 1. Load native vehicle_listings (N-Zero auctions)
      let nativeQuery = supabase
        .from('vehicle_listings')
        .select(`
          *,
          vehicle:vehicles (
            id,
            year,
            make,
            model,
            trim,
            mileage,
            primary_image_url
          )
        `)
        .eq('status', 'active')
        .in('sale_type', ['auction', 'live_auction']);

      const { data: nativeListings, error: nativeError } = await nativeQuery;

      if (!nativeError && nativeListings) {
        for (const listing of nativeListings) {
          const nativeEndRaw = (listing as any).auction_end_time ?? (listing as any).auction_end_date ?? null;
          const { endTime: nativeEndTime } = normalizeEndTime({
            raw: nativeEndRaw,
            source: 'native',
          });
          const endMs = nativeEndTime ? new Date(nativeEndTime).getTime() : null;
          const isPastLong = endMs !== null && nowMsLocal - endMs > 2 * 60 * 60 * 1000;
          const vehicle = normalizeVehicle({
            vehicleId: listing.vehicle_id,
            maybeVehicle: (listing as any).vehicle,
            fallbackTitle: (listing as any).title,
            fallbackImageUrl: (listing as any).vehicle?.primary_image_url ?? null,
          });

          // Marketplace rule: don't show auctions with no bids.
          if (
            !includeNoBidAuctions &&
            !hasBidSignal({
              bidCount: (listing as any).bid_count,
              currentHighBidCents: (listing as any).current_high_bid_cents,
            })
          ) {
            hiddenNoBids += 1;
            continue;
          }

          // Keep auctions even if end time is missing (some sources backfill it later).
          // Drop only if end time is far in the past (likely stuck).
          if (!isPastLong) {
            allListings.push({
              id: listing.id,
              vehicle_id: listing.vehicle_id,
              seller_id: listing.seller_id,
              sale_type: listing.sale_type,
              source: 'native',
              lead_image_url: vehicle.primary_image_url || null,
              current_high_bid_cents: (listing as any).current_high_bid_cents ?? null,
              reserve_price_cents: listing.reserve_price_cents,
              bid_count: (listing as any).bid_count || 0,
              auction_start_time: (listing as any).auction_start_time ?? null,
              auction_end_time: nativeEndTime,
              status: listing.status,
              description: listing.description,
              created_at: listing.created_at,
              updated_at: (listing as any).updated_at ?? null,
              telemetry_stale: false,
              is_flash: isFlashAuction((listing as any).auction_start_time ?? null, nativeEndTime, listing.sale_type),
              vehicle
            });
          }
        }
      }

      // 2. Load external_listings (BaT, Cars & Bids, eBay Motors, etc.)
      let externalQuery = supabase
        .from('external_listings')
        .select(`
          *,
          vehicle:vehicles (
            id,
            year,
            make,
            model,
            trim,
            mileage,
            primary_image_url
          )
        `)
        // Do not exclude rows with missing/stale end_date; treat 'active' status as primary signal.
        // Show rows that are explicitly active OR have a future end_date.
        .or(`listing_status.eq.active,end_date.gt.${nowIso}`);

      const { data: externalListings, error: externalError } = await externalQuery;

      if (!externalError && externalListings) {
        for (const listing of externalListings) {
          const currentHighBidCents = listing.current_bid ? Math.round(Number(listing.current_bid) * 100) : null;

          // Marketplace rule: don't show auctions with no bids.
          if (
            !includeNoBidAuctions &&
            !hasBidSignal({ bidCount: listing.bid_count, currentHighBidCents })
          ) {
            hiddenNoBids += 1;
            continue;
          }

          // IMPORTANT:
          // We do NOT hard-filter external auctions by end_date here.
          // Many sources (especially live auctions) can have stale/missing end_date while still being active.
          const { endTime: effectiveEndDate, isStale: telemetryStale } = normalizeEndTime({
            raw: listing.end_date,
            source: 'external',
            status: listing.listing_status,
            updatedAt: listing.updated_at,
          });

          const metaImage =
            listing?.metadata?.image_url ||
            listing?.metadata?.primary_image_url ||
            (Array.isArray(listing?.metadata?.images) ? listing.metadata.images[0] : null);
          const vehicle = normalizeVehicle({
            vehicleId: listing.vehicle_id,
            maybeVehicle: (listing as any).vehicle,
            fallbackTitle: listing?.metadata?.bat_title,
            fallbackImageUrl: metaImage,
          });

          allListings.push({
            id: listing.id,
            vehicle_id: listing.vehicle_id,
            source: 'external',
            platform: listing.platform,
            listing_url: listing.listing_url,
            lead_image_url: vehicle.primary_image_url || null,
            current_high_bid_cents: currentHighBidCents,
            reserve_price_cents: listing.reserve_price ? Math.round(Number(listing.reserve_price) * 100) : null,
            bid_count: listing.bid_count || 0,
            auction_end_time: effectiveEndDate,
            status: listing.listing_status,
            created_at: listing.created_at,
            updated_at: listing.updated_at,
            telemetry_stale: telemetryStale,
            is_flash: false,
            vehicle
          });
        }
      }

      // Improve "No Image" cases using vehicle_images for vehicles without a primary image.
      const missingImageVehicleIds = Array.from(
        new Set(
          allListings
            .filter((l) => !l.lead_image_url && !l.vehicle?.primary_image_url)
            .map((l) => l.vehicle_id)
            .filter(Boolean)
        )
      );

      if (missingImageVehicleIds.length > 0) {
        const { data: imageRows, error: imageErr } = await supabase
          .from('vehicle_images')
          .select('vehicle_id, image_url, is_primary, created_at')
          .in('vehicle_id', missingImageVehicleIds)
          .not('is_document', 'is', true)
          .not('is_duplicate', 'is', true)
          .order('is_primary', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(5000);

        if (!imageErr && imageRows && imageRows.length > 0) {
          const bestByVehicle = new Map<string, string>();
          for (const row of imageRows as any[]) {
            const vid = String(row?.vehicle_id || '');
            const url = String(row?.image_url || '');
            if (!vid || !url) continue;
            if (bestByVehicle.has(vid)) continue;
            bestByVehicle.set(vid, url);
          }

          for (const l of allListings) {
            if (!l.lead_image_url && bestByVehicle.has(l.vehicle_id)) {
              l.lead_image_url = bestByVehicle.get(l.vehicle_id) || null;
            }
          }
        }
      }

      // Apply filters
      let filtered = allListings;
      if (filter === 'ending_now') {
        filtered = filtered.filter((l) => {
          if (!l.auction_end_time) return false;
          if (l.telemetry_stale) return false;
          const diff = new Date(l.auction_end_time).getTime() - nowMsLocal;
          return diff >= -2 * 60 * 1000 && diff <= endingNowWindowMs;
        });
      } else if (filter === 'ending_soon') {
        filtered = filtered.filter((l) => {
          if (!l.auction_end_time) return false;
          if (l.telemetry_stale) return false;
          const diff = new Date(l.auction_end_time).getTime() - nowMsLocal;
          return diff >= 0 && diff <= endingSoonWindowMs;
        });
      } else if (filter === 'flash') {
        filtered = filtered.filter((l) => l.source === 'native' && l.is_flash);
      } else if (filter === 'no_reserve') {
        filtered = filtered.filter(l => !l.reserve_price_cents);
      } else if (filter === 'new_listings') {
        const last7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        filtered = filtered.filter(l => l.created_at >= last7Days);
      }

      // Apply sorting
      filtered.sort((a, b) => {
        switch (sort) {
          case 'ending_soon':
            if (a.telemetry_stale && !b.telemetry_stale) return 1;
            if (!a.telemetry_stale && b.telemetry_stale) return -1;
            if (!a.auction_end_time) return 1;
            if (!b.auction_end_time) return -1;
            return new Date(a.auction_end_time).getTime() - new Date(b.auction_end_time).getTime();
          case 'bid_count':
            return (b.bid_count || 0) - (a.bid_count || 0);
          case 'price_low':
            const aPrice = a.current_high_bid_cents || 0;
            const bPrice = b.current_high_bid_cents || 0;
            return aPrice - bPrice;
          case 'price_high':
            const aPriceHigh = a.current_high_bid_cents || 0;
            const bPriceHigh = b.current_high_bid_cents || 0;
            return bPriceHigh - aPriceHigh;
          case 'newest':
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
          default:
            return 0;
        }
      });

      // Show all live auctions on the page (do not truncate to 50).
      setListings(filtered);
      setHiddenNoBidCount(hiddenNoBids);
      const batCount = (externalListings || []).filter((l: any) => String(l?.platform || '').toLowerCase() === 'bat').length;
      setDebugCounts({
        native: nativeListings?.length || 0,
        external: externalListings?.length || 0,
        bat: batCount,
        total: filtered.length,
      });
      console.log(
        `Loaded ${filtered.length} active auction listings (${nativeListings?.length || 0} native, ${externalListings?.length || 0} external)`
      );
    } catch (error) {
      console.error('Error loading listings:', error);
      setListings([]);
      setHiddenNoBidCount(0);
      setDebugCounts(null);
    }

    setLoading(false);
  };

  const formatCurrency = (cents: number | null) => {
    const v = typeof cents === 'number' ? cents : 0;
    const safe = Number.isFinite(v) ? v : 0;
    return `$${(safe / 100).toLocaleString()}`;
  };

  const formatTimeRemaining = (endTime: string | null) => {
    if (!endTime) return '—';
    const now = new Date();
    const end = new Date(endTime);
    const diff = end.getTime() - now.getTime();

    if (!Number.isFinite(diff)) return '—';
    if (diff > maxReasonableEndMs) return '—';
    if (diff <= -6 * 60 * 60 * 1000) return '—';
    if (diff <= 0) return 'Ended';

    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    return `${minutes}m`;
  };

  const getTimeRemainingColor = (endTime: string | null) => {
    if (!endTime) return 'text-gray-600';
    const now = new Date();
    const end = new Date(endTime);
    const diff = end.getTime() - now.getTime();
    const hours = diff / (60 * 60 * 1000);

    if (!Number.isFinite(diff) || diff <= 0 || diff > maxReasonableEndMs) return 'text-gray-600';
    if (hours < 1) return 'text-red-600 font-bold';
    if (hours < 24) return 'text-orange-600 font-semibold';
    return 'text-gray-700';
  };

  const filteredListings = listings.filter(listing => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    const vehicle = listing.vehicle;
    return (
      vehicle.year.toString().includes(query) ||
      vehicle.make.toLowerCase().includes(query) ||
      vehicle.model.toLowerCase().includes(query) ||
      (vehicle.trim && vehicle.trim.toLowerCase().includes(query))
    );
  });

  const liveNowListings = listings.filter((listing) => {
    if (!listing.auction_end_time) return false;
    if (listing.telemetry_stale) return false;
    const diff = new Date(listing.auction_end_time).getTime() - nowMs;
    return diff >= -2 * 60 * 1000 && diff <= endingNowWindowMs;
  });

  const flashListings = liveNowListings.filter((listing) => listing.is_flash);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: 'var(--space-4)' }}>
        {/* Header + filters */}
        <section className="section">
          <div className="card">
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h1 style={{ margin: 0, fontSize: '14pt', fontWeight: 700 }}>Auction Marketplace</h1>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Live auctions across the network.
                </div>
                {!loading && debugCounts && (
                  <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Showing {debugCounts.total} (native {debugCounts.native} · external {debugCounts.external} · BaT {debugCounts.bat})
                  </div>
                )}
                {!loading && hiddenNoBidCount > 0 && !includeNoBidAuctions && (
                  <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '4px' }}>
                    {hiddenNoBidCount} live auctions hidden (0 bids). Enable "Include 0-bid" to show them.
                  </div>
                )}
              </div>
              {user && (
                <button
                  onClick={() => navigate('/auctions/create')}
                  className="button button-primary"
                  style={{ fontSize: '9pt' }}
                >
                  List Your Vehicle
                </button>
              )}
            </div>
            <div className="card-body">
              {/* Search */}
              <div style={{ marginBottom: '12px' }}>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by make, model, year..."
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    border: '1px solid var(--border)',
                    fontSize: '9pt'
                  }}
                />
              </div>

              {/* Filters + Sort */}
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '12px',
                  alignItems: 'center'
                }}
              >
                {/* Include 0-bid toggle */}
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '8pt',
                    color: 'var(--text-secondary)',
                    userSelect: 'none',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={includeNoBidAuctions}
                    onChange={(e) => setIncludeNoBidAuctions(e.target.checked)}
                    style={{ transform: 'translateY(0.5px)' }}
                  />
                  Include 0-bid auctions
                </label>

                {/* Filter buttons */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {[
                    { id: 'all', label: 'All Auctions' },
                    { id: 'ending_now', label: 'Ending Now (≤15m)' },
                    { id: 'ending_soon', label: 'Ending Soon (≤2h)' },
                    { id: 'flash', label: 'Flash Auctions' },
                    { id: 'no_reserve', label: 'No Reserve' },
                    { id: 'new_listings', label: 'New Listings' }
                  ].map(option => (
                    <button
                      key={option.id}
                      onClick={() => setFilter(option.id as FilterType)}
                      style={{
                        padding: '4px 10px',
                        fontSize: '8pt',
                        border: filter === option.id ? '2px solid var(--accent)' : '1px solid var(--border)',
                        background: filter === option.id ? 'var(--accent-dim)' : 'var(--white)',
                        color: filter === option.id ? 'var(--accent)' : 'var(--text)',
                        cursor: 'pointer',
                        borderRadius: '2px',
                        fontWeight: filter === option.id ? 700 : 400
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                {/* Sort dropdown */}
                <div style={{ marginLeft: 'auto', minWidth: '180px' }}>
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as SortType)}
                    style={{
                      width: '100%',
                      padding: '6px 10px',
                      fontSize: '8pt',
                      border: '1px solid var(--border)'
                    }}
                  >
                    <option value="ending_soon">Ending Soon</option>
                    <option value="bid_count">Most Bids</option>
                    <option value="price_low">Price: Low to High</option>
                    <option value="price_high">Price: High to Low</option>
                    <option value="newest">Newest First</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Live Now strip */}
        {liveNowListings.length > 0 && (
          <section className="section">
            <div className="card">
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '9pt', fontWeight: 800, color: 'var(--text)' }}>LIVE NOW</span>
                  <span style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                    Ending in the next 15 minutes ({liveNowListings.length})
                  </span>
                  {flashListings.length > 0 && (
                    <span style={{ fontSize: '7pt', fontWeight: 800, color: '#dc2626' }}>
                      FLASH {flashListings.length}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="button button-small"
                  style={{ fontSize: '8pt' }}
                  onClick={() => {
                    setFilter('ending_now');
                    setSort('ending_soon');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                >
                  View all ending now
                </button>
              </div>
              <div className="card-body">
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                    gap: '12px',
                  }}
                >
                  {liveNowListings.slice(0, 6).map((listing) => (
                    <AuctionCard
                      key={`live-${listing.id}`}
                      listing={listing}
                      formatCurrency={formatCurrency}
                      formatTimeRemaining={formatTimeRemaining}
                      getTimeRemainingColor={getTimeRemainingColor}
                    />
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Listings */}
        <section className="section">
          <div className="card">
            <div className="card-body">
              {loading ? (
                <div className="text-center" style={{ padding: 'var(--space-6) 0', fontSize: 'var(--fs-9)', color: 'var(--text-secondary)' }}>
                  Loading auctions...
                </div>
              ) : filteredListings.length === 0 ? (
                <div className="text-center" style={{ padding: 'var(--space-6) 0' }}>
                  <div style={{ fontSize: '10pt', marginBottom: '8px' }}>
                    {includeNoBidAuctions ? 'No live auctions found' : 'No auctions with bids found'}
                  </div>
                  {user && (
                    <button
                      onClick={() => navigate('/auctions/create')}
                      className="button button-primary"
                      style={{ fontSize: '9pt' }}
                    >
                      List a Vehicle
                    </button>
                  )}
                </div>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: '16px'
                  }}
                >
                  {filteredListings.map((listing) => (
                    <AuctionCard
                      key={listing.id}
                      listing={listing}
                      formatCurrency={formatCurrency}
                      formatTimeRemaining={formatTimeRemaining}
                      getTimeRemainingColor={getTimeRemainingColor}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

interface AuctionCardProps {
  listing: AuctionListing;
  formatCurrency: (cents: number | null) => string;
  formatTimeRemaining: (endTime: string | null) => string;
  getTimeRemainingColor: (endTime: string | null) => string;
}

function AuctionCard({ listing, formatCurrency, formatTimeRemaining, getTimeRemainingColor }: AuctionCardProps) {
  const vehicle = listing.vehicle;
  const hasReserve = listing.reserve_price_cents !== null;
  const platformName = listing.platform === 'bat' ? 'BaT' : 
                       listing.platform === 'cars_and_bids' ? 'Cars & Bids' :
                       listing.platform === 'ebay_motors' ? 'eBay Motors' :
                       listing.platform ? listing.platform.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()) : null;
  const isStale = Boolean(listing.telemetry_stale);
  const endMs = listing.auction_end_time ? new Date(listing.auction_end_time).getTime() : null;
  const statusLower = String(listing.status || '').toLowerCase();
  const isLive = !isStale && (
    (endMs !== null ? endMs > Date.now() : (statusLower === 'active' || statusLower === 'live'))
  );
  const bidCountSuspicious =
    listing.source === 'external' &&
    typeof listing.bid_count === 'number' &&
    listing.bid_count > 250 &&
    !(listing.current_high_bid_cents && listing.current_high_bid_cents > 0);
  const bidCountDisplay = isStale || bidCountSuspicious ? '—' : listing.bid_count;
  const bidCountLabel = isStale ? 'bids' : listing.bid_count === 1 ? 'bid' : 'bids';

  const imageUrl = listing.lead_image_url || vehicle.primary_image_url || null;
  const isBat = listing.platform === 'bat';
  const [batIconOk, setBatIconOk] = useState(true);
  const platformBadgeContent = isBat ? (
    batIconOk ? (
      <img
        src="/vendor/bat/favicon.ico"
        alt="BaT"
        style={{
          width: 12,
          height: 12,
          display: 'block',
          imageRendering: 'auto',
        }}
        onError={() => setBatIconOk(false)}
      />
    ) : (
      'BaT'
    )
  ) : (
    platformName
  );

  return (
    <Link
      to={`/vehicle/${vehicle.id}`}
      style={{
        display: 'block',
        background: 'var(--surface)',
        border: '2px solid var(--border)',
        borderRadius: '4px',
        overflow: 'hidden',
        textDecoration: 'none',
        color: 'inherit',
        transition: 'all 0.12s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--text)';
        e.currentTarget.style.boxShadow = '0 4px 10px rgba(0,0,0,0.12)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      {/* Image */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          paddingBottom: '75%',
          backgroundColor: 'var(--surface-hover)',
          overflow: 'hidden',
        }}
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        ) : (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '10pt',
              color: 'var(--text-secondary)',
            }}
          >
            No Image
          </div>
        )}

        {/* Top-left badges */}
        {(!hasReserve || listing.is_flash || isStale) && (
          <div style={{ position: 'absolute', top: '6px', left: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {!hasReserve && (
              <div
                style={{
                  background: '#ea580c',
                  color: '#fff',
                  padding: '3px 8px',
                  borderRadius: '3px',
                  fontSize: '7pt',
                  fontWeight: 700,
                }}
              >
                NO RESERVE
              </div>
            )}
            {listing.is_flash && (
              <div
                style={{
                  background: '#dc2626',
                  color: '#fff',
                  padding: '3px 8px',
                  borderRadius: '3px',
                  fontSize: '7pt',
                  fontWeight: 800,
                  letterSpacing: '0.5px',
                }}
              >
                FLASH
              </div>
            )}
            {isStale && (
              <div
                style={{
                  background: '#475569',
                  color: '#fff',
                  padding: '3px 8px',
                  borderRadius: '3px',
                  fontSize: '7pt',
                  fontWeight: 700,
                }}
              >
                STALE
              </div>
            )}
          </div>
        )}

        {/* LIVE badge - show for active auctions */}
        {isLive && (
          <div
            style={{
              position: 'absolute',
              top: '6px',
              right: '6px',
              background: '#dc2626',
              color: '#fff',
              padding: '3px 8px',
              borderRadius: '3px',
              fontSize: '7pt',
              fontWeight: 700,
              animation: 'pulse 2s infinite',
            }}
          >
            LIVE
          </div>
        )}

        {/* Platform badge */}
        {platformName && (
          <div
            style={{
              position: 'absolute',
              top: isLive ? '28px' : '6px',
              right: '6px',
              background: listing.platform === 'bat' ? '#1e40af' : '#dc2626',
              color: '#fff',
              padding: isBat ? '2px 8px' : '3px 8px',
              borderRadius: '3px',
              fontSize: '7pt',
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title={platformName || undefined}
          >
            {platformBadgeContent}
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ padding: '10px 12px' }}>
        <h3
          style={{
            fontSize: '10pt',
            fontWeight: 700,
            margin: '0 0 4px 0',
          }}
        >
          {(() => {
            const identity = getVehicleIdentityParts(vehicle as any);
            const primary = identity.primary.join(' ');
            const diffs = identity.differentiators;
            return `${primary || 'Vehicle'}${diffs.length > 0 ? ` • ${diffs.join(' • ')}` : ''}`;
          })()}
        </h3>

        {vehicle.mileage && (
          <div
            style={{
              fontSize: '8pt',
              color: 'var(--text-secondary)',
              marginBottom: '6px',
            }}
          >
            {vehicle.mileage.toLocaleString()} miles
          </div>
        )}

        {/* Bid + time row */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: '6px',
            borderTop: '1px solid var(--border)',
            marginTop: '4px',
          }}
        >
          <div>
            <div style={{ fontSize: '10pt', fontWeight: 800, color: 'var(--accent)', whiteSpace: 'nowrap' }}>
              {formatCurrency(listing.current_high_bid_cents)}
            </div>
            {isStale && (
              <div style={{ fontSize: '7pt', color: '#b45309', fontWeight: 700, marginTop: '2px' }}>
                Telemetry stale
              </div>
            )}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div
              style={{
                fontSize: '7pt',
                color: 'var(--text-secondary)',
                marginBottom: '2px',
              }}
            >
              Time Left
            </div>
            <div
              style={{
                fontSize: '8pt',
                fontWeight: 600,
              }}
              className={isStale ? 'text-gray-600' : getTimeRemainingColor(listing.auction_end_time)}
            >
              {isStale ? '—' : formatTimeRemaining(listing.auction_end_time)}
            </div>
          </div>
        </div>

        {/* Footer row with bids / reserve */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '6px',
            fontSize: '8pt',
            color: 'var(--text-secondary)',
          }}
        >
          <span>
            <span
              title={bidCountSuspicious ? 'Bid count looks suspect (external telemetry). Refresh pending.' : undefined}
              style={bidCountSuspicious ? { color: '#b45309', fontWeight: 700 } : undefined}
            >
              {bidCountDisplay} {bidCountLabel}
            </span>
          </span>
          {hasReserve && <span>Reserve</span>}
        </div>

        {listing.listing_url && (
          <button
            type="button"
            className="button button-small"
            style={{ marginTop: '8px', width: '100%', fontSize: '8pt' }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              window.open(listing.listing_url!, '_blank');
            }}
          >
            View on {platformName || 'source'}
          </button>
        )}
      </div>
    </Link>
  );
}


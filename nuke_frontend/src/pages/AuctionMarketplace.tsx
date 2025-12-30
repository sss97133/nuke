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
  source: 'native' | 'external' | 'bat';
  platform?: string;
  listing_url?: string;
  lead_image_url?: string | null;
  current_high_bid_cents: number | null;
  reserve_price_cents: number | null;
  bid_count: number;
  auction_end_time: string | null;
  status: string;
  description?: string;
  created_at: string;
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

type FilterType = 'all' | 'ending_soon' | 'no_reserve' | 'new_listings';
type SortType = 'ending_soon' | 'bid_count' | 'price_low' | 'price_high' | 'newest';

export default function AuctionMarketplace() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [listings, setListings] = useState<AuctionListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');
  const [sort, setSort] = useState<SortType>('ending_soon');
  const [searchQuery, setSearchQuery] = useState('');
  // Default to including 0-bid auctions so marketplace doesn't look empty while bid_count backfills.
  const [includeNoBidAuctions, setIncludeNoBidAuctions] = useState(true);
  const [hiddenNoBidCount, setHiddenNoBidCount] = useState(0);
  const [debugCounts, setDebugCounts] = useState<{ native: number; external: number; bat: number; total: number } | null>(null);

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
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bat_listings',
        },
        scheduleReload,
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [filter, sort, includeNoBidAuctions]);

  const loadListings = async () => {
    setLoading(true);
    const now = new Date().toISOString();
    const allListings: AuctionListing[] = [];
    let hiddenNoBids = 0;

    try {
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
          const nativeEndTime = (listing as any).auction_end_time ?? (listing as any).auction_end_date ?? null;
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
          if (!nativeEndTime || new Date(nativeEndTime) > new Date()) {
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
              auction_end_time: nativeEndTime,
              status: listing.status,
              description: listing.description,
              created_at: listing.created_at,
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
        .or(`listing_status.eq.active,end_date.gt.${new Date().toISOString()}`);

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

          // If the auction is active but end_date is in the past (stale), treat end time as unknown.
          const endDate = listing.end_date ? new Date(listing.end_date) : null;
          const endDateOk = !!(endDate && Number.isFinite(endDate.getTime()) && endDate > new Date());
          const effectiveEndDate = endDateOk ? listing.end_date : null;

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
            vehicle
          });
        }
      }

      // 3. Load bat_listings (BaT-specific listings)
      const today = now.split('T')[0];
      let batQuery = supabase
        .from('bat_listings')
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
        // Some BaT ingests use 'live' for active auctions
        .in('listing_status', ['active', 'live']);

      const { data: batListings, error: batError } = await batQuery;

      if (!batError && batListings) {
        for (const listing of batListings) {
          const currentHighBidCents = (listing.current_bid ?? listing.final_bid)
            ? Math.round(Number(listing.current_bid ?? listing.final_bid) * 100)
            : null;

          // Marketplace rule: don't show auctions with no bids.
          if (
            !includeNoBidAuctions &&
            !hasBidSignal({ bidCount: listing.bid_count, currentHighBidCents })
          ) {
            hiddenNoBids += 1;
            continue;
          }

          // BaT rows are often missing auction_end_date; do not hide the auction just because end date is missing.
          // If present but stale, treat as unknown end time.
          let endDateTime: string | null = null;
          if (listing.auction_end_date) {
            const endDate = new Date(listing.auction_end_date);
            endDate.setHours(23, 59, 59, 999);
            const iso = endDate.toISOString();
            if (new Date(iso) > new Date()) endDateTime = iso;
          }

          const fallbackTitle = (listing as any).bat_listing_title || (listing as any)?.raw_data?.bat_title || null;
          const fallbackImageUrl =
            (listing as any).image_url ||
            (listing as any).primary_image_url ||
            (listing as any)?.raw_data?.image_url ||
            null;
          const vehicle = normalizeVehicle({
            vehicleId: listing.vehicle_id,
            maybeVehicle: (listing as any).vehicle,
            fallbackTitle,
            fallbackImageUrl,
          });
          allListings.push({
            id: listing.id,
            vehicle_id: listing.vehicle_id,
            source: 'bat',
            platform: 'bat',
            listing_url: listing.bat_listing_url,
            lead_image_url: vehicle.primary_image_url || null,
            current_high_bid_cents: currentHighBidCents,
            reserve_price_cents: listing.reserve_price ? listing.reserve_price * 100 : null,
            bid_count: listing.bid_count || 0,
            auction_end_time: endDateTime,
            status: listing.listing_status,
            created_at: listing.created_at,
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
      if (filter === 'ending_soon') {
        const next24Hours = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        filtered = filtered.filter(l => l.auction_end_time && new Date(l.auction_end_time) <= new Date(next24Hours));
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
      setDebugCounts({
        native: nativeListings?.length || 0,
        external: externalListings?.length || 0,
        bat: batListings?.length || 0,
        total: filtered.length,
      });
      console.log(
        `Loaded ${filtered.length} active auction listings (${nativeListings?.length || 0} native, ${externalListings?.length || 0} external, ${batListings?.length || 0} BaT)`
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
    if (!endTime) return 'N/A';
    const now = new Date();
    const end = new Date(endTime);
    const diff = end.getTime() - now.getTime();

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
                  onClick={() => navigate('/list-vehicle')}
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
                    { id: 'ending_soon', label: 'Ending Soon' },
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

        {/* Listings */}
        <section className="section">
          <div className="card">
            <div className="card-body">
              {loading ? (
                <div style={{ textAlign: 'center', padding: '40px 0', fontSize: '9pt', color: 'var(--text-muted)' }}>
                  Loading auctions...
                </div>
              ) : filteredListings.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 0' }}>
                  <div style={{ fontSize: '10pt', marginBottom: '8px' }}>
                    {includeNoBidAuctions ? 'No live auctions found' : 'No auctions with bids found'}
                  </div>
                  {user && (
                    <button
                      onClick={() => navigate('/list-vehicle')}
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

        {/* LIVE badge - show for active auctions */}
        {listing.auction_end_time && new Date(listing.auction_end_time) > new Date() && (
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

        {/* Platform badge - show below LIVE if both exist */}
        {platformName && listing.auction_end_time && new Date(listing.auction_end_time) > new Date() && (
          <div
            style={{
              position: 'absolute',
              top: '28px',
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

        {/* Platform badge - show in top-right if not live */}
        {platformName && (!listing.auction_end_time || new Date(listing.auction_end_time) <= new Date()) && (
          <div
            style={{
              position: 'absolute',
              top: '6px',
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

        {/* No Reserve badge */}
        {!hasReserve && (
          <div
            style={{
              position: 'absolute',
              top: '6px',
              left: '6px',
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
              className={getTimeRemainingColor(listing.auction_end_time)}
            >
              {formatTimeRemaining(listing.auction_end_time)}
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
            {listing.bid_count} {listing.bid_count === 1 ? 'bid' : 'bids'}
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


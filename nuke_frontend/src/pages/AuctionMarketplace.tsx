import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { Link } from 'react-router-dom';
import { getVehicleIdentityParts } from '../utils/vehicleIdentity';
import { formatCurrencyFromCents, resolveCurrencyCode } from '../utils/currency';
import '../styles/unified-design-system.css';

const AUCTION_PLATFORMS = [
  'bat', 'cars_and_bids', 'collecting_cars', 'broad_arrow',
  'rmsothebys', 'gooding', 'sbx', 'barrettjackson', 'mecum',
] as const;

const PLATFORM_LABELS: Record<string, string> = {
  bat: 'BAT',
  cars_and_bids: 'C&B',
  collecting_cars: 'CC',
  broad_arrow: 'BA',
  rmsothebys: 'RM',
  gooding: 'GOODING',
  sbx: 'SBX',
  barrettjackson: 'B-J',
  mecum: 'MECUM',
};

const PLATFORM_NAMES: Record<string, string> = {
  bat: 'Bring a Trailer',
  cars_and_bids: 'Cars & Bids',
  collecting_cars: 'Collecting Cars',
  broad_arrow: 'Broad Arrow',
  rmsothebys: 'RM Sotheby\'s',
  gooding: 'Gooding & Co',
  sbx: 'SBX Cars',
  barrettjackson: 'Barrett-Jackson',
  mecum: 'Mecum',
};

interface LiveAuction {
  id: string;
  vehicle_id: string;
  platform: string;
  source_url: string | null;
  end_time: string | null;
  current_price_cents: number | null;
  currency_code: string | null;
  bid_count: number;
  comment_count: number | null;
  no_reserve: boolean;
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

type SortType = 'ending_soon' | 'most_bids' | 'price_low' | 'price_high' | 'newest';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

export default function AuctionMarketplace() {
  const [auctions, setAuctions] = useState<LiveAuction[]>([]);
  const [recentAuctions, setRecentAuctions] = useState<LiveAuction[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [platformFilter, setPlatformFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<SortType>('ending_soon');
  const [nowTick, setNowTick] = useState(Date.now());

  useEffect(() => {
    loadAuctions();

    let scheduled = false;
    const scheduleReload = () => {
      if (scheduled) return;
      scheduled = true;
      window.setTimeout(() => {
        scheduled = false;
        loadAuctions();
      }, 2000);
    };

    const channel = supabase
      .channel('live-auctions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_events' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_listings', filter: 'status=eq.active' }, scheduleReload)
      .subscribe();

    return () => { channel.unsubscribe(); };
  }, []);

  // Tick timer for countdowns
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const loadAuctions = async () => {
    setLoading(true);
    const nowIso = new Date().toISOString();
    const results: LiveAuction[] = [];

    try {
      // 1. External auctions from vehicle_events — real auction platforms only
      const { data: events } = await supabase
        .from('vehicle_events')
        .select(`
          id, vehicle_id, source_platform, source_url, ended_at, end_date,
          current_price, current_bid, bid_count, event_status, listing_status,
          reserve_status, no_reserve, metadata, created_at, updated_at,
          currency, currency_code, price_currency,
          vehicle:vehicles (
            id, year, make, model, trim, mileage, primary_image_url,
            bat_comments
          )
        `)
        .in('source_platform', [...AUCTION_PLATFORMS])
        .or(`event_status.eq.active,ended_at.gt.${nowIso}`);

      if (events) {
        const nowMs = Date.now();
        for (const ev of events as any[]) {
          const platform = ev.source_platform;
          const v = ev.vehicle;
          if (!v?.id || !v?.year || !v?.make) continue;

          // Parse end time
          const rawEnd = ev.ended_at ?? ev.end_date;
          const endDate = rawEnd ? new Date(rawEnd) : null;
          const endMs = endDate && Number.isFinite(endDate.getTime()) ? endDate.getTime() : null;

          // Skip garbage dates (> 60 days out or already ended with non-active status)
          if (endMs !== null && (endMs - nowMs) > SIXTY_DAYS_MS) continue;

          const status = String(ev.event_status ?? ev.listing_status ?? '').toLowerCase();
          const isActive = status === 'active' || status === 'live';

          // Skip ended auctions (end time in past and not marked active)
          if (endMs !== null && endMs < nowMs && !isActive) continue;
          // Skip if no end time and not active
          if (endMs === null && !isActive) continue;

          // Skip sold/ended
          const inactiveStatuses = new Set(['sold', 'ended', 'cancelled', 'no_sale', 'reserve_not_met', 'withdrawn', 'expired', 'closed', 'archived']);
          if (inactiveStatuses.has(status)) continue;

          // Price
          const rawPrice = ev.current_price ?? ev.current_bid;
          const priceCents = rawPrice ? Math.round(Number(rawPrice) * 100) : null;

          // Currency
          const currCode = resolveCurrencyCode(
            ev.currency, ev.currency_code, ev.price_currency,
            ev.metadata?.currency, ev.metadata?.currency_code,
            ev.metadata?.priceCurrency,
          );

          // Reserve
          const noReserve = ev.no_reserve === true ||
            ev.reserve_status === 'no_reserve' ||
            ev.metadata?.no_reserve === true ||
            String(ev.metadata?.reserve_status ?? '').toLowerCase() === 'no reserve';

          results.push({
            id: ev.id,
            vehicle_id: ev.vehicle_id,
            platform,
            source_url: ev.source_url ?? null,
            end_time: endMs !== null ? endDate!.toISOString() : null,
            current_price_cents: Number.isFinite(priceCents) && priceCents! > 0 ? priceCents : null,
            currency_code: currCode,
            bid_count: typeof ev.bid_count === 'number' ? ev.bid_count : 0,
            comment_count: typeof v.bat_comments === 'number' ? v.bat_comments : null,
            no_reserve: noReserve,
            vehicle: {
              id: v.id,
              year: v.year,
              make: v.make,
              model: v.model,
              trim: v.trim ?? null,
              mileage: typeof v.mileage === 'number' ? v.mileage : null,
              primary_image_url: v.primary_image_url ?? null,
            },
          });
        }
      }

      // 2. Native vehicle_listings (the few real ones)
      const { data: native } = await supabase
        .from('vehicle_listings')
        .select(`
          id, vehicle_id, sale_type, auction_end_time, current_high_bid_cents,
          reserve_price_cents, bid_count, status, listing_url, created_at,
          vehicle:vehicles (
            id, year, make, model, trim, mileage, primary_image_url
          )
        `)
        .eq('status', 'active')
        .in('sale_type', ['auction', 'live_auction']);

      if (native) {
        for (const nl of native as any[]) {
          const v = nl.vehicle;
          if (!v?.id) continue;
          const rawEnd = nl.auction_end_time;
          const endDate = rawEnd ? new Date(rawEnd) : null;
          const endMs = endDate && Number.isFinite(endDate.getTime()) ? endDate.getTime() : null;

          results.push({
            id: nl.id,
            vehicle_id: nl.vehicle_id,
            platform: 'nuke',
            source_url: nl.listing_url ?? null,
            end_time: endMs !== null ? endDate!.toISOString() : null,
            current_price_cents: nl.current_high_bid_cents ?? null,
            currency_code: null,
            bid_count: nl.bid_count ?? 0,
            comment_count: null,
            no_reserve: nl.reserve_price_cents === null,
            vehicle: {
              id: v.id,
              year: v.year,
              make: v.make,
              model: v.model,
              trim: v.trim ?? null,
              mileage: typeof v.mileage === 'number' ? v.mileage : null,
              primary_image_url: v.primary_image_url ?? null,
            },
          });
        }
      }

      // Backfill missing images from vehicle_images
      const noImage = results.filter(a => !a.vehicle.primary_image_url).map(a => a.vehicle_id);
      if (noImage.length > 0) {
        const { data: imgs } = await supabase
          .from('vehicle_images')
          .select('vehicle_id, image_url')
          .in('vehicle_id', [...new Set(noImage)])
          .not('is_document', 'is', true)
          .not('is_duplicate', 'is', true)
          .order('is_primary', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(500);

        if (imgs) {
          const best = new Map<string, string>();
          for (const row of imgs as any[]) {
            if (!best.has(row.vehicle_id) && row.image_url) {
              best.set(row.vehicle_id, row.image_url);
            }
          }
          for (const a of results) {
            if (!a.vehicle.primary_image_url && best.has(a.vehicle_id)) {
              a.vehicle.primary_image_url = best.get(a.vehicle_id)!;
            }
          }
        }
      }
    } catch {
      // fail silently
    }

    setAuctions(results);

    // If no live auctions, load recently ended (last 30 days)
    if (results.length === 0) {
      try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const { data: recentEvents } = await supabase
          .from('vehicle_events')
          .select(`
            id, vehicle_id, source_platform, source_url, ended_at, end_date,
            current_price, current_bid, bid_count, event_status, listing_status,
            reserve_status, no_reserve, metadata, created_at, updated_at,
            currency, currency_code, price_currency,
            vehicle:vehicles (
              id, year, make, model, trim, mileage, primary_image_url,
              bat_comments
            )
          `)
          .in('source_platform', [...AUCTION_PLATFORMS])
          .in('event_status', ['sold', 'ended', 'no_sale', 'reserve_not_met'])
          .gte('ended_at', thirtyDaysAgo)
          .order('ended_at', { ascending: false })
          .limit(50);

        if (recentEvents) {
          const recent: LiveAuction[] = [];
          for (const ev of recentEvents as any[]) {
            const v = ev.vehicle;
            if (!v?.id || !v?.year || !v?.make) continue;
            const rawEnd = ev.ended_at ?? ev.end_date;
            const endDate = rawEnd ? new Date(rawEnd) : null;
            const endMs = endDate && Number.isFinite(endDate.getTime()) ? endDate.getTime() : null;
            const rawPrice = ev.current_price ?? ev.current_bid;
            const priceCents = rawPrice ? Math.round(Number(rawPrice) * 100) : null;
            const currCode = resolveCurrencyCode(
              ev.currency, ev.currency_code, ev.price_currency,
              ev.metadata?.currency, ev.metadata?.currency_code,
              ev.metadata?.priceCurrency,
            );
            recent.push({
              id: ev.id,
              vehicle_id: ev.vehicle_id,
              platform: ev.source_platform,
              source_url: ev.source_url ?? null,
              end_time: endMs !== null ? endDate!.toISOString() : null,
              current_price_cents: Number.isFinite(priceCents) && priceCents! > 0 ? priceCents : null,
              currency_code: currCode,
              bid_count: typeof ev.bid_count === 'number' ? ev.bid_count : 0,
              comment_count: typeof v.bat_comments === 'number' ? v.bat_comments : null,
              no_reserve: ev.no_reserve === true || ev.reserve_status === 'no_reserve',
              vehicle: {
                id: v.id,
                year: v.year,
                make: v.make,
                model: v.model,
                trim: v.trim ?? null,
                mileage: typeof v.mileage === 'number' ? v.mileage : null,
                primary_image_url: v.primary_image_url ?? null,
              },
            });
          }
          setRecentAuctions(recent);
        }
      } catch {
        // fail silently
      }
    } else {
      setRecentAuctions([]);
    }

    setLoading(false);
  };

  // Derived data
  const activePlatforms = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of auctions) {
      counts.set(a.platform, (counts.get(a.platform) ?? 0) + 1);
    }
    return counts;
  }, [auctions]);

  const filtered = useMemo(() => {
    let list = auctions;

    // Platform filter
    if (platformFilter) {
      list = list.filter(a => a.platform === platformFilter);
    }

    // Search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(a => {
        const v = a.vehicle;
        return (
          String(v.year).includes(q) ||
          v.make.toLowerCase().includes(q) ||
          v.model.toLowerCase().includes(q) ||
          (v.trim && v.trim.toLowerCase().includes(q))
        );
      });
    }

    // Sort
    list = [...list].sort((a, b) => {
      switch (sort) {
        case 'ending_soon': {
          if (!a.end_time) return 1;
          if (!b.end_time) return -1;
          return new Date(a.end_time).getTime() - new Date(b.end_time).getTime();
        }
        case 'most_bids':
          return (b.bid_count || 0) - (a.bid_count || 0);
        case 'price_low':
          return (a.current_price_cents || 0) - (b.current_price_cents || 0);
        case 'price_high':
          return (b.current_price_cents || 0) - (a.current_price_cents || 0);
        case 'newest':
          return (b.end_time ? new Date(b.end_time).getTime() : 0) - (a.end_time ? new Date(a.end_time).getTime() : 0);
        default:
          return 0;
      }
    });

    return list;
  }, [auctions, platformFilter, searchQuery, sort]);

  const endingNow = useMemo(() => {
    const now = nowTick;
    return filtered.filter(a => {
      if (!a.end_time) return false;
      const diff = new Date(a.end_time).getTime() - now;
      return diff > 0 && diff <= TWO_HOURS_MS;
    }).sort((a, b) => new Date(a.end_time!).getTime() - new Date(b.end_time!).getTime());
  }, [filtered, nowTick]);

  const platformCount = activePlatforms.size;
  const totalCount = auctions.length;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: 'var(--space-4)' }}>

        {/* Header */}
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-3)' }}>
            <h1 style={{
              margin: 0,
              fontFamily: 'Arial, sans-serif',
              fontSize: 'var(--fs-11)',
              fontWeight: 700,
              letterSpacing: '0.5px',
              textTransform: 'uppercase' as const,
              color: 'var(--text)',
            }}>
              LIVE AUCTIONS
            </h1>
            {!loading && (
              <span style={{
                fontFamily: '"Courier New", monospace',
                fontSize: 'var(--fs-9)',
                color: 'var(--text-secondary)',
                textTransform: 'uppercase' as const,
                letterSpacing: '0.3px',
              }}>
                {totalCount} ACROSS {platformCount} PLATFORM{platformCount !== 1 ? 'S' : ''}
              </span>
            )}
          </div>

          {/* Search */}
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search by make, model, year..."
            style={{
              width: '100%',
              padding: '6px 8px',
              border: '2px solid var(--border)',
              background: 'var(--surface)',
              fontFamily: 'Arial, sans-serif',
              fontSize: 'var(--fs-10)',
              color: 'var(--text)',
              outline: 'none',
              boxSizing: 'border-box',
            }}
            onFocus={e => { e.currentTarget.style.borderColor = 'var(--text)'; }}
            onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
          />

          {/* Platform chips + sort */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 'var(--space-2)',
            flexWrap: 'wrap',
            gap: 'var(--space-2)',
          }}>
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              <ChipButton
                active={platformFilter === null}
                onClick={() => setPlatformFilter(null)}
              >
                ALL
              </ChipButton>
              {AUCTION_PLATFORMS.map(p => {
                const count = activePlatforms.get(p);
                if (!count) return null;
                return (
                  <ChipButton
                    key={p}
                    active={platformFilter === p}
                    onClick={() => setPlatformFilter(platformFilter === p ? null : p)}
                  >
                    {PLATFORM_LABELS[p] || p.toUpperCase()}
                  </ChipButton>
                );
              })}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{
                fontFamily: 'Arial, sans-serif',
                fontSize: 'var(--fs-8)',
                textTransform: 'uppercase' as const,
                letterSpacing: '0.3px',
                color: 'var(--text-secondary)',
              }}>
                SORT
              </span>
              <select
                value={sort}
                onChange={e => setSort(e.target.value as SortType)}
                style={{
                  padding: '4px 6px',
                  border: '2px solid var(--border)',
                  background: 'var(--surface)',
                  fontFamily: 'Arial, sans-serif',
                  fontSize: 'var(--fs-9)',
                  color: 'var(--text)',
                  textTransform: 'uppercase' as const,
                  cursor: 'pointer',
                }}
              >
                <option value="ending_soon">ENDING SOON</option>
                <option value="most_bids">MOST BIDS</option>
                <option value="price_low">PRICE: LOW</option>
                <option value="price_high">PRICE: HIGH</option>
                <option value="newest">NEWEST</option>
              </select>
            </div>
          </div>
        </div>

        {/* Loading skeleton */}
        {loading && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 'var(--space-3)',
          }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} style={{
                border: '2px solid var(--border)',
                background: 'var(--surface)',
              }}>
                <div style={{ paddingBottom: '66.66%', background: 'var(--surface-hover)' }} />
                <div style={{ padding: 'var(--space-3)' }}>
                  <div style={{ height: 10, width: '70%', background: 'var(--surface-hover)', marginBottom: 8 }} />
                  <div style={{ height: 8, width: '40%', background: 'var(--surface-hover)' }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Ending Now tier */}
        {!loading && endingNow.length > 0 && (
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <div style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 'var(--space-2)',
              marginBottom: 'var(--space-2)',
              borderBottom: '2px solid var(--text)',
              paddingBottom: 'var(--space-1)',
            }}>
              <span style={{
                fontFamily: 'Arial, sans-serif',
                fontSize: 'var(--fs-10)',
                fontWeight: 700,
                textTransform: 'uppercase' as const,
                letterSpacing: '0.5px',
                color: 'var(--error)',
              }}>
                ENDING NOW
              </span>
              <span style={{
                fontFamily: '"Courier New", monospace',
                fontSize: 'var(--fs-9)',
                color: 'var(--text-secondary)',
              }}>
                {endingNow.length} WITHIN 2H
              </span>
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 'var(--space-3)',
            }}>
              {endingNow.map(a => (
                <AuctionCard key={`now-${a.id}`} auction={a} now={nowTick} />
              ))}
            </div>
          </div>
        )}

        {/* All Live */}
        {!loading && filtered.length > 0 && (
          <div>
            <div style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 'var(--space-2)',
              marginBottom: 'var(--space-2)',
              borderBottom: '2px solid var(--border)',
              paddingBottom: 'var(--space-1)',
            }}>
              <span style={{
                fontFamily: 'Arial, sans-serif',
                fontSize: 'var(--fs-10)',
                fontWeight: 700,
                textTransform: 'uppercase' as const,
                letterSpacing: '0.5px',
                color: 'var(--text)',
              }}>
                ALL LIVE
              </span>
              <span style={{
                fontFamily: '"Courier New", monospace',
                fontSize: 'var(--fs-9)',
                color: 'var(--text-secondary)',
              }}>
                {filtered.length}
              </span>
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 'var(--space-3)',
            }}>
              {filtered.map(a => (
                <AuctionCard key={a.id} auction={a} now={nowTick} />
              ))}
            </div>
          </div>
        )}

        {/* Recently Ended — shown when no live auctions */}
        {!loading && filtered.length === 0 && recentAuctions.length > 0 && (
          <div>
            <div style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 'var(--space-2)',
              marginBottom: 'var(--space-2)',
              borderBottom: '2px solid var(--border)',
              paddingBottom: 'var(--space-1)',
            }}>
              <span style={{
                fontFamily: 'Arial, sans-serif',
                fontSize: 'var(--fs-10)',
                fontWeight: 700,
                textTransform: 'uppercase' as const,
                letterSpacing: '0.5px',
                color: 'var(--text)',
              }}>
                RECENT AUCTIONS
              </span>
              <span style={{
                fontFamily: '"Courier New", monospace',
                fontSize: 'var(--fs-9)',
                color: 'var(--text-secondary)',
              }}>
                {recentAuctions.length} IN LAST 30 DAYS
              </span>
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 'var(--space-3)',
            }}>
              {recentAuctions.map(a => (
                <AuctionCard key={`recent-${a.id}`} auction={a} now={nowTick} />
              ))}
            </div>
          </div>
        )}

        {/* Empty state — only when zero live AND zero recent */}
        {!loading && filtered.length === 0 && recentAuctions.length === 0 && (
          <div style={{
            border: '2px solid var(--border)',
            padding: 'var(--space-6)',
            textAlign: 'center',
          }}>
            <div style={{
              fontFamily: 'Arial, sans-serif',
              fontSize: 'var(--fs-11)',
              fontWeight: 700,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.5px',
              color: 'var(--text)',
              marginBottom: 'var(--space-2)',
            }}>
              NO AUCTIONS
            </div>
            <div style={{
              fontFamily: 'Arial, sans-serif',
              fontSize: 'var(--fs-9)',
              color: 'var(--text-secondary)',
              lineHeight: 1.5,
            }}>
              Check back during market hours. Auctions typically run 7 days on BaT,
              with endings clustered between 12–5pm ET.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Chip Button ─── */

function ChipButton({ active, onClick, children }: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '2px 8px',
        border: `2px solid ${active ? 'var(--text)' : 'var(--border)'}`,
        background: active ? 'var(--accent-dim)' : 'transparent',
        fontFamily: 'Arial, sans-serif',
        fontSize: 'var(--fs-8)',
        fontWeight: active ? 700 : 400,
        textTransform: 'uppercase' as const,
        letterSpacing: '0.3px',
        color: active ? 'var(--text)' : 'var(--text-secondary)',
        cursor: 'pointer',
        transition: 'border-color 180ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {children}
    </button>
  );
}

/* ─── Auction Card ─── */

function AuctionCard({ auction, now }: { auction: LiveAuction; now: number }) {
  const v = auction.vehicle;
  const imageUrl = v.primary_image_url;
  const platformLabel = PLATFORM_LABELS[auction.platform] || auction.platform.toUpperCase();
  const platformName = PLATFORM_NAMES[auction.platform] || auction.platform;

  // Time remaining
  const endMs = auction.end_time ? new Date(auction.end_time).getTime() : null;
  const diffMs = endMs !== null ? endMs - now : null;
  const timeStr = formatTimeRemaining(diffMs);
  const timeColor = getTimeColor(diffMs);

  // Price
  const priceStr = formatCurrencyFromCents(auction.current_price_cents, {
    currency: auction.currency_code ?? undefined,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
    fallback: '—',
  });

  // Vehicle title
  const identity = getVehicleIdentityParts(v as any);
  const title = identity.primary.join(' ') || 'Vehicle';

  // Mileage
  const mileageStr = v.mileage ? `${v.mileage.toLocaleString()} MILES` : null;

  return (
    <Link
      to={`/vehicle/${v.id}`}
      style={{
        display: 'block',
        border: '2px solid var(--border)',
        background: 'var(--surface)',
        textDecoration: 'none',
        color: 'inherit',
        overflow: 'hidden',
        transition: 'border-color 180ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--text)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
    >
      {/* Image */}
      <div style={{ position: 'relative', paddingBottom: '66.66%', background: 'var(--surface-hover)', overflow: 'hidden' }}>
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={title}
            loading="lazy"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        ) : (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'Arial, sans-serif',
            fontSize: 'var(--fs-9)',
            color: 'var(--text-secondary)',
            textTransform: 'uppercase' as const,
          }}>
            NO IMAGE
          </div>
        )}

        {/* Top bar: platform left, timer right */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '6px 8px',
          background: 'rgba(0,0,0,0.35)',
        }}>
          <span style={{
            fontFamily: 'Arial, sans-serif',
            fontSize: 'var(--fs-8)',
            fontWeight: 700,
            textTransform: 'uppercase' as const,
            letterSpacing: '0.5px',
            color: 'var(--surface-elevated)',
          }}>
            {platformLabel}
          </span>
          <span style={{
            fontFamily: '"Courier New", monospace',
            fontSize: 'var(--fs-9)',
            fontWeight: 700,
            color: timeColor === 'default' ? 'var(--surface-elevated)' : timeColor === 'red' ? '#ff6b6b' : '#ffb347',
            letterSpacing: '0.5px',
          }}>
            {timeStr}
          </span>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '8px 10px' }}>
        {/* Title */}
        <div style={{
          fontFamily: 'Arial, sans-serif',
          fontSize: 'var(--fs-11)',
          fontWeight: 700,
          color: 'var(--text)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          marginBottom: 2,
        }}>
          {title}
        </div>

        {/* Mileage */}
        {mileageStr && (
          <div style={{
            fontFamily: '"Courier New", monospace',
            fontSize: 'var(--fs-8)',
            textTransform: 'uppercase' as const,
            color: 'var(--text-secondary)',
            letterSpacing: '0.3px',
            marginBottom: 6,
          }}>
            {mileageStr}
          </div>
        )}

        {/* Price row */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          borderTop: '2px solid var(--border)',
          paddingTop: 6,
        }}>
          <span style={{
            fontFamily: '"Courier New", monospace',
            fontSize: 'var(--fs-11)',
            fontWeight: 700,
            color: 'var(--text)',
          }}>
            {priceStr}
          </span>

          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            {auction.bid_count > 0 && (
              <span style={{
                fontFamily: '"Courier New", monospace',
                fontSize: 'var(--fs-8)',
                color: 'var(--text-secondary)',
                textTransform: 'uppercase' as const,
              }}>
                {auction.bid_count} BID{auction.bid_count !== 1 ? 'S' : ''}
              </span>
            )}
            {auction.comment_count !== null && auction.comment_count > 0 && (
              <span style={{
                fontFamily: '"Courier New", monospace',
                fontSize: 'var(--fs-8)',
                color: 'var(--text-secondary)',
                textTransform: 'uppercase' as const,
              }}>
                {auction.comment_count} CMT{auction.comment_count !== 1 ? 'S' : ''}
              </span>
            )}
          </div>
        </div>

        {/* Bottom row: no reserve + external link */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 4,
          minHeight: 16,
        }}>
          {auction.no_reserve ? (
            <span style={{
              fontFamily: 'Arial, sans-serif',
              fontSize: 'var(--fs-8)',
              fontWeight: 700,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.3px',
              color: 'var(--warning)',
            }}>
              NO RESERVE
            </span>
          ) : <span />}

          {auction.source_url && (
            <a
              href={auction.source_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              title={`View on ${platformName}`}
              style={{
                fontFamily: 'Arial, sans-serif',
                fontSize: 'var(--fs-9)',
                color: 'var(--text-secondary)',
                textDecoration: 'none',
                transition: 'color 180ms cubic-bezier(0.16, 1, 0.3, 1)',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
            >
              ↗
            </a>
          )}
        </div>
      </div>
    </Link>
  );
}

/* ─── Helpers ─── */

function formatTimeRemaining(diffMs: number | null): string {
  if (diffMs === null) return '—';
  if (diffMs <= 0) return 'ENDED';

  const minutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}D ${hours % 24}H`;
  if (hours > 0) return `${hours}H ${minutes % 60}M`;
  return `${minutes}M`;
}

function getTimeColor(diffMs: number | null): 'red' | 'orange' | 'default' {
  if (diffMs === null || diffMs <= 0) return 'default';
  if (diffMs < 60 * 60 * 1000) return 'red';
  if (diffMs < 24 * 60 * 60 * 1000) return 'orange';
  return 'default';
}

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

type AuctionSource = 'bat' | 'external';

type ReserveFilter = 'all' | 'reserve' | 'no_reserve';
type StatusFilter = 'live' | 'ended' | 'all';
type SoldFilter = 'all' | 'sold' | 'unsold'; // For auction houses: separate sold (results) from unsold

interface AuctionRow {
  id: string;
  source: AuctionSource;
  platform: string | null;
  vehicle_id: string | null;
  title: string | null;
  url: string | null;
  listing_status: string | null;
  end_time: string | null; // ISO
  bid_count: number;
  comment_count: number;
  view_count: number;
  watcher_count: number;
  current_bid_cents: number | null;
  final_price_cents: number | null;
  reserve_price_cents: number | null;
}

interface VehicleMini {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  listing_location: string | null;
  listing_location_raw: string | null;
}

interface VehicleImageMini {
  vehicle_id: string;
  thumbnail_url: string | null;
  medium_url: string | null;
  image_url: string | null;
  variants: any;
  is_primary?: boolean | null;
  created_at?: string | null;
}

function formatUsdFromCents(cents: number | null): string {
  if (typeof cents !== 'number') return '—';
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function endOfDayIso(dateStr: string): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

export function OrganizationAuctionsTab({ organizationId }: { organizationId: string }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AuctionRow[]>([]);
  const [vehiclesById, setVehiclesById] = useState<Record<string, VehicleMini>>({});
  const [bestImageByVehicleId, setBestImageByVehicleId] = useState<Record<string, string>>({});
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [reserveFilter, setReserveFilter] = useState<ReserveFilter>('all');
  const [soldFilter, setSoldFilter] = useState<SoldFilter>('all');

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      setLoading(true);
      try {
        const now = Date.now();

        const [batRes, extRes] = await Promise.all([
          supabase
            .from('bat_listings')
            .select(
              'id, vehicle_id, bat_listing_url, bat_listing_title, listing_status, auction_end_date, final_bid, bid_count, comment_count, view_count, reserve_price'
            )
            .eq('organization_id', organizationId)
            .order('auction_end_date', { ascending: false })
            .limit(300),
          supabase
            .from('external_listings')
            .select(
              'id, vehicle_id, platform, listing_url, listing_status, end_date, current_bid, final_price, bid_count, view_count, watcher_count, reserve_price'
            )
            .eq('organization_id', organizationId)
            .order('end_date', { ascending: false })
            .limit(300),
        ]);

        const batRows: AuctionRow[] =
          (batRes.data || []).map((r: any) => {
            const endTime = typeof r.auction_end_date === 'string' ? endOfDayIso(r.auction_end_date) : null;
            return {
              id: r.id,
              source: 'bat',
              platform: 'bat',
              vehicle_id: r.vehicle_id || null,
              title: r.bat_listing_title || null,
              url: r.bat_listing_url || null,
              listing_status: r.listing_status || null,
              end_time: endTime,
              bid_count: Number(r.bid_count || 0),
              comment_count: Number(r.comment_count || 0),
              view_count: Number(r.view_count || 0),
              watcher_count: 0,
              current_bid_cents: null,
              final_price_cents: typeof r.final_bid === 'number' ? r.final_bid * 100 : null,
              reserve_price_cents: typeof r.reserve_price === 'number' ? r.reserve_price * 100 : null,
            };
          }) || [];

        const extRows: AuctionRow[] =
          (extRes.data || []).map((r: any) => {
            const endTime = typeof r.end_date === 'string' ? r.end_date : null;
            const currentBidCents =
              typeof r.current_bid === 'number' ? Math.round(r.current_bid * 100) : null;
            const finalPriceCents =
              typeof r.final_price === 'number' ? Math.round(r.final_price * 100) : null;
            const reserveCents =
              typeof r.reserve_price === 'number' ? Math.round(r.reserve_price * 100) : null;
            return {
              id: r.id,
              source: 'external',
              platform: typeof r.platform === 'string' ? r.platform : null,
              vehicle_id: r.vehicle_id || null,
              title: null,
              url: r.listing_url || null,
              listing_status: r.listing_status || null,
              end_time: endTime,
              bid_count: Number(r.bid_count || 0),
              comment_count: 0,
              view_count: Number(r.view_count || 0),
              watcher_count: Number(r.watcher_count || 0),
              current_bid_cents: currentBidCents,
              final_price_cents: finalPriceCents,
              reserve_price_cents: reserveCents,
            };
          }) || [];

        const merged = [...batRows, ...extRows]
          .filter((r) => !!r.vehicle_id)
          .sort((a, b) => {
            const aEnd = a.end_time ? new Date(a.end_time).getTime() : 0;
            const bEnd = b.end_time ? new Date(b.end_time).getTime() : 0;
            // Live ending soon first; otherwise most recent first
            const aLive = a.listing_status === 'active' && aEnd > now;
            const bLive = b.listing_status === 'active' && bEnd > now;
            if (aLive && bLive) return aEnd - bEnd;
            if (aLive && !bLive) return -1;
            if (!aLive && bLive) return 1;
            return bEnd - aEnd;
          });

        if (!mounted) return;
        setRows(merged);

        const vehicleIds = Array.from(new Set(merged.map((r) => r.vehicle_id).filter(Boolean))) as string[];
        if (vehicleIds.length === 0) return;

        const [vehRes, imgRes] = await Promise.all([
          supabase
            .from('vehicles')
            .select('id, year, make, model, listing_location, listing_location_raw')
            .in('id', vehicleIds),
          supabase
            .from('vehicle_images')
            .select('vehicle_id, thumbnail_url, medium_url, image_url, variants, is_primary, created_at')
            .in('vehicle_id', vehicleIds)
            .order('is_primary', { ascending: false })
            .order('created_at', { ascending: true }),
        ]);

        if (!mounted) return;

        const byId: Record<string, VehicleMini> = {};
        (vehRes.data || []).forEach((v: any) => {
          byId[v.id] = {
            id: v.id,
            year: typeof v.year === 'number' ? v.year : null,
            make: typeof v.make === 'string' ? v.make : null,
            model: typeof v.model === 'string' ? v.model : null,
            listing_location: typeof v.listing_location === 'string' ? v.listing_location : null,
            listing_location_raw: typeof v.listing_location_raw === 'string' ? v.listing_location_raw : null,
          };
        });
        setVehiclesById(byId);

        const bestByVehicle: Record<string, string> = {};
        (imgRes.data || []).forEach((img: VehicleImageMini) => {
          if (!img?.vehicle_id) return;
          if (bestByVehicle[img.vehicle_id]) return;
          const variants = img.variants && typeof img.variants === 'object' ? img.variants : {};
          const best =
            (typeof (variants as any)?.thumbnail === 'string' && (variants as any).thumbnail) ||
            (typeof (variants as any)?.medium === 'string' && (variants as any).medium) ||
            img.thumbnail_url ||
            img.medium_url ||
            img.image_url;
          if (typeof best === 'string' && best) bestByVehicle[img.vehicle_id] = best;
        });
        setBestImageByVehicleId(bestByVehicle);
      } catch (e) {
        console.error('Failed to load auctions:', e);
        if (mounted) setRows([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, [organizationId]);

  const filtered = useMemo(() => {
    const now = Date.now();
    return rows.filter((r) => {
      const end = r.end_time ? new Date(r.end_time).getTime() : 0;
      const isLive = r.listing_status === 'active' && end > now;
      const isEnded = !isLive;
      if (statusFilter === 'live' && !isLive) return false;
      if (statusFilter === 'ended' && !isEnded) return false;

      // Determine if sold: has final_price, listing_status is 'sold', or has sold_at metadata
      const isSold = Boolean(r.final_price_cents) || 
                     r.listing_status === 'sold' ||
                     (r.listing_status === 'ended' && r.final_price_cents);
      const isUnsold = isEnded && !isSold && r.listing_status !== 'sold';
      
      if (soldFilter === 'sold' && !isSold) return false;
      if (soldFilter === 'unsold' && !isUnsold) return false;

      const hasReserve = typeof r.reserve_price_cents === 'number' && r.reserve_price_cents > 0;
      const noReserve = !hasReserve;
      if (reserveFilter === 'reserve' && !hasReserve) return false;
      if (reserveFilter === 'no_reserve' && !noReserve) return false;
      return true;
    });
  }, [rows, statusFilter, reserveFilter, soldFilter]);

  const liveCount = useMemo(() => {
    const now = Date.now();
    return rows.filter((r) => r.listing_status === 'active' && (r.end_time ? new Date(r.end_time).getTime() : 0) > now).length;
  }, [rows]);

  const soldCount = useMemo(() => {
    return rows.filter((r) => {
      const isSold = Boolean(r.final_price_cents) || r.listing_status === 'sold';
      return isSold;
    }).length;
  }, [rows]);

  const unsoldCount = useMemo(() => {
    const now = Date.now();
    return rows.filter((r) => {
      const end = r.end_time ? new Date(r.end_time).getTime() : 0;
      const isEnded = !(r.listing_status === 'active' && end > now);
      const isSold = Boolean(r.final_price_cents) || r.listing_status === 'sold';
      return isEnded && !isSold;
    }).length;
  }, [rows]);

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', fontSize: '9pt', color: 'var(--text-muted)' }}>
        Loading auctions...
      </div>
    );
  }

  return (
    <div style={{ padding: '16px' }}>
      <div className="card" style={{ marginBottom: '12px' }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700 }}>Auctions</span>
          <span style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
            Live {liveCount} · Sold {soldCount} · Unsold {unsoldCount} · Total {rows.length}
          </span>
        </div>
        <div className="card-body" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>Results</span>
            {(['all', 'sold', 'unsold'] as const).map((k) => (
              <button
                key={k}
                className="button button-secondary button-small"
                onClick={() => setSoldFilter(k)}
                style={{
                  fontSize: '8pt',
                  borderRadius: 0,
                  border: soldFilter === k ? '1px solid var(--accent)' : '1px solid var(--border)',
                  color: soldFilter === k ? 'var(--accent)' : 'var(--text)',
                }}
              >
                {k === 'all' ? 'All' : k === 'sold' ? 'Results (Sold)' : 'Unsold'}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>Status</span>
            {(['live', 'ended', 'all'] as const).map((k) => (
              <button
                key={k}
                className="button button-secondary button-small"
                onClick={() => setStatusFilter(k)}
                style={{
                  fontSize: '8pt',
                  borderRadius: 0,
                  border: statusFilter === k ? '1px solid var(--accent)' : '1px solid var(--border)',
                  color: statusFilter === k ? 'var(--accent)' : 'var(--text)',
                }}
              >
                {k === 'live' ? 'Live' : k === 'ended' ? 'Ended' : 'All'}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>Reserve</span>
            {(['all', 'reserve', 'no_reserve'] as const).map((k) => (
              <button
                key={k}
                className="button button-secondary button-small"
                onClick={() => setReserveFilter(k)}
                style={{
                  fontSize: '8pt',
                  borderRadius: 0,
                  border: reserveFilter === k ? '1px solid var(--accent)' : '1px solid var(--border)',
                  color: reserveFilter === k ? 'var(--accent)' : 'var(--text)',
                }}
              >
                {k === 'all' ? 'All' : k === 'reserve' ? 'Reserve' : 'No Reserve'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card">
          <div className="card-body" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '9pt' }}>
            No auctions match these filters.
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {filtered.map((r) => {
            const v = r.vehicle_id ? vehiclesById[r.vehicle_id] : undefined;
            const img = r.vehicle_id ? bestImageByVehicleId[r.vehicle_id] : undefined;

            const label =
              v && (v.year || v.make || v.model)
                ? `${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim()
                : r.title || 'Vehicle';

            const endTs = r.end_time ? new Date(r.end_time) : null;
            const endStr = endTs && !Number.isNaN(endTs.getTime()) ? endTs.toLocaleString() : null;
            const hasReserve = typeof r.reserve_price_cents === 'number' && r.reserve_price_cents > 0;

            // Determine if sold for display
            const isSold = Boolean(r.final_price_cents) || r.listing_status === 'sold';
            const price = isSold
              ? (r.final_price_cents ?? null)
              : (r.listing_status === 'active'
                  ? (r.current_bid_cents ?? null)
                  : (r.current_bid_cents ?? null));

            return (
              <div
                key={`${r.source}:${r.id}`}
                className="card hover-lift"
                style={{ cursor: 'pointer', overflow: 'hidden' }}
                onClick={() => {
                  if (r.url) {
                    window.open(r.url, '_blank', 'noopener,noreferrer');
                    return;
                  }
                  if (r.vehicle_id) navigate(`/vehicle/${r.vehicle_id}`);
                }}
              >
                <div style={{ display: 'flex', gap: 10, padding: 12 }}>
                  <div
                    style={{
                      width: 96,
                      height: 72,
                      border: '1px solid var(--border)',
                      background: img ? `url(${img}) center/cover no-repeat` : 'var(--surface)',
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: '10pt', fontWeight: 800, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {label}
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                        {r.platform ? String(r.platform).toUpperCase() : 'AUCTION'}
                      </span>
                      {r.listing_status ? (
                        <span style={{ fontSize: '8pt', color: 'var(--text-secondary)' }}>{String(r.listing_status).toUpperCase()}</span>
                      ) : null}
                      {!hasReserve ? (
                        <span style={{ fontSize: '8pt', color: 'var(--warning)', fontWeight: 800 }}>NO RESERVE</span>
                      ) : (
                        <span style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>RESERVE</span>
                      )}
                    </div>
                    <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                      <div style={{ fontSize: '12pt', fontWeight: 900 }}>
                        {formatUsdFromCents(price)}
                      </div>
                      <div style={{ fontSize: '8pt', color: 'var(--text-muted)', textAlign: 'right' }}>
                        {endStr ? `Ends ${endStr}` : 'End time unknown'}
                      </div>
                    </div>
                    <div style={{ marginTop: 6, display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: '8pt', color: 'var(--text-muted)' }}>
                      {r.bid_count > 0 ? <span>Bids {r.bid_count}</span> : <span>Bids 0</span>}
                      {r.comment_count > 0 ? <span>Comments {r.comment_count}</span> : null}
                      {r.view_count > 0 ? <span>Views {r.view_count}</span> : null}
                      {r.watcher_count > 0 ? <span>Watch {r.watcher_count}</span> : null}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}



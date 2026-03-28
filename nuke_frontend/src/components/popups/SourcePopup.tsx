/**
 * SourcePopup — When you click a source badge.
 *
 * Principle: "Show specific things, not summaries."
 *
 * Replaces:
 * - Fill rates (internal metric nobody cares about)
 * - Median price (meaningless over heterogeneous data)
 *
 * With:
 * - What's live right now on this source
 * - What sold this week/month
 * - Recent results with actual vehicles and prices
 * - Top makes as clickable chips
 *
 * Single RPC call via popup_source_intel().
 */

import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { usePopup } from './usePopup';
import { MakePopup } from './MakePopup';
import { VehiclePopup } from './VehiclePopup';
import type { FeedVehicle } from '../../feed/types/feed';

interface Props {
  source: string;
  searchQuery?: string;
}

interface SourceIntel {
  total: number;
  for_sale: number;
  recent_sales: SaleVehicle[] | null;
  live_now: LiveVehicle[] | null;
  top_makes: MakeRow[] | null;
  sold_this_week: number;
  sold_this_month: number;
}

interface SaleVehicle {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  sale_price: number;
  sale_date: string | null;
  thumbnail: string | null;
}

interface LiveVehicle {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  price: number | null;
  thumbnail: string | null;
}

interface MakeRow {
  label: string;
  cnt: number;
  for_sale: number;
}

function formatPrice(n: number | null): string {
  if (n == null || n <= 0) return '--';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toLocaleString()}`;
}

const MONO = "'Courier New', Courier, monospace";
const SANS = 'Arial, Helvetica, sans-serif';

// Source character descriptions — what each platform specializes in
const SOURCE_CHARACTER: Record<string, string> = {
  bat: 'Curated enthusiast auctions. Strong community commentary.',
  'cars-and-bids': 'Modern enthusiast cars. No-reserve auctions.',
  craigslist: 'Full-spectrum regional. Best for local deals.',
  facebook_marketplace: 'Volume marketplace. Trending younger sellers.',
  mecum: 'High-volume consignment auctions.',
  'barrett-jackson': 'High-end collector car events.',
  'rm-sothebys': 'Top-tier collector auctions.',
  hagerty: 'Insurance-linked marketplace. Strong valuation data.',
  pcarmarket: 'Porsche-focused enthusiast marketplace.',
  classic: 'Aggregated dealer and private inventory.',
  collectingcars: 'European-leaning enthusiast auctions.',
  ksl: 'Utah-local marketplace.',
};

export function SourcePopup({ source, searchQuery }: Props) {
  const { openPopup } = usePopup();
  const [data, setData] = useState<SourceIntel | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const { data: result, error } = await supabase.rpc('popup_source_intel', { p_source: source });
        if (!cancelled && !error && result) {
          setData(result as SourceIntel);
        }
      } catch {
        // silently
      }
      if (!cancelled) setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [source]);

  if (loading || !data) {
    return (
      <div style={{ padding: 20, textAlign: 'center' }}>
        <span style={{ fontFamily: SANS, fontSize: 8, fontWeight: 700, textTransform: 'uppercase', color: '#999', letterSpacing: '0.5px' }}>
          LOADING...
        </span>
      </div>
    );
  }

  const sq = (searchQuery || '').toLowerCase().trim();
  const filteredMakes = sq
    ? (data.top_makes || []).filter(m => m.label.toLowerCase().includes(sq))
    : (data.top_makes || []);

  const character = SOURCE_CHARACTER[source.toLowerCase()] || null;

  const handleMakeClick = (make: string) => {
    openPopup(<MakePopup make={make} />, make, 480);
  };

  const handleVehicleClick = (id: string, title: string) => {
    supabase.from('vehicles').select('*').eq('id', id).single().then(({ data: v }) => {
      if (v) openPopup(<VehiclePopup vehicle={v as unknown as FeedVehicle} />, title, 480);
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Header: total + for-sale + sold activity */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #ccc', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <StatCell label="TOTAL" value={data.total.toLocaleString()} />
        {data.for_sale > 0 && <StatCell label="FOR SALE" value={data.for_sale.toLocaleString()} highlight />}
        {data.sold_this_week > 0 && <StatCell label="SOLD THIS WEEK" value={String(data.sold_this_week)} />}
        {data.sold_this_month > 0 && <StatCell label="SOLD 30 DAYS" value={String(data.sold_this_month)} />}
      </div>

      {/* Source character */}
      {character && (
        <div style={{ padding: '6px 12px', borderBottom: '1px solid #ccc' }}>
          <span style={{ fontFamily: SANS, fontSize: 9, color: '#666', fontStyle: 'italic', lineHeight: 1.4 }}>
            {character}
          </span>
        </div>
      )}

      {/* Live now */}
      {data.live_now && data.live_now.length > 0 && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #ccc' }}>
          <SectionLabel>LIVE NOW</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, marginTop: 6 }}>
            {data.live_now.slice(0, 4).map((v) => {
              const title = [v.year, v.make, v.model].filter(Boolean).join(' ');
              return (
                <VehicleMiniCard
                  key={v.id}
                  thumbnail={v.thumbnail}
                  title={title}
                  price={formatPrice(v.price)}
                  onClick={() => handleVehicleClick(v.id, title)}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Recent sales */}
      {data.recent_sales && data.recent_sales.length > 0 && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #ccc' }}>
          <SectionLabel>RECENT RESULTS</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginTop: 4 }}>
            {data.recent_sales.slice(0, 6).map((s) => {
              const title = [s.year, s.make, s.model].filter(Boolean).join(' ');
              return (
                <div
                  key={s.id}
                  onClick={() => handleVehicleClick(s.id, title)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '4px 0', borderBottom: '1px solid #f0f0f0',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#f5f5f5'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  {s.thumbnail && (
                    <img src={s.thumbnail} alt="" loading="lazy" style={{ width: 40, height: 27, objectFit: 'cover', flexShrink: 0, border: '1px solid #e0e0e0' }} />
                  )}
                  <span style={{ fontFamily: SANS, fontSize: 9, fontWeight: 700, color: '#1a1a1a', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {title}
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: '#16825d', flexShrink: 0 }}>
                    {formatPrice(s.sale_price)}
                  </span>
                  {s.sale_date && (
                    <span style={{ fontFamily: MONO, fontSize: 7, color: '#999', flexShrink: 0 }}>
                      {new Date(s.sale_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Top makes */}
      {filteredMakes.length > 0 && (
        <div style={{ padding: '8px 12px' }}>
          <SectionLabel>TOP MAKES</SectionLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
            {filteredMakes.map((m) => (
              <FacetChip key={m.label} label={m.label} count={m.cnt} onClick={() => handleMakeClick(m.label)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCell({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span style={{ fontFamily: SANS, fontSize: 7, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#999', lineHeight: 1 }}>
        {label}
      </span>
      <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: highlight ? '#0078d4' : '#1a1a1a', lineHeight: 1.2 }}>
        {value}
      </span>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontFamily: SANS, fontSize: 7, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#999', lineHeight: 1 }}>
      {children}
    </span>
  );
}

function FacetChip({ label, count, onClick }: { label: string; count: number; onClick: () => void }) {
  return (
    <span
      role="button" tabIndex={0}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick(); }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3,
        fontFamily: SANS, fontSize: 8, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.10em',
        padding: '2px 6px', border: '1px solid #ccc',
        color: '#333', cursor: 'pointer',
        transition: 'border-color 150ms ease, background 150ms ease',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#2a2a2a'; e.currentTarget.style.background = '#e8e8e8'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#ccc'; e.currentTarget.style.background = 'transparent'; }}
    >
      {label}
      <span style={{ fontFamily: MONO, fontSize: 7, fontWeight: 400, color: '#999' }}>{count}</span>
    </span>
  );
}

function VehicleMiniCard({ thumbnail, title, price, onClick }: {
  thumbnail: string | null; title: string; price: string; onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        cursor: 'pointer', border: '1px solid #ccc',
        background: '#fff', overflow: 'hidden',
        transition: 'border-color 150ms ease',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#2a2a2a'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#ccc'; }}
    >
      <div style={{ width: '100%', paddingTop: '60%', position: 'relative', background: '#e0e0e0' }}>
        {thumbnail && (
          <img src={thumbnail} alt={title} loading="lazy" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
      </div>
      <div style={{ padding: '3px 5px' }}>
        <div style={{ fontFamily: SANS, fontSize: 8, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#1a1a1a' }}>
          {title}
        </div>
        <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, color: '#16825d' }}>{price}</span>
      </div>
    </div>
  );
}

/**
 * MakePopup — When you click a make badge.
 *
 * Principle: "Show specific things, not summaries."
 *
 * Replaces garbage stats (median price over dirty data, year range, fill rates)
 * with real intelligence:
 * - Live activity: what's for sale RIGHT NOW, what just sold
 * - Model taxonomy with for-sale counts (not alphabetical, by volume)
 * - Source distribution
 * - Price scatter (year vs price shape)
 *
 * Single RPC call via popup_make_intel() — one round trip.
 */

import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { usePopup } from './usePopup';
import { ModelPopup } from './ModelPopup';
import { SourcePopup } from './SourcePopup';
import { VehiclePopup } from './VehiclePopup';
import type { FeedVehicle } from '../../feed/types/feed';

interface Props {
  make: string;
  searchQuery?: string;
}

interface MakeIntel {
  total: number;
  for_sale: number;
  recent_sales: RecentVehicle[] | null;
  live_now: LiveVehicle[] | null;
  top_models: ModelRow[] | null;
  sources: SourceRow[] | null;
  price_scatter: { y: number; p: number }[] | null;
}

interface RecentVehicle {
  id: string;
  year: number | null;
  model: string | null;
  sale_price: number;
  sale_date: string | null;
  thumbnail: string | null;
  mileage: number | null;
  nuke_estimate: number | null;
  heat_score: number | null;
}

interface LiveVehicle {
  id: string;
  year: number | null;
  model: string | null;
  price: number | null;
  thumbnail: string | null;
  source: string | null;
}

interface ModelRow {
  label: string;
  cnt: number;
  avg_price: number | null;
  for_sale: number;
}

interface SourceRow {
  label: string;
  cnt: number;
}

function formatPrice(n: number | null): string {
  if (n == null || n <= 0) return '--';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toLocaleString()}`;
}

const MONO = "'Courier New', Courier, monospace";
const SANS = 'Arial, Helvetica, sans-serif';

export function MakePopup({ make, searchQuery }: Props) {
  const { openPopup } = usePopup();
  const [data, setData] = useState<MakeIntel | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const { data: result, error } = await supabase.rpc('popup_make_intel', { p_make: make });
        if (!cancelled && !error && result) {
          setData(result as MakeIntel);
        }
      } catch {
        // fallback: nothing
      }
      if (!cancelled) setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [make]);

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

  const filteredModels = sq
    ? (data.top_models || []).filter(m => m.label.toLowerCase().includes(sq))
    : (data.top_models || []);

  const filteredSources = sq
    ? (data.sources || []).filter(s => s.label.toLowerCase().includes(sq))
    : (data.sources || []);

  const handleModelClick = (model: string) => {
    openPopup(<ModelPopup make={make} model={model} />, model, 420);
  };

  const handleSourceClick = (source: string) => {
    openPopup(<SourcePopup source={source} />, source.toUpperCase(), 420);
  };

  const handleVehicleClick = (id: string, title: string) => {
    supabase.from('vehicles').select('*').eq('id', id).single().then(({ data: v }) => {
      if (v) openPopup(<VehiclePopup vehicle={v as unknown as FeedVehicle} />, title, 480);
    });
  };

  const handleOpenTab = () => {
    window.open(`/?makes=${encodeURIComponent(make)}`, '_blank');
  };

  const maxModelCount = Math.max(...(data.top_models || []).map(m => m.cnt), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Header stats — just count + for sale, no garbage medians */}
      <div style={{
        padding: '10px 12px', borderBottom: '1px solid #ccc',
        display: 'flex', gap: 16, alignItems: 'center',
      }}>
        <StatCell label="TOTAL VEHICLES" value={data.total.toLocaleString()} />
        {data.for_sale > 0 && <StatCell label="FOR SALE NOW" value={data.for_sale.toLocaleString()} highlight />}
      </div>

      {/* Live now — what's actually for sale */}
      {data.live_now && data.live_now.length > 0 && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #ccc' }}>
          <SectionLabel>LIVE NOW</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, marginTop: 6 }}>
            {data.live_now.slice(0, 4).map((v) => (
              <VehicleMiniCard
                key={v.id}
                thumbnail={v.thumbnail}
                title={[v.year, v.model].filter(Boolean).join(' ')}
                price={formatPrice(v.price)}
                badge={v.source?.toUpperCase() || undefined}
                badgeColor="#0078d4"
                onClick={() => handleVehicleClick(v.id, [v.year, make, v.model].filter(Boolean).join(' '))}
              />
            ))}
          </div>
        </div>
      )}

      {/* Recent sales — actual vehicles that sold, not median over noise */}
      {data.recent_sales && data.recent_sales.length > 0 && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #ccc' }}>
          <SectionLabel>SOLD LAST 90 DAYS</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, marginTop: 6 }}>
            {data.recent_sales.slice(0, 4).map((s) => (
              <VehicleMiniCard
                key={s.id}
                thumbnail={s.thumbnail}
                title={[s.year, s.model].filter(Boolean).join(' ')}
                price={formatPrice(s.sale_price)}
                subtitle={s.sale_date ? new Date(s.sale_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : undefined}
                onClick={() => handleVehicleClick(s.id, [s.year, make, s.model].filter(Boolean).join(' '))}
              />
            ))}
          </div>
        </div>
      )}

      {/* Top models — bar chart with for-sale counts */}
      {filteredModels.length > 0 && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #ccc' }}>
          <SectionLabel>MODELS</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
            {filteredModels.slice(0, 10).map((m) => (
              <div
                key={m.label}
                onClick={() => handleModelClick(m.label)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '2px 0' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#f0f0f0'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ fontFamily: SANS, fontSize: 8, fontWeight: 700, color: '#333', width: 90, flexShrink: 0, textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.label}
                </span>
                <div style={{ flex: 1, height: 8, background: '#e0e0e0', position: 'relative' }}>
                  <div style={{
                    position: 'absolute', left: 0, top: 0, height: '100%',
                    width: `${(m.cnt / maxModelCount) * 100}%`,
                    background: '#2a2a2a', transition: 'width 150ms ease',
                  }} />
                </div>
                <span style={{ fontFamily: MONO, fontSize: 8, fontWeight: 700, color: '#999', width: 28, textAlign: 'right', flexShrink: 0 }}>
                  {m.cnt}
                </span>
                {m.for_sale > 0 && (
                  <span style={{ fontFamily: MONO, fontSize: 7, fontWeight: 700, color: '#0078d4', width: 24, textAlign: 'right', flexShrink: 0 }}>
                    {m.for_sale}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Source distribution */}
      {filteredSources.length > 0 && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #ccc' }}>
          <SectionLabel>SOURCES</SectionLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
            {filteredSources.map((s) => (
              <FacetChip key={s.label} label={s.label} count={s.cnt} onClick={() => handleSourceClick(s.label)} />
            ))}
          </div>
        </div>
      )}

      {/* TAB */}
      <div style={{ padding: '10px 12px', textAlign: 'right' }}>
        <button
          onClick={handleOpenTab}
          style={{
            fontFamily: SANS, fontSize: 9, fontWeight: 800,
            textTransform: 'uppercase', letterSpacing: '0.3px',
            padding: '4px 12px', border: '2px solid #2a2a2a',
            background: '#2a2a2a', color: '#fff',
            cursor: 'pointer', transition: 'opacity 150ms ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.8'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
        >
          TAB
        </button>
      </div>
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

function VehicleMiniCard({
  thumbnail, title, price, subtitle, badge, badgeColor, onClick,
}: {
  thumbnail: string | null;
  title: string;
  price: string;
  subtitle?: string;
  badge?: string;
  badgeColor?: string;
  onClick: () => void;
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
        {badge && (
          <span style={{
            position: 'absolute', top: 3, right: 3,
            fontFamily: SANS, fontSize: 6, fontWeight: 800,
            textTransform: 'uppercase', letterSpacing: '0.3px',
            padding: '1px 3px', background: badgeColor || '#2a2a2a', color: '#fff',
          }}>
            {badge}
          </span>
        )}
      </div>
      <div style={{ padding: '3px 5px' }}>
        <div style={{ fontFamily: SANS, fontSize: 8, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#1a1a1a' }}>
          {title}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, color: '#16825d' }}>{price}</span>
          {subtitle && <span style={{ fontFamily: MONO, fontSize: 7, color: '#999' }}>{subtitle}</span>}
        </div>
      </div>
    </div>
  );
}

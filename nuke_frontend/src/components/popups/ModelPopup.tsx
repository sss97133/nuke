/**
 * ModelPopup — When you click a model badge.
 *
 * Single RPC call via popup_model_intel() — one round trip.
 * Shows actual vehicles, price scatter, sources. No garbage aggregates.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { usePopup } from './usePopup';
import { VehiclePopup } from './VehiclePopup';
import type { FeedVehicle } from '../../feed/types/feed';

interface Props {
  make: string;
  model: string;
  searchQuery?: string;
}

interface ModelIntel {
  total: number;
  for_sale: number;
  recent_sales: SaleVehicle[];
  live_now: SaleVehicle[];
  price_scatter: { y: number; p: number }[];
  year_range: { min: number; max: number } | null;
  sources: { label: string; cnt: number }[];
}

interface SaleVehicle {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  sale_price: number | null;
  primary_image_url: string | null;
  sale_date: string | null;
  mileage: number | null;
  nuke_estimate: number | null;
}

function formatPrice(n: number | null): string {
  if (n == null || n <= 0) return '--';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toLocaleString()}`;
}

const MONO = "'Courier New', Courier, monospace";
const SANS = 'Arial, Helvetica, sans-serif';

export function ModelPopup({ make, model, searchQuery }: Props) {
  const { openPopup } = usePopup();
  const [data, setData] = useState<ModelIntel | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const { data: result, error } = await supabase.rpc('popup_model_intel', {
          p_make: make,
          p_model: model,
        });
        if (!cancelled && !error && result) {
          setData(result as ModelIntel);
        }
      } catch {
        // fallback: nothing
      }
      if (!cancelled) setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [make, model]);

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
  const filteredSales = sq
    ? data.recent_sales.filter(s =>
        String(s.year || '').includes(sq) ||
        formatPrice(s.sale_price).toLowerCase().includes(sq))
    : data.recent_sales;
  const filteredLive = sq
    ? data.live_now.filter(s =>
        String(s.year || '').includes(sq))
    : data.live_now;

  const handleVehicleClick = (sale: SaleVehicle) => {
    supabase.from('vehicles').select('*').eq('id', sale.id).single().then(({ data: fullVehicle }) => {
      if (fullVehicle) {
        openPopup(
          <VehiclePopup vehicle={fullVehicle as unknown as FeedVehicle} />,
          [sale.year, sale.make, sale.model].filter(Boolean).join(' '),
          480,
        );
      }
    });
  };

  const handleOpenTab = () => {
    window.open(`/?makes=${encodeURIComponent(make)}&models=${encodeURIComponent(model)}`, '_blank');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Header stats */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #ccc', display: 'flex', gap: 16, alignItems: 'center' }}>
        <StatCell label="TOTAL" value={data.total.toLocaleString()} />
        {data.for_sale > 0 && <StatCell label="FOR SALE NOW" value={data.for_sale.toLocaleString()} highlight />}
        {data.year_range && (
          <StatCell label="YEARS" value={`${data.year_range.min}–${data.year_range.max}`} />
        )}
      </div>

      {/* Price scatter — the "shape" of this model's market */}
      {data.price_scatter.length >= 5 && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #ccc' }}>
          <SectionLabel>PRICE TOPOLOGY</SectionLabel>
          <PriceScatter points={data.price_scatter} />
        </div>
      )}

      {/* Live now */}
      {filteredLive.length > 0 && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #ccc' }}>
          <SectionLabel>FOR SALE NOW</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, marginTop: 6 }}>
            {filteredLive.map((s) => (
              <VehicleMiniCard key={s.id} sale={s} onClick={() => handleVehicleClick(s)} showEstimate />
            ))}
          </div>
        </div>
      )}

      {/* Recent sales */}
      {filteredSales.length > 0 && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #ccc' }}>
          <SectionLabel>RECENT SALES</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, marginTop: 6 }}>
            {filteredSales.map((s) => (
              <VehicleMiniCard key={s.id} sale={s} onClick={() => handleVehicleClick(s)} />
            ))}
          </div>
        </div>
      )}

      {/* Sources */}
      {data.sources.length > 0 && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #ccc' }}>
          <SectionLabel>SOURCES</SectionLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
            {data.sources.map((s) => (
              <span
                key={s.label}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  fontFamily: SANS, fontSize: 8, fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '0.10em',
                  padding: '2px 6px', border: '1px solid #ccc', color: '#333',
                }}
              >
                {s.label}
                <span style={{ fontFamily: MONO, fontSize: 7, fontWeight: 400, color: '#999' }}>{s.cnt}</span>
              </span>
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

function VehicleMiniCard({ sale, onClick, showEstimate }: {
  sale: SaleVehicle;
  onClick: () => void;
  showEstimate?: boolean;
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
        {sale.primary_image_url && (
          <img
            src={sale.primary_image_url}
            alt={[sale.year, sale.model].filter(Boolean).join(' ')}
            loading="lazy"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          />
        )}
      </div>
      <div style={{ padding: '3px 5px' }}>
        <div style={{ fontFamily: SANS, fontSize: 8, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#1a1a1a' }}>
          {[sale.year, sale.model].filter(Boolean).join(' ')}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, color: '#16825d' }}>
            {formatPrice(sale.sale_price)}
          </span>
          {sale.sale_date && (
            <span style={{ fontFamily: MONO, fontSize: 7, color: '#999' }}>
              {new Date(sale.sale_date).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}
            </span>
          )}
        </div>
        {sale.mileage != null && sale.mileage > 0 && (
          <div style={{ fontFamily: MONO, fontSize: 7, color: '#999' }}>
            {Math.floor(sale.mileage).toLocaleString()} mi
          </div>
        )}
        {showEstimate && sale.nuke_estimate != null && sale.nuke_estimate > 0 && (
          <div style={{ fontFamily: MONO, fontSize: 7, color: '#666' }}>
            est. {formatPrice(sale.nuke_estimate)}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * PriceScatter — Canvas-rendered year vs price dot plot.
 * Shows the "shape" of a model's market — where the heat is.
 */
function PriceScatter({ points }: { points: { y: number; p: number }[] }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  const { minY, maxY, minP, maxP } = useMemo(() => {
    const years = points.map(d => d.y);
    const prices = points.map(d => d.p);
    return {
      minY: Math.min(...years),
      maxY: Math.max(...years),
      minP: 0,
      maxP: Math.max(...prices),
    };
  }, [points]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.fillStyle = '#f8f8f8';
    ctx.fillRect(0, 0, w, h);

    const pad = { l: 36, r: 8, t: 6, b: 16 };
    const pw = w - pad.l - pad.r;
    const ph = h - pad.t - pad.b;
    const yearSpan = maxY - minY || 1;
    const priceSpan = maxP - minP || 1;

    // Y-axis labels
    ctx.fillStyle = '#999';
    ctx.font = '7px Arial';
    ctx.textAlign = 'right';
    const priceTicks = [0, Math.round(maxP / 2), maxP];
    for (const tick of priceTicks) {
      const py = pad.t + ph - (tick / priceSpan) * ph;
      ctx.fillText(tick >= 1000 ? `$${Math.round(tick / 1000)}K` : `$${tick}`, pad.l - 4, py + 3);
      ctx.strokeStyle = '#e8e8e8';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(pad.l, py);
      ctx.lineTo(pad.l + pw, py);
      ctx.stroke();
    }

    // X-axis labels
    ctx.textAlign = 'center';
    const yearTicks = [minY, Math.round((minY + maxY) / 2), maxY];
    for (const tick of yearTicks) {
      const px = pad.l + ((tick - minY) / yearSpan) * pw;
      ctx.fillText(String(tick), px, h - 2);
    }

    // Dots
    for (const pt of points) {
      const px = pad.l + ((pt.y - minY) / yearSpan) * pw;
      const py = pad.t + ph - ((pt.p - minP) / priceSpan) * ph;
      ctx.beginPath();
      ctx.arc(px, py, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(42, 42, 42, 0.5)';
      ctx.fill();
    }
  }, [points, minY, maxY, minP, maxP]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: 90, marginTop: 4, display: 'block' }}
    />
  );
}

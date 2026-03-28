/**
 * ModelPopup — When you click a model badge.
 *
 * Principle: "Show specific things, not summaries."
 *
 * Shows actual recent sales with images, prices, and dates.
 * Shows for-sale count, not meaningless medians.
 * Every vehicle card is clickable into the popup stack.
 */

import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { usePopup } from './usePopup';
import { VehiclePopup } from './VehiclePopup';
import type { FeedVehicle } from '../../feed/types/feed';

interface Props {
  make: string;
  model: string;
  searchQuery?: string;
}

interface RecentSale {
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

interface ModelData {
  total: number;
  forSale: number;
  recentSales: RecentSale[];
  liveNow: RecentSale[];
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
  const [data, setData] = useState<ModelData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Count total + for sale
      const [{ count: total }, { count: forSale }] = await Promise.all([
        supabase.from('vehicles').select('id', { count: 'exact', head: true })
          .eq('is_public', true).eq('make', make).eq('model', model),
        supabase.from('vehicles').select('id', { count: 'exact', head: true })
          .eq('is_public', true).eq('make', make).eq('model', model).eq('is_for_sale', true),
      ]);

      if (cancelled) return;

      // Recent sales (with images, dates, mileage)
      const { data: recent } = await supabase
        .from('vehicles')
        .select('id, year, make, model, sale_price, primary_image_url, sale_date, mileage, nuke_estimate')
        .eq('is_public', true).eq('make', make).eq('model', model)
        .not('sale_price', 'is', null).gt('sale_price', 0)
        .order('sale_date', { ascending: false, nullsFirst: false })
        .limit(6);

      // Live now
      const { data: live } = await supabase
        .from('vehicles')
        .select('id, year, make, model, sale_price, primary_image_url, sale_date, mileage, nuke_estimate')
        .eq('is_public', true).eq('make', make).eq('model', model)
        .eq('is_for_sale', true)
        .order('created_at', { ascending: false })
        .limit(4);

      if (!cancelled) {
        setData({
          total: total || 0,
          forSale: forSale || 0,
          recentSales: (recent || []) as RecentSale[],
          liveNow: (live || []) as RecentSale[],
        });
        setLoading(false);
      }
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
    ? data.recentSales.filter(s =>
        String(s.year || '').includes(sq) ||
        (s.model || '').toLowerCase().includes(sq) ||
        formatPrice(s.sale_price).toLowerCase().includes(sq))
    : data.recentSales;
  const filteredLive = sq
    ? data.liveNow.filter(s =>
        String(s.year || '').includes(sq) ||
        (s.model || '').toLowerCase().includes(sq))
    : data.liveNow;

  const handleVehicleClick = (sale: RecentSale) => {
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
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #ccc', display: 'flex', gap: 16 }}>
        <StatCell label="TOTAL" value={data.total.toLocaleString()} />
        {data.forSale > 0 && <StatCell label="FOR SALE NOW" value={data.forSale.toLocaleString()} highlight />}
      </div>

      {/* Live now */}
      {filteredLive.length > 0 && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #ccc' }}>
          <SectionLabel>FOR SALE NOW</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, marginTop: 6 }}>
            {filteredLive.map((s) => (
              <VehicleMiniCard
                key={s.id}
                sale={s}
                onClick={() => handleVehicleClick(s)}
                showEstimate
              />
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
              <VehicleMiniCard
                key={s.id}
                sale={s}
                onClick={() => handleVehicleClick(s)}
              />
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
  sale: {
    id: string; year: number | null; model: string | null;
    sale_price: number | null; primary_image_url: string | null;
    sale_date: string | null; mileage: number | null; nuke_estimate: number | null;
  };
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
        {sale.mileage && (
          <div style={{ fontFamily: MONO, fontSize: 7, color: '#999' }}>
            {Math.floor(sale.mileage).toLocaleString()} mi
          </div>
        )}
        {showEstimate && sale.nuke_estimate && sale.nuke_estimate > 0 && (
          <div style={{ fontFamily: MONO, fontSize: 7, color: '#666' }}>
            est. {formatPrice(sale.nuke_estimate)}
          </div>
        )}
      </div>
    </div>
  );
}

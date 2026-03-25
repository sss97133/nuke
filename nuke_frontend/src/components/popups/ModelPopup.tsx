/**
 * ModelPopup — When you click a model badge.
 *
 * Vehicle count, price range, year range.
 * Recent sales (each clickable -> VehiclePopup).
 * "VIEW IN FEED" button.
 *
 * NEVER shows "average price." Uses median, price range, or specific comps.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { usePopup } from './usePopup';
import { VehiclePopup } from './VehiclePopup';
import type { FeedVehicle } from '../../feed/types/feed';

interface Props {
  make: string;
  model: string;
}

interface RecentSale {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  sale_price: number | null;
  primary_image_url: string | null;
  sale_date: string | null;
}

interface ModelData {
  total: number;
  medianPrice: number | null;
  priceRange: [number, number] | null;
  yearRange: [number, number] | null;
  recentSales: RecentSale[];
}

function formatPrice(n: number | null): string {
  if (n == null || n <= 0) return '--';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toLocaleString()}`;
}

export function ModelPopup({ make, model }: Props) {
  const { openPopup } = usePopup();
  const navigate = useNavigate();
  const [data, setData] = useState<ModelData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Count
      const { count } = await supabase
        .from('vehicles')
        .select('id', { count: 'exact', head: true })
        .eq('is_public', true)
        .eq('make', make)
        .eq('model', model);

      // Prices + years
      const { data: priceRows } = await supabase
        .from('vehicles')
        .select('sale_price, year')
        .eq('is_public', true)
        .eq('make', make)
        .eq('model', model)
        .not('sale_price', 'is', null)
        .gt('sale_price', 0)
        .limit(300);

      if (cancelled) return;

      const prices = (priceRows || []).map((r: any) => r.sale_price as number).sort((a: number, b: number) => a - b);
      const years = (priceRows || []).map((r: any) => r.year as number).filter((y: number) => y > 1800);
      const mid = Math.floor(prices.length / 2);
      const medianPrice = prices.length > 0
        ? (prices.length % 2 === 0 ? Math.round((prices[mid - 1] + prices[mid]) / 2) : prices[mid])
        : null;
      const priceRange: [number, number] | null = prices.length > 0
        ? [prices[0], prices[prices.length - 1]] : null;
      const yearRange: [number, number] | null = years.length > 0
        ? [Math.min(...years), Math.max(...years)] : null;

      // Recent sales
      const { data: recent } = await supabase
        .from('vehicles')
        .select('id, year, make, model, sale_price, primary_image_url, sale_date')
        .eq('is_public', true)
        .eq('make', make)
        .eq('model', model)
        .not('sale_price', 'is', null)
        .gt('sale_price', 0)
        .not('primary_image_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(4);

      if (!cancelled) {
        setData({
          total: count || 0,
          medianPrice,
          priceRange,
          yearRange,
          recentSales: (recent || []) as RecentSale[],
        });
        setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [make, model]);

  const mono = "'Courier New', monospace";
  const sans = 'Arial, sans-serif';

  if (loading || !data) {
    return (
      <div style={{ padding: 20, textAlign: 'center' }}>
        <span style={{ fontFamily: sans, fontSize: 8, fontWeight: 700, textTransform: 'uppercase', color: '#999', letterSpacing: '0.5px' }}>
          LOADING...
        </span>
      </div>
    );
  }

  const handleVehicleClick = (sale: RecentSale) => {
    supabase
      .from('vehicles')
      .select('*')
      .eq('id', sale.id)
      .single()
      .then(({ data: fullVehicle }) => {
        if (fullVehicle) {
          openPopup(
            <VehiclePopup vehicle={fullVehicle as unknown as FeedVehicle} />,
            [sale.year, sale.make, sale.model].filter(Boolean).join(' '),
            420,
          );
        }
      });
  };

  const handleViewInFeed = () => {
    navigate(`/?makes=${encodeURIComponent(make)}&models=${encodeURIComponent(model)}`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Aggregates */}
      <div style={{
        padding: '10px 12px', borderBottom: '1px solid #ccc',
        display: 'flex', gap: 16, flexWrap: 'wrap',
      }}>
        <StatCell label="VEHICLES" value={data.total.toLocaleString()} />
        {data.medianPrice && <StatCell label="MEDIAN PRICE" value={formatPrice(data.medianPrice)} />}
        {data.priceRange && (
          <StatCell label="PRICE RANGE" value={`${formatPrice(data.priceRange[0])} - ${formatPrice(data.priceRange[1])}`} />
        )}
        {data.yearRange && (
          <StatCell
            label="YEARS"
            value={data.yearRange[0] === data.yearRange[1]
              ? String(data.yearRange[0])
              : `${data.yearRange[0]}-${data.yearRange[1]}`}
          />
        )}
      </div>

      {/* Recent sales */}
      {data.recentSales.length > 0 && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #ccc' }}>
          <SectionLabel>RECENT SALES</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, marginTop: 6 }}>
            {data.recentSales.map((s) => (
              <div
                key={s.id}
                onClick={() => handleVehicleClick(s)}
                style={{
                  cursor: 'pointer', border: '1px solid #ccc',
                  background: '#fff', overflow: 'hidden',
                  transition: 'border-color 150ms ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#2a2a2a'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#ccc'; }}
              >
                <div style={{ width: '100%', paddingTop: '66%', position: 'relative', background: '#e0e0e0' }}>
                  {s.primary_image_url && (
                    <img
                      src={s.primary_image_url}
                      alt={[s.year, s.make, s.model].filter(Boolean).join(' ')}
                      loading="lazy"
                      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  )}
                </div>
                <div style={{ padding: '3px 5px' }}>
                  <div style={{
                    fontFamily: sans, fontSize: 8, fontWeight: 700,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    color: '#1a1a1a',
                  }}>
                    {[s.year, s.model].filter(Boolean).join(' ')}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontFamily: mono, fontSize: 9, fontWeight: 700, color: '#16825d' }}>
                      {formatPrice(s.sale_price)}
                    </span>
                    {s.sale_date && (
                      <span style={{ fontFamily: mono, fontSize: 7, color: '#999' }}>
                        {new Date(s.sale_date).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* VIEW IN FEED */}
      <div style={{ padding: '10px 12px', textAlign: 'right' }}>
        <button
          onClick={handleViewInFeed}
          style={{
            fontFamily: sans, fontSize: 9, fontWeight: 800,
            textTransform: 'uppercase', letterSpacing: '0.3px',
            padding: '4px 12px', border: '2px solid #2a2a2a',
            background: '#2a2a2a', color: '#fff',
            cursor: 'pointer', transition: 'opacity 150ms ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.8'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
        >
          VIEW IN FEED
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span style={{
        fontFamily: 'Arial, sans-serif', fontSize: 7, fontWeight: 800,
        textTransform: 'uppercase', letterSpacing: '0.5px',
        color: '#999', lineHeight: 1,
      }}>
        {label}
      </span>
      <span style={{
        fontFamily: "'Courier New', monospace", fontSize: 11, fontWeight: 700,
        color: '#1a1a1a', lineHeight: 1.2,
      }}>
        {value}
      </span>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontFamily: 'Arial, sans-serif', fontSize: 7, fontWeight: 800,
      textTransform: 'uppercase', letterSpacing: '0.5px',
      color: '#999', lineHeight: 1,
    }}>
      {children}
    </span>
  );
}

/**
 * SourcePopup — When you click a source badge.
 *
 * Total vehicles, fill rates (% photos, VIN, description),
 * last ingested, new this week.
 * Top makes (each clickable -> MakePopup).
 *
 * NEVER shows "average price." Uses median.
 */

import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { usePopup } from './usePopup';
import { MakePopup } from './MakePopup';

interface Props {
  source: string;
  searchQuery?: string;
}

interface SourceData {
  total: number;
  medianPrice: number | null;
  fillRates: { field: string; pct: number }[];
  lastIngested: string | null;
  newThisWeek: number;
  topMakes: { label: string; count: number }[];
}

function formatPrice(n: number | null): string {
  if (n == null || n <= 0) return '--';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toLocaleString()}`;
}

export function SourcePopup({ source, searchQuery }: Props) {
  const { openPopup } = usePopup();
  const [data, setData] = useState<SourceData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Count + full sample for stats
      const { data: rows, count } = await supabase
        .from('vehicles')
        .select('sale_price, make, mileage, vin, primary_image_url, canonical_body_style, created_at', { count: 'exact' })
        .eq('is_public', true)
        .eq('platform_source', source)
        .limit(500);

      if (cancelled) return;

      const allRows = rows || [];
      const total = count || allRows.length;

      // Median price
      const prices = allRows
        .map((r: any) => r.sale_price as number)
        .filter((p) => p != null && p > 0)
        .sort((a, b) => a - b);
      const mid = Math.floor(prices.length / 2);
      const medianPrice = prices.length > 0
        ? (prices.length % 2 === 0 ? Math.round((prices[mid - 1] + prices[mid]) / 2) : prices[mid])
        : null;

      // Fill rates
      const n = allRows.length || 1;
      const fieldLabels: Record<string, string> = {
        sale_price: 'PRICE',
        mileage: 'MILEAGE',
        vin: 'VIN',
        primary_image_url: 'PHOTOS',
        canonical_body_style: 'BODY STYLE',
      };
      const fields = ['sale_price', 'mileage', 'vin', 'primary_image_url', 'canonical_body_style'];
      const fillRates = fields.map((f) => ({
        field: fieldLabels[f] || f,
        pct: Math.round(
          (allRows.filter((r: any) => {
            const v = r[f];
            return v != null && v !== '' && v !== 0;
          }).length / n) * 100,
        ),
      })).sort((a, b) => b.pct - a.pct);

      // Last ingested
      const dates = allRows
        .map((r: any) => r.created_at as string)
        .filter(Boolean)
        .sort()
        .reverse();
      const lastIngested = dates[0] || null;

      // New this week
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const newThisWeek = allRows.filter((r: any) => r.created_at && r.created_at > weekAgo).length;

      // Top makes
      const makeCounts = new Map<string, number>();
      for (const r of allRows) {
        const m = (r as any).make;
        if (m) makeCounts.set(m, (makeCounts.get(m) || 0) + 1);
      }
      const topMakes = Array.from(makeCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([label, cnt]) => ({ label, count: cnt }));

      if (!cancelled) {
        setData({ total, medianPrice, fillRates, lastIngested, newThisWeek, topMakes });
        setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [source]);

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

  const sq = (searchQuery || '').toLowerCase().trim();
  const filteredMakes = sq
    ? data.topMakes.filter(m => m.label.toLowerCase().includes(sq))
    : data.topMakes;
  const filteredFillRates = sq
    ? data.fillRates.filter(r => r.field.toLowerCase().includes(sq))
    : data.fillRates;

  const handleMakeClick = (make: string) => {
    openPopup(<MakePopup make={make} />, make, 360);
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
        <StatCell label="NEW THIS WEEK" value={String(data.newThisWeek)} />
        {data.lastIngested && (
          <StatCell
            label="LAST INGESTED"
            value={new Date(data.lastIngested).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          />
        )}
      </div>

      {/* Fill rates */}
      {filteredFillRates.length > 0 && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #ccc' }}>
          <SectionLabel>DATA FILL RATES</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
            {filteredFillRates.map((r) => {
              const barColor = r.pct >= 80 ? '#16825d' : r.pct >= 50 ? '#b05a00' : '#999';
              return (
                <div key={r.field} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    fontFamily: sans, fontSize: 8, fontWeight: 700,
                    color: '#666', width: 70, flexShrink: 0,
                    textTransform: 'uppercase',
                  }}>
                    {r.field}
                  </span>
                  <div style={{ flex: 1, height: 6, background: '#e0e0e0', position: 'relative' }}>
                    <div style={{
                      position: 'absolute', left: 0, top: 0, height: '100%',
                      width: `${Math.min(r.pct, 100)}%`,
                      background: barColor,
                      transition: 'width 150ms ease',
                    }} />
                  </div>
                  <span style={{
                    fontFamily: mono, fontSize: 8, fontWeight: 700,
                    color: barColor, width: 28, textAlign: 'right', flexShrink: 0,
                  }}>
                    {r.pct}%
                  </span>
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
              <FacetChip key={m.label} label={m.label} count={m.count} onClick={() => handleMakeClick(m.label)} />
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

function FacetChip({ label, count, onClick }: { label: string; count: number; onClick: () => void }) {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick(); }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3,
        fontFamily: 'Arial, sans-serif', fontSize: 8, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.10em',
        padding: '2px 6px', border: '1px solid #ccc',
        color: '#333', cursor: 'pointer',
        transition: 'border-color 150ms ease, background 150ms ease',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#2a2a2a'; e.currentTarget.style.background = '#e8e8e8'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#ccc'; e.currentTarget.style.background = 'transparent'; }}
    >
      {label}
      <span style={{
        fontFamily: "'Courier New', monospace", fontSize: 7, fontWeight: 400,
        color: '#999',
      }}>
        {count}
      </span>
    </span>
  );
}

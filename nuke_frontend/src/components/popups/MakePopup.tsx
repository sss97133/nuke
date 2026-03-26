/**
 * MakePopup — When you click a make badge.
 *
 * Total vehicles, median price, year range.
 * Top models (each clickable -> ModelPopup).
 * Top sources (each clickable -> SourcePopup).
 * Price bracket distribution.
 * "VIEW IN FEED" button.
 *
 * NEVER shows "average price." Uses median, price range, or specific comps.
 */

import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { usePopup } from './usePopup';
import { ModelPopup } from './ModelPopup';
import { SourcePopup } from './SourcePopup';

interface Props {
  make: string;
  searchQuery?: string;
}

interface MakeData {
  total: number;
  medianPrice: number | null;
  priceRange: [number, number] | null;
  yearRange: [number, number] | null;
  topModels: { label: string; count: number }[];
  topSources: { label: string; count: number }[];
  priceBrackets: { label: string; count: number }[];
}

function formatPrice(n: number | null): string {
  if (n == null || n <= 0) return '--';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toLocaleString()}`;
}

export function MakePopup({ make, searchQuery }: Props) {
  const { openPopup } = usePopup();
  const [data, setData] = useState<MakeData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Count
      const { count } = await supabase
        .from('vehicles')
        .select('id', { count: 'exact', head: true })
        .eq('is_public', true)
        .eq('make', make);

      // Prices for median + brackets
      const { data: priceRows } = await supabase
        .from('vehicles')
        .select('sale_price, year, model, platform_source')
        .eq('is_public', true)
        .eq('make', make)
        .not('sale_price', 'is', null)
        .gt('sale_price', 0)
        .limit(500);

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

      // Top models
      const modelCounts = new Map<string, number>();
      for (const r of priceRows || []) {
        const m = (r as any).model;
        if (m) modelCounts.set(m, (modelCounts.get(m) || 0) + 1);
      }
      const topModels = Array.from(modelCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([label, count]) => ({ label, count }));

      // Top sources
      const srcCounts = new Map<string, number>();
      for (const r of priceRows || []) {
        const s = (r as any).platform_source;
        if (s) srcCounts.set(s, (srcCounts.get(s) || 0) + 1);
      }
      const topSources = Array.from(srcCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([label, count]) => ({ label, count }));

      // Price brackets
      const brackets = [
        { label: 'Under $10K', min: 0, max: 10000 },
        { label: '$10K-$25K', min: 10000, max: 25000 },
        { label: '$25K-$50K', min: 25000, max: 50000 },
        { label: '$50K-$100K', min: 50000, max: 100000 },
        { label: '$100K-$250K', min: 100000, max: 250000 },
        { label: '$250K+', min: 250000, max: Infinity },
      ];
      const priceBrackets = brackets
        .map((b) => ({
          label: b.label,
          count: prices.filter((p) => p >= b.min && p < b.max).length,
        }))
        .filter((b) => b.count > 0);

      if (!cancelled) {
        setData({
          total: count || 0,
          medianPrice,
          priceRange,
          yearRange,
          topModels,
          topSources,
          priceBrackets,
        });
        setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [make]);

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
  const filteredModels = sq
    ? data.topModels.filter(m => m.label.toLowerCase().includes(sq))
    : data.topModels;
  const filteredSources = sq
    ? data.topSources.filter(s => s.label.toLowerCase().includes(sq))
    : data.topSources;
  const filteredBrackets = sq
    ? data.priceBrackets.filter(b => b.label.toLowerCase().includes(sq))
    : data.priceBrackets;

  const handleModelClick = (model: string) => {
    openPopup(<ModelPopup make={make} model={model} />, model, 360);
  };

  const handleSourceClick = (source: string) => {
    openPopup(<SourcePopup source={source} />, source.toUpperCase(), 360);
  };

  const handleOpenTab = () => {
    window.open(`/?makes=${encodeURIComponent(make)}`, '_blank');
  };

  const maxBracketCount = Math.max(...data.priceBrackets.map((b) => b.count), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Aggregates */}
      <div style={{
        padding: '10px 12px', borderBottom: '1px solid #ccc',
        display: 'flex', gap: 16,
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

      {/* Top models */}
      {filteredModels.length > 0 && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #ccc' }}>
          <SectionLabel>TOP MODELS</SectionLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
            {filteredModels.map((m) => (
              <FacetChip key={m.label} label={m.label} count={m.count} onClick={() => handleModelClick(m.label)} />
            ))}
          </div>
        </div>
      )}

      {/* Top sources */}
      {filteredSources.length > 0 && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #ccc' }}>
          <SectionLabel>TOP SOURCES</SectionLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
            {filteredSources.map((s) => (
              <FacetChip key={s.label} label={s.label} count={s.count} onClick={() => handleSourceClick(s.label)} />
            ))}
          </div>
        </div>
      )}

      {/* Price brackets */}
      {filteredBrackets.length > 0 && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #ccc' }}>
          <SectionLabel>PRICE DISTRIBUTION</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
            {filteredBrackets.map((b) => (
              <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  fontFamily: sans, fontSize: 8, fontWeight: 700,
                  color: '#666', width: 70, flexShrink: 0,
                  textTransform: 'uppercase',
                }}>
                  {b.label}
                </span>
                <div style={{ flex: 1, height: 8, background: '#e0e0e0', position: 'relative' }}>
                  <div style={{
                    position: 'absolute', left: 0, top: 0, height: '100%',
                    width: `${(b.count / maxBracketCount) * 100}%`,
                    background: '#2a2a2a',
                    transition: 'width 150ms ease',
                  }} />
                </div>
                <span style={{
                  fontFamily: mono, fontSize: 8, fontWeight: 700,
                  color: '#999', width: 24, textAlign: 'right', flexShrink: 0,
                }}>
                  {b.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB — opens filtered feed in new browser tab */}
      <div style={{ padding: '10px 12px', textAlign: 'right' }}>
        <button
          onClick={handleOpenTab}
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
          TAB
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

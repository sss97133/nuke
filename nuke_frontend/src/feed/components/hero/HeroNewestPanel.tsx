/**
 * HeroNewestPanel -- Live intake pulse of the collector car market.
 *
 * Shows what's pouring through the spout RIGHT NOW:
 * - Top line: "+32,386 TODAY" in big Courier New
 * - Source flow bars: horizontal proportional bars (BAT +3,091 | FB +2,118 etc)
 * - Make heatmap: mini treemap of top 10 arriving makes
 * - Price bracket bars: distribution by price
 *
 * Data from hero_newest() RPC -- server-side aggregation across full dataset.
 * Cached 5 minutes via React Query.
 */

import { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import type { HeroFilter } from '../HeroPanel';

// ---------------------------------------------------------------------------
// Types (match hero_newest() jsonb output)
// ---------------------------------------------------------------------------

interface SourceFlowItem {
  source: string;
  count: number;
  count_1h: number;
}

interface MakeHeatmapItem {
  make: string;
  count: number;
}

interface PriceBracketItem {
  bracket: string;
  count: number;
}

interface NewestData {
  total_24h: number;
  total_1h: number;
  source_flow: SourceFlowItem[];
  make_heatmap: MakeHeatmapItem[];
  price_brackets: PriceBracketItem[];
}

// Source display names
const SOURCE_LABELS: Record<string, string> = {
  bat: 'BAT',
  'facebook-marketplace': 'FB MKTPLACE',
  bonhams: 'BONHAMS',
  gooding: 'GOODING',
  pcarmarket: 'PCAR',
  hagerty: 'HAGERTY',
  jamesedition: 'JAMES ED',
  'cars-and-bids': 'C&B',
  craigslist: 'CL',
  mecum: 'MECUM',
  'rm-sothebys': 'RM',
  ebay: 'EBAY',
  hemmings: 'HEMMINGS',
  unknown: 'OTHER',
  'barrett-jackson': 'BJ',
  ksl: 'KSL',
  conceptcarz: 'CONCEPTCARZ',
  'beverly-hills-car-club': 'BHCC',
};

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source.toUpperCase().replace(/[-_]/g, ' ').slice(0, 10);
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}K`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

// Price bracket to filter mapping
const BRACKET_FILTERS: Record<string, { priceMin?: number; priceMax?: number }> = {
  'Under $5K': { priceMax: 5_000 },
  '$5-10K': { priceMin: 5_000, priceMax: 10_000 },
  '$10-25K': { priceMin: 10_000, priceMax: 25_000 },
  '$25-50K': { priceMin: 25_000, priceMax: 50_000 },
  '$50-100K': { priceMin: 50_000, priceMax: 100_000 },
  '$100-250K': { priceMin: 100_000, priceMax: 250_000 },
  '$250K+': { priceMin: 250_000 },
};

// ---------------------------------------------------------------------------
// Squarified treemap (Bruls, Huizing, van Wijk 2000)
// ---------------------------------------------------------------------------

interface TreeRect {
  label: string;
  count: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

function worstRatio(row: number[], w: number): number {
  const s = row.reduce((a, b) => a + b, 0);
  const mx = Math.max(...row);
  const mn = Math.min(...row);
  const w2 = w * w;
  const s2 = s * s;
  return Math.max((w2 * mx) / s2, s2 / (w2 * mn));
}

function squarify(
  items: { label: string; count: number }[],
  x: number, y: number, w: number, h: number,
): TreeRect[] {
  if (items.length === 0 || w <= 0 || h <= 0) return [];
  const sorted = [...items].sort((a, b) => b.count - a.count);
  const totalArea = sorted.reduce((s, i) => s + i.count, 0);
  if (totalArea <= 0) return [];
  const scale = (w * h) / totalArea;
  const scaled = sorted.map((b) => ({ ...b, area: b.count * scale }));
  const result: TreeRect[] = [];
  layoutRow(scaled, x, y, w, h, result);
  return result;
}

function layoutRow(
  items: { label: string; count: number; area: number }[],
  x: number, y: number, w: number, h: number, result: TreeRect[],
): void {
  if (items.length === 0) return;
  if (items.length === 1) {
    result.push({ label: items[0].label, count: items[0].count, x, y, w, h });
    return;
  }
  const shorter = Math.min(w, h);
  const horizontal = w >= h;
  let row = [items[0]];
  let remaining = items.slice(1);
  while (remaining.length > 0) {
    const candidate = remaining[0];
    const currentAreas = row.map((r) => r.area);
    const candidateAreas = [...currentAreas, candidate.area];
    if (worstRatio(candidateAreas, shorter) <= worstRatio(currentAreas, shorter)) {
      row.push(candidate);
      remaining = remaining.slice(1);
    } else {
      break;
    }
  }
  const rowArea = row.reduce((s, r) => s + r.area, 0);
  if (horizontal) {
    const rowW = rowArea / h;
    let cy = y;
    for (const item of row) {
      const itemH = item.area / rowW;
      result.push({ label: item.label, count: item.count, x, y: cy, w: rowW, h: itemH });
      cy += itemH;
    }
    layoutRow(remaining, x + rowW, y, w - rowW, h, result);
  } else {
    const rowH = rowArea / w;
    let cx = x;
    for (const item of row) {
      const itemW = item.area / rowH;
      result.push({ label: item.label, count: item.count, x: cx, y, w: itemW, h: rowH });
      cx += itemW;
    }
    layoutRow(remaining, x, y + rowH, w, h - rowH, result);
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SourceFlowBars({
  sources,
  onFilter,
}: {
  sources: SourceFlowItem[];
  onFilter: (filter: HeroFilter) => void;
}) {
  const maxCount = Math.max(...sources.map((s) => s.count), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', flex: 1, minWidth: 0 }}>
      <div style={{
        fontFamily: 'Arial, sans-serif', fontSize: '8px', fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-disabled)',
        marginBottom: '2px',
      }}>
        SOURCE FLOW (24H)
      </div>
      {sources.slice(0, 10).map((s) => {
        const pct = (s.count / maxCount) * 100;
        return (
          <SourceBar
            key={s.source}
            source={s.source}
            count={s.count}
            widthPct={pct}
            onClick={() => onFilter({ sources: [s.source], sort: 'newest' as any })}
          />
        );
      })}
    </div>
  );
}

function SourceBar({
  source, count, widthPct, onClick,
}: {
  source: string; count: number; widthPct: number; onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', height: '16px' }}
    >
      <span style={{
        fontFamily: 'Arial, sans-serif', fontSize: '8px', fontWeight: 700,
        textTransform: 'uppercase', color: hovered ? 'var(--text)' : 'var(--text-secondary)',
        minWidth: '68px', textAlign: 'right', letterSpacing: '0.3px', whiteSpace: 'nowrap',
        transition: 'color 120ms ease-out',
      }}>
        {sourceLabel(source)}
      </span>
      <div style={{ flex: 1, height: '12px', position: 'relative' }}>
        <div style={{
          width: `${Math.max(widthPct, 2)}%`, height: '100%',
          border: `2px solid ${hovered ? 'var(--text)' : 'var(--border)'}`,
          background: hovered ? 'var(--surface-hover)' : 'var(--surface)',
          transition: 'border-color 120ms ease-out, background 120ms ease-out, width 300ms ease-out',
          boxSizing: 'border-box',
        }} />
      </div>
      <span style={{
        fontFamily: "'Courier New', monospace", fontSize: '9px', fontWeight: 700,
        color: hovered ? 'var(--text)' : 'var(--text-secondary)',
        minWidth: '44px', textAlign: 'right', transition: 'color 120ms ease-out',
      }}>
        +{fmtNum(count)}
      </span>
    </div>
  );
}

function MakeTreemap({
  makes, containerWidth, onFilter,
}: {
  makes: MakeHeatmapItem[]; containerWidth: number; onFilter: (filter: HeroFilter) => void;
}) {
  const top10 = makes.slice(0, 12);
  const treemapHeight = 120;
  const rects = useMemo(
    () => squarify(top10.map((m) => ({ label: m.make, count: m.count })), 0, 0, containerWidth, treemapHeight),
    [top10, containerWidth],
  );

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{
        fontFamily: 'Arial, sans-serif', fontSize: '8px', fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-disabled)',
        marginBottom: '2px',
      }}>
        MAKES ARRIVING
      </div>
      <div style={{ position: 'relative', width: containerWidth, height: treemapHeight }}>
        {rects.map((rect) => (
          <MakeCell
            key={rect.label}
            rect={rect}
            onClick={() => onFilter({ makes: [rect.label], sort: 'newest' as any })}
          />
        ))}
      </div>
    </div>
  );
}

function MakeCell({ rect, onClick }: { rect: TreeRect; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const { label, count, x, y, w, h } = rect;
  const canShowLabel = w > 28 && h > 14;
  const canShowCount = w > 36 && h > 28;
  const area = w * h;
  const labelFontSize = area > 5000 ? 10 : area > 2000 ? 9 : 8;

  return (
    <div
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'absolute', left: x, top: y, width: w, height: h,
        boxSizing: 'border-box',
        border: `2px solid ${hovered ? 'var(--text)' : 'var(--border)'}`,
        background: hovered ? 'var(--surface-hover)' : 'var(--surface)',
        cursor: 'pointer', overflow: 'hidden', padding: 3,
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        transition: 'border-color 120ms ease-out, background 120ms ease-out',
        userSelect: 'none',
      }}
    >
      {canShowLabel && (
        <div style={{
          fontSize: labelFontSize, fontWeight: 700, textTransform: 'uppercase',
          color: 'var(--text)', lineHeight: 1.15, overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'Arial, sans-serif',
          letterSpacing: '0.04em',
        }}>
          {label}
        </div>
      )}
      {canShowCount && (
        <div style={{
          fontSize: 9, fontFamily: "'Courier New', monospace", fontWeight: 700,
          color: 'var(--text-secondary)', lineHeight: 1.3, marginTop: 'auto',
        }}>
          +{fmtNum(count)}
        </div>
      )}
    </div>
  );
}

function PriceBracketBars({
  brackets, onFilter,
}: {
  brackets: PriceBracketItem[]; onFilter: (filter: HeroFilter) => void;
}) {
  const maxCnt = Math.max(...brackets.map((b) => b.count), 1);

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{
        fontFamily: 'Arial, sans-serif', fontSize: '8px', fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-disabled)',
        marginBottom: '2px',
      }}>
        PRICE DISTRIBUTION
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
        {brackets.map((b) => {
          const pct = (b.count / maxCnt) * 100;
          return (
            <PriceBracketBar
              key={b.bracket}
              bracket={b.bracket}
              count={b.count}
              widthPct={pct}
              onClick={() => {
                const f = BRACKET_FILTERS[b.bracket] ?? {};
                onFilter({ ...f, sort: 'price_low' as any });
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function PriceBracketBar({
  bracket, count, widthPct, onClick,
}: {
  bracket: string; count: number; widthPct: number; onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', height: '16px' }}
    >
      <span style={{
        fontFamily: 'Arial, sans-serif', fontSize: '8px', fontWeight: 700,
        textTransform: 'uppercase', color: hovered ? 'var(--text)' : 'var(--text-secondary)',
        minWidth: '58px', textAlign: 'right', letterSpacing: '0.3px', whiteSpace: 'nowrap',
        transition: 'color 120ms ease-out',
      }}>
        {bracket}
      </span>
      <div style={{ flex: 1, height: '12px', position: 'relative' }}>
        <div style={{
          width: `${Math.max(widthPct, 2)}%`, height: '100%',
          border: `2px solid ${hovered ? 'var(--text)' : 'var(--border)'}`,
          background: hovered ? 'var(--surface-hover)' : 'var(--surface)',
          transition: 'border-color 120ms ease-out, background 120ms ease-out, width 300ms ease-out',
          boxSizing: 'border-box',
        }} />
      </div>
      <span style={{
        fontFamily: "'Courier New', monospace", fontSize: '9px', fontWeight: 700,
        color: hovered ? 'var(--text)' : 'var(--text-secondary)',
        minWidth: '36px', textAlign: 'right', transition: 'color 120ms ease-out',
      }}>
        {fmtNum(count)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton (8px bars)
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div style={{ height: '240px', padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ height: 18, width: 200, background: 'var(--border)', opacity: 0.4 }} />
      <div style={{ display: 'flex', gap: 8, flex: 1 }}>
        <div style={{ width: 240, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} style={{ height: 8, width: `${80 - i * 8}%`, background: 'var(--border)', opacity: 0.3 }} />
          ))}
        </div>
        <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 2 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{ height: 8, width: `${30 + Math.random() * 40}%`, background: 'var(--border)', opacity: 0.25 }} />
          ))}
        </div>
        <div style={{ width: 200, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} style={{ height: 8, width: `${60 - i * 6}%`, background: 'var(--border)', opacity: 0.3 }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface HeroNewestPanelProps {
  onFilter: (filter: HeroFilter) => void;
}

export function HeroNewestPanel({ onFilter }: HeroNewestPanelProps) {
  const { data, isLoading } = useQuery<NewestData>({
    queryKey: ['hero_newest'],
    queryFn: async () => {
      const { data: result, error } = await supabase.rpc('hero_newest');
      if (error) throw new Error(`hero_newest RPC error: ${error.message}`);
      return result as unknown as NewestData;
    },
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const [treemapWidth, setTreemapWidth] = useState(0);
  const middleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!middleRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setTreemapWidth(entry.contentRect.width);
    });
    observer.observe(middleRef.current);
    return () => observer.disconnect();
  }, []);

  if (isLoading || !data) return <LoadingSkeleton />;

  const sources = data.source_flow ?? [];
  const makes = data.make_heatmap ?? [];
  const brackets = data.price_brackets ?? [];

  return (
    <div style={{ maxHeight: '240px', overflow: 'hidden' }}>
      {/* Top line: totals */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', padding: '6px 8px 4px' }}>
        <span style={{
          fontFamily: "'Courier New', monospace", fontSize: '18px', fontWeight: 700,
          color: 'var(--text)', letterSpacing: '-0.5px',
        }}>
          +{fmtNum(data.total_24h)} TODAY
        </span>
        {data.total_1h > 0 && (
          <span style={{
            fontFamily: "'Courier New', monospace", fontSize: '13px', fontWeight: 700,
            color: 'var(--text-secondary)',
          }}>
            +{fmtNum(data.total_1h)} THIS HOUR
          </span>
        )}
        <div style={{ flex: 1 }} />
        <span style={{
          fontFamily: 'Arial, sans-serif', fontSize: '8px', fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-disabled)',
        }}>
          INTAKE PULSE
        </span>
      </div>

      {/* Three-column layout: sources | make treemap | price brackets */}
      <div style={{ display: 'flex', gap: '8px', padding: '0 8px 6px', height: '185px' }}>
        {/* Left: Source flow bars */}
        <div style={{ width: '240px', minWidth: '200px', overflow: 'hidden' }}>
          <SourceFlowBars sources={sources} onFilter={onFilter} />
        </div>

        {/* Middle: Make treemap */}
        <div ref={middleRef} style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          {treemapWidth > 0 && (
            <MakeTreemap makes={makes} containerWidth={treemapWidth} onFilter={onFilter} />
          )}
        </div>

        {/* Right: Price brackets */}
        <div style={{ width: '220px', minWidth: '180px', overflow: 'hidden' }}>
          <PriceBracketBars brackets={brackets} onFilter={onFilter} />
        </div>
      </div>
    </div>
  );
}

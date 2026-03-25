/**
 * HeroPanel -- Dimension-specific visualization that slides down between
 * the toolbar and the feed content.
 *
 * Each sort dimension (DEALS, HEAT, YEAR, PRICE, MILES, FINDS) renders
 * a treemap or bar chart. Clicking a cell filters the feed.
 * Clicking the same toolbar button again closes the panel.
 *
 * Data is computed client-side from the loaded vehicle set for instant render.
 */

import { useMemo, useState, useRef, useEffect } from 'react';
import type { FeedVehicle } from '../types/feed';
import type { SortBy } from '../../types/feedTypes';
import { DealsHeroPanel } from './hero/DealsHeroPanel';
import { FindsHeroPanel } from './hero/FindsHeroPanel';
import { HeroNewestPanel } from './hero/HeroNewestPanel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HeroDimension = 'newest' | 'deal_score' | 'heat_score' | 'year' | 'price_high' | 'price_low' | 'mileage' | 'finds';

export interface HeroPanelProps {
  dimension: HeroDimension | null;
  vehicles: FeedVehicle[];
  onFilter: (filter: HeroFilter) => void;
  onClose: () => void;
}

export interface HeroFilter {
  makes?: string[];
  sources?: string[];
  yearMin?: number;
  yearMax?: number;
  priceMin?: number;
  priceMax?: number;
  mileageLabel?: string;
  sort?: SortBy;
}

// ---------------------------------------------------------------------------
// Bucket definitions
// ---------------------------------------------------------------------------

interface Bucket {
  label: string;
  count: number;
  filter: HeroFilter;
}

function buildDealBuckets(vehicles: FeedVehicle[]): Bucket[] {
  const counts = new Map<string, number>();
  for (const v of vehicles) {
    if ((v.deal_score ?? 0) > 70 && v.make) {
      counts.set(v.make, (counts.get(v.make) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([make, count]) => ({
      label: make,
      count,
      filter: { makes: [make], sort: 'deal_score' as SortBy },
    }));
}

function buildHeatBuckets(vehicles: FeedVehicle[]): Bucket[] {
  const sums = new Map<string, number>();
  for (const v of vehicles) {
    if (v.make && (v.heat_score ?? 0) > 0) {
      sums.set(v.make, (sums.get(v.make) ?? 0) + (v.heat_score ?? 0));
    }
  }
  return [...sums.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([make, total]) => ({
      label: make,
      count: total,
      filter: { makes: [make], sort: 'heat_score' as SortBy },
    }));
}

function buildYearBuckets(vehicles: FeedVehicle[]): Bucket[] {
  const decades: Record<string, { label: string; count: number; min: number; max: number }> = {};
  for (const v of vehicles) {
    if (v.year == null) continue;
    const decadeStart = Math.floor(v.year / 10) * 10;
    const key = `${decadeStart}s`;
    if (!decades[key]) {
      decades[key] = { label: key, count: 0, min: decadeStart, max: decadeStart + 9 };
    }
    decades[key].count++;
  }
  return Object.values(decades)
    .sort((a, b) => a.min - b.min)
    .map((d) => ({
      label: d.label,
      count: d.count,
      filter: { yearMin: d.min, yearMax: d.max, sort: 'year' as SortBy },
    }));
}

const PRICE_BRACKETS = [
  { label: 'Under $10K', min: 0, max: 10_000 },
  { label: '$10-25K', min: 10_000, max: 25_000 },
  { label: '$25-50K', min: 25_000, max: 50_000 },
  { label: '$50-100K', min: 50_000, max: 100_000 },
  { label: '$100-250K', min: 100_000, max: 250_000 },
  { label: '$250K+', min: 250_000, max: 999_999_999 },
];

function buildPriceBuckets(vehicles: FeedVehicle[]): Bucket[] {
  const counts = PRICE_BRACKETS.map(() => 0);
  for (const v of vehicles) {
    const p = v.display_price;
    if (p == null || p <= 0) continue;
    for (let i = 0; i < PRICE_BRACKETS.length; i++) {
      if (p >= PRICE_BRACKETS[i].min && p < PRICE_BRACKETS[i].max) {
        counts[i]++;
        break;
      }
    }
  }
  return PRICE_BRACKETS.map((b, i) => ({
    label: b.label,
    count: counts[i],
    filter: {
      priceMin: b.min > 0 ? b.min : undefined,
      priceMax: b.max < 999_999_999 ? b.max : undefined,
      sort: 'price_high' as SortBy,
    },
  }));
}

const MILE_BRACKETS = [
  { label: 'Under 10K', min: 0, max: 10_000 },
  { label: '10-50K', min: 10_000, max: 50_000 },
  { label: '50-100K', min: 50_000, max: 100_000 },
  { label: '100K+', min: 100_000, max: 999_999_999 },
];

function buildMileageBuckets(vehicles: FeedVehicle[]): Bucket[] {
  const counts = MILE_BRACKETS.map(() => 0);
  for (const v of vehicles) {
    const m = v.mileage;
    if (m == null || m < 0) continue;
    for (let i = 0; i < MILE_BRACKETS.length; i++) {
      if (m >= MILE_BRACKETS[i].min && m < MILE_BRACKETS[i].max) {
        counts[i]++;
        break;
      }
    }
  }
  return MILE_BRACKETS.map((b, i) => ({
    label: b.label,
    count: counts[i],
    filter: { mileageLabel: b.label, sort: 'mileage' as SortBy },
  }));
}

function buildFindsBuckets(vehicles: FeedVehicle[]): Bucket[] {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const counts = new Map<string, number>();
  for (const v of vehicles) {
    if (!v.created_at) continue;
    const t = new Date(v.created_at).getTime();
    if (t < sevenDaysAgo) continue;
    const src = v.discovery_source ?? v.profile_origin ?? 'Unknown';
    counts.set(src, (counts.get(src) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([source, count]) => ({
      label: source,
      count,
      filter: { sources: [source], sort: 'newest' as SortBy },
    }));
}

// ---------------------------------------------------------------------------
// Squarified treemap layout (Bruls, Huizing, van Wijk 2000)
// ---------------------------------------------------------------------------

interface TreeRect {
  label: string;
  count: number;
  filter: HeroFilter;
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
  items: Bucket[],
  x: number,
  y: number,
  w: number,
  h: number,
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
  items: { label: string; count: number; filter: HeroFilter; area: number }[],
  x: number,
  y: number,
  w: number,
  h: number,
  result: TreeRect[],
): void {
  if (items.length === 0) return;
  if (items.length === 1) {
    result.push({ label: items[0].label, count: items[0].count, filter: items[0].filter, x, y, w, h });
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
      result.push({ label: item.label, count: item.count, filter: item.filter, x, y: cy, w: rowW, h: itemH });
      cy += itemH;
    }
    layoutRow(remaining, x + rowW, y, w - rowW, h, result);
  } else {
    const rowH = rowArea / w;
    let cx = x;
    for (const item of row) {
      const itemW = item.area / rowH;
      result.push({ label: item.label, count: item.count, filter: item.filter, x: cx, y, w: itemW, h: rowH });
      cx += itemW;
    }
    layoutRow(remaining, x, y + rowH, w, h - rowH, result);
  }
}

// ---------------------------------------------------------------------------
// Cell component
// ---------------------------------------------------------------------------

function TreemapCell({
  rect,
  total,
  onClick,
}: {
  rect: TreeRect;
  total: number;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const { label, count, x, y, w, h } = rect;

  const canShowLabel = w > 28 && h > 16;
  const canShowCount = w > 40 && h > 30;
  const area = w * h;
  const labelFontSize = area > 8000 ? 11 : area > 3000 ? 10 : 9;

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        boxSizing: 'border-box',
        border: `2px solid ${hovered ? 'var(--text)' : 'var(--border)'}`,
        background: hovered ? 'var(--surface-hover)' : 'var(--surface)',
        cursor: 'pointer',
        overflow: 'hidden',
        padding: 4,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        transition: 'border-color 120ms ease-out, background 120ms ease-out',
        userSelect: 'none',
      }}
    >
      {canShowLabel && (
        <div
          style={{
            fontSize: labelFontSize,
            fontWeight: 700,
            textTransform: 'uppercase',
            color: 'var(--text)',
            lineHeight: 1.15,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontFamily: 'Arial, sans-serif',
            letterSpacing: '0.04em',
          }}
        >
          {label}
        </div>
      )}
      {canShowCount && (
        <div
          style={{
            fontSize: 9,
            fontFamily: "'Courier New', monospace",
            color: 'var(--text-secondary)',
            lineHeight: 1.3,
            marginTop: 'auto',
          }}
        >
          {fmtNum(count)}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bar chart component (for YEAR, PRICE, MILES)
// ---------------------------------------------------------------------------

function BarChart({
  buckets,
  onFilter,
}: {
  buckets: Bucket[];
  onFilter: (filter: HeroFilter) => void;
}) {
  const max = Math.max(...buckets.map((b) => b.count), 1);
  const total = buckets.reduce((s, b) => s + b.count, 0);

  return (
    <div
      style={{
        display: 'flex',
        gap: '2px',
        height: '100%',
        alignItems: 'flex-end',
        padding: '8px 12px',
      }}
    >
      {buckets.map((b) => {
        const pct = total > 0 ? (b.count / total) * 100 : 0;
        return (
          <BarCell
            key={b.label}
            label={b.label}
            count={b.count}
            heightPct={(b.count / max) * 100}
            widthPct={pct}
            onClick={() => onFilter(b.filter)}
          />
        );
      })}
    </div>
  );
}

function BarCell({
  label,
  count,
  heightPct,
  widthPct,
  onClick,
}: {
  label: string;
  count: number;
  heightPct: number;
  widthPct: number;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        flex: `${widthPct} 1 0`,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        alignItems: 'center',
        height: '100%',
        cursor: 'pointer',
        gap: '4px',
      }}
    >
      {/* Count label above bar */}
      <span
        style={{
          fontFamily: "'Courier New', monospace",
          fontSize: '9px',
          fontWeight: 700,
          color: 'var(--text-secondary)',
          textAlign: 'center',
          whiteSpace: 'nowrap',
        }}
      >
        {fmtNum(count)}
      </span>

      {/* Bar */}
      <div
        style={{
          width: '100%',
          height: `${Math.max(heightPct, 4)}%`,
          maxHeight: 'calc(100% - 32px)',
          border: `2px solid ${hovered ? 'var(--text)' : 'var(--border)'}`,
          background: hovered ? 'var(--surface-hover)' : 'var(--surface)',
          transition: 'border-color 120ms ease-out, background 120ms ease-out',
        }}
      />

      {/* Label below bar */}
      <span
        style={{
          fontFamily: 'Arial, sans-serif',
          fontSize: '8px',
          fontWeight: 700,
          textTransform: 'uppercase',
          color: 'var(--text-disabled)',
          textAlign: 'center',
          whiteSpace: 'nowrap',
          letterSpacing: '0.3px',
        }}
      >
        {label}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return n.toLocaleString();
}

// Map SortBy values to their hero dimension
const SORT_TO_DIMENSION: Record<string, HeroDimension | null> = {
  newest: 'newest',
  deal_score: 'deal_score',
  heat_score: 'heat_score',
  year: 'year',
  price_high: 'price_high',
  price_low: 'price_low',
  mileage: 'mileage',
  finds: 'finds',
};

export function sortToDimension(sort: SortBy): HeroDimension | null {
  return SORT_TO_DIMENSION[sort] ?? null;
}

// Dimensions that use treemap layout vs bar chart vs custom server-powered panels
const TREEMAP_DIMS = new Set<HeroDimension>(['heat_score']);
const BAR_DIMS = new Set<HeroDimension>(['year', 'price_high', 'price_low', 'mileage']);
const SERVER_DIMS = new Set<HeroDimension>(['newest', 'deal_score', 'finds']);

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function HeroPanel({ dimension, vehicles, onFilter, onClose }: HeroPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [panelHeight, setPanelHeight] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);

  // Measure container width for treemap layout
  useEffect(() => {
    if (!containerRef.current || !dimension) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [dimension]);

  const isServerPanel = dimension && SERVER_DIMS.has(dimension);

  // Animate open/close — server panels get more height for card strip
  useEffect(() => {
    if (dimension) {
      const targetHeight = SERVER_DIMS.has(dimension) ? 240 : 200;
      requestAnimationFrame(() => setPanelHeight(targetHeight));
    } else {
      setPanelHeight(0);
    }
  }, [dimension]);

  const buckets = useMemo(() => {
    if (!dimension || SERVER_DIMS.has(dimension)) return [];
    switch (dimension) {
      case 'heat_score':
        return buildHeatBuckets(vehicles);
      case 'year':
        return buildYearBuckets(vehicles);
      case 'price_high':
      case 'price_low':
        return buildPriceBuckets(vehicles);
      case 'mileage':
        return buildMileageBuckets(vehicles);
      case 'finds':
        return buildFindsBuckets(vehicles);
      default:
        return [];
    }
  }, [dimension, vehicles]);

  const isTreemap = dimension && TREEMAP_DIMS.has(dimension);
  const isBar = dimension && BAR_DIMS.has(dimension);

  // Compute treemap rects
  const treeRects = useMemo(() => {
    if (!isTreemap || containerWidth <= 0) return [];
    return squarify(buckets, 0, 0, containerWidth, 170);
  }, [isTreemap, buckets, containerWidth]);

  const totalCount = buckets.reduce((s, b) => s + b.count, 0);

  const handleCellClick = (filter: HeroFilter) => {
    onFilter(filter);
  };

  // Don't render anything if never opened
  if (!dimension && panelHeight === 0) return null;

  return (
    <div
      style={{
        overflow: 'hidden',
        height: `${panelHeight}px`,
        transition: 'height 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        borderTop: dimension ? '2px solid var(--border)' : 'none',
        borderBottom: dimension ? '2px solid var(--border)' : 'none',
        background: 'var(--surface)',
      }}
      onTransitionEnd={() => {
        // Clean up after close animation
        if (panelHeight === 0) {
          // Panel is fully closed -- parent handles dimension=null
        }
      }}
    >
      <div
        ref={containerRef}
        style={{
          position: 'relative',
          width: '100%',
          height: isServerPanel ? '240px' : '200px',
        }}
      >
        {/* Server-powered panel: NEWEST */}
        {dimension === 'newest' && (
          <HeroNewestPanel onFilter={handleCellClick} />
        )}

        {/* Server-powered panel: DEALS */}
        {dimension === 'deal_score' && (
          <DealsHeroPanel onFilter={handleCellClick} />
        )}

        {/* Treemap layout */}
        {isTreemap && containerWidth > 0 && (
          <div style={{ position: 'relative', width: '100%', height: '170px', margin: '0' }}>
            {/* Dimension label */}
            <div
              style={{
                position: 'absolute',
                top: 4,
                right: 8,
                zIndex: 2,
                fontFamily: 'Arial, sans-serif',
                fontSize: '8px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                color: 'var(--text-disabled)',
                pointerEvents: 'none',
              }}
            >
              {dimension === 'heat_score' && 'HEAT BY MAKE'}
              {dimension === 'finds' && 'FINDS BY SOURCE (7D)'}
            </div>
            {treeRects.map((rect) => (
              <TreemapCell
                key={rect.label}
                rect={rect}
                total={totalCount}
                onClick={() => handleCellClick(rect.filter)}
              />
            ))}
            {buckets.length === 0 && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  fontFamily: 'Arial, sans-serif',
                  fontSize: '9px',
                  color: 'var(--text-disabled)',
                  textTransform: 'uppercase',
                }}
              >
                No data
              </div>
            )}
          </div>
        )}

        {/* Bar chart layout */}
        {isBar && (
          <div style={{ width: '100%', height: '180px', padding: '0' }}>
            {/* Dimension label */}
            <div
              style={{
                padding: '4px 12px 0',
                fontFamily: 'Arial, sans-serif',
                fontSize: '8px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                color: 'var(--text-disabled)',
              }}
            >
              {dimension === 'year' && 'VEHICLES BY DECADE'}
              {(dimension === 'price_high' || dimension === 'price_low') && 'VEHICLES BY PRICE'}
              {dimension === 'mileage' && 'VEHICLES BY MILEAGE'}
            </div>
            <BarChart buckets={buckets} onFilter={handleCellClick} />
          </div>
        )}
      </div>
    </div>
  );
}

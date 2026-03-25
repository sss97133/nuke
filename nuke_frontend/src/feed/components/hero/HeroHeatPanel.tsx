/**
 * HeroHeatPanel -- Server-powered HEAT lens visualization.
 *
 * Shows where the attention is:
 * - Hot vehicles as compact cards with comment count badges
 * - Comment velocity strip (vehicles with most comments in 7 days)
 * - Make heat treemap sidebar
 *
 * Design: 2px borders, zero radius, Courier New for data.
 */

import { useRef, useState, useMemo, useEffect } from 'react';
import { useHeroHeat, type HotVehicle, type CommentVelocityItem, type MakeHeatItem } from '../../hooks/useHeroHeat';
import { optimizeImageUrl } from '../../../lib/imageOptimizer';
import type { HeroFilter } from '../HeroPanel';

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function fmtPrice(n: number | null | undefined): string {
  if (n == null) return '--';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}K`;
  return `$${n.toLocaleString()}`;
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return n.toLocaleString();
}

// ---------------------------------------------------------------------------
// Squarified treemap
// ---------------------------------------------------------------------------

interface TreeRect {
  label: string;
  count: number;
  x: number; y: number; w: number; h: number;
}

function worstRatio(row: number[], w: number): number {
  const s = row.reduce((a, b) => a + b, 0);
  const mx = Math.max(...row);
  const mn = Math.min(...row);
  return Math.max((w * w * mx) / (s * s), (s * s) / (w * w * mn));
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
  doLayout(scaled, x, y, w, h, result);
  return result;
}

function doLayout(
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
    const cur = row.map((r) => r.area);
    const cand = [...cur, candidate.area];
    if (worstRatio(cand, shorter) <= worstRatio(cur, shorter)) {
      row.push(candidate);
      remaining = remaining.slice(1);
    } else break;
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
    doLayout(remaining, x + rowW, y, w - rowW, h, result);
  } else {
    const rowH = rowArea / w;
    let cx = x;
    for (const item of row) {
      const itemW = item.area / rowH;
      result.push({ label: item.label, count: item.count, x: cx, y, w: itemW, h: rowH });
      cx += itemW;
    }
    doLayout(remaining, x, y + rowH, w, h - rowH, result);
  }
}

// ---------------------------------------------------------------------------
// Hot Vehicle Card
// ---------------------------------------------------------------------------

function HotCard({
  vehicle, rank, onClick,
}: {
  vehicle: HotVehicle; rank: number; onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [imgError, setImgError] = useState(false);
  const ymm = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ');
  const thumbUrl = optimizeImageUrl(vehicle.thumbnail, 'small');

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 160, minWidth: 160, height: '100%',
        border: `2px solid ${hovered ? 'var(--text)' : 'var(--border)'}`,
        background: hovered ? 'var(--surface-hover)' : 'var(--surface)',
        cursor: 'pointer', overflow: 'hidden', display: 'flex', flexDirection: 'column',
        transition: 'border-color 120ms ease-out, background 120ms ease-out',
        userSelect: 'none', position: 'relative',
      }}
    >
      {/* Thumbnail */}
      <div style={{ width: '100%', height: 64, overflow: 'hidden', position: 'relative', background: 'var(--bg)' }}>
        {thumbUrl && !imgError ? (
          <img
            src={thumbUrl} alt={ymm} onError={() => setImgError(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div style={{
            width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: "'Courier New', monospace", fontSize: 9, color: 'var(--text-disabled)',
          }}>
            NO IMG
          </div>
        )}

        {/* Heat score badge */}
        <div style={{
          position: 'absolute', top: 3, right: 3, background: '#dc6b16', color: '#fff',
          fontFamily: "'Courier New', monospace", fontSize: 9, fontWeight: 700,
          padding: '2px 4px', lineHeight: 1,
        }}>
          {Math.round(vehicle.heat_score)}
        </div>

        {/* Rank */}
        <div style={{
          position: 'absolute', top: 3, left: 3, background: 'var(--text)', color: 'var(--surface)',
          fontFamily: "'Courier New', monospace", fontSize: 8, fontWeight: 700,
          padding: '1px 3px', lineHeight: 1,
        }}>
          #{rank}
        </div>
      </div>

      {/* Info */}
      <div style={{ padding: '3px 5px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div style={{
          fontFamily: 'Arial, sans-serif', fontSize: 8, fontWeight: 700, textTransform: 'uppercase',
          color: 'var(--text)', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'nowrap', letterSpacing: '0.03em',
        }}>
          {ymm || 'UNKNOWN'}
        </div>
        <div style={{
          fontFamily: "'Courier New', monospace", fontSize: 9, fontWeight: 700,
          color: 'var(--text-secondary)', marginTop: 1,
        }}>
          {fmtPrice(vehicle.price)}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comment Velocity Card
// ---------------------------------------------------------------------------

function VelocityCard({
  item, onClick,
}: {
  item: CommentVelocityItem; onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [imgError, setImgError] = useState(false);
  const ymm = [item.year, item.make, item.model].filter(Boolean).join(' ');
  const thumbUrl = optimizeImageUrl(item.thumbnail, 'small');

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 140, minWidth: 140, height: '100%',
        border: `2px solid ${hovered ? 'var(--text)' : 'var(--border)'}`,
        background: hovered ? 'var(--surface-hover)' : 'var(--surface)',
        cursor: 'pointer', overflow: 'hidden', display: 'flex', flexDirection: 'column',
        transition: 'border-color 120ms ease-out, background 120ms ease-out',
        userSelect: 'none', position: 'relative',
      }}
    >
      <div style={{ width: '100%', height: 50, overflow: 'hidden', position: 'relative', background: 'var(--bg)' }}>
        {thumbUrl && !imgError ? (
          <img
            src={thumbUrl} alt={ymm} onError={() => setImgError(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div style={{
            width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: "'Courier New', monospace", fontSize: 8, color: 'var(--text-disabled)',
          }}>
            --
          </div>
        )}

        {/* Comment count badge */}
        <div style={{
          position: 'absolute', top: 3, right: 3, background: '#dc6b16', color: '#fff',
          fontFamily: "'Courier New', monospace", fontSize: 8, fontWeight: 700,
          padding: '1px 3px', lineHeight: 1,
        }}>
          {item.comment_count_7d} CMT
        </div>
      </div>

      <div style={{ padding: '2px 4px' }}>
        <div style={{
          fontFamily: 'Arial, sans-serif', fontSize: 7, fontWeight: 700, textTransform: 'uppercase',
          color: 'var(--text)', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {ymm || 'UNKNOWN'}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Make Heat Treemap
// ---------------------------------------------------------------------------

function MakeHeatTreemap({
  items, containerWidth, onFilter,
}: {
  items: MakeHeatItem[]; containerWidth: number; onFilter: (filter: HeroFilter) => void;
}) {
  const treemapHeight = 140;
  const rects = useMemo(
    () => squarify(
      items.slice(0, 12).map((m) => ({ label: m.make, count: m.total_heat })),
      0, 0, containerWidth, treemapHeight,
    ),
    [items, containerWidth],
  );

  return (
    <div style={{ position: 'relative', width: containerWidth, height: treemapHeight }}>
      {rects.map((rect) => {
        const canShowLabel = rect.w > 28 && rect.h > 14;
        const canShowCount = rect.w > 36 && rect.h > 28;
        const area = rect.w * rect.h;
        const fs = area > 5000 ? 10 : area > 2000 ? 9 : 8;
        return (
          <TreemapCell
            key={rect.label}
            rect={rect}
            canShowLabel={canShowLabel}
            canShowCount={canShowCount}
            fontSize={fs}
            onClick={() => onFilter({ makes: [rect.label], sort: 'heat_score' as any })}
          />
        );
      })}
    </div>
  );
}

function TreemapCell({
  rect, canShowLabel, canShowCount, fontSize, onClick,
}: {
  rect: TreeRect; canShowLabel: boolean; canShowCount: boolean; fontSize: number; onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h,
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
          fontSize, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text)',
          lineHeight: 1.15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          fontFamily: 'Arial, sans-serif', letterSpacing: '0.04em',
        }}>
          {rect.label}
        </div>
      )}
      {canShowCount && (
        <div style={{
          fontSize: 9, fontFamily: "'Courier New', monospace", fontWeight: 700,
          color: 'var(--text-secondary)', lineHeight: 1.3, marginTop: 'auto',
        }}>
          {fmtNum(rect.count)}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div style={{ width: '100%', height: '100%', padding: '8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ height: 14, width: 180, background: 'var(--border)', opacity: 0.4 }} />
      <div style={{ display: 'flex', gap: 2, flex: 1 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={{ width: 160, minWidth: 160, height: '100%', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ height: 64, background: 'var(--border)', opacity: 0.2 }} />
            <div style={{ height: 8, width: '70%', background: 'var(--border)', opacity: 0.3 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export interface HeroHeatPanelProps {
  onFilter: (filter: HeroFilter) => void;
}

export function HeroHeatPanel({ onFilter }: HeroHeatPanelProps) {
  const { data, isLoading, error } = useHeroHeat(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [treemapWidth, setTreemapWidth] = useState(0);
  const treemapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!treemapRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setTreemapWidth(entry.contentRect.width);
    });
    observer.observe(treemapRef.current);
    return () => observer.disconnect();
  }, []);

  const topHot = data?.top_hot ?? [];
  const velocity = data?.comment_velocity ?? [];
  const makeHeat = data?.make_heat ?? [];

  if (isLoading) return <LoadingSkeleton />;

  if (error || (topHot.length === 0 && velocity.length === 0)) {
    return (
      <div style={{
        width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'Arial, sans-serif', fontSize: 9, color: 'var(--text-disabled)', textTransform: 'uppercase',
      }}>
        NO HEAT DATA AVAILABLE
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '4px 8px', borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{
            fontFamily: "'Courier New', monospace", fontSize: 14, fontWeight: 700,
            color: '#dc6b16', lineHeight: 1,
          }}>
            {fmtNum(topHot.length + velocity.length)}
          </span>
          <span style={{
            fontFamily: 'Arial, sans-serif', fontSize: 8, fontWeight: 700,
            textTransform: 'uppercase', color: 'var(--text)', letterSpacing: '0.5px',
          }}>
            HOT RIGHT NOW
          </span>
        </div>
        <span style={{
          fontFamily: 'Arial, sans-serif', fontSize: 7, fontWeight: 700,
          textTransform: 'uppercase', color: 'var(--text-disabled)', letterSpacing: '0.5px',
        }}>
          COMMENT VELOCITY 7D
        </span>
      </div>

      {/* Main content: cards + treemap sidebar */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left: scrollable hot + velocity cards */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div
            ref={scrollRef}
            style={{
              display: 'flex', gap: 2, overflowX: 'auto', overflowY: 'hidden',
              height: '100%', padding: '4px 4px', scrollBehavior: 'smooth',
              scrollbarWidth: 'none',
            }}
          >
            {/* Hot vehicles */}
            {topHot.slice(0, 12).map((v, i) => (
              <HotCard
                key={v.id}
                vehicle={v}
                rank={i + 1}
                onClick={() => {
                  if (v.make) onFilter({ makes: [v.make], sort: 'heat_score' as any });
                }}
              />
            ))}

            {/* Separator */}
            {velocity.length > 0 && topHot.length > 0 && (
              <div style={{
                width: 1, minWidth: 1, background: 'var(--border)', margin: '0 2px',
              }} />
            )}

            {/* Comment velocity cards */}
            {velocity.slice(0, 8).map((v) => (
              <VelocityCard
                key={v.id}
                item={v}
                onClick={() => {
                  if (v.make) onFilter({ makes: [v.make], sort: 'heat_score' as any });
                }}
              />
            ))}
          </div>
        </div>

        {/* Right: make heat treemap */}
        <div style={{
          width: 200, flexShrink: 0, borderLeft: '1px solid var(--border)',
          padding: '4px 6px', display: 'flex', flexDirection: 'column', gap: 4, overflow: 'hidden',
        }}>
          <div style={{
            fontFamily: 'Arial, sans-serif', fontSize: 7, fontWeight: 700,
            textTransform: 'uppercase', color: 'var(--text-disabled)', letterSpacing: '0.5px',
          }}>
            MAKE HEAT
          </div>
          <div ref={treemapRef} style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
            {treemapWidth > 0 && makeHeat.length > 0 && (
              <MakeHeatTreemap items={makeHeat} containerWidth={treemapWidth} onFilter={onFilter} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * BadgePortal — The atomic unit of Nuke's end-to-end design.
 *
 * Every data point is a live badge. Every badge is clickable.
 * Every click explodes into its cluster or collapses back.
 * Zero click anxiety: reversible in place, predictable everywhere.
 *
 * Usage:
 *   <BadgePortal dimension="year" value={1991} label="1991" />
 *   <BadgePortal dimension="make" value="GMC" label="GMC" />
 *   <BadgePortal dimension="deal_score" value="plus_3" label="STEAL" variant="deal" />
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useBadgeDepth, type BadgeDimension, type BadgeDepthData } from './useBadgeDepth';
import { BadgeClusterPanel } from './BadgeClusterPanel';

/* ─── Rich Tooltip ─── */

function formatTooltipPrice(n: number | null): string {
  if (n == null || n <= 0) return '';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toLocaleString()}`;
}

function formatTooltipCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return n.toLocaleString();
  return String(n);
}

/** Build 2-3 line tooltip content based on dimension + stats */
function buildTooltipLines(
  dimension: BadgeDimension,
  label: string,
  data: BadgeDepthData,
): string[][] {
  const { count, stats } = data;
  const lines: string[][] = [];

  // Line 1: always count
  lines.push([`${formatTooltipCount(count)} vehicles`]);

  if (!stats) return lines;

  switch (dimension) {
    case 'source': {
      const parts: string[] = [];
      if (stats.fill_rates && stats.fill_rates.length > 0) {
        // Pick top 2 fill rates
        const top = stats.fill_rates.slice(0, 2);
        for (const r of top) {
          parts.push(`${r.pct}% ${r.field.toLowerCase()}`);
        }
      }
      if (parts.length > 0) lines.push(parts);
      // Top makes
      if (stats.top_facets.length > 0) {
        const names = stats.top_facets.slice(0, 3).map((f) => f.label);
        lines.push([`Top: ${names.join(', ')}`]);
      }
      break;
    }
    case 'make': {
      const parts: string[] = [];
      if (stats.min_year != null && stats.max_year != null) {
        parts.push(stats.min_year === stats.max_year
          ? String(stats.min_year)
          : `${stats.min_year}\u2013${stats.max_year}`);
      }
      if (parts.length > 0) lines.push(parts);
      // "Top: Corvette, C10, Camaro"
      if (stats.top_facets.length > 0) {
        const names = stats.top_facets.slice(0, 3).map((f) => f.label);
        lines.push([`Top: ${names.join(', ')}`]);
      }
      break;
    }
    case 'model': {
      const parts: string[] = [];
      if (stats.min_year != null && stats.max_year != null) {
        parts.push(stats.min_year === stats.max_year
          ? String(stats.min_year)
          : `${stats.min_year}\u2013${stats.max_year}`);
      }
      if (parts.length > 0) lines.push(parts);
      // Top body styles
      if (stats.top_facets.length > 0) {
        const names = stats.top_facets.slice(0, 3).map((f) => f.label);
        lines.push([names.join(', ')]);
      }
      break;
    }
    case 'body_style': {
      const parts: string[] = [];
      if (stats.min_year != null && stats.max_year != null) {
        parts.push(`${stats.min_year}\u2013${stats.max_year}`);
      }
      if (parts.length > 0) lines.push(parts);
      if (stats.top_facets.length > 0) {
        const names = stats.top_facets.slice(0, 3).map((f) => f.label);
        lines.push([`Top: ${names.join(', ')}`]);
      }
      break;
    }
    case 'year': {
      const parts: string[] = [];
      if (stats.top_facets.length > 0) {
        const names = stats.top_facets.slice(0, 3).map((f) => f.label);
        lines.push([`Top: ${names.join(', ')}`]);
      }
      break;
    }
    default: {
      // deal_score, status, drivetrain, transmission
      const parts: string[] = [];
      if (stats.min_year != null && stats.max_year != null) {
        parts.push(`${stats.min_year}\u2013${stats.max_year}`);
      }
      if (parts.length > 0) lines.push(parts);
      break;
    }
  }

  return lines;
}

/** Custom rich tooltip positioned above the badge */
function BadgeRichTooltip({
  dimension,
  label,
  data,
}: {
  dimension: BadgeDimension;
  label: string;
  data: BadgeDepthData;
}) {
  const lines = buildTooltipLines(dimension, label, data);

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 'calc(100% + 6px)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 600,
        background: '#2a2a2a',
        border: '2px solid #2a2a2a',
        padding: '5px 8px',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        animation: 'fadeIn180 180ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {lines.map((segments, i) => (
        <div
          key={i}
          style={{
            fontFamily: "'Courier New', monospace",
            fontSize: i === 0 ? '9px' : '8px',
            fontWeight: i === 0 ? 700 : 400,
            color: i === 0 ? '#fff' : 'rgba(255,255,255,0.7)',
            lineHeight: 1.4,
            letterSpacing: '0.02em',
            textTransform: i === 0 ? 'uppercase' as const : 'none' as const,
          }}
        >
          {segments.join(' \u00B7 ')}
        </div>
      ))}
      {/* Arrow */}
      <div
        style={{
          position: 'absolute',
          bottom: -5,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 0,
          height: 0,
          borderLeft: '5px solid transparent',
          borderRight: '5px solid transparent',
          borderTop: '5px solid #2a2a2a',
        }}
      />
    </div>
  );
}

export interface BadgePortalProps {
  /** The dimension this badge filters on */
  dimension: BadgeDimension;
  /** The value to filter by */
  value: string | number | null;
  /** Display text */
  label: string;
  /** Visual variant — affects colors */
  variant?: 'default' | 'deal' | 'source' | 'status' | 'mileage' | 'price';
  /** Custom background color */
  bg?: string;
  /** Custom text color */
  color?: string;
  /** Custom border color */
  borderColor?: string;
  /** Tooltip text (shown before portal loads) */
  tooltip?: string;
  /** Disable portal behavior (render as static badge) */
  static?: boolean;
}

const VARIANT_STYLES: Record<string, { bg: string; color: string; borderColor: string }> = {
  default: {
    bg: 'transparent',
    color: 'var(--text)',
    borderColor: 'var(--border)',
  },
  deal: {
    bg: '#16825d',
    color: 'var(--surface-elevated, #fff)',
    borderColor: '#16825d',
  },
  source: {
    bg: 'rgba(26,26,26,0.06)',
    color: 'var(--text)',
    borderColor: 'rgba(26,26,26,0.20)',
  },
  status: {
    bg: 'transparent',
    color: 'var(--text-secondary)',
    borderColor: 'var(--border)',
  },
  mileage: {
    bg: 'transparent',
    color: 'var(--text-secondary)',
    borderColor: 'var(--border)',
  },
  price: {
    bg: 'rgba(26,26,26,0.04)',
    color: 'var(--text)',
    borderColor: 'var(--border)',
  },
};

export function BadgePortal({
  dimension,
  value,
  label,
  variant = 'default',
  bg,
  color,
  borderColor,
  tooltip,
  static: isStatic = false,
}: BadgePortalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const { data, loading, load } = useBadgeDepth(dimension, value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLSpanElement>(null);

  const variantStyle = VARIANT_STYLES[variant] || VARIANT_STYLES.default;

  // Lazy-load depth on hover (200ms debounce)
  const handleEnter = useCallback(() => {
    setHovered(true);
    if (!isStatic) {
      timerRef.current = setTimeout(() => load(), 200);
    }
  }, [load, isStatic]);

  const handleLeave = useCallback(() => {
    setHovered(false);
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  // Cleanup timer
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (isStatic) return;
    e.preventDefault();
    e.stopPropagation();
    if (!isOpen) {
      load(); // Ensure data is loaded
    }
    setIsOpen((prev) => !prev);
  }, [isStatic, isOpen, load]);

  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  // Show rich tooltip when hovered with data loaded, but panel not open
  const showRichTooltip = hovered && !isOpen && data && data.count > 0 && data.stats;

  // Fallback native title: only when no rich tooltip (data not loaded yet)
  const fallbackTitle = !showRichTooltip && !isOpen
    ? (data && data.count > 0
      ? `${label} \u00B7 ${data.count.toLocaleString()}`
      : tooltip || label)
    : undefined;

  return (
    <span
      ref={containerRef}
      role={isStatic ? undefined : 'button'}
      tabIndex={isStatic ? undefined : 0}
      title={fallbackTitle}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        fontFamily: 'Arial, sans-serif',
        fontSize: '8px',
        fontWeight: 700,
        textTransform: 'uppercase' as const,
        letterSpacing: '0.10em',
        lineHeight: 1,
        padding: '2px 6px',
        border: `1px solid ${borderColor || variantStyle.borderColor}`,
        background: bg || variantStyle.bg,
        color: color || variantStyle.color,
        whiteSpace: 'nowrap',
        cursor: isStatic ? 'default' : 'pointer',
        flexShrink: 0,
        userSelect: 'none',
        transition: 'border-color 180ms cubic-bezier(0.16, 1, 0.3, 1), background 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        borderColor: isOpen
          ? 'var(--text, #1a1a1a)'
          : hovered
            ? 'var(--text-secondary, #666)'
            : (borderColor || variantStyle.borderColor),
      }}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onClick={handleClick}
      onKeyDown={isStatic ? undefined : (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick(e as any);
        }
        if (e.key === 'Escape' && isOpen) {
          e.preventDefault();
          handleClose();
        }
      }}
    >
      {label}

      {/* Depth indicator — tiny count on hover when not open */}
      {hovered && !isOpen && data && data.count > 0 && (
        <span style={{
          fontFamily: "'Courier New', monospace",
          fontSize: '7px',
          fontWeight: 400,
          opacity: 0.6,
          marginLeft: 1,
        }}>
          ·{data.count > 999 ? `${(data.count / 1000).toFixed(0)}K` : data.count}
        </span>
      )}

      {/* Rich tooltip on hover (replaces native title) */}
      {showRichTooltip && (
        <BadgeRichTooltip dimension={dimension} label={label} data={data!} />
      )}

      {/* Cluster panel */}
      {isOpen && data && (
        <BadgeClusterPanel
          label={label}
          dimension={dimension}
          value={value}
          count={data.count}
          preview={data.preview}
          stats={data.stats}
          loading={loading}
          onClose={handleClose}
        />
      )}
    </span>
  );
}

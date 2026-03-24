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
import { useBadgeDepth, type BadgeDimension } from './useBadgeDepth';
import { BadgeClusterPanel } from './BadgeClusterPanel';

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

  // Depth count for hover tooltip
  const depthLabel = data && data.count > 0
    ? `${label} · ${data.count.toLocaleString()}`
    : tooltip || label;

  return (
    <span
      ref={containerRef}
      role={isStatic ? undefined : 'button'}
      tabIndex={isStatic ? undefined : 0}
      title={!isOpen ? depthLabel : undefined}
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

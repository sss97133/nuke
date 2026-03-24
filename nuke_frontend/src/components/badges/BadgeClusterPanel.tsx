/**
 * BadgeClusterPanel — Inline expand panel for BadgePortal.
 *
 * Shows a preview grid of vehicles matching the badge's filter.
 * Appears below/beside the badge. Click-outside or Escape closes it.
 */

import React, { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import type { BadgePreviewItem } from './useBadgeDepth';

export interface BadgeClusterPanelProps {
  label: string;
  count: number;
  preview: BadgePreviewItem[];
  loading?: boolean;
  onClose: () => void;
  /** Position relative to badge — defaults to 'below' */
  position?: 'below' | 'right';
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return n.toLocaleString();
}

function formatPrice(n: number | null): string {
  if (n == null || n <= 0) return '';
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function BadgeClusterPanel({
  label,
  count,
  preview,
  loading = false,
  onClose,
}: BadgeClusterPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Defer so the opening click doesn't immediately close
    const raf = requestAnimationFrame(() => {
      document.addEventListener('mousedown', handler);
    });
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('mousedown', handler);
    };
  }, [onClose]);

  // Close on scroll (any ancestor scrolling)
  useEffect(() => {
    const handler = () => onClose();
    window.addEventListener('scroll', handler, true);
    return () => window.removeEventListener('scroll', handler, true);
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      style={{
        position: 'absolute',
        top: 'calc(100% + 4px)',
        left: 0,
        zIndex: 500,
        minWidth: 320,
        maxWidth: 480,
        background: 'var(--surface, #fff)',
        border: '2px solid var(--text, #1a1a1a)',
        padding: 0,
        animation: 'fadeIn180 180ms ease-out',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        padding: '6px 10px',
        borderBottom: '2px solid var(--border, #bdbdbd)',
      }}>
        <span style={{
          fontFamily: 'Arial, sans-serif',
          fontSize: '9px',
          fontWeight: 800,
          textTransform: 'uppercase' as const,
          letterSpacing: '0.5px',
          color: 'var(--text)',
        }}>
          {label}
        </span>
        <span style={{
          fontFamily: "'Courier New', monospace",
          fontSize: '9px',
          fontWeight: 700,
          color: 'var(--text-secondary)',
        }}>
          {formatCompact(count)} VEHICLES
        </span>
      </div>

      {/* Preview grid */}
      {loading ? (
        <div style={{
          padding: '16px 10px',
          fontFamily: 'Arial, sans-serif',
          fontSize: '8px',
          fontWeight: 700,
          textTransform: 'uppercase' as const,
          letterSpacing: '0.5px',
          color: 'var(--text-disabled)',
          textAlign: 'center',
        }}>
          LOADING...
        </div>
      ) : preview.length === 0 ? (
        <div style={{
          padding: '16px 10px',
          fontFamily: 'Arial, sans-serif',
          fontSize: '8px',
          fontWeight: 700,
          textTransform: 'uppercase' as const,
          letterSpacing: '0.5px',
          color: 'var(--text-disabled)',
          textAlign: 'center',
        }}>
          NO PREVIEW AVAILABLE
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '2px',
          padding: '2px',
        }}>
          {preview.map((v) => (
            <Link
              key={v.id}
              to={`/vehicle/${v.id}`}
              style={{
                display: 'block',
                textDecoration: 'none',
                color: 'inherit',
                overflow: 'hidden',
                background: 'var(--surface-hover)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Thumbnail */}
              <div style={{
                width: '100%',
                paddingTop: '75%',
                position: 'relative',
                background: 'var(--surface-hover)',
              }}>
                {v.primary_image_url ? (
                  <img
                    src={v.primary_image_url}
                    alt={[v.year, v.make, v.model].filter(Boolean).join(' ')}
                    loading="lazy"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                    }}
                  />
                ) : (
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'Arial, sans-serif',
                    fontSize: '7px',
                    color: 'var(--text-disabled)',
                    textTransform: 'uppercase' as const,
                  }}>
                    NO IMG
                  </div>
                )}
              </div>

              {/* Label */}
              <div style={{ padding: '3px 4px' }}>
                <div style={{
                  fontFamily: 'Arial, sans-serif',
                  fontSize: '8px',
                  fontWeight: 700,
                  color: 'var(--text)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  lineHeight: 1.2,
                }}>
                  {[v.year, v.make, v.model].filter(Boolean).join(' ') || 'Vehicle'}
                </div>
                {v.sale_price != null && v.sale_price > 0 && (
                  <div style={{
                    fontFamily: "'Courier New', monospace",
                    fontSize: '8px',
                    fontWeight: 700,
                    color: 'var(--text-secondary)',
                    lineHeight: 1.2,
                  }}>
                    {formatPrice(v.sale_price)}
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Footer — view all */}
      {count > preview.length && (
        <div style={{
          padding: '4px 10px 6px',
          borderTop: '1px solid var(--border)',
          textAlign: 'right',
        }}>
          <span style={{
            fontFamily: 'Arial, sans-serif',
            fontSize: '8px',
            fontWeight: 700,
            textTransform: 'uppercase' as const,
            letterSpacing: '0.3px',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
          }}>
            VIEW ALL {formatCompact(count)} →
          </span>
        </div>
      )}
    </div>
  );
}

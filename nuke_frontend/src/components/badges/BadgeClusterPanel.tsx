/**
 * BadgeClusterPanel — Inline expand panel for BadgePortal.
 *
 * Shows dimension-specific stats + preview grid of matching vehicles.
 * Appears below the badge. Click-outside or Escape closes it.
 *
 * Stats shown per dimension:
 *   make   → year range, top models
 *   source → fill rates, top makes
 *   model  → year range, top body styles
 *   price  → price bracket distribution (TODO)
 *   other  → year range
 */

import React, { useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { BadgePreviewItem, BadgeDimensionStats, BadgeDimension } from './useBadgeDepth';

export interface BadgeClusterPanelProps {
  label: string;
  dimension: BadgeDimension;
  value: string | number | null;
  count: number;
  preview: BadgePreviewItem[];
  stats: BadgeDimensionStats | null;
  loading?: boolean;
  onClose: () => void;
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

/** Build a search URL that filters the feed by this badge's dimension */
function buildFilterUrl(dimension: BadgeDimension, value: string | number | null): string {
  if (value == null) return '/';
  const params = new URLSearchParams();
  switch (dimension) {
    case 'make':
      params.set('makes', String(value));
      break;
    case 'model':
      params.set('models', String(value));
      break;
    case 'year':
      params.set('year_min', String(value));
      params.set('year_max', String(value));
      break;
    case 'source':
      params.set('q', String(value));
      break;
    case 'body_style':
      params.set('body_styles', String(value));
      break;
    case 'transmission':
      params.set('q', String(value));
      break;
    case 'drivetrain':
      params.set('q', String(value));
      break;
    case 'deal_score':
      params.set('q', String(value).replace(/_/g, ' '));
      break;
    default:
      params.set('q', String(value));
  }
  return `/?${params.toString()}`;
}

/** Stats row for MAKE dimension: year range, top models */
function MakeStats({ stats }: { stats: BadgeDimensionStats }) {
  return (
    <div style={{ padding: '6px 10px 4px', borderBottom: '1px solid var(--border)' }}>
      {/* Aggregates row */}
      <div style={{
        display: 'flex', gap: '12px', marginBottom: '4px',
      }}>
        {stats.min_year != null && stats.max_year != null && (
          <StatCell
            label="YEARS"
            value={stats.min_year === stats.max_year
              ? String(stats.min_year)
              : `${stats.min_year}–${stats.max_year}`}
          />
        )}
      </div>
      {/* Top models */}
      {stats.top_facets.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '2px' }}>
          <span style={{
            fontFamily: 'Arial, sans-serif', fontSize: '7px', fontWeight: 800,
            textTransform: 'uppercase', letterSpacing: '0.5px',
            color: 'var(--text-disabled)', marginRight: '2px', lineHeight: '16px',
          }}>
            TOP MODELS
          </span>
          {stats.top_facets.map((f) => (
            <FacetChip key={f.label} label={f.label} count={f.count} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Stats row for SOURCE dimension: fill rates, top makes */
function SourceStats({ stats }: { stats: BadgeDimensionStats }) {
  return (
    <div style={{ padding: '6px 10px 4px', borderBottom: '1px solid var(--border)' }}>
      {/* Fill rates */}
      {stats.fill_rates && stats.fill_rates.length > 0 && (
        <div style={{ display: 'flex', gap: '6px', marginBottom: '4px', flexWrap: 'wrap' }}>
          <span style={{
            fontFamily: 'Arial, sans-serif', fontSize: '7px', fontWeight: 800,
            textTransform: 'uppercase', letterSpacing: '0.5px',
            color: 'var(--text-disabled)', marginRight: '2px', lineHeight: '14px',
          }}>
            FILL RATE
          </span>
          {stats.fill_rates.map((r) => (
            <FillRateChip key={r.field} label={r.field} pct={r.pct} />
          ))}
        </div>
      )}
      {/* Top makes */}
      {stats.top_facets.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '2px' }}>
          <span style={{
            fontFamily: 'Arial, sans-serif', fontSize: '7px', fontWeight: 800,
            textTransform: 'uppercase', letterSpacing: '0.5px',
            color: 'var(--text-disabled)', marginRight: '2px', lineHeight: '16px',
          }}>
            TOP MAKES
          </span>
          {stats.top_facets.map((f) => (
            <FacetChip key={f.label} label={f.label} count={f.count} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Stats row for MODEL dimension: year range, top body styles */
function ModelStats({ stats }: { stats: BadgeDimensionStats }) {
  return (
    <div style={{ padding: '6px 10px 4px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', gap: '12px', marginBottom: '4px' }}>
        {stats.min_year != null && stats.max_year != null && (
          <StatCell
            label="YEARS"
            value={stats.min_year === stats.max_year
              ? String(stats.min_year)
              : `${stats.min_year}–${stats.max_year}`}
          />
        )}
      </div>
      {stats.top_facets.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '2px' }}>
          <span style={{
            fontFamily: 'Arial, sans-serif', fontSize: '7px', fontWeight: 800,
            textTransform: 'uppercase', letterSpacing: '0.5px',
            color: 'var(--text-disabled)', marginRight: '2px', lineHeight: '16px',
          }}>
            BODY STYLES
          </span>
          {stats.top_facets.map((f) => (
            <FacetChip key={f.label} label={f.label} count={f.count} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Generic stats row for dimensions without specialized layout */
function GenericStats({ stats }: { stats: BadgeDimensionStats }) {
  const hasAgg = stats.min_year != null && stats.max_year != null;
  if (!hasAgg && stats.top_facets.length === 0) return null;

  return (
    <div style={{ padding: '6px 10px 4px', borderBottom: '1px solid var(--border)' }}>
      {hasAgg && (
        <div style={{ display: 'flex', gap: '12px', marginBottom: '2px' }}>
          {stats.min_year != null && stats.max_year != null && (
            <StatCell
              label="YEARS"
              value={stats.min_year === stats.max_year
                ? String(stats.min_year)
                : `${stats.min_year}–${stats.max_year}`}
            />
          )}
        </div>
      )}
      {stats.top_facets.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '2px' }}>
          {stats.top_facets.map((f) => (
            <FacetChip key={f.label} label={f.label} count={f.count} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Small stat cell: label over value */
function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
      <span style={{
        fontFamily: 'Arial, sans-serif', fontSize: '7px', fontWeight: 800,
        textTransform: 'uppercase', letterSpacing: '0.5px',
        color: 'var(--text-disabled)', lineHeight: 1,
      }}>
        {label}
      </span>
      <span style={{
        fontFamily: "'Courier New', monospace", fontSize: '10px', fontWeight: 700,
        color: 'var(--text)', lineHeight: 1.2,
      }}>
        {value}
      </span>
    </div>
  );
}

/** A facet chip: "C10 (42)" */
function FacetChip({ label, count }: { label: string; count: number }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '2px',
      fontFamily: 'Arial, sans-serif', fontSize: '8px', fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '0.10em',
      padding: '1px 5px', border: '1px solid var(--border)',
      color: 'var(--text-secondary)', lineHeight: 1, whiteSpace: 'nowrap',
    }}>
      {label}
      <span style={{
        fontFamily: "'Courier New', monospace", fontSize: '7px', fontWeight: 400,
        opacity: 0.6,
      }}>
        {count}
      </span>
    </span>
  );
}

/** Fill rate chip: "PRICE 92%" with visual bar */
function FillRateChip({ label, pct }: { label: string; pct: number }) {
  const barColor = pct >= 80 ? '#16825d' : pct >= 50 ? '#b05a00' : 'var(--text-disabled)';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '3px',
      fontFamily: 'Arial, sans-serif', fontSize: '7px', fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '0.10em',
      color: 'var(--text-secondary)', lineHeight: 1, whiteSpace: 'nowrap',
    }}>
      {label}
      {/* Mini bar */}
      <span style={{
        display: 'inline-block', width: '20px', height: '3px',
        background: 'var(--border)', position: 'relative',
      }}>
        <span style={{
          position: 'absolute', left: 0, top: 0, height: '100%',
          width: `${Math.min(pct, 100)}%`, background: barColor,
        }} />
      </span>
      <span style={{
        fontFamily: "'Courier New', monospace", fontSize: '7px',
        fontWeight: 700, color: barColor,
      }}>
        {pct}%
      </span>
    </span>
  );
}

export function BadgeClusterPanel({
  label,
  dimension,
  value,
  count,
  preview,
  stats,
  loading = false,
  onClose,
}: BadgeClusterPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

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

  const filterUrl = buildFilterUrl(dimension, value);

  const handleViewAll = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onClose();
    navigate(filterUrl);
  };

  // Render dimension-specific stats section
  const renderStats = () => {
    if (!stats) return null;
    switch (dimension) {
      case 'make': return <MakeStats stats={stats} />;
      case 'source': return <SourceStats stats={stats} />;
      case 'model': return <ModelStats stats={stats} />;
      default: return <GenericStats stats={stats} />;
    }
  };

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
        animation: 'fadeIn180 180ms cubic-bezier(0.16, 1, 0.3, 1)',
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

      {/* Dimension-specific stats */}
      {!loading && renderStats()}

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

      {/* Footer — view all (navigates to filtered feed) */}
      {count > preview.length && (
        <div style={{
          padding: '4px 10px 6px',
          borderTop: '1px solid var(--border)',
          textAlign: 'right',
        }}>
          <a
            href={filterUrl}
            onClick={handleViewAll}
            style={{
              fontFamily: 'Arial, sans-serif',
              fontSize: '8px',
              fontWeight: 700,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.3px',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              textDecoration: 'none',
              border: 'none',
              background: 'none',
              padding: 0,
              transition: 'color 180ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
          >
            VIEW ALL {formatCompact(count)} →
          </a>
        </div>
      )}
    </div>
  );
}

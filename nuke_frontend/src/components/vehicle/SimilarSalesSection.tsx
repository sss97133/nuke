import React, { useMemo, useState } from 'react';
import { useSimilarSales, type SimilarSale } from '../../hooks/useSimilarSales';
import {
  buildVehicleCohortOptions,
  classifyVehicleFacet,
  computeCohortComparisonStats,
  filterComparableSalesByCohort,
  type VehicleCohortFilterKey,
} from '../../lib/market/vehicleTaxonomy';

export interface SimilarSalesSectionProps {
  vehicleId: string;
  vehicleYear: number;
  vehicleMake: string;
  vehicleModel: string;
  vehicleSeries?: string | null;
  vehicleTrim?: string | null;
  vehicleBodyStyle?: string | null;
  vehicleTitle?: string | null;
  initialSales?: SimilarSale[];
}

// Platform abbreviations — no decorative colors per design system
const PLATFORM_ABBREV: Record<string, string> = {
  'Bring a Trailer': 'BAT',
  'Cars & Bids': 'C&B',
  'Mecum': 'MECUM',
  'Barrett-Jackson': 'B-J',
  "RM Sotheby's": 'RM',
  'Bonhams': 'BONHAMS',
  'Gooding & Company': 'GOODING',
  'PCarMarket': 'PCM',
  'Hagerty Marketplace': 'HAGERTY',
  'eBay Motors': 'EBAY',
};

function formatPrice(price: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays < 1) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 30) return `${diffDays}d ago`;
  const months = Math.floor(diffDays / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(diffDays / 365);
  const remMonths = Math.floor((diffDays - years * 365) / 30);
  if (remMonths > 0) return `${years}yr ${remMonths}mo ago`;
  return `${years}yr ago`;
}

function formatMileage(mileage: number | null): string {
  if (!mileage) return '';
  return `${new Intl.NumberFormat('en-US').format(mileage)} mi`;
}

export function SimilarSalesSection({
  vehicleId,
  vehicleYear,
  vehicleMake,
  vehicleModel,
  vehicleSeries,
  vehicleTrim,
  vehicleBodyStyle,
  vehicleTitle,
  initialSales,
}: SimilarSalesSectionProps) {
  const { data, isLoading: queryLoading, error: queryError } = useSimilarSales(
    initialSales ? '' : vehicleId,
    initialSales ? '' : vehicleMake,
  );
  const [showAll, setShowAll] = useState(false);
  const [activeCohort, setActiveCohort] = useState<VehicleCohortFilterKey>('all');

  const loading = initialSales ? false : queryLoading;
  const sales = initialSales ?? data?.sales ?? [];
  const summary = data?.summary ?? null;
  const error = !initialSales && queryError ? 'Unable to load comparable sales' : null;

  const { facets: vehicleFacets, options: cohortOptions } = useMemo(() => {
    const classified = classifyVehicleFacet({
      year: vehicleYear,
      make: vehicleMake,
      model: vehicleModel,
      series: vehicleSeries ?? null,
      trim: vehicleTrim ?? null,
      body_style: vehicleBodyStyle ?? null,
      listing_title: vehicleTitle ?? null,
    });
    const built = buildVehicleCohortOptions({
      year: vehicleYear,
      make: vehicleMake,
      model: vehicleModel,
      series: classified.series ?? vehicleSeries ?? null,
      trim: classified.trim ?? vehicleTrim ?? null,
      body_style: classified.body ?? vehicleBodyStyle ?? null,
      listing_title: vehicleTitle ?? null,
    });
    return built;
  }, [vehicleYear, vehicleMake, vehicleModel, vehicleSeries, vehicleTrim, vehicleBodyStyle, vehicleTitle]);

  const filteredSales = useMemo(
    () => filterComparableSalesByCohort(sales, activeCohort, vehicleFacets, vehicleMake),
    [sales, activeCohort, vehicleFacets, vehicleMake],
  );

  const cohortStats = useMemo(
    () => computeCohortComparisonStats(sales, filteredSales),
    [sales, filteredSales],
  );

  const displayedSales = showAll ? filteredSales : filteredSales.slice(0, 6);

  if (loading) {
    return (
      <div className="vp-comps-section">
        <div className="vp-comps-grid">
          {[1, 2, 3].map((i) => (
            <div key={i} className="vp-comps-skeleton" />
          ))}
        </div>
      </div>
    );
  }

  if (error) return null;
  if (sales.length === 0) return null;

  const familyMedian = cohortStats.familyMedianPrice ?? summary?.median_price ?? null;
  const selectedMedian = cohortStats.cohortMedianPrice;
  const deltaPct = cohortStats.deltaPctVsFamily;
  const deltaText =
    deltaPct != null
      ? `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}% ${
          deltaPct > 0 ? 'PREMIUM' : deltaPct < 0 ? 'DISCOUNT' : 'PAR'
        } VS FAMILY MEDIAN`
      : null;

  return (
    <div className="vp-comps-section" data-testid="similar-sales-section">
      <style>{`
        .vp-comps-section {
          padding: 10px;
        }
        .vp-comps-skeleton {
          height: 80px;
          background-color: var(--surface);
          border: 2px solid var(--border);
          opacity: 0.5;
        }
        .vp-cohort-bar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          margin-bottom: 8px;
          padding-bottom: 8px;
          border-bottom: 1px solid var(--border);
        }
        .vp-cohort-bar__pills {
          display: inline-flex;
          flex-wrap: wrap;
          gap: 4px;
          align-items: center;
        }
        .vp-cohort-pill {
          background: var(--bg);
          color: var(--text-secondary);
          border: 1px solid var(--border);
          padding: 2px 8px;
          font-family: 'Courier New', Courier, monospace;
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          cursor: pointer;
        }
        .vp-cohort-pill:hover {
          color: var(--text);
          border-color: var(--text);
        }
        .vp-cohort-pill--active {
          background: var(--text);
          color: var(--bg);
          border-color: var(--text);
        }
        .vp-cohort-pill--active:hover {
          color: var(--bg);
        }
        .vp-cohort-bar__metrics {
          display: inline-flex;
          flex-wrap: wrap;
          align-items: baseline;
          gap: 10px;
          font-family: 'Courier New', Courier, monospace;
          font-size: 9px;
        }
        .vp-cohort-delta--premium {
          color: var(--success, #16825d);
          font-weight: 700;
        }
        .vp-cohort-delta--discount {
          color: var(--warning, #b45309);
          font-weight: 700;
        }
        .vp-cohort-delta--par {
          color: var(--text-secondary);
          font-weight: 700;
        }
        .vp-comps-summary {
          display: flex;
          gap: 16px;
          flex-wrap: wrap;
          align-items: baseline;
          margin-bottom: 8px;
          padding-bottom: 8px;
          border-bottom: 1px solid var(--border);
        }
        .vp-comps-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
          gap: 4px;
          margin-bottom: 8px;
        }
      `}</style>

      {/* Interactive Cohort Filter Bar (ALL FAMILY | SERIES: <val> | TRIM: <val> | BODY: <val>) */}
      <div
        className="vp-cohort-bar"
        data-testid="comparable-cohort-filter-bar"
        role="group"
        aria-label="Comparable sales cohort filter"
      >
        <div className="vp-cohort-bar__pills">
          {cohortOptions.map((opt) => {
            const isActive = activeCohort === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                data-testid={`cohort-filter-${opt.key}`}
                aria-pressed={isActive}
                className={`vp-cohort-pill${isActive ? ' vp-cohort-pill--active' : ''}`}
                onClick={() => setActiveCohort(opt.key)}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        <div className="vp-cohort-bar__metrics" data-testid="cohort-comparison-summary">
          {selectedMedian != null && (
            <span data-testid="cohort-median-price">
              COHORT MEDIAN: <strong>{formatPrice(selectedMedian)}</strong> ({cohortStats.cohortCount})
            </span>
          )}
          {familyMedian != null && (
            <span data-testid="family-median-price">
              FAMILY MEDIAN: <strong>{formatPrice(familyMedian)}</strong> ({cohortStats.familyCount})
            </span>
          )}
          {deltaText && (
            <span
              data-testid="cohort-delta-vs-family"
              className={`vp-cohort-delta--${cohortStats.deltaDirection ?? 'par'}`}
            >
              {deltaText}
            </span>
          )}
        </div>
      </div>

      {/* Summary stats */}
      {(summary || selectedMedian != null) && (
        <div className="vp-comps-summary">
          {selectedMedian != null && (
            <StatPill label="MEDIAN" value={formatPrice(selectedMedian)} accent />
          )}
          {summary && (
            <StatPill label="RANGE" value={`${formatPrice(summary.min_price)} \u2014 ${formatPrice(summary.max_price)}`} />
          )}
          <span style={{
            fontFamily: "'Courier New', Courier, monospace",
            fontSize: '8px',
            color: 'var(--text-disabled)',
            letterSpacing: '0.06em',
          }}>
            {vehicleYear != null ? `${vehicleYear - 2}\u2013${vehicleYear + 2}` : ''} {vehicleMake} {vehicleModel} &middot; {filteredSales.length} OF {sales.length} SOLD
          </span>
        </div>
      )}

      {/* Sales Grid */}
      {filteredSales.length === 0 ? (
        <div data-testid="cohort-empty-state" style={{ padding: '12px 0', fontSize: '10px', color: 'var(--text-secondary)' }}>
          No comparable sales matched this facet cohort. Showing 0 of {sales.length} family records.
        </div>
      ) : (
        <div className="vp-comps-grid" data-testid="comparable-sales-grid">
          {displayedSales.map((sale, i) => (
            <SaleCard key={`${sale.vehicle_id ?? i}-${i}`} sale={sale} />
          ))}
        </div>
      )}

      {/* Show more / less */}
      {filteredSales.length > 6 && (
        <div style={{ textAlign: 'center', paddingTop: '4px' }}>
          <button
            onClick={() => setShowAll(!showAll)}
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              padding: '3px 10px',
              fontFamily: 'Arial, Helvetica, sans-serif',
              fontSize: '8px',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase' as const,
              color: 'var(--text)',
              cursor: 'pointer',
            }}
          >
            {showAll ? 'SHOW FEWER' : `SHOW ALL ${filteredSales.length} SALES`}
          </button>
        </div>
      )}
    </div>
  );
}

function StatPill({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <span style={{
        fontFamily: "'Courier New', Courier, monospace",
        fontSize: '10px',
        fontWeight: 700,
        color: accent ? '#16825d' : 'var(--text)',
        letterSpacing: '0.04em',
      }}>
        {value}
      </span>
      <span style={{
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontSize: '8px',
        fontWeight: 700,
        color: 'var(--text-disabled)',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        marginLeft: '4px',
      }}>
        {label}
      </span>
    </div>
  );
}

function SaleCard({ sale }: { sale: SimilarSale }) {
  const [imgError, setImgError] = useState(false);
  const platformAbbrev = sale.platform ? (PLATFORM_ABBREV[sale.platform] ?? sale.platform.toUpperCase()) : null;

  const cardContent = (
    <div
      data-testid="comparable-sale-card"
      style={{
        display: 'flex',
        gap: '8px',
        padding: '8px',
        border: '2px solid var(--border)',
        backgroundColor: 'var(--surface)',
        transition: 'border-color 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        cursor: sale.listing_url ? 'pointer' : 'default',
        textDecoration: 'none',
        color: 'inherit',
      }}
      onMouseEnter={(e) => {
        if (sale.listing_url) {
          (e.currentTarget as HTMLElement).style.borderColor = 'var(--text)';
        }
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
      }}
    >
      {/* Thumbnail */}
      <div style={{
        flexShrink: 0,
        width: '80px',
        height: '60px',
        overflow: 'hidden',
        backgroundColor: '#7a7a7a',
      }}>
        {imgError || !sale.image_url ? (
          <div style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'Arial, Helvetica, sans-serif',
            fontSize: '8px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: '#bbb',
          }}>
            {sale.make || 'N/A'}
          </div>
        ) : (
          <img
            src={sale.image_url}
            alt={`${sale.year} ${sale.make} ${sale.model}`}
            onError={() => setImgError(true)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        )}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Title */}
        <div style={{
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: '9px',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: 'var(--text)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          marginBottom: '2px',
        }}>
          {sale.year} {sale.make} {sale.model}
          {sale.trim && (
            <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}> {sale.trim}</span>
          )}
        </div>

        {/* Price */}
        <div style={{
          fontFamily: "'Courier New', Courier, monospace",
          fontSize: '10px',
          fontWeight: 700,
          color: '#16825d',
          marginBottom: '4px',
          lineHeight: 1,
        }}>
          {formatPrice(sale.sale_price)}
        </div>

        {/* Meta row */}
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
          {platformAbbrev && (
            <span style={{
              fontFamily: 'Arial, Helvetica, sans-serif',
              fontSize: '7px',
              fontWeight: 700,
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
              padding: '1px 4px',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              whiteSpace: 'nowrap',
            }}>
              {platformAbbrev}
            </span>
          )}
          {sale.sold_date && (
            <span style={{
              fontFamily: 'Arial, Helvetica, sans-serif',
              fontSize: '7px',
              color: 'var(--text-disabled)',
              whiteSpace: 'nowrap',
            }}>
              {formatDate(sale.sold_date)}
            </span>
          )}
          {sale.mileage && (
            <span style={{
              fontFamily: "'Courier New', Courier, monospace",
              fontSize: '7px',
              color: 'var(--text-disabled)',
              whiteSpace: 'nowrap',
              letterSpacing: '0.06em',
            }}>
              {formatMileage(sale.mileage)}
            </span>
          )}
        </div>
      </div>
    </div>
  );

  if (sale.listing_url) {
    return (
      <a href={sale.listing_url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', display: 'block' }}>
        {cardContent}
      </a>
    );
  }

  return <div>{cardContent}</div>;
}

export default SimilarSalesSection;

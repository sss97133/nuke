import React from 'react';
import {
  classifyVehicleFacet,
  resolveTileBadgeSvg,
  resolveVehicleIdentityMark,
  type FamilyFacetAxis,
  type VehicleFacetClassification,
  type VehicleIdentityMark,
} from '../../pages/vehicleTaxonomy';

export type OrganizationFacetAxis = Exclude<FamilyFacetAxis, 'raw'>;

export interface OrganizationVehicleFacetInput {
  id?: string;
  vehicle_id?: string;
  vehicle_year?: number | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  sale_price?: number | null;
  vehicle_asking_price?: number | null;
  vehicle_current_value?: number | null;
  is_sold?: boolean;
  bat_listing_title?: string | null;
  vehicles?: {
    year?: number | null;
    make?: string | null;
    model?: string | null;
    series?: string | null;
    trim?: string | null;
    body_style?: string | null;
    sale_price?: number | null;
    asking_price?: number | null;
    current_value?: number | null;
  } | null;
}

export interface OrganizationFacetBucket {
  axis: OrganizationFacetAxis;
  name: string;
  count: number;
  soldCount: number;
  sharePct: number;
  medianUsd: number | null;
  representativeMake: string | null;
  representativeYear: number | null;
  identityMark: VehicleIdentityMark | null;
  badgeSvg: string | null;
}

export interface OrganizationFacetBreakdown {
  totalVehicles: number;
  series: OrganizationFacetBucket[];
  trim: OrganizationFacetBucket[];
  body: OrganizationFacetBucket[];
}

function extractVehicleFields(v: OrganizationVehicleFacetInput): {
  year: number | null;
  make: string | null;
  model: string | null;
  series: string | null;
  trim: string | null;
  body_style: string | null;
  listing_title: string | null;
  priceUsd: number | null;
  isSold: boolean;
} {
  const nested = v.vehicles ?? null;
  const year = v.vehicle_year ?? nested?.year ?? null;
  const make = v.vehicle_make ?? nested?.make ?? null;
  const model = v.vehicle_model ?? nested?.model ?? null;
  const series = nested?.series ?? null;
  const trim = nested?.trim ?? null;
  const body_style = nested?.body_style ?? null;
  const listing_title = v.bat_listing_title ?? null;
  const rawPrice =
    v.sale_price ??
    nested?.sale_price ??
    v.vehicle_current_value ??
    nested?.current_value ??
    v.vehicle_asking_price ??
    nested?.asking_price ??
    null;
  const priceUsd =
    typeof rawPrice === 'number' && Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice : null;
  const isSold = Boolean(v.is_sold || v.sale_price || nested?.sale_price);
  return { year, make, model, series, trim, body_style, listing_title, priceUsd, isSold };
}

export function classifyOrganizationVehicle(
  v: OrganizationVehicleFacetInput,
): VehicleFacetClassification {
  const fields = extractVehicleFields(v);
  return classifyVehicleFacet({
    make: fields.make,
    model: fields.model,
    series: fields.series,
    trim: fields.trim,
    body_style: fields.body_style,
    listing_title: fields.listing_title,
    year: fields.year,
  });
}

export function matchesOrganizationVehicleFacet(
  v: OrganizationVehicleFacetInput,
  axis: OrganizationFacetAxis | null | undefined,
  selectedFacet: string | null | undefined,
): boolean {
  if (!axis || !selectedFacet) return true;
  const target = selectedFacet.trim().toLowerCase();
  if (!target) return true;
  const cls = classifyOrganizationVehicle(v);
  const picked = axis === 'series' ? cls.series : axis === 'trim' ? cls.trim : cls.body;
  return picked != null && picked.toLowerCase() === target;
}

export function filterOrganizationVehiclesByFacet<T extends OrganizationVehicleFacetInput>(
  vehicles: readonly T[],
  axis: OrganizationFacetAxis | null | undefined,
  selectedFacet: string | null | undefined,
): T[] {
  if (!axis || !selectedFacet) return [...vehicles];
  return vehicles.filter((v) => matchesOrganizationVehicleFacet(v, axis, selectedFacet));
}

function computeMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return Math.round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
}

export function computeOrganizationFacetBreakdown(
  vehicles: readonly OrganizationVehicleFacetInput[],
): OrganizationFacetBreakdown {
  const axes: OrganizationFacetAxis[] = ['series', 'trim', 'body'];
  const byAxis: Record<
    OrganizationFacetAxis,
    Map<
      string,
      {
        name: string;
        count: number;
        soldCount: number;
        prices: number[];
        makeCounts: Map<string, number>;
        years: number[];
      }
    >
  > = {
    series: new Map(),
    trim: new Map(),
    body: new Map(),
  };

  let totalVehicles = 0;
  for (const v of vehicles) {
    const fields = extractVehicleFields(v);
    if (!fields.make && !fields.model && !fields.listing_title) continue;
    totalVehicles += 1;
    const cls = classifyOrganizationVehicle(v);

    for (const axis of axes) {
      const label = axis === 'series' ? cls.series : axis === 'trim' ? cls.trim : cls.body;
      if (!label) continue;
      const existing = byAxis[axis].get(label) ?? {
        name: label,
        count: 0,
        soldCount: 0,
        prices: [],
        makeCounts: new Map<string, number>(),
        years: [],
      };
      existing.count += 1;
      if (fields.isSold) existing.soldCount += 1;
      if (fields.priceUsd != null) existing.prices.push(fields.priceUsd);
      if (fields.make) {
        const cleanMake = fields.make.trim();
        existing.makeCounts.set(cleanMake, (existing.makeCounts.get(cleanMake) ?? 0) + 1);
      }
      if (fields.year != null && Number.isFinite(fields.year)) {
        existing.years.push(fields.year);
      }
      byAxis[axis].set(label, existing);
    }
  }

  const buildBuckets = (axis: OrganizationFacetAxis): OrganizationFacetBucket[] => {
    const out: OrganizationFacetBucket[] = [];
    for (const entry of byAxis[axis].values()) {
      let repMake: string | null = null;
      let topMakeCount = 0;
      for (const [mk, cnt] of entry.makeCounts.entries()) {
        if (cnt > topMakeCount) {
          topMakeCount = cnt;
          repMake = mk;
        }
      }
      const repYear = computeMedian(entry.years);
      const identityMark = resolveVehicleIdentityMark({
        make: repMake,
        facetLabel: entry.name,
        year: repYear,
      });
      const badgeSvg =
        identityMark?.svgMarkup ??
        resolveTileBadgeSvg(repMake, null, entry.name, repYear) ??
        null;

      out.push({
        axis,
        name: entry.name,
        count: entry.count,
        soldCount: entry.soldCount,
        sharePct: totalVehicles > 0 ? Number(((entry.count / totalVehicles) * 100).toFixed(1)) : 0,
        medianUsd: computeMedian(entry.prices),
        representativeMake: repMake,
        representativeYear: repYear,
        identityMark,
        badgeSvg,
      });
    }
    return out.sort((a, b) => b.count - a.count || (b.medianUsd ?? 0) - (a.medianUsd ?? 0) || a.name.localeCompare(b.name));
  };

  return {
    totalVehicles,
    series: buildBuckets('series'),
    trim: buildBuckets('trim'),
    body: buildBuckets('body'),
  };
}

const fmtUsdCompact = (usd: number): string => {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
  if (usd >= 1_000) return `$${Math.round(usd / 1_000)}K`;
  return `$${Math.round(usd)}`;
};

export interface OrganizationFacetStripProps {
  breakdown: OrganizationFacetBreakdown;
  activeAxis: OrganizationFacetAxis;
  selectedFacet: string | null;
  onSelectAxis: (axis: OrganizationFacetAxis) => void;
  onSelectFacet: (facet: string | null) => void;
}

export const OrganizationFacetStrip: React.FC<OrganizationFacetStripProps> = ({
  breakdown,
  activeAxis,
  selectedFacet,
  onSelectAxis,
  onSelectFacet,
}) => {
  const totalClassified =
    breakdown.series.length + breakdown.trim.length + breakdown.body.length;
  if (breakdown.totalVehicles === 0 || totalClassified === 0) return null;

  const axisTabs: { id: OrganizationFacetAxis; label: string; buckets: OrganizationFacetBucket[] }[] = [
    { id: 'series', label: 'SERIES', buckets: breakdown.series },
    { id: 'trim', label: 'TRIM', buckets: breakdown.trim },
    { id: 'body', label: 'BODY STYLE', buckets: breakdown.body },
  ];

  const activeBuckets =
    activeAxis === 'series'
      ? breakdown.series
      : activeAxis === 'trim'
        ? breakdown.trim
        : breakdown.body;

  return (
    <div
      className="org-facet-strip"
      data-testid="org-facet-strip"
      role="region"
      aria-label="Multi-axis inventory and sales facet breakdown"
    >
      <div className="org-facet-strip__header">
        <div className="org-facet-strip__tabs" role="tablist" aria-label="Organization facet axis">
          {axisTabs.map((tab) => {
            const isTabActive = activeAxis === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isTabActive}
                data-testid={`org-facet-axis-${tab.id}`}
                className={`org-facet-strip__tab${isTabActive ? ' org-facet-strip__tab--active' : ''}`}
                onClick={() => {
                  onSelectAxis(tab.id);
                  if (activeAxis !== tab.id && selectedFacet) {
                    onSelectFacet(null);
                  }
                }}
              >
                {tab.label} <span className="org-facet-strip__tab-count">{tab.buckets.length}</span>
              </button>
            );
          })}
        </div>
        {selectedFacet && (
          <button
            type="button"
            data-testid="org-facet-clear"
            className="org-facet-strip__clear"
            onClick={() => onSelectFacet(null)}
          >
            CLEAR FILTER ({selectedFacet.toUpperCase()}) ×
          </button>
        )}
      </div>

      <div className="org-facet-strip__pills" role="group" aria-label={`${activeAxis} facet filters`}>
        <button
          type="button"
          data-testid="org-facet-pill-all"
          aria-pressed={!selectedFacet}
          className={`org-facet-strip__pill${!selectedFacet ? ' org-facet-strip__pill--active' : ''}`}
          onClick={() => onSelectFacet(null)}
        >
          <span>ALL</span>
          <span className="org-facet-strip__pill-meta">{breakdown.totalVehicles.toLocaleString('en-US')}</span>
        </button>

        {activeBuckets.slice(0, 12).map((bucket) => {
          const isActive =
            selectedFacet != null && bucket.name.toLowerCase() === selectedFacet.toLowerCase();
          return (
            <button
              key={bucket.name}
              type="button"
              data-testid={`org-facet-pill-${bucket.name}`}
              data-facet-pill={bucket.name}
              aria-pressed={isActive}
              className={`org-facet-strip__pill${isActive ? ' org-facet-strip__pill--active' : ''}`}
              onClick={() => onSelectFacet(isActive ? null : bucket.name)}
            >
              {bucket.badgeSvg && (
                <span
                  aria-hidden="true"
                  data-testid="org-facet-pill-mark"
                  className="org-facet-strip__mark"
                  dangerouslySetInnerHTML={{ __html: bucket.badgeSvg }}
                />
              )}
              <span>{bucket.name}</span>
              <span className="org-facet-strip__pill-meta">
                {bucket.count.toLocaleString('en-US')}
                {bucket.sharePct >= 0.5 ? ` · ${bucket.sharePct.toFixed(0)}%` : ''}
                {bucket.medianUsd ? ` · ${fmtUsdCompact(bucket.medianUsd)}` : ''}
              </span>
            </button>
          );
        })}
      </div>

      <style>{`
        .org-facet-strip {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 8px 12px;
          margin-bottom: 10px;
          background: var(--surface);
          border: 1px solid var(--border);
        }
        .org-facet-strip__header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          flex-wrap: wrap;
        }
        .org-facet-strip__tabs {
          display: inline-flex;
          align-items: center;
          gap: 3px;
        }
        .org-facet-strip__tab {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 0.08em;
          padding: 2px 6px;
          border: 1px solid var(--border);
          background: transparent;
          color: var(--text-secondary);
          cursor: pointer;
          font-family: Arial, sans-serif;
          text-transform: uppercase;
        }
        .org-facet-strip__tab--active {
          background: var(--text);
          color: var(--bg);
          border-color: var(--text);
        }
        .org-facet-strip__tab-count {
          font-family: 'Courier New', monospace;
          font-size: 8px;
          opacity: 0.78;
        }
        .org-facet-strip__clear {
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.05em;
          padding: 2px 6px;
          border: 1px solid var(--border);
          background: var(--bg);
          color: var(--text);
          cursor: pointer;
          font-family: 'Courier New', monospace;
        }
        .org-facet-strip__pills {
          display: flex;
          align-items: center;
          gap: 5px;
          flex-wrap: wrap;
        }
        .org-facet-strip__pill {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 2px 8px;
          font-size: 10px;
          font-weight: 600;
          font-family: Arial, sans-serif;
          color: var(--text-secondary);
          background: var(--bg);
          border: 1px solid var(--border);
          cursor: pointer;
          white-space: nowrap;
        }
        .org-facet-strip__pill:hover {
          color: var(--text);
          border-color: var(--text-secondary);
        }
        .org-facet-strip__pill--active {
          color: var(--bg);
          background: var(--text);
          border-color: var(--text);
        }
        .org-facet-strip__pill--active:hover {
          color: var(--bg);
        }
        .org-facet-strip__pill-meta {
          font-size: 9px;
          font-family: 'Courier New', monospace;
          opacity: 0.78;
        }
        .org-facet-strip__mark {
          display: inline-flex;
          align-items: center;
          height: 14px;
          max-width: 58px;
        }
        .org-facet-strip__mark svg {
          height: 100%;
          width: auto;
          display: block;
        }
      `}</style>
    </div>
  );
};

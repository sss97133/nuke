import React from 'react';
import {
  classifyVehicleFacets,
  isPickupFamilyLabel,
  resolveTileBadgeSvg,
} from '../pages/familyFacetsAndEmblems';
import AIDataIngestionSearch from './search/AIDataIngestionSearch';

export interface SearchFacetInput {
  year?: number | string | null;
  make?: string | null;
  model?: string | null;
  familyLabel?: string | null;
  series?: string | null;
  trim?: string | null;
  bodyStyle?: string | null;
  title?: string | null;
  subtitle?: string | null;
  description?: string | null;
  label?: string | null;
}

export interface SearchFacetPill {
  kind: 'series' | 'trim' | 'body';
  axisLabel: 'SERIES' | 'TRIM' | 'BODY';
  value: string;
  badgeSvg?: string;
}

export interface SearchFacetSummary {
  year: number | null;
  make: string | null;
  familyLabel: string | null;
  series: string | null;
  trim: string | null;
  body: string | null;
  badgeSvg?: string;
  pills: SearchFacetPill[];
}

const KNOWN_MAKE_PATTERNS: Array<{ canonical: string; regex: RegExp }> = [
  { canonical: 'Mercedes-Benz', regex: /\b(?:MERCEDES[-\s]+BENZ|MERCEDES)\b/i },
  { canonical: 'Aston Martin', regex: /\bASTON\s+MARTIN\b/i },
  { canonical: 'Alfa Romeo', regex: /\bALFA\s+ROMEO\b/i },
  { canonical: 'Land Rover', regex: /\bLAND\s+ROVER\b/i },
  { canonical: 'Chevrolet', regex: /\b(?:CHEVROLET|CHEVY)\b/i },
  { canonical: 'Volkswagen', regex: /\b(?:VOLKSWAGEN|VW)\b/i },
  { canonical: 'Porsche', regex: /\bPORSCHE\b/i },
  { canonical: 'Ferrari', regex: /\bFERRARI\b/i },
  { canonical: 'Mustang', regex: /\bSHELBY\b/i },
  { canonical: 'Plymouth', regex: /\bPLYMOUTH\b/i },
  { canonical: 'Pontiac', regex: /\bPONTIAC\b/i },
  { canonical: 'Oldsmobile', regex: /\bOLDSMOBILE\b/i },
  { canonical: 'Cadillac', regex: /\bCADILLAC\b/i },
  { canonical: 'Chrysler', regex: /\bCHRYSLER\b/i },
  { canonical: 'Dodge', regex: /\bDODGE\b/i },
  { canonical: 'Ford', regex: /\bFORD\b/i },
  { canonical: 'GMC', regex: /\bGMC\b/i },
  { canonical: 'BMW', regex: /\bBMW\b/i },
  { canonical: 'Buick', regex: /\bBUICK\b/i },
  { canonical: 'Jaguar', regex: /\bJAGUAR\b/i },
  { canonical: 'Toyota', regex: /\bTOYOTA\b/i },
  { canonical: 'Datsun', regex: /\bDATSUN\b/i },
  { canonical: 'Nissan', regex: /\bNISSAN\b/i },
  { canonical: 'Jeep', regex: /\bJEEP\b/i },
  { canonical: 'AMC', regex: /\bAMC\b/i },
];

function parseYearFromText(
  explicitYear: number | string | null | undefined,
  compositeText: string,
): number | null {
  if (typeof explicitYear === 'number' && Number.isFinite(explicitYear)) {
    if (explicitYear >= 1900 && explicitYear <= 2035) return explicitYear;
  }
  if (typeof explicitYear === 'string' && explicitYear.trim()) {
    const parsed = Number.parseInt(explicitYear.trim(), 10);
    if (Number.isFinite(parsed) && parsed >= 1900 && parsed <= 2035) return parsed;
  }
  const match = compositeText.match(/\b(19\d{2}|20[0-3]\d)\b/);
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  return year >= 1900 && year <= 2035 ? year : null;
}

function parseMakeFromText(
  explicitMake: string | null | undefined,
  compositeText: string,
): string | null {
  if (explicitMake && explicitMake.trim()) {
    const raw = explicitMake.trim();
    for (const entry of KNOWN_MAKE_PATTERNS) {
      if (entry.regex.test(raw)) {
        return entry.canonical === 'Mustang' ? 'Ford' : entry.canonical;
      }
    }
    return raw;
  }
  for (const entry of KNOWN_MAKE_PATTERNS) {
    if (entry.regex.test(compositeText)) {
      return entry.canonical === 'Mustang' ? 'Ford' : entry.canonical;
    }
  }
  return null;
}

function inferFamilyLabel(
  explicitFamily: string | null | undefined,
  explicitModel: string | null | undefined,
  compositeText: string,
): string | null {
  if (explicitFamily && explicitFamily.trim()) {
    return isPickupFamilyLabel(explicitFamily) ? 'Pickup' : explicitFamily.trim();
  }
  if (explicitModel && explicitModel.trim()) {
    if (isPickupFamilyLabel(explicitModel)) return 'Pickup';
  }

  const upper = compositeText.toUpperCase();
  if (
    /\b(?:[CKRV][-\s]?(?:10|20|30|1500|2500|3500)|3100|3600|3800|F[-\s]?(?:1|2|3|100|150|250|350)|W[-\s]?(?:100|150|200|250|300)|WM[-\s]?300|D[-\s]?(?:100|150|200|250)|POWER\s+WAGON|APACHE|CAMEO|STEPSIDE|FLEETSIDE|PICKUP)\b/.test(
      upper,
    )
  ) {
    return 'Pickup';
  }
  if (/\bMUSTANG\b|\bSHELBY\s+GT(?:350|500)\b|\bBOSS\s+(?:302|429)\b|\bMACH\s+1\b/.test(upper)) {
    return 'Mustang';
  }
  if (/\bCORVETTE\b|\bSTING\s*RAY\b/.test(upper)) return 'Corvette';
  if (/\bCAMARO\b|\bZ\/?28\b|\bIROC[-\s]?Z\b/.test(upper)) return 'Camaro';
  if (/\bCHEVELLE\b|\bMALIBU\b/.test(upper)) return 'Chevelle';
  if (/\bBEL\s+AIR\b/.test(upper)) return 'Bel Air';
  if (/\bNOMAD\b/.test(upper)) return 'Nomad';
  if (/\bBRONCO\b/.test(upper)) return 'Bronco';
  if (/\bCHARGER\b/.test(upper)) return 'Charger';
  if (/\bCHALLENGER\b/.test(upper)) return 'Challenger';
  if (/\b911\b|\b930\b|\bCARRERA\b|\bTARGA\b/.test(upper)) return '911';
  if (/\bM3\b/.test(upper)) return 'M3';
  if (/\b(?:300|190|230|250|280|380|450|560)\s*SL\b|\bPAGODA\b|\bGULLWING\b/.test(upper)) {
    return 'SL';
  }
  if (/\bF?355\b/.test(upper)) return '355';

  return explicitModel?.trim() || null;
}

/**
 * Derives orthogonal Series, Trim, and Body Style facets and period-exact vector
 * emblem SVGs for a search suggestion or vehicle/model search result.
 */
export function deriveSearchResultFacets(input: SearchFacetInput): SearchFacetSummary {
  const compositeParts = [
    input.model,
    input.series,
    input.trim,
    input.bodyStyle,
    input.title,
    input.label,
    input.subtitle,
    input.description,
  ]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean);

  const compositeText = compositeParts.join(' ');
  if (!compositeText) {
    return {
      year: null,
      make: null,
      familyLabel: null,
      series: null,
      trim: null,
      body: null,
      badgeSvg: undefined,
      pills: [],
    };
  }

  const year = parseYearFromText(input.year, compositeText);
  const make = parseMakeFromText(input.make, compositeText);
  const familyLabel = inferFamilyLabel(input.familyLabel, input.model, compositeText);

  const classified = classifyVehicleFacets(make, familyLabel, compositeText, year);

  const series = classified.series ?? (input.series?.trim() || null);
  const trim = classified.trim ?? (input.trim?.trim() || null);
  const body = classified.body ?? (input.bodyStyle?.trim() || null);

  const trimSvg = trim ? resolveTileBadgeSvg(make, familyLabel, trim, year) : undefined;
  const seriesSvg = series ? resolveTileBadgeSvg(make, familyLabel, series, year) : undefined;
  const bodySvg = body ? resolveTileBadgeSvg(make, familyLabel, body, year) : undefined;
  const descriptorSvg = resolveTileBadgeSvg(make, familyLabel, compositeText, year);

  const badgeSvg = trimSvg ?? seriesSvg ?? bodySvg ?? descriptorSvg;

  const pills: SearchFacetPill[] = [];
  if (series) {
    pills.push({
      kind: 'series',
      axisLabel: 'SERIES',
      value: series,
      badgeSvg: seriesSvg,
    });
  }
  if (trim) {
    pills.push({
      kind: 'trim',
      axisLabel: 'TRIM',
      value: trim,
      badgeSvg: trimSvg,
    });
  }
  if (body) {
    pills.push({
      kind: 'body',
      axisLabel: 'BODY',
      value: body,
      badgeSvg: bodySvg,
    });
  }

  return {
    year,
    make,
    familyLabel,
    series,
    trim,
    body,
    badgeSvg,
    pills,
  };
}

export interface HeaderSearchFacetPillsProps extends SearchFacetInput {
  compact?: boolean;
  className?: string;
}

export const HeaderSearchFacetPills: React.FC<HeaderSearchFacetPillsProps> = ({
  compact = false,
  className = '',
  ...facetInput
}) => {
  const summary = React.useMemo(
    () => deriveSearchResultFacets(facetInput),
    [
      facetInput.year,
      facetInput.make,
      facetInput.model,
      facetInput.familyLabel,
      facetInput.series,
      facetInput.trim,
      facetInput.bodyStyle,
      facetInput.title,
      facetInput.subtitle,
      facetInput.description,
      facetInput.label,
    ],
  );

  if (summary.pills.length === 0 && !summary.badgeSvg) {
    return null;
  }

  const rootClassName = [
    'header-search-facets',
    compact ? 'header-search-facets--compact' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootClassName} data-testid="header-search-facets">
      {summary.badgeSvg && (
        <span
          className="header-search-facet-emblem"
          data-testid="header-search-facet-emblem"
          title={[summary.year, summary.make, summary.trim ?? summary.series ?? summary.body]
            .filter(Boolean)
            .join(' ')}
          dangerouslySetInnerHTML={{ __html: summary.badgeSvg }}
        />
      )}
      {summary.pills.map((pill) => (
        <span
          key={`${pill.kind}-${pill.value}`}
          className={`header-search-facet-pill header-search-facet-pill--${pill.kind}`}
          data-testid={`header-search-facet-${pill.kind}`}
          data-facet-kind={pill.kind}
          data-facet-value={pill.value}
        >
          <span className="header-search-facet-axis">{pill.axisLabel}</span>
          <span className="header-search-facet-sep">·</span>
          <span className="header-search-facet-value">{pill.value}</span>
        </span>
      ))}
    </div>
  );
};

export interface HeaderSearchProps {
  className?: string;
}

export const HeaderSearch: React.FC<HeaderSearchProps> = ({ className }) => {
  return <AIDataIngestionSearch className={className} />;
};

export default HeaderSearch;

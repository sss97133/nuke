import {
  classifyVehicleFacet,
  classifyVehicleFacets,
  inferVehicleFamilyLabel,
  isPickupFamilyLabel,
  resolveTileBadgeSvg,
  resolveVehicleIdentityMark,
  resolveVettedIdentityMarks,
  VETTED_IDENTITY_MARKS,
  type FamilyFacetAxis,
  type VehicleFacetClassification,
  type VehicleIdentityMark,
  type VehicleTaxonomyInput,
} from '../../pages/vehicleTaxonomy';
import {
  buildFacetDrilldownUrl,
  resolveVehicleMarketFamily,
} from '../../pages/vehicle-profile/VehicleBadgeBar';

export type ClassifiedVehicleFacet = VehicleFacetClassification & {
  family?: string | null;
};

export {
  buildFacetDrilldownUrl,
  classifyVehicleFacet,
  classifyVehicleFacets,
  inferVehicleFamilyLabel,
  isPickupFamilyLabel,
  resolveTileBadgeSvg,
  resolveVehicleIdentityMark,
  resolveVehicleMarketFamily,
  resolveVettedIdentityMarks,
  VETTED_IDENTITY_MARKS,
  type FamilyFacetAxis,
  type VehicleFacetClassification,
  type VehicleIdentityMark,
  type VehicleTaxonomyInput,
};

export type VehicleCohortFilterKey = 'all' | 'series' | 'trim' | 'body';

export interface MarketCohortShortcut {
  id: string;
  make: string;
  family: string;
  axis: Exclude<FamilyFacetAxis, 'raw'>;
  axisDisplayLabel: 'SERIES' | 'TRIM' | 'BODY';
  facet: string;
  url: string;
  svgMarkup: string;
  yearRangeLabel: string | null;
  subLabel: string;
  keywords: readonly string[];
}

interface MarketCohortShortcutSeed {
  id: string;
  make: string;
  family: string;
  axis: Exclude<FamilyFacetAxis, 'raw'>;
  facet: string;
  markId?: string;
  fallbackYear?: number;
  yearRangeLabel: string | null;
  subLabel: string;
  keywords: readonly string[];
}

const MARKET_COHORT_SHORTCUT_CATALOG: readonly MarketCohortShortcutSeed[] = [
  {
    id: 'chevy-pickup-squarebody-c10',
    make: 'Chevrolet',
    family: 'Pickup',
    axis: 'series',
    facet: 'C10 (1/2-Ton 2WD)',
    markId: 'chevy-bowtie-1973-1987',
    fallbackYear: 1978,
    yearRangeLabel: '1973–1987',
    subLabel: 'Squarebody / Action Line 1/2-Ton 2WD Pickup',
    keywords: ['squarebody', 'square body', 'c10', 'c-10', 'chevy c10', 'chevrolet c10', '1/2-ton 2wd'],
  },
  {
    id: 'chevy-pickup-k10',
    make: 'Chevrolet',
    family: 'Pickup',
    axis: 'series',
    facet: 'K10 (1/2-Ton 4x4)',
    markId: 'chevy-bowtie-1973-1987',
    fallbackYear: 1978,
    yearRangeLabel: '1973–1987',
    subLabel: 'Squarebody / Action Line 1/2-Ton 4x4 Pickup',
    keywords: ['k10', 'k-10', 'chevy k10', 'chevrolet k10', 'squarebody 4x4'],
  },
  {
    id: 'chevy-pickup-3100',
    make: 'Chevrolet',
    family: 'Pickup',
    axis: 'series',
    facet: '3100 (1/2-Ton)',
    markId: 'chevy-3100-47-55',
    fallbackYear: 1953,
    yearRangeLabel: '1947–1955',
    subLabel: 'Advance Design 5-Window & Standard 1/2-Ton',
    keywords: ['3100', 'chevy 3100', 'chevrolet 3100', 'advance design'],
  },
  {
    id: 'chevy-pickup-silverado',
    make: 'Chevrolet',
    family: 'Pickup',
    axis: 'trim',
    facet: 'Silverado',
    markId: 'chevy-silverado-10-75-80',
    fallbackYear: 1978,
    yearRangeLabel: '1975–1987',
    subLabel: 'RPO Z84 Top-Tier Squarebody Trim Package',
    keywords: ['silverado', 'silverado 10', 'rpo z84', 'squarebody silverado'],
  },
  {
    id: 'chevy-pickup-cheyenne',
    make: 'Chevrolet',
    family: 'Pickup',
    axis: 'trim',
    facet: 'Cheyenne',
    markId: 'chevy-cheyenne-10-73-81',
    fallbackYear: 1976,
    yearRangeLabel: '1973–1981',
    subLabel: 'RPO YE9 Western Slab Fender Trim Package',
    keywords: ['cheyenne', 'cheyenne 10', 'cheyenne super', 'rpo ye9'],
  },
  {
    id: 'chevy-pickup-scottsdale',
    make: 'Chevrolet',
    family: 'Pickup',
    axis: 'trim',
    facet: 'Scottsdale',
    markId: 'chevy-scottsdale-10-75-87',
    fallbackYear: 1979,
    yearRangeLabel: '1975–1987',
    subLabel: 'RPO YE8 Squarebody Trim Package',
    keywords: ['scottsdale', 'scottsdale 10', 'rpo ye8'],
  },
  {
    id: 'chevy-pickup-custom-deluxe',
    make: 'Chevrolet',
    family: 'Pickup',
    axis: 'trim',
    facet: 'Custom Deluxe',
    markId: 'chevy-custom-deluxe-10-73-80',
    fallbackYear: 1976,
    yearRangeLabel: '1973–1980',
    subLabel: 'Stacked Fender Plate Squarebody Trim',
    keywords: ['custom deluxe', 'custom deluxe 10'],
  },
  {
    id: 'chevy-pickup-stepside',
    make: 'Chevrolet',
    family: 'Pickup',
    axis: 'body',
    facet: 'Stepside / Flareside',
    markId: 'chevy-bowtie-1973-1987',
    fallbackYear: 1976,
    yearRangeLabel: '1947–1987',
    subLabel: 'External-Fender Stepside Bed Configuration',
    keywords: ['stepside', 'flareside', 'fenderside', 'stepside bed'],
  },
  {
    id: 'chevy-pickup-fleetside',
    make: 'Chevrolet',
    family: 'Pickup',
    axis: 'body',
    facet: 'Fleetside / Styleside',
    markId: 'chevy-bowtie-1973-1987',
    fallbackYear: 1976,
    yearRangeLabel: '1958–1987',
    subLabel: 'Slab-Side Fleetside / Styleside Bed Configuration',
    keywords: ['fleetside', 'styleside', 'wideline', 'sweptline'],
  },
  {
    id: 'toyota-land-cruiser-fj40',
    make: 'Toyota',
    family: 'Land Cruiser',
    axis: 'series',
    facet: 'FJ40 / BJ40 (J40)',
    markId: 'toyota-land-cruiser-fj40-60-84',
    fallbackYear: 1978,
    yearRangeLabel: '1960–1984',
    subLabel: 'J40 Series 4WD Short-Wheelbase Hardtop & Soft Top',
    keywords: ['fj40', 'bj40', 'j40', 'fj43', 'fj45', 'land cruiser fj40'],
  },
  {
    id: 'toyota-land-cruiser-fj60',
    make: 'Toyota',
    family: 'Land Cruiser',
    axis: 'series',
    facet: 'FJ60 / FJ62 (J60 Wagon)',
    markId: 'toyota-land-cruiser-fj40-60-84',
    fallbackYear: 1984,
    yearRangeLabel: '1980–1990',
    subLabel: 'J60 Series 4WD Station Wagon',
    keywords: ['fj60', 'fj62', 'j60', 'hj60', 'hj61', 'land cruiser fj60'],
  },
  {
    id: 'toyota-land-cruiser-fj80',
    make: 'Toyota',
    family: 'Land Cruiser',
    axis: 'series',
    facet: 'FZJ80 / FJ80 (J80)',
    markId: 'toyota-land-cruiser-fj40-60-84',
    fallbackYear: 1995,
    yearRangeLabel: '1990–1997',
    subLabel: 'J80 Series Full-Time 4WD Triple-Locked Wagon',
    keywords: ['fj80', 'fzj80', 'hdj80', 'j80', '80-series', 'land cruiser fj80'],
  },
  {
    id: 'porsche-911-993',
    make: 'Porsche',
    family: '911',
    axis: 'series',
    facet: '911 Carrera',
    markId: 'porsche-stuttgart-crest',
    fallbackYear: 1996,
    yearRangeLabel: '1995–1998',
    subLabel: '993 Final Air-Cooled Generation Carrera / Turbo',
    keywords: ['993', 'porsche 993', '964', 'porsche 964'],
  },
  {
    id: 'porsche-911-992',
    make: 'Porsche',
    family: '911',
    axis: 'series',
    facet: '911 Carrera',
    markId: 'porsche-stuttgart-crest',
    fallbackYear: 2022,
    yearRangeLabel: '2019–2025',
    subLabel: '992 Modern Generation Carrera / Turbo / GT3',
    keywords: ['992', 'porsche 992', '991', '997'],
  },
  {
    id: 'porsche-911-gt3-rs',
    make: 'Porsche',
    family: '911',
    axis: 'series',
    facet: 'GT3 RS',
    markId: 'porsche-911-carrera-rs-73',
    fallbackYear: 2019,
    yearRangeLabel: '2003–2025',
    subLabel: 'Rennsport Weissach Homologation Track Special',
    keywords: ['gt3 rs', 'gt3rs', '911 gt3 rs', 'carrera rs'],
  },
  {
    id: 'porsche-911-gt3',
    make: 'Porsche',
    family: '911',
    axis: 'series',
    facet: 'GT3',
    markId: 'porsche-911-carrera-rs-73',
    fallbackYear: 2018,
    yearRangeLabel: '1999–2025',
    subLabel: 'Naturally Aspirated Motorsport Flat-Six 911',
    keywords: ['gt3', '911 gt3', 'gt3 touring'],
  },
  {
    id: 'porsche-911-targa',
    make: 'Porsche',
    family: '911',
    axis: 'body',
    facet: 'Targa / T-Top',
    markId: 'porsche-911-targa',
    fallbackYear: 1973,
    yearRangeLabel: '1967–2025',
    subLabel: 'Brushed Stainless Roll Hoop Open-Top 911',
    keywords: ['targa', '911 targa'],
  },
  {
    id: 'chevy-corvette-z06',
    make: 'Chevrolet',
    family: 'Corvette',
    axis: 'series',
    facet: 'Z06',
    markId: 'corvette-c2-sting-ray-63-67',
    fallbackYear: 1963,
    yearRangeLabel: '1963–2025',
    subLabel: 'RPO Z06 Track-Spec Performance Corvette',
    keywords: ['z06', 'corvette z06', 'c2 z06', 'c5 z06', 'c6 z06', 'c7 z06', 'c8 z06'],
  },
  {
    id: 'chevy-corvette-zr1',
    make: 'Chevrolet',
    family: 'Corvette',
    axis: 'series',
    facet: 'ZR1 / ZR-1',
    markId: 'corvette-c3-stingray-68-82',
    fallbackYear: 1970,
    yearRangeLabel: '1970–2025',
    subLabel: 'King of the Hill LT5 / LS9 / LT5 Supercharged Corvette',
    keywords: ['zr1', 'zr-1', 'corvette zr1'],
  },
  {
    id: 'chevy-corvette-sting-ray',
    make: 'Chevrolet',
    family: 'Corvette',
    axis: 'series',
    facet: 'Sting Ray (C2)',
    markId: 'corvette-c2-sting-ray-63-67',
    fallbackYear: 1965,
    yearRangeLabel: '1963–1967',
    subLabel: "C2 Two-Word 'Sting Ray' Coupe & Convertible",
    keywords: ['sting ray', 'stingray', 'c2 corvette', 'split-window', 'split window'],
  },
  {
    id: 'ford-mustang-shelby-gt350',
    make: 'Ford',
    family: 'Mustang',
    axis: 'series',
    facet: 'Shelby GT350',
    markId: 'mustang-tribar-64-73',
    fallbackYear: 1966,
    yearRangeLabel: '1965–2020',
    subLabel: 'Shelby American K-Code 289 & Voodoo 5.2L Fastback',
    keywords: ['shelby gt350', 'gt350', 'gt350r', 'shelby gt500', 'gt500'],
  },
  {
    id: 'ford-mustang-boss-429',
    make: 'Ford',
    family: 'Mustang',
    axis: 'series',
    facet: 'Boss 429',
    markId: 'mustang-boss-69-70',
    fallbackYear: 1969,
    yearRangeLabel: '1969–1970',
    subLabel: 'Kar-Kraft NASCAR Semi-Hemi 429 & Shinoda Boss 302',
    keywords: ['boss 429', 'boss 302', 'boss mustang', 'mustang boss'],
  },
  {
    id: 'ford-mustang-mach-1',
    make: 'Ford',
    family: 'Mustang',
    axis: 'series',
    facet: 'Mach 1',
    markId: 'mustang-mach-1-69-73',
    fallbackYear: 1970,
    yearRangeLabel: '1969–1973',
    subLabel: 'Body 63C SportsRoof Cobra Jet Fastback',
    keywords: ['mach 1', 'mach1', 'mustang mach 1'],
  },
  {
    id: 'ford-mustang-fastback',
    make: 'Ford',
    family: 'Mustang',
    axis: 'body',
    facet: 'Fastback',
    markId: 'mustang-body-fastback',
    fallbackYear: 1967,
    yearRangeLabel: '1965–1973',
    subLabel: 'Body Code 63 2+2 / SportsRoof Swept Roofline',
    keywords: ['fastback', 'sportsroof', 'mustang fastback'],
  },
  {
    id: 'mercedes-sl-gullwing',
    make: 'Mercedes-Benz',
    family: 'SL',
    axis: 'body',
    facet: 'Gullwing Coupe',
    markId: 'mercedes-300sl-gullwing-54-63',
    fallbackYear: 1955,
    yearRangeLabel: '1954–1963',
    subLabel: 'W198 300 SL Gullwing Coupe & Roadster',
    keywords: ['gullwing', '300sl', '300 sl', 'w198'],
  },
  {
    id: 'mercedes-sl-pagoda',
    make: 'Mercedes-Benz',
    family: 'SL',
    axis: 'series',
    facet: 'Pagoda (W113)',
    markId: 'mercedes-300sl-gullwing-54-63',
    fallbackYear: 1968,
    yearRangeLabel: '1963–1971',
    subLabel: 'W113 230SL / 250SL / 280SL Paul Bracq Pagoda',
    keywords: ['pagoda', 'w113', '280sl', '280 sl', '230sl', '250sl'],
  },
  {
    id: 'jaguar-etype-series-1',
    make: 'Jaguar',
    family: 'E-Type',
    axis: 'series',
    facet: 'E-Type Series 1',
    markId: 'jaguar-coventry-etype-xk',
    fallbackYear: 1965,
    yearRangeLabel: '1961–1974',
    subLabel: 'Coventry XK6 Covered-Headlamp Roadster & FHC',
    keywords: ['e-type', 'etype', 'xke', 'jaguar e-type', 'series 1 e-type'],
  },
  {
    id: 'dodge-pickup-power-wagon',
    make: 'Dodge',
    family: 'Pickup',
    axis: 'series',
    facet: 'Power Wagon (4x4)',
    markId: 'dodge-power-wagon-46-80',
    fallbackYear: 1960,
    yearRangeLabel: '1946–1980',
    subLabel: 'WM300 Flat-Fender & W100/W200 Heavy-Duty 4x4',
    keywords: ['power wagon', 'wm300', 'w100', 'w200', 'cummins', 'dodge cummins', 'w250'],
  },
  {
    id: 'dodge-charger-hemi',
    make: 'Dodge',
    family: 'Charger',
    axis: 'series',
    facet: '426 Hemi',
    markId: 'dodge-rt-68-71',
    fallbackYear: 1969,
    yearRangeLabel: '1966–1971',
    subLabel: '426 Hemi Elephant V8 Muscle Cohort',
    keywords: ['hemi', '426 hemi', 'hemi cuda', 'hemi charger'],
  },
  {
    id: 'dodge-charger-rt',
    make: 'Dodge',
    family: 'Charger',
    axis: 'trim',
    facet: 'R/T (Road/Track)',
    markId: 'dodge-rt-68-71',
    fallbackYear: 1969,
    yearRangeLabel: '1967–1971',
    subLabel: 'Scat Pack Road/Track 440 Magnum & 426 Hemi',
    keywords: ['r/t', 'road/track', 'charger r/t', 'challenger r/t', 'scat pack'],
  },
];

function axisToDisplayLabel(axis: Exclude<FamilyFacetAxis, 'raw'>): 'SERIES' | 'TRIM' | 'BODY' {
  if (axis === 'series') return 'SERIES';
  if (axis === 'trim') return 'TRIM';
  return 'BODY';
}

/**
 * Matches a user search query (2+ characters) against vetted identity marks (`VETTED_IDENTITY_MARKS`)
 * and canonical `SERIES` / `TRIM` / `BODY STYLE` Market Map cohorts, returning up to `maxResults` (default 3)
 * shortcut cards with inline period-accurate SVG badges and direct drilldown URLs.
 */
export function resolveMarketCohortShortcuts(
  query: string | null | undefined,
  maxResults = 3,
): MarketCohortShortcut[] {
  const cleaned = (query ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (cleaned.length < 2) return [];

  const scored: Array<{ score: number; shortcut: MarketCohortShortcut }> = [];
  const seenKeys = new Set<string>();

  for (const seed of MARKET_COHORT_SHORTCUT_CATALOG) {
    let bestScore = 0;
    const facetLower = seed.facet.toLowerCase();
    const familyLower = seed.family.toLowerCase();
    const makeLower = seed.make.toLowerCase();

    for (const kw of seed.keywords) {
      const kwLower = kw.toLowerCase();
      if (kwLower === cleaned) {
        bestScore = Math.max(bestScore, 100);
      } else if (kwLower.startsWith(cleaned)) {
        bestScore = Math.max(bestScore, 85);
      } else if (cleaned.includes(kwLower) && kwLower.length >= 2) {
        bestScore = Math.max(bestScore, 80);
      } else if (kwLower.includes(cleaned) && cleaned.length >= 3) {
        bestScore = Math.max(bestScore, 65);
      }
    }

    if (bestScore === 0) {
      if (facetLower === cleaned) bestScore = 95;
      else if (facetLower.startsWith(cleaned)) bestScore = 75;
      else if (facetLower.includes(cleaned) && cleaned.length >= 3) bestScore = 60;
      else if (`${makeLower} ${familyLower} ${facetLower}`.includes(cleaned) && cleaned.length >= 3) {
        bestScore = 50;
      }
    }

    if (bestScore <= 0) continue;

    const mark =
      (seed.markId ? VETTED_IDENTITY_MARKS.find((m) => m.id === seed.markId) : null) ??
      resolveVehicleIdentityMark({
        make: seed.make,
        family: seed.family,
        model: `${seed.family} ${seed.facet}`,
        facetLabel: seed.facet,
        year: seed.fallbackYear,
      }) ??
      VETTED_IDENTITY_MARKS[0];

    const url = buildFacetDrilldownUrl({
      make: seed.make,
      family: seed.family,
      axis: seed.axis,
      facet: seed.facet,
    });

    const dedupeKey = `${seed.make}|${seed.family}|${seed.axis}|${seed.facet}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    scored.push({
      score: bestScore,
      shortcut: {
        id: seed.id,
        make: seed.make,
        family: seed.family,
        axis: seed.axis,
        axisDisplayLabel: axisToDisplayLabel(seed.axis),
        facet: seed.facet,
        url,
        svgMarkup: mark.svgMarkup,
        yearRangeLabel:
          seed.yearRangeLabel ??
          (mark.yearEnd <= 2025 ? `${mark.yearStart}–${mark.yearEnd}` : `${mark.yearStart}+`),
        subLabel: seed.subLabel,
        keywords: seed.keywords,
      },
    });
  }

  // Fallback check against any remaining VETTED_IDENTITY_MARKS not already matched
  if (scored.length < maxResults) {
    for (const mark of VETTED_IDENTITY_MARKS) {
      if (mark.markKind === 'marque_emblem') continue;
      const haystack = [
        mark.displayLabel,
        mark.subLabel,
        mark.seriesCode,
        mark.trimPackage,
        mark.bodyStyle,
        mark.rpoCode,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(cleaned)) continue;

      const axis: Exclude<FamilyFacetAxis, 'raw'> = mark.trimPackage
        ? 'trim'
        : mark.bodyStyle
          ? 'body'
          : 'series';
      const rawFacet = mark.trimPackage ?? mark.bodyStyle ?? mark.seriesCode ?? mark.displayLabel;
      const family = mark.family ?? inferVehicleFamilyLabel(mark.brand, rawFacet) ?? 'Pickup';
      const classified = classifyVehicleFacet(mark.brand, family, rawFacet, mark.yearStart);
      const facet =
        (axis === 'trim'
          ? classified.trim
          : axis === 'body'
            ? classified.body
            : classified.series) ?? rawFacet;

      const dedupeKey = `${mark.brand}|${family}|${axis}|${facet}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      scored.push({
        score: 55,
        shortcut: {
          id: mark.id,
          make: mark.brand,
          family,
          axis,
          axisDisplayLabel: axisToDisplayLabel(axis),
          facet,
          url: buildFacetDrilldownUrl({
            make: mark.brand,
            family,
            axis,
            facet,
          }),
          svgMarkup: mark.svgMarkup,
          yearRangeLabel: mark.yearEnd <= 2025 ? `${mark.yearStart}–${mark.yearEnd}` : `${mark.yearStart}+`,
          subLabel: mark.subLabel,
          keywords: [mark.displayLabel],
        },
      });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map((entry) => entry.shortcut);
}


export interface VehicleCohortOption {
  key: VehicleCohortFilterKey;
  axis: Exclude<FamilyFacetAxis, 'raw'> | null;
  facetValue: string | null;
  label: string;
}

export interface ComparableSaleLike {
  year?: number | null;
  make?: string | null;
  model?: string | null;
  series?: string | null;
  trim?: string | null;
  body_style?: string | null;
  title?: string | null;
  listing_title?: string | null;
  sale_price: number;
}

export interface CohortComparisonStats {
  familyCount: number;
  familyMedianPrice: number | null;
  cohortCount: number;
  cohortMedianPrice: number | null;
  deltaPctVsFamily: number | null;
  deltaDirection: 'premium' | 'discount' | 'par' | null;
}

export function computeSaleMedian(prices: readonly number[]): number | null {
  const valid = prices.filter((p) => typeof p === 'number' && Number.isFinite(p) && p > 0).sort((a, b) => a - b);
  if (valid.length === 0) return null;
  const mid = Math.floor(valid.length / 2);
  return valid.length % 2 === 1 ? valid[mid] : Math.round((valid[mid - 1] + valid[mid]) / 2);
}

/**
 * Uses `classifyVehicleFacet` to derive the current vehicle's SERIES, TRIM, and BODY STYLE
 * facets and build the interactive Cohort Filter bar options:
 * `ALL FAMILY` | `SERIES: <val>` | `TRIM: <val>` | `BODY: <val>`
 */
export function buildVehicleCohortOptions(
  vehicle: VehicleTaxonomyInput | null | undefined,
): {
  facets: VehicleFacetClassification;
  options: VehicleCohortOption[];
} {
  if (!vehicle) {
    return {
      facets: { series: null, trim: null, body: null },
      options: [{ key: 'all', axis: null, facetValue: null, label: 'ALL FAMILY' }],
    };
  }

  const classified = classifyVehicleFacet(vehicle);
  const facets: VehicleFacetClassification = {
    series: classified.series,
    trim: classified.trim,
    body: classified.body,
  };
  const options: VehicleCohortOption[] = [
    { key: 'all', axis: null, facetValue: null, label: 'ALL FAMILY' },
  ];

  if (facets.series) {
    options.push({
      key: 'series',
      axis: 'series',
      facetValue: facets.series,
      label: `SERIES: ${facets.series}`,
    });
  }
  if (facets.trim) {
    options.push({
      key: 'trim',
      axis: 'trim',
      facetValue: facets.trim,
      label: `TRIM: ${facets.trim}`,
    });
  }
  if (facets.body) {
    options.push({
      key: 'body',
      axis: 'body',
      facetValue: facets.body,
      label: `BODY: ${facets.body}`,
    });
  }

  return { facets, options };
}

export function filterComparableSalesByCohort<T extends ComparableSaleLike>(
  sales: readonly T[],
  activeKey: VehicleCohortFilterKey,
  vehicleFacets: VehicleFacetClassification,
  fallbackMake?: string | null,
  fallbackFamily?: string | null,
): T[] {
  if (activeKey === 'all') return [...sales];

  const targetValue =
    activeKey === 'series'
      ? vehicleFacets.series
      : activeKey === 'trim'
        ? vehicleFacets.trim
        : vehicleFacets.body;

  if (!targetValue) return [...sales];
  const normalizedTarget = targetValue.trim().toLowerCase();

  return sales.filter((sale) => {
    const classified = classifyVehicleFacet({
      make: sale.make ?? fallbackMake ?? null,
      family: fallbackFamily ?? null,
      model: sale.model ?? null,
      series: sale.series ?? null,
      trim: sale.trim ?? null,
      body_style: sale.body_style ?? null,
      listing_title: sale.listing_title ?? sale.title ?? null,
      year: sale.year ?? null,
    });
    const saleFacet =
      activeKey === 'series'
        ? classified.series
        : activeKey === 'trim'
          ? classified.trim
          : classified.body;
    return saleFacet != null && saleFacet.trim().toLowerCase() === normalizedTarget;
  });
}

export function computeCohortComparisonStats(
  allSales: readonly ComparableSaleLike[],
  filteredSales: readonly ComparableSaleLike[],
): CohortComparisonStats {
  const familyPrices = allSales
    .map((s) => s.sale_price)
    .filter((p) => typeof p === 'number' && Number.isFinite(p) && p > 0);
  const cohortPrices = filteredSales
    .map((s) => s.sale_price)
    .filter((p) => typeof p === 'number' && Number.isFinite(p) && p > 0);

  const familyMedianPrice = computeSaleMedian(familyPrices);
  const cohortMedianPrice = computeSaleMedian(cohortPrices);

  let deltaPctVsFamily: number | null = null;
  let deltaDirection: 'premium' | 'discount' | 'par' | null = null;

  if (familyMedianPrice != null && familyMedianPrice > 0 && cohortMedianPrice != null && cohortMedianPrice > 0) {
    const rawDelta = ((cohortMedianPrice - familyMedianPrice) / familyMedianPrice) * 100;
    deltaPctVsFamily = Number(rawDelta.toFixed(1));
    if (deltaPctVsFamily > 0) deltaDirection = 'premium';
    else if (deltaPctVsFamily < 0) deltaDirection = 'discount';
    else deltaDirection = 'par';
  }

  return {
    familyCount: familyPrices.length,
    familyMedianPrice,
    cohortCount: cohortPrices.length,
    cohortMedianPrice,
    deltaPctVsFamily,
    deltaDirection,
  };
}

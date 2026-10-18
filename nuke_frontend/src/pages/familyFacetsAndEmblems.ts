import type { TreemapNode } from './HomePage';
import type { Sale as FamilySalePoint } from './market/FamilySalesChart';

/**
 * Multi-axis vehicle facet classifier & vetted era-accurate identity marks (emblems, fender badges, scripts).
 *
 * Solves two coupled problems:
 * 1. Re-keying & differentiating fragmented sub-models into clean orthogonal axes:
 *    - `series`     (e.g. C10, K10, C20, K20, C30, K30, 3100, 3600, Apache, Cameo, C1500, K1500, F-100, F-150, F-250, F-350, Shelby, Boss, Mach 1, Carrera, Turbo, GT3)
 *    - `trim`       (e.g. Custom Deluxe, Scottsdale, Cheyenne, Cheyenne Super, Silverado, Big 10, 454 SS, Sierra, Sierra Grande, High Sierra, Sierra Classic, Ranger XLT, Z06, ZR1, Z28, SS)
 *    - `body_style` (e.g. Fastback, Coupe, Convertible, Roadster, Targa, Split-Window, Stepside, Fleetside, Short Bed, Long Bed, 2-Door, 4-Door)
 *    - `raw`        (all raw database model strings)
 *
 * 2. Vetted, period-correct factory emblems & fender badges (`VehicleIdentityMark`):
 *    - Never mixes a modern 2000s 3D gold bowtie onto a 1955 3100 or a 1973 C10.
 *    - Enforces year-exact Squarebody Chevrolet (1973–1974 Custom Deluxe / Cheyenne / Cheyenne Super 10-20-30 vs 1975–1980 Round-Nose Custom Deluxe / Scottsdale / Cheyenne / Silverado vs 1981–1987 Slant-Nose Brushed Aluminum) and GMC (1973–1974 two-digit Sierra 15/25/35 vs 1975–1987 four-digit Sierra / Sierra Grande / High Sierra / Sierra Classic 1500/2500/3500) fender badges.
 */

export type FamilyFacetAxis = 'raw' | 'series' | 'trim' | 'body';

export interface VehicleFacetClassification {
  series: string | null;
  trim: string | null;
  body: string | null;
}

export interface VehicleIdentityMark {
  id: string;
  brand: string;
  family?: string | null;
  seriesCode?: string | null;
  trimPackage?: string | null;
  bodyStyle?: string | null;
  yearStart: number;
  yearEnd: number;
  markKind: 'marque_emblem' | 'series_badge' | 'trim_badge' | 'model_wordmark' | 'body_silhouette';
  displayLabel: string;
  subLabel: string;
  rpoCode?: string;
  fenderPlacement?: string;
  svgMarkup: string;
  provenanceNote: string;
}

/** Vetted, period-exact vector identity marks mirroring `public.vehicle_identity_marks`. */
export const VETTED_IDENTITY_MARKS: readonly VehicleIdentityMark[] = [
  // ── Chevrolet Era Bowties ──────────────────────────────────────────────────
  {
    id: 'chevy-bowtie-1914-1959',
    brand: 'Chevrolet',
    yearStart: 1914,
    yearEnd: 1959,
    markKind: 'marque_emblem',
    displayLabel: 'CHEVROLET (1914–1959)',
    subLabel: 'Porcelain Blue Keystone Serif Bowtie',
    fenderPlacement: 'Hood Crest',
    svgMarkup:
      '<svg viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg"><polygon points="44,4 76,4 76,12 114,12 108,28 76,28 76,36 44,36 44,28 6,28 12,12 44,12" fill="#1b365d" stroke="#d8dde6" stroke-width="2.2"/><text x="60" y="23" text-anchor="middle" fill="#f5f5f0" font-family="Georgia,serif" font-size="9.5" font-weight="700" letter-spacing="1.8">CHEVROLET</text></svg>',
    provenanceNote: 'Vintage dark-blue porcelain bowtie with serif lettering (Advance Design 3100, Task Force, Tri-Five Bel Air).',
  },
  {
    id: 'chevy-bowtie-1960-1972',
    brand: 'Chevrolet',
    yearStart: 1960,
    yearEnd: 1972,
    markKind: 'marque_emblem',
    displayLabel: 'CHEVROLET (1960–1972)',
    subLabel: 'Action Line / Muscle Era Chrome-Bezel Bowtie',
    fenderPlacement: 'Grille / Header Panel',
    svgMarkup:
      '<svg viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg"><polygon points="45,5 75,5 75,13 112,13 106,27 75,27 75,35 45,35 45,27 8,27 14,13 45,13" fill="#0f4c81" stroke="#e2e8f0" stroke-width="2.2"/><polygon points="48,8 72,8 72,15 107,15 102,25 72,25 72,32 48,32 48,25 13,25 18,15 48,15" fill="none" stroke="#e5b842" stroke-width="1"/></svg>',
    provenanceNote: '1960–1972 C/K 1st Gen & Action Line / muscle-era crisp chrome-bordered bowtie.',
  },
  {
    id: 'chevy-bowtie-1973-1987',
    brand: 'Chevrolet',
    yearStart: 1973,
    yearEnd: 1987,
    markKind: 'marque_emblem',
    displayLabel: 'CHEVROLET (1973–1987)',
    subLabel: 'Squarebody Gold Foil Grille Bowtie',
    fenderPlacement: 'Grille Center',
    svgMarkup:
      '<svg viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg"><polygon points="44,5 76,5 76,13 114,13 107,27 76,27 76,35 44,35 44,27 6,27 13,13 44,13" fill="#c8961e" stroke="#e6e8ec" stroke-width="2.2"/><line x1="14" y1="20" x2="106" y2="20" stroke="#785204" stroke-width="1"/></svg>',
    provenanceNote: '1973–1987 Rounded-Line (Squarebody) amber/gold foil grille bowtie with chrome surround.',
  },
  {
    id: 'chevy-bowtie-1988-1999',
    brand: 'Chevrolet',
    yearStart: 1988,
    yearEnd: 1999,
    markKind: 'marque_emblem',
    displayLabel: 'CHEVROLET (1988–1999)',
    subLabel: 'GMT400 OBS Flush Gold/Red Bowtie',
    fenderPlacement: 'Grille Bar',
    svgMarkup:
      '<svg viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg"><polygon points="45,6 75,6 75,14 112,14 105,26 75,26 75,34 45,34 45,26 8,26 15,14 45,14" fill="#b8860b" stroke="#d4d4d8" stroke-width="2"/></svg>',
    provenanceNote: '1988–1999 GMT400 OBS clean flat gold/red bowtie.',
  },
  {
    id: 'chevy-bowtie-2000-2035',
    brand: 'Chevrolet',
    yearStart: 2000,
    yearEnd: 2035,
    markKind: 'marque_emblem',
    displayLabel: 'CHEVROLET (2000+)',
    subLabel: 'Modern Beveled Gold/Chrome Bowtie',
    fenderPlacement: 'Grille',
    svgMarkup:
      '<svg viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg"><polygon points="45,6 75,6 75,13 113,13 105,27 75,27 75,34 45,34 45,27 7,27 15,13 45,13" fill="#d4af37" stroke="#f4f4f5" stroke-width="2.5"/><polygon points="48,9 72,9 72,16 106,16 100,24 72,24 72,31 48,31 48,24 14,24 20,16 48,16" fill="#b5891c"/></svg>',
    provenanceNote: '2000+ modern beveled gold bowtie.',
  },

  // ── Chevrolet Squarebody (1973–1987) Trim & Series Fender Emblems ──────────
  {
    id: 'chevy-custom-deluxe-10-73-80',
    brand: 'Chevrolet',
    family: 'Pickup',
    seriesCode: 'C10',
    trimPackage: 'Custom Deluxe',
    yearStart: 1973,
    yearEnd: 1980,
    markKind: 'trim_badge',
    displayLabel: 'CUSTOM DELUXE 10',
    subLabel: "'73–'80 Stacked Fender Plate",
    rpoCode: 'YF5',
    fenderPlacement: 'Front Fender',
    svgMarkup:
      '<svg viewBox="0 0 190 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="3" width="186" height="34" rx="2" fill="#141416" stroke="#e5e7eb" stroke-width="2.2"/><rect x="138" y="6" width="46" height="28" fill="#b91c1c"/><text x="70" y="17" text-anchor="middle" fill="#f3f4f6" font-family="Arial,sans-serif" font-size="9.5" font-weight="800" letter-spacing="1.8">CUSTOM</text><text x="70" y="30" text-anchor="middle" fill="#f3f4f6" font-family="Arial,sans-serif" font-size="10.5" font-weight="800" letter-spacing="2.2">DELUXE</text><text x="161" y="26" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="18" font-weight="900">10</text></svg>',
    provenanceNote: '1973–1980 Chevrolet Custom Deluxe 10 stacked block fender nameplate.',
  },
  {
    id: 'chevy-scottsdale-10-75-87',
    brand: 'Chevrolet',
    family: 'Pickup',
    seriesCode: 'C10',
    trimPackage: 'Scottsdale',
    yearStart: 1975,
    yearEnd: 1987,
    markKind: 'trim_badge',
    displayLabel: 'SCOTTSDALE 10',
    subLabel: "'75–'87 Fender Plate (RPO YE8)",
    rpoCode: 'YE8',
    fenderPlacement: 'Front Fender',
    svgMarkup:
      '<svg viewBox="0 0 190 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="186" height="30" rx="2" fill="#141416" stroke="#e5e7eb" stroke-width="2.2"/><rect x="142" y="8" width="42" height="24" fill="#b45309"/><text x="72" y="25" text-anchor="middle" fill="#f3f4f6" font-family="Arial,sans-serif" font-size="11.5" font-weight="800" letter-spacing="1.6">SCOTTSDALE</text><text x="163" y="26" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="16" font-weight="900">10</text></svg>',
    provenanceNote: 'Introduced in 1975 (RPO YE8): SCOTTSDALE block capitals in chrome bezel.',
  },
  {
    id: 'chevy-cheyenne-10-73-81',
    brand: 'Chevrolet',
    family: 'Pickup',
    seriesCode: 'C10',
    trimPackage: 'Cheyenne',
    yearStart: 1973,
    yearEnd: 1981,
    markKind: 'trim_badge',
    displayLabel: 'CHEYENNE 10',
    subLabel: "'73–'81 Western Slab Fender Badge (RPO YE9)",
    rpoCode: 'YE9',
    fenderPlacement: 'Front Fender',
    svgMarkup:
      '<svg viewBox="0 0 190 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="186" height="30" rx="2" fill="#18181b" stroke="#e5e7eb" stroke-width="2.2"/><line x1="6" y1="9" x2="136" y2="9" stroke="#facc15" stroke-width="1.2"/><line x1="6" y1="31" x2="136" y2="31" stroke="#facc15" stroke-width="1.2"/><rect x="142" y="8" width="42" height="24" fill="#991b1b"/><text x="72" y="25" text-anchor="middle" fill="#fef08a" font-family="Georgia,serif" font-size="12" font-weight="700" letter-spacing="2">CHEYENNE</text><text x="163" y="26" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="16" font-weight="900">10</text></svg>',
    provenanceNote: '1973–1981 Chevrolet Cheyenne (RPO YE9) western slab-serif fender nameplate.',
  },
  {
    id: 'chevy-cheyenne-super-10-73-74',
    brand: 'Chevrolet',
    family: 'Pickup',
    seriesCode: 'C10',
    trimPackage: 'Cheyenne Super',
    yearStart: 1973,
    yearEnd: 1974,
    markKind: 'trim_badge',
    displayLabel: 'CHEYENNE SUPER 10',
    subLabel: "'73–'74 Exclusive Top Trim (Pre-Silverado)",
    rpoCode: 'YE9+Z84',
    fenderPlacement: 'Front Fender (1973–1974 only)',
    svgMarkup:
      '<svg viewBox="0 0 210 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="3" width="206" height="34" rx="2" fill="#18181b" stroke="#e5e7eb" stroke-width="2.2"/><rect x="158" y="6" width="46" height="28" fill="#991b1b"/><text x="80" y="17" text-anchor="middle" fill="#fef08a" font-family="Georgia,serif" font-size="10.5" font-weight="700" letter-spacing="2">CHEYENNE</text><text x="80" y="30" text-anchor="middle" fill="#f87171" font-family="Arial,sans-serif" font-size="9.5" font-weight="900" letter-spacing="3">SUPER</text><text x="181" y="26" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="17" font-weight="900">10</text></svg>',
    provenanceNote: '1973–1974 top-trim Squarebody badge; Silverado did not become a C/K truck trim until 1975.',
  },
  {
    id: 'chevy-silverado-10-75-80',
    brand: 'Chevrolet',
    family: 'Pickup',
    seriesCode: 'C10',
    trimPackage: 'Silverado',
    yearStart: 1975,
    yearEnd: 1980,
    markKind: 'trim_badge',
    displayLabel: 'SILVERADO 10',
    subLabel: "'75–'80 Round-Nose Fender Script Plate (RPO Z84)",
    rpoCode: 'Z84',
    fenderPlacement: 'Front Fender',
    svgMarkup:
      '<svg viewBox="0 0 200 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="196" height="30" rx="2" fill="#111113" stroke="#e5e7eb" stroke-width="2.2"/><rect x="150" y="8" width="44" height="24" fill="#991b1b"/><text x="76" y="25" text-anchor="middle" fill="#f9fafb" font-family="Georgia,serif" font-style="italic" font-size="13.5" font-weight="700" letter-spacing="1.2">Silverado</text><text x="172" y="26" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="16" font-weight="900">10</text></svg>',
    provenanceNote: '1975–1980 Round-Eye Squarebody Silverado 10 script fender nameplate (RPO Z84).',
  },
  {
    id: 'chevy-silverado-10-81-87',
    brand: 'Chevrolet',
    family: 'Pickup',
    seriesCode: 'C10',
    trimPackage: 'Silverado',
    yearStart: 1981,
    yearEnd: 1987,
    markKind: 'trim_badge',
    displayLabel: 'SILVERADO 10',
    subLabel: "'81–'87 Slant-Nose Brushed Aluminum Badge (RPO Z84)",
    rpoCode: 'Z84',
    fenderPlacement: 'Front Fender / Cab Pillar',
    svgMarkup:
      '<svg viewBox="0 0 200 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="196" height="30" rx="1" fill="#e5e7eb" stroke="#1f2937" stroke-width="2"/><rect x="6" y="9" width="142" height="22" fill="#111827"/><rect x="150" y="9" width="44" height="22" fill="#b91c1c"/><text x="77" y="24" text-anchor="middle" fill="#f9fafb" font-family="Arial,sans-serif" font-size="11" font-weight="800" letter-spacing="2.4">SILVERADO</text><text x="172" y="25" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="15" font-weight="900">10</text></svg>',
    provenanceNote: '1981–1987 aero-nose facelift Squarebody Silverado 10 wide sans-serif brushed-aluminum plate.',
  },

  // ── GMC Squarebody (1973–1987) Early '73–'74 vs '75–'87 Fender Emblems ─────
  {
    id: 'gmc-sierra-15-73-74',
    brand: 'GMC',
    family: 'Pickup',
    seriesCode: 'C1500',
    trimPackage: 'Sierra',
    yearStart: 1973,
    yearEnd: 1974,
    markKind: 'trim_badge',
    displayLabel: 'SIERRA 15',
    subLabel: "'73–'74 Early Two-Digit 15/25/35 Fender Plate",
    rpoCode: 'YE9',
    fenderPlacement: 'Front Fender (1973–1974 only)',
    svgMarkup:
      '<svg viewBox="0 0 190 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="186" height="30" rx="2" fill="#18181b" stroke="#e5e7eb" stroke-width="2.2"/><rect x="140" y="8" width="44" height="24" fill="#dc2626"/><text x="70" y="25" text-anchor="middle" fill="#fef08a" font-family="Georgia,serif" font-size="13" font-weight="700" letter-spacing="2.5">SIERRA</text><text x="162" y="26" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="16" font-weight="900">15</text></svg>',
    provenanceNote: '1973–1974 GMC Squarebody pickups used two-digit 15/25/35 fender emblems before 1500/2500/3500 arrived in 1975.',
  },
  {
    id: 'gmc-sierra-grande-1500-75-87',
    brand: 'GMC',
    family: 'Pickup',
    seriesCode: 'C1500',
    trimPackage: 'Sierra Grande',
    yearStart: 1975,
    yearEnd: 1987,
    markKind: 'trim_badge',
    displayLabel: 'SIERRA GRANDE 1500',
    subLabel: "'75–'87 Four-Digit 1500/2500/3500 Fender Plate",
    rpoCode: 'Z62',
    fenderPlacement: 'Front Fender',
    svgMarkup:
      '<svg viewBox="0 0 215 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="3" width="211" height="34" rx="2" fill="#18181b" stroke="#e5e7eb" stroke-width="2.2"/><rect x="148" y="6" width="61" height="28" fill="#dc2626"/><text x="75" y="17" text-anchor="middle" fill="#f3f4f6" font-family="Arial,sans-serif" font-size="10.5" font-weight="800" letter-spacing="2">SIERRA</text><text x="75" y="30" text-anchor="middle" fill="#facc15" font-family="Arial,sans-serif" font-size="9.5" font-weight="800" letter-spacing="2.2">GRANDE</text><text x="178" y="25" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="14.5" font-weight="900">1500</text></svg>',
    provenanceNote: '1975–1987 GMC Sierra Grande 1500 stacked fender badge.',
  },
  {
    id: 'gmc-high-sierra-1500-75-87',
    brand: 'GMC',
    family: 'Pickup',
    seriesCode: 'C1500',
    trimPackage: 'High Sierra',
    yearStart: 1975,
    yearEnd: 1987,
    markKind: 'trim_badge',
    displayLabel: 'HIGH SIERRA 1500',
    subLabel: "'75–'87 High Sierra Fender Plate",
    rpoCode: 'Z84',
    fenderPlacement: 'Front Fender',
    svgMarkup:
      '<svg viewBox="0 0 215 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="3" width="211" height="34" rx="2" fill="#18181b" stroke="#e5e7eb" stroke-width="2.2"/><rect x="148" y="6" width="61" height="28" fill="#b91c1c"/><text x="75" y="17" text-anchor="middle" fill="#facc15" font-family="Arial,sans-serif" font-size="9.5" font-weight="800" letter-spacing="2.4">HIGH</text><text x="75" y="30" text-anchor="middle" fill="#f3f4f6" font-family="Arial,sans-serif" font-size="11" font-weight="800" letter-spacing="2">SIERRA</text><text x="178" y="25" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="14.5" font-weight="900">1500</text></svg>',
    provenanceNote: '1975–1987 GMC High Sierra 1500 fender badge.',
  },

  // ── Corvette Generation Scripts ────────────────────────────────────────────
  {
    id: 'corvette-c2-sting-ray-63-67',
    brand: 'Chevrolet',
    family: 'Corvette',
    yearStart: 1963,
    yearEnd: 1967,
    markKind: 'model_wordmark',
    displayLabel: 'STING RAY (C2)',
    subLabel: "1963–1967 Two-Word 'Sting Ray' Chrome Script",
    fenderPlacement: 'Rear Deck & Fender',
    svgMarkup:
      '<svg viewBox="0 0 185 40" xmlns="http://www.w3.org/2000/svg"><path d="M10 28 L24 10 L38 28 Z" fill="none" stroke="#e5e7eb" stroke-width="2"/><path d="M16 22 L32 22" stroke="#ef4444" stroke-width="2"/><text x="112" y="25" text-anchor="middle" fill="#f9fafb" font-family="Georgia,serif" font-style="italic" font-size="14.5" font-weight="700" letter-spacing="1.4">Sting Ray</text></svg>',
    provenanceNote: '1963–1967 C2 Corvette exclusive two-word Sting Ray script.',
  },
  {
    id: 'corvette-c3-stingray-68-82',
    brand: 'Chevrolet',
    family: 'Corvette',
    yearStart: 1968,
    yearEnd: 1982,
    markKind: 'model_wordmark',
    displayLabel: 'STINGRAY (C3)',
    subLabel: "1968–1982 One-Word Connected 'Stingray' Script",
    fenderPlacement: 'Front Fender above Louvers',
    svgMarkup:
      '<svg viewBox="0 0 185 40" xmlns="http://www.w3.org/2000/svg"><path d="M8 26 L22 10 L36 26" fill="none" stroke="#e5e7eb" stroke-width="2"/><text x="112" y="25" text-anchor="middle" fill="#f9fafb" font-family="Georgia,serif" font-style="italic" font-size="15" font-weight="700" letter-spacing="1">Stingray</text></svg>',
    provenanceNote: '1968–1982 C3 Mako-shark one-word Stingray script.',
  },

  // ── Ford Mustang Era & Body Marks ──────────────────────────────────────────
  {
    id: 'mustang-tribar-64-73',
    brand: 'Ford',
    family: 'Mustang',
    yearStart: 1964,
    yearEnd: 1973,
    markKind: 'model_wordmark',
    displayLabel: 'MUSTANG',
    subLabel: '1964½–1973 Running Pony Tri-Bar Crest',
    fenderPlacement: 'Front Fender & Grille Corral',
    svgMarkup:
      '<svg viewBox="0 0 185 40" xmlns="http://www.w3.org/2000/svg"><rect x="12" y="5" width="6" height="30" fill="#dc2626"/><rect x="18" y="5" width="6" height="30" fill="#f9fafb"/><rect x="24" y="5" width="6" height="30" fill="#1d4ed8"/><rect x="7" y="9" width="28" height="22" fill="none" stroke="#e5e7eb" stroke-width="1.8"/><text x="112" y="25" text-anchor="middle" fill="#f9fafb" font-family="Georgia,serif" font-size="13" font-weight="800" letter-spacing="2.6">MUSTANG</text></svg>',
    provenanceNote: '1st Gen Ford Mustang Red/White/Blue tri-bar crest and serif block fender script.',
  },
  {
    id: 'mustang-body-fastback',
    brand: 'Ford',
    family: 'Mustang',
    bodyStyle: 'Fastback',
    yearStart: 1965,
    yearEnd: 2035,
    markKind: 'body_silhouette',
    displayLabel: '2+2 / SPORTSROOF FASTBACK',
    subLabel: 'Body Code 63 Swept Roofline',
    rpoCode: 'Body 63',
    svgMarkup:
      '<svg viewBox="0 0 185 40" xmlns="http://www.w3.org/2000/svg"><path d="M8 28 L24 28 L42 12 L78 12 L108 26 L116 28" fill="none" stroke="#f9fafb" stroke-width="2.2"/><text x="150" y="24" text-anchor="middle" fill="#f87171" font-family="Arial,sans-serif" font-size="10" font-weight="800" letter-spacing="1.2">FASTBACK</text></svg>',
    provenanceNote: 'Mustang 2+2 / SportsRoof Fastback (Body 63) roofline silhouette.',
  },
  {
    id: 'mustang-body-convertible',
    brand: 'Ford',
    family: 'Mustang',
    bodyStyle: 'Convertible',
    yearStart: 1964,
    yearEnd: 2035,
    markKind: 'body_silhouette',
    displayLabel: 'CONVERTIBLE',
    subLabel: 'Body Code 76 Open Drophead',
    rpoCode: 'Body 76',
    svgMarkup:
      '<svg viewBox="0 0 185 40" xmlns="http://www.w3.org/2000/svg"><path d="M8 28 L38 28 L48 14 L56 28 L112 28" fill="none" stroke="#f9fafb" stroke-width="2.2"/><text x="150" y="24" text-anchor="middle" fill="#38bdf8" font-family="Arial,sans-serif" font-size="9.5" font-weight="800" letter-spacing="1">CONVERTIBLE</text></svg>',
    provenanceNote: 'Mustang Convertible (Body 76) open-top silhouette.',
  },
  {
    id: 'mustang-body-coupe',
    brand: 'Ford',
    family: 'Mustang',
    bodyStyle: 'Coupe',
    yearStart: 1964,
    yearEnd: 2035,
    markKind: 'body_silhouette',
    displayLabel: 'HARDTOP COUPE',
    subLabel: 'Body Code 65 Notchback Roofline',
    rpoCode: 'Body 65',
    svgMarkup:
      '<svg viewBox="0 0 185 40" xmlns="http://www.w3.org/2000/svg"><path d="M8 28 L32 28 L44 13 L80 13 L90 26 L112 28" fill="none" stroke="#f9fafb" stroke-width="2.2"/><text x="150" y="24" text-anchor="middle" fill="#a3e635" font-family="Arial,sans-serif" font-size="10.5" font-weight="800" letter-spacing="1.4">COUPE</text></svg>',
    provenanceNote: 'Mustang Notchback Hardtop Coupe (Body 65) formal roofline silhouette.',
  },
  // ── Chevrolet Advance Design, Task Force, Action Line & Muscle Trucks ──────
  {
    id: 'chevy-3100-47-55',
    brand: 'Chevrolet',
    family: 'Pickup',
    seriesCode: '3100',
    yearStart: 1947,
    yearEnd: 1955,
    markKind: 'series_badge',
    displayLabel: 'CHEVROLET 3100',
    subLabel: "'47–'55 Advance Design Hood Side Emblem",
    fenderPlacement: 'Hood Side',
    svgMarkup:
      '<svg viewBox="0 0 190 40" xmlns="http://www.w3.org/2000/svg"><polygon points="6,8 184,8 174,32 16,32" fill="#1b365d" stroke="#e5e7eb" stroke-width="2.2"/><text x="95" y="25" text-anchor="middle" fill="#f9fafb" font-family="Georgia,serif" font-size="13" font-weight="800" letter-spacing="2.2">CHEVROLET 3100</text></svg>',
    provenanceNote: '1947–1955 Advance Design 1/2-ton 3100 hood side badge.',
  },
  {
    id: 'chevy-apache-58-61',
    brand: 'Chevrolet',
    family: 'Pickup',
    seriesCode: 'Apache',
    yearStart: 1958,
    yearEnd: 1961,
    markKind: 'series_badge',
    displayLabel: 'APACHE 10 / 31',
    subLabel: "'58–'61 Task Force Apache Fender Crest",
    fenderPlacement: 'Front Fender',
    svgMarkup:
      '<svg viewBox="0 0 190 40" xmlns="http://www.w3.org/2000/svg"><polygon points="10,6 180,6 170,34 20,34" fill="#18181b" stroke="#e5e7eb" stroke-width="2.2"/><text x="95" y="25" text-anchor="middle" fill="#facc15" font-family="Georgia,serif" font-size="13.5" font-weight="800" letter-spacing="2.8">APACHE</text></svg>',
    provenanceNote: '1958–1961 Chevrolet Apache light-duty pickup fender crest.',
  },
  {
    id: 'chevy-cameo-55-58',
    brand: 'Chevrolet',
    family: 'Pickup',
    seriesCode: 'Cameo',
    yearStart: 1955,
    yearEnd: 1958,
    markKind: 'series_badge',
    displayLabel: 'CAMEO CARRIER',
    subLabel: "'55–'58 Model 3124 Fiberglass Bedside Script",
    rpoCode: 'Model 3124',
    fenderPlacement: 'Front Fender',
    svgMarkup:
      '<svg viewBox="0 0 190 40" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="6" width="182" height="28" rx="3" fill="#7f1d1d" stroke="#e5e7eb" stroke-width="2"/><text x="95" y="25" text-anchor="middle" fill="#f9fafb" font-family="Georgia,serif" font-style="italic" font-size="14" font-weight="700" letter-spacing="1.5">Cameo Carrier</text></svg>',
    provenanceNote: '1955–1958 Chevrolet 3124 Cameo Carrier luxury pickup script.',
  },
  {
    id: 'chevy-cst-10-67-72',
    brand: 'Chevrolet',
    family: 'Pickup',
    seriesCode: 'C10',
    trimPackage: 'CST (Custom Sport Truck)',
    yearStart: 1967,
    yearEnd: 1972,
    markKind: 'trim_badge',
    displayLabel: 'CST / 10',
    subLabel: "'67–'72 Action Line Custom Sport Truck Plate",
    rpoCode: 'Z84',
    fenderPlacement: 'Lower Front Fender',
    svgMarkup:
      '<svg viewBox="0 0 190 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="186" height="30" rx="2" fill="#111827" stroke="#e5e7eb" stroke-width="2.2"/><rect x="132" y="8" width="52" height="24" fill="#991b1b"/><text x="67" y="25" text-anchor="middle" fill="#facc15" font-family="Georgia,serif" font-size="14" font-weight="800" letter-spacing="3">C S T</text><text x="158" y="26" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="16" font-weight="900">10</text></svg>',
    provenanceNote: '1967–1972 Action Line CST (Custom Sport Truck) lower fender badge.',
  },
  {
    id: 'chevy-big-10-75-80',
    brand: 'Chevrolet',
    family: 'Pickup',
    seriesCode: 'C10',
    trimPackage: 'Big 10',
    yearStart: 1975,
    yearEnd: 1980,
    markKind: 'trim_badge',
    displayLabel: 'BIG 10',
    subLabel: "'75–'80 Heavy-Duty F44 Bedside Callout",
    rpoCode: 'F44',
    fenderPlacement: 'Upper Bedside',
    svgMarkup:
      '<svg viewBox="0 0 190 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="186" height="30" rx="2" fill="#18181b" stroke="#f97316" stroke-width="2.5"/><text x="95" y="27" text-anchor="middle" fill="#facc15" font-family="Arial Black,Impact,sans-serif" font-size="17" font-weight="900" letter-spacing="3.5">BIG 10</text></svg>',
    provenanceNote: '1975–1980 Chevrolet C10 RPO F44 Big 10 callout.',
  },
  {
    id: 'chevy-454-ss-90-93',
    brand: 'Chevrolet',
    family: 'Pickup',
    seriesCode: 'C1500',
    trimPackage: '454 SS',
    yearStart: 1990,
    yearEnd: 1993,
    markKind: 'trim_badge',
    displayLabel: '454 SS',
    subLabel: "'90–'93 GMT400 Muscle Truck Decal (RPO B4U)",
    rpoCode: 'B4U',
    fenderPlacement: 'Rear Bedside',
    svgMarkup:
      '<svg viewBox="0 0 190 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="186" height="30" rx="2" fill="#09090b" stroke="#dc2626" stroke-width="2.2"/><text x="95" y="27" text-anchor="middle" fill="#ef4444" font-family="Arial Black,Impact,sans-serif" font-size="17" font-weight="900" letter-spacing="3">454 SS</text></svg>',
    provenanceNote: '1990–1993 Chevrolet C1500 454 SS big-block sport pickup callout.',
  },
  // ── GMC Early '73–'74 Custom / Super Custom vs '75–'87 Sierra Classic ──────
  {
    id: 'gmc-super-custom-15-73-74',
    brand: 'GMC',
    family: 'Pickup',
    seriesCode: 'C1500',
    trimPackage: 'Super Custom',
    yearStart: 1973,
    yearEnd: 1974,
    markKind: 'trim_badge',
    displayLabel: 'SUPER CUSTOM 15',
    subLabel: "'73–'74 Early Two-Digit Super Custom Plate",
    fenderPlacement: 'Front Fender (1973–1974 only)',
    svgMarkup:
      '<svg viewBox="0 0 205 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="3" width="201" height="34" rx="2" fill="#18181b" stroke="#e5e7eb" stroke-width="2.2"/><rect x="152" y="6" width="47" height="28" fill="#dc2626"/><text x="76" y="17" text-anchor="middle" fill="#facc15" font-family="Arial,sans-serif" font-size="9.5" font-weight="800" letter-spacing="2.5">SUPER</text><text x="76" y="30" text-anchor="middle" fill="#f3f4f6" font-family="Arial,sans-serif" font-size="11" font-weight="800" letter-spacing="2">CUSTOM</text><text x="175" y="26" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="16" font-weight="900">15</text></svg>',
    provenanceNote: '1973–1974 GMC Super Custom 15 two-digit fender plate.',
  },
  {
    id: 'gmc-sierra-classic-1500-75-87',
    brand: 'GMC',
    family: 'Pickup',
    seriesCode: 'C1500',
    trimPackage: 'Sierra Classic',
    yearStart: 1975,
    yearEnd: 1987,
    markKind: 'trim_badge',
    displayLabel: 'SIERRA CLASSIC 1500',
    subLabel: "'75–'87 Top-Tier Luxury Trim Plate (Silverado Equiv.)",
    rpoCode: 'YE9',
    fenderPlacement: 'Front Fender',
    svgMarkup:
      '<svg viewBox="0 0 215 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="3" width="211" height="34" rx="2" fill="#18181b" stroke="#e5e7eb" stroke-width="2.2"/><rect x="148" y="6" width="61" height="28" fill="#991b1b"/><text x="75" y="17" text-anchor="middle" fill="#f3f4f6" font-family="Arial,sans-serif" font-size="10.5" font-weight="800" letter-spacing="2.2">SIERRA</text><text x="75" y="30" text-anchor="middle" fill="#facc15" font-family="Georgia,serif" font-style="italic" font-size="11.5" font-weight="700" letter-spacing="1.2">Classic</text><text x="178" y="25" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="14.5" font-weight="900">1500</text></svg>',
    provenanceNote: '1975–1987 GMC Sierra Classic 1500 top-of-the-line fender plate.',
  },
  // ── Bel Air, Chevelle, Camaro, Mustang Boss/Mach 1/Shelby, Bronco, 911 ─────
  {
    id: 'chevy-bel-air-55-57',
    brand: 'Chevrolet',
    family: 'Bel Air',
    yearStart: 1955,
    yearEnd: 1957,
    markKind: 'model_wordmark',
    displayLabel: 'BEL AIR (TRI-FIVE)',
    subLabel: "'55–'57 Gold Anodized Quarter Script & V-Crest",
    fenderPlacement: 'Quarter Panel & Hood',
    svgMarkup:
      '<svg viewBox="0 0 190 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="186" height="30" rx="2" fill="#18181b" stroke="#d4af37" stroke-width="2"/><path d="M14 14 L26 28 L38 14" fill="none" stroke="#d4af37" stroke-width="2.5"/><text x="112" y="26" text-anchor="middle" fill="#facc15" font-family="Georgia,serif" font-style="italic" font-size="16" font-weight="700" letter-spacing="1.2">Bel Air</text></svg>',
    provenanceNote: '1955–1957 Tri-Five Bel Air gold script and V-emblem.',
  },
  {
    id: 'chevy-chevelle-ss-65-72',
    brand: 'Chevrolet',
    family: 'Chevelle',
    trimPackage: 'SS (Super Sport)',
    yearStart: 1965,
    yearEnd: 1972,
    markKind: 'trim_badge',
    displayLabel: 'SS 396 · 454',
    subLabel: "'65–'72 Chevelle Super Sport Grille & Fender Badge",
    rpoCode: 'Z15',
    fenderPlacement: 'Grille & Fender',
    svgMarkup:
      '<svg viewBox="0 0 190 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="186" height="30" rx="2" fill="#111827" stroke="#e5e7eb" stroke-width="2.2"/><rect x="14" y="9" width="56" height="22" rx="2" fill="#b91c1c" stroke="#f9fafb" stroke-width="1.5"/><text x="42" y="25" text-anchor="middle" fill="#ffffff" font-family="Arial Black,sans-serif" font-size="14" font-weight="900" letter-spacing="1.5">SS</text><text x="128" y="25" text-anchor="middle" fill="#f9fafb" font-family="Arial,sans-serif" font-size="12.5" font-weight="800" letter-spacing="2">396 · 454</text></svg>',
    provenanceNote: '1965–1972 Chevrolet Chevelle Super Sport (SS 396 / SS 454) badge.',
  },
  {
    id: 'chevy-camaro-z28-67-81',
    brand: 'Chevrolet',
    family: 'Camaro',
    trimPackage: 'Z/28',
    yearStart: 1967,
    yearEnd: 1981,
    markKind: 'trim_badge',
    displayLabel: 'CAMARO Z/28',
    subLabel: "'67–'81 RPO Z28 Trans-Am Homologation Emblem",
    rpoCode: 'Z28',
    fenderPlacement: 'Grille & Front Fender',
    svgMarkup:
      '<svg viewBox="0 0 185 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="181" height="30" rx="2" fill="#111827" stroke="#e5e7eb" stroke-width="2.2"/><text x="92" y="27" text-anchor="middle" fill="#ef4444" stroke="#f9fafb" stroke-width="0.8" font-family="Arial Black,Impact,sans-serif" font-size="19" font-weight="900" letter-spacing="2.5">Z/28</text></svg>',
    provenanceNote: 'Factory Chevrolet Camaro RPO Z28 emblem.',
  },
  {
    id: 'mustang-boss-69-70',
    brand: 'Ford',
    family: 'Mustang',
    seriesCode: 'Boss 302',
    yearStart: 1969,
    yearEnd: 1970,
    markKind: 'series_badge',
    displayLabel: 'BOSS 302 · 429',
    subLabel: "'69–'70 Shinoda C-Stripe & Kar-Kraft Hemi Callout",
    fenderPlacement: 'Front Fender',
    svgMarkup:
      '<svg viewBox="0 0 190 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="186" height="30" rx="2" fill="#111827" stroke="#facc15" stroke-width="2"/><text x="95" y="26" text-anchor="middle" fill="#facc15" font-family="Georgia,serif" font-size="14" font-weight="900" letter-spacing="2.8">BOSS 302·429</text></svg>',
    provenanceNote: '1969–1970 Ford Mustang Boss 302 & Boss 429 callout.',
  },
  {
    id: 'mustang-mach-1-69-73',
    brand: 'Ford',
    family: 'Mustang',
    seriesCode: 'Mach 1',
    yearStart: 1969,
    yearEnd: 1973,
    markKind: 'series_badge',
    displayLabel: 'MACH 1',
    subLabel: "'69–'73 Body 63C SportsRoof Stencil Callout",
    rpoCode: 'Body 63C',
    fenderPlacement: 'Rocker & Decklid',
    svgMarkup:
      '<svg viewBox="0 0 185 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="181" height="30" rx="2" fill="#18181b" stroke="#dc2626" stroke-width="2"/><text x="92" y="26" text-anchor="middle" fill="#f87171" font-family="Arial Black,sans-serif" font-size="16" font-weight="900" letter-spacing="3.5">MACH 1</text></svg>',
    provenanceNote: '1969–1973 Ford Mustang Mach 1 SportsRoof badge.',
  },
  {
    id: 'porsche-911-targa',
    brand: 'Porsche',
    family: '911',
    bodyStyle: 'Targa',
    yearStart: 1967,
    yearEnd: 2035,
    markKind: 'body_silhouette',
    displayLabel: '911 TARGA',
    subLabel: 'Brushed Stainless Roll-Bar Hoop & Gold Targa Script',
    fenderPlacement: 'B-Pillar Roll Hoop',
    svgMarkup:
      '<svg viewBox="0 0 185 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="181" height="30" rx="2" fill="#18181b" stroke="#d4af37" stroke-width="2"/><path d="M18 28 L24 12 L34 12 L38 28" fill="#d4d4d8"/><text x="108" y="26" text-anchor="middle" fill="#facc15" font-family="Georgia,serif" font-style="italic" font-size="16" font-weight="700" letter-spacing="1.5">targa</text></svg>',
    provenanceNote: 'Porsche 911 Targa B-pillar safety hoop and script.',
  },
  // ── Dodge / Mopar Power Wagon, Challenger, Charger & Hemi Marks ────────────
  {
    id: 'dodge-power-wagon-46-80',
    brand: 'Dodge',
    family: 'Pickup',
    seriesCode: 'Power Wagon',
    yearStart: 1946,
    yearEnd: 1980,
    markKind: 'series_badge',
    displayLabel: 'POWER WAGON',
    subLabel: 'Stamped Cowl & Fender 4x4 Nameplate',
    fenderPlacement: 'Hood Side / Front Fender',
    svgMarkup:
      '<svg viewBox="0 0 205 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="201" height="30" rx="2" fill="#18181b" stroke="#e5e7eb" stroke-width="2.2"/><rect x="8" y="9" width="38" height="22" fill="#b91c1c"/><text x="27" y="24" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="10" font-weight="900">WM300</text><text x="124" y="25" text-anchor="middle" fill="#f9fafb" font-family="Arial Black,sans-serif" font-size="12.5" font-weight="900" letter-spacing="2">POWER WAGON</text></svg>',
    provenanceNote: 'Dodge Power Wagon (WM300 & W100/W200) heavy-duty 4x4 cowl/fender nameplate.',
  },
  {
    id: 'dodge-rt-68-71',
    brand: 'Dodge',
    trimPackage: 'R/T (Road/Track)',
    yearStart: 1967,
    yearEnd: 1974,
    markKind: 'trim_badge',
    displayLabel: 'R/T · 440 · HEMI',
    subLabel: '1967–1971 Scat Pack Road/Track Grille & Quarter Emblem',
    rpoCode: 'WS23/XS29',
    fenderPlacement: 'Grille & Rear Quarter',
    svgMarkup:
      '<svg viewBox="0 0 185 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="181" height="30" rx="2" fill="#18181b" stroke="#e5e7eb" stroke-width="2.2"/><text x="52" y="28" text-anchor="middle" fill="#ef4444" stroke="#f9fafb" stroke-width="0.8" font-family="Arial Black,Impact,sans-serif" font-size="20" font-weight="900" letter-spacing="1.5">R/T</text><text x="132" y="25" text-anchor="middle" fill="#facc15" font-family="Arial,sans-serif" font-size="11.5" font-weight="800" letter-spacing="1.8">426 HEMI</text></svg>',
    provenanceNote: 'Dodge Charger & Challenger R/T (Road/Track) Scat Pack emblem.',
  },
  // ── BMW Motorsport (M) & Mercedes-Benz SL Gullwing/Pagoda & Ferrari ────────
  {
    id: 'bmw-m-tri-stripe-78-2035',
    brand: 'BMW',
    trimPackage: 'M-Power',
    yearStart: 1978,
    yearEnd: 2035,
    markKind: 'trim_badge',
    displayLabel: '///M MOTORSPORT',
    subLabel: 'Bavarian Motorsport Tri-Color Grille & Decklid Badge',
    fenderPlacement: 'Kidney Grille & Rear Decklid',
    svgMarkup:
      '<svg viewBox="0 0 185 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="181" height="30" rx="2" fill="#111827" stroke="#e5e7eb" stroke-width="2"/><polygon points="18,32 30,8 40,8 28,32" fill="#38bdf8"/><polygon points="28,32 40,8 50,8 38,32" fill="#1e3a8a"/><polygon points="38,32 50,8 60,8 48,32" fill="#ef4444"/><text x="118" y="27" text-anchor="middle" fill="#f9fafb" font-family="Arial Black,sans-serif" font-size="17" font-weight="900" letter-spacing="2">M3 · M5</text></svg>',
    provenanceNote: 'BMW Motorsport GmbH tri-color slanted M badge (E30 M3, E28/E39 M5, E46, E92, F80).',
  },
  {
    id: 'mercedes-300sl-gullwing-54-63',
    brand: 'Mercedes-Benz',
    family: 'SL',
    seriesCode: '300SL',
    yearStart: 1954,
    yearEnd: 1963,
    markKind: 'series_badge',
    displayLabel: '300 SL (W198)',
    subLabel: '1954–1963 W198 Gullwing Coupe & Roadster Decklid Script',
    rpoCode: 'W198',
    fenderPlacement: 'Rear Decklid',
    svgMarkup:
      '<svg viewBox="0 0 185 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="181" height="30" rx="2" fill="#111827" stroke="#e5e7eb" stroke-width="2"/><circle cx="26" cy="20" r="11" fill="none" stroke="#e5e7eb" stroke-width="1.8"/><path d="M26 9 L26 20 M26 20 L17 26 M26 20 L35 26" stroke="#e5e7eb" stroke-width="1.8"/><text x="114" y="26" text-anchor="middle" fill="#f9fafb" font-family="Georgia,serif" font-style="italic" font-size="16" font-weight="700" letter-spacing="2">300 SL</text></svg>',
    provenanceNote: '1954–1963 Mercedes-Benz W198 300 SL Gullwing & Roadster chrome decklid script.',
  },
  {
    id: 'ferrari-scuderia-shield',
    brand: 'Ferrari',
    yearStart: 1947,
    yearEnd: 2035,
    markKind: 'marque_emblem',
    displayLabel: 'SCUDERIA FERRARI',
    subLabel: 'Modena Giallo Fender Shield & Cavallino Rampante',
    fenderPlacement: 'Front Fender Scuderia Shield',
    svgMarkup:
      '<svg viewBox="0 0 185 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="181" height="30" rx="2" fill="#991b1b" stroke="#facc15" stroke-width="2"/><path d="M16 7 L38 7 L36 25 Q27 34 27 35 Q27 34 18 25 Z" fill="#facc15" stroke="#111" stroke-width="1.2"/><text x="27" y="29" text-anchor="middle" fill="#111" font-family="Georgia,serif" font-size="7" font-weight="900">S F</text><text x="114" y="26" text-anchor="middle" fill="#fef08a" font-family="Georgia,serif" font-size="14" font-weight="800" letter-spacing="2.8">FERRARI</text></svg>',
    provenanceNote: 'Scuderia Ferrari Modena yellow fender shield and Pininfarina/Maranello wordmark.',
  },
  {
    id: 'toyota-land-cruiser-fj40-60-84',
    brand: 'Toyota',
    family: 'Land Cruiser',
    seriesCode: 'FJ40',
    yearStart: 1960,
    yearEnd: 1984,
    markKind: 'series_badge',
    displayLabel: 'TOYOTA LAND CRUISER · FJ40',
    subLabel: '1960–1984 J40 4WD Front Apron & Rear Quarter Emblem',
    rpoCode: 'FJ40 / FJ43 / FJ45',
    fenderPlacement: 'Upper Front Apron & Rear Quarter',
    svgMarkup:
      '<svg viewBox="0 0 190 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="186" height="30" rx="2" fill="#18181b" stroke="#e5e7eb" stroke-width="2.2"/><rect x="132" y="8" width="52" height="24" fill="#b91c1c"/><text x="68" y="19" text-anchor="middle" fill="#facc15" font-family="Arial Black,sans-serif" font-size="9" font-weight="900" letter-spacing="2">TOYOTA</text><text x="68" y="30" text-anchor="middle" fill="#f9fafb" font-family="Arial,sans-serif" font-size="8.5" font-weight="800" letter-spacing="1.2">LAND CRUISER</text><text x="158" y="25" text-anchor="middle" fill="#ffffff" font-family="Arial Black,sans-serif" font-size="12" font-weight="900">4WD</text></svg>',
    provenanceNote: '1960–1984 Toyota J40 (FJ40/FJ43/FJ45/BJ40) cast apron script & red/gold 4WD quarter badge.',
  },
  {
    id: 'porsche-stuttgart-crest',
    brand: 'Porsche',
    yearStart: 1952,
    yearEnd: 2035,
    markKind: 'marque_emblem',
    displayLabel: 'PORSCHE · STUTTGART',
    subLabel: 'Württemberg Gold/Red/Black Hood Crest & Rear Decklid Script',
    fenderPlacement: 'Front Hood Handle & Rear Engine Lid',
    svgMarkup:
      '<svg viewBox="0 0 190 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="186" height="30" rx="2" fill="#111827" stroke="#eab308" stroke-width="2"/><path d="M16 7 L38 7 L36 25 Q27 34 27 35 Q27 34 18 25 Z" fill="#eab308" stroke="#dc2626" stroke-width="1.4"/><text x="112" y="26" text-anchor="middle" fill="#fde047" font-family="Arial,sans-serif" font-size="13.5" font-weight="900" letter-spacing="3.5">PORSCHE</text></svg>',
    provenanceNote: 'Porsche Stuttgart-Zuffenhausen Württemberg crest and spaced rear decklid script.',
  },
  {
    id: 'porsche-911-carrera-rs-73',
    brand: 'Porsche',
    family: '911',
    seriesCode: 'Carrera RS 2.7',
    yearStart: 1972,
    yearEnd: 2035,
    markKind: 'series_badge',
    displayLabel: 'CARRERA RS · GT3',
    subLabel: 'Rennsport Negative Side Script & Ducktail / Wing Callout',
    rpoCode: 'M471 / M472 / GT3',
    fenderPlacement: 'Lower Door Rocker & Engine Grille',
    svgMarkup:
      '<svg viewBox="0 0 190 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="186" height="30" rx="2" fill="#f9fafb" stroke="#dc2626" stroke-width="2.2"/><text x="95" y="26" text-anchor="middle" fill="#dc2626" font-family="Georgia,serif" font-style="italic" font-size="15.5" font-weight="900" letter-spacing="2">Carrera RS</text></svg>',
    provenanceNote: 'Porsche 911 Carrera RS 2.7 / RS America / 964 RS / 993 RS / GT3 RS rocker & decklid script.',
  },
  {
    id: 'chevy-k5-blazer-cheyenne-69-91',
    brand: 'Chevrolet',
    family: 'Blazer',
    seriesCode: 'K5 Blazer',
    yearStart: 1969,
    yearEnd: 1991,
    markKind: 'series_badge',
    displayLabel: 'K/5 BLAZER · CHEYENNE',
    subLabel: "'69–'91 Removable-Top K5 Blazer Front Fender Plate",
    rpoCode: 'K10514 / K10516',
    fenderPlacement: 'Front Fender Behind Wheel Arch',
    svgMarkup:
      '<svg viewBox="0 0 190 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="186" height="30" rx="2" fill="#18181b" stroke="#e5e7eb" stroke-width="2.2"/><rect x="134" y="8" width="50" height="24" fill="#b91c1c"/><text x="68" y="26" text-anchor="middle" fill="#f9fafb" font-family="Arial Black,sans-serif" font-size="14" font-weight="900" letter-spacing="2.2">BLAZER</text><text x="159" y="26" text-anchor="middle" fill="#facc15" font-family="Arial Black,sans-serif" font-size="14" font-weight="900">K/5</text></svg>',
    provenanceNote: '1969–1991 Chevrolet K/5 Blazer CST / Cheyenne / Silverado removable-hardtop fender plate.',
  },
  {
    id: 'pontiac-gto-trans-am-64-81',
    brand: 'Pontiac',
    yearStart: 1964,
    yearEnd: 2002,
    markKind: 'series_badge',
    displayLabel: 'GTO · TRANS AM · JUDGE',
    subLabel: 'PMD Arrowhead, 6.5 Litre / 455 HO Shaker & Screaming Eagle',
    rpoCode: 'W62 / WS6 / WT1',
    fenderPlacement: 'Hood Scoop, Front Fender & Nose Cone',
    svgMarkup:
      '<svg viewBox="0 0 190 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="186" height="30" rx="2" fill="#111827" stroke="#f97316" stroke-width="2.2"/><polygon points="22,7 30,20 22,33 14,20" fill="#dc2626" stroke="#e5e7eb" stroke-width="1.2"/><text x="108" y="26" text-anchor="middle" fill="#fb923c" font-family="Arial Black,Impact,sans-serif" font-size="14.5" font-weight="900" letter-spacing="2.2">GTO · TRANS AM</text></svg>',
    provenanceNote: 'Pontiac Motor Division red arrowhead crest, GTO Judge (WT1), and Firebird Trans Am (WS6) callout.',
  },
  {
    id: 'jaguar-coventry-etype-xk',
    brand: 'Jaguar',
    yearStart: 1948,
    yearEnd: 2035,
    markKind: 'marque_emblem',
    displayLabel: 'JAGUAR · E-TYPE · XK',
    subLabel: 'Coventry Growler Nose Badge & Series 1/2/3 Boot Lid Script',
    fenderPlacement: 'Bonnet Mouth Bar & Rear Boot Lid',
    svgMarkup:
      '<svg viewBox="0 0 190 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="186" height="30" rx="2" fill="#064e3b" stroke="#e5e7eb" stroke-width="2"/><text x="95" y="26" text-anchor="middle" fill="#f9fafb" font-family="Georgia,serif" font-size="14" font-weight="800" letter-spacing="3.2">JAGUAR E-TYPE</text></svg>',
    provenanceNote: 'Jaguar Cars Ltd. Coventry bonnet badge and XK120/140/150 & E-Type Series 1/2/3 script.',
  },
  // ── Wave 3 Era / Series / Trim Vector Marks (viewBox="0 0 120 36") ─────────
  {
    id: 'bronco-1st-gen-script-66-77',
    brand: 'Ford',
    family: 'Bronco',
    seriesCode: 'U15',
    trimPackage: 'Sport',
    yearStart: 1966,
    yearEnd: 1977,
    markKind: 'model_wordmark',
    displayLabel: 'EARLY BRONCO (U13·U14·U15)',
    subLabel: "'66–'77 1st Gen Chrome Fender Script & Bucking Horse",
    rpoCode: 'U13 / U14 / U15',
    fenderPlacement: 'Front Fender Above Side Marker',
    svgMarkup:
      '<svg viewBox="0 0 120 36" xmlns="http://www.w3.org/2000/svg"><rect x="1.5" y="3" width="117" height="30" rx="2" fill="#141619" stroke="#e5e7eb" stroke-width="1.8"/><path d="M12 25 L16 16 L20 12 L24 15 L22 20 L27 24 L19 23 Z" fill="#facc15"/><text x="72" y="23" text-anchor="middle" fill="#f9fafb" font-family="Georgia,serif" font-style="italic" font-size="13.5" font-weight="700" letter-spacing="1.2">Bronco</text></svg>',
    provenanceNote: '1966–1977 1st Gen Ford Bronco (U13 Roadster, U14 Half-Cab, U15 Wagon) cursive fender script and bucking horse.',
  },
  {
    id: 'bronco-xlt-eddie-bauer-78-96',
    brand: 'Ford',
    family: 'Bronco',
    seriesCode: 'FSB',
    trimPackage: 'Eddie Bauer',
    yearStart: 1978,
    yearEnd: 1996,
    markKind: 'trim_badge',
    displayLabel: 'BRONCO XLT · EDDIE BAUER',
    subLabel: "'78–'96 2nd–5th Gen Full-Size XLT & Eddie Bauer Fender Plate",
    rpoCode: 'XLT / Eddie Bauer',
    fenderPlacement: 'Front Fender & B-Pillar',
    svgMarkup:
      '<svg viewBox="0 0 120 36" xmlns="http://www.w3.org/2000/svg"><rect x="1.5" y="3" width="117" height="30" rx="2" fill="#1b2e22" stroke="#d4af37" stroke-width="1.8"/><rect x="86" y="6" width="29" height="24" fill="#92400e"/><text x="44" y="16" text-anchor="middle" fill="#f9fafb" font-family="Arial,sans-serif" font-size="8.5" font-weight="800" letter-spacing="1.6">BRONCO</text><text x="44" y="27" text-anchor="middle" fill="#fde68a" font-family="Georgia,serif" font-style="italic" font-size="8.5" font-weight="700">Eddie Bauer</text><text x="100.5" y="22" text-anchor="middle" fill="#ffffff" font-family="Arial Black,sans-serif" font-size="9.5" font-weight="900">XLT</text></svg>',
    provenanceNote: '1978–1996 2nd–5th Gen Ford Bronco Ranger XLT, Nite, and Eddie Bauer two-tone outdoorsman fender plate.',
  },
  {
    id: 'bronco-6th-gen-raptor-21-26',
    brand: 'Ford',
    family: 'Bronco',
    seriesCode: 'U725',
    trimPackage: 'Raptor',
    yearStart: 2021,
    yearEnd: 2035,
    markKind: 'trim_badge',
    displayLabel: 'BRONCO · RAPTOR (6TH GEN)',
    subLabel: "'21–'26 Bucking Horse Silhouette & Code Orange Raptor Callout",
    rpoCode: 'U725 / Braptor',
    fenderPlacement: 'Front Fender Vent & Rear Tailgate',
    svgMarkup:
      '<svg viewBox="0 0 120 36" xmlns="http://www.w3.org/2000/svg"><rect x="1.5" y="3" width="117" height="30" rx="2" fill="#111317" stroke="#f97316" stroke-width="1.8"/><path d="M11 26 L15 17 L19 10 L25 13 L22 19 L28 23 L19 23 Z" fill="#f97316"/><text x="72" y="16" text-anchor="middle" fill="#f9fafb" font-family="Arial Black,sans-serif" font-size="8.5" font-weight="900" letter-spacing="2">BRONCO</text><text x="72" y="27" text-anchor="middle" fill="#fb923c" font-family="Arial Black,Impact,sans-serif" font-size="9.5" font-weight="900" letter-spacing="2.2">RAPTOR</text></svg>',
    provenanceNote: '2021–2026 6th Gen Ford Bronco U725 bucking horse silhouette and Ford Performance Code Orange Raptor badge.',
  },
  {
    id: 'camaro-1st-gen-z28-rsss-67-69',
    brand: 'Chevrolet',
    family: 'Camaro',
    seriesCode: '1st Gen',
    trimPackage: 'Z/28',
    yearStart: 1967,
    yearEnd: 1969,
    markKind: 'trim_badge',
    displayLabel: 'CAMARO Z/28 · RS/SS',
    subLabel: "'67–'69 1st Gen Trans-Am 302 Z/28 & RS/SS 396 Grille Emblem",
    rpoCode: 'Z28 / Z22 / L78',
    fenderPlacement: 'Grille & Front Fender Behind Wheel Opening',
    svgMarkup:
      '<svg viewBox="0 0 120 36" xmlns="http://www.w3.org/2000/svg"><rect x="1.5" y="3" width="117" height="30" rx="2" fill="#111827" stroke="#e5e7eb" stroke-width="1.8"/><rect x="76" y="6" width="38" height="24" fill="#991b1b"/><text x="40" y="24" text-anchor="middle" fill="#ef4444" stroke="#f9fafb" stroke-width="0.6" font-family="Arial Black,Impact,sans-serif" font-size="15" font-weight="900" letter-spacing="1.5">Z/28</text><text x="95" y="17" text-anchor="middle" fill="#ffffff" font-family="Arial Black,sans-serif" font-size="8.5" font-weight="900">RS/SS</text><text x="95" y="27" text-anchor="middle" fill="#fde047" font-family="Arial,sans-serif" font-size="8" font-weight="800">396</text></svg>',
    provenanceNote: '1967–1969 1st Gen Chevrolet Camaro RPO Z28 302ci homologation emblem and RS/SS 396 big-block badge.',
  },
  {
    id: 'camaro-2nd-gen-z28-70-81',
    brand: 'Chevrolet',
    family: 'Camaro',
    seriesCode: '2nd Gen',
    trimPackage: 'Z28',
    yearStart: 1970,
    yearEnd: 1981,
    markKind: 'trim_badge',
    displayLabel: 'CAMARO Z28 (2ND GEN)',
    subLabel: "'70–'81 Split-Bumper LT-1 & Tri-Tone Z28 Fender Callout",
    rpoCode: 'RPO Z28',
    fenderPlacement: 'Grille, Fender & Rear Tailpan',
    svgMarkup:
      '<svg viewBox="0 0 120 36" xmlns="http://www.w3.org/2000/svg"><rect x="1.5" y="3" width="117" height="30" rx="2" fill="#18181b" stroke="#f97316" stroke-width="1.8"/><polygon points="8,28 18,8 30,8 20,28" fill="#dc2626"/><polygon points="20,28 30,8 40,8 30,28" fill="#f97316"/><text x="76" y="24" text-anchor="middle" fill="#facc15" font-family="Arial Black,Impact,sans-serif" font-size="16" font-weight="900" letter-spacing="2.2">Z28</text></svg>',
    provenanceNote: '1970–1981 2nd Gen Chevrolet Camaro Z28 LT-1 split-bumper & late-70s tri-color strobe callout.',
  },
  {
    id: 'camaro-3rd-gen-iroc-z-82-92',
    brand: 'Chevrolet',
    family: 'Camaro',
    seriesCode: 'IROC-Z',
    trimPackage: 'IROC-Z',
    yearStart: 1982,
    yearEnd: 1992,
    markKind: 'series_badge',
    displayLabel: 'CAMARO IROC-Z',
    subLabel: "'82–'92 3rd Gen F-Body TPI IROC-Z Door & Rocker Callout",
    rpoCode: 'B4Z / 1LE',
    fenderPlacement: 'Lower Door Slab & Rear Bumper Fascia',
    svgMarkup:
      '<svg viewBox="0 0 120 36" xmlns="http://www.w3.org/2000/svg"><rect x="1.5" y="3" width="117" height="30" rx="2" fill="#0f172a" stroke="#d4af37" stroke-width="1.8"/><line x1="6" y1="29" x2="114" y2="29" stroke="#ef4444" stroke-width="1.6"/><text x="60" y="23" text-anchor="middle" fill="#facc15" font-family="Arial Black,Impact,sans-serif" font-style="italic" font-size="14.5" font-weight="900" letter-spacing="2.4">IROC-Z</text></svg>',
    provenanceNote: '1985–1990 (3rd Gen 1982–1992) Chevrolet Camaro IROC-Z International Race of Champions door decal.',
  },
  {
    id: 'camaro-4th-6th-gen-ss-zl1-1le-93-24',
    brand: 'Chevrolet',
    family: 'Camaro',
    seriesCode: 'ZL1 1LE',
    trimPackage: 'ZL1 1LE',
    yearStart: 1993,
    yearEnd: 2035,
    markKind: 'trim_badge',
    displayLabel: 'CAMARO SS · ZL1 1LE',
    subLabel: "'93–'24 4th–6th Gen Supercharged LT4 ZL1 & 1LE Track Badge",
    rpoCode: 'ZL1 / A1Z 1LE',
    fenderPlacement: 'Cowl Hood Extractor & Upper Grille',
    svgMarkup:
      '<svg viewBox="0 0 120 36" xmlns="http://www.w3.org/2000/svg"><rect x="1.5" y="3" width="117" height="30" rx="2" fill="#09090b" stroke="#dc2626" stroke-width="1.8"/><rect x="80" y="6" width="34" height="24" fill="#dc2626"/><text x="42" y="24" text-anchor="middle" fill="#f9fafb" font-family="Arial Black,Impact,sans-serif" font-size="14.5" font-weight="900" letter-spacing="1.8">ZL1</text><text x="97" y="22" text-anchor="middle" fill="#ffffff" font-family="Arial Black,sans-serif" font-size="10.5" font-weight="900" letter-spacing="1">1LE</text></svg>',
    provenanceNote: '4th–6th Gen Chevrolet Camaro SS & supercharged ZL1 1LE Extreme Track Performance emblem.',
  },
  {
    id: 'pontiac-gto-goat-judge-64-74',
    brand: 'Pontiac',
    family: 'GTO',
    seriesCode: 'GTO',
    trimPackage: 'The Judge',
    yearStart: 1964,
    yearEnd: 1974,
    markKind: 'trim_badge',
    displayLabel: 'GTO · THE JUDGE',
    subLabel: "'64–'74 PMD Goat Crest & '69–'71 Ram Air WT1 'The Judge'",
    rpoCode: 'W62 / WT1',
    fenderPlacement: 'Front Fender & Grille Split',
    svgMarkup:
      '<svg viewBox="0 0 120 36" xmlns="http://www.w3.org/2000/svg"><rect x="1.5" y="3" width="117" height="30" rx="2" fill="#111827" stroke="#f97316" stroke-width="1.8"/><polygon points="14,6 20,18 14,30 8,18" fill="#dc2626" stroke="#e5e7eb" stroke-width="1"/><text x="46" y="23" text-anchor="middle" fill="#f9fafb" font-family="Arial Black,sans-serif" font-size="12.5" font-weight="900" letter-spacing="1.6">GTO</text><text x="92" y="22" text-anchor="middle" fill="#fb923c" font-family="Georgia,serif" font-style="italic" font-size="9.5" font-weight="700">The Judge</text></svg>',
    provenanceNote: '1964–1974 Pontiac GTO (Gran Turismo Omologato) crest and 1969–1971 Ram Air III/IV "The Judge" script.',
  },
  {
    id: 'pontiac-firebird-trans-am-ws6-70-81',
    brand: 'Pontiac',
    family: 'Firebird',
    seriesCode: 'Trans Am',
    trimPackage: 'Trans Am WS6',
    yearStart: 1970,
    yearEnd: 1981,
    markKind: 'trim_badge',
    displayLabel: 'TRANS AM · WS6',
    subLabel: "'70–'81 Screaming Chicken Hood Bird & WS6 Shaker Callout",
    rpoCode: 'WS4 / WS6 / W72',
    fenderPlacement: 'Hood Decal & Shaker Scoop',
    svgMarkup:
      '<svg viewBox="0 0 120 36" xmlns="http://www.w3.org/2000/svg"><rect x="1.5" y="3" width="117" height="30" rx="2" fill="#09090b" stroke="#d4af37" stroke-width="1.8"/><path d="M8 14 L18 18 L22 9 L26 18 L36 14 L28 24 L22 30 L16 24 Z" fill="#eab308"/><text x="76" y="16" text-anchor="middle" fill="#fde047" font-family="Georgia,serif" font-size="8.5" font-weight="800" letter-spacing="1.4">TRANS AM</text><text x="76" y="27" text-anchor="middle" fill="#f97316" font-family="Arial Black,sans-serif" font-size="9.5" font-weight="900" letter-spacing="2">WS6 · 6.6L</text></svg>',
    provenanceNote: '1970–1981 2nd Gen Pontiac Firebird Trans Am gold Screaming Chicken hood bird and WS6 Special Performance badge.',
  },
  {
    id: 'buick-grand-national-gnx-82-87',
    brand: 'Buick',
    family: 'Grand National',
    seriesCode: 'GNX',
    trimPackage: 'Grand National',
    yearStart: 1982,
    yearEnd: 1987,
    markKind: 'series_badge',
    displayLabel: 'GRAND NATIONAL · GNX',
    subLabel: "'82–'87 Turbo 3.8 SFI Intercooled V6 & McLaren GNX Emblem",
    rpoCode: 'WE2 / GNX',
    fenderPlacement: 'Front Fender & Grille',
    svgMarkup:
      '<svg viewBox="0 0 120 36" xmlns="http://www.w3.org/2000/svg"><rect x="1.5" y="3" width="117" height="30" rx="2" fill="#09090b" stroke="#ef4444" stroke-width="1.8"/><path d="M10 25 A8 8 0 1 1 24 15 L28 15" fill="none" stroke="#f97316" stroke-width="2.2"/><text x="58" y="16" text-anchor="middle" fill="#ef4444" font-family="Arial Black,Impact,sans-serif" font-size="11" font-weight="900" letter-spacing="2">GNX</text><text x="68" y="27" text-anchor="middle" fill="#e5e7eb" font-family="Arial,sans-serif" font-size="7.5" font-weight="800" letter-spacing="1.2">3.8 SFI TURBO</text></svg>',
    provenanceNote: '1982–1987 Buick Regal Grand National (WE2) orange/red Turbo 6 emblem and 1987 ASC/McLaren GNX badge.',
  },
  {
    id: 'oldsmobile-442-w30-64-72',
    brand: 'Oldsmobile',
    family: '442',
    seriesCode: '442',
    trimPackage: 'W-30',
    yearStart: 1964,
    yearEnd: 1972,
    markKind: 'series_badge',
    displayLabel: 'OLDSMOBILE 4-4-2 · W-30',
    subLabel: "'64–'72 Staggered 4-4-2 Numerals & Ram Air W-30 Fender Plate",
    rpoCode: 'W29 / W30',
    fenderPlacement: 'Front Fender & Trunk Lid',
    svgMarkup:
      '<svg viewBox="0 0 120 36" xmlns="http://www.w3.org/2000/svg"><rect x="1.5" y="3" width="117" height="30" rx="2" fill="#18181b" stroke="#d4af37" stroke-width="1.8"/><rect x="78" y="7" width="36" height="22" fill="#991b1b"/><text x="40" y="24" text-anchor="middle" fill="#facc15" font-family="Arial Black,Impact,sans-serif" font-size="16" font-weight="900" letter-spacing="2.5">442</text><text x="96" y="22" text-anchor="middle" fill="#ffffff" font-family="Arial Black,sans-serif" font-size="9.5" font-weight="900" letter-spacing="1">W-30</text></svg>',
    provenanceNote: '1964–1972 Oldsmobile 4-4-2 staggered brass/red numerals and W-30 Force-Air fiberglass-hood badge.',
  },
  {
    id: 'jeep-cj5-cj7-scrambler-55-86',
    brand: 'Jeep',
    family: 'CJ',
    seriesCode: 'CJ-7',
    trimPackage: 'Renegade',
    yearStart: 1955,
    yearEnd: 1986,
    markKind: 'series_badge',
    displayLabel: 'JEEP CJ-5 · CJ-7 · SCRAMBLER',
    subLabel: "'55–'86 Stamped Cowl Logo, Renegade & CJ-8 Scrambler Callout",
    rpoCode: 'CJ-5 / CJ-7 / CJ-8',
    fenderPlacement: 'Cowl Side & Hood',
    svgMarkup:
      '<svg viewBox="0 0 120 36" xmlns="http://www.w3.org/2000/svg"><rect x="1.5" y="3" width="117" height="30" rx="2" fill="#1c1917" stroke="#f59e0b" stroke-width="1.8"/><text x="40" y="23" text-anchor="middle" fill="#f9fafb" font-family="Arial Black,sans-serif" font-size="12.5" font-weight="900" letter-spacing="1.8">CJ-7</text><text x="88" y="16" text-anchor="middle" fill="#fbbf24" font-family="Arial,sans-serif" font-size="7.5" font-weight="800" letter-spacing="1">RENEGADE</text><text x="88" y="26" text-anchor="middle" fill="#f97316" font-family="Arial,sans-serif" font-size="7" font-weight="800" letter-spacing="0.8">SCRAMBLER</text></svg>',
    provenanceNote: '1955–1986 Jeep CJ-5, CJ-7 Renegade / Laredo / Golden Eagle, and CJ-8 Scrambler stamped cowl emblem.',
  },
  {
    id: 'jeep-grand-wagoneer-woodgrain-84-91',
    brand: 'Jeep',
    family: 'Grand Wagoneer',
    seriesCode: 'SJ',
    trimPackage: 'Grand Wagoneer',
    yearStart: 1984,
    yearEnd: 1991,
    markKind: 'model_wordmark',
    displayLabel: 'GRAND WAGONEER (SJ)',
    subLabel: "'84–'91 Marine Teak Woodgrain & Gold Hood/Tailgate Crest",
    rpoCode: 'SJ Body',
    fenderPlacement: 'Front Fender Woodgrain Trim & Tailgate',
    svgMarkup:
      '<svg viewBox="0 0 120 36" xmlns="http://www.w3.org/2000/svg"><rect x="1.5" y="3" width="117" height="30" rx="2" fill="#451a03" stroke="#d4af37" stroke-width="2"/><rect x="5" y="6.5" width="110" height="23" fill="#78350f" stroke="#fde68a" stroke-width="0.9"/><text x="60" y="16" text-anchor="middle" fill="#fef08a" font-family="Georgia,serif" font-size="7.5" font-weight="700" letter-spacing="2.2">GRAND</text><text x="60" y="26" text-anchor="middle" fill="#ffffff" font-family="Georgia,serif" font-size="9.5" font-weight="800" letter-spacing="1.6">WAGONEER</text></svg>',
    provenanceNote: '1984–1991 Jeep SJ Grand Wagoneer Dinoc marine-teak woodgrain surround and gold crest.',
  },
  {
    id: 'jeep-wrangler-rubicon-392-87-26',
    brand: 'Jeep',
    family: 'Wrangler',
    seriesCode: 'JL',
    trimPackage: 'Rubicon 392',
    yearStart: 1987,
    yearEnd: 2035,
    markKind: 'trim_badge',
    displayLabel: 'WRANGLER RUBICON 392',
    subLabel: 'YJ · TJ · JK · JL & Bronze-Edge 6.4L Hemi V8 Rubicon 392 Callout',
    rpoCode: 'JL / Rubicon 392',
    fenderPlacement: 'Hood Side & Trail Rated Fender',
    svgMarkup:
      '<svg viewBox="0 0 120 36" xmlns="http://www.w3.org/2000/svg"><rect x="1.5" y="3" width="117" height="30" rx="2" fill="#18181b" stroke="#b45309" stroke-width="1.8"/><text x="60" y="16" text-anchor="middle" fill="#f9fafb" font-family="Arial Black,sans-serif" font-size="9.5" font-weight="900" letter-spacing="2.2">RUBICON</text><text x="60" y="28" text-anchor="middle" fill="#f59e0b" font-family="Arial Black,Impact,sans-serif" font-size="10.5" font-weight="900" letter-spacing="2.6">392 HEMI</text></svg>',
    provenanceNote: 'Jeep Wrangler Rubicon & JL Rubicon 392 bronze-traced hood side stencil.',
  },
  {
    id: 'international-scout-800-scout-ii-61-80',
    brand: 'International',
    family: 'Scout',
    seriesCode: 'Scout II',
    trimPackage: 'Rallye',
    yearStart: 1961,
    yearEnd: 1980,
    markKind: 'series_badge',
    displayLabel: 'INTERNATIONAL SCOUT 800 · II',
    subLabel: "'61–'80 IH Triple-Diamond & Scout 800 / Scout II Fender Plate",
    rpoCode: 'Scout 800 / Scout II',
    fenderPlacement: 'Front Fender & Tailgate',
    svgMarkup:
      '<svg viewBox="0 0 120 36" xmlns="http://www.w3.org/2000/svg"><rect x="1.5" y="3" width="117" height="30" rx="2" fill="#1c1917" stroke="#e5e7eb" stroke-width="1.8"/><rect x="8" y="8" width="22" height="20" fill="#dc2626"/><text x="19" y="22" text-anchor="middle" fill="#ffffff" font-family="Arial Black,sans-serif" font-size="11" font-weight="900">IH</text><text x="74" y="23" text-anchor="middle" fill="#f9fafb" font-family="Georgia,serif" font-weight="800" font-size="11.5" letter-spacing="1.6">SCOUT II</text></svg>',
    provenanceNote: '1961–1980 International Harvester Scout 80, Scout 800, and Scout II / Terra / Traveler badge.',
  },
  {
    id: 'datsun-s30-240z-260z-280z-69-78',
    brand: 'Datsun',
    family: '240Z',
    seriesCode: 'S30',
    trimPackage: 'Fairlady Z',
    yearStart: 1969,
    yearEnd: 1978,
    markKind: 'series_badge',
    displayLabel: 'DATSUN 240Z · 260Z · 280Z (S30)',
    subLabel: "'69–'78 S30 Fairlady Z Fender Script & C-Pillar Vent Emblem",
    rpoCode: 'HLS30 / HS30',
    fenderPlacement: 'Front Fender, C-Pillar & Decklid',
    svgMarkup:
      '<svg viewBox="0 0 120 36" xmlns="http://www.w3.org/2000/svg"><rect x="1.5" y="3" width="117" height="30" rx="2" fill="#111827" stroke="#e5e7eb" stroke-width="1.8"/><circle cx="20" cy="18" r="10" fill="#991b1b" stroke="#f9fafb" stroke-width="1.4"/><text x="20" y="22" text-anchor="middle" fill="#ffffff" font-family="Georgia,serif" font-style="italic" font-size="12" font-weight="900">Z</text><text x="74" y="16" text-anchor="middle" fill="#f9fafb" font-family="Arial Black,sans-serif" font-size="10.5" font-weight="900" letter-spacing="1.8">240Z · S30</text><text x="74" y="27" text-anchor="middle" fill="#fca5a5" font-family="Georgia,serif" font-style="italic" font-size="8.5" font-weight="700">Fairlady Z</text></svg>',
    provenanceNote: '1969–1978 Datsun S30 (240Z, 260Z, 280Z & Fairlady Z432) C-pillar Z roundel and fender emblem.',
  },
  {
    id: 'nissan-skyline-gtr-r32-r33-r34-r35-89-26',
    brand: 'Nissan',
    family: 'Skyline',
    seriesCode: 'BNR34',
    trimPackage: 'V-Spec',
    yearStart: 1989,
    yearEnd: 2035,
    markKind: 'series_badge',
    displayLabel: 'SKYLINE GT-R (R32·R33·R34·R35)',
    subLabel: 'Stepped Silver GT + Red R Trunk & Grille Emblem (RB26DETT / VR38)',
    rpoCode: 'BNR32 / BCNR33 / BNR34 / R35',
    fenderPlacement: 'Front Grille Mesh & Rear Trunk Lid',
    svgMarkup:
      '<svg viewBox="0 0 120 36" xmlns="http://www.w3.org/2000/svg"><rect x="1.5" y="3" width="117" height="30" rx="2" fill="#0f172a" stroke="#cbd5e1" stroke-width="1.8"/><text x="40" y="18" text-anchor="middle" fill="#e2e8f0" font-family="Arial Black,sans-serif" font-size="11.5" font-weight="900" letter-spacing="2">GT</text><text x="45" y="29" text-anchor="middle" fill="#ef4444" font-family="Arial Black,Impact,sans-serif" font-size="13.5" font-weight="900">R</text><text x="88" y="17" text-anchor="middle" fill="#f8fafc" font-family="Arial,sans-serif" font-size="8" font-weight="800" letter-spacing="1.2">SKYLINE</text><text x="88" y="27" text-anchor="middle" fill="#38bdf8" font-family="Arial,sans-serif" font-size="8" font-weight="800" letter-spacing="1">V-SPEC</text></svg>',
    provenanceNote: 'Nissan Skyline GT-R (BNR32, BCNR33, BNR34 V-Spec / M-Spec / Z-Tune, and R35) silver-and-red GT-R emblem.',
  },
  {
    id: 'toyota-supra-a70-a80-a90-79-26',
    brand: 'Toyota',
    family: 'Supra',
    seriesCode: 'JZA80',
    trimPackage: 'Twin Turbo',
    yearStart: 1979,
    yearEnd: 2035,
    markKind: 'model_wordmark',
    displayLabel: 'TOYOTA SUPRA (A70·A80·A90)',
    subLabel: 'Celica Supra Dragon Crest & JZA80 2JZ-GTE Twin Turbo Script',
    rpoCode: 'MA70 / JZA70 / JZA80 / A90',
    fenderPlacement: 'Nose Emblem & Rear Decklid',
    svgMarkup:
      '<svg viewBox="0 0 120 36" xmlns="http://www.w3.org/2000/svg"><rect x="1.5" y="3" width="117" height="30" rx="2" fill="#111827" stroke="#ef4444" stroke-width="1.8"/><path d="M10 26 L14 12 L22 9 L19 17 L25 20 L16 26 Z" fill="#dc2626"/><text x="70" y="18" text-anchor="middle" fill="#f9fafb" font-family="Georgia,serif" font-style="italic" font-size="13.5" font-weight="800" letter-spacing="1">Supra</text><text x="70" y="28" text-anchor="middle" fill="#f87171" font-family="Arial,sans-serif" font-size="7.5" font-weight="800" letter-spacing="1.4">TWIN TURBO · JZA80</text></svg>',
    provenanceNote: 'Toyota Celica Supra dragon crest, A70 3.0GT Turbo, JZA80 MkIV 2JZ-GTE Twin Turbo script, and A90 GR Supra.',
  },
];

export const VEHICLE_IDENTITY_MARKS = VETTED_IDENTITY_MARKS;

const PICKUP_FAMILIES = new Set([
  'pickup',
  'truck',
  'c10',
  'k10',
  'c20',
  'k20',
  'c30',
  'k30',
  '3100',
  '3600',
  '3800',
  'apache',
  'cameo',
  'silverado',
  'colorado',
  'avalanche',
  'ssr',
  'luv',
  'el camino',
  'canyon',
  'hummer ev pickup',
  'sierra',
  'c1500',
  'k1500',
  'c2500',
  'k2500',
  'c3500',
  'k3500',
  '3500',
  '454 ss',
  's10',
  's-10 pickup',
  'syclone',
  'sonoma',
  's15 pickup',
  'caballero',
  'f-series',
  'f-100',
  'f-150',
  'f-250',
  'f-350',
  'f-450',
  'f-1',
  'f-2',
  'f-3',
  'power wagon',
  'd100',
  'd150',
  'w100',
  'w150',
]);

export function isPickupFamilyLabel(familyLabel: string | null | undefined): boolean {
  if (!familyLabel) return false;
  const label = familyLabel.trim().toLowerCase();
  return PICKUP_FAMILIES.has(label) || PICKUP_FAMILIES.has(label.replace(/[-\s]*(?:pickup|truck)$/, '').trim());
}

export function isGmTruckBrand(make: string | null | undefined): boolean {
  return /^(chevrolet|gmc)$/i.test(make?.trim() ?? '');
}

/**
 * Consolidates a brand's fragmented pickup series family tiles (e.g. C10, K10, C20, K20, C30, 3100, Apache,
 * Cameo, Silverado, F-100, F-150, F-250, F-350, F-1, Sierra, C1500, K1500) into the canonical `Pickup` umbrella tile
 * permanently for Chevrolet/GMC (displayed as Truck), and when `groupPickups` is enabled for other brands. Slice by
 * Series / Trim / Body Style / Era inside the Pickup family.
 */
export function consolidateBrandPickupFamilies(
  make: string | null | undefined,
  families: TreemapNode[] | null | undefined,
  groupPickups: boolean,
): TreemapNode[] | null {
  const gm = isGmTruckBrand(make);
  if (!families || (!groupPickups && !gm) || !make) return families ?? null;
  const pickupNodes: TreemapNode[] = [];
  const otherNodes: TreemapNode[] = [];

  for (const node of families) {
    if (isPickupFamilyLabel(node.name)) {
      pickupNodes.push(node);
    } else {
      otherNodes.push(node);
    }
  }

  if (!pickupNodes.length || (!gm && pickupNodes.length === 1)) return families;

  // Prefer the canonical "Pickup" familyKey so treemap_family_models / treemap_family_sales umbrella logic triggers automatically
  const canonicalPickup = pickupNodes.find((n) => /^(pickup|truck)$/i.test(n.name.trim()));
  // An arbitrary C10 key cannot stand in for the whole truck family.
  if (!canonicalPickup) return families;

  const merged: TreemapNode = {
    ...canonicalPickup,
    name: gm ? 'Truck' : 'Pickup',
    familyKey: canonicalPickup.familyKey,
    count: pickupNodes.reduce((s, n) => s + (n.count ?? 0), 0),
    value: pickupNodes.reduce((s, n) => s + (n.usd ?? n.value ?? 0), 0),
    usd: pickupNodes.reduce((s, n) => s + (n.usd ?? n.value ?? 0), 0),
    sold_any: pickupNodes.reduce((s, n) => s + (n.sold_any ?? n.count ?? 0), 0),
    offered: pickupNodes.reduce((s, n) => s + (n.offered ?? n.count ?? 0), 0),
    dated: pickupNodes.reduce((s, n) => s + (n.dated ?? 0), 0),
    sold_12m: pickupNodes.reduce((s, n) => s + (n.sold_12m ?? 0), 0),
    sold_prior_12m: pickupNodes.reduce((s, n) => s + (n.sold_prior_12m ?? 0), 0),
    usd_12m: pickupNodes.reduce((s, n) => s + (n.usd_12m ?? 0), 0),
    usd_prior_12m: pickupNodes.reduce((s, n) => s + (n.usd_prior_12m ?? 0), 0),
    models: pickupNodes.reduce((s, n) => s + (n.models ?? 1), 0),
  };

  return [...otherNodes, merged].sort((a, b) => {
    if (a.familyKey === 'other') return 1;
    if (b.familyKey === 'other') return -1;
    return (b.usd ?? b.value) - (a.usd ?? a.value);
  });
}

/**
 * Deterministically classifies a raw vehicle model / sub-model string (and optional year)
 * into orthogonal `series`, `trim`, and `body` facets.
 */
export function classifyVehicleFacets(
  make: string | null | undefined,
  familyLabel: string | null | undefined,
  rawModel: string | null | undefined,
  year?: number | null,
): VehicleFacetClassification {
  if (!rawModel) return { series: null, trim: null, body: null };
  const brand = (make ?? '').trim().toLowerCase();
  const fam = (familyLabel ?? '').trim().toLowerCase();
  const m = rawModel.trim();
  const u = m.toUpperCase();

  let series: string | null = null;
  let trim: string | null = null;
  let body: string | null = null;

  // ── 1. SERIES / TONNAGE & DRIVE EXTRACTION ────────────────────────────────
  if (brand === 'chevrolet' || brand === 'gmc' || isPickupFamilyLabel(fam)) {
    if (/\bC[-\s]?10\b/.test(u)) series = 'C10 (1/2-Ton 2WD)';
    else if (/\bK[-\s]?10\b/.test(u)) series = 'K10 (1/2-Ton 4x4)';
    else if (/\bC[-\s]?20\b/.test(u)) series = 'C20 (3/4-Ton 2WD)';
    else if (/\bK[-\s]?20\b/.test(u)) series = 'K20 (3/4-Ton 4x4)';
    else if (/\bC[-\s]?30\b/.test(u)) series = 'C30 (1-Ton 2WD)';
    else if (/\bK[-\s]?30\b/.test(u)) series = 'K30 (1-Ton 4x4)';
    else if (/\bR[-\s]?10\b/.test(u)) series = 'R10 (1/2-Ton 2WD)';
    else if (/\bV[-\s]?10\b/.test(u)) series = 'V10 (1/2-Ton 4x4)';
    else if (/\b3100\b/.test(u)) series = '3100 (1/2-Ton)';
    else if (/\b3600\b/.test(u)) series = '3600 (3/4-Ton)';
    else if (/\b3800\b/.test(u)) series = '3800 (1-Ton)';
    else if (/\bAPACHE\b/.test(u)) series = 'Apache';
    else if (/\bCAMEO\b/.test(u)) series = 'Cameo Carrier';
    else if (/\bK[-\s]?1500\b/.test(u)) series = 'K1500 (1/2-Ton 4x4)';
    else if (/\bC[-\s]?1500\b|\b1500\b/.test(u)) series = '1500 (1/2-Ton)';
    else if (/\bK[-\s]?2500\b|\bC[-\s]?2500\b|\b2500\b/.test(u)) series = '2500 (3/4-Ton)';
    else if (/\bK[-\s]?3500\b|\bC[-\s]?3500\b|\b3500\b/.test(u)) series = '3500 (1-Ton)';
    else if (/\b100\b/.test(u) && brand === 'gmc') series = 'GMC 100 (1/2-Ton)';
    if (!series && isPickupFamilyLabel(fam)) {
      const line = /\b(HUMMER\s+EV\s+PICKUP|SILVERADO|SIERRA|COLORADO|CANYON|AVALANCHE|SSR|LUV|EL\s+CAMINO|CABALLERO|S[-\s]?10|S[-\s]?15|SYCLONE|SONOMA)\b/.exec(u)?.[1];
      if (line) series = line.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
        .replace(/^S[-\s]?10$/i, 'S10').replace(/^S[-\s]?15$/i, 'S15').replace(/^Ssr$/, 'SSR').replace(/^Luv$/, 'LUV')
        .replace(/^Hummer Ev Pickup$/, 'Hummer EV Pickup');
    }
  }

  if (!series && (brand === 'ford' || isPickupFamilyLabel(fam))) {
    if (/\bF[-\s]?100\b/.test(u)) series = 'F-100 (1/2-Ton)';
    else if (/\bF[-\s]?150\b/.test(u)) series = 'F-150 (1/2-Ton)';
    else if (/\bF[-\s]?250\b/.test(u)) series = 'F-250 (3/4-Ton)';
    else if (/\bF[-\s]?350\b/.test(u)) series = 'F-350 (1-Ton)';
    else if (/\bF[-\s]?1\b/.test(u)) series = 'F-1 (1/2-Ton)';
    else if (/\bF[-\s]?2\b/.test(u)) series = 'F-2 (3/4-Ton)';
    else if (/\bF[-\s]?3\b/.test(u)) series = 'F-3 (Heavy Duty)';
  }

  if (!series && fam === 'mustang') {
    if (/\bSHELBY\s+GT500KR\b/.test(u)) series = 'Shelby GT500KR';
    else if (/\bSHELBY\s+GT500\b|\bGT500\b/.test(u)) series = 'Shelby GT500';
    else if (/\bSHELBY\s+GT350R\b|\bGT350R\b/.test(u)) series = 'Shelby GT350R';
    else if (/\bSHELBY\s+GT350\b|\bGT350\b/.test(u)) series = 'Shelby GT350';
    else if (/\bBOSS\s+429\b/.test(u)) series = 'Boss 429';
    else if (/\bBOSS\s+302\b/.test(u)) series = 'Boss 302';
    else if (/\bMACH\s+1\b/.test(u)) series = 'Mach 1';
    else if (/\bSVT\s+COBRA\s+R\b|\bCOBRA\s+R\b/.test(u)) series = 'SVT Cobra R';
    else if (/\bSVT\s+COBRA\b|\bTERMINATOR\b/.test(u)) series = 'SVT Cobra';
    else if (/\bBULLITT\b/.test(u)) series = 'Bullitt';
    else if (/\bDARK\s+HORSE\b/.test(u)) series = 'Dark Horse';
    else if (/\bMUSTANG\s+GT\b|\bGT\s+(COUPE|FASTBACK|CONVERTIBLE)\b/.test(u)) series = 'Mustang GT';
    else series = 'Mustang Standard';
  }

  if (!series && fam === 'corvette') {
    if (/\bZR[-\s]?1\b/.test(u)) series = 'ZR1 / ZR-1';
    else if (/\bZ06\b/.test(u)) series = 'Z06';
    else if (/\bGRAND\s+SPORT\b/.test(u)) series = 'Grand Sport';
    else if (/\bL88\b/.test(u)) series = 'L88 427';
    else if (/\b427\b/.test(u)) series = '427 Big-Block';
    else if (/\bFUEL\s+INJECTED\b|\bFUELIE\b/.test(u)) series = 'Fuel Injected';
    else if (/\bSTING\s*RAY\b/.test(u)) series = year && year <= 1967 ? 'Sting Ray (C2)' : 'Stingray';
    else series = 'Corvette Base';
  }

  if (!series && fam === '911') {
    if (/\bGT3\s+RS\b/.test(u)) series = 'GT3 RS';
    else if (/\bGT3\b/.test(u)) series = 'GT3';
    else if (/\bGT2\s+RS\b|\bGT2\b/.test(u)) series = 'GT2 / GT2 RS';
    else if (/\bTURBO\s+S\b|\bTURBO\b|\b930\b/.test(u)) series = '911 Turbo';
    else if (/\bCARRERA\s+RS\b/.test(u)) series = 'Carrera RS';
    else if (/\bCARRERA\s+4S\b|\bC4S\b/.test(u)) series = 'Carrera 4S';
    else if (/\bCARRERA\s+S\b/.test(u)) series = 'Carrera S';
    else if (/\bCARRERA\b/.test(u)) series = '911 Carrera';
    else if (/\b911S\b/.test(u)) series = '911S';
    else if (/\b911E\b/.test(u)) series = '911E';
    else if (/\b911T\b/.test(u)) series = '911T';
    else if (/\bSC\b/.test(u)) series = '911 SC';
  }

  if (!series && (fam === 'bel air' || fam === '210' || fam === '150' || fam === 'nomad')) {
    if (/\bNOMAD\b/.test(u)) series = 'Nomad Sport Wagon';
    else if (/\bBEL\s+AIR\b/.test(u)) series = 'Bel Air (2400 Series)';
    else if (/\b210\b|\bTWO[-\s]?TEN\b/.test(u)) series = '210 (2100 Series)';
    else if (/\b150\b|\bONE[-\s]?FIFTY\b/.test(u)) series = '150 (1500 Series)';
    else if (/\bBEAUVILLE\b/.test(u)) series = 'Beauville Wagon';
    else if (/\bTOWNS?MAN\b/.test(u)) series = 'Townsman Wagon';
  }

  if (!series && fam === 'chevelle') {
    if (/\bSS\s*454\b|\bLS6\b|\bLS5\b/.test(u)) series = 'SS 454';
    else if (/\bSS\s*396\b|\bL78\b|\bL89\b/.test(u)) series = 'SS 396';
    else if (/\bMALIBU\s+SS\b|\bCHEVELLE\s+SS\b|\bSUPER\s+SPORT\b/.test(u)) series = 'Chevelle SS';
    else if (/\bLAGUNA\b/.test(u)) series = 'Laguna S-3';
    else if (/\bMALIBU\b/.test(u)) series = 'Malibu';
    else if (/\b300\s+DELUXE\b|\b300\b/.test(u)) series = 'Chevelle 300';
  }

  if (!series && fam === 'camaro') {
    if (/\bCOPO\b|\bYENKO\b|\bBALDWIN\b|\bZL[-\s]?1\b/.test(u)) series = 'COPO / ZL1';
    else if (/\bZ\/?28\b/.test(u)) series = 'Camaro Z/28';
    else if (/\bIROC[-\s]?Z\b/.test(u)) series = 'Camaro IROC-Z';
    else if (/\bRS\/SS\b|\bSS\/RS\b/.test(u)) series = 'Camaro RS/SS';
    else if (/\bSS\b|\bSUPER\s+SPORT\b/.test(u)) series = 'Camaro SS';
    else if (/\bRS\b|\bRALLY\s+SPORT\b/.test(u)) series = 'Camaro RS';
    else if (/\bBERLINETTA\b/.test(u)) series = 'Berlinetta';
  }

  if (!series && fam === 'bronco') {
    if (/\bRAPTOR\b/.test(u)) series = 'Bronco Raptor';
    else if (/\bSTROPPE\b|\bBAJA\b/.test(u)) series = 'Bill Stroppe Baja';
    else if (/\bU13\b|\bROADSTER\b/.test(u)) series = 'U13 Roadster';
    else if (/\bU14\b|\bHALF[-\s]?CAB\b|\bSPORTS\s+UTILITY\b/.test(u)) series = 'U14 Half-Cab Pickup';
    else if (/\bU15\b|\bWAGON\b/.test(u) || (year && year >= 1966 && year <= 1977)) series = 'U15 Wagon';
    else if (/\bEDDIE\s+BAUER\b/.test(u)) series = 'Eddie Bauer';
    else if (/\bXLT\b/.test(u)) series = 'Bronco XLT';
  }

  // Dodge / Mopar Pickup, Charger, Challenger, Barracuda / 'Cuda
  if (!series && (brand === 'dodge' || brand === 'plymouth' || isPickupFamilyLabel(fam))) {
    if (/\bWM[-\s]?300\b/.test(u)) series = 'Power Wagon WM300';
    else if (/\bPOWER\s+WAGON\b|\bW[-\s]?100\b|\bW[-\s]?150\b|\bW[-\s]?200\b|\bW[-\s]?250\b|\bW[-\s]?300\b/.test(u)) series = 'Power Wagon (4x4)';
    else if (/\bLIL['\u2019]?\s+RED\s+EXPRESS\b/.test(u)) series = "Lil' Red Express";
    else if (/\bWARLOCK\b/.test(u)) series = 'Warlock';
    else if (/\bD[-\s]?100\b|\bD[-\s]?150\b/.test(u)) series = 'D100 / D150 (1/2-Ton 2WD)';
    else if (/\bD[-\s]?200\b|\bD[-\s]?250\b/.test(u)) series = 'D200 / D250 (3/4-Ton 2WD)';
    else if (/\bCHARGER\s+DAYTONA\b|\bSUPERBIRD\b/.test(u)) series = 'Aero Wing (Daytona / Superbird)';
    else if (/\bCHARGER\s+500\b/.test(u)) series = 'Charger 500';
    else if (/\bCHARGER\s+R\/T\b|\bCHALLENGER\s+R\/T\b/.test(u)) series = 'R/T (Road/Track)';
    else if (/\bCHALLENGER\s+T\/A\b|\bAAR\s+['\u2019]?CUDA\b/.test(u)) series = 'Trans-Am (T/A · AAR)';
    else if (/\bHEMI\s+['\u2019]?CUDA\b|\b426\s+HEMI\b/.test(u)) series = '426 Hemi';
    else if (/\bDEMON\b/.test(u)) series = 'SRT Demon';
    else if (/\bHELLCAT\b/.test(u)) series = 'SRT Hellcat';
  }

  // BMW Chassis & M-Division
  if (!series && brand === 'bmw') {
    if (/\b2002\s*TURBO\b/.test(u)) series = '2002 Turbo';
    else if (/\b2002\s*TII\b/.test(u)) series = '2002tii';
    else if (/\b2002\b/.test(u)) series = '2002';
    else if (/\bE30\b.*\bM3\b|\bM3\b.*\bE30\b/.test(u) || (fam.includes('m3') && year && year >= 1986 && year <= 1991)) series = 'E30 M3';
    else if (/\bE36\b.*\bM3\b|\bM3\b.*\bE36\b/.test(u) || (fam.includes('m3') && year && year >= 1992 && year <= 1999)) series = 'E36 M3';
    else if (/\bE46\b.*\bM3\b|\bM3\b.*\bE46\b|\bM3\s+CSL\b/.test(u) || (fam.includes('m3') && year && year >= 2000 && year <= 2006)) series = 'E46 M3';
    else if (/\bE9[023]\b.*\bM3\b|\bM3\b.*\bE9[023]\b/.test(u) || (fam.includes('m3') && year && year >= 2007 && year <= 2013)) series = 'E90/E92/E93 M3';
    else if (/\bE28\b.*\bM5\b|\bE34\b.*\bM5\b|\bE39\b.*\bM5\b|\bE60\b.*\bM5\b/.test(u)) series = 'M5 Heritage';
  }

  // Mercedes-Benz SL & G-Class Chassis
  if (!series && (brand === 'mercedes-benz' || brand === 'mercedes')) {
    if (/\b300\s*SL\b|\bW198\b/.test(u)) series = '300SL (W198)';
    else if (/\b190\s*SL\b|\bW121\b/.test(u)) series = '190SL (W121)';
    else if (/\b230\s*SL\b|\b250\s*SL\b|\b280\s*SL\b|\bW113\b|\bPAGODA\b/.test(u)) series = 'Pagoda (W113)';
    else if (/\b380\s*SL\b|\b450\s*SL\b|\b560\s*SL\b|\bR107\b/.test(u)) series = 'R107 SL (380/450/560SL)';
    else if (/\b500\s*SL\b|\bSL\s*500\b|\bSL\s*600\b|\bR129\b/.test(u)) series = 'R129 SL';
  }

  // Toyota Land Cruiser J-Series & Supra / 4Runner
  if (!series && brand === 'toyota') {
    if (/\bFJ45\b|\bHJ45\b|\bHJ47\b/.test(u)) series = 'FJ45 / HJ47 Pickup & Troopy';
    else if (/\bFJ43\b|\bBJ42\b|\bBJ43\b/.test(u)) series = 'FJ43 / BJ42 Mid-Wheelbase';
    else if (/\bFJ40\b|\bBJ40\b|\bJ40\b/.test(u) || (fam.includes('land cruiser') && year && year >= 1960 && year <= 1984 && !/\bFJ55\b|\bFJ60\b/.test(u))) series = 'FJ40 / BJ40 (J40)';
    else if (/\bFJ55\b/.test(u)) series = 'FJ55 Iron Pig';
    else if (/\bFJ60\b|\bFJ62\b|\bHJ60\b|\bHJ61\b/.test(u) || (fam.includes('land cruiser') && year && year >= 1981 && year <= 1990)) series = 'FJ60 / FJ62 (J60 Wagon)';
    else if (/\bFJ80\b|\bFZJ80\b|\bHDJ80\b|\b80[-\s]?SERIES\b/.test(u) || (fam.includes('land cruiser') && year && year >= 1991 && year <= 1997)) series = 'FZJ80 / FJ80 (J80)';
    else if (/\bUZJ100\b|\b100[-\s]?SERIES\b/.test(u) || (fam.includes('land cruiser') && year && year >= 1998 && year <= 2007)) series = 'UZJ100 (100-Series)';
    else if (/\bURJ200\b|\b200[-\s]?SERIES\b/.test(u) || (fam.includes('land cruiser') && year && year >= 2008 && year <= 2021)) series = 'URJ200 (200-Series)';
  }

  // Chevrolet / GMC K5 Blazer & Jimmy / Suburban
  if (!series && (fam.includes('blazer') || fam.includes('jimmy'))) {
    if (/\bK\/?5\b|\bK5\b/.test(u) || (year && year >= 1969 && year <= 1991 && !/\bS[-\s]?10\b|\bS[-\s]?15\b/.test(u))) {
      series = brand === 'gmc' ? 'K5 Jimmy (Full-Size)' : 'K5 Blazer (Full-Size)';
    } else if (/\bS[-\s]?10\b|\bS[-\s]?15\b/.test(u)) {
      series = 'S-10 / S-15 Compact';
    } else if (/\bTAHOE\b/.test(u)) {
      series = 'Tahoe / K1500 Blazer';
    }
  }

  // Pontiac GTO / Firebird / Trans Am
  if (!series && brand === 'pontiac') {
    if (/\bTHE\s+JUDGE\b|\bGTO\s+JUDGE\b|\bJUDGE\b/.test(u)) series = 'GTO The Judge';
    else if (/\bGTO\b/.test(u)) series = 'GTO';
    else if (/\bSUPER\s+DUTY\b|\bSD[-\s]?455\b/.test(u)) series = 'Trans Am SD-455';
    else if (/\bTRANS\s+AM\b/.test(u)) series = 'Firebird Trans Am';
    else if (/\bFORMULA\b/.test(u)) series = 'Firebird Formula';
    else if (/\bESPRIT\b/.test(u)) series = 'Firebird Esprit';
  }

  // Porsche 356 & 911 Chassis / Air-Cooled vs Water-Cooled Generations
  if (!series && brand === 'porsche' && fam.includes('356')) {
    if (/\b356\s*C\b|\b356\s*SC\b/.test(u) || (year && year >= 1964 && year <= 1965)) series = '356C / 356SC';
    else if (/\b356\s*B\b/.test(u) || (year && year >= 1960 && year <= 1963)) series = '356B (T5 / T6)';
    else if (/\b356\s*A\b/.test(u) || (year && year >= 1956 && year <= 1959)) series = '356A (T1 / T2)';
    else if (/\bPRE[-\s]?A\b/.test(u) || (year && year <= 1955)) series = '356 Pre-A';
  }

  // Jaguar E-Type (XKE) & XK Heritage
  if (!series && brand === 'jaguar') {
    if (/\bSERIES\s*(?:1|I)\b|\b3\.8\b|\b4\.2\b/.test(u) && (fam.includes('e-type') || fam.includes('xke') || (year && year >= 1961 && year <= 1968))) series = 'E-Type Series 1';
    else if (/\bSERIES\s*(?:2|II)\b/.test(u) || ((fam.includes('e-type') || fam.includes('xke')) && year && year >= 1969 && year <= 1970)) series = 'E-Type Series 2';
    else if (/\bSERIES\s*(?:3|III)\b|\bV12\b/.test(u) && (fam.includes('e-type') || fam.includes('xke') || (year && year >= 1971 && year <= 1974))) series = 'E-Type Series 3 V12';
    else if (/\bXK\s*120\b/.test(u)) series = 'XK120';
    else if (/\bXK\s*140\b/.test(u)) series = 'XK140';
    else if (/\bXK\s*150\b/.test(u)) series = 'XK150';
  }

  // Wave 3: Buick Grand National / GNX & Oldsmobile 442
  if (!series && (brand === 'buick' || fam.includes('grand national') || fam.includes('gnx'))) {
    if (/\bGNX\b/.test(u)) series = 'GNX';
    else if (/\bGRAND\s+NATIONAL\b|\bWE2\b/.test(u)) series = 'Grand National (G-Body)';
  }
  if (!series && (brand === 'oldsmobile' || fam.includes('442'))) {
    if (/\b4[-\s]?4[-\s]?2\b|\b442\b/.test(u)) series = '442';
  }

  // Wave 3: Jeep CJ / Grand Wagoneer / Wrangler & International Scout
  if (!series && (brand === 'jeep' || fam === 'cj' || fam.includes('wagoneer') || fam.includes('wrangler'))) {
    if (/\bCJ[-\s]?8\b|\bSCRAMBLER\b/.test(u)) series = 'CJ-8 Scrambler';
    else if (/\bCJ[-\s]?7\b/.test(u)) series = 'CJ-7';
    else if (/\bCJ[-\s]?5\b/.test(u)) series = 'CJ-5';
    else if (/\bGRAND\s+WAGONEER\b|\bSJ\b/.test(u)) series = 'SJ';
    else if (/\bRUBICON\s+392\b|\bJL\b/.test(u)) series = 'JL';
    else if (/\bTJ\b/.test(u)) series = 'TJ';
    else if (/\bYJ\b/.test(u)) series = 'YJ';
    else if (/\bJK\b/.test(u)) series = 'JK';
  }
  if (!series && (brand === 'international' || fam.includes('scout'))) {
    if (/\bSCOUT\s+II\b/.test(u)) series = 'Scout II';
    else if (/\bSCOUT\s+800[AB]?\b/.test(u)) series = 'Scout 800';
    else if (/\bSCOUT\s+80\b/.test(u)) series = 'Scout 80';
  }

  // Wave 3: JDM Icons — Datsun S30 Z, Nissan Skyline GT-R, Toyota Supra
  if (!series && (brand === 'datsun' || /\b2[468]0Z\b|\bFAIRLADY\s*Z\b|\bS30\b/.test(u))) {
    if (/\b240Z\b|\b260Z\b|\b280Z\b|\bHLS30\b|\bHS30\b|\bS30\b|\bFAIRLADY\s*Z\b/.test(u)) series = 'S30';
  }
  if (!series && (brand === 'nissan' || fam.includes('skyline') || fam.includes('gt-r'))) {
    if (/\bBNR34\b|\bR34\b/.test(u)) series = 'BNR34';
    else if (/\bBCNR33\b|\bR33\b/.test(u)) series = 'BCNR33';
    else if (/\bBNR32\b|\bR32\b/.test(u)) series = 'BNR32';
    else if (/\bR35\b/.test(u)) series = 'R35';
  }
  if (!series && (brand === 'toyota' || fam.includes('supra'))) {
    if (/\bJZA80\b|\bA80\b|\bMK\s*IV\b|\bMK4\b/.test(u)) series = 'JZA80';
    else if (/\bMA70\b|\bJZA70\b|\bA70\b|\bMK\s*III\b|\bMK3\b/.test(u)) series = 'A70';
    else if (/\bA90\b|\bA91\b|\bJ29\b|\bDB\d{2}\b|\bMK\s*V\b|\bMK5\b/.test(u)) series = 'A90';
  }

  // ── 2. TRIM PACKAGE EXTRACTION (Year-aware for Squarebody & Marque Trims) ─
  if (/\bCHEYENNE\s+SUPER\b/.test(u)) trim = 'Cheyenne Super';
  else if (/\bCHEYENNE\b/.test(u)) trim = 'Cheyenne';
  else if (/\bSCOTTSDALE\b/.test(u)) trim = 'Scottsdale';
  else if (/\bCUSTOM\s+DELUXE\b/.test(u)) trim = 'Custom Deluxe';
  else if (/\bSILVERADO\b/.test(u)) trim = 'Silverado';
  else if (/\bBIG\s+10\b/.test(u)) trim = 'Big 10';
  else if (/\b454\s+SS\b/.test(u)) trim = '454 SS';
  else if (/\bINDY\s+PACE\b|\bPACE\s+TRUCK\b/.test(u)) trim = 'Indy Hauler / Pace';
  else if (/\bCST\b|\bCUSTOM\s+SPORT\s+TRUCK\b/.test(u)) trim = 'CST (Custom Sport Truck)';
  else if (/\bSIERRA\s+CLASSIC\b/.test(u)) trim = 'Sierra Classic';
  else if (/\bSIERRA\s+GRANDE\b/.test(u)) trim = 'Sierra Grande';
  else if (/\bHIGH\s+SIERRA\b/.test(u)) trim = 'High Sierra';
  else if (/\bGENTLEMAN\s+JIM\b/.test(u)) trim = 'Gentleman Jim';
  else if (/\bSUPER\s+CUSTOM\b/.test(u)) trim = 'Super Custom';
  else if (/\bSIERRA\b/.test(u)) trim = 'Sierra';
  else if (/\bRANGER\s+XLT\b/.test(u)) trim = 'Ranger XLT';
  else if (/\bRANGER\s+LARIAT\b|\bLARIAT\b/.test(u)) trim = 'Lariat';
  else if (/\bRANGER\b/.test(u) && isPickupFamilyLabel(fam)) trim = 'Ranger Package';
  else if (/\bXLT\b/.test(u)) trim = 'XLT';
  else if (/\bEXPLORER\b/.test(u) && isPickupFamilyLabel(fam)) trim = 'Explorer Special';
  else if (/\bLIGHTNING\b|\bSVT\s+LIGHTNING\b/.test(u)) trim = 'SVT Lightning';
  else if (/\bRAPTOR\b/.test(u)) trim = 'Raptor';
  else if (/\bCUSTOM\b/.test(u)) trim = 'Custom / Restomod';
  else if (/\bSS\b|\bSUPER\s+SPORT\b/.test(u)) trim = 'SS (Super Sport)';
  else if (/\bZ\/?28\b/.test(u)) trim = 'Z/28';
  else if (/\bRS\b/.test(u) && fam === 'camaro') trim = 'RS (Rally Sport)';
  else if (/\bIROC[-\s]?Z\b/.test(u)) trim = 'IROC-Z';
  else if (/\bZL1\b/.test(u)) trim = 'ZL1';
  else if (/\bYENKO\b|\bCOPO\b|\bBALDWIN\b/.test(u)) trim = 'COPO / Yenko';
  else if (/\bR\/T\b|\bROAD\s*\/?\s*TRACK\b/.test(u)) trim = 'R/T (Road/Track)';
  else if (/\bCSL\b|\bCOMPETITION\b|\bM3\b|\bM5\b/.test(u) && brand === 'bmw') trim = 'M-Power';
  else if (/\bAMG\b/.test(u)) trim = 'AMG';
  else if (/\bEDDIE\s+BAUER\b/.test(u)) trim = 'Eddie Bauer';
  else if (/\bTRANS\s+AM\s+WS6\b|\bWS6\b/.test(u)) trim = 'Trans Am WS6';
  else if (/\bRUBICON\s+392\b/.test(u)) trim = 'Rubicon 392';
  else if (/\bTWIN\s+TURBO\b|\b2JZ[-\s]?GTE\b/.test(u)) trim = 'Twin Turbo';
  else if (/\bV[-\s]?SPEC(?:\s+II)?(?:\s+N[UÜ]R)?\b/.test(u)) trim = 'V-Spec';
  else if (/\bW[-\s]?30\b/.test(u)) trim = 'W-30';
  else if (/\bGRAND\s+NATIONAL\b/.test(u)) trim = 'Grand National';
  else if (/\bRENEGADE\b/.test(u)) trim = 'Renegade';
  else if (/\bRALLYE\b/.test(u) && (brand === 'international' || fam.includes('scout'))) trim = 'Rallye';

  // ── 3. BODY STYLE / DOOR CONFIGURATION EXTRACTION ─────────────────────────
  if (/\bSPLIT[-\s]?WINDOW\b/.test(u) || (fam === 'corvette' && year === 1963 && /\bCOUPE\b/.test(u))) {
    body = 'Split-Window Coupe';
  } else if (/\bGULLWING\b/.test(u) || (brand.startsWith('mercedes') && /\b300\s*SL\b/.test(u) && /\bCOUPE\b/.test(u))) {
    body = 'Gullwing Coupe';
  } else if (/\bFASTBACK\b|\bSPORTSROOF\b|\b2\+2\b/.test(u)) {
    body = 'Fastback';
  } else if (/\bCONVERTIBLE\b|\bCABRIOLET\b|\bDROPHEAD\b|\bVOLANTE\b/.test(u)) {
    body = 'Convertible / Cabriolet';
  } else if (/\bROADSTER\b|\bSPIDER\b|\bSPYDER\b|\bSPEEDSTER\b|\bGTS\b|\bAPERTA\b/.test(u)) {
    body = 'Roadster / Speedster';
  } else if (/\bTARGA\b|\bT[-\s]?TOP\b/.test(u)) {
    body = 'Targa / T-Top';
  } else if (/\bCOUPE\b|\bHARDTOP\b|\bBERLINETTA\b|\bGTB\b|\bNOTCHBACK\b/.test(u)) {
    body = 'Coupe / Hardtop';
  } else if (/\bSTEPSIDE\b|\bFENDERSIDE\b|\bFLARESIDE\b/.test(u)) {
    body = 'Stepside / Flareside';
  } else if (/\bFLEETSIDE\b|\bWIDELINE\b|\bSTYLESIDE\b|\bSWEPTLINE\b/.test(u)) {
    body = 'Fleetside / Styleside';
  } else if (/\bSHORT\s*BED\b|\bSHORT\s*BOX\b|\bSWB\b/.test(u)) {
    body = 'Short Bed (SWB)';
  } else if (/\bLONG\s*BED\b|\bLONG\s*BOX\b|\bLWB\b/.test(u)) {
    body = 'Long Bed (LWB)';
  } else if (/\bCREW\s+CAB\b|\b3\+3\b|\b4[-\s]?DOOR\b|\bSEDAN\b/.test(u)) {
    body = '4-Door / Crew Cab';
  } else if (/\bEXTENDED\s+CAB\b|\bSUPERCAB\b|\bCLUB\s+CAB\b/.test(u)) {
    body = 'Extended / SuperCab';
  } else if (/\b2[-\s]?DOOR\b/.test(u)) {
    body = '2-Door';
  } else if (/\bWAGON\b|\bNOMAD\b|\bSUBURBAN\b|\bTOURING\b|\bESTATE\b/.test(u)) {
    body = 'Wagon / Carryall';
  } else if (/\bPANEL\b|\bDELIVERY\b/.test(u)) {
    body = 'Panel Truck';
  } else if (isPickupFamilyLabel(fam)) {
    body = 'Standard Cab Pickup';
  }

  return { series, trim, body };
}

/**
 * Re-aggregates a family's sub-model TreemapNode[] and/or FamilySalePoint[] along the requested axis
 * (`series`, `trim`, `body`, or `raw`), preserving measured 12-month vs prior-12-month moves and ledger totals.
 */
export function buildFacetNodes(
  axis: FamilyFacetAxis,
  make: string | null | undefined,
  familyLabel: string | null | undefined,
  baseModels: TreemapNode[] | null | undefined,
  salesData: FamilySalePoint[] | null | undefined,
  eraFilterFn?: (year: number) => boolean,
): TreemapNode[] | null {
  if (!baseModels || baseModels.length === 0) return null;
  if (axis === 'raw') return baseModels;

  const pickFacet = (c: VehicleFacetClassification): string | null =>
    axis === 'series' ? c.series : axis === 'trim' ? c.trim : c.body;

  const fallbackLabel =
    axis === 'series' ? (isGmTruckBrand(make) && familyLabel === 'Truck' ? 'Series not recorded' : 'Standard Series')
      : axis === 'trim' ? 'Base / Unbadged Trim' : 'Standard Body';

  // When salesData is loaded (up to 12,000 dated sales enriched with vehicles.trim + body_style + listing_title),
  // compute the exact facet distribution from the enriched sales so records whose raw `vehicles.model` is just
  // "C10", "Pickup", "Mustang", or "Bel Air" are accurately partitioned into Silverado / Cheyenne Super / Scottsdale /
  // Fastback / 2-Door Hardtop / Stepside / Fleetside buckets!
  const buckets = new Map<
    string,
    {
      name: string;
      count: number;
      usd: number;
      sold_any: number;
      offered: number;
      dated: number;
      sold_12m: number;
      sold_prior_12m: number;
      usd_12m: number;
      usd_prior_12m: number;
      prices: number[];
      weightedMedianSum: number;
      weightedMedianCount: number;
      representativeModel: string;
      representativeUsd: number;
      badgeSvg?: string;
    }
  >();

  const stripEnrichedSuffix = (m: string) => m.split(' · ')[0].trim();

  if (salesData && salesData.length >= 10) {
    const nowMs = Date.now();
    const dayMs = 86_400_000;
    const cutoff12m = nowMs - 365 * dayMs;
    const cutoff24m = nowMs - 730 * dayMs;
    const measuredHouses = new Set(['Bring a Trailer', 'Mecum', 'Bonhams']);

    for (const s of salesData) {
      if (s.usd <= 0) continue;
      if (eraFilterFn && s.year != null && !eraFilterFn(s.year)) continue;
      const cls = classifyVehicleFacets(make, familyLabel, s.model, s.year);
      const facetLabel = pickFacet(cls) ?? fallbackLabel;
      const cleanModel = stripEnrichedSuffix(s.model ?? '') || facetLabel;
      const prev = buckets.get(facetLabel) ?? {
        name: facetLabel,
        count: 0,
        usd: 0,
        sold_any: 0,
        offered: 0,
        dated: 0,
        sold_12m: 0,
        sold_prior_12m: 0,
        usd_12m: 0,
        usd_prior_12m: 0,
        prices: [],
        weightedMedianSum: 0,
        weightedMedianCount: 0,
        representativeModel: cleanModel,
        representativeUsd: 0,
        badgeSvg: resolveTileBadgeSvg(make, familyLabel, facetLabel),
      };
      prev.count += 1;
      prev.usd += s.usd;
      prev.sold_any += 1;
      prev.offered += 1;
      prev.prices.push(s.usd);
      prev.weightedMedianSum += s.usd;
      prev.weightedMedianCount += 1;
      if (s.source && measuredHouses.has(s.source)) {
        prev.dated += 1;
        const t = Date.parse(s.sale_date);
        if (Number.isFinite(t)) {
          if (t > cutoff12m && t <= nowMs) {
            prev.sold_12m += 1;
            prev.usd_12m += s.usd;
          } else if (t > cutoff24m && t <= cutoff12m) {
            prev.sold_prior_12m += 1;
            prev.usd_prior_12m += s.usd;
          }
        }
      }
      if (s.usd > prev.representativeUsd) {
        prev.representativeUsd = s.usd;
        prev.representativeModel = cleanModel;
      }
      buckets.set(facetLabel, prev);
    }
  }

  // Merge or fall back to baseModels (all-time ledger) when salesData is absent or when baseModels has specific buckets
  for (const node of baseModels) {
    const cls = classifyVehicleFacets(make, familyLabel, node.name);
    const picked = pickFacet(cls);
    // If salesData already populated specific buckets, skip dumping generic unbadged baseModels into fallbackLabel
    if (salesData && salesData.length >= 10 && !picked) continue;
    const facetLabel = picked ?? fallbackLabel;
    if (salesData && salesData.length >= 10 && buckets.has(facetLabel)) continue;

    const prev = buckets.get(facetLabel) ?? {
      name: facetLabel,
      count: 0,
      usd: 0,
      sold_any: 0,
      offered: 0,
      dated: 0,
      sold_12m: 0,
      sold_prior_12m: 0,
      usd_12m: 0,
      usd_prior_12m: 0,
      prices: [],
      weightedMedianSum: 0,
      weightedMedianCount: 0,
      representativeModel: stripEnrichedSuffix(node.name),
      representativeUsd: 0,
      badgeSvg: resolveTileBadgeSvg(make, familyLabel, facetLabel),
    };
    const nodeUsd = node.usd ?? node.value ?? 0;
    prev.count += node.count ?? 0;
    prev.usd += nodeUsd;
    prev.sold_any += node.sold_any ?? node.count ?? 0;
    prev.offered += node.offered ?? node.count ?? 0;
    prev.dated += node.dated ?? 0;
    prev.sold_12m += node.sold_12m ?? 0;
    prev.sold_prior_12m += node.sold_prior_12m ?? 0;
    prev.usd_12m += node.usd_12m ?? 0;
    prev.usd_prior_12m += node.usd_prior_12m ?? 0;
    if (node.median_price && node.count > 0) {
      prev.weightedMedianSum += node.median_price * node.count;
      prev.weightedMedianCount += node.count;
    } else if (nodeUsd > 0 && node.count > 0) {
      prev.weightedMedianSum += nodeUsd;
      prev.weightedMedianCount += node.count;
    }
    if (nodeUsd > prev.representativeUsd) {
      prev.representativeUsd = nodeUsd;
      prev.representativeModel = stripEnrichedSuffix(node.name);
    }
    buckets.set(facetLabel, prev);
  }

  let totalFamilyCount = 0;
  for (const b of buckets.values()) {
    if (b.count > 0) totalFamilyCount += b.count;
  }

  const out: TreemapNode[] = [];
  for (const b of buckets.values()) {
    if (b.count <= 0) continue;
    let medianPrice: number | undefined;
    if (b.prices.length > 0) {
      const sorted = [...b.prices].sort((x, y) => x - y);
      const mid = sorted.length >> 1;
      medianPrice = Math.round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
    } else if (b.weightedMedianCount > 0) {
      medianPrice = Math.round(b.weightedMedianSum / b.weightedMedianCount);
    }
    const familySharePct = totalFamilyCount > 0 ? Number(((b.count / totalFamilyCount) * 100).toFixed(1)) : 0;
    out.push({
      name: b.name,
      count: b.count,
      value: b.usd > 0 ? b.usd : b.count,
      usd: b.usd,
      sold_any: b.sold_any,
      offered: b.offered,
      dated: b.dated,
      sold_12m: b.sold_12m,
      sold_prior_12m: b.sold_prior_12m,
      usd_12m: b.usd_12m,
      usd_prior_12m: b.usd_prior_12m,
      median_price: medianPrice,
      facetRepresentativeModel: b.representativeModel,
      badgeSvg: b.badgeSvg,
      facetAxis: axis,
      familySharePct,
    });
  }

  return out.sort((a, b) => (b.usd ?? b.value) - (a.usd ?? a.value) || b.count - a.count);
}

/**
 * Resolves a single vetted vector badge SVG for a specific facet tile or sub-model label
 * (e.g. "Silverado" -> SILVERADO 10 fender plate, "Cheyenne Super" -> CHEYENNE SUPER 10, "Fastback" -> 2+2 FASTBACK).
 */
export function resolveTileBadgeSvg(
  make: string | null | undefined,
  familyLabel: string | null | undefined,
  tileName: string | null | undefined,
  year?: number | null,
): string | undefined {
  if (!make || !tileName) return undefined;
  const brandLower = make.trim().toLowerCase();
  const tLower = tileName.trim().toLowerCase();

  const candidates = VETTED_IDENTITY_MARKS.filter((mark) => {
    if (mark.brand.toLowerCase() !== brandLower) return false;
    if (mark.markKind === 'marque_emblem') return false;
    if (year != null && (year < mark.yearStart || year > mark.yearEnd)) return false;
    return true;
  }).sort((a, b) => (b.trimPackage?.length ?? 0) - (a.trimPackage?.length ?? 0));

  for (const mark of candidates) {
    if (mark.trimPackage && tLower.includes(mark.trimPackage.toLowerCase())) {
      return mark.svgMarkup;
    }
    if (mark.seriesCode && tLower.startsWith(mark.seriesCode.toLowerCase())) {
      return mark.svgMarkup;
    }
    if (mark.bodyStyle && tLower.includes(mark.bodyStyle.toLowerCase())) {
      if (!mark.family || !familyLabel || mark.family.toLowerCase() === familyLabel.trim().toLowerCase()) {
        return mark.svgMarkup;
      }
    }
    if (mark.markKind === 'model_wordmark' && mark.displayLabel.toLowerCase().includes(tLower)) {
      return mark.svgMarkup;
    }
  }
  return undefined;
}

/**
 * Resolves the vetted, period-accurate identity marks (marque emblem + era/trim/body fender badges)
 * for the active breadcrumb scope.
 */
export function resolveVettedIdentityMarks(params: {
  make?: string | null;
  familyLabel?: string | null;
  model?: string | null;
  modelLabel?: string | null;
  year?: number | null;
  eraId?: string | null;
}): VehicleIdentityMark[] {
  const { make, familyLabel, year, eraId } = params;
  const model = params.model ?? params.modelLabel ?? null;
  if (!make) return [];
  const brandLower = make.trim().toLowerCase();
  const famLower = (familyLabel ?? '').trim().toLowerCase();
  const isPickup = isPickupFamilyLabel(famLower) || isPickupFamilyLabel(model);

  // Infer representative year range from explicit year or eraId (e.g. "1973-1987")
  let yearMin = year ?? null;
  let yearMax = year ?? null;
  if (yearMin == null && eraId) {
    const m = /^(\d{4})-(\d{4})$/.exec(eraId.trim());
    if (m) {
      yearMin = parseInt(m[1], 10);
      yearMax = parseInt(m[2], 10);
    }
  }

  const cls = classifyVehicleFacets(make, familyLabel, model, yearMin ?? undefined);

  return VETTED_IDENTITY_MARKS.filter((mark) => {
    if (mark.brand.toLowerCase() !== brandLower) return false;

    // Family match
    if (mark.family) {
      const mf = mark.family.toLowerCase();
      if (mf === 'pickup') {
        if (!isPickup) return false;
      } else if (mf !== famLower && !(model && model.toLowerCase().includes(mf))) {
        return false;
      }
    }

    // Year overlap check: never show a modern emblem on a vintage era or vice versa
    if (yearMin != null && yearMax != null) {
      if (mark.yearEnd < yearMin || mark.yearStart > yearMax) return false;
    } else if (mark.markKind === 'marque_emblem') {
      // When no year or era is selected yet, show the classic signature era mark for classic-dominant families
      if (brandLower === 'chevrolet' && isPickup) {
        return mark.id === 'chevy-bowtie-1973-1987';
      }
      return mark.yearStart <= 1975 && mark.yearEnd >= 1973;
    }

    // If a specific trim or body style is active in `model`, prioritize matching marks
    if (mark.trimPackage && cls.trim) {
      if (mark.trimPackage.toLowerCase() !== cls.trim.toLowerCase()) return false;
    }
    if (mark.bodyStyle && cls.body) {
      if (!cls.body.toLowerCase().includes(mark.bodyStyle.toLowerCase())) return false;
    }

    return true;
  });
}

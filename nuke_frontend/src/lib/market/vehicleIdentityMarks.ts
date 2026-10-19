import {
  VETTED_IDENTITY_MARKS as BASE_VETTED_IDENTITY_MARKS,
  classifyVehicleFacets,
  isPickupFamilyLabel,
  resolveTileBadgeSvg as baseResolveTileBadgeSvg,
  resolveVettedIdentityMarks as baseResolveVettedIdentityMarks,
  type FamilyFacetAxis,
  type VehicleFacetClassification,
  type VehicleIdentityMark,
} from '../../pages/familyFacetsAndEmblems';

export type { FamilyFacetAxis, VehicleFacetClassification, VehicleIdentityMark };
export { isPickupFamilyLabel };

export interface VehicleFacetResult {
  series: string | null;
  trim: string | null;
  bodyStyle: string | null;
  body: string | null;
}

export interface VehicleFacetInputObject {
  make?: string | null;
  family?: string | null;
  model?: string | null;
  subModel?: string | null;
  series?: string | null;
  trim?: string | null;
  body_style?: string | null;
  bodyStyle?: string | null;
  listing_title?: string | null;
  title?: string | null;
  year?: number | null;
}

/**
 * Wave 3 Vetted Era, Series & Trim SVG Vector Identity Marks (`viewBox="0 0 120 36"`).
 * Covers Ford Bronco (1st Gen, 2nd–5th Gen, 6th Gen), Chevrolet Camaro (1st–6th Gen),
 * Pontiac (GTO Goat/Judge, Firebird Trans Am Screaming Chicken + WS6),
 * Buick & Oldsmobile (Grand National / GNX Turbo 3.8, Oldsmobile 442),
 * Jeep & International (CJ-5/CJ-7/Scrambler, Grand Wagoneer woodgrain crest, Wrangler Rubicon 392, Scout 800 / Scout II),
 * and JDM Icons (Datsun S30 240Z/260Z/280Z Fairlady Z, Nissan Skyline GT-R R32/R33/R34/R35, Toyota Supra A70/A80/A90).
 */
export const WAVE3_IDENTITY_MARKS: readonly VehicleIdentityMark[] = [
  // ── Ford Bronco (1st Gen '66–'77, 2nd–5th Gen '78–'96, 6th Gen '21–'26) ────
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

  // ── Chevrolet Camaro (1st Gen '67–'69, 2nd Gen '70–'81, 3rd Gen '82–'92, 4th–6th Gen) ──
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

  // ── Pontiac GTO ('64–'74 Goat / Judge) & Firebird Trans Am ('70–'81 Screaming Chicken + WS6) ──
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

  // ── Buick Grand National / GNX ('82–'87) & Oldsmobile 442 ('64–'72) ────────
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

  // ── Jeep (CJ-5/CJ-7/Scrambler, Grand Wagoneer, Wrangler Rubicon 392) & International Scout ──
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

  // ── JDM Icons: Datsun S30 Z, Nissan Skyline GT-R, Toyota Supra ─────────────
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

/**
 * Complete catalog of vetted vector identity marks across Wave 1, Wave 2, and Wave 3.
 */
export const VEHICLE_IDENTITY_MARKS: readonly VehicleIdentityMark[] = [
  ...BASE_VETTED_IDENTITY_MARKS,
  ...WAVE3_IDENTITY_MARKS.filter(
    (w3) => !BASE_VETTED_IDENTITY_MARKS.some((b) => b.id === w3.id),
  ),
];

export const VETTED_IDENTITY_MARKS = VEHICLE_IDENTITY_MARKS;

const KNOWN_BRANDS = new Set([
  'chevrolet',
  'gmc',
  'ford',
  'dodge',
  'plymouth',
  'pontiac',
  'buick',
  'oldsmobile',
  'jeep',
  'international',
  'datsun',
  'nissan',
  'toyota',
  'porsche',
  'bmw',
  'mercedes-benz',
  'mercedes',
  'ferrari',
  'jaguar',
]);

const KNOWN_LEGACY_FAMILIES = new Set([
  'pickup',
  'c10',
  'k10',
  'c20',
  'k20',
  'c30',
  'k30',
  '3100',
  'f-100',
  'f-150',
  'f-250',
  'mustang',
  'corvette',
  '911',
  '356',
  'bel air',
  'chevelle',
  'charger',
  'challenger',
  'm3',
  'm5',
  'sl',
  '355',
  'land cruiser',
  'blazer',
  'jimmy',
  'e-type',
]);

function extractYearFromText(text: string): number | null {
  const m = /\b(19[4-9]\d|20[0-3]\d)\b/.exec(text);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Deterministically classifies a vehicle's orthogonal `series` (chassis/generation code),
 * `trim` (factory performance/luxury package), and `bodyStyle` (roof/door configuration).
 *
 * Supports both:
 * 1. `classifyVehicleFacet(title, subModel?, trim?, bodyStyle?)`
 * 2. `classifyVehicleFacet(inputObject)` (compatible with `VehicleTaxonomyInput`)
 * 3. `classifyVehicleFacet(make, family, rawModel, year)`
 */
export function classifyVehicleFacet(
  titleOrInput: VehicleFacetInputObject | string | null | undefined,
  subModelOrFamily?: string | null,
  trimOrRawModel?: string | null,
  bodyStyleOrYear?: string | number | null,
): VehicleFacetResult {
  // Handle object input (`VehicleTaxonomyInput` / `VehicleFacetInputObject`)
  if (typeof titleOrInput === 'object' && titleOrInput !== null) {
    const compositeText = [
      titleOrInput.year ? String(titleOrInput.year) : null,
      titleOrInput.make,
      titleOrInput.family,
      titleOrInput.model,
      titleOrInput.subModel,
      titleOrInput.series,
      titleOrInput.trim,
      titleOrInput.bodyStyle ?? titleOrInput.body_style,
      titleOrInput.title ?? titleOrInput.listing_title,
    ]
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      .join(' ');

    const w3 = classifyWave3Text(
      compositeText,
      titleOrInput.subModel ?? titleOrInput.series ?? titleOrInput.model ?? null,
      titleOrInput.trim ?? null,
      titleOrInput.bodyStyle ?? titleOrInput.body_style ?? null,
      titleOrInput.year ?? extractYearFromText(compositeText),
    );

    const legacy = classifyVehicleFacets(
      titleOrInput.make ?? null,
      titleOrInput.family ?? titleOrInput.model ?? null,
      compositeText,
      titleOrInput.year ?? undefined,
    );

    const isWave3Family = isWave3TargetVehicle(compositeText);
    const series =
      (isWave3Family ? w3.series ?? legacy.series : legacy.series ?? w3.series) ??
      (titleOrInput.series?.trim() || null);
    const trim =
      (isWave3Family ? w3.trim ?? legacy.trim : legacy.trim ?? w3.trim) ??
      (titleOrInput.trim?.trim() || null);
    const resolvedBody =
      (isWave3Family ? w3.bodyStyle ?? legacy.body : legacy.body ?? w3.bodyStyle) ??
      ((titleOrInput.bodyStyle ?? titleOrInput.body_style)?.trim() || null);

    return {
      series,
      trim,
      bodyStyle: resolvedBody,
      body: resolvedBody,
    };
  }

  // Handle legacy 4-arg `(make, family, rawModel, year)` when arg1 is a bare brand & arg2 is a legacy family
  if (
    typeof titleOrInput === 'string' &&
    KNOWN_BRANDS.has(titleOrInput.trim().toLowerCase()) &&
    typeof subModelOrFamily === 'string' &&
    KNOWN_LEGACY_FAMILIES.has(subModelOrFamily.trim().toLowerCase()) &&
    typeof trimOrRawModel === 'string' &&
    (typeof bodyStyleOrYear === 'number' || bodyStyleOrYear === undefined || bodyStyleOrYear === null)
  ) {
    const legacy = classifyVehicleFacets(
      titleOrInput,
      subModelOrFamily,
      trimOrRawModel,
      typeof bodyStyleOrYear === 'number' ? bodyStyleOrYear : undefined,
    );
    return {
      series: legacy.series,
      trim: legacy.trim,
      bodyStyle: legacy.body,
      body: legacy.body,
    };
  }

  const title = typeof titleOrInput === 'string' ? titleOrInput : '';
  const subModel = typeof subModelOrFamily === 'string' ? subModelOrFamily : '';
  const explicitTrim = typeof trimOrRawModel === 'string' ? trimOrRawModel : '';
  const explicitBody = typeof bodyStyleOrYear === 'string' ? bodyStyleOrYear : '';
  const explicitYear = typeof bodyStyleOrYear === 'number' ? bodyStyleOrYear : null;

  const combined = [title, subModel, explicitTrim, explicitBody]
    .filter((s) => s && s.trim().length > 0)
    .join(' ');

  if (!combined.trim()) {
    return { series: null, trim: null, bodyStyle: null, body: null };
  }

  const year = explicitYear ?? extractYearFromText(combined);
  return classifyWave3Text(combined, subModel || null, explicitTrim || null, explicitBody || null, year);
}

function isWave3TargetVehicle(text: string): boolean {
  const u = text.toUpperCase();
  return (
    /\bBRONCO\b|\bU1[345]\b/.test(u) ||
    /\bCAMARO\b|\bIROC[-\s]?Z\b|\bZ\/?28\b|\bZL1\b/.test(u) ||
    /\bGTO\b|\bTHE\s+JUDGE\b|\bFIREBIRD\b|\bTRANS\s+AM\b|\bWS6\b/.test(u) ||
    /\bGRAND\s+NATIONAL\b|\bGNX\b|\bREGAL\s+T[-\s]?TYPE\b|\b442\b|\b4-4-2\b|\bW-?30\b/.test(u) ||
    /\bCJ[-\s]?[5678]\b|\bSCRAMBLER\b|\bGRAND\s+WAGONEER\b|\bWAGONEER\b|\bWRANGLER\b|\bRUBICON\b|\bSCOUT\b/.test(u) ||
    /\b240Z\b|\b260Z\b|\b280Z\b|\b280ZX\b|\b300ZX\b|\bFAIRLADY\s*Z\b|\bHLS30\b|\bS30\b/.test(u) ||
    /\bSKYLINE\b|\bGT-R\b|\bGTR\b|\bBNR3[24]\b|\bBCNR33\b|\bR3[2345]\b|\bKPGC1\d+\b|\bHAKOSUKA\b|\bKENMERI\b/.test(u) ||
    /\bSUPRA\b|\bJZA80\b|\bJZA70\b|\bMA70\b|\bA70\b|\bA80\b|\bA90\b/.test(u)
  );
}

function classifyWave3Text(
  combined: string,
  subModel: string | null,
  explicitTrim: string | null,
  explicitBody: string | null,
  year: number | null,
): VehicleFacetResult {
  const u = combined.toUpperCase();
  const subUpper = (subModel ?? '').trim().toUpperCase();
  const trimUpper = (explicitTrim ?? '').trim().toUpperCase();
  const bodyUpper = (explicitBody ?? '').trim().toUpperCase();

  let series: string | null = null;
  let trim: string | null = null;
  let bodyStyle: string | null = null;

  // ── 1. SERIES (CHASSIS / GENERATION CODE) ──────────────────────────────────
  // JDM Icons: Datsun Z (S30 / S130 / Z31 / Z32)
  if (/\bHLS30\b|\bHS30\b|\bS30\b|\b240Z\b|\b260Z\b|\b280Z\b|\bFAIRLADY\s*Z(?:432)?\b/.test(u) && !/\b280ZX\b/.test(u)) {
    series = 'S30';
  } else if (/\b280ZX\b|\bS130\b/.test(u)) {
    series = 'S130';
  } else if (/\bZ32\b/.test(u) || (/\b300ZX\b/.test(u) && year && year >= 1990)) {
    series = 'Z32';
  } else if (/\bZ31\b|\b300ZX\b/.test(u)) {
    series = 'Z31';
  }

  // JDM Icons: Nissan Skyline GT-R (KPGC10 / KPGC110 / BNR32 / BCNR33 / BNR34 / R35)
  if (!series && (/\bSKYLINE\b|\bGT-R\b|\bGTR\b|\bBNR3[24]\b|\bBCNR33\b|\bKPGC1\d+\b|\bHAKOSUKA\b|\bKENMERI\b/.test(u))) {
    if (/\bBNR34\b|\bR34\b/.test(u) || (year && year >= 1999 && year <= 2002)) {
      series = 'BNR34';
    } else if (/\bBCNR33\b|\bR33\b/.test(u) || (year && year >= 1995 && year <= 1998)) {
      series = 'BCNR33';
    } else if (/\bBNR32\b|\bR32\b/.test(u) || (year && year >= 1989 && year <= 1994)) {
      series = 'BNR32';
    } else if (/\bR35\b/.test(u) || (year && year >= 2007)) {
      series = 'R35';
    } else if (/\bKPGC110\b|\bKENMERI\b/.test(u) || year === 1973) {
      series = 'KPGC110';
    } else if (/\bKPGC10\b|\bPGC10\b|\bHAKOSUKA\b/.test(u) || (year && year >= 1969 && year <= 1972)) {
      series = 'KPGC10';
    }
  }

  // JDM Icons: Toyota Supra (A40 / A60 / A70 / JZA80 / A90)
  if (!series && (/\bSUPRA\b|\bJZA80\b|\bJZA70\b|\bMA70\b|\bA70\b|\bA80\b|\bA90\b/.test(u))) {
    if (/\bJZA80\b|\bA80\b|\bMK\s*IV\b|\bMK\s*4\b|\b2JZ\b/.test(u) || (year && year >= 1993 && year <= 2002)) {
      series = 'JZA80';
    } else if (/\bMA70\b|\bJZA70\b|\bGA70\b|\bA70\b|\bMK\s*III\b|\bMK\s*3\b|\b7M-GTE\b|\b1JZ\b/.test(u) || (year && year >= 1986 && year <= 1992)) {
      series = 'A70';
    } else if (/\bA90\b|\bA91\b|\bJ29\b|\bGR\s+SUPRA\b|\bMK\s*V\b|\bMK\s*5\b/.test(u) || (year && year >= 2020)) {
      series = 'A90';
    } else if (/\bMA61\b|\bA60\b|\bCELICA\s+SUPRA\b|\bMK\s*II\b|\bMK\s*2\b/.test(u) || (year && year >= 1982 && year <= 1985)) {
      series = 'A60';
    } else if (/\bMA46\b|\bMA47\b|\bA40\b|\bMK\s*I\b/.test(u) || (year && year >= 1978 && year <= 1981)) {
      series = 'A40';
    }
  }

  // Ford Bronco (U13 / U14 / U15 / FSB / U725)
  if (!series && (/\bBRONCO\b|\bU1[345]\b/.test(u))) {
    if (/\bU13\b/.test(u) || (year && year >= 1966 && year <= 1968 && /\bROADSTER\b/.test(u))) {
      series = 'U13';
    } else if (/\bU14\b|\bHALF[-\s]?CAB\b/.test(u)) {
      series = 'U14';
    } else if (/\bU15\b/.test(u) || (year && year >= 1966 && year <= 1977)) {
      series = 'U15';
    } else if (/\bU725\b|\b6TH\s+GEN\b|\bRAPTOR\b|\bSASQUATCH\b|\bBADLANDS\b|\bWILDTRAK\b/.test(u) || (year && year >= 2021)) {
      series = 'U725';
    } else if (year && year >= 1978 && year <= 1996) {
      series = 'FSB';
    } else if (/\bEDDIE\s+BAUER\b|\bXLT\b/.test(u)) {
      series = 'FSB';
    }
  }

  // Chevrolet Camaro
  if (!series && (/\bCAMARO\b|\bIROC[-\s]?Z\b/.test(u))) {
    if (/\bIROC[-\s]?Z\b|\bIROC\b/.test(u)) {
      series = 'IROC-Z';
    } else if (/\bZL1\s+1LE\b|\bZL1\b/.test(u) || (year && year >= 2016)) {
      series = '6th Gen';
    } else if (year && year >= 1967 && year <= 1969) {
      series = '1st Gen';
    } else if (year && year >= 1970 && year <= 1981) {
      series = '2nd Gen';
    } else if (year && year >= 1982 && year <= 1992) {
      series = '3rd Gen';
    } else if (year && year >= 1993 && year <= 2002) {
      series = '4th Gen';
    } else if (year && year >= 2010 && year <= 2015) {
      series = '5th Gen';
    } else if (/\bRS\/SS\b|\bSS\/RS\b|\bSS\s*396\b|\bZ\/28\b/.test(u)) {
      series = '1st Gen';
    }
  }

  // Pontiac GTO & Firebird Trans Am
  if (!series && (/\bGTO\b|\bTHE\s+JUDGE\b|\bFIREBIRD\b|\bTRANS\s+AM\b/.test(u))) {
    if (/\bGTO\b|\bTHE\s+JUDGE\b/.test(u)) {
      series = 'GTO';
    } else if (/\bTRANS\s+AM\b/.test(u)) {
      series = 'Trans Am';
    } else if (/\bFORMULA\b/.test(u)) {
      series = 'Firebird Formula';
    } else if (/\bFIREBIRD\b/.test(u)) {
      series = 'Firebird';
    }
  }

  // Buick Grand National / GNX & Oldsmobile 442
  if (!series && (/\bGNX\b|\bGRAND\s+NATIONAL\b|\bT[-\s]?TYPE\b|\bWE2\b/.test(u))) {
    if (/\bGNX\b/.test(u)) {
      series = 'GNX';
    } else if (/\bGRAND\s+NATIONAL\b|\bWE2\b/.test(u)) {
      series = 'Grand National';
    } else if (/\bT[-\s]?TYPE\b/.test(u)) {
      series = 'T-Type';
    }
  }

  if (!series && (/\b442\b|\b4-4-2\b|\bW-?30\b|\bHURST\s*\/\s*OLDS\b/.test(u))) {
    series = '442';
  }

  // Jeep (CJ-5 / CJ-7 / Scrambler, Grand Wagoneer SJ, Wrangler YJ/TJ/JK/JL) & International Scout
  if (!series && (/\bCJ[-\s]?[5678]\b|\bSCRAMBLER\b|\bWAGONEER\b|\bWRANGLER\b|\bRUBICON\b|\bSCOUT\b/.test(u))) {
    if (/\bCJ[-\s]?8\b|\bSCRAMBLER\b/.test(u)) {
      series = 'CJ-8 Scrambler';
    } else if (/\bCJ[-\s]?7\b/.test(u)) {
      series = 'CJ-7';
    } else if (/\bCJ[-\s]?5\b/.test(u)) {
      series = 'CJ-5';
    } else if (/\bCJ[-\s]?6\b/.test(u)) {
      series = 'CJ-6';
    } else if (/\bGRAND\s+WAGONEER\b|\bWAGONEER\b|\bSJ\b/.test(u)) {
      series = 'SJ';
    } else if (/\bRUBICON\s+392\b|\bJL\b|\bJLU\b/.test(u) || (/\bWRANGLER\b/.test(u) && year && year >= 2018)) {
      series = 'JL';
    } else if (/\bJK\b|\bJKU\b/.test(u) || (/\bWRANGLER\b/.test(u) && year && year >= 2007 && year <= 2017)) {
      series = 'JK';
    } else if (/\bTJ\b|\bLJ\b/.test(u) || (/\bWRANGLER\b/.test(u) && year && year >= 1997 && year <= 2006)) {
      series = 'TJ';
    } else if (/\bYJ\b/.test(u) || (/\bWRANGLER\b/.test(u) && year && year >= 1987 && year <= 1995)) {
      series = 'YJ';
    } else if (/\bSCOUT\s+II\b|\bSCOUT\s+2\b|\bTERRA\b|\bTRAVELER\b|\bSSII\b/.test(u) || (/\bSCOUT\b/.test(u) && year && year >= 1971 && year <= 1980)) {
      series = 'Scout II';
    } else if (/\bSCOUT\s+800[AB]?\b/.test(u) || (/\bSCOUT\b/.test(u) && year && year >= 1965 && year <= 1971)) {
      series = 'Scout 800';
    } else if (/\bSCOUT\s+80\b/.test(u) || (/\bSCOUT\b/.test(u) && year && year >= 1961 && year <= 1965)) {
      series = 'Scout 80';
    }
  }

  // ── 2. TRIM PACKAGE EXTRACTION ─────────────────────────────────────────────
  if (/\bRUBICON\s+392\b|\b392\s+HEMI\b/.test(u)) {
    trim = 'Rubicon 392';
  } else if (/\bRUBICON\b/.test(u)) {
    trim = 'Rubicon';
  } else if (/\bTRANS\s+AM\s+WS6\b|\bWS6\b/.test(u)) {
    trim = 'Trans Am WS6';
  } else if (/\bSD[-\s]?455\b|\bSUPER\s+DUTY\s+455\b/.test(u)) {
    trim = 'SD-455';
  } else if (/\bTHE\s+JUDGE\b|\bJUDGE\b/.test(u)) {
    trim = 'The Judge';
  } else if (/\bSS\s*396\b|\bRS\/SS\s*396\b/.test(u)) {
    trim = 'SS 396';
  } else if (/\bSS\s*454\b/.test(u)) {
    trim = 'SS 454';
  } else if (/\bZL1\s+1LE\b/.test(u)) {
    trim = 'ZL1 1LE';
  } else if (/\bZL1\b/.test(u)) {
    trim = 'ZL1';
  } else if (/\bIROC[-\s]?Z\b/.test(u)) {
    trim = 'IROC-Z';
  } else if (/\bZ\/?28\b/.test(u)) {
    trim = 'Z/28';
  } else if (/\bRS\/SS\b|\bSS\/RS\b/.test(u)) {
    trim = 'RS/SS';
  } else if (/\bEDDIE\s+BAUER\b/.test(u)) {
    trim = 'Eddie Bauer';
  } else if (/\bSTROPPE\b|\bBAJA\s+BRONCO\b/.test(u)) {
    trim = 'Stroppe Baja';
  } else if (/\bRAPTOR\b/.test(u)) {
    trim = 'Raptor';
  } else if (/\bRANGER\s+XLT\b/.test(u)) {
    trim = 'Ranger XLT';
  } else if (/\bXLT\b/.test(u)) {
    trim = 'XLT';
  } else if (/\bV[-\s]?SPEC\s+II\s+N[UÜ]R\b/.test(u)) {
    trim = 'V-Spec II Nür';
  } else if (/\bV[-\s]?SPEC\s+II\b/.test(u)) {
    trim = 'V-Spec II';
  } else if (/\bV[-\s]?SPEC\b/.test(u)) {
    trim = 'V-Spec';
  } else if (/\bM[-\s]?SPEC\b/.test(u)) {
    trim = 'M-Spec';
  } else if (/\bTWIN\s+TURBO\b|\b2JZ-GTE\b|\bTURBO\s+R\b/.test(u)) {
    trim = 'Twin Turbo';
  } else if (/\bW-?30\b/.test(u)) {
    trim = 'W-30';
  } else if (/\bHURST\s*\/\s*OLDS\b/.test(u)) {
    trim = 'Hurst/Olds';
  } else if (/\bGNX\b/.test(u) && /\bGRAND\s+NATIONAL\b/.test(u)) {
    trim = 'Grand National';
  } else if (/\bGRAND\s+NATIONAL\b|\bWE2\b/.test(u)) {
    trim = 'Grand National';
  } else if (/\bGNX\b/.test(u)) {
    trim = 'GNX';
  } else if (/\bGOLDEN\s+EAGLE\b/.test(u)) {
    trim = 'Golden Eagle';
  } else if (/\bRENEGADE\b/.test(u)) {
    trim = 'Renegade';
  } else if (/\bLAREDO\b/.test(u)) {
    trim = 'Laredo';
  } else if (/\bGRAND\s+WAGONEER\b/.test(u)) {
    trim = 'Grand Wagoneer';
  } else if (/\bRALLYE\b/.test(u)) {
    trim = 'Rallye';
  } else if (/\bTRAVELER\b/.test(u)) {
    trim = 'Traveler';
  } else if (/\bTERRA\b/.test(u)) {
    trim = 'Terra';
  } else if (/\bZ432\b|\b432\b/.test(u) && series === 'S30') {
    trim = 'Z432';
  } else if (/\bFAIRLADY\s*Z\b/.test(u) && series === 'S30') {
    trim = 'Fairlady Z';
  } else if (/\bSERIES\s+I\b/.test(u) && series === 'S30') {
    trim = 'Series I';
  } else if (series === 'S30' && /\b240Z\b/.test(u)) {
    trim = '240Z';
  } else if (series === 'S30' && /\b260Z\b/.test(u)) {
    trim = '260Z';
  } else if (series === 'S30' && /\b280Z\b/.test(u)) {
    trim = '280Z';
  } else if (/\bTRANS\s+AM\b/.test(u)) {
    trim = 'Trans Am';
  } else if (/\bSS\b|\bSUPER\s+SPORT\b/.test(u)) {
    trim = 'SS';
  } else if (trimUpper) {
    trim = explicitTrim!.trim();
  }

  // ── 3. BODY STYLE EXTRACTION ───────────────────────────────────────────────
  if (/\bTARGA\b|\bSPORT\s+ROOF\b|\bAEROTOP\b/.test(u) || /\bTARGA\b|\bSPORT\s+ROOF\b/.test(bodyUpper)) {
    bodyStyle = 'Targa (Sport Roof)';
  } else if (/\bT[-\s]?TOP\b|\bHURST\s+HATCH\b|\bT[-\s]?BAR\b/.test(u) || /\bT[-\s]?TOP\b/.test(bodyUpper)) {
    bodyStyle = 'T-Top Coupe';
  } else if (
    /\bSOFT\s*TOP\b|\bSOFT[-\s]?TOP\b|\bCANVAS\s+TOP\b|\bOPEN[-\s]?TOP\s+4X4\b|\bBIKINI\s+TOP\b/.test(u) ||
    ((series === 'CJ-5' || series === 'CJ-7' || series === 'CJ-8 Scrambler' || series === 'YJ' || series === 'TJ' || series === 'JK' || series === 'JL') &&
      !/\bHARD\s*TOP\b|\bHARDTOP\b|\bWAGON\b/.test(u))
  ) {
    bodyStyle = 'Soft Top 4x4';
  } else if (
    /\b2[-\s]?DOOR\s+WAGON\b/.test(u) ||
    ((series === 'U15' || series === 'FSB' || series === 'Scout II' || series === 'Scout 800' || series === 'Scout 80') &&
      !/\bHALF[-\s]?CAB\b|\bPICKUP\b|\bTERRA\b|\bROADSTER\b|\bSOFT\s*TOP\b|\b4[-\s]?DOOR\b/.test(u))
  ) {
    bodyStyle = '2-Door Wagon';
  } else if (/\b4[-\s]?DOOR\s+WAGON\b/.test(u) || series === 'SJ') {
    bodyStyle = /\b2[-\s]?DOOR\b/.test(u) ? '2-Door Wagon' : '4-Door Wagon';
  } else if (
    /\b2[-\s]?DOOR\s+HARDTOP\b|\bHOLIDAY\s+COUPE\b|\bSPORT\s+COUPE\b|\bHARDTOP\s+COUPE\b|\bHARDTOP\b/.test(u) ||
    ((series === 'S30' ||
      series === 'BNR32' ||
      series === 'BCNR33' ||
      series === 'BNR34' ||
      series === 'R35' ||
      series === 'JZA80' ||
      series === 'A70' ||
      series === 'A90' ||
      series === 'GNX' ||
      series === 'Grand National' ||
      series === '442' ||
      series === 'GTO' ||
      series === 'Trans Am' ||
      series === 'IROC-Z' ||
      series === '1st Gen' ||
      series === '2nd Gen') &&
      !/\bCONVERTIBLE\b|\bCABRIOLET\b|\bT[-\s]?TOP\b|\bTARGA\b|\b2\+2\b/.test(u))
  ) {
    bodyStyle = '2-Door Hardtop';
  } else if (/\bCONVERTIBLE\b|\bCABRIOLET\b/.test(u)) {
    bodyStyle = 'Convertible';
  } else if (/\bFASTBACK\b|\b2\+2\b/.test(u)) {
    bodyStyle = 'Fastback';
  } else if (/\bHALF[-\s]?CAB\b|\bU14\b|\bTERRA\b/.test(u)) {
    bodyStyle = 'Half-Cab Pickup';
  } else if (/\bROADSTER\b|\bU13\b/.test(u)) {
    bodyStyle = 'Roadster';
  } else if (/\bCOUPE\b/.test(u)) {
    bodyStyle = '2-Door Hardtop';
  } else if (/\bWAGON\b/.test(u)) {
    bodyStyle = '2-Door Wagon';
  } else if (bodyUpper) {
    bodyStyle = explicitBody!.trim();
  }

  // Fallback to subModel for series if not yet matched
  if (!series && subUpper) {
    series = subModel!.trim();
  }

  return {
    series,
    trim,
    bodyStyle,
    body: bodyStyle,
  };
}

/**
 * Resolves the best matching `VehicleIdentityMark` from `VEHICLE_IDENTITY_MARKS`
 * for a title, make/family/model, or facet classification.
 */
export function resolveVehicleIdentityMark(
  titleOrInput: (VehicleFacetInputObject & { facetLabel?: string | null }) | string | null | undefined,
  subModelOrFamily?: string | null,
  trimOrModel?: string | null,
  yearArg?: number | null,
): VehicleIdentityMark | null {
  let composite = '';
  let year: number | null = typeof yearArg === 'number' ? yearArg : null;

  if (typeof titleOrInput === 'object' && titleOrInput !== null) {
    composite = [
      titleOrInput.make,
      titleOrInput.family,
      titleOrInput.model,
      titleOrInput.subModel,
      titleOrInput.series,
      titleOrInput.trim,
      titleOrInput.facetLabel,
      titleOrInput.bodyStyle ?? titleOrInput.body_style,
      titleOrInput.title ?? titleOrInput.listing_title,
    ]
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      .join(' ');
    year = titleOrInput.year ?? year ?? extractYearFromText(composite);
  } else {
    composite = [titleOrInput, subModelOrFamily, trimOrModel]
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      .join(' ');
    year = year ?? extractYearFromText(composite);
  }

  const u = composite.toUpperCase();
  const facets = classifyVehicleFacet(composite, subModelOrFamily ?? null, trimOrModel ?? null, year);

  // Check Wave 3 marks first for exact family/series/trim/era match
  for (const mark of WAVE3_IDENTITY_MARKS) {
    const withinEra = year == null || (year >= mark.yearStart && year <= mark.yearEnd);
    if (!withinEra) continue;

    if (mark.id === 'bronco-1st-gen-script-66-77' && /\bBRONCO\b|\bU1[345]\b/.test(u) && (year != null ? year <= 1977 : /\bU1[345]\b|\bEARLY\s+BRONCO\b/.test(u))) {
      return mark;
    }
    if (mark.id === 'bronco-xlt-eddie-bauer-78-96' && /\bBRONCO\b/.test(u) && ((year != null && year >= 1978 && year <= 1996) || /\bEDDIE\s+BAUER\b|\bXLT\b/.test(u))) {
      return mark;
    }
    if (mark.id === 'bronco-6th-gen-raptor-21-26' && /\bBRONCO\b/.test(u) && ((year != null && year >= 2021) || /\bRAPTOR\b|\bU725\b|\bWILDTRAK\b|\bBADLANDS\b/.test(u))) {
      return mark;
    }
    if (mark.id === 'camaro-1st-gen-z28-rsss-67-69' && /\bCAMARO\b/.test(u) && ((year != null && year >= 1967 && year <= 1969) || /\bRS\/SS\b|\bSS\s*396\b|\bZ\/28\b/.test(u))) {
      return mark;
    }
    if (mark.id === 'camaro-2nd-gen-z28-70-81' && /\bCAMARO\b/.test(u) && ((year != null && year >= 1970 && year <= 1981) || /\bZ28\b/.test(u))) {
      return mark;
    }
    if (mark.id === 'camaro-3rd-gen-iroc-z-82-92' && (/\bIROC[-\s]?Z\b/.test(u) || (/\bCAMARO\b/.test(u) && year != null && year >= 1982 && year <= 1992))) {
      return mark;
    }
    if (mark.id === 'camaro-4th-6th-gen-ss-zl1-1le-93-24' && /\bCAMARO\b/.test(u) && (/\bZL1\b|\b1LE\b/.test(u) || (year != null && year >= 1993))) {
      return mark;
    }
    if (mark.id === 'pontiac-gto-goat-judge-64-74' && (/\bGTO\b|\bTHE\s+JUDGE\b/.test(u))) {
      return mark;
    }
    if (mark.id === 'pontiac-firebird-trans-am-ws6-70-81' && (/\bFIREBIRD\b|\bTRANS\s+AM\b|\bWS6\b/.test(u))) {
      return mark;
    }
    if (mark.id === 'buick-grand-national-gnx-82-87' && (/\bGRAND\s+NATIONAL\b|\bGNX\b|\bTURBO\s+3\.8\b|\bREGAL\s+T[-\s]?TYPE\b/.test(u))) {
      return mark;
    }
    if (mark.id === 'oldsmobile-442-w30-64-72' && (/\b442\b|\b4-4-2\b|\bW-?30\b/.test(u))) {
      return mark;
    }
    if (mark.id === 'jeep-cj5-cj7-scrambler-55-86' && (/\bCJ[-\s]?[5678]\b|\bSCRAMBLER\b/.test(u))) {
      return mark;
    }
    if (mark.id === 'jeep-grand-wagoneer-woodgrain-84-91' && (/\bGRAND\s+WAGONEER\b|\bWAGONEER\b/.test(u))) {
      return mark;
    }
    if (mark.id === 'jeep-wrangler-rubicon-392-87-26' && (/\bWRANGLER\b|\bRUBICON\b/.test(u))) {
      return mark;
    }
    if (mark.id === 'international-scout-800-scout-ii-61-80' && /\bSCOUT\b/.test(u)) {
      return mark;
    }
    if (mark.id === 'datsun-s30-240z-260z-280z-69-78' && (/\b240Z\b|\b260Z\b|\b280Z\b|\bFAIRLADY\s*Z\b|\bS30\b/.test(u))) {
      return mark;
    }
    if (mark.id === 'nissan-skyline-gtr-r32-r33-r34-r35-89-26' && (/\bSKYLINE\b|\bGT-R\b|\bGTR\b|\bBNR3[24]\b|\bBCNR33\b|\bR3[2345]\b/.test(u))) {
      return mark;
    }
    if (mark.id === 'toyota-supra-a70-a80-a90-79-26' && (/\bSUPRA\b|\bJZA80\b|\bJZA70\b|\bMA70\b/.test(u))) {
      return mark;
    }
  }

  // Fallback by seriesCode or trimPackage match across all marks
  if (facets.series || facets.trim) {
    const matched = VEHICLE_IDENTITY_MARKS.find(
      (m) =>
        m.markKind !== 'marque_emblem' &&
        (year == null || (year >= m.yearStart && year <= m.yearEnd)) &&
        ((facets.series && m.seriesCode && m.seriesCode.toLowerCase() === facets.series.toLowerCase()) ||
          (facets.trim && m.trimPackage && m.trimPackage.toLowerCase() === facets.trim.toLowerCase())),
    );
    if (matched) return matched;
  }

  return null;
}

export function resolveTileBadgeSvg(
  make: string | null | undefined,
  familyLabel: string | null | undefined,
  tileName: string | null | undefined,
  year?: number | null,
): string | undefined {
  const base = baseResolveTileBadgeSvg(make, familyLabel, tileName, year);
  if (base) return base;
  const mark = resolveVehicleIdentityMark(
    [make, familyLabel, tileName].filter(Boolean).join(' '),
    familyLabel,
    tileName,
    year,
  );
  return mark?.svgMarkup;
}

export function resolveVettedIdentityMarks(params: {
  make?: string | null;
  familyLabel?: string | null;
  model?: string | null;
  modelLabel?: string | null;
  year?: number | null;
  eraId?: string | null;
}): VehicleIdentityMark[] {
  const base = baseResolveVettedIdentityMarks(params);
  const w3 = resolveVehicleIdentityMark(
    {
      make: params.make,
      family: params.familyLabel,
      model: params.model ?? params.modelLabel,
      year: params.year,
    },
    params.familyLabel,
    params.model ?? params.modelLabel,
    params.year,
  );
  if (w3 && !base.some((m) => m.id === w3.id)) {
    return [...base, w3];
  }
  return base;
}

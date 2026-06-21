/**
 * skinSeeds.ts
 * ---------------------------------------------------------------------------
 * STAGING for the venue skin specs. Canonical home is
 * `organizations.brand_design_language` (one UPDATE per venue once the
 * canonical write is approved). Until then VenueSkin resolves specs from here.
 *
 * STRUCTURE for every spec is sourced from the repo's own extractor DOM maps
 * (the answers are in the documentation), never from memory:
 *   - BaT          → archived markup (listing_page_snapshots) + bat-simple-extract
 *   - Bonhams      → archived cars.bonhams.com markup
 *   - Cars & Bids  → extract-cars-and-bids-core DOM map (dl/dt-dd, .dougs-take, .bid-stats)
 *   - Craigslist   → extract-craigslist (ld_posting_data JSON-LD + attr spans)
 *   - Hagerty      → extract-hagerty-listing (__NEXT_DATA__ auction object)
 *   - eBay Motors  → extract-ebay-motors (item specifics field schema)
 *
 * VISUAL TOKENS: facts are sacred, but a skin's look is FORM — invented/evoked
 * freely (the doorman's bounded-creativity rule). Tokens sourced from real
 * markup are exact (BaT); evoked tokens are flagged `font_confirmed: false`.
 * Facebook is intentionally excluded (per Skylar).
 */

import type { SkinSpec } from './skinSpec';

const BRING_A_TRAILER: SkinSpec = {
  venue: 'bring-a-trailer-4',
  displayName: 'Bring a Trailer',
  camp: 'clean',
  layout: 'sidebar-right',
  homage: 'in the style of Bring a Trailer',
  tokens: {
    fontFamily: "'Open Sans', Arial, sans-serif",
    fontImportUrl: 'https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,400;0,600;0,700&display=swap',
    palette: {
      pageBg: '#ececec', surface: '#ffffff', text: '#222222', muted: '#999999',
      border: '#dddddd', accent: '#222222', accentText: '#ffffff', link: '#1f6fb2',
    },
  },
  structure: [
    { id: 'title', region: 'top' },
    { id: 'tags', items: ['No Reserve', 'USA'], region: 'top' },
    { id: 'gallery', region: 'top' },
    { id: 'bidbar', label: 'Nuke Estimate', region: 'top' },
    { id: 'essentials', label: 'BaT Essentials', items: ['seller', 'location', 'listing_details'], region: 'sidebar' },
    { id: 'description', region: 'main' },
    { id: 'comments', label: 'Comments', region: 'main' },
  ],
  bindings: {
    title: 'year make model trim', seller: 'seller_handle', location: 'city state',
    chassis: 'vin', mileage: 'mileage|abbrevK', engine: 'engine_type', transmission: 'transmission',
    description: 'description',
  },
  evidence: { snapshot_id: 'a627ed2e-6991-41a6-bc75-4a9f9e92f1b2', source_url: 'https://bringatrailer.com/listing/2005-ford-excursion-179/', font_confirmed: true },
};

const BONHAMS_CARS: SkinSpec = {
  venue: 'bonhams-cars',
  displayName: 'Bonhams Cars',
  camp: 'spa',
  homage: 'in the style of Bonhams Cars',
  tokens: {
    fontFamily: "Georgia, 'Times New Roman', serif",
    fontImportUrl: null,
    palette: {
      pageBg: '#e9e7e3', surface: '#ffffff', text: '#1a1a1a', muted: '#8a8478',
      border: '#e2ded7', accent: '#1a1a1a', accentText: '#ffffff', headerBg: '#1a1a1a', headerText: '#ffffff',
    },
  },
  structure: [
    { id: 'header', label: 'BONHAMS CARS' },
    { id: 'gallery' },
    { id: 'title' },
    { id: 'meta', label: '{estimate_label} | Prepared | {location}' },
    { id: 'chassis', label: 'Chassis no.' },
    { id: 'estimate', label: 'Estimate' },
    { id: 'description' },
  ],
  bindings: { title: 'year make model trim', chassis: 'vin', location: 'city state', description: 'description' },
  evidence: { snapshot_id: null as unknown as string, source_url: 'https://cars.bonhams.com/auction/28010/lot/109/1991-land-rover-defender-110-2-door-soft-top-vin-salldhav8fa446139', font_confirmed: false },
};

// Cars & Bids — structure from extract-cars-and-bids-core (dl > dt/dd "Quick Facts",
// .dougs-take, .bid-stats). Tokens evoked (modern enthusiast, clean sans) — flagged.
const CARS_AND_BIDS: SkinSpec = {
  venue: 'cars-bids',
  displayName: 'Cars & Bids',
  camp: 'spa',
  homage: 'in the style of Cars & Bids',
  tokens: {
    fontFamily: "'Helvetica Neue', Arial, sans-serif",
    fontImportUrl: null,
    palette: {
      pageBg: '#f4f5f7', surface: '#ffffff', text: '#1b1f24', muted: '#6b7280',
      border: '#e3e6ea', accent: '#1b1f24', accentText: '#ffffff', link: '#2f80ed',
    },
  },
  structure: [
    { id: 'gallery' },
    { id: 'title' },
    { id: 'availability', label: 'Nuke Estimate' },
    {
      id: 'specs', label: 'Quick Facts',
      items: ['Mileage::mileage|commas', 'VIN::vin', 'Engine::engine_type', 'Drivetrain::drivetrain',
        'Transmission::transmission', 'Body Style::body_style', 'Exterior::exterior_color',
        'Interior::interior_color', 'Location::city state', 'Seller::seller_handle'],
    },
    { id: 'description' },
  ],
  bindings: { title: 'year make model trim', description: 'description' },
  evidence: { snapshot_id: null as unknown as string, source_url: 'https://carsandbids.com/auctions/3y87QZME/2022-bmw-m3/', font_confirmed: false },
};

// Craigslist — structure from extract-craigslist (ld_posting_data + attr spans).
// Plain, server-rendered: white, black text, blue links, system sans.
const CRAIGSLIST: SkinSpec = {
  venue: 'craigslist',
  displayName: 'Craigslist',
  camp: 'clean',
  homage: 'in the style of Craigslist',
  tokens: {
    fontFamily: "Helvetica, Arial, sans-serif",
    fontImportUrl: null,
    palette: {
      pageBg: '#ffffff', surface: '#ffffff', text: '#222222', muted: '#666666',
      border: '#e6e6e6', accent: '#0000ee', accentText: '#ffffff', link: '#0000ee',
    },
  },
  structure: [
    { id: 'title' },
    {
      id: 'specs',
      items: ['Price::price|usd', 'Odometer::mileage|commas', 'Condition::condition', 'Cylinders::cylinders',
        'Drive::drivetrain', 'Fuel::fuel_type', 'Paint color::exterior_color',
        'Title status::title_status', 'Transmission::transmission'],
    },
    { id: 'gallery' },
    { id: 'description' },
  ],
  bindings: { title: 'year make model', description: 'description' },
  evidence: { snapshot_id: null as unknown as string, source_url: 'https://craigslist.org (ld_posting_data)', font_confirmed: false },
};

// Hagerty Marketplace — structure from extract-hagerty-listing (__NEXT_DATA__ auction object).
// Tokens evoked (clean editorial) — flagged.
const HAGERTY: SkinSpec = {
  venue: 'hagerty-marketplace',
  displayName: 'Hagerty Marketplace',
  camp: 'spa',
  homage: 'in the style of Hagerty Marketplace',
  tokens: {
    fontFamily: "Georgia, 'Times New Roman', serif",
    fontImportUrl: null,
    palette: {
      pageBg: '#f6f4f0', surface: '#ffffff', text: '#1d1d1b', muted: '#7a756c',
      border: '#e6e1d8', accent: '#c8102e', accentText: '#ffffff', headerBg: '#1d1d1b', headerText: '#ffffff',
    },
  },
  structure: [
    { id: 'header', label: 'HAGERTY MARKETPLACE' },
    { id: 'gallery' },
    { id: 'title' },
    {
      id: 'specs', label: 'The Details',
      items: ['Mileage::mileage|commas', 'VIN::vin', 'Engine::engine_type', 'Transmission::transmission',
        'Drivetrain::drivetrain', 'Exterior::exterior_color', 'Interior::interior_color', 'Location::city state'],
    },
    { id: 'estimate', label: 'Estimate' },
    { id: 'description' },
  ],
  bindings: { title: 'year make model trim', chassis: 'vin', location: 'city state', description: 'description' },
  evidence: { snapshot_id: null as unknown as string, source_url: 'extract-hagerty-listing (__NEXT_DATA__ auction object)', font_confirmed: false },
};

// eBay Motors (old style) — structure from extract-ebay-motors (item specifics field schema).
// Tokens evoked as classic-eBay retro — flagged.
const EBAY_MOTORS: SkinSpec = {
  venue: 'ebay-motors',
  displayName: 'eBay Motors',
  camp: 'clean',
  homage: 'in the style of eBay Motors (classic)',
  tokens: {
    fontFamily: "Arial, Helvetica, sans-serif",
    fontImportUrl: null,
    palette: {
      pageBg: '#eef1f5', surface: '#ffffff', text: '#333333', muted: '#767676',
      border: '#d9d9d9', accent: '#0654ba', accentText: '#ffffff', link: '#0654ba',
    },
  },
  structure: [
    { id: 'title' },
    { id: 'availability', label: 'Buy It Now (Nuke estimate)' },
    {
      id: 'specs', label: 'Item specifics',
      items: ['Year::year', 'Make::make', 'Model::model', 'Trim::trim', 'VIN::vin', 'Mileage::mileage|commas',
        'Engine::engine_type', 'Transmission::transmission', 'Drive Type::drivetrain', 'Body Type::body_style',
        'Exterior Color::exterior_color', 'Interior Color::interior_color', 'For Sale By::seller_handle'],
    },
    { id: 'description' },
  ],
  bindings: { title: 'year make model trim', description: 'description' },
  evidence: { snapshot_id: null as unknown as string, source_url: 'extract-ebay-motors (item specifics schema)', font_confirmed: false },
};

export const SKIN_SEEDS: Record<string, SkinSpec> = {
  [BRING_A_TRAILER.venue]: BRING_A_TRAILER,
  [BONHAMS_CARS.venue]: BONHAMS_CARS,
  [CARS_AND_BIDS.venue]: CARS_AND_BIDS,
  [CRAIGSLIST.venue]: CRAIGSLIST,
  [HAGERTY.venue]: HAGERTY,
  [EBAY_MOTORS.venue]: EBAY_MOTORS,
};

/** Resolve a skin spec by venue slug. (DB override from brand_design_language lands here later.) */
export function getSkinSeed(venueSlug: string): SkinSpec | null {
  return SKIN_SEEDS[venueSlug] ?? null;
}

/**
 * Platform nomenclature helpers
 *
 * Canonical platform keys are stored in DB fields like:
 * - external_listings.platform
 * - auction_events.source
 *
 * Keep this list strict and normalized so UI + ingestion stay aligned.
 */

export type CanonicalPlatform =
  | 'bat'
  | 'cars_and_bids'
  | 'mecum'
  | 'pcarmarket'
  | 'sbx'
  | 'ebay_motors'
  | 'copart'
  | 'iaai'
  | 'barrettjackson'
  | 'russoandsteele'
  | 'bonhams'
  | 'rmsothebys'
  | 'hemmings'
  | 'autotrader'
  | 'facebook_marketplace'
  | 'classic_com'
  | 'craigslist'
  | 'unknown';

const CANONICAL_DISPLAY: Record<string, string> = {
  bat: 'Bring a Trailer',
  cars_and_bids: 'Cars & Bids',
  mecum: 'Mecum',
  pcarmarket: 'PCARMARKET',
  sbx: 'SBX Cars',
  ebay_motors: 'eBay Motors',
  copart: 'Copart',
  iaai: 'IAA',
  barrettjackson: 'Barrett-Jackson',
  russoandsteele: 'Russo and Steele',
  bonhams: 'Bonhams',
  rmsothebys: "RM Sotheby's",
  hemmings: 'Hemmings',
  autotrader: 'Autotrader',
  facebook_marketplace: 'Facebook Marketplace',
  classic_com: 'Classic.com',
  craigslist: 'Craigslist',
  unknown: 'Unknown',
};

export function normalizePlatform(raw: unknown): CanonicalPlatform {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return 'unknown';

  // Auctions
  if (s === 'bat' || s === 'bring_a_trailer' || s === 'bringatrailer' || s.includes('bringatrailer')) return 'bat';
  if (s === 'cars_and_bids' || s === 'carsandbids' || s.includes('carsandbids')) return 'cars_and_bids';
  if (s === 'pcarmarket' || s.includes('pcarmarket')) return 'pcarmarket';
  if (s === 'sbx' || s.includes('sbxcars') || s.includes('sbx')) return 'sbx';
  if (s === 'mecum' || s.includes('mecum')) return 'mecum';
  if (s === 'barrettjackson' || s.includes('barrett')) return 'barrettjackson';
  if (s === 'russoandsteele' || s.includes('russo')) return 'russoandsteele';
  if (s.includes('bonhams')) return 'bonhams';
  if (s.includes('rmsothebys') || s.includes("rm sotheby")) return 'rmsothebys';
  if (s.includes('hemmings')) return 'hemmings';
  if (s === 'classic_com' || s.includes('classic.com') || s.includes('classic_com')) return 'classic_com';

  // Classifieds / marketplaces
  if (s === 'ebay_motors' || s === 'ebay' || s.includes('ebay')) return 'ebay_motors';
  if (s === 'facebook_marketplace' || s.includes('facebook')) return 'facebook_marketplace';
  if (s === 'craigslist' || s.includes('craigslist')) return 'craigslist';
  if (s === 'autotrader' || s.includes('autotrader')) return 'autotrader';
  if (s === 'copart' || s.includes('copart')) return 'copart';
  if (s === 'iaai' || s.includes('iaai') || s === 'iaa' || s.includes('iaa')) return 'iaai';

  // Pass through for unknown but stable keys (avoid exploding union types).
  return 'unknown';
}

export function getPlatformDisplayName(platform: unknown): string {
  const key = normalizePlatform(platform);
  return CANONICAL_DISPLAY[key] || CANONICAL_DISPLAY.unknown;
}


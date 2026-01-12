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
  | 'ebay'
  | 'copart'
  | 'iaai'
  | 'barrett-jackson'
  | 'bonhams'
  | 'rmsothebys'
  | 'hemmings'
  | 'bringatrailer'
  | 'carsandbids'
  | 'unknown';

const CANONICAL_DISPLAY: Record<string, string> = {
  bat: 'Bring a Trailer',
  bringatrailer: 'Bring a Trailer',
  cars_and_bids: 'Cars & Bids',
  carsandbids: 'Cars & Bids',
  mecum: 'Mecum',
  pcarmarket: 'PCARMARKET',
  sbx: 'SBX Cars',
  ebay: 'eBay Motors',
  copart: 'Copart',
  iaai: 'IAA',
  'barrett-jackson': 'Barrett-Jackson',
  bonhams: 'Bonhams',
  rmsothebys: "RM Sotheby's",
  hemmings: 'Hemmings',
  unknown: 'Unknown',
};

export function normalizePlatform(raw: unknown): CanonicalPlatform {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return 'unknown';

  if (s === 'bat' || s.includes('bringatrailer')) return 'bat';
  if (s === 'cars_and_bids' || s === 'carsandbids' || s.includes('carsandbids')) return 'cars_and_bids';
  if (s === 'pcarmarket' || s.includes('pcarmarket')) return 'pcarmarket';
  if (s === 'sbx' || s.includes('sbxcars') || s.includes('sbx')) return 'sbx';
  if (s === 'mecum' || s.includes('mecum')) return 'mecum';
  if (s === 'ebay' || s.includes('ebay')) return 'ebay';
  if (s === 'copart' || s.includes('copart')) return 'copart';
  if (s === 'iaai' || s.includes('iaa')) return 'iaai';
  if (s.includes('barrett')) return 'barrett-jackson';
  if (s.includes('bonhams')) return 'bonhams';
  if (s.includes('rmsothebys') || s.includes("rm sotheby")) return 'rmsothebys';
  if (s.includes('hemmings')) return 'hemmings';

  // Pass through for unknown but stable keys (avoid exploding union types).
  return 'unknown';
}

export function getPlatformDisplayName(platform: unknown): string {
  const key = normalizePlatform(platform);
  return CANONICAL_DISPLAY[key] || CANONICAL_DISPLAY.unknown;
}


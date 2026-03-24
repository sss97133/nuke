/**
 * CardSource — Platform source badge on feed cards.
 *
 * Shows WHERE the vehicle is from (BaT, FB, MECUM, etc.)
 * as a pill/label in the top-left of the image area.
 *
 * Design system: Courier New, 8px UPPERCASE, 2px borders, zero radius.
 */

export interface CardSourceProps {
  discoveryUrl?: string | null;
  discoverySource?: string | null;
  profileOrigin?: string | null;
}

/** Canonical source slug -> display abbreviation */
const SOURCE_DISPLAY: Record<string, string> = {
  // Slug-based matches (from discovery_source / profile_origin)
  bat: 'BaT',
  'bring a trailer': 'BaT',
  bringatrailer: 'BaT',
  facebook_marketplace: 'FB',
  facebook: 'FB',
  fb_marketplace: 'FB',
  fb: 'FB',
  mecum: 'MECUM',
  cars_and_bids: 'C&B',
  carsandbids: 'C&B',
  'cars and bids': 'C&B',
  'c&b': 'C&B',
  'barrett-jackson': 'B-J',
  barrett_jackson: 'B-J',
  barrettjackson: 'B-J',
  bonhams: 'BONHAMS',
  craigslist: 'CL',
  gooding: 'GOODING',
  pcarmarket: 'PCAR',
  hemmings: 'HEMMINGS',
  classic: 'CLASSIC',
  ksl: 'KSL',
  ebay: 'EBAY',
  rm_sothebys: 'RM',
  rmsothebys: 'RM',
  conceptcarz: 'CCARZ',
  autotrader: 'AT',
  hagerty: 'HAGERTY',
};

/** URL domain -> display abbreviation */
const DOMAIN_DISPLAY: [RegExp, string][] = [
  [/bringatrailer\.com/, 'BaT'],
  [/facebook\.com|fb\.com|fbmarketplace/, 'FB'],
  [/mecum\.com/, 'MECUM'],
  [/carsandbids\.com/, 'C&B'],
  [/barrett-jackson\.com/, 'B-J'],
  [/bonhams\.com/, 'BONHAMS'],
  [/craigslist\.org/, 'CL'],
  [/goodingco\.com/, 'GOODING'],
  [/pcarmarket\.com/, 'PCAR'],
  [/hemmings\.com/, 'HEMMINGS'],
  [/classic\.com/, 'CLASSIC'],
  [/ksl\.com/, 'KSL'],
  [/ebay\.com/, 'EBAY'],
  [/rmsothebys\.com/, 'RM'],
  [/conceptcarz\.com/, 'CCARZ'],
  [/autotrader\.com/, 'AT'],
  [/hagerty\.com/, 'HAGERTY'],
];

function resolveSourceLabel(
  url: string | null | undefined,
  source: string | null | undefined,
  origin: string | null | undefined,
): string | null {
  // Try profile_origin first (most reliable), then discovery_source
  for (const raw of [origin, source]) {
    if (!raw) continue;
    const key = raw.toLowerCase().trim();
    if (SOURCE_DISPLAY[key]) return SOURCE_DISPLAY[key];
    // Partial match
    for (const [slug, label] of Object.entries(SOURCE_DISPLAY)) {
      if (key.includes(slug)) return label;
    }
  }

  // Fall back to URL domain matching
  if (url) {
    const lower = url.toLowerCase();
    for (const [pattern, label] of DOMAIN_DISPLAY) {
      if (pattern.test(lower)) return label;
    }
  }

  return null;
}

export function CardSource({ discoveryUrl, discoverySource, profileOrigin }: CardSourceProps) {
  const label = resolveSourceLabel(discoveryUrl, discoverySource, profileOrigin);

  if (!label) return null;

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        background: 'var(--surface)',
        padding: '2px 5px',
        border: '2px solid var(--text-tertiary, var(--border))',
      }}
    >
      <span
        style={{
          fontFamily: "'Courier New', monospace",
          fontSize: '8px',
          fontWeight: 700,
          textTransform: 'uppercase' as const,
          letterSpacing: '0.5px',
          color: 'var(--text-tertiary, var(--text-secondary))',
          lineHeight: 1,
        }}
      >
        {label}
      </span>
    </div>
  );
}

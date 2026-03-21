/**
 * CardSource — Source favicon stamp.
 *
 * Shows a small favicon for the vehicle's discovery source.
 * Positioned in bottom-left of image area.
 */

import { FaviconIcon } from '../../../components/common/FaviconIcon';

export interface CardSourceProps {
  discoveryUrl?: string | null;
  discoverySource?: string | null;
}

/** Map source patterns to short platform labels */
const SOURCE_LABELS: Record<string, string> = {
  craigslist: 'CL',
  bat: 'BAT',
  'bring a trailer': 'BAT',
  'cars and bids': 'C&B',
  'c&b': 'C&B',
  ksl: 'KSL',
  facebook: 'FB MARKET',
  fb: 'FB MARKET',
  classic: 'CLASSIC',
  hemmings: 'HEMMINGS',
  mecum: 'MECUM',
};

function resolvePlatformLabel(url: string | null, source: string | null): string | null {
  const s = (source || '').toLowerCase();
  for (const [key, label] of Object.entries(SOURCE_LABELS)) {
    if (s.includes(key)) return label;
  }
  if (url) {
    const u = url.toLowerCase();
    if (u.includes('facebook.com') || u.includes('fb.com')) return 'FB MARKET';
    if (u.includes('bringatrailer.com')) return 'BAT';
    if (u.includes('carsandbids.com')) return 'C&B';
    if (u.includes('craigslist.org')) return 'CL';
    if (u.includes('mecum.com')) return 'MECUM';
    if (u.includes('hemmings.com')) return 'HEMMINGS';
  }
  return null;
}

export function CardSource({ discoveryUrl, discoverySource }: CardSourceProps) {
  // Build a URL for the favicon
  let faviconTarget: string | null = null;

  if (discoveryUrl) {
    faviconTarget = discoveryUrl;
  } else if (discoverySource) {
    const source = discoverySource.toLowerCase();
    if (source.includes('craigslist')) faviconTarget = 'https://craigslist.org';
    else if (source.includes('bat') || source.includes('bring a trailer')) faviconTarget = 'https://bringatrailer.com';
    else if (source.includes('cars and bids') || source.includes('c&b')) faviconTarget = 'https://carsandbids.com';
    else if (source.includes('ksl')) faviconTarget = 'https://ksl.com';
    else if (source.includes('facebook') || source.includes('fb')) faviconTarget = 'https://facebook.com';
    else if (source.includes('classic')) faviconTarget = 'https://classic.com';
    else if (source.includes('hemmings')) faviconTarget = 'https://hemmings.com';
    else if (source.includes('mecum')) faviconTarget = 'https://mecum.com';
  }

  if (!faviconTarget) return null;

  const platformLabel = resolvePlatformLabel(discoveryUrl ?? null, discoverySource ?? null);

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '6px',
        left: '6px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
        zIndex: 10,
        pointerEvents: 'none',
        background: 'rgba(0,0,0,0.55)',
        padding: '2px 5px 2px 3px',
      }}
    >
      <FaviconIcon url={faviconTarget} size={14} preserveAspectRatio />
      {platformLabel && (
        <span style={{
          fontFamily: 'Arial, sans-serif',
          fontSize: '7px',
          fontWeight: 800,
          textTransform: 'uppercase' as const,
          letterSpacing: '0.3px',
          color: '#fff',
          lineHeight: 1,
        }}>
          {platformLabel}
        </span>
      )}
    </div>
  );
}

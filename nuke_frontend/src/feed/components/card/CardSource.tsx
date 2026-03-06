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

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function CardSource({ discoveryUrl, discoverySource }: CardSourceProps) {
  // Build a URL for the favicon
  let faviconTarget: string | null = null;

  if (discoveryUrl) {
    faviconTarget = discoveryUrl;
  } else if (discoverySource) {
    // Try to construct a URL from the source name
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

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '6px',
        left: '6px',
        display: 'inline-flex',
        alignItems: 'center',
        zIndex: 10,
        pointerEvents: 'none',
      }}
    >
      <FaviconIcon url={faviconTarget} size={14} preserveAspectRatio />
    </div>
  );
}

/**
 * Feed data processing helpers: image quality checks, vehicle dedup, URL normalization.
 * Extracted from CursorHomepage loadHypeFeed.
 */

/** Check if an image URL indicates poor quality or a placeholder/logo */
export function isPoorQualityImage(url: string | null, fileSize: number | null = null): boolean {
  if (!url) return true;
  if (!url.startsWith('http://') && !url.startsWith('https://')) return true;
  const urlLower = String(url).toLowerCase();

  if (
    urlLower.includes('/dealer/') ||
    urlLower.includes('/logo') ||
    urlLower.includes('logo-') ||
    urlLower.includes('.svg') ||
    urlLower.includes('placeholder') ||
    urlLower.includes('no-image') ||
    urlLower.includes('default') ||
    urlLower.includes('missing') ||
    urlLower.includes('/auctionsites/') ||
    urlLower.includes('/images/auctionsites')
  ) {
    return true;
  }

  if (fileSize !== null && fileSize < 10000) {
    return true;
  }

  if (
    urlLower.includes('images.classic.com/uploads/dealer/') ||
    urlLower.includes('images.classic.com/uploads/dealer') ||
    (urlLower.includes('cdn.dealeraccelerate.com') && urlLower.includes('logo'))
  ) {
    return true;
  }

  if (
    urlLower.includes('.png') &&
    (urlLower.includes('?h=150') || urlLower.includes('&h=150') ||
     urlLower.includes('?w=150') || urlLower.includes('&w=150'))
  ) {
    if (!urlLower.includes('images.classic.com') && !urlLower.includes('/dealer/')) {
      return false;
    }
    return true;
  }

  return false;
}

/** Normalize a listing URL for dedup: strip hash, query, lowercase */
export function normalizeListingKey(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) return null;
  try {
    const u = new URL(s);
    u.hash = '';
    u.search = '';
    return u.toString().toLowerCase();
  } catch {
    return s.split('#')[0].split('?')[0].toLowerCase();
  }
}

/** Get the canonical dedup key for a vehicle row */
export function getDedupeKey(row: any): string | null {
  if (!row) return null;
  const direct = normalizeListingKey(row.discovery_url);
  if (direct) return direct;
  const fromListing = normalizeListingKey(row?.external_listings?.[0]?.listing_url);
  if (fromListing) return fromListing;
  return null;
}

/** Score a vehicle row for dedup — higher = better record */
function scoreForDedupe(row: any): number {
  if (!row) return 0;
  let score = 0;
  if (row.vin) score += 10;
  if (row.make) score += 2;
  if (row.model) score += 2;
  if (row.title) score += 1;
  if (row.sale_price || row.winning_bid || row.high_bid || row.asking_price || row.display_price) score += 3;
  if (Array.isArray(row.external_listings) && row.external_listings.length > 0) score += 2;
  if (row.primary_image_url || row.image_url) score += 1;
  try {
    const ts = row.updated_at ? new Date(row.updated_at).getTime() : 0;
    if (Number.isFinite(ts) && ts > 0) score += Math.min(1, ts / 1e13);
  } catch {
    // ignore
  }
  return score;
}

/**
 * Deduplicate vehicles by canonical listing URL.
 * Keeps first-seen ordering but swaps in the "best" record for each listing.
 */
export function dedupeVehicles(items: any[]): any[] {
  const byKey = new Map<string, { idx: number; best: any; score: number }>();
  const order: string[] = [];
  const passthrough: any[] = [];

  for (let i = 0; i < (items || []).length; i++) {
    const it = items[i];
    const key = getDedupeKey(it);
    if (!key) {
      passthrough.push(it);
      continue;
    }
    const s = scoreForDedupe(it);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { idx: i, best: it, score: s });
      order.push(key);
    } else if (s > existing.score) {
      byKey.set(key, { ...existing, best: it, score: s });
    }
  }

  const deduped = order.map((k) => byKey.get(k)!.best);
  return [...deduped, ...passthrough];
}

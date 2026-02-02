/**
 * Resolve existing vehicle before insert to avoid duplicate discovery_url.
 * Use this in all listing/auction extractors that write to vehicles + external_listings.
 *
 * Order: (1) external_listings by platform + listing_url_key
 *        (2) vehicles by discovery_url exact
 *        (3) vehicles by discovery_url ILIKE pattern (same listing, different URL format)
 *
 * Returns vehicleId or null. If null, caller should insert new vehicle.
 */

import { normalizeListingUrlKey } from './listingUrl.ts';

export type ResolveOptions = {
  url: string;
  platform: string;
  /** Optional: pattern for ILIKE match e.g. "%historics.co.uk%lot/12345%" or "%goodingco.com/lot/slug%" */
  discoveryUrlIlikePattern?: string | null;
};

export async function resolveExistingVehicleId(
  supabase: { from: (t: string) => any },
  options: ResolveOptions
): Promise<{ vehicleId: string | null }> {
  const { url, platform, discoveryUrlIlikePattern } = options;
  const listingUrlKey = normalizeListingUrlKey(url);

  // 1. By external_listings (platform + listing_url_key)
  if (listingUrlKey) {
    const { data: listing } = await supabase
      .from('external_listings')
      .select('vehicle_id')
      .eq('platform', platform)
      .eq('listing_url_key', listingUrlKey)
      .maybeSingle();
    if (listing?.vehicle_id) {
      return { vehicleId: listing.vehicle_id };
    }
  }

  // 2. By discovery_url exact
  const { data: byUrl } = await supabase
    .from('vehicles')
    .select('id')
    .eq('discovery_url', url)
    .limit(1)
    .maybeSingle();
  if (byUrl?.id) {
    return { vehicleId: byUrl.id };
  }

  // 3. By discovery_url pattern (same listing, different scheme/www)
  if (discoveryUrlIlikePattern && discoveryUrlIlikePattern.trim()) {
    const { data: byPatternRows } = await supabase
      .from('vehicles')
      .select('id')
      .ilike('discovery_url', discoveryUrlIlikePattern.trim())
      .limit(1);
    const row = Array.isArray(byPatternRows) ? byPatternRows[0] : (byPatternRows as { id: string } | null);
    if (row?.id) {
      return { vehicleId: row.id };
    }
  }

  return { vehicleId: null };
}

/**
 * Build an ILIKE pattern for a listing URL so we match regardless of scheme/www.
 * e.g. "https://www.goodingco.com/lot/ferrari-daytona" -> "%goodingco.com/lot/ferrari-daytona%"
 */
export function discoveryUrlIlikePattern(url: string, pathSlug?: string | null): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    const path = (pathSlug != null ? pathSlug : u.pathname || '').replace(/^\/+/, '').toLowerCase();
    if (!host) return null;
    return `%${host}/${path}%`;
  } catch {
    return null;
  }
}

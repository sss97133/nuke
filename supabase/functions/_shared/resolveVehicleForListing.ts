/**
 * Resolve existing vehicle before insert to avoid duplicate discovery_url.
 * Use this in all listing/auction extractors that write to vehicles + vehicle_events.
 *
 * Order: (1) vehicle_events by source_platform + source_listing_id
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

  // 1. By vehicle_events (source_platform + source_listing_id)
  if (listingUrlKey) {
    const { data: event } = await supabase
      .from('vehicle_events')
      .select('vehicle_id')
      .eq('source_platform', platform)
      .eq('source_listing_id', listingUrlKey)
      .maybeSingle();
    if (event?.vehicle_id) {
      return { vehicleId: event.vehicle_id };
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
  // NOTE: ILIKE with leading % can't use btree indexes and causes full table scans.
  // Wrap in try/catch with a short timeout to avoid blocking the caller.
  if (discoveryUrlIlikePattern && discoveryUrlIlikePattern.trim()) {
    try {
      const { data: byPatternRows } = await supabase
        .from('vehicles')
        .select('id')
        .ilike('discovery_url', discoveryUrlIlikePattern.trim())
        .limit(1);
      const row = Array.isArray(byPatternRows) ? byPatternRows[0] : (byPatternRows as { id: string } | null);
      if (row?.id) {
        return { vehicleId: row.id };
      }
    } catch (e: any) {
      // ILIKE timed out on large table — skip pattern matching, proceed with insert
      console.warn(`[resolveVehicleId] ILIKE pattern match timed out: ${e.message}`);
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

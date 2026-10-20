/**
 * Resolve existing vehicle before insert to avoid duplicate discovery_url.
 * Use this in all listing/auction extractors that write to vehicles + vehicle_events.
 *
 * Order: (1) vehicle_events by source_platform + source_listing_id
 *        (2) vehicles by discovery_url exact
 *        (3) vehicles by discovery_url ILIKE pattern (same listing, different URL format)
 *
 * Returns vehicleId or null. If null, caller should insert new vehicle.
 * Exact-listing mode refuses ambiguous or failed reads instead of falling through.
 */

import { normalizeListingUrlKey } from './listingUrl.ts';

export type ResolveOptions = {
  url: string;
  platform: string;
  /** Optional: pattern for ILIKE match e.g. "%historics.co.uk%lot/12345%" or "%goodingco.com/lot/slug%" */
  discoveryUrlIlikePattern?: string | null;
  /** Require whole normalized listing URLs; do not equate different path slugs. */
  requireExactListingUrl?: boolean;
};

function exactListingKey(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    return normalizeListingUrlKey(url.href);
  } catch { return null; }
}

/** The live (not merged, not deleted) vehicles holding this platform's lot episode. */
async function liveVehicles(supabase: { from: (t: string) => any }, platform: string, listingUrlKey: string, signal: AbortSignal): Promise<string[]> {
  const { data: events, error } = await supabase.from('vehicle_events').select('vehicle_id')
    .eq('source_platform', platform).eq('source_listing_id', listingUrlKey).limit(10).abortSignal(signal);
  if (error) throw error;
  const ids = [...new Set<string>((events ?? []).map((e: { vehicle_id: string }) => e.vehicle_id))];
  if (!ids.length) return [];
  const { data: vehicles, error: vErr } = await supabase.from('vehicles').select('id,status,deleted_at').in('id', ids).abortSignal(signal);
  if (vErr) throw vErr;
  return (vehicles ?? []).filter((v: { status?: string | null; deleted_at?: string | null }) => v.status !== 'merged' && !v.deleted_at)
    .map((v: { id: string }) => v.id);
}

export async function resolveExistingVehicleId(
  supabase: { from: (t: string) => any },
  options: ResolveOptions
): Promise<{ vehicleId: string | null }> {
  const { url, platform, discoveryUrlIlikePattern, requireExactListingUrl } = options;
  const listingUrlKey = requireExactListingUrl ? exactListingKey(url) : normalizeListingUrlKey(url);
  if (requireExactListingUrl && !listingUrlKey) throw new Error('Invalid listing URL for exact resolution');
  const signal = requireExactListingUrl ? AbortSignal.timeout(3_000) : undefined;

  // 1. By vehicle_events (source_platform + source_listing_id)
  if (listingUrlKey) {
    let query = supabase
      .from('vehicle_events')
      .select('vehicle_id')
      .eq('source_platform', platform)
      .eq('source_listing_id', listingUrlKey);
    if (signal) query = query.limit(2).abortSignal(signal);
    let { data: event, error } = await query.maybeSingle();
    // A merged-away duplicate keeps its copy of the lot's episode; the lot still belongs to one live vehicle.
    if (requireExactListingUrl && error && (error as { code?: string }).code === 'PGRST116') {
      const live = await liveVehicles(supabase, platform, listingUrlKey, signal!);
      if (live.length === 1) { event = { vehicle_id: live[0] }; error = null; }
    }
    if (requireExactListingUrl && error) throw error;
    if (event?.vehicle_id) {
      return { vehicleId: event.vehicle_id };
    }
  }

  if (requireExactListingUrl) {
    // A canonical URL hit alone cannot exclude conflicting query/hash aliases.
    // Inspect a bounded candidate set, then compare whole keys rather than prefixes.
    const pattern = `%${listingUrlKey!.replace(/[\\%_]/g, '\\$&')}%`;
    const { data, error } = await supabase.from('vehicles').select('id,discovery_url,status,deleted_at')
      .ilike('discovery_url', pattern).limit(51).abortSignal(signal!);
    if (error) throw error;
    const rows = (data ?? []).filter((row: { status?: string | null; deleted_at?: string | null }) => row.status !== 'merged' && !row.deleted_at);
    if (rows.length >= 51) throw new Error('Listing URL candidate limit reached; identity unresolved');
    const ids = [...new Set<string>(rows.filter((row: { discovery_url: string }) => exactListingKey(row.discovery_url) === listingUrlKey)
      .map((row: { id: string }) => row.id))];
    if (ids.length > 1) throw new Error('Ambiguous listing URL aliases; identity unresolved');
    return { vehicleId: ids[0] ?? null };
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

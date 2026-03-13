/**
 * resolveVehicleImages — Single deterministic image resolver.
 *
 * Replaces loadVehicleImages.ts (582 lines, 5 competing paths) with one path:
 *   1. Query vehicle_images from DB (filtered, ordered)
 *   2. Pick lead image (primary > best quality > first)
 *   3. Done.
 *
 * No origin_metadata fallback. No vehicle_events metadata. No storage bucket scan.
 * No window.__vehicleProfileRpcData. If images exist in the DB, we show them.
 */
import { supabase } from '../../lib/supabase';

export interface ResolvedImages {
  /** Display-ready image URLs in order */
  urls: string[];
  /** Best image URL for the hero/lead */
  leadUrl: string | null;
}

/**
 * Resolve all displayable images for a vehicle.
 * Returns URLs in display order (primary first, then by position/created_at).
 */
export async function resolveVehicleImages(vehicleId: string): Promise<ResolvedImages> {
  const empty: ResolvedImages = { urls: [], leadUrl: null };
  if (!vehicleId) return empty;

  try {
    const { data: rows, error } = await supabase
      .from('vehicle_images')
      .select('id, image_url, thumbnail_url, medium_url, storage_path, is_primary, is_document, is_duplicate, image_vehicle_match_status, position, created_at')
      .eq('vehicle_id', vehicleId)
      // Exclude documents (they belong in a separate section)
      .not('is_document', 'is', true)
      // Exclude duplicates
      .or('is_duplicate.is.null,is_duplicate.eq.false')
      // Exclude AI-detected mismatches
      .not('image_vehicle_match_status', 'in', '("mismatch","unrelated")')
      // Order: primary first, then by position, then by insert order
      .order('is_primary', { ascending: false })
      .order('position', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });

    if (error || !rows || rows.length === 0) return empty;

    // Filter out import_queue and organization logos
    const filtered = rows.filter((r: any) => {
      const url = String(r?.image_url || '').toLowerCase();
      const path = String(r?.storage_path || '').toLowerCase();
      if (url.includes('import_queue') || path.includes('import_queue')) return false;
      if (url.includes('organization-logos/') || path.includes('organization-logos/')) return false;
      if (url.includes('organization_logos/') || path.includes('organization_logos/')) return false;
      if (!r?.image_url) return false;
      return true;
    });

    if (filtered.length === 0) return empty;

    const urls = filtered.map((r: any) => String(r.image_url));

    // Lead image: use primary if it exists and passed filters, otherwise first image
    const primaryRow = filtered.find((r: any) => r?.is_primary === true);
    const leadUrl = primaryRow ? String(primaryRow.image_url) : urls[0];

    return { urls, leadUrl };
  } catch (err) {
    console.error('resolveVehicleImages failed:', err);
    return empty;
  }
}

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
import { fetchVehicleImages } from '../../lib/fetchVehicleImages';

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
    const rows = await fetchVehicleImages<any>(
      vehicleId,
      'id, image_url, thumbnail_url, medium_url, storage_path, is_primary, is_document, is_duplicate, image_vehicle_match_status, position, created_at',
      { includeMismatchFilter: true },
    );
    if (!rows || rows.length === 0) return empty;

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

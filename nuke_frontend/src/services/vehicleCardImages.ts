import { supabase } from '../lib/supabase';

export interface VehicleCardImage {
  vehicle_id: string;
  thumbnail_url: string | null;
  medium_url: string | null;
  image_url: string | null;
  variants: any;
  is_primary?: boolean | null;
  created_at?: string | null;
}

/**
 * One image per listed vehicle: the primary image the caller can see, else the earliest they can see
 * (vehicle_card_images). Replaces reading every image of every listed vehicle sorted by is_primary and
 * created_at only to keep the first per vehicle (5.4 s cold for 200 vehicles as a signed-in user, and
 * PostgREST's 1,000-row cap left the vehicles past it without a thumbnail). At most 1,000 ids per call.
 */
export async function fetchVehicleCardImages(
  vehicleIds: string[],
): Promise<{ data: VehicleCardImage[] | null; error: unknown }> {
  const ids = Array.from(new Set(vehicleIds.filter((id) => typeof id === 'string' && id.length > 0)));
  if (ids.length === 0) return { data: [], error: null };
  const { data, error } = await supabase.rpc('vehicle_card_images', { p_vehicle_ids: ids });
  return { data: (data as VehicleCardImage[] | null) ?? null, error };
}

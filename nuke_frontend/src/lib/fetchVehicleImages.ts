import { supabase } from './supabase';

const PAGE_SIZE = 500;

interface FetchVehicleImagesOptions {
  includeMismatchFilter?: boolean;
}

/**
 * Fetch all matching vehicle images even when a vehicle exceeds the REST row cap.
 */
export async function fetchVehicleImages<T = any>(
  vehicleId: string,
  selectClause: string,
  options: FetchVehicleImagesOptions = {},
): Promise<T[]> {
  if (!vehicleId) return [];

  const rows: T[] = [];
  let from = 0;

  while (true) {
    let query = supabase
      .from('vehicle_images')
      .select(selectClause)
      .eq('vehicle_id', vehicleId)
      .not('is_document', 'is', true)
      .not('is_duplicate', 'is', true)
      .not('image_url', 'is', null);

    if (options.includeMismatchFilter) {
      query = query.or('image_vehicle_match_status.is.null,image_vehicle_match_status.not.in.("mismatch","unrelated")');
    }

    query = query
      .order('is_primary', { ascending: false })
      .order('position', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    const { data, error } = await query;
    if (error) throw error;

    const batch = (data || []) as T[];
    rows.push(...batch);

    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

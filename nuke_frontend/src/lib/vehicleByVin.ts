import { supabase } from './supabase';

export interface VinMatch {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
}

type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

/**
 * The public, undeleted vehicle a VIN names (an unmerged one first), through vehicle_by_vin_public.
 *
 * `vehicles.vin ilike` cannot use an index under the anon and authenticated row policies (ilike is not
 * leakproof, so it waits behind them and the scan is sequential): measured 2026-10-14, 6 anon calls averaged
 * 4.9 s with a 10.2 s maximum, and the search page's own suggested VIN answered "Search failed." after 60 s.
 * The reader finds the row through idx_vehicles_vin_norm_trim in about 0.1 s and applies the public rule
 * itself, so a private or deleted vehicle never comes back. A failed read is "no match", as it was.
 */
export async function findPublicVehicleByVin(
  vin: string,
  client: RpcClient = supabase as unknown as RpcClient,
): Promise<VinMatch | null> {
  const clean = String(vin ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (!clean) return null;
  try {
    const { data, error } = await Promise.resolve(client.rpc('vehicle_by_vin_public', { p_vin: clean }));
    if (error || !Array.isArray(data) || data.length === 0) return null;
    const row = data[0] as Record<string, unknown>;
    if (typeof row.id !== 'string') return null;
    return {
      id: row.id,
      year: typeof row.year === 'number' ? row.year : null,
      make: typeof row.make === 'string' ? row.make : null,
      model: typeof row.model === 'string' ? row.model : null,
    };
  } catch {
    return null;
  }
}

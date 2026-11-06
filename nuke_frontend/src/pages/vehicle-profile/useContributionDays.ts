import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

/** One row of get_vehicle_contribution_days: a day the vehicle has photos, work or paper on, with the count. */
export type ContributionDay = { day: string; kind: string; n: number };

/** The vehicle's contribution days for the activity clock: one read per mount, nothing kept from an earlier
 *  vehicle, and a failed or impossible read answers []. The timeline bar keeps its own read of the same reader
 *  (its tests fix one read per visit, withheld until that visit's read answers). */
export function useContributionDays(vehicleId: string | undefined): ContributionDay[] {
  const [read, setRead] = useState<{ vehicleId: string | undefined; values: ContributionDay[] }>(() => ({ vehicleId, values: [] }));
  useEffect(() => {
    if (!vehicleId) return;
    let cancelled = false;
    let request: Promise<{ data: unknown; error: { message: string } | null }>;
    try { request = Promise.resolve(supabase.rpc('get_vehicle_contribution_days', { p_vehicle_id: vehicleId })); }
    catch { return; }
    request.then(({ data, error }) => {
      if (cancelled) return;
      if (error) { console.warn('[contribution days]', error.message); return; }
      setRead({ vehicleId, values: Array.isArray(data) ? (data as ContributionDay[]) : [] });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [vehicleId]);
  return read.vehicleId === vehicleId ? read.values : [];
}

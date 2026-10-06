// Write one vehicle_events row (a listing episode) by its listing key.
//
// vehicle_events' listing key is the PARTIAL unique index idx_vehicle_events_dedup
// (vehicle_id, source_platform, source_listing_id) WHERE source_listing_id IS NOT NULL. There is no non-partial unique key.
// PostgREST's onConflict cannot carry that WHERE, and Postgres only infers a partial unique index when the conflict
// target states its predicate. So every `.upsert(..., { onConflict: 'source_platform,source_listing_id' })` fails with
// "there is no unique or exclusion constraint matching the ON CONFLICT specification": 60 Gooding lots on 2026-10-06
// 12:10–13:00Z, and 113 such errors in postgres_logs in that hour.
// This helper writes the way extract-bat-core does: update the row on the key, insert when none matched, and if the
// insert loses a race to another writer (23505), update once more.

export type VehicleEventRow = Record<string, unknown> & {
  vehicle_id: string | null | undefined;
  source_platform: string;
  source_listing_id: string | null | undefined;
};

export type VehicleEventWriteResult =
  | { action: 'updated' | 'inserted'; id: string | null }
  | { action: 'skipped'; reason: string }
  | { action: 'error'; error: string; code: string | null };

// The minimal PostgREST surface this needs; tests pass a stub.
type Client = { from: (table: string) => any };

async function updateByKey(supabase: Client, row: VehicleEventRow) {
  return await supabase
    .from('vehicle_events')
    .update(row)
    .eq('vehicle_id', row.vehicle_id)
    .eq('source_platform', row.source_platform)
    .eq('source_listing_id', row.source_listing_id)
    .select('id')
    .limit(1);
}

function firstId(data: unknown): string | null {
  return Array.isArray(data) && data.length > 0 ? ((data[0] as { id?: string })?.id ?? null) : null;
}

export async function writeVehicleEventByKey(supabase: Client, row: VehicleEventRow): Promise<VehicleEventWriteResult> {
  if (!row.vehicle_id) return { action: 'skipped', reason: 'no vehicle_id' };
  if (!row.source_platform) return { action: 'skipped', reason: 'no source_platform' };
  if (!row.source_listing_id) return { action: 'skipped', reason: 'no source_listing_id' };

  const upd = await updateByKey(supabase, row);
  if (upd.error) return { action: 'error', error: String(upd.error.message ?? upd.error), code: upd.error.code ?? null };
  if (Array.isArray(upd.data) && upd.data.length > 0) return { action: 'updated', id: firstId(upd.data) };

  const ins = await supabase.from('vehicle_events').insert(row).select('id').limit(1);
  if (!ins.error) return { action: 'inserted', id: firstId(ins.data) };

  if (String(ins.error.code ?? '') === '23505') {
    const again = await updateByKey(supabase, row);
    if (again.error) return { action: 'error', error: String(again.error.message ?? again.error), code: again.error.code ?? null };
    if (Array.isArray(again.data) && again.data.length > 0) return { action: 'updated', id: firstId(again.data) };
  }
  return { action: 'error', error: String(ins.error.message ?? ins.error), code: ins.error.code ?? null };
}

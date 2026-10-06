// Write one vehicle_events row (a listing episode) by its listing key.
//
// vehicle_events' listing key is the PARTIAL unique index idx_vehicle_events_dedup
// (vehicle_id, source_platform, source_listing_id) WHERE source_listing_id IS NOT NULL. There is no non-partial unique key.
// PostgREST's onConflict cannot carry that WHERE, and Postgres only infers a partial unique index when the conflict
// target states its predicate. So every `.upsert(..., { onConflict: 'source_platform,source_listing_id' })` fails with
// "there is no unique or exclusion constraint matching the ON CONFLICT specification": 60 Gooding lots on 2026-10-06
// 12:10–13:00Z, and 113 such errors in postgres_logs in that hour.
// This helper writes the way extract-bat-core does, by the key. It reads the live row, updates it by id if it exists,
// and otherwise inserts. If the insert loses a race to another writer (23505), it reads and updates once more.
//
// Clocks on a live row are fill-only. The lander writes sold_at or ended_at only where the live row has NULL. It never
// clears a stated clock and never overwrites one in place; corrections go through the supersession writer.
// A row whose clocks were corrected by that writer carries metadata.clock_locked_by_supersession, or a non-empty
// metadata.episode_supersessions. On such a row the lander also leaves the clock metadata (*_method, *_precision,
// sold_at_basis) as it is, keeps the marker, and reports action 'updated_clock_locked'. Metadata is merged into the live
// row's, never replaced, so other writers' keys survive.

export type VehicleEventRow = Record<string, unknown> & {
  vehicle_id: string | null | undefined;
  source_platform: string;
  source_listing_id: string | null | undefined;
  metadata?: Record<string, unknown> | null;
};

export type VehicleEventWriteResult =
  | { action: 'updated' | 'updated_clock_locked' | 'inserted'; id: string | null }
  | { action: 'skipped'; reason: string }
  | { action: 'error'; error: string; code: string | null };

// The minimal PostgREST surface this needs; tests pass a stub.
type Client = { from: (table: string) => any };
type LiveRow = { id: string; metadata: Record<string, unknown> | null; sold_at?: string | null; ended_at?: string | null };

const CLOCK_FIELDS = ['sold_at', 'ended_at'] as const;
const CLOCK_METADATA = [
  'clock_locked_by_supersession', 'episode_supersessions',
  'sold_at_method', 'sold_at_precision', 'ended_at_method', 'ended_at_precision', 'sold_at_basis',
];

export function clocksLocked(metadata: Record<string, unknown> | null | undefined): boolean {
  if (!metadata) return false;
  if (metadata.clock_locked_by_supersession) return true;
  const sup = metadata.episode_supersessions;
  return Array.isArray(sup) && sup.length > 0;
}

/** The update for a live row: clocks fill-only, metadata merged; on a locked row, no clock column or clock metadata. */
export function patchForLiveRow(live: LiveRow, row: VehicleEventRow): { patch: Record<string, unknown>; locked: boolean } {
  const locked = clocksLocked(live.metadata);
  const patch: Record<string, unknown> = { ...row };
  const merged: Record<string, unknown> = { ...(live.metadata ?? {}), ...(row.metadata ?? {}) };
  for (const f of CLOCK_FIELDS) {
    if (locked || patch[f] == null || live[f] != null) delete patch[f];
  }
  if (locked) {
    for (const k of CLOCK_METADATA) {
      if (live.metadata && k in live.metadata) merged[k] = live.metadata[k];
      else delete merged[k];
    }
  }
  patch.metadata = merged;
  return { patch, locked };
}

async function readByKey(supabase: Client, row: VehicleEventRow) {
  return await supabase
    .from('vehicle_events')
    .select('id, metadata, sold_at, ended_at')
    .eq('vehicle_id', row.vehicle_id)
    .eq('source_platform', row.source_platform)
    .eq('source_listing_id', row.source_listing_id)
    .limit(1);
}

function err(e: { message?: string; code?: string } | string): VehicleEventWriteResult {
  return typeof e === 'string'
    ? { action: 'error', error: e, code: null }
    : { action: 'error', error: String(e.message ?? e), code: e.code ?? null };
}

async function updateLive(supabase: Client, live: LiveRow, row: VehicleEventRow): Promise<VehicleEventWriteResult> {
  const { patch, locked } = patchForLiveRow(live, row);
  const upd = await supabase.from('vehicle_events').update(patch).eq('id', live.id).select('id').limit(1);
  if (upd.error) return err(upd.error);
  return { action: locked ? 'updated_clock_locked' : 'updated', id: live.id };
}

export async function writeVehicleEventByKey(supabase: Client, row: VehicleEventRow): Promise<VehicleEventWriteResult> {
  if (!row.vehicle_id) return { action: 'skipped', reason: 'no vehicle_id' };
  if (!row.source_platform) return { action: 'skipped', reason: 'no source_platform' };
  if (!row.source_listing_id) return { action: 'skipped', reason: 'no source_listing_id' };

  const sel = await readByKey(supabase, row);
  if (sel.error) return err(sel.error);
  if (Array.isArray(sel.data) && sel.data.length > 0) return await updateLive(supabase, sel.data[0] as LiveRow, row);

  const ins = await supabase.from('vehicle_events').insert(row).select('id').limit(1);
  if (!ins.error) {
    const id = Array.isArray(ins.data) && ins.data.length > 0 ? (ins.data[0] as { id?: string }).id ?? null : null;
    return { action: 'inserted', id };
  }
  if (String(ins.error.code ?? '') === '23505') {
    const again = await readByKey(supabase, row);
    if (again.error) return err(again.error);
    if (Array.isArray(again.data) && again.data.length > 0) return await updateLive(supabase, again.data[0] as LiveRow, row);
  }
  return err(ins.error);
}

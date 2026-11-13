import { observationClockMicroseconds } from '../_shared/observationContentHash.ts';

// What batch-extract-snapshots may write to a vehicle, as the database enforces it. Two BEFORE UPDATE triggers on vehicles
// refuse a whole row when one field breaks them, and the function treated the refusal as a failed row:
//
// 1. guard_vehicle_sale_price (2026-09-27, vehicles_sale_price_requires_sold_status): a sale_price above 0 is refused unless
//    the row's sale_status or auction_outcome is 'sold'. "A price alone is a bid, an ask or an estimate, never a sale."
//    The Barrett-Jackson parser returns a price for every snapshot (hammerPrice, else the RSC "price" field).
// 2. enforce_vin_uniqueness: a VIN already on another vehicle is refused with unique_violation (23505) and the message
//    "VIN <vin> already exists on vehicle <id>". The retry written for the native unique index looked for the words
//    "unique constraint", which this message does not contain, so a VIN conflict failed the row.
//
// Measured 2026-10-14 on 239 live rows from three slices of the pending Barrett-Jackson queue, with the function's own
// parser: 65 rows (27%) would write a price to a vehicle not marked sold, and 90 would write a VIN, all 90 of them already
// on another vehicle (a www and non-www twin, or the same car under a Mecum row). 110 rows (46%) would have had their whole
// update refused, 46 of them with other fields that would have landed.

/** guard_vehicle_sale_price's test: money moved only if the vehicle says so. */
export function salePriceWritable(vehicle: { sale_status?: string | null; auction_outcome?: string | null }): boolean {
  return vehicle.sale_status === 'sold' || vehicle.auction_outcome === 'sold';
}

/** A unique violation from the vehicles update: the VIN trigger (23505, "already exists on vehicle") or a unique index. */
export function isUniqueViolation(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === '23505') return true;
  return /unique constraint|already exists on vehicle/i.test(String(err.message ?? ''));
}

/** Keep the page reading before a vehicle update can make the row look finished.
 * The canonical writer owns testimony. Its duplicate reply is checked against the
 * stored reading too; an HTTP success alone is not evidence of admission.
 */
export async function admitSnapshotObservation(supabase: any, input: {
  vehicleId: string;
  platform: string;
  snapshot: { id: string; listing_url: string; fetched_at: string };
  fields: Record<string, unknown>;
  method: string;
  version: string;
  citationExcerpt?: string | null;
}): Promise<{ observationId: string; duplicate: boolean }> {
  const { snapshot } = input;
  const captureClock = observationClockMicroseconds(snapshot?.fetched_at);
  if (!snapshot?.id || !snapshot.listing_url || captureClock === null) {
    throw new Error('Snapshot observation requires its capture ID, URL and observed clock');
  }
  const source = input.platform === 'carsandbids' ? 'cars-and-bids' : input.platform;
  const rawRef = `listing_page_snapshots:${snapshot.id}`;
  const fields = JSON.parse(JSON.stringify(input.fields));
  const body = {
    vehicle_id: input.vehicleId, source_slug: source, kind: 'listing',
    source_url: snapshot.listing_url, observed_at: snapshot.fetched_at,
    source_identifier: `snapshot:${snapshot.id}:${input.version}`,
    structured_data: fields, raw_source_ref: rawRef,
    extraction_method: input.method,
    agent_inferred: input.method === 'snapshot_ai_parse',
    extraction_metadata: { parser_version: input.version, snapshot_id: snapshot.id },
    ...(input.citationExcerpt ? { citation: { excerpt: input.citationExcerpt } } : {}),
    // Existing source replay must not wake paid analysis.
    defer_analysis: true,
  };
  const { data, error } = await supabase.functions.invoke('ingest-observation', { body });
  if (error || data?.success !== true || !data.observation_id) {
    throw new Error(`Snapshot observation admission failed: ${error?.message ?? data?.error ?? 'missing receipt'}`);
  }
  const saved = await supabase.from('vehicle_observations')
    .select('id,vehicle_id,kind,source_url,observed_at,structured_data,raw_source_ref,extraction_method,analysis_deferred,is_superseded,source:observation_sources!source_id(slug)')
    .eq('id', data.observation_id).maybeSingle();
  const row = saved.data;
  const canonical = (value: any): string => JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
  if (saved.error || !row || row.vehicle_id !== input.vehicleId || row.kind !== 'listing'
    || row.source?.slug !== source || row.source_url !== snapshot.listing_url
    || observationClockMicroseconds(row.observed_at) !== captureClock
    || row.raw_source_ref !== rawRef || row.extraction_method !== input.method
    || row.analysis_deferred !== true || row.is_superseded === true
    || canonical(row.structured_data) !== canonical(fields)) {
    throw new Error('Snapshot observation readback did not match the admitted capture and fields');
  }
  return { observationId: row.id, duplicate: data.duplicate === true };
}

import type { CollectingCarsExtracted } from '../extract-collecting-cars/extract.ts';

export interface CollectingCarsCapture {
  fields: CollectingCarsExtracted;
  snapshot_id: string;
  sha256: string;
  observed_at: string;
  source_url: string;
}

export function collectingCarsCapture(result: any, url: string): CollectingCarsCapture {
  url = url.replace(/\/$/, "");
  const c = result?.source_capture, f = result?.extracted;
  if (!result?.success || !c || !f || c.source_url !== url || f.url !== url
    || !/^[0-9a-f-]{36}$/.test(c.snapshot_id ?? '') || !/^[0-9a-f]{64}$/.test(c.sha256 ?? '')
    || !Number.isFinite(Date.parse(c.observed_at)) || Date.parse(c.observed_at) > Date.now()
    || !/^\d+$/.test(f.listing_id ?? '') || f.lot_type !== 'car'
    || !f.year || !f.make || !f.model || !Array.isArray(f.image_urls)) throw Error('cc_listing_capture_invalid');
  return { ...c, fields: f };
}

/** Source URL owns this presentation. A six-digit historic chassis must not select an unrelated vehicle. */
export function collectingCarsOwner(rows: any[], f: CollectingCarsExtracted): string | null {
  if (rows.length > 1) throw Error('cc_listing_owner_ambiguous');
  const v = rows[0];
  if (!v) return null;
  if ((v.origin_metadata?.auction_id != null && String(v.origin_metadata.auction_id) !== f.listing_id)
    || v.status === 'merged' || v.merged_into_vehicle_id || v.deleted_at || v.listing_url !== f.url
    || (v.vin && f.vin && v.vin.toUpperCase() !== f.vin.toUpperCase())
    || (v.year && Number(v.year) !== f.year)
    || (v.make && v.make.toLowerCase() !== f.make?.toLowerCase())) throw Error('cc_listing_owner_conflict');
  return v.id;
}

export async function landCollectingCarsCapture(db: any, c: CollectingCarsCapture, vehicleId: string) {
  const f = c.fields;
  const before = await db.from('vehicles').select('id,listing_url,country,origin_metadata,status')
    .eq('id', vehicleId).is('deleted_at', null).is('merged_into_vehicle_id', null).single();
  if (before.error || (before.data?.origin_metadata?.auction_id != null && String(before.data.origin_metadata.auction_id) !== f.listing_id)
    || before.data?.status === 'merged' || before.data?.listing_url !== f.url) throw Error('cc_listing_owner_readback_failed');
  const payload = { source_slug: 'collecting-cars', vehicle_id: vehicleId, kind: 'listing', source_url: f.url,
    source_identifier: `cc_native_listing_v1:${f.listing_id}:${c.snapshot_id}`, observed_at: c.observed_at,
    raw_source_ref: `listing_page_snapshots:${c.snapshot_id}`, extraction_method: 'cc_native_listing_v1', defer_analysis: true,
    content_text: f.description ?? f.title,
    structured_data: { ...f, source_claims_only: true, capture_kind: 'listing_page', source_event_time_status: 'unknown' },
    extraction_metadata: { source_capture: { snapshot_id: c.snapshot_id, sha256: c.sha256, source_url: f.url, source_read_at: c.observed_at },
      prior_vehicle_country: before.data.country ?? null },
  };
  const admitted = await db.functions.invoke('ingest-observation', { body: payload });
  if (admitted.error || admitted.data?.success !== true || !admitted.data.observation_id) throw Error('cc_listing_admission_failed');
  const read = await db.from('vehicle_observations').select('id,vehicle_id,source_url,raw_source_ref')
    .eq('id', admitted.data.observation_id).eq('observed_at', c.observed_at).eq('is_superseded', false).single();
  if (read.error || read.data?.vehicle_id !== vehicleId || read.data?.source_url !== f.url
    || read.data?.raw_source_ref !== payload.raw_source_ref) throw Error('cc_listing_admission_readback_failed');
  // Board stubs inherited the US default. Correct only when both independent
  // retained CC representations agree; preserve the prior scalar in the receipt.
  let countryCorrected = false;
  if (f.country && before.data.origin_metadata?.country?.toUpperCase() === f.country
    && before.data.country !== f.country && [null, 'USA', 'US'].includes(before.data.country)) {
    let update = db.from('vehicles').update({ country: f.country }).eq('id', vehicleId).eq('listing_url', f.url).is('deleted_at', null).is('merged_into_vehicle_id', null)
      .or('status.is.null,status.neq.merged').eq('origin_metadata', JSON.stringify(before.data.origin_metadata));
    update = before.data.country == null ? update.is('country', null) : update.eq('country', before.data.country);
    const changed = await update.select('id');
    if (changed.error || changed.data?.length !== 1) throw Error('cc_country_projection_failed');
    countryCorrected = true;
  }
  const expected = new Set(f.image_urls), held = new Set<string>();
  const urls = [...expected];
  for (let i = 0; i < urls.length; i += 80) {
    const gallery = await db.from('vehicle_images').select('image_url').eq('vehicle_id', vehicleId).in('image_url', urls.slice(i, i + 80));
    if (gallery.error) throw Error('cc_gallery_readback_failed');
    for (const row of gallery.data ?? []) held.add(row.image_url);
  }
  if ([...expected].some(u => !held.has(u))) throw Error('cc_gallery_incomplete');
  return { observation_id: read.data.id, snapshot_id: c.snapshot_id, source_read_at: c.observed_at,
    images: expected.size, country_corrected: countryCorrected, duplicate: admitted.data.duplicate === true };
}

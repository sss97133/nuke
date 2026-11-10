import { extractFromHtml } from './extract.ts';

export interface CcSnapshotPin { snapshot_id: string; expected_sha256: string }
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function ccSnapshotPin(value: unknown): CcSnapshotPin {
  const v = value as Record<string, unknown>;
  if (!v || typeof v !== 'object' || Array.isArray(v)
    || Object.keys(v).some(k => !['snapshot_id', 'expected_sha256'].includes(k))
    || typeof v.snapshot_id !== 'string' || !UUID.test(v.snapshot_id)
    || typeof v.expected_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(v.expected_sha256))
    throw Error('cc_snapshot_pin_invalid');
  return { snapshot_id: v.snapshot_id, expected_sha256: v.expected_sha256 };
}
function lotUrl(value: string) {
  if (!/^https:\/\/collectingcars\.com\/for-sale\/[a-zA-Z0-9+-]+\/?$/.test(value)) throw Error('cc_snapshot_url_invalid');
  return value.replace(/\/$/, '');
}

/** Bounded discovery only. A candidate is not proof of a closed page or successful replay. */
export async function collectingCarsReplayCandidates(db: any, sourceUrl: string) {
  const url = lotUrl(sourceUrl);
  const read = await db.from('listing_page_snapshots').select('id,html_sha256,fetched_at')
    .eq('platform', 'collectingcars').eq('listing_url', url).eq('success', true).eq('http_status', 200)
    .order('fetched_at', { ascending: false }).order('id', { ascending: false }).limit(3).abortSignal(AbortSignal.timeout(5000));
  if (read.error || !Array.isArray(read.data)) throw Error('cc_snapshot_candidates_unavailable');
  return read.data.map((s: any) => ({ ...ccSnapshotPin({ snapshot_id: s.id, expected_sha256: s.html_sha256 }), fetched_at: s.fetched_at }));
}

/** No publisher fetch, insert, re-clock or unpinned fallback. Protected bytes remain server-side. */
export async function replayClosedCollectingCars(db: any, sourceUrl: string, value: unknown, expectedListingId?: string) {
  const pin = ccSnapshotPin(value), url = lotUrl(sourceUrl);
  const read = await db.from('listing_page_snapshots')
    .select('id,listing_url,platform,success,http_status,html,html_storage_path,html_sha256,fetched_at,created_at,metadata,content_length')
    .eq('id', pin.snapshot_id).abortSignal(AbortSignal.timeout(5000)).maybeSingle();
  if (read.error) throw Error('cc_snapshot_read_unavailable');
  const s = read.data, at = Date.parse(s?.fetched_at ?? ''), archived = Date.parse(s?.created_at ?? '');
  if (!s || s.id !== pin.snapshot_id || s.platform !== 'collectingcars' || s.listing_url !== url
    || s.success !== true || s.http_status !== 200 || s.html_sha256 !== pin.expected_sha256
    || s.metadata?.rows_only === true || s.metadata?.withdrawn === true
    || (s.content_length != null && (!Number.isFinite(s.content_length) || s.content_length > 2_097_152))
    || !Number.isFinite(at) || !Number.isFinite(archived) || at > Date.now() || archived > Date.now() || archived < at)
    throw Error('cc_snapshot_custody_refused');
  let html = s.html;
  if (!html && s.html_storage_path) {
    const path = s.html_storage_path;
    if (typeof path !== 'string' || !/^[a-zA-Z0-9_./-]+$/.test(path) || path.startsWith('/')
      || path.split('/').some((p: string) => p === '.' || p === '..')) throw Error('cc_snapshot_storage_refused');
    const stored = await db.storage.from('listing-snapshots').download(path);
    if (stored.error || !stored.data || stored.data.size > 2_097_152) throw Error('cc_snapshot_storage_unavailable');
    html = await stored.data.text();
  }
  if (typeof html !== 'string' || html.length < 5000 || new TextEncoder().encode(html).byteLength > 2_097_152)
    throw Error('cc_snapshot_body_unavailable');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(html)))].map(x => x.toString(16).padStart(2, '0')).join('');
  if (hash !== pin.expected_sha256) throw Error('cc_snapshot_hash_refused');
  const extracted = extractFromHtml(html, url);
  if (expectedListingId !== undefined && extracted.listing_id !== expectedListingId) throw Error('cc_snapshot_listing_mismatch');
  // Only an explicit open car is safe ineligibility for a read-only caller.
  if (extracted.lot_type === 'car' && ['live', 'comingsoon'].includes(extracted.stage ?? '')) throw Error('cc_snapshot_open_car');
  // Unknown/withdrawn/non-car stages are refusals, never permission to fetch another page.
  if (!['sold', 'unsold'].includes(extracted.stage ?? '') || extracted.lot_type !== 'car') throw Error('cc_snapshot_not_closed_car');
  return { success: true, extracted: { ...extracted, listing_url: extracted.url },
    source_capture: { snapshot_id: s.id, sha256: hash, observed_at: s.fetched_at, source_url: url },
    replay: { kind: 'pinned_closed_listing', source_clock_preserved: true } };
}

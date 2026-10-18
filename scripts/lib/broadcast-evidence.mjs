/** The first tested Mecum source-grain contract, discovered from c9fxArnD3IY S114.
 * This is provisional source evidence, not a closed schema for all channel videos.
 * No database writes here. Relative media time is never synthesized into wall-clock time.
 */
import { createHash } from 'node:crypto';
import { canonicalJson, MUTABLE_SOURCE_ATTRIBUTION_KEYS } from '../../supabase/functions/_shared/observationIdentity.ts';

const digest = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
const text = value => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9.]/g, '');
const saleText = value => text(String(value ?? '').replace(/^mecum\s+/i, ''));
const known = value => value !== undefined && value !== null && value !== '';
const fail = message => { throw new Error(message); };
const mediaId = url => {
  const u = new URL(url);
  if (u.hostname === 'youtu.be') return u.pathname.slice(1);
  if (!['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(u.hostname)) return null;
  return u.searchParams.get('v') || u.pathname.match(/^\/(?:live|embed)\/([^/]+)/)?.[1];
};

/** Return one scoped market event or an unresolved/rejected receipt, never a first YMM hit. */
export function resolveBroadcastEvent(context, candidates) {
  const rejected = [];
  const accepted = candidates.filter(event => {
    const reasons = [];
    if (text(event.source) !== text(context.auction_house ?? 'mecum')) reasons.push('source_mismatch');
    const data = event.raw_data ?? event.metadata ?? {};
    const auctionId = context.auction_id ?? context.auction_source_key?.split(':').at(-1);
    const saleMatched = known(auctionId) && known(data.auction_id)
      ? text(auctionId) === text(data.auction_id)
      : known(context.auction) && known(data.auction_name) && saleText(context.auction) === saleText(data.auction_name);
    if (!saleMatched) reasons.push('sale_context_unverified_or_mismatch');
    if (known(context.source_listing_id)) {
      const listingId = event.source_listing_id ?? event.source_url?.match(/\/lots\/(\d+)(?:\/|$)/)?.[1];
      if (String(listingId) !== String(context.source_listing_id)) reasons.push('listing_id_mismatch');
    } else if (!known(context.lot) || text(event.lot_number) !== text(context.lot)) {
      reasons.push('scoped_lot_mismatch');
    }
    const vehicle = event.vehicle ?? {};
    for (const field of ['year', 'make', 'model', 'vin']) {
      if (known(context[field]) && known(vehicle[field]) && text(context[field]) !== text(vehicle[field])) {
        reasons.push(`${field}_contradiction`);
      }
    }
    if (reasons.length) rejected.push({ event_id: event.id, reasons });
    return reasons.length === 0;
  });
  if (accepted.length !== 1) return {
    status: accepted.length > 1 ? 'ambiguous' : 'unresolved',
    event_id: null, vehicle_id: null, rejected,
    candidate_ids: accepted.map(x => x.id),
  };
  return { status: 'scoped_event_match', event_id: accepted[0].id,
    vehicle_id: accepted[0].vehicle_id ?? null, rejected, candidate_ids: [accepted[0].id] };
}

/** Validate/freeze staged claims into the current sanctioned intake payload.
 * Capture-time rows are explicitly clocked as capture-time and cannot enter event-time backtests.
 * Typed citation/event FKs require the separately reviewed DB extension; provisional IDs remain out.
 */
export function prepareBroadcastReceipt(receipt) {
  if (!Array.isArray(receipt.observations) || !receipt.observations.length) fail('observations required');
  const keys = new Set();
  return receipt.observations.map((original, index) => {
    const input = structuredClone(original);
    const data = input.structured_data;
    const media = data?.media;
    const context = data?.event_context;
    if (input.source_slug !== 'youtube') fail(`claim ${index}: source must be youtube`);
    if (!/^[a-zA-Z0-9_-]{11}$/.test(media?.video_id ?? '')) fail(`claim ${index}: video_id required`);
    if (mediaId(input.source_url) !== media.video_id) fail(`claim ${index}: source URL/video mismatch`);
    if (!known(input.source_identifier)) fail(`claim ${index}: stable source_identifier required`);
    if (keys.has(input.source_identifier)) fail(`claim ${index}: duplicate source grain in receipt`);
    keys.add(input.source_identifier);
    if (!known(data.property) || !Object.hasOwn(data, 'value')) fail(`claim ${index}: one property/value required`);
    if (input.vehicle_id || input.vehicle_hints) fail(`claim ${index}: unresolved source receipt cannot assign a chassis`);
    if (!Number.isFinite(media.start_seconds) || media.start_seconds < 0) fail(`claim ${index}: invalid media start`);
    if (known(media.end_seconds) && (!Number.isFinite(media.end_seconds) || media.end_seconds < media.start_seconds)) {
      fail(`claim ${index}: invalid media end`);
    }
    if (known(media.end_seconds) && !known(media.end_semantics)) fail(`claim ${index}: media end semantics required`);
    if (!Number.isFinite(Date.parse(input.observed_at))) fail(`claim ${index}: frozen observation time required`);
    const capturedAt = input.extraction_metadata?.captured_at;
    if (!capturedAt || Date.parse(capturedAt) !== Date.parse(input.observed_at)) {
      fail(`claim ${index}: capture-time receipt must preserve captured_at as observed_at`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(context?.event_date ?? '') || context.event_date_precision !== 'day') {
      fail(`claim ${index}: discovered date-only event clock required`);
    }
    if (!input.raw_source_ref || !input.extraction_method) fail(`claim ${index}: evidence/method required`);
    if (/price|bid|cost/.test(data.property) && typeof data.value === 'number') {
      if (data.value < 0 || !known(data.claim_role)) fail(`claim ${index}: money role required`);
    }
    // Mutable attribution belongs in a resolution receipt, outside the source-event hash.
    const attribution = data.attribution;
    if (attribution) {
      input.extraction_metadata = { ...input.extraction_metadata, staged_attribution: attribution };
      delete data.attribution;
    }
    const contextResolution = {};
    for (const key of MUTABLE_SOURCE_ATTRIBUTION_KEYS) {
      if (Object.hasOwn(context, key)) { contextResolution[key] = context[key]; delete context[key]; }
    }
    if (Object.keys(contextResolution).length) input.extraction_metadata = {
      ...input.extraction_metadata, staged_context_resolution: contextResolution };
    data.clock = {
      observed_at_basis: 'source_capture_time', source_event_date: context.event_date,
      source_event_time_precision: 'day', source_event_at: null,
      relative_media_time_unit: 'second', usable_for_exact_event_time_replay: false,
    };
    input.kind = 'media';
    input.vehicle_id = undefined;
    input.resolution_mode = 'none';
    input.dedup_scope = 'source_event';
    input.agent_inferred = true;
    if (typeof input.observer_raw === 'string') input.observer_raw = { speaker_label: input.observer_raw, speaker_id: null };
    // This digest covers normalized JSON claims. It is explicitly not a hash of downloaded video bytes.
    input.extraction_metadata = { ...input.extraction_metadata,
      source_claim_sha256: digest({ source: input.source_slug, key: input.source_identifier,
        time: input.observed_at, data, text: input.content_text ?? '' }),
      source_claim_hash_basis: 'canonical_normalized_claim_json', source_video_sha256: null,
      prior_draft_kind: original.kind, contract_version: 'mecum-source-grain-v1',
    };
    return input;
  });
}

/** Assay a receipt without converting screen prices or an announced high bid into accepted bids. */
export function assayBroadcastReceipt(observations) {
  return {
    expected_source_grains: observations.length,
    unique_source_grains: new Set(observations.map(x => x.source_identifier)).size,
    exact_event_time_grains: observations.filter(x => x.structured_data.clock?.usable_for_exact_event_time_replay === true).length,
    unresolved_vehicle_grains: observations.filter(x => !x.vehicle_id).length,
    accepted_bid_grains: observations.filter(x => x.structured_data.claim_role === 'accepted_bid').length,
    claim_roles: observations.reduce((out, x) => {
      const role = x.structured_data.claim_role ?? 'unspecified';
      out[role] = (out[role] ?? 0) + 1;
      return out;
    }, {}),
  };
}

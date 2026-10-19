import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBroadcastEvent, prepareBroadcastReceipt, assayBroadcastReceipt } from './broadcast-evidence.mjs';
import { observationHashInput, MUTABLE_SOURCE_ATTRIBUTION_KEYS } from '../../supabase/functions/_shared/observationIdentity.ts';
import { mediaCitationColumns } from '../../supabase/functions/_shared/mediaCitation.ts';

const context = { auction: 'Mecum Kissimmee 2026', auction_id: 'FL26', auction_house: 'mecum',
  source_listing_id: '1159827', lot: 'S114', year: 1967, make: 'Chevrolet', model: 'Corvette' };
const actual = { id: 'actual-event', vehicle_id: 'corvette', source: 'mecum', source_listing_id: '1159827',
  lot_number: 'S114', raw_data: { auction_id: 'FL26', auction_name: 'Mecum Kissimmee 2026' },
  vehicle: { year: 1967, make: 'Chevrolet', model: 'Corvette' } };
const wrong = { id: '767e325c-6470-4b0f-b7f7-e0d6ccb5aa98', vehicle_id: '707ccdb4-f4ad-4991-8c90-594f6e090b5a',
  source: 'mecum', source_listing_id: '1139323', lot_number: 'F123',
  raw_data: { auction_id: 'AZ25', auction_name: 'Glendale 2025' },
  vehicle: { year: 1970, make: 'Chevrolet', model: 'C10 Cheyenne Pickup' } };

const claim = () => ({ source_slug: 'youtube', kind: 'listing', observed_at: '2026-10-02T04:53:07.782Z',
  source_url: 'https://www.youtube.com/watch?v=c9fxArnD3IY&t=2600s',
  source_identifier: 'youtube:c9fxArnD3IY:caption:350:claim:high_bid:v1',
  content_text: 'Commentary reports a high bid of $140000.', observer_raw: 'Unidentified commentator',
  structured_data: { property: 'high_bid_announced', value: 140000, unit: 'USD', claim_role: 'high_bid_statement',
    media: { video_id: 'c9fxArnD3IY', start_seconds: 2600, end_seconds: 2606,
      end_semantics: 'next_caption_onset_not_utterance_end' },
    event_context: { ...context, event_date: '2026-01-17', event_date_precision: 'day' },
    attribution: { vehicle_id: null, vehicle_resolution_status: 'unresolved' } },
  raw_source_ref: 'https://www.youtube.com/watch?v=c9fxArnD3IY&t=2600s',
  extraction_method: 'manual-normalization-from-youtube-auto-captions',
  extraction_metadata: { captured_at: '2026-10-02T04:53:07.782Z' } });

test('real contaminated C10/Glendale link is rejected; source-scoped S114 resolves', () => {
  const result = resolveBroadcastEvent(context, [wrong, actual]);
  assert.equal(result.event_id, actual.id);
  assert.ok(result.rejected[0].reasons.includes('sale_context_unverified_or_mismatch'));
  assert.ok(result.rejected[0].reasons.includes('listing_id_mismatch'));
  assert.ok(result.rejected[0].reasons.includes('year_contradiction'));
});
test('global reused lot and YMM never substitute for sale context', () => {
  assert.equal(resolveBroadcastEvent(context, [{ ...actual, raw_data: { auction_id: 'FL24' } }]).vehicle_id, null);
  assert.equal(resolveBroadcastEvent({ year: 1967, make: 'Chevrolet' }, [actual]).vehicle_id, null);
});
test('ambiguous event identities remain unresolved', () => {
  assert.equal(resolveBroadcastEvent(context, [actual, { ...actual, id: 'duplicate-event' }]).status, 'ambiguous');
});
test('verified source URL resolves when legacy event listing/sale-code columns are empty', () => {
  const event = { ...actual, source_listing_id: null,
    source_url: 'https://www.mecum.com/lots/1159827/1967-chevrolet-corvette-two-top-convertible/',
    raw_data: { auction_name: 'Kissimmee 2026' } };
  assert.equal(resolveBroadcastEvent(context, [event]).event_id, actual.id);
  assert.equal(event.source_listing_id, null); // Original legacy testimony is unchanged.
});
test('source-grain receipt records time uncertainty and never creates accepted bid or sale', () => {
  const [obs] = prepareBroadcastReceipt({ observations: [claim()] });
  assert.equal(obs.kind, 'media'); assert.equal(obs.resolution_mode, 'none');
  assert.equal(obs.structured_data.clock.source_event_at, null);
  assert.equal(obs.structured_data.clock.source_event_time_precision, 'day');
  assert.equal(assayBroadcastReceipt([obs]).accepted_bid_grains, 0);
  assert.equal(assayBroadcastReceipt([obs]).exact_event_time_grains, 0);
  assert.equal(obs.extraction_metadata.source_video_sha256, null);
});
test('simultaneous screen regions retain distinct $80k/$110k price claims', () => {
  const lower = claim(); const board = claim();
  for (const [obs, region, value] of [[lower, 'lower_third', 80000], [board, 'physical_board', 110000]]) {
    obs.source_identifier = `youtube:c9fxArnD3IY:frame:2546000:${region}:displayed_bid`;
    obs.structured_data.property = 'displayed_bid'; obs.structured_data.value = value;
    obs.structured_data.claim_role = 'screen_display'; obs.structured_data.media.screen_region = region;
  }
  const out = prepareBroadcastReceipt({ observations: [lower, board] });
  assert.equal(new Set(out.map(x => x.source_identifier)).size, 2);
  assert.equal(assayBroadcastReceipt(out).accepted_bid_grains, 0);
});
test('source-event hash survives JSON key reorder and later chassis attribution', () => {
  const [obs] = prepareBroadcastReceipt({ observations: [claim()] });
  const reordered = { ...obs, vehicle_id: 'different-vehicle',
    structured_data: Object.fromEntries(Object.entries(obs.structured_data).reverse()) };
  assert.equal(observationHashInput(obs), observationHashInput(reordered));
  assert.equal(observationHashInput(obs), observationHashInput({ ...obs,
    observed_at: '2026-10-03T01:00:00Z', source_url: 'https://youtu.be/c9fxArnD3IY?t=2600' }));
  const correction = structuredClone(obs); correction.structured_data.value = 150000;
  assert.notEqual(observationHashInput(obs), observationHashInput(correction));
  const unsafe = structuredClone(obs); unsafe.structured_data.event_context.vehicle_id = 'assigned-in-json';
  assert.throws(() => observationHashInput(unsafe), /mutable attribution/);
});
test('resolved/canonical aliases and matching methods cannot fork source-event identity', () => {
  const before = claim(); const after = claim();
  const [clean] = prepareBroadcastReceipt({ observations: [claim()] });
  for (const key of MUTABLE_SOURCE_ATTRIBUTION_KEYS) {
    before.structured_data.event_context[key] = `old-${key}`;
    after.structured_data.event_context[key] = `new-${key}`;
    // Test each alias independently; a different forbidden key must not mask a missing guard.
    const unsafeContext = structuredClone(clean);
    unsafeContext.structured_data.event_context[key] = `old-${key}`;
    assert.throws(() => observationHashInput(unsafeContext), /mutable attribution/);
    const unsafeAttribution = structuredClone(clean);
    unsafeAttribution.structured_data.attribution = { [key]: `new-${key}` };
    assert.throws(() => observationHashInput(unsafeAttribution), /mutable attribution/);
  }
  const [preparedBefore] = prepareBroadcastReceipt({ observations: [before] });
  const [preparedAfter] = prepareBroadcastReceipt({ observations: [after] });
  assert.equal(observationHashInput(preparedBefore), observationHashInput(preparedAfter));
  assert.equal(preparedBefore.extraction_metadata.staged_context_resolution.resolved_vehicle_id, 'old-resolved_vehicle_id');
  assert.equal(preparedAfter.extraction_metadata.staged_context_resolution.resolved_vehicle_id, 'new-resolved_vehicle_id');
  assert.equal(preparedAfter.extraction_metadata.staged_context_resolution.match_method, 'new-match_method');
  for (const key of MUTABLE_SOURCE_ATTRIBUTION_KEYS) assert.equal(Object.hasOwn(preparedAfter.structured_data.event_context, key), false);
  // The opt-in rule does not change the legacy hash grammar or its attribution sensitivity.
  assert.notEqual(observationHashInput(before), observationHashInput(after));
});
test('capture-clock change, missing source key, reversed span and forced chassis are refused', () => {
  const variants = [claim(), claim(), claim(), claim()];
  variants[0].observed_at = '2026-01-17T00:00:00Z';
  variants[1].source_identifier = '';
  variants[2].structured_data.media.end_seconds = 2500;
  variants[3].vehicle_id = wrong.vehicle_id;
  for (const obs of variants) assert.throws(() => prepareBroadcastReceipt({ observations: [obs] }));
});
test('URL/video mismatch, duplicate source grains and undated source clock are refused', () => {
  const mismatch = claim(); mismatch.structured_data.media.video_id = 'aaaaaaaaaaa';
  assert.throws(() => prepareBroadcastReceipt({ observations: [mismatch] }));
  assert.throws(() => prepareBroadcastReceipt({ observations: [claim(), claim()] }));
  const undated = claim(); undated.structured_data.event_context.event_date = null;
  assert.throws(() => prepareBroadcastReceipt({ observations: [undated] }));
});
test('legacy hash grammar remains unchanged', () => {
  const obs = { source_slug: 'bat', kind: 'listing', observed_at: '2026-01-01T00:00:00Z' };
  assert.equal(observationHashInput(obs), JSON.stringify({ source: 'bat', kind: 'listing', vehicle_id: '',
    source_url: '', source_identifier: '', observed_at: obs.observed_at, text: '', data: {}, observer: {} }));
});
test('audio discussion, visible presence and lot activity are separate relations', () => {
  const audio = { start_ms: 2532000, end_ms: 2541000, relation: 'vehicle_discussed', span_semantics: 'caption_cue' };
  assert.equal(mediaCitationColumns(audio).media_relation, 'vehicle_discussed');
  assert.throws(() => mediaCitationColumns({ ...audio, relation: 'vehicle_visible' }));
  assert.throws(() => mediaCitationColumns({ ...audio, relation: 'lot_active' }));
  assert.equal(mediaCitationColumns({ start_ms: 2546000, relation: 'vehicle_visible', span_semantics: 'point_sample' }).media_end_ms, null);
  assert.throws(() => mediaCitationColumns({ start_ms: 2546000, end_ms: 2600000, relation: 'vehicle_visible', span_semantics: 'point_sample' }));
});
test('day event date does not supply a wall clock; exact event times require an instant', () => {
  const fields = mediaCitationColumns(undefined, { observed_at_basis: 'source_capture_time', event_precision: 'day', event_date: '2026-01-17', available_at: '2026-01-24T15:00:06Z' });
  assert.equal(fields.source_event_at, null);
  assert.equal(fields.source_available_at, '2026-01-24T15:00:06Z');
  assert.throws(() => mediaCitationColumns(undefined, { observed_at_basis: 'event_time', event_precision: 'exact', event_date: '2026-01-17' }));
});
test('unknown event precision refuses an asserted date before the SQL constraint sees it', () => {
  const unknown = { observed_at_basis: 'source_capture_time', event_precision: 'unknown' };
  assert.equal(mediaCitationColumns(undefined, unknown).source_event_date, null);
  assert.throws(() => mediaCitationColumns(undefined, { ...unknown, event_date: '2026-01-17' }), /cannot claim a date/);
  assert.throws(() => mediaCitationColumns(undefined, { ...unknown, event_date: '' }), /cannot claim a date/);
  assert.throws(() => mediaCitationColumns(undefined, { ...unknown, event_at: '' }), /cannot claim an instant/);
  assert.throws(() => mediaCitationColumns(undefined, { ...unknown, available_at: '' }), /Invalid source available_at/);
});

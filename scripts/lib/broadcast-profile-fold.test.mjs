import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBroadcastFold, applyBroadcastGrain, readBroadcastFold } from './broadcast-profile-fold.mjs';
const sample = JSON.parse(readFileSync(new URL('../fixtures/mecum-s114-fold-input.json',import.meta.url)));
const context = { auction_event_id: sample.auction_event_id, organization_id: sample.organization_id,
  source_available_at:'2026-01-24T15:00:06Z', source_event_date:'2026-01-17', event_precision:'day' };
function run(rows=sample.claims, settings=context) { const state=createBroadcastFold(settings); rows.forEach(g=>applyBroadcastGrain(state,g)); return { state, result:readBroadcastFold(state) }; }

test('actual seven overlay samples yield proxies and preserve unknown bid velocity/lot duration',()=>{
  const {result}=run(); const overlay=result.display_streams.find(s=>s.source_property==='current_bid_displayed');
  assert.equal(result.measured.caption_attribute_claims,25);
  assert.equal(overlay.sample_count,7); assert.equal(overlay.proxy_eligible_samples,6);
  assert.equal(overlay.first_price_usd,80000); assert.equal(overlay.last_price_usd,140000);
  assert.equal(overlay.sampled_elapsed_seconds,54); assert.equal(overlay.endpoint_delta_usd,60000);
  assert.equal(result.coverage.price_samples_excluded_for_alignment,1);
  assert.equal(result.unknown.accepted_bid_velocity_per_second,null);
  assert.equal(result.unknown.active_lot_duration_seconds,null);
  assert.equal(result.unknown.speaker_role,null);
});

test('simultaneous background instrument remains separate and cannot yield a rate',()=>{
  const {result}=run(); const board=result.display_streams.find(s=>s.source_property==='background_board_amount');
  assert.equal(board.sample_count,1); assert.equal(board.first_price_usd,110000);
  assert.equal(board.regression_growth_usd_per_nominal_media_second,null);
});

test('replay and reordered input preserve fold metrics and source lineage',()=>{
  const {state,result}=run(); sample.claims.forEach(g=>assert.equal(applyBroadcastGrain(state,g).reason,'duplicate_source_grain'));
  assert.deepEqual(readBroadcastFold(state),result);
  const reversed=run([...sample.claims].reverse()).result;
  assert.deepEqual(reversed.display_streams.sort((a,b)=>a.source_stream.localeCompare(b.source_stream)),result.display_streams.sort((a,b)=>a.source_stream.localeCompare(b.source_stream)));
  assert.deepEqual(reversed.lineage,result.lineage);
  assert.equal(reversed.measured.caption_cue_union_seconds,result.measured.caption_cue_union_seconds);
});

test('Jan17 event backtest cannot read the Jan24 broadcast; system clock remains independent',()=>{
  const before=run(sample.claims,{...context,source_as_of:'2026-01-18T00:00:00Z'}).result;
  assert.equal(before.measured.source_claims,0); assert.equal(before.coverage.claims_excluded_by_source_as_of,33);
  const system=run(sample.claims,{...context,system_as_of:'2026-09-01T00:00:00Z'}).result;
  assert.equal(system.measured.source_claims,0); assert.equal(system.coverage.claims_excluded_by_system_as_of,33);
});

test('caption properties never become verified speaker opinions or acoustic excitement',()=>{
  const {result}=run(); assert.equal(result.measured.explicit_opinion_claims,0);
  assert.equal(result.unknown.acoustic_excitation,null); assert.equal(result.unknown.crowd_emotion,null);
  assert.ok(result.measured.distinct_caption_cues < result.measured.caption_attribute_claims);
  assert.equal(result.measured.caption_cue_union_seconds,67);
});

test('malformed alignment metadata remains an evidence sample but cannot supply a price-rate fit',()=>{
  const grain=structuredClone(sample.claims.find(g=>g.property==='current_bid_displayed'));
  grain.media.decoded_callback_media_time_seconds='unknown';
  const {result}=run([grain]);
  assert.equal(result.display_streams[0].sample_count,1);
  assert.equal(result.display_streams[0].proxy_eligible_samples,0);
  assert.equal(result.coverage.price_samples_excluded_for_alignment,1);
});

test('unknown or malformed clocks cannot pass an as-of filter',()=>{
  const grain={...sample.claims[0],source_available_at:'unknown',ingested_at:'unknown'};
  assert.equal(run([grain],{...context,source_as_of:'2026-10-02T23:00:00Z'}).result.measured.source_claims,0);
  assert.equal(run([grain],{...context,system_as_of:'2026-10-02T23:00:00Z'}).result.measured.source_claims,0);
  assert.throws(()=>createBroadcastFold({...context,source_as_of:'unknown'}),/Invalid source_as_of/);
});

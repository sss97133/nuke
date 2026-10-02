import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverCaptionCues, discoverAudioAssay } from './broadcast-caption-discovery.mjs';

const source = segments => ({ video_id: 'test0000001', captured_at: '2026-10-02T00:00:00Z',
  transcript_type: 'test_fixture', timing_unit: 'seconds_from_media_start',
  segments: segments.map((s,index) => ({ index, time_seconds: s[0], text: s[1] })) });
const options = { raw_source_ref: '/test/INTERNAL.json', event_date: '2026-01-17', auction: 'fixture auction' };

test('technical numbers and model years never become prices or accepted bids', () => {
  const result = discoverCaptionCues(source([[0,'1967 Corvette with 400 horse 427 engine, 62,000 miles.'],[5,'300.']]),options);
  assert.equal(result.grains.some(g => g.structured_data.property === 'price_language_cue'),false);
  assert.equal(result.summary.yield.accepted_bids_verified,0);
  assert.equal(result.summary.yield.actual_vehicle_presentations_verified,0);
});

test('explicit high-bid language retains money role, unknown currency and unverified scale', () => {
  const result = discoverCaptionCues(source([[3,'The high bid was $140,000.'],[8,'$1.375 million.']]),options);
  const prices = result.grains.filter(g=>g.structured_data.property==='price_language_cue');
  assert.deepEqual(prices.map(g=>g.structured_data.value.explicit_currency_parses[0].amount),[140000,1375000]);
  assert.ok(prices.every(g=>g.structured_data.value.accepted_bid===null));
  assert.ok(prices.every(g=>g.structured_data.value.explicit_currency_parses[0].currency===null));
});

test('a historic sale phrase remains unresolved and cannot set current auction outcome', () => {
  const r = discoverCaptionCues(source([[0,'It sold last year for $100,000.']]),options);
  const g = r.grains.find(g=>g.structured_data.property==='outcome_language_cue');
  assert.equal(g.structured_data.value.scope,'historical_language_present');
  assert.equal(g.structured_data.value.auction_outcome,null);
  assert.equal(g.structured_data.clock.source_event_at,null);
});

test('opinion and specification language have separate grains and unknown speakers', () => {
  const r = discoverCaptionCues(source([[0,'A blue chip Corvette with its original engine.']]),options);
  assert.ok(r.grains.some(g=>g.structured_data.property==='evaluative_language_cue'));
  assert.ok(r.grains.some(g=>g.structured_data.property==='vehicle_detail_cue'));
  assert.ok(r.grains.every(g=>g.observer_raw.speaker_role===null && !g.vehicle_id));
});

test('simultaneous captions preserve two source identities and do not invent ends', () => {
  const r = discoverCaptionCues(source([[10,'Corvette.'],[10,'Ford.'],[18,'Engine.']]),options);
  assert.equal(r.summary.coverage.duplicate_onset_pairs,1);
  assert.equal(new Set(r.grains.map(g=>g.source_identifier)).size,r.grains.length);
  assert.equal(r.grains[0].structured_data.media.next_caption_onset_seconds,null);
  assert.equal(r.grains[0].structured_data.media.end_seconds,null);
});

test('duplicate identities, decreasing clocks, wrong timing units and empty input fail closed', () => {
  const s=source([[0,'Ford.'],[2,'Ford.']]);s.segments[1].index=0;
  assert.throws(()=>discoverCaptionCues(s,options),/Unique/);
  assert.throws(()=>discoverCaptionCues(source([[2,'Ford.'],[1,'Ford.']]),options),/Ordered/);
  const wrong=source([[0,'Ford.']]);wrong.timing_unit='milliseconds';
  assert.throws(()=>discoverCaptionCues(wrong,options),/Media-relative/);
  assert.throws(()=>discoverCaptionCues(source([]),options),/Nonempty/);
});

test('review groups stay bounded and cannot claim measured lots or continuous presence', () => {
  const r=discoverCaptionCues(source(Array.from({length:25},(_,i)=>[i*10,'Original engine.'])),options);
  assert.equal(r.review_windows.length,2);
  assert.ok(r.review_windows.every(w=>w.last_cue_seconds-w.start_seconds<=180));
  assert.ok(r.review_windows.every(w=>w.media_citation.span_semantics==='candidate_interval' && !w.actual_presentation_boundary_verified));
});

test('replay source keys are deterministic and full caption text never appears in exported grains', () => {
  const s=source([[0,'This spectacular engine has an unusual private marker qwertyuiop.']]);
  const a=discoverCaptionCues(s,options),b=discoverCaptionCues(s,options);
  assert.deepEqual(a,b);
  assert.equal(JSON.stringify(a).includes('qwertyuiop'),false);
});

test('audio language discovery preserves file clock until the seek is independently verified', () => {
  const a={source_sha256:'a'.repeat(64),source_file:'/test/clip.wav',source_duration_seconds:20,requested_offset_seconds:100,
    segments:[{start:3,end:8,text:'A stunning Corvette with an original engine.'}]};
  const s=source([[103,'A stunning Corvette with an original engine.']]);
  const acquisition_receipt={acquired:true,video_id:s.video_id,files:[{path:a.source_file,sha256:a.source_sha256}]};
  const r=discoverAudioAssay(a,s,{raw_source_ref:'/test/ASR-INTERNAL.json',acquisition_receipt});
  assert.ok(r.grains.every(g=>g.absolute_source_video_start_seconds===null));
  assert.equal(r.summary.alignment.verified_offset_seconds,null);
  assert.equal(r.summary.alignment.offset_candidate_seconds,100);
  assert.equal(r.summary.accepted_bids_verified,0);
  assert.equal(r.summary.speaker_roles_verified,0);
  assert.throws(()=>discoverAudioAssay(a,s,{acquisition_receipt:{...acquisition_receipt,video_id:'wrong000001'}}),/bind/);
});

test('next-car navigation without a make or year remains a lead, including previews', () => {
  const r=discoverCaptionCues(source([[0,'That will be the next car.'],[7,'We go to the next car.']]),options);
  const references=r.grains.filter(g=>g.structured_data.property==='vehicle_reference_cue');
  assert.equal(references.length,2);
  assert.equal(r.summary.yield.presentation_transition_candidates,2);
  assert.equal(r.summary.yield.distinct_reference_label_combinations,0);
  assert.ok(references.every(g=>g.structured_data.value.cue_labels.includes('relative_next_vehicle')));
  assert.ok(references.every(g=>g.structured_data.value.actual_presentation_start===null));
  assert.ok(references.every(g=>g.structured_data.value.navigation_scope==='next_or_future_reference_not_verified_auction_transition'));
});

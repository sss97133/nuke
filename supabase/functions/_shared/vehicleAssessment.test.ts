import { assertEquals, assert } from 'jsr:@std/assert@1';
import { qualifyAssessmentClaims, qualifyAssessmentCommentary, qualifyAssessmentMarket, qualifyListingAssertions } from './vehicleAssessment.ts';
const VEHICLE = '10000000-0000-4000-8000-000000000001';
const SOURCE = '20000000-0000-4000-8000-000000000001';
const COMMENT = '30000000-0000-4000-8000-000000000001';
const property = (key: string, value: unknown, patch: Record<string, unknown> = {}) => ({
  property_key: key, value, evidence_state: 'reported', mechanical_verification: 'unestablished',
  property_id: SOURCE, source_id: SOURCE, observation_id: crypto.randomUUID(), source_url: 'https://example.test/record',
  observed_at: '2026-01-01T00:00:00Z', ingested_at: '2026-01-02T00:00:00Z', extraction_method: 'retained_report', ...patch,
});
const profile = (claims: unknown[], patch = {}) => [{ vehicle_id: VEHICLE, schema_version: 'vehicle_data_model_v1',
  typed_claims_status: 'current_registered_scope_read', typed_claims: claims, unresolved_properties: [],
  claim_page: { reader: 'registered_profile_source_claims_v1', has_more: false, next_after: null }, ...patch }];
const query = { year: 1973, make: 'Pontiac', model: 'Firebird' };
const market = () => ({ query, stats: { sold_count: 10, median: 20004.5 }, receipt: {
  method: 'source_sale_price_midrank_v1', minimum_sales: 10, coverage: { complete: true }, cohort: { complete: true }, currency: 'USD',
  price_basis_rule: 'bat_published_result_fee_separate_v1', exclusions: { price_unknown: 3 },
  eligible: Array.from({ length: 10 }, (_, i) => ({ vehicleId: crypto.randomUUID(), sourceUrl: 'https://bringatrailer.com/listing/fixture-' + i + '/',
    amount: 20000 + i, currency: 'USD', outcome: 'sold', sourceSha256: 'a'.repeat(64), knownAt: '2026-01-01T00:00:00Z',
    eventAt: '2025-12-01', sourceVerification: 'per_read_inline_hash_parser', priceBasis: 'published_bid_excluding_fees' })),
} });

Deno.test('supported attributed identity can enter copy, while a reported engine remains unresolved', () => {
  const engine = property('engine_configuration', 'SD455');
  const result = qualifyListingAssertions(qualifyAssessmentClaims(profile([
    property('year', 1973), property('make', 'Pontiac'), property('model', 'Firebird'), engine,
  ]), VEHICLE));
  assertEquals(result.supported, query);
  assertEquals(result.assertions.length, 3);
  assert(!JSON.stringify(result.assertions).includes('SD455'));
  assertEquals(result.unresolved.find(r => r.field === 'engine_configuration')?.observation_ids, [engine.observation_id]);
  assert(result.assertions.every(r => r.observation_ids.length && r.sources[0].source_url));
});
Deno.test('receipt labels, invented verification, disputes and another vehicle cannot establish assertions', () => {
  const received = { label: 'engine_proof', status: 'received', value: 'SD455' };
  assertEquals(qualifyListingAssertions(qualifyAssessmentClaims(profile([received]), VEHICLE)).assertions, []);
  assertEquals(qualifyListingAssertions(qualifyAssessmentClaims(profile([property('year', 1973, { mechanical_verification: 'proven' })]), VEHICLE)).assertions, []);
  assertEquals(qualifyListingAssertions(qualifyAssessmentClaims(profile([property('year', 1973, { evidence_state: 'disputed' })]), VEHICLE)).assertions, []);
  assertEquals(qualifyListingAssertions(qualifyAssessmentClaims(profile([property('year', 1973)]), SOURCE)).assertions, []);
  assertEquals(qualifyListingAssertions(qualifyAssessmentClaims(profile([property('year', 1973)], {
    claim_page: { reader: 'registered_profile_source_claims_v1', has_more: true, next_after: SOURCE },
  }), VEHICLE)).assertions, []);
  assertEquals(qualifyListingAssertions(qualifyAssessmentClaims(profile([property('year', 1973),
    property('year', 1974, { evidence_state: 'disputed' })]), VEHICLE)).assertions, []);
});
Deno.test('qualified market retains the same population, source witnesses and exclusions without a subject appraisal', () => {
  const input = market(); const result = qualifyAssessmentMarket(input, query);
  assertEquals(result.status, 'available');
  if (result.status !== 'available') throw Error('missing market');
  assertEquals(result.records.length, 10); assertEquals(result.exclusions, { price_unknown: 3 });
  assertEquals(result.vehicle_specific_value, null); assertEquals(result.subject_configuration_membership, 'unestablished');
  assertEquals(qualifyAssessmentMarket(input, { ...query, model: 'GTO' }).status, 'unavailable');
  input.receipt.eligible[0].sourceSha256 = '';
  assertEquals(qualifyAssessmentMarket(input).status, 'unavailable');
  assertEquals(qualifyAssessmentMarket({ error: 'timeout' }).status, 'unavailable');
});
Deno.test('retained commentary reuses the existing parser and preserves a source question as a question', () => {
  const text = 'Is there any rust?'; const posted = '2026-01-01T00:00:00Z';
  const source = { id: COMMENT, vehicle_id: VEHICLE, comment_text: text, posted_at: posted, is_seller: false,
    source_url: 'https://bringatrailer.com/listing/fixture/' };
  const atom = { id: SOURCE, vehicle_id: VEHICLE, source_comment_id: COMMENT, source_url: source.source_url,
    observed_at: posted, ingested_at: '2026-01-02T00:00:00Z', is_superseded: false, extraction_method: 'comment_refinery_atom',
    structured_data: { analysis_kind: 'comment_atom', source_comment_id: COMMENT, prompt_version: 'public_comment_atoms_v1',
      claim_type: 'buyer_question', category: 'Q', statement_kind: 'question', subject_scope: 'vehicle', epistemic_status: 'unknown',
      action_status: 'unknown', qualification: 'candidate', proposed_value: text, model_confidence: 0.9,
      source_quote_actual: text, source_quote_start: 0, source_quote_end: text.length, source_quote_offset_unit: 'utf16_code_units',
      temporal_anchor: 'unknown', temporal_anchor_basis: 'unknown', field_name: null } };
  const result = qualifyAssessmentCommentary([atom], [source], VEHICLE);
  assertEquals(result.records.length, 1); assertEquals(result.records[0].statement_kind, 'question');
  assertEquals(result.records[0].mechanical_verification, 'unestablished');
  assertEquals(result.distributions[0].source_comments, 1);
  const changed = qualifyAssessmentCommentary([atom], [{ ...source, comment_text: 'There is no rust.' }], VEHICLE);
  assertEquals(changed.records.length, 0); assertEquals(changed.exclusions.length, 1);
  const forged = qualifyAssessmentCommentary([{ ...atom, structured_data: { ...atom.structured_data, statement_kind: 'assertion' } }], [source], VEHICLE);
  assertEquals(forged.records.length, 0);
});

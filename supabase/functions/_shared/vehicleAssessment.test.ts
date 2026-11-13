import { assertEquals, assert } from 'jsr:@std/assert@1';
import { qualifyAssessmentClaims, qualifyAssessmentCommentary, qualifyAssessmentMarket, qualifyListingAssertions, qualifyAssessmentAppearances, readVehicleAssessment } from './vehicleAssessment.ts';
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

const appearance = (patch: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(), vehicle_id: VEHICLE, source_id: '006f01c3-e5fb-44f5-ab40-e55b0654de1c',
  kind: 'listing', property_id: null, is_superseded: false, retained_native_listing_source: true,
  source_url: 'https://www.classic-carauction.com/auction-results?auctionnbr=58&auctionid=7309',
  observed_at: '2026-01-01T00:00:00Z', ingested_at: '2026-01-02T00:00:00Z', extraction_method: 'mccormick_html_v1',
  structured_data: { parser: 'mccormick_html_v1', presentation: 'archive', source_id: '7309', auction_number: '58',
    auction_dates_text: 'February 20 - 22, 2015', result_claim: { status: 'sold', amount: 4200,
      currency_symbol: '$', currency: null, fee_basis: 'unknown', literal: 'Sold for: $4,200' } }, ...patch,
});
Deno.test('archive report groups repeated captures and preserves unknown units without monetary promotion', () => {
  const first = appearance(), second = appearance();
  const result = qualifyAssessmentAppearances([first, second], VEHICLE);
  assertEquals(result.records.length, 1);
  assertEquals(result.records[0].witness_count, 2);
  assertEquals(result.records[0].reported_result.amount, 4200);
  assertEquals(result.records[0].reported_result.currency, null);
  assertEquals(result.records[0].monetary_comparable_eligible, false);
  assert('verified_sale_count' in result);
  assertEquals(result.verified_sale_count, null);
  assertEquals(result.price_statistics, null);
  assertEquals(result.records[0].witnesses.map((r: any) => r.observation_id), [first.id, second.id]);
});
Deno.test('no-sale bid is separate and conflicts preserve witnesses without selecting a realized result', () => {
  const sold = appearance(), noSale = appearance();
  noSale.structured_data.result_claim = { ...noSale.structured_data.result_claim, status: 'no_sale', literal: 'High Bid: $4,200' };
  const high = qualifyAssessmentAppearances([noSale], VEHICLE).records[0];
  assertEquals(high.reported_result.outcome, 'no_sale');
  assertEquals(high.monetary_comparable_eligible, false);
  const conflict = qualifyAssessmentAppearances([sold, noSale], VEHICLE).records[0];
  assertEquals(conflict.evidence_state, 'disputed');
  assertEquals(conflict.reported_result, null);
  assertEquals(conflict.witness_count, 2);
});
Deno.test('report refuses custody, parent, current, malformed amounts and unsupported monetary claims', () => {
  for (const patch of [{ retained_native_listing_source: false }, { vehicle_id: SOURCE }, { is_superseded: true },
    { source_url: 'https://example.test/' }, { property_id: SOURCE }, { kind: 'specification' },
    { ingested_at: '2099-01-01' }, { source_id: SOURCE }]) {
    const r = appearance(patch);
    const result = qualifyAssessmentAppearances([r], VEHICLE);
    assertEquals(result.records, []);
    assert(!JSON.stringify(result).includes(r.id));
  }
  for (const patch of [{ amount: 4201 }, { currency: 'USD' }, { fee_basis: 'hammer' }, { amount: -1 },
    { literal: 'Sold for: $4,200 and other details' }, { status: 'no_sale' }]) {
    const r = appearance();Object.assign(r.structured_data.result_claim, patch);
    assertEquals(qualifyAssessmentAppearances([r], VEHICLE).records, []);
  }
  const missing = appearance();missing.structured_data.auction_dates_text = '';
  assertEquals(qualifyAssessmentAppearances([missing], VEHICLE).records, []);
  assertEquals(qualifyAssessmentAppearances(null, VEHICLE).status, 'unavailable');
});
Deno.test('appearance pagination declares page-only groups and keeps a stable source-row cursor', () => {
  const input = Array.from({ length: 201 }, () => appearance());
  const result = qualifyAssessmentAppearances(input, VEHICLE);
  assert('page' in result);
  assertEquals(result.page?.has_more, true);
  assertEquals(result.page?.next_after, input[199].id);
  assertEquals(result.records[0].witness_count, 200);
  assertEquals(result.group_scope, 'returned_page_only');
  assertEquals(qualifyAssessmentAppearances([...input, appearance()], VEHICLE).status, 'unavailable');
});

Deno.test('shared assessment queries custody-qualified roots and returns history beside unchanged monetary context', async () => {
  const filters: unknown[][] = [], root = appearance();
  const db = {
    rpc: async (name: string) => ({ data: name === 'get_vehicle_specs' ? profile([]) : market(), error: null }),
    from: (table: string) => {
      assertEquals(table, 'vehicle_observations');
      let kind = '';
      const request: any = { select: () => request,
        eq: (key: string, value: unknown) => { filters.push([key, value]);if (key === 'kind') kind = String(value);return request; },
        is: (key: string, value: unknown) => { filters.push([key, value]);return request; },
        not: () => request, gt: (key: string, value: string) => { filters.push(['after', key, value]);return request; },
        order: () => request, limit: () => request,
        abortSignal: async () => ({ data: kind === 'listing' ? [root] : [], error: null }) };
      return request;
    },
  };
  const result = await readVehicleAssessment(db, { id: VEHICLE, ...query }, { photos: [], appearanceAfter: SOURCE });
  assertEquals(result.retained_auction_appearances.records.length, 1);
  assertEquals(result.market.status, 'available');
  assert('statistics' in result.market);
  assertEquals(result.market.statistics.sold_count, 10);
  assertEquals(result.market.vehicle_specific_value, null);
  assert(filters.some(f => f[0] === 'retained_native_listing_source' && f[1] === true));
  assert(filters.some(f => f[0] === 'after' && f[1] === 'id' && f[2] === SOURCE));
});

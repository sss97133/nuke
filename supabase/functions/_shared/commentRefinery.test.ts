import {
  buildClaimExtractionPrompt, computeClaimConfidence, MAX_ATOMS_PER_COMMENT, parseClaimResponse, runCorroboration,
  type CommentRow,
} from './commentRefinery.ts';

function assert(value: unknown, message = 'assertion failed'): asserts value {
  if (!value) throw new Error(message);
}
function equal(actual: unknown, expected: unknown) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
const source = (id = 'source-1', text = 'The engine runs well.'): CommentRow => ({
  id, comment_text: text, author_username: 'synthetic-author', is_seller: false,
  posted_at: '2026-01-02T03:04:05Z', bid_amount: null,
});
const claim = (patch: Record<string, unknown> = {}) => ({
  claim_type: 'mechanical_condition', category: 'B', field_name: 'mechanical_condition',
  proposed_value: 'runs well', confidence: 0.9, temporal_anchor: 'current',
  reasoning: 'The source asserts this condition.', quote: 'The engine runs well.',
  contradicts_existing: false, ...patch,
});
const response = (claims: unknown[] = [claim()], index: unknown = 1) => JSON.stringify([{ comment_index: index, claims }]);

Deno.test('exact source quote, offsets, source posting time and separate score survive parsing', () => {
  const comment = source('source-1', 'Preface. The engine\n  runs well. End.');
  const result = parseClaimResponse(response(), [comment]);
  equal(result.processedCommentIds, ['source-1']);
  equal(result.parseErrors, []);
  const parsed = result.claims[0];
  equal(parsed.quote, 'The engine\n  runs well.');
  equal(parsed.source_quote_actual, parsed.quote);
  equal(comment.comment_text.slice(parsed.source_quote_start, parsed.source_quote_end), parsed.quote);
  equal(parsed.temporal_anchor, comment.posted_at);
  equal(parsed.temporal_anchor_basis, 'comment_posted_at');
  equal(parsed.confidence, 0.6);
  equal(parsed.model_confidence, 0.9);
  equal(parsed.comment_index, 0);
});

Deno.test('seller status does not boost identical claim confidence', () => {
  const a = source();
  const b = { ...a, is_seller: true };
  equal(parseClaimResponse(response([claim({ confidence: 0.2 })]), [a]).claims,
    parseClaimResponse(response([claim({ confidence: 0.2 })]), [b]).claims);
});

Deno.test('zero confidence is retained rather than defaulted to a positive score', () => {
  const parsed = parseClaimResponse(response([claim({ confidence: 0 })]), [source()]);
  equal(parsed.claims[0].confidence, 0);
  equal(parsed.claims[0].model_confidence, 0);
});

Deno.test('planned service cannot be admitted as completed work even with an exact quote', () => {
  const comment = { ...source('plan', 'We scheduled the service; it goes in on October 7.'), is_seller: true };
  const atom = claim({ claim_type: 'work_performed', category: 'C',
    proposed_value: 'Airbag repair completed', quote: comment.comment_text, confidence: 0.5 });
  for (const patch of [{}, { action_status: 'completed' }, { action_status: 'unknown' }, { action_status: 'planned' }]) {
    const parsed = parseClaimResponse(response([{ ...atom, ...patch }]), [comment]);
    equal(parsed.claims, []); equal(parsed.processedCommentIds, []);
    assert(parsed.commentErrors.plan.length > 0);
  }
});

Deno.test('seller appointment remains a planned response with the actual source clock', () => {
  const comment = { ...source('plan', 'We scheduled the service on Monday, but it goes in at 7am Oct 7th. Something to do with an airbag sensor.'), is_seller: true };
  const atom = claim({ claim_type: 'seller_response', category: 'C', quote: comment.comment_text,
    proposed_value: 'Seller reports a service appointment for Oct 7 concerning an airbag sensor.',
    action_status: 'planned', epistemic_status: 'uncertain' });
  const parsed = parseClaimResponse(response([atom]), [comment]);
  equal(parsed.processedCommentIds, ['plan']);
  equal(parsed.claims[0].action_status, 'planned');
  equal(parsed.claims[0].subject_scope, 'comment');
  equal(parsed.claims[0].temporal_anchor, comment.posted_at);
  equal(parsed.claims[0].source_quote_actual, comment.comment_text);
});

Deno.test('future wording cannot be omitted from the quote to fabricate completed work', () => {
  for (const text of ['The airbag sensor will be replaced.', 'We have an appointment for the airbag sensor.',
    'We are going to replace the airbag sensor.', 'We plan to replace the airbag sensor.']) {
    const comment = { ...source('plan', text), is_seller: true };
    for (const patch of [
      { claim_type: 'work_performed', category: 'C', action_status: 'unknown' },
      { claim_type: 'seller_response', category: 'C', action_status: 'completed' },
      { claim_type: 'seller_response', category: 'C', action_status: 'unknown' },
    ]) {
      const parsed = parseClaimResponse(response([claim({ ...patch, quote: 'airbag sensor',
        proposed_value: 'The airbag sensor was replaced.' })]), [comment]);
      equal(parsed.processedCommentIds, []);
      equal(parsed.commentErrors.plan, ['planned_source_cannot_establish_completion']);
    }
  }
});

Deno.test('action qualification defaults to unknown and rejects malformed values', () => {
  equal(parseClaimResponse(response(), [source()]).claims[0].action_status, 'unknown');
  for (const action_status of [null, true, 1, {}, 'done', 'COMPLETED']) {
    const result = parseClaimResponse(response([claim({ action_status })]), [source()]);
    equal(result.processedCommentIds, []);
    equal(result.commentErrors['source-1'], ['invalid_action_status']);
  }
  equal(parseClaimResponse(response([claim({ action_status: 'not_applicable' })]), [source()]).claims[0].action_status, 'not_applicable');
});

Deno.test('explicit past work retains completed qualification without a future plan', () => {
  const comment = source('work', 'The tires were replaced on 2025-01-02.');
  const parsed = parseClaimResponse(response([claim({ claim_type: 'work_performed', category: 'C',
    proposed_value: 'The tires were replaced.', quote: comment.comment_text,
    action_status: 'completed', temporal_anchor: '2025-01-02' })]), [comment]);
  equal(parsed.processedCommentIds, ['work']);
  equal(parsed.claims[0].action_status, 'completed');
});

Deno.test('questions about completed appointments do not assert completion', () => {
  const comment = source('question', 'You scheduled an appointment. Was the repair completed?');
  const atom = claim({ claim_type: 'buyer_question', category: 'Q', quote: comment.comment_text,
    proposed_value: 'Was the repair completed?', action_status: 'unknown' });
  equal(parseClaimResponse(response([atom]), [comment]).processedCommentIds, ['question']);
  equal(parseClaimResponse(response([{ ...atom, action_status: 'completed' }]), [comment]).processedCommentIds, []);
});

Deno.test('empty whole response processes nobody; explicit empty comment processes only that comment', () => {
  const comments = [source('a'), source('b')];
  const empty = parseClaimResponse('[]', comments);
  equal(empty.processedCommentIds, []);
  equal(Object.keys(empty.commentErrors), ['a', 'b']);
  const explicit = parseClaimResponse(response([]), comments);
  equal(explicit.processedCommentIds, ['a']);
  equal(explicit.commentErrors.b, ['missing_comment_entry']);
});

Deno.test('duplicate indices reject the entire affected comment and preserve unrelated complete entries', () => {
  const result = parseClaimResponse(JSON.stringify([
    { comment_index: 1, claims: [claim()] }, { comment_index: 1, claims: [] },
    { comment_index: 2, claims: [] },
  ]), [source('a'), source('b')]);
  equal(result.claims, []);
  equal(result.processedCommentIds, ['b']);
  equal(result.commentErrors.a, ['duplicate_comment_index']);
});

Deno.test('noninteger and coerced comment indices never select a source row', () => {
  for (const index of ['1', 1.5, 0, -1, 2, true, null, {}, []]) {
    const result = parseClaimResponse(response([claim()], index), [source()]);
    equal(result.processedCommentIds, []);
    equal(result.claims, []);
    assert(result.parseErrors.includes('invalid_comment_index'));
  }
});

Deno.test('a malformed claim rejects all claims from that comment without losing other comments', () => {
  const result = parseClaimResponse(JSON.stringify([
    { comment_index: 1, claims: [claim(), claim({ quote: 'invented confidential text' })] },
    { comment_index: 2, claims: [claim()] },
  ]), [source('a'), source('b')]);
  equal(result.processedCommentIds, ['b']);
  equal(result.claims.map(c => c.comment_id), ['b']);
  assert(!JSON.stringify(result.parseErrors).includes('confidential'));
});

Deno.test('malformed response and claim shapes produce sanitized per-comment errors', () => {
  for (const text of ['private invalid JSON', '[{"comment_index":1,"claims":', '{}', 'null', '[null]', '[1]',
    JSON.stringify([{ comment_index: 1 }]), JSON.stringify([{ comment_index: 1, claims: {} }]),
    response([null]), response([[]]), response([42])]) {
    const result = parseClaimResponse(text, [source()]);
    equal(result.processedCommentIds, []);
    equal(result.claims, []);
    assert(result.commentErrors['source-1'].length > 0);
    assert(!JSON.stringify(result.parseErrors).includes('private invalid JSON'));
  }
});

Deno.test('one complete JSON fence is accepted; arbitrary surrounding prose is not', () => {
  equal(parseClaimResponse('```json\n' + response() + '\n```', [source()]).processedCommentIds, ['source-1']);
  equal(parseClaimResponse('extra prose ' + response(), [source()]).processedCommentIds, []);
});

Deno.test('quotes preserve case and punctuation and escape regex metacharacters', () => {
  const comment = source('a', 'The US version has [A+B] (original).');
  const input = claim({ quote: '[A+B] (original).', temporal_anchor: null });
  equal(parseClaimResponse(response([input]), [comment]).claims[0].quote, input.quote);
  for (const quote of ['the US version', 'The us version', 'A+B original', ' ']) {
    equal(parseClaimResponse(response([claim({ quote })]), [comment]).processedCommentIds, []);
  }
});

Deno.test('invalid scores, categories, fields, kinds and boolean flags fail admission', () => {
  for (const patch of [
    { confidence: '0.8' }, { confidence: null }, { confidence: -0.1 }, { confidence: 1.1 },
    { category: 'A' }, { claim_type: 'imagined_fact' }, { claim_type: '__proto__' },
    { field_name: {} }, { field_name: 'engine.type' }, { proposed_value: false },
    { contradicts_existing: 'false' }, { reasoning: [] }, { observation_kind: 'work_record' },
  ]) equal(parseClaimResponse(response([claim(patch)]), [source()]).processedCommentIds, []);
});

Deno.test('current requires a real source posting clock, never today', () => {
  for (const posted_at of ['', '2026', '2026-02-30T00:00:00Z', 'invalid']) {
    const result = parseClaimResponse(response(), [{ ...source(), posted_at }]);
    equal(result.processedCommentIds, []);
    equal(result.commentErrors['source-1'], ['missing_source_posting_clock']);
  }
});

Deno.test('partial dates stay unknown; fabricated days and impossible sourced dates fail', () => {
  const comment = source('a', 'It was rebuilt in 2019.');
  equal(parseClaimResponse(response([claim({ quote: comment.comment_text, temporal_anchor: null })]), [comment]).claims[0].temporal_anchor, null);
  for (const temporal_anchor of ['2019', '2019-01-01', 'null']) {
    equal(parseClaimResponse(response([claim({ quote: comment.comment_text, temporal_anchor })]), [comment]).processedCommentIds, []);
  }
  const impossible = source('a', 'The repair date says 2025-02-29.');
  equal(parseClaimResponse(response([claim({ quote: impossible.comment_text, temporal_anchor: '2025-02-29' })]), [impossible]).processedCommentIds, []);
});

Deno.test('explicit date must be both valid and inside the supporting quote', () => {
  const comment = source('a', 'Repaired on 2024-02-29. The engine runs well.');
  const valid = parseClaimResponse(response([claim({ quote: 'Repaired on 2024-02-29.', temporal_anchor: '2024-02-29' })]), [comment]);
  equal(valid.claims[0].temporal_anchor, '2024-02-29');
  equal(valid.claims[0].temporal_anchor_basis, 'source_explicit_date');
  equal(parseClaimResponse(response([claim({ temporal_anchor: '2024-02-29' })]), [comment]).processedCommentIds, []);
});

Deno.test('known specification, condition, provenance and model claims have deterministic categories', () => {
  for (const [claim_type, category, observation_kind] of [
    ['engine_identity', 'A', null], ['body_condition', 'B', null],
    ['sighting', 'C', 'sighting'], ['ownership_claim', 'C', 'ownership'],
    ['previous_sale', 'C', 'provenance'], ['work_performed', 'C', 'work_record'], ['general_spec', 'E', null],
  ]) {
    const result = parseClaimResponse(response([claim({ claim_type, category, observation_kind })]), [source()]);
    equal(result.processedCommentIds, ['source-1']);
    equal(result.claims[0].category, category);
  }
});

Deno.test('author trust and future dates never raise the model qualification score', () => {
  for (const author of [null, 0, 0.8, 1]) {
    equal(computeClaimConfidence(0.4, author, 'rust_condition', null), 0.4);
    equal(computeClaimConfidence(0.95, author, 'rust_condition', new Date('2099-01-01')), 0.6);
  }
  equal(computeClaimConfidence(NaN, null, '', null), 0);
  equal(computeClaimConfidence(0.4, null, 'rust_condition', new Date('invalid')), 0.4);
});

Deno.test('matching evidence rows neither become independent votes nor automatically accept a claim', async () => {
  const evidence = [
    { field_name: 'engine', proposed_value: '3.2', source_type: 'listing', source_confidence: 90 },
    { field_name: 'engine', proposed_value: '3.2', source_type: 'nhtsa_vin_decode', source_confidence: 90 },
  ];
  const query = { select: () => query, eq: () => query, in: async () => ({ data: evidence }) };
  const sb = { from: () => query };
  const [result] = await runCorroboration(sb, 'vehicle', [{ field_name: 'engine', proposed_value: '3.2', confidence: 0.6 }]);
  equal(result.corroborating_count, 2);
  equal(result.boost, 0);
  equal(result.final_confidence, 0.6);
  equal(result.status, 'pending');
  const [different] = await runCorroboration(sb, 'vehicle', [{ field_name: 'engine', proposed_value: '32', confidence: 0.6 }]);
  equal(different.corroborating_count, 0);
  equal(different.status, 'conflicted');
});

Deno.test('prompt requires complete per-comment coverage and never invents dates or seller trust', () => {
  const prompt = buildClaimExtractionPrompt({ vehicle_id: 'v', year: null, make: null, model: null, vin: null, sale_price: null }, [source()], ['engine']);
  assert(prompt.includes('EVERY input comment'));
  assert(prompt.includes('never automatically increases'));
  assert(!prompt.includes('0-5'));
  assert(!prompt.includes('2020-01-01'));
});

Deno.test('buyer questions remain questions with unknown answer, never defect assertions', () => {
  const comment = source('question', 'Does the air conditioning work?');
  const atom = claim({ claim_type: 'buyer_question', category: 'Q', field_name: null,
    quote: comment.comment_text, proposed_value: comment.comment_text });
  const parsed = parseClaimResponse(response([atom]), [comment]).claims[0];
  equal(parsed.statement_kind, 'question');
  equal(parsed.subject_scope, 'vehicle');
  equal(parsed.epistemic_status, 'unknown');
  equal(parsed.qualification, 'candidate');
  equal(parsed.observation_kind, 'comment');
  for (const patch of [{ epistemic_status: 'asserted' }, { statement_kind: 'assertion' },
    { contradicts_existing: true }, { qualification: 'verified' }]) {
    equal(parseClaimResponse(response([{ ...atom, ...patch }]), [comment]).processedCommentIds, []);
  }
});

Deno.test('general-model statements cannot silently become particular-vehicle facts', () => {
  const comment = source('model', 'These models came with a manual gearbox.');
  const atom = claim({ claim_type: 'general_spec', category: 'E', quote: comment.comment_text,
    proposed_value: 'The model had a manual gearbox.', temporal_anchor: null });
  const parsed = parseClaimResponse(response([atom]), [comment]).claims[0];
  equal(parsed.subject_scope, 'model');
  equal(parsed.statement_kind, 'assertion');
  equal(parsed.qualification, 'candidate');
  equal(parseClaimResponse(response([{ ...atom, subject_scope: 'vehicle' }]), [comment]).processedCommentIds, []);
});

Deno.test('seller unknowns, refusals and uncertainty remain testimony about the response', () => {
  const comment = { ...source('seller', 'I do not know whether it was repaired.'), is_seller: true };
  for (const epistemic_status of ['asserted', 'unknown', 'uncertain', 'refused']) {
    const atom = claim({ claim_type: 'seller_response', category: 'C', quote: comment.comment_text,
      proposed_value: comment.comment_text, epistemic_status });
    const parsed = parseClaimResponse(response([atom]), [comment]).claims[0];
    equal(parsed.subject_scope, 'comment');
    equal(parsed.epistemic_status, epistemic_status);
    equal(parsed.qualification, 'candidate');
    equal(parsed.observation_kind, 'comment');
    equal(parseClaimResponse(response([atom]), [{ ...comment, is_seller: false }]).processedCommentIds, []);
    equal(parseClaimResponse(response([{ ...atom, subject_scope: 'vehicle' }]), [comment]).processedCommentIds, []);
  }
});

Deno.test('hard atom budget rejects the entire comment without truncating or claiming empty success', () => {
  const withinBudget = Array.from({ length: MAX_ATOMS_PER_COMMENT }, () => claim());
  const accepted = parseClaimResponse(response(withinBudget), [source()]);
  equal(accepted.processedCommentIds, ['source-1']);
  equal(accepted.claims.length, MAX_ATOMS_PER_COMMENT);
  const overBudget = parseClaimResponse(response([...withinBudget, claim()]), [source()]);
  equal(overBudget.processedCommentIds, []);
  equal(overBudget.claims, []);
  equal(overBudget.commentErrors['source-1'], ['atom_budget_exceeded']);
  const declared = parseClaimResponse(JSON.stringify([{ comment_index: 1, error: 'atom_budget_exceeded', claims: [] }]), [source()]);
  equal(declared.processedCommentIds, []);
  equal(declared.commentErrors['source-1'], ['atom_budget_exceeded']);
});

Deno.test('model refusals or unknown error contents never leak into diagnostics or count as complete', () => {
  const parsed = parseClaimResponse(JSON.stringify([{ comment_index: 1, error: 'private source text', claims: [] }]), [source()]);
  equal(parsed.processedCommentIds, []);
  equal(parsed.commentErrors['source-1'], ['model_deferred_comment']);
  assert(!JSON.stringify(parsed.parseErrors).includes('private source text'));
});

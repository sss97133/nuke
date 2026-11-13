import test from 'node:test';
import assert from 'node:assert/strict';
import { judgmentFor, staleJudgments, retireKind, discoverVehicles, main, DEPARTMENT, QUESTION } from './reconcile-receipt-work.mjs';
import { fromReceiptWorkLine, fromReceiptWorkWithdrawal } from '../garage/derivation-evidence.mjs';

const row = { vehicle_id: '20d21fb0-4651-4469-a0ba-e751309a1e54', user_id: '0b9f107a-d124-49de-9ded-94698f63c1c4', receipt_id: '11111111-1111-1111-1111-111111111111',
  item_id: '22222222-2222-2222-2222-222222222222', link_id: '33333333-3333-3333-3333-333333333333', description: '70-76 SHAKER HOOD', part_number: '15136',
  total_price: 652.99, line_kind: 'part', zone: 'exterior', end_hint: 'front', anchor_date: '2024-09-12', anchor_source: 'page_date',
  conclusion: 'photographed_after_window', confidence: 0.36, image_ids: ['44444444-4444-4444-4444-444444444444'], judgment_needed: true, logic_version: 'receipt_work_lines/20261111210000',
  question_context: { receipt_id: '11111111-1111-1111-1111-111111111111', item_id: '22222222-2222-2222-2222-222222222222', link_id: '33333333-3333-3333-3333-333333333333',
    link_basis: 'cited_document', receipt_date: '2024-09-12', anchor_date: '2024-09-12', source_document_id: null, candidate_image_ids: ['44444444-4444-4444-4444-444444444444'] } };
const RUN = '55555555-5555-5555-5555-555555555555';

test('evidence row is signed and subject-keyed by the line', () => {
  const ev = fromReceiptWorkLine(row, { runId: RUN }, { version: 'abc:scripts/receipt-work/reconcile-receipt-work.mjs' });
  assert.equal(ev.kind, 'receipt_work_correlation');
  assert.equal(ev.subject_key, 'receipt_item:22222222-2222-2222-2222-222222222222');
  assert.equal(ev.producer_version, 'abc:scripts/receipt-work/reconcile-receipt-work.mjs');
  assert.deepEqual(ev.image_ids, row.image_ids);
});

test('trigger raises one parameterized judgment, idempotent across runs', () => {
  const ev = fromReceiptWorkLine(row, { runId: RUN }, { version: 'v' });
  const a = judgmentFor(row, ev, { runId: RUN, version: 'v' });
  const b = judgmentFor(row, ev, { runId: '66666666-6666-6666-6666-666666666666', version: 'v2' });
  assert.equal(a.department, DEPARTMENT); assert.equal(a.question_kind, QUESTION);
  assert.deepEqual(a.params.candidate_image_ids, row.image_ids);
  assert.equal(a.priority, 653);
  assert.equal(a.dedupe_key, b.dedupe_key);
});

test('no judgment without a need, a line, or a frame', () => {
  const ev = fromReceiptWorkLine(row, { runId: RUN }, { version: 'v' });
  assert.equal(judgmentFor({ ...row, judgment_needed: false }, ev, { runId: RUN, version: 'v' }), null);
  assert.equal(judgmentFor({ ...row, item_id: null }, ev, { runId: RUN, version: 'v' }), null);
  assert.equal(judgmentFor({ ...row, image_ids: [] }, ev, { runId: RUN, version: 'v' }), null);
});

test('a pending request this run did not raise again is stale', () => {
  const open = [{ id: 'a', dedupe_key: 'k-old' }, { id: 'b', dedupe_key: 'k-kept' }];
  assert.deepEqual(staleJudgments(open, new Set(['k-kept', 'k-new'])).map((j) => j.id), ['a']);
  assert.deepEqual(staleJudgments([], new Set()), []);
});

test('evidence and judgment carry proposed-context semantics and source lineage', () => {
  const r2 = { ...row, relationship_status: 'proposed', source_document_table: 'vehicle_documents', source_document_id: '44444444-4444-4444-4444-444444444444',
    source_page: null, custodian_user_id: row.user_id, reader_ineligible: { line_date: 'after_today' } };
  const ev = fromReceiptWorkLine(r2, { runId: '55555555-5555-5555-5555-555555555555' }, { version: 'test' });
  assert.equal(ev.evidence.relationship.status, 'proposed');
  assert.deepEqual(ev.evidence.relationship.not_asserted, ['independent_corroboration', 'installation_proof', 'payment_proof', 'owner_sign']);
  assert.equal(ev.evidence.lineage.source_document_id, '44444444-4444-4444-4444-444444444444');
  assert.equal(ev.evidence.lineage.page, null);
  assert.deepEqual(ev.evidence.lineage.image_ids, r2.image_ids);
  assert.deepEqual(ev.evidence.reader_ineligible, { line_date: 'after_today' });
  assert.equal(ev.evidence.source_custody.custodian_user_id, row.user_id);
  const jr = judgmentFor(r2, ev, { runId: 'x', version: 'test' });
  assert.ok(jr);
  assert.equal(jr.params.relationship.status, 'proposed'); assert.deepEqual(jr.params.lineage, ev.evidence.lineage);
});

// ---- Codex counterexample 1 / P1b: question identity is its content -------------------------------------------------------
test('changed description, part number, date or lineage with the same ids is a different question', () => {
  const key = (r) => { const ev = fromReceiptWorkLine(r, { runId: RUN }, { version: 'v' }); return judgmentFor(r, ev, { runId: RUN, version: 'v' }); };
  const base = key(row);
  for (const change of [{ description: '70-76 SHAKER HOOD (RAM AIR)' }, { part_number: '15137' }, { anchor_date: '2024-09-13' },
    { source_document_id: '77777777-7777-7777-7777-777777777777' }, { line_number: 4 }, { printed_line_date: '2024-09-01' }]) {
    const j = key({ ...row, ...change });
    assert.notEqual(j.dedupe_key, base.dedupe_key, JSON.stringify(change));
    assert.notEqual(j.question_hash, base.question_hash, JSON.stringify(change));
  }
  assert.equal(key({ ...row }).dedupe_key, base.dedupe_key, 'identical content keeps its identity (so a cancelled question can revive)');
});

// ---- Codex counterexample 2 / P2: printed claims are stored and hashed ---------------------------------------------------
test('printed hours and performer are stored as attributed claims and change the evidence hash', () => {
  const ev = (r) => fromReceiptWorkLine(r, { runId: RUN }, { version: 'v' });
  const a = ev({ ...row, printed_hours: 1.5, printed_performer: 'Dave' });
  assert.deepEqual(a.evidence.printed_claims, { attributed_to: 'document', source_table: 'receipt_items', source_id: row.item_id,
    line_date: null, hours: 1.5, performer: 'Dave' });
  assert.notEqual(ev({ ...row, printed_hours: 2, printed_performer: 'Dave' }).content_hash, a.content_hash, 'hours-only correction');
  assert.notEqual(ev({ ...row, printed_hours: 1.5, printed_performer: 'Rick' }).content_hash, a.content_hash, 'performer-only correction');
  assert.equal(ev({ ...row, printed_hours: 0 }).evidence.printed_claims.hours, 0, 'zero hours kept');
  assert.equal(ev({ ...row, printed_hours: -2 }).evidence.printed_claims.hours, -2, 'credit hours kept');
  assert.equal(ev({ ...row, printed_line_date: '1899-05-01' }).evidence.printed_claims.line_date, '1899-05-01', 'historical date kept');
});

test('retire kinds: withdrawn source wins, then withdrawn frame, then replaced content', () => {
  assert.equal(retireKind(['link_retired', 'frame_ineligible:x'], 'id').kind, 'source_withdrawn');
  assert.equal(retireKind(['frame_ineligible:x'], 'id').kind, 'frame_withdrawn');
  assert.equal(retireKind(['line_changed'], 'id').kind, 'content_changed');
  assert.equal(retireKind([], null).kind, 'not_asked');
});

test('claimed and answered questions not asked again are stale, retired ones are not', () => {
  const live = [{ id: 'p', dedupe_key: 'a', status: 'pending' }, { id: 'c', dedupe_key: 'b', status: 'claimed' },
    { id: 'n', dedupe_key: 'c', status: 'answered' }, { id: 'x', dedupe_key: 'd', status: 'cancelled' }, { id: 'k', dedupe_key: 'e', status: 'answered' }];
  assert.deepEqual(staleJudgments(live, new Map([['e', {}]])).map((j) => j.id), ['p', 'c', 'n']);
});

test('withdrawal retraction cites nothing and names its reason', () => {
  const w = { evidence_id: '88888888-8888-8888-8888-888888888888', subject_key: `receipt_item:${row.item_id}`, receipt_id: row.receipt_id, item_id: row.item_id,
    link_id: row.link_id, user_id: row.user_id, reason: 'link_retired' };
  const r = fromReceiptWorkWithdrawal(w, { runId: RUN, vehicleId: row.vehicle_id, userId: row.user_id }, { version: 'v' });
  assert.equal(r.conclusion, 'source_withdrawn'); assert.equal(r.subject_key, w.subject_key); assert.deepEqual(r.image_ids, []);
  assert.equal(r.evidence.withdrawn.reason, 'link_retired'); assert.equal(r.evidence.withdrawn.prior_evidence_id, w.evidence_id);
});

// ---- an in-memory database for the producer (no network) ------------------------------------------------------------------
function fakeDb(state) {
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url); const path = u.pathname.replace('/rest/v1/', ''); const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : null; calls.push({ method, path, search: u.search, body });
    const ok = (v) => ({ ok: true, status: 200, text: async () => (v === undefined ? '' : JSON.stringify(v)) });
    const q = (k) => u.searchParams.get(k);
    if (path === 'receipt_vehicle_links') return ok(state.links);
    if (path === 'rpc/receipt_work_lines') return ok(state.lines[body.p_vehicle_id] ?? []);
    if (path === 'rpc/receipt_work_withdrawals') return ok(state.withdrawals[body.p_vehicle_id] ?? []);
    if (path === 'rpc/raise_evidence_judgment') { state.raised.push(body.p_row); return ok([{ id: `new-${state.raised.length}`, action: 'inserted', status: 'pending' }]); }
    if (path === 'rpc/evidence_judgment_ineligibility') return ok(state.problems[body.p_id] ?? []);
    if (path === 'rpc/retire_evidence_judgment') { state.retired.push(body); return ok(state.judgments.find((j) => j.id === body.p_id)?.status === 'answered' ? 'withdrawn' : 'cancelled'); }
    if (path === 'garage_derivation_evidence' && method === 'GET') {
      const rows = state.evidence.filter((e) => !e.superseded_at && (!q('vehicle_id') || q('vehicle_id') === `eq.${e.vehicle_id}`));
      return ok(rows);
    }
    if (path === 'garage_derivation_evidence' && method === 'POST') { const row = { ...body[0], id: `ev-${state.evidence.length + 1}` }; state.evidence.push(row); return ok([{ id: row.id }]); }
    if (path === 'garage_derivation_evidence' && method === 'PATCH') {
      const id = q('id').slice(3); const e = state.evidence.find((x) => x.id === id); Object.assign(e, body); return ok();
    }
    if (path === 'evidence_judgment_requests') return ok(q('vehicle_id') ? state.judgments.filter((j) => q('vehicle_id') === `eq.${j.vehicle_id}`) : state.judgments);
    throw new Error(`unexpected ${method} ${path}`);
  };
  return { fetchFn, calls };
}
const V1 = row.vehicle_id; const V2 = '99999999-9999-9999-9999-999999999999';
async function runWith(state, args = []) {
  const { fetchFn, calls } = fakeDb(state); const saved = globalThis.fetch; globalThis.fetch = fetchFn;
  try { return { summary: await main(['--user-id', row.user_id, '--run-id', RUN, ...args], { SUPABASE_SECRET_KEY: 'test-key' }), calls }; }
  finally { globalThis.fetch = saved; }
}

// ---- Codex counterexample 4: the last link retired still reaches the vehicle --------------------------------------------------
test('discovery includes vehicles with only active evidence or live questions left', async () => {
  const state = { links: [{ vehicle_id: V1 }], evidence: [{ id: 'e0', vehicle_id: V2, subject_key: 'receipt:x' }],
    judgments: [{ id: 'j0', vehicle_id: '12121212-1212-1212-1212-121212121212', status: 'answered' }] };
  const { fetchFn } = fakeDb(state); const db = { req: async (p) => JSON.parse(await (await fetchFn(`https://x.supabase.co/rest/v1/${p}`)).text()) };
  assert.deepEqual((await discoverVehicles(db, row.user_id)).sort(), [V1, V2, '12121212-1212-1212-1212-121212121212'].sort());
});

// ---- Codex counterexample 3: an empty current result retracts the prior active evidence; claimed/answered are retired ---------
test('a vehicle whose last link retired gets signed retractions and its live questions retired', async () => {
  const prior = { id: 'e1', vehicle_id: V2, subject_key: `receipt_item:${row.item_id}`, content_hash: 'h', kind: 'receipt_work_correlation' };
  const state = { links: [], lines: {}, raised: [], retired: [], problems: { jc: ['link_retired'], ja: ['link_retired'] },
    withdrawals: { [V2]: [{ evidence_id: 'e1', subject_key: prior.subject_key, receipt_id: row.receipt_id, item_id: row.item_id, link_id: row.link_id,
      user_id: row.user_id, reason: 'link_retired' }] },
    evidence: [prior],
    judgments: [{ id: 'jc', vehicle_id: V2, subject_id: row.item_id, dedupe_key: 'old-c', status: 'claimed' },
      { id: 'ja', vehicle_id: V2, subject_id: row.item_id, dedupe_key: 'old-a', status: 'answered' }] };
  const { summary } = await runWith(state);
  assert.deepEqual(summary.errors, []);
  assert.ok(summary.vehicles[V2], 'the vehicle is visited');
  const retraction = state.evidence.find((e) => e.conclusion === 'source_withdrawn');
  assert.ok(retraction, 'a retraction is written');
  assert.equal(prior.superseded_by, retraction.id, 'the prior conclusion is superseded by the retraction');
  assert.equal(summary.retracted, 1);
  assert.deepEqual(state.retired.map((r) => [r.p_id, r.p_kind]).sort(), [['ja', 'source_withdrawn'], ['jc', 'source_withdrawn']]);
  assert.deepEqual(summary.judgments_retired, { 'source_withdrawn:cancelled': 1, 'source_withdrawn:withdrawn': 1 });
});

test('a corrected line raises a new question and retires the old one as content_changed, superseded by the new', async () => {
  const corrected = { ...row, description: '70-76 SHAKER HOOD (RAM AIR)', relationship_status: 'proposed' };
  const state = { links: [{ vehicle_id: V1 }], lines: { [V1]: [corrected] }, withdrawals: {}, raised: [], retired: [], problems: { jo: ['line_changed'] },
    evidence: [], judgments: [{ id: 'jo', vehicle_id: V1, subject_id: row.item_id, dedupe_key: 'old', status: 'answered' }] };
  const { summary } = await runWith(state);
  assert.deepEqual(summary.errors, []);
  assert.equal(state.raised.length, 1); assert.equal(state.raised[0].params.description, '70-76 SHAKER HOOD (RAM AIR)');
  assert.equal(state.retired.length, 1);
  assert.equal(state.retired[0].p_kind, 'content_changed'); assert.equal(state.retired[0].p_superseded_by, 'new-1');
  assert.deepEqual(summary.judgments_retired, { 'content_changed:withdrawn': 1 }, 'an answered question about old content is withdrawn, not inherited');
});

test('--no-db reads but writes nothing', async () => {
  const state = { links: [{ vehicle_id: V1 }], lines: { [V1]: [row] }, withdrawals: { [V1]: [] }, raised: [], retired: [], problems: {}, evidence: [], judgments: [] };
  const { calls } = await runWith(state, ['--no-db']);
  assert.ok(calls.every((c) => c.method === 'GET' || c.path === 'rpc/receipt_work_lines' || c.path === 'rpc/receipt_work_withdrawals'),
    calls.map((c) => `${c.method} ${c.path}`).join(', '));
});

test('the stored question context is the reader context; any context change is a new question; no context is refused', () => {
  const q = (r) => judgmentFor(r, fromReceiptWorkLine(r, { runId: RUN }, { version: 'v' }), { runId: RUN, version: 'v' });
  const base = q(row);
  assert.deepEqual(base.params.context, row.question_context);
  for (const c of [{ receipt_date: '2999-01-01', anchor_date: null }, { source_document_id: '77777777-7777-7777-7777-777777777777' },
    { link_id: '88888888-8888-8888-8888-888888888888', link_basis: 'vehicle_hint' }]) {
    assert.notEqual(q({ ...row, question_context: { ...row.question_context, ...c } }).question_hash, base.question_hash, JSON.stringify(c));
  }
  assert.throws(() => q({ ...row, question_context: undefined }), /question_context/);
});

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
// A builder that is a promise of the answer and takes the abort signal the way postgrest-js's does (the signal it was given is recorded).
const answer = (value: unknown, seen: AbortSignal[] = []) => Object.assign(Promise.resolve(value), { abortSignal(signal: AbortSignal) { seen.push(signal); return this; } });
vi.mock('../lib/supabase', () => ({ supabase: { rpc: fixture.rpc, from: fixture.from } }));
import { READ_BOUND_MS, bounded, readCitationLinks, readDrillRecords, readGateStatus, readLargeSums, readTierYears, readYearState } from './accountingCloseout';

// Synthetic values only. These readers take what the database returns and refuse a shape they do not understand; a malformed answer is an error, never an empty list.
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const record = (local: string) => ({ record_kind: 'retained_ledger_decision', local_id: local, year: '2024', date: '2024-02-01', account: null, section: 'Expense', category: 'c', amount: '10.00',
  currency: 'USD', description: 'd', status: 's', source_key: 'a'.repeat(64) });
const row = (over: object = {}) => ({ year: '2024', id: 'id-1', document_id: 'doc-1', local_id: 'L1', dollar_rank: 1, amount: 4800, share: 0.05, cum_share: 0.05, category: 'c', tier: 'B', pay_proof: true,
  doc_proof: false, basis_strength: 'bank_and_rule', proof_flag: null, required_doc_kind: 'invoice_or_agreement', required_doc_rule: 'contractor', missing_doc: true, doc_found_n: 0, doc_cited_n: 0,
  cites: [], record: record('L1'), attached: [], ...over });
const year = (rows: object[], over: object = {}) => ({ year: '2024', year_usd: 100, deductions_n: 9, head_n: 3, head_usd: 80, flagged_n: rows.length, flagged_usd: 50, missing_doc_n: 1, missing_doc_usd: 40,
  missing_doc_cite_no_document: 1, missing_doc_by_kind: { invoice_or_agreement: { n: 1, amount: 40 } }, no_payment_n: 0, no_payment_usd: 0, filed_return_only_n: 0, filed_return_only_usd: 0, beyond_head_missing_doc_n: 0, beyond_head_missing_doc_usd: 0, rows_shown: rows.length, rows, ...over });
const sums = (years: object[]) => ({ reader: 'books_large_sum_rows', owner_id: owner, read_at: '2026-10-29T17:40:00Z', years });
beforeEach(() => { fixture.rpc.mockReset(); fixture.from.mockReset(); });
afterEach(() => vi.useRealTimers());
const reply = (data: unknown, error: unknown = null) => fixture.rpc.mockImplementation(() => answer({ data, error }));

it('reads the large sums for the owner in one call and hands back what the reader stated', async () => {
  const stated = sums([year([row()])]);
  reply(stated);
  expect(await readLargeSums(owner)).toEqual({ read_at: stated.read_at, years: [{ ...stated.years[0], unreadable_rows: 0 }] });
  expect(fixture.rpc).toHaveBeenCalledOnce();
  expect(fixture.rpc).toHaveBeenCalledWith('books_large_sum_rows', { p_owner_id: owner });
});

it('a year with nothing flagged is a year with no rows, and no years is an empty list: both are answers', async () => {
  reply(sums([year([], { flagged_n: 0, missing_doc_n: 0, missing_doc_by_kind: {}, missing_doc_cite_no_document: 0 })]));
  expect((await readLargeSums(owner)).years[0].rows).toEqual([]);
  reply(sums([]));
  expect((await readLargeSums(owner)).years).toEqual([]);
});

it('an error, an empty answer and a malformed year are all "could not load", never zero rows', async () => {
  for (const data of [null, {}, { read_at: 'x', years: 'nope' }, sums([year([row()], { head_n: 'many' })]), sums([year([row()], { rows_shown: 2 })]), sums([{ year: '2024' }]),
    sums([year([row()], { missing_doc_by_kind: { invoice_or_agreement: { n: 'one', amount: 1 } } })]), sums([year([row()], { missing_doc_by_kind: undefined })]),
    sums([year([row()], { missing_doc_cite_no_document: undefined })])]) {
    reply(data);
    await expect(readLargeSums(owner)).rejects.toThrow('The large sums could not load.');
  }
  reply(null, { code: '57014', message: 'canceling statement due to statement timeout' });
  await expect(readLargeSums(owner)).rejects.toThrow('The large sums could not load.');
  reply(null, { code: '42501', message: 'the large sums are the owner\'s alone' });
  await expect(readLargeSums(owner)).rejects.toThrow('The large sums could not load.');
});

it('a row that cannot be read is left out and counted, so one bad row never hides the year and never goes unsaid', async () => {
  reply(sums([year([row(), row({ id: 'id-2', record: null }), row({ id: 'id-3', local_id: '' }), row({ id: 'id-4', amount: '4800' }), row({ id: 'id-5', attached: [{ filename: 'x' }] }),
    row({ id: 'id-6', record: { ...record('L6'), source_key: '' } }), row({ id: 'id-7', local_id: 'L7' })])]));
  const [read] = (await readLargeSums(owner)).years;
  expect(read.rows.map(r => r.id)).toEqual(['id-1', 'id-7']);
  expect(read.unreadable_rows).toBe(5);
  // the year's own numbers are the database's, whatever the rows
  expect(read.flagged_n).toBe(7);
  expect(read.rows_shown).toBe(7);
});

// ── the stored run's context ─────────────────────────────────────────────────────────────────────────────────────────────

const run = (context: unknown) => ({ id: 'r', started_at: 'a', finished_at: 'b', duration_ms: 1, pass: true, stale: false, stale_books: false, stale_gate: false, trusted: true,
  rule_counts: { total: 1, pass: 1, fail: 0, not_assessed: 0, empty: 0 }, context, rules: [{ rule: 'R1', title: 't', status: 'pass', n: 0, of: 5, amount: 0 }] });
const status = (r: unknown) => ({ owner_id: owner, read_at: 'x', book_signature: 's', gate_md5: 'm',
  summary: { years: 1, with_run: 1, passed: 1, trusted: 1, failing: 0, not_assessed: 0, stale: 0, open_items: 0 },
  years: [{ year: 2024, draft_document_id: null, drafts_on_file: 0, attempt: null, run: r, open_items: { total: 0, owner: 0, cpa: 0, agent: 0, unassigned: 0 } }] });
const context = { deductions: { n: 200, usd: 150000 }, no_bank: { n: 30, usd: 20000 }, no_pay_no_ruling: { n: 12, usd: 9000 }, head: { n: 40, usd: 120000, year_usd: 150000 } };

it('a stored run carries its context whole, or none; a run recorded before the context existed reads as null', async () => {
  fixture.rpc.mockResolvedValue({ data: status(run(context)), error: null });
  expect((await readGateStatus(owner)).years[0].run?.context).toEqual(context);
  fixture.rpc.mockResolvedValue({ data: status(run(null)), error: null });
  expect((await readGateStatus(owner)).years[0].run?.context).toBeNull();
  fixture.rpc.mockResolvedValue({ data: status(run({ ...context, head: { n: 40, usd: 120000, year_usd: null } })), error: null });
  expect((await readGateStatus(owner)).years[0].run?.context?.head.year_usd).toBeNull();
});

it('a context with a missing or non-numeric part is a malformed answer, not a partial one', async () => {
  for (const bad of [{ ...context, deductions: { n: 'x', usd: 1 } }, { ...context, no_bank: undefined }, { ...context, head: { n: 1, usd: 2 } }, 'context', [context]]) {
    fixture.rpc.mockResolvedValue({ data: status(run(bad)), error: null });
    await expect(readGateStatus(owner)).rejects.toThrow('The gate status could not load.');
  }
});


// ── reads that can be cancelled, bounded, and share one drill reader ────────────────────────────────────────────────────────

it('a read is given the abort signal it was called with, and none when it was called with none', async () => {
  const seen: AbortSignal[] = [];
  fixture.rpc.mockImplementation(() => answer({ data: sums([]), error: null }, seen));
  await readLargeSums(owner);
  expect(seen).toEqual([]);
  const controller = new AbortController();
  await readLargeSums(owner, controller.signal);
  expect(seen).toEqual([controller.signal]);
  fixture.from.mockImplementation(() => { const q: any = answer({ data: [], error: null }, seen); for (const m of ['select', 'eq', 'order']) q[m] = () => q; return q; });
  await readTierYears(owner, controller.signal); await readCitationLinks(owner, controller.signal);
  fixture.rpc.mockImplementation(() => answer({ data: { schedule_c: {}, open_items: [] }, error: null }, seen));
  await readYearState(owner, '2024', controller.signal);
  expect(seen).toHaveLength(4);
});

it('bounded: the read gets a signal that aborts when the time is up, so a stall ends as an error and not as a caption that never changes, even if the request ignores the signal', async () => {
  vi.useFakeTimers();
  let stalled!: AbortSignal;
  const read = bounded(signal => { stalled = signal; return new Promise<string>(() => undefined); });
  const caught = read.catch(e => e as Error);
  await vi.advanceTimersByTimeAsync(READ_BOUND_MS - 1);
  expect(stalled.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(2);
  expect(stalled.aborted).toBe(true);
  expect(((await caught) as Error).message).toBe('The read took too long.');
  expect(vi.getTimerCount()).toBe(0);
});

it('bounded: a read that finishes frees its timer and the caller\'s listener; the caller\'s abort reaches the read; a caller already aborted never starts it', async () => {
  vi.useFakeTimers();
  const parent = new AbortController();
  expect(await bounded(async () => 'done', parent.signal)).toBe('done');
  expect(vi.getTimerCount()).toBe(0);
  let inner!: AbortSignal;
  const pending = bounded(signal => { inner = signal; return new Promise<string>((_, no) => signal.addEventListener('abort', () => no(new Error('superseded')))); }, parent.signal);
  const caught = pending.catch(e => e as Error);
  parent.abort();
  expect(inner.aborted).toBe(true);
  expect(await caught).toBeInstanceOf(Error); // the read ends when the caller's signal does, whatever the request underneath does
  expect(vi.getTimerCount()).toBe(0);
  const already = new AbortController(); already.abort();
  let seenAborted = false;
  await bounded(async signal => { seenAborted = signal.aborted; }, already.signal);
  expect(seenAborted).toBe(true);
});

it('one drill reader serves the close-out items and the tier numbers: the key decides which reader, the envelope is the same', async () => {
  const envelope = { assessed: true, total: 2, amount: 30, rows: [{ id: 'a' }, { id: 'b' }] };
  reply(envelope);
  expect(await readDrillRecords(owner, '2024', 'tier_c', 50, 0)).toEqual(envelope);
  expect(fixture.rpc).toHaveBeenLastCalledWith('books_tier_records', { p_owner_id: owner, p_year: '2024', p_class: 'tier_c', p_limit: 50, p_offset: 0 });
  expect(await readDrillRecords(owner, '2024', 'no_pay_no_ruling', 50, 100)).toEqual(envelope);
  expect(fixture.rpc).toHaveBeenLastCalledWith('books_tier_records', { p_owner_id: owner, p_year: '2024', p_class: 'no_pay_no_ruling', p_limit: 50, p_offset: 100 });
  expect(await readDrillRecords(owner, '2024', 'revenue_no_payer', 1, 0)).toEqual(envelope);
  expect(fixture.rpc).toHaveBeenLastCalledWith('accounting_closeout_records', { p_owner_id: owner, p_year: '2024', p_item: 'revenue_no_payer', p_limit: 1, p_offset: 0 });
  reply({ assessed: false, rows: [] });
  expect(await readDrillRecords(owner, '2024', 'expense_no_proof', 1, 0)).toEqual({ assessed: false, total: null, amount: null, rows: [] });
  reply(null, { code: '57014' });
  await expect(readDrillRecords(owner, '2024', 'tier_a', 1, 0)).rejects.toThrow('These records could not load.');
  reply({ rows: 'many' });
  await expect(readDrillRecords(owner, '2024', 'excluded', 1, 0)).rejects.toThrow('These records could not load.');
});

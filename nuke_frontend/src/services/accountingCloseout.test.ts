import { beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: { rpc: fixture.rpc } }));
import { readGateStatus, readLargeSums } from './accountingCloseout';

// Synthetic values only. These readers take what the database returns and refuse a shape they do not understand; a malformed answer is an error, never an empty list.
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const record = (local: string) => ({ record_kind: 'retained_ledger_decision', local_id: local, year: '2024', date: '2024-02-01', account: null, section: 'Expense', category: 'c', amount: '10.00',
  currency: 'USD', description: 'd', status: 's', source_key: 'a'.repeat(64) });
const row = (over: object = {}) => ({ year: '2024', id: 'id-1', document_id: 'doc-1', local_id: 'L1', dollar_rank: 1, amount: 4800, share: 0.05, cum_share: 0.05, category: 'c', tier: 'B', pay_proof: true,
  doc_proof: false, basis_strength: 'bank_and_rule', proof_flag: null, required_doc_kind: 'invoice_or_agreement', required_doc_rule: 'contractor', missing_doc: true, doc_found_n: 0, doc_cited_n: 0,
  cites: [], record: record('L1'), attached: [], ...over });
const year = (rows: object[], over: object = {}) => ({ year: '2024', year_usd: 100, deductions_n: 9, head_n: 3, head_usd: 80, flagged_n: rows.length, flagged_usd: 50, missing_doc_n: 1, missing_doc_usd: 40,
  no_payment_n: 0, no_payment_usd: 0, filed_return_only_n: 0, filed_return_only_usd: 0, beyond_head_missing_doc_n: 0, beyond_head_missing_doc_usd: 0, rows_shown: rows.length, rows, ...over });
const sums = (years: object[]) => ({ reader: 'books_large_sum_rows', owner_id: owner, read_at: '2026-10-29T17:40:00Z', years });
beforeEach(() => fixture.rpc.mockReset());

it('reads the large sums for the owner in one call and hands back what the reader stated', async () => {
  const answer = sums([year([row()])]);
  fixture.rpc.mockResolvedValue({ data: answer, error: null });
  expect(await readLargeSums(owner)).toEqual(answer);
  expect(fixture.rpc).toHaveBeenCalledOnce();
  expect(fixture.rpc).toHaveBeenCalledWith('books_large_sum_rows', { p_owner_id: owner });
});

it('a year with nothing flagged is a year with no rows, and no years is an empty list: both are answers', async () => {
  fixture.rpc.mockResolvedValue({ data: sums([year([], { flagged_n: 0, missing_doc_n: 0 })]), error: null });
  expect((await readLargeSums(owner)).years[0].rows).toEqual([]);
  fixture.rpc.mockResolvedValue({ data: sums([]), error: null });
  expect((await readLargeSums(owner)).years).toEqual([]);
});

it('an error, an empty answer and a malformed year or row are all "could not load", never zero rows', async () => {
  for (const data of [null, {}, { read_at: 'x', years: 'nope' }, sums([year([row()], { head_n: 'many' })]), sums([year([row({ record: null })])]), sums([year([row({ local_id: '' })])]),
    sums([year([row({ record: { ...record('L1'), source_key: '' } })])]), sums([year([row({ amount: '4800' })])]), sums([year([row({ attached: [{ filename: 'x' }] })])]),
    sums([year([row()], { rows_shown: 2 })]), sums([{ year: '2024' }])]) {
    fixture.rpc.mockResolvedValue({ data, error: null });
    await expect(readLargeSums(owner)).rejects.toThrow('The large sums could not load.');
  }
  fixture.rpc.mockResolvedValue({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } });
  await expect(readLargeSums(owner)).rejects.toThrow('The large sums could not load.');
  fixture.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'the large sums are the owner\'s alone' } });
  await expect(readLargeSums(owner)).rejects.toThrow('The large sums could not load.');
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

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  CloseoutYear, GateRule, GateRun, GateStatus, GateYear, LargeSumRow, LargeSumYear, LargeSums, TieYear, TierYear, YearState,
} from '../../../services/accountingCloseout';

/** The synthetic book every test of the books docket shares: every id, name, amount and date is invented. The builders mimic what the database hands over; the
 *  page only prints it. One module, so a change to the shape of the readers is made once. */

export const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const draft = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
export const open0 = { total: 0, owner: 0, cpa: 0, agent: 0, unassigned: 0 };

// ── the stored gate run ─────────────────────────────────────────────────────────────────────────────────────────────────
export const rule = (id: string, status: string, n: number, of: number | null, extra: object = {}): GateRule => ({ rule: id, title: `title of ${id}`, status, n, of, amount: null, ...extra });
export const ruleCounts = (rules: GateRule[]) => ({
  total: rules.length, pass: rules.filter(r => r.status === 'pass').length, fail: rules.filter(r => r.status === 'fail').length,
  not_assessed: rules.filter(r => r.status !== 'pass' && r.status !== 'fail').length, empty: rules.filter(r => r.status === 'pass' && r.of === 0).length,
});
export const run = (rules: GateRule[], over: Partial<GateRun> = {}): GateRun => {
  const rule_counts = ruleCounts(rules);
  const pass = rule_counts.fail === 0 && rule_counts.not_assessed === 0;
  return { id: 'run-1', started_at: '2026-10-29T17:30:30Z', finished_at: '2026-10-29T17:31:00Z', duration_ms: 30000, pass, stale: false, stale_books: false, stale_gate: false,
    trusted: pass && rule_counts.empty === 0, rule_counts, context: null, rules, ...over };
};
export const attempt = (status: 'timed_out' | 'error' | 'complete', finished_at = '2026-10-29T17:32:00Z') => ({ status, started_at: '2026-10-29T17:30:00Z', finished_at, duration_ms: 120000 });
export const gateYear = (year: number, over: Partial<GateYear> = {}): GateYear => ({ year, draft_document_id: draft, drafts_on_file: 1, attempt: null, run: null, open_items: open0, ...over });
export const status = (years: GateYear[]): GateStatus => ({ owner_id: owner, read_at: '2026-10-29T17:40:00Z', book_signature: '10:2026', gate_md5: 'abc',
  summary: { years: years.length, with_run: years.filter(y => y.run).length, passed: 0, trusted: years.filter(y => y.run?.trusted).length, failing: 0, not_assessed: 0, stale: 0,
    open_items: years.reduce((n, y) => n + y.open_items.total, 0) }, years });
export const cleanRules = [rule('R1', 'pass', 0, 100), rule('R9', 'pass', 0, 18), rule('R10', 'pass', 0, 50)];

// ── the live readers ───────────────────────────────────────────────────────────────────────────────────────────────────
export const tier = (year: string, over: Partial<TierYear> = {}): TierYear => ({ year, decisions: 12, deductions: 10, total_usd: 1100, deduction_usd: 1000, a_usd: 100, b_usd: 700, c_usd: 200, a_pct: 10, b_pct: 70, c_pct: 20,
  a_n: 1, b_n: 7, c_n: 2, excluded_n: 2, excluded_usd: 100, b_nobank_n: 1, b_nobank_usd: 50, s274_usd: 400, s274_needs_receipt_usd: 40, s274_uncaveated_usd: 25, no_pay_no_ruling_usd: 0, ...over });
export const tie = (year: string, over: Partial<TieYear> = {}): TieYear => ({ year, decisions: 12, both_n: 2, cites_only_n: 5, cited_by_only_n: 2, cites_missing_n: 2, none_n: 1, links: 20, links_resolved: 15, tied_n: 9, amount_equal_n: 8, ...over });

export const sourceKey = (c: string) => c.repeat(64);
export const record = (local: string, over: object = {}) => ({ record_kind: 'retained_ledger_decision', local_id: local, year: '2024', date: '2024-01-05', account: 'Synthetic', section: 'Expense',
  category: 'Synthetic category', amount: '4800.00', currency: 'USD', description: 'Painter Co — paint and bodywork', status: 'Synthetic', source_key: sourceKey(local.slice(-1) || 'a'), ...over });
export const largeRow = (n: number, over: Partial<LargeSumRow> = {}): LargeSumRow => ({ year: '2024', id: `id-${n}`, document_id: `doc-${n}`, local_id: `L${n}`, dollar_rank: n, amount: 5000 - n * 100, share: 0.01,
  cum_share: 0.01, category: 'Synthetic category', tier: 'B', pay_proof: true, doc_proof: false, basis_strength: 'bank_and_rule', proof_flag: null, required_doc_kind: 'invoice_or_agreement',
  required_doc_rule: 'contractor', missing_doc: true, doc_found_n: 0, doc_cited_n: 0, cites: [],
  record: record(`L${n}`, { date: `2024-01-${String(n).padStart(2, '0')}`, description: `Payee ${n} — work ${n}` }) as LargeSumRow['record'], attached: [], ...over });
export const largeYear = (rows: LargeSumRow[], over: Partial<LargeSumYear> = {}): LargeSumYear => {
  const missing = rows.filter(r => r.missing_doc);
  return { year: '2024', year_usd: 20000, deductions_n: 90, head_n: 30, head_usd: 16000, flagged_n: rows.length, flagged_usd: 9000, missing_doc_n: missing.length, missing_doc_usd: 8000,
    missing_doc_cite_no_document: missing.filter(r => r.doc_cited_n === 0).length, missing_doc_by_kind: missing.length ? { invoice_or_agreement: { n: missing.length, amount: 8000 } } : {},
    no_payment_n: rows.filter(r => r.proof_flag === 'no_payment_proof').length, no_payment_usd: 500, filed_return_only_n: rows.filter(r => r.proof_flag === 'filed_return_only').length, filed_return_only_usd: 400,
    beyond_head_missing_doc_n: 0, beyond_head_missing_doc_usd: 0, rows_shown: rows.length, rows, unreadable_rows: 0, ...over };
};
export const sumsOf = (...years: LargeSumYear[]): LargeSums => ({ read_at: '2026-10-29T17:40:00Z', years });

/** A stored run that found both things the first screen is about, with the denominators it kept. */
export const storedRun = (over: Partial<GateRun> = {}): GateRun => run([rule('R10', 'fail', 12, 200), rule('R12', 'fail', 2, 30, { missing_doc: { n: 2, amount: 8000, cite_no_document: 1, by_kind: { invoice_or_agreement: { n: 2, amount: 8000 } } } })],
  { context: { deductions: { n: 200, usd: 150000 }, no_bank: { n: 30, usd: 20000 }, no_pay_no_ruling: { n: 12, usd: 9000 }, head: { n: 30, usd: 16000, year_usd: 20000 } }, ...over });

// ── the facts register ────────────────────────────────────────────────────────────────────────────────────────────────
export const yearState = (over: Partial<YearState> = {}): YearState => ({ year: 2024, read_at: '2026-10-29T17:40:00Z', result: null, schedule_c: {}, rulings: [], facts: [], open_items: [], unmapped: [], ...over });
export const filingFact = (state: string, over: object = {}) => ({ local_id: '2024-FACT-filing', key: 'filing', topic: 'filing', status: 'settled', date: '2026-10-29', decision: 'Synthetic.', source: 's',
  filing: { state, as_of: '2026-10-29', form: '1040', packet_pages: 14, packet_document_id: draft, ...over } });

// ── the close-out ──────────────────────────────────────────────────────────────────────────────────────────────────────
export const closeoutYear = (extra: Partial<CloseoutYear> = {}): CloseoutYear => ({
  year: '2024', draft_stale: false, books: { decisions: 10, revenue_records: 4, revenue: 1000, expense_records: 6, expense: 600, revised_at: '2026-10-25T22:00:00Z' },
  return: { tax_year: '2024', form: '1040', result: 'owe', amount: 900, schedule_c_net: 400, total_tax: 1200, agi: 500, built_at: '2026-10-25T21:00:00Z',
    books_as_of: '2026-10-25T20:00:00Z', tax_per_1000_expense: -300, document_id: 'draft-doc', recorded_at: '2026-10-25T21:00:00Z',
    filing: { signers: 'both spouses', method: 'paper, certified mail', mail_to: 'a synthetic address', deadline: null } },
  items: [
    { key: 'expense_no_proof', n: 2, of: 6, amount: 200, assessed: true },
    { key: 'expense_no_receipt', n: 3, of: 6, amount: 2000, assessed: true },
    { key: 'car_cost_no_car', n: 0, of: 2, amount: 0, assessed: true },
    { key: 'statement_gaps', n: 1, of: 12, assessed: true, amount: null, accounts: [{ account: 'Synthetic checking', months_without_lines: ['2024-03'], months_in_span: 12 }] },
    { key: 'revenue_no_payer', n: null, of: null, amount: null, assessed: false, deferred: true },
  ], ...extra });

// ── doubles for the data API and the query client ─────────────────────────────────────────────────────────────────────────
/** What the data API returns: a promise of the answer that takes the abort signal the way postgrest-js's builder does (the reads pass one). */
export const answer = (value: unknown, seen: AbortSignal[] = []) => Object.assign(Promise.resolve(value), { abortSignal(signal: AbortSignal) { seen.push(signal); return this; } });
/** A table or view read: select, eq and order return the builder; awaiting it gives the table's answer. */
export const tableRead = (result: () => unknown, seen: AbortSignal[] = []) => {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order']) q[m] = () => q;
  q.abortSignal = (signal: AbortSignal) => { seen.push(signal); return q; };
  q.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject);
  return q;
};
/** The query client the app mounts, minus its retry (a page sets its own): a fresh one for each test, so nothing is shared between them. */
export const freshClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
export const inQuery = (client: QueryClient, child: React.ReactNode) => <QueryClientProvider client={client}>{child}</QueryClientProvider>;

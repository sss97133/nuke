// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), invoke: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc, from: fixture.from, functions: { invoke: fixture.invoke }, auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } } }));
vi.mock('../PrefetchLink', () => ({ default: ({ to, children, ...props }: any) => <a href={to} {...props}>{children}</a> }));
import FinishTaxes, { HIDDEN_ITEMS, ITEM_WORDS, rankItems, stakeWords } from './FinishTaxes';
import BooksDocket from './BooksDocket';
import RecordEvidence from './RecordEvidence';
import { passWhat, passWho } from './AccountingActivity';
import { AccountingBookContext } from './AccountingBookContext';
import { describeRecord, type Closeout } from '../../services/accountingCloseout';
import { answer, closeoutYear as year, freshClient, gateYear, inQuery, owner, run, cleanRules, status, tableRead, yearState as stateOf } from './__fixtures__/books';

// Synthetic book: every value below is invented (see __fixtures__/books.ts).
let node: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; client = freshClient(); fixture.rpc.mockReset(); fixture.from.mockReset(); fixture.invoke.mockReset();
  fixture.from.mockImplementation(() => tableRead(() => ({ data: [], error: null })));
  node = document.createElement('div'); document.body.append(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.useRealTimers(); client.clear(); });
const inBook = (child: React.ReactNode) => inQuery(client, <AccountingBookContext.Provider value={{ ownerId: owner, shared: false, canCorrect: true, liveRevision: '1' }}>{child}</AccountingBookContext.Provider>);
/** The data API answers each call from the handler, as a promise that takes the abort signal the reads pass. */
const serve = (handler: (name: string, args: any) => unknown) => fixture.rpc.mockImplementation((name: string, args: any) => answer(handler(name, args)));
const later = async (ms: number) => { for (let left = ms; left > 0; left -= 100) await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(100, left)); }); };
// react-query notifies on a timer and a read that depends on another starts a render later: let a few turns pass
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); };
const reads = (name: string) => fixture.rpc.mock.calls.filter(c => c[0] === name).length;
const noIncome = { assessed: true, total: 0, amount: 0, rows: [] };

it('ranks items by the money the database states and hides the two items the docket answers in their place', () => {
  const ranked = rankItems(year({}).items).map(i => i.key);
  expect(ranked.slice(0, 3)).toEqual(['expense_no_receipt', 'expense_no_proof', 'statement_gaps']);
  expect(ranked.at(-1)).toBe('revenue_no_payer');
  expect([...HIDDEN_ITEMS].sort()).toEqual(['expense_no_proof', 'expense_no_receipt']);
  expect(Object.keys(ITEM_WORDS).sort()).toEqual(['car_cost_no_car', 'expense_no_proof', 'expense_no_receipt', 'revenue_no_payer', 'statement_gaps']);
});

it('no tax is computed on this page: the stake is the draft\'s own rate, said for income only, and nothing is multiplied by it', () => {
  expect(stakeWords('revenue_no_payer', -300)).toBe('Each $1,000 shown not to be income (a transfer, loan or refund) saves about $300 of tax, at the draft\'s own rate.');
  expect(stakeWords('expense_no_proof', -300)).toBeNull();
  expect(stakeWords('car_cost_no_car', -300)).toBeNull();
});

it('leads each year with the plain answer, never warns from timestamps, ranks what is left and drills into it', async () => {
  const data: Closeout = { read_at: '2026-10-25T23:00:00Z', books_revised_at: null, questions: { pending_current: 7, by_resolver: { 'Synthetic Owner': 5, model_reconciliation: 2 } },
    years: [year({ draft_stale: true }), { year: '2021', return: null, books: null, draft_stale: null, items: [] }] };
  serve((name, args) => name === 'accounting_closeout' ? { data, error: null }
    : name === 'accounting_closeout_records' && args.p_item === 'revenue_no_payer' ? { data: { assessed: true, total: 1, amount: 250, rows: [] }, error: null }
    : name === 'books_year_state' ? { data: stateOf({ year: args.p_year }), error: null } : { data: null, error: { message: 'unexpected' } });
  const drill = vi.fn(), questions = vi.fn();
  await act(async () => root.render(inBook(<FinishTaxes onDrill={drill} onQuestions={questions} />)));
  await settle();
  expect(node.querySelector('.accounting-close-answer')?.textContent).toBe('You owe $900');
  expect(node.querySelectorAll('.accounting-close-year')).toHaveLength(1);
  // Whether the return still matches the books is the gate's answer (books docket, rule R9); a comparison of timestamps never warns here.
  expect(node.querySelector('[role="alert"]')).toBeNull();
  expect(node.textContent).not.toContain('Regenerate');
  expect(node.textContent).not.toContain('books changed');
  expect(node.querySelector('#close-2024')).not.toBeNull();
  const labels = Array.from(node.querySelectorAll('.accounting-close-item .k-body')).map(n => n.textContent);
  // Two items are not listed (owner ruling 2026-10-28; the docket answers both): the per-line receipt, and the statement-side count of expenses with no bank line and no receipt.
  expect(labels.slice(0, 2)).toEqual(['Income with no named payer', 'Months with no statement lines']);
  for (const gone of ['Expenses paid, but no receipt', 'The bank line proves payment, not what was bought', 'Expenses with no bank line and no receipt', 'Nothing on file shows these were paid.', 'more tax']) expect(node.textContent).not.toContain(gone);
  expect(node.textContent).toContain('Each $1,000 shown not to be income (a transfer, loan or refund) saves about $300 of tax, at the draft\'s own rate.');
  expect(node.textContent).not.toContain('about $75');
  expect(node.textContent).not.toContain('about $60');
  expect(node.textContent).toContain('Sign and mail (your step)');
  expect(node.textContent).toContain('Open questions: Synthetic Owner 5');
  expect(node.textContent).toContain('plus 2 agent notes');
  // Every count carries its source and its read time.
  expect(node.querySelector('.accounting-close-questions')?.textContent).toContain('Pending questions on the current reading, from the review queue (financial_review_queue) · read Oct 25, 2026, 4:00 PM');
  expect(node.textContent).toContain('Counts read Oct 25, 2026, 4:00 PM from the close-out (accounting_closeout); filing state and facts from the facts register (books_year_state).');
  await act(async () => (Array.from(node.querySelectorAll('.accounting-close-item button')).find(b => b.textContent!.includes('Income with no named payer')) as HTMLButtonElement).click());
  expect(drill).toHaveBeenCalledWith({ year: '2024', item: 'revenue_no_payer', label: 'Income with no named payer' });
  await act(async () => (node.querySelector('.accounting-close-questions') as HTMLButtonElement).click());
  expect(questions).toHaveBeenCalled();
});

it('shows income-payer status only for years with income records, and a failed gate read as not assessed', async () => {
  const noIncomeYear = year({ year: '2023', books: { decisions: 2, revenue_records: 0, revenue: null, expense_records: 2, expense: 10, revised_at: null } });
  const data: Closeout = { read_at: '2026-10-25T23:00:00Z', books_revised_at: null, questions: { pending_current: 0, by_resolver: {} }, years: [year({}), noIncomeYear] };
  vi.useFakeTimers();
  serve(name => name === 'accounting_closeout' ? { data, error: null } : name === 'books_year_state' ? { data: stateOf(), error: null } : { data: null, error: { code: '57014' } });
  await act(async () => root.render(inBook(<FinishTaxes onDrill={vi.fn()} onQuestions={vi.fn()} />)));
  await later(3000);
  const cards = node.querySelectorAll('.accounting-close-year');
  expect(cards[0].textContent).toContain('Income with no named payer');
  expect(cards[0].textContent).toContain('Not assessed');
  expect(cards[1].textContent).not.toContain('Income with no named payer');
  expect(node.textContent).not.toContain('Checking…');
});

it('a failed read is tried once more, then says so and never shows zero', async () => {
  vi.useFakeTimers();
  serve(() => ({ data: null, error: { code: '57014' } }));
  await act(async () => root.render(inBook(<FinishTaxes onDrill={vi.fn()} onQuestions={vi.fn()} />)));
  // The first failure shows no error yet: the read is tried again a moment later (the first load failed under load, 2026-10-29).
  await later(100);
  expect(node.querySelector('[role="alert"]')).toBeNull();
  expect(node.textContent).toContain('Reading where each tax year stands');
  await later(2000);
  expect(reads('accounting_closeout')).toBe(2);
  expect(node.querySelector('[role="alert"]')?.textContent).toContain('Where each tax year stands could not load.');
  expect(node.textContent).not.toContain('$0');
  // and the retry button reads again
  const data: Closeout = { read_at: '2026-10-25T23:00:00Z', books_revised_at: null, questions: { pending_current: 0, by_resolver: {} }, years: [year({})] };
  serve(name => name === 'accounting_closeout' ? { data, error: null } : name === 'books_year_state' ? { data: stateOf(), error: null } : { data: noIncome, error: null });
  await act(async () => (node.querySelector('[role="alert"] button') as HTMLButtonElement).click());
  await later(500);
  expect(node.querySelector('.accounting-close-answer')?.textContent).toBe('You owe $900');
});

it('a read that fails once and succeeds on the second try shows the status without an error', async () => {
  vi.useFakeTimers();
  const data: Closeout = { read_at: '2026-10-25T23:00:00Z', books_revised_at: null, questions: { pending_current: 0, by_resolver: {} }, years: [year({})] };
  let tries = 0;
  serve(name => name === 'accounting_closeout' ? (++tries === 1 ? { data: null, error: { code: '503' } } : { data, error: null }) : name === 'books_year_state' ? { data: stateOf(), error: null } : { data: noIncome, error: null });
  await act(async () => root.render(inBook(<FinishTaxes onDrill={vi.fn()} onQuestions={vi.fn()} />)));
  await later(2500);
  expect(node.querySelector('.accounting-close-answer')?.textContent).toBe('You owe $900');
  expect(node.querySelector('[role="alert"]')).toBeNull();
});

// ── No total across the years, and a year on hold says so ─────────────────────────────────────────────────────────────────
const refund = (y: string, amount: number) => year({ year: y, return: { ...year({}).return!, tax_year: y, result: 'refund', amount } });
const HOLD_YEAR = 2019; // an invented year, so no test says which real year is on hold
const hold = (y: number) => ({ local_id: `${y}-FACT-filing-hold`, key: 'filing-hold', topic: 'owner_ruling', status: 'settled', date: '2026-10-20', decision: 'Hold.', source: 's' }) as any;

it('each year says its own answer and the page adds nothing across them: no total, no "net"; a year on hold says so on its own card', async () => {
  const data: Closeout = { read_at: '2026-10-25T23:00:00Z', books_revised_at: null, questions: { pending_current: 0, by_resolver: {} }, years: [refund('2024', 1000), refund(String(HOLD_YEAR), 5000)] };
  serve((name, args) => name === 'accounting_closeout' ? { data, error: null }
    : name === 'books_year_state' ? { data: stateOf({ year: args.p_year, facts: args.p_year === HOLD_YEAR ? [hold(HOLD_YEAR)] : [] }), error: null } : { data: noIncome, error: null });
  await act(async () => root.render(inBook(<FinishTaxes onDrill={vi.fn()} onQuestions={vi.fn()} />)));
  await settle();
  expect(Array.from(node.querySelectorAll('.accounting-close-answer')).map(n => n.textContent)).toEqual(['You get back $1,000', 'You get back $5,000']);
  for (const summed of ['Across the', ' net, before', 'before penalties and interest', 'you get back $6,000', 'not counted in the total']) expect(node.textContent).not.toContain(summed);
  expect(node.querySelector(`#close-${HOLD_YEAR}`)?.textContent).toContain('On hold as of Oct 20, 2026.');
  expect(node.querySelector('#close-2024')?.textContent).not.toContain('On hold');
});

it('the docket and Finish your taxes read a year\'s state and the close-out once between them, in one office', async () => {
  const data: Closeout = { read_at: '2026-10-25T23:00:00Z', books_revised_at: null, questions: { pending_current: 0, by_resolver: {} }, years: [year({})] };
  serve((name, args) => name === 'accounting_closeout' ? { data, error: null }
    : name === 'books_gate_status' ? { data: status([gateYear(2024, { run: run(cleanRules) })]), error: null }
    : name === 'books_year_state' ? { data: stateOf({ year: args.p_year }), error: null } : { data: noIncome, error: null });
  vi.useFakeTimers();
  await act(async () => root.render(inBook(<><BooksDocket onDrill={vi.fn()} onOpen={vi.fn()} /><FinishTaxes onDrill={vi.fn()} onQuestions={vi.fn()} /></>)));
  await later(7000);
  expect(node.querySelector('#close-2024')).not.toBeNull();
  expect(node.querySelector('#docket-2024')).not.toBeNull();
  expect(reads('books_year_state')).toBe(1);
  expect(reads('accounting_closeout')).toBe(1);
  expect(reads('books_gate_status')).toBe(1);
});

it('shows evidence strongest first: one line, the car, the receipt, the statement line, the message, and notes last', async () => {
  const vehicle = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  fixture.rpc.mockResolvedValue({ data: {
    revised_at: null, strength: 'artifact', source_cells: 40, notes: 'A long synthetic bookkeeping paragraph.',
    record: { local_id: 'E-1', kind: 'retained_ledger_decision', date: '2024-03-01', year: '2024', amount: '100.00', currency: 'USD', account: 'Synthetic checking', section: 'Expense', category: 'Parts',
      description: 'Synthetic Trim Co (upholstery / labor) — seat work (Owner) (Wallet message 0A1B2C3D (2024-03-02T01:36); Owner closeout 10 Oct 2026; Synthetic bank statement Jan 2024)', status: null },
    statement_lines: [{ document_id: 'bank-doc', source_key: 'b'.repeat(64), local_id: 'bank:1', date: '2024-03-01', amount: '-100.00', currency: 'USD', account: 'Synthetic checking', description: 'CARD PURCHASE' }],
    linked_decisions: [], vehicles: [{ id: vehicle, label: '1970 Synthetic Roadster', via: 'use' }], jobs: [],
    artifacts: [{ document_id: 'receipt-doc', filename: 'r.jpeg', kind: 'image', via: 'matches_statement_line', issuer: 'Synthetic Parts', date: '2024-03-01', amount: 100, currency: 'USD' }],
    use: { label: 'Roadster', use_type: 'vehicle', vehicle_id: vehicle, allocated: '100', unallocated: '0', status: 'reviewer_assigned_use', basis: null },
    messages: [{ kind: 'gmail', id: '19b0217af0e48f1c', sent_at: '2025-12-09T07:51:05Z', quote: 'Paid receipt 19b0217af0e48f1c names the card.' }],
    attestations: [], questions: [],
  }, error: null });
  fixture.invoke.mockResolvedValue({ data: { data: { bytes_base64: btoa('img'), mime_type: 'image/jpeg', source_filename: 'r.jpeg' } }, error: null });
  (URL as any).createObjectURL = vi.fn(() => 'blob:receipt'); (URL as any).revokeObjectURL = vi.fn();
  const open = vi.fn();
  await act(async () => root.render(inBook(<RecordEvidence documentId="slice" sourceKey={'a'.repeat(64)} onOpenDocument={open} fallbackTitle="Parts" />)));
  expect(fixture.rpc).toHaveBeenCalledWith('accounting_record_evidence', { p_owner_id: owner, p_document_id: 'slice', p_source_key: 'a'.repeat(64) });
  expect(node.querySelector('h3')?.textContent).toBe('Synthetic Trim Co — upholstery / labor');
  expect(node.querySelector('[aria-label="Messages"]')?.textContent).toContain('Wallet message · Mar 1, 2024, 5:36 PM · 0A1B2C3D');
  expect(node.querySelector('.accounting-evidence-attestation')?.textContent).toBe('Confirmed at close-out by Owner, Oct 10, 2026');
  expect(node.querySelector('[aria-label="Cited sources"]')?.textContent).toContain('Statement cited Synthetic bank statement Jan 2024');
  expect(node.querySelector('.accounting-evidence-notes')?.textContent).toContain('Original description: Synthetic Trim Co');
  expect(node.querySelector('.accounting-evidence-line')?.textContent).toBe('Mar 1, 2024 · Paid from Synthetic checking · $100 · Expense · Parts');
  expect(node.querySelector(`a[href="/vehicle/${vehicle}"]`)?.textContent).toBe('1970 Synthetic Roadster ↗');
  expect(node.querySelector('img')?.getAttribute('src')).toBe('blob:receipt');
  expect(node.querySelector('img')?.getAttribute('width')).toBe('160');
  expect(fixture.invoke).toHaveBeenCalledWith('ingest-observation', { body: { mode: 'financial_evidence_v1', action: 'original', owner_user_id: owner, document_id: 'receipt-doc' } });
  expect(node.querySelector('a[href="https://mail.google.com/mail/u/0/#all/19b0217af0e48f1c"]')?.textContent).toContain('Gmail · Dec 8, 2025');
  const notes = node.querySelector<HTMLDetailsElement>('.accounting-evidence-notes')!;
  expect(notes.open).toBe(false);
  await act(async () => (node.querySelector('[aria-label="Statement lines"] button') as HTMLButtonElement).click());
  expect(open).toHaveBeenCalledWith('bank-doc');
});

it('splits a booked description into a short title and keyed source lines, dropping nothing', () => {
  const d = describeRecord('Synthetic Store (synthetic store 12) — Order 123-45 of 3 Mar 2024: brake pads, rotors (Helper 2026-10-10: shop supplies)');
  expect(d.title).toBe('Synthetic Store — brake pads, rotors');
  expect(d.cited).toEqual([{ kind: 'reference', text: 'Order 123-45 of 3 Mar 2024' }]);
  expect(d.attestations).toEqual([{ by: 'Helper', at: '2026-10-10', text: 'shop supplies', via: 'stated' }]);
  expect(describeRecord('Synthetic Fuel, Town — IMG_0001.jpeg')).toMatchObject({ title: 'Synthetic Fuel, Town', cited: [{ kind: 'file', text: 'IMG_0001.jpeg' }] });
  expect(describeRecord('VISA - 01/02 SYNTHETIC MERCHANT').title).toBe('VISA - 01/02 SYNTHETIC MERCHANT');
  expect(describeRecord('x'.repeat(120)).title!.length).toBeLessThanOrEqual(90);
});

it('names a pass by person or agent and says what it moved per year', () => {
  const pass = { actor_user_id: owner, run_family: 'synthetic-agent-books-20261025', method: 'synthetic-agent-books-correction', started_at: '2026-10-25T20:00:00Z', ended_at: '2026-10-25T21:00:00Z',
    revisions: 9, documents: 4, records_changed: 12, years: { '2024': { records: 5, amount: 1234.5 }, '2025': { records: 7, amount: null } }, questions_opened: 2, first_reading: false, latest_document_id: 'd', partial: false };
  expect(passWho(pass, { [owner]: 'You' })).toBe('Agent · synthetic agent books');
  expect(passWho({ ...pass, run_family: null, method: 'authenticated-record-classification' }, { [owner]: 'You' })).toBe('You');
  expect(passWhat(pass)).toBe('12 records changed · 2025: 7 records · 2024: 5 records, $1,235 touched · 2 questions opened');
});

it('renders each year from books_year_state: newer result, line 31 net, open items with what closes them, settled facts', async () => {
  const data: Closeout = { read_at: '2026-10-25T23:00:00Z', books_revised_at: null, questions: { pending_current: 0, by_resolver: {} }, years: [year({})] };
  const state = { year: 2024, read_at: '2026-10-26T23:00:00Z', unmapped: [],
    result: { form: '1040', result: 'refund', amount: 300, built_at: '2026-10-26T23:00:00Z', from: 'return_fact' },
    schedule_c: { 'Schedule C 1': { '31': 100.5 }, 'Schedule C 2': { '31': 200 } },
    rulings: [{ local_id: '2024-RULING-x', schedule: 'Schedule C', line: '20b', label: 'Schedule C line 20b: synthetic rent', amount: 50, decision: 'Synthetic ruling', date: '2024-12-31' }],
    facts: [{ local_id: '2024-FACT-filing', key: 'filing', topic: 'filing_status', status: 'settled', date: '2026-10-25', decision: 'Synthetic filing status', source: 'synthetic file' }],
    open_items: [{ local_id: '2024-FACT-form', key: 'form', topic: 'form_5471', status: 'open', date: '2026-10-26', decision: 'Synthetic open form', closes_with: 'a synthetic corrected form', source: 's' }] };
  serve((name, args) => name === 'accounting_closeout' ? { data, error: null }
    : name === 'books_year_state' && args.p_year === 2024 ? { data: state, error: null }
    : name === 'accounting_closeout_records' ? { data: { assessed: true, total: 0, amount: 0, rows: [] }, error: null } : { data: null, error: { message: 'unexpected' } });
  await act(async () => root.render(inBook(<FinishTaxes onDrill={vi.fn()} onQuestions={vi.fn()} />)));
  await settle();
  expect(node.querySelector('.accounting-close-answer')?.textContent).toBe('You get back $300');
  expect(node.textContent).toContain('Schedule C net $301');
  expect(node.textContent).toContain('Closes with: a synthetic corrected form');
  expect(node.textContent).toContain('Settled for 2024: 1 return facts, 1 Schedule C rulings');
  expect(node.textContent).toContain('Synthetic filing status');
});

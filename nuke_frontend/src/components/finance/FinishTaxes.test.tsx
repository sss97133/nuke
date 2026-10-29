// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc, functions: { invoke: fixture.invoke } } }));
vi.mock('../PrefetchLink', () => ({ default: ({ to, children, ...props }: any) => <a href={to} {...props}>{children}</a> }));
import FinishTaxes, { headlineOf, netAcrossYears, rankItems, taxAtStake } from './FinishTaxes';
import RecordEvidence from './RecordEvidence';
import { passWhat, passWho } from './AccountingActivity';
import { AccountingBookContext } from './AccountingBookContext';
import { clearYearStateReads, describeRecord, type Closeout, type CloseoutYear, type YearState } from '../../services/accountingCloseout';

// Synthetic book: every value below is invented.
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const year = (extra: Partial<CloseoutYear>): CloseoutYear => ({
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
let node: HTMLDivElement, root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; clearYearStateReads(); fixture.rpc.mockReset(); fixture.invoke.mockReset(); node = document.createElement('div'); document.body.append(node); root = createRoot(node); });
afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.useRealTimers(); });
const inBook = (child: React.ReactNode) => <AccountingBookContext.Provider value={{ ownerId: owner, shared: false, canCorrect: true, liveRevision: '1' }}>{child}</AccountingBookContext.Provider>;

it('measures tax at stake from the draft rate and ranks items by money', () => {
  expect(taxAtStake(2000, -300)).toBe(600);
  expect(taxAtStake(2000, null)).toBeNull();
  const ranked = rankItems(year({}).items).map(i => i.key);
  expect(ranked.slice(0, 3)).toEqual(['expense_no_receipt', 'expense_no_proof', 'statement_gaps']);
  expect(ranked.at(-1)).toBe('revenue_no_payer');
  expect(netAcrossYears([year({}), year({ year: '2023', return: { ...year({}).return!, result: 'refund', amount: 300 } })])).toEqual({ owe: 600, count: 2, first: '2023', last: '2024', counted: ['2023', '2024'], held: [] });
});

it('leads each year with the plain answer, never warns from timestamps, ranks what is left and drills into it', async () => {
  const data: Closeout = { read_at: '2026-10-25T23:00:00Z', books_revised_at: null, questions: { pending_current: 7, by_resolver: { 'Synthetic Owner': 5, model_reconciliation: 2 } },
    years: [year({ draft_stale: true }), { year: '2021', return: null, books: null, draft_stale: null, items: [] }] };
  fixture.rpc.mockImplementation(async (name: string, args: any) => name === 'accounting_closeout' ? { data, error: null }
    : name === 'accounting_closeout_records' && args.p_item === 'revenue_no_payer' ? { data: { assessed: true, total: 1, amount: 250, rows: [] }, error: null } : { data: null, error: { message: 'unexpected' } });
  const drill = vi.fn(), questions = vi.fn();
  await act(async () => root.render(inBook(<FinishTaxes onDrill={drill} onQuestions={questions} />)));
  expect(node.querySelector('.accounting-close-answer')?.textContent).toBe('You owe $900');
  expect(node.querySelectorAll('.accounting-close-year')).toHaveLength(1);
  // Whether the return still matches the books is the gate's answer (books docket, rule R9); a comparison of timestamps never warns here.
  expect(node.querySelector('[role="alert"]')).toBeNull();
  expect(node.textContent).not.toContain('Regenerate');
  expect(node.textContent).not.toContain('books changed');
  expect(node.querySelector('#close-2024')).not.toBeNull();
  const labels = Array.from(node.querySelectorAll('.accounting-close-item .k-body')).map(n => n.textContent);
  // The per-line receipt item is not listed (owner ruling 2026-10-28); the docket's tiers say how the deductions are supported.
  expect(labels.slice(0, 2)).toEqual(['Income with no named payer', 'Expenses with no bank line and no receipt']);
  expect(node.textContent).not.toContain('Expenses paid, but no receipt');
  expect(node.textContent).not.toContain('The bank line proves payment, not what was bought');
  expect(node.textContent).toContain('If these were disallowed, about $60 more tax. Each $1,000 proven keeps about $300.');
  expect(node.textContent).toContain('If these turned out to be transfers, loans or refunds, about $75 less tax. Each $1,000 shown not to be income saves about $300.');
  expect(node.textContent).not.toContain('about $600 more tax');
  expect(node.textContent).not.toContain('rides on');
  expect(node.textContent).toContain('Sign and mail (your step)');
  expect(node.textContent).toContain('Open questions: Synthetic Owner 5');
  expect(node.textContent).toContain('plus 2 agent notes');
  // Every count carries its source and its read time.
  expect(node.querySelector('.accounting-close-questions')?.textContent).toContain('Pending questions on the current reading, from the review queue (financial_review_queue) · read Oct 25, 2026, 4:00 PM');
  expect(node.textContent).not.toContain('Car costs with no car named$');
  await act(async () => (Array.from(node.querySelectorAll('.accounting-close-item button')).find(b => b.textContent!.includes('Expenses with no bank line')) as HTMLButtonElement).click());
  expect(drill).toHaveBeenCalledWith({ year: '2024', item: 'expense_no_proof', label: 'Expenses with no bank line and no receipt' });
  await act(async () => (node.querySelector('.accounting-close-questions') as HTMLButtonElement).click());
  expect(questions).toHaveBeenCalled();
});

it('shows income-payer status only for years with income records, and a failed gate read as not assessed', async () => {
  const noIncome = year({ year: '2023', books: { decisions: 2, revenue_records: 0, revenue: null, expense_records: 2, expense: 10, revised_at: null } });
  const data: Closeout = { read_at: '2026-10-25T23:00:00Z', books_revised_at: null, questions: { pending_current: 0, by_resolver: {} }, years: [year({}), noIncome] };
  fixture.rpc.mockImplementation(async (name: string) => name === 'accounting_closeout' ? { data, error: null } : { data: null, error: { code: '57014' } });
  await act(async () => root.render(inBook(<FinishTaxes onDrill={vi.fn()} onQuestions={vi.fn()} />)));
  const cards = node.querySelectorAll('.accounting-close-year');
  expect(cards[0].textContent).toContain('Income with no named payer');
  expect(cards[0].textContent).toContain('Not assessed');
  expect(cards[1].textContent).not.toContain('Income with no named payer');
  expect(node.textContent).not.toContain('Checking…');
});

it('a failed read is tried once more, then says so and never shows zero', async () => {
  vi.useFakeTimers();
  fixture.rpc.mockResolvedValue({ data: null, error: { code: '57014' } });
  await act(async () => root.render(inBook(<FinishTaxes onDrill={vi.fn()} onQuestions={vi.fn()} />)));
  // The first failure shows no error yet: the read is tried again a moment later (the first load failed under load, 2026-10-29).
  expect(node.querySelector('[role="alert"]')).toBeNull();
  expect(node.textContent).toContain('Reading where each tax year stands');
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(fixture.rpc.mock.calls.filter(c => c[0] === 'accounting_closeout')).toHaveLength(2);
  expect(node.querySelector('[role="alert"]')?.textContent).toContain('could not load');
  expect(node.textContent).not.toContain('$0');
});

it('a read that fails once and succeeds on the second try shows the status without an error', async () => {
  vi.useFakeTimers();
  const data: Closeout = { read_at: '2026-10-25T23:00:00Z', books_revised_at: null, questions: { pending_current: 0, by_resolver: {} }, years: [year({})] };
  let calls = 0;
  fixture.rpc.mockImplementation(async (name: string) => name === 'accounting_closeout' ? (++calls === 1 ? { data: null, error: { code: '503' } } : { data, error: null }) : { data: null, error: { message: 'unexpected' } });
  await act(async () => root.render(inBook(<FinishTaxes onDrill={vi.fn()} onQuestions={vi.fn()} />)));
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(node.querySelector('.accounting-close-answer')?.textContent).toBe('You owe $900');
  expect(node.querySelector('[role="alert"]')).toBeNull();
});

// ── The headline total never sums a year that is on hold ────────────────────────────────────────────────────────────────
const stateOf = (y: number, over: Partial<YearState> = {}): YearState => ({ year: y, read_at: '2026-10-29T17:40:00Z', result: null, schedule_c: {}, rulings: [], facts: [], open_items: [], unmapped: [], ...over });
const hold = (y: number) => ({ local_id: `${y}-FACT-filing-hold`, key: 'filing-hold', topic: 'owner_ruling', status: 'settled', date: '2026-10-28', decision: 'Hold.', source: 's' }) as any;
const refund = (y: string, amount: number) => year({ year: y, return: { ...year({}).return!, tax_year: y, result: 'refund', amount } });

it('a year on hold is left out of the headline total, and the headline says which year and why', () => {
  const years = [refund('2025', 2000), refund('2024', 1000), refund('2023', 5000)];
  const states = { '2025': stateOf(2025), '2024': stateOf(2024), '2023': stateOf(2023, { facts: [hold(2023)] }) };
  const net = netAcrossYears(years, states)!;
  expect(net).toMatchObject({ owe: -3000, counted: ['2024', '2025'], held: ['2023'] });
  const h = headlineOf(years, states, { '2025': 'ready', '2024': 'ready', '2023': 'ready' });
  expect(h).toEqual({ kind: 'text', text: 'Across the 2024 and 2025 drafts, you get back $3,000 net, before penalties and interest. 2023 is on hold and not counted.' });
});

it('a structured filing fact marks a year on hold just as the older ruling does, and a mailed or prepared year still counts', () => {
  const filing = (state: string) => ({ local_id: '2023-FACT-filing', key: 'filing', topic: 'filing', status: 'settled', date: '2026-10-29', decision: 'x', source: 's', filing: { state, as_of: '2026-10-29', form: '1040-X' } }) as any;
  const years = [refund('2024', 1000), refund('2023', 5000)];
  expect(netAcrossYears(years, { '2024': stateOf(2024), '2023': stateOf(2023, { facts: [filing('on_hold')] }) })).toMatchObject({ counted: ['2024'], held: ['2023'], owe: -1000 });
  expect(netAcrossYears(years, { '2024': stateOf(2024), '2023': stateOf(2023, { facts: [filing('prepared')] }) })).toMatchObject({ counted: ['2023', '2024'], held: [], owe: -6000 });
  // a newer settled filing fact wins over the older ruling
  const released = { ...filing('prepared'), filing: { state: 'prepared', as_of: '2026-10-30', form: '1040-X' } };
  expect(netAcrossYears(years, { '2024': stateOf(2024), '2023': stateOf(2023, { facts: [hold(2023), released] }) })).toMatchObject({ held: [] });
});

it('the headline waits for every year\'s filing state, says so while it reads, and names a year whose state could not load', () => {
  const years = [refund('2024', 1000), refund('2023', 5000)];
  expect(headlineOf(years, { '2024': stateOf(2024) }, { '2024': 'ready' })).toEqual({ kind: 'pending' });
  const h = headlineOf(years, { '2024': stateOf(2024) }, { '2024': 'ready', '2023': 'error' });
  expect(h).toEqual({ kind: 'text', text: 'The 2024 draft says you get back $1,000, before penalties and interest. 2023: the filing state could not load, so that year is not counted.' });
  expect(headlineOf([refund('2023', 5000)], { '2023': stateOf(2023, { facts: [hold(2023)] }) }, { '2023': 'ready' }))
    .toEqual({ kind: 'text', text: 'There is no total across the drafts. 2023 is on hold and not counted.' });
  expect(headlineOf([], {}, {})).toBeNull();
});

it('the page shows no total until the filing states are read, then the total without the held year', async () => {
  const data: Closeout = { read_at: '2026-10-25T23:00:00Z', books_revised_at: null, questions: { pending_current: 0, by_resolver: {} }, years: [refund('2024', 1000), refund('2023', 5000)] };
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  fixture.rpc.mockImplementation(async (name: string, args: any) => {
    if (name === 'accounting_closeout') return { data, error: null };
    if (name === 'books_year_state') { if (args.p_year === 2023) await gate; return { data: stateOf(args.p_year, args.p_year === 2023 ? { facts: [hold(2023)] } : {}), error: null }; }
    return { data: { assessed: true, total: 0, amount: 0, rows: [] }, error: null };
  });
  await act(async () => root.render(inBook(<FinishTaxes onDrill={vi.fn()} onQuestions={vi.fn()} />)));
  expect(node.textContent).toContain("Reading each year's filing state");
  expect(node.textContent).not.toContain('you get back');
  await act(async () => { release(); });
  expect(node.textContent).toContain('The 2024 draft says you get back $1,000, before penalties and interest. 2023 is on hold and not counted.');
  expect(node.querySelector('#close-2023')?.textContent).toContain('On hold as of Oct 28, 2026: this answer is not counted in the total above.');
});

it('the docket and Finish your taxes share one read of a year\'s state', async () => {
  const data: Closeout = { read_at: '2026-10-25T23:00:00Z', books_revised_at: null, questions: { pending_current: 0, by_resolver: {} }, years: [year({})] };
  fixture.rpc.mockImplementation(async (name: string, args: any) => name === 'accounting_closeout' ? { data, error: null }
    : name === 'books_year_state' ? { data: stateOf(args.p_year), error: null } : { data: { assessed: true, total: 0, amount: 0, rows: [] }, error: null });
  const { readYearStateOnce } = await import('../../services/accountingCloseout');
  await Promise.all([readYearStateOnce(owner, '2024', '1'), readYearStateOnce(owner, '2024', '1')]);
  expect(fixture.rpc.mock.calls.filter(c => c[0] === 'books_year_state')).toHaveLength(1);
  await readYearStateOnce(owner, '2024', '2'); // the book changed: read again
  expect(fixture.rpc.mock.calls.filter(c => c[0] === 'books_year_state')).toHaveLength(2);
  fixture.rpc.mockImplementation(async () => ({ data: null, error: { code: '503' } }));
  await expect(readYearStateOnce(owner, '2023', '1')).rejects.toThrow();
  fixture.rpc.mockImplementation(async (_n: string, args: any) => ({ data: stateOf(args.p_year), error: null }));
  await expect(readYearStateOnce(owner, '2023', '1')).resolves.toMatchObject({ year: 2023 }); // a failure is not kept
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
  fixture.rpc.mockImplementation(async (name: string, args: any) => name === 'accounting_closeout' ? { data, error: null }
    : name === 'books_year_state' && args.p_year === 2024 ? { data: state, error: null }
    : name === 'accounting_closeout_records' ? { data: { assessed: true, total: 0, amount: 0, rows: [] }, error: null } : { data: null, error: { message: 'unexpected' } });
  await act(async () => root.render(inBook(<FinishTaxes onDrill={vi.fn()} onQuestions={vi.fn()} />)));
  expect(node.querySelector('.accounting-close-answer')?.textContent).toBe('You get back $300');
  expect(node.textContent).toContain('Schedule C net $301');
  expect(node.textContent).toContain('Closes with: a synthetic corrected form');
  expect(node.textContent).toContain('Settled for 2024: 1 return facts, 1 Schedule C rulings');
  expect(node.textContent).toContain('Synthetic filing status');
});

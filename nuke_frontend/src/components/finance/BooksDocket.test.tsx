// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), process: vi.fn(), tables: {} as Record<string, { data: unknown; error: unknown }> }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc, from: fixture.from, functions: { invoke: vi.fn() } } }));
vi.mock('../../services/financialEvidenceIntake', () => ({ processFinancialDocument: fixture.process }));
import BooksDocket from './BooksDocket';
import { AccountingBookContext } from './AccountingBookContext';
import { clearYearStateReads, type GateStatus, type GateYear, type LargeSumRow, type LargeSumYear, type LargeSums, type TieYear, type TierYear, type YearState } from '../../services/accountingCloseout';

// Synthetic book: every id, amount and year below is invented. The builders mimic what the database hands over; the page only prints it.
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const draft = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const rule = (id: string, status: string, n: number, of: number | null, extra: object = {}) => ({ rule: id, title: `title of ${id}`, status, n, of, amount: 0, ...extra });
const run = (rules: ReturnType<typeof rule>[], over: object = {}) => {
  const count = (f: (r: ReturnType<typeof rule>) => boolean) => rules.filter(f).length;
  const rule_counts = { total: rules.length, pass: count(r => r.status === 'pass'), fail: count(r => r.status === 'fail'), not_assessed: count(r => r.status !== 'pass' && r.status !== 'fail'),
    empty: count(r => r.status === 'pass' && r.of === 0) };
  const pass = rule_counts.fail === 0 && rule_counts.not_assessed === 0;
  return { id: 'run-1', started_at: '2026-10-29T17:30:30Z', finished_at: '2026-10-29T17:31:00Z', duration_ms: 30000, pass, stale: false, stale_books: false, stale_gate: false,
    trusted: pass && rule_counts.empty === 0, rule_counts, context: null, rules, ...over };
};
const open0 = { total: 0, owner: 0, cpa: 0, agent: 0, unassigned: 0 };
const gateYear = (year: number, over: Partial<GateYear> = {}): GateYear => ({ year, draft_document_id: draft, drafts_on_file: 1, attempt: null, run: null, open_items: open0, ...over });
const status = (years: GateYear[]): GateStatus => ({ owner_id: owner, read_at: '2026-10-29T17:40:00Z', book_signature: '10:2026', gate_md5: 'abc',
  summary: { years: years.length, with_run: years.filter(y => y.run).length, passed: 0, trusted: years.filter(y => (y.run as { trusted?: boolean } | null)?.trusted).length, failing: 0, not_assessed: 0, stale: 0,
    open_items: years.reduce((n, y) => n + y.open_items.total, 0) }, years });
const tier = (year: string, over: Partial<TierYear> = {}): TierYear => ({ year, decisions: 12, deductions: 10, total_usd: 1100, deduction_usd: 1000, a_usd: 100, b_usd: 700, c_usd: 200, a_pct: 10, b_pct: 70, c_pct: 20, a_n: 1, b_n: 7, c_n: 2,
  excluded_n: 2, excluded_usd: 100, b_nobank_n: 1, b_nobank_usd: 50, s274_needs_receipt_usd: 40, s274_uncaveated_usd: 25, no_pay_no_ruling_usd: 0, ...over });
const tie = (year: string, over: Partial<TieYear> = {}): TieYear => ({ year, decisions: 12, both_n: 2, cites_only_n: 5, cited_by_only_n: 2, cites_missing_n: 2, none_n: 1, links: 20, links_resolved: 15, tied_n: 9, amount_equal_n: 8, ...over });
const yearState = (over: Partial<YearState> = {}): YearState => ({ year: 2024, read_at: '2026-10-29T17:40:00Z', result: null, schedule_c: {}, rulings: [], facts: [], open_items: [], unmapped: [], ...over });
const filingFact = (state: string, over: object = {}) => ({ local_id: '2024-FACT-filing', key: 'filing', topic: 'filing', status: 'settled', date: '2026-10-29', decision: 'Synthetic.', source: 's',
  filing: { state, as_of: '2026-10-29', form: '1040', packet_pages: 14, packet_document_id: draft, ...over } });

const cleanRules = [rule('R1', 'pass', 0, 100), rule('R9', 'pass', 0, 18), rule('R10', 'pass', 0, 50)];
let node: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; vi.useFakeTimers(); clearYearStateReads();
  fixture.rpc.mockReset(); fixture.from.mockReset(); fixture.process.mockReset(); fixture.tables = {};
  fixture.from.mockImplementation((name: string) => {
    const q: any = {}; for (const m of ['select', 'eq', 'order']) q[m] = () => q;
    q.then = (resolve: any, reject: any) => Promise.resolve(fixture.tables[name] ?? { data: [], error: null }).then(resolve, reject);
    return q;
  });
  node = document.createElement('div'); document.body.append(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.useRealTimers(); });
const inBook = (child: React.ReactNode, ctx: { shared?: boolean; ownerId?: string } = {}) =>
  <AccountingBookContext.Provider value={{ ownerId: ctx.ownerId ?? owner, shared: ctx.shared ?? false, canCorrect: true, liveRevision: '1:rev' }}>{child}</AccountingBookContext.Provider>;
const serve = (gate: GateStatus | null, opts: { tiers?: TierYear[]; ties?: TieYear[]; states?: Record<string, YearState>; sums?: LargeSums | null } = {}) => {
  fixture.tables.v_books_audit_tier_years = { data: opts.tiers ?? [], error: null };
  fixture.tables.v_books_citation_links = { data: opts.ties ?? [], error: null };
  fixture.rpc.mockImplementation(async (name: string, args: any) =>
    name === 'books_gate_status' ? (gate ? { data: gate, error: null } : { data: null, error: { code: '57014' } })
    : name === 'books_year_state' ? { data: (opts.states ?? {})[String(args.p_year)] ?? yearState({ year: args.p_year }), error: null }
    : name === 'books_large_sum_rows' ? (opts.sums === null ? { data: null, error: { code: '57014' } } : { data: opts.sums ?? { reader: 'books_large_sum_rows', read_at: '2026-10-29T17:40:00Z', years: [] }, error: null })
    : { data: null, error: { message: 'unexpected ' + name } });
};
// The large sums start with the gate status; the slower views start 2.5 s and 5 s after it is on screen.
const mount = async (ui: React.ReactNode) => { await act(async () => root.render(ui)); await act(async () => { await vi.advanceTimersByTimeAsync(5500); }); };
const card = (year: string) => node.querySelector(`#docket-${year}`) as HTMLElement;
const text = (el: Element | null) => el?.textContent ?? '';

it('a shared book renders nothing and reads nothing', async () => {
  serve(status([gateYear(2024)]));
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />, { shared: true }));
  expect(node.textContent).toBe('');
  expect(fixture.rpc).not.toHaveBeenCalled();
  expect(fixture.from).not.toHaveBeenCalled();
});

it('reads nothing while the Books view is not the one on screen, then reads when it is', async () => {
  serve(status([gateYear(2024)]));
  await mount(inBook(<BooksDocket onOpen={vi.fn()} active={false} onDrill={vi.fn()} />));
  expect(node.textContent).toBe('');
  expect(fixture.rpc).not.toHaveBeenCalled();
  expect(fixture.from).not.toHaveBeenCalled();
  await mount(inBook(<BooksDocket onOpen={vi.fn()} active onDrill={vi.fn()} />));
  expect(fixture.rpc).toHaveBeenCalledWith('books_gate_status', { p_owner_id: owner });
  expect(card('2024')).not.toBeNull();
});

it('a year with no stored run reads Not run, and says how many years have one', async () => {
  serve(status([gateYear(2024), gateYear(2023, { run: run(cleanRules) as any })]));
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  expect(text(card('2024').querySelector('.accounting-docket-verdict'))).toBe('Not run');
  expect(text(card('2024'))).toContain('Reconciliation gate');
  expect(text(card('2024'))).toContain('Not run');
  expect(text(card('2024'))).toContain('Not checked: there is no stored gate run.');
  expect(text(node.querySelector('.k-coverage'))).toBe('1 of 2 tax years with a stored gate run');
});

it('a year trusted only when the stored run passed, is fresh and every rule checked something; the rules sit beneath with their checked counts', async () => {
  serve(status([gateYear(2024, { run: run(cleanRules) as any })]));
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  const verdict = card('2024').querySelector('.accounting-docket-verdict')!;
  expect(text(verdict)).toBe('Trusted');
  expect(verdict.getAttribute('data-state')).toBe('trusted');
  expect(text(card('2024'))).toContain('Passed, 3 of 3 rules');
  expect(text(card('2024'))).toContain('Ran Oct 29, 2026, 10:31 AM · 30 s');
  expect(text(card('2024'))).toContain('The return matches the books: rule R9, 0 failing of 18 checked, run Oct 29, 2026, 10:31 AM.');
  // every rule is a chip; with nothing wrong none is open, and opening one shows what it checked and how many failed
  expect(Array.from(card('2024').querySelectorAll('.accounting-docket-chip')).map(c => c.getAttribute('aria-label'))).toEqual(['R1: passed', 'R9: passed', 'R10: passed']);
  expect(text(card('2024'))).toContain('Every rule passed. Open one to see what it checked.');
  await act(async () => (card('2024').querySelectorAll('.accounting-docket-chip')[1] as HTMLButtonElement).click());
  expect(text(card('2024').querySelector('.accounting-docket-rule'))).toBe('R9 · title of R9 · 0 failing of 18 checked');
  expect(card('2024').querySelectorAll('.accounting-docket-chip')[1].getAttribute('aria-pressed')).toBe('true');
  await act(async () => (card('2024').querySelectorAll('.accounting-docket-chip')[1] as HTMLButtonElement).click());
  expect(card('2024').querySelector('.accounting-docket-rule')).toBeNull();
});

it('a rule that checked nothing is not a pass: it reads "nothing checked" and the year is not trusted', async () => {
  serve(status([gateYear(2024, { run: run([rule('R1', 'pass', 0, 100), rule('R2i', 'pass', 0, 0)]) as any })]));
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  expect(text(card('2024').querySelector('.accounting-docket-verdict'))).toBe('Not trusted');
  expect(text(card('2024'))).toContain('1 rule had nothing to test (0 checked): R2i');
  expect(text(card('2024'))).toContain('R2i · title of R2i · nothing checked');
  expect(text(card('2024'))).not.toContain('R2i · title of R2i · 0 failing of 0 checked');
});

it('a stale pass reads Last run passed, never plain Passed, and says what changed', async () => {
  serve(status([gateYear(2024, { run: run(cleanRules, { stale: true, stale_books: true, trusted: false }) as any }), gateYear(2023, { run: run(cleanRules, { stale: true, stale_gate: true, trusted: false }) as any })]));
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  expect(text(card('2024'))).toContain('Last run passed, 3 of 3 rules');
  expect(text(card('2024'))).not.toMatch(/(^|\s)Passed, 3 of 3/);
  expect(text(card('2024'))).toContain('Books changed since this run');
  expect(text(card('2024').querySelector('.accounting-docket-verdict'))).toBe('Not trusted');
  expect(text(card('2024'))).toContain('the last run passed, but the books changed since the run');
  expect(text(card('2023'))).toContain('The gate rules changed since this run');
  expect(text(card('2024'))).toContain('(the books or the gate changed since that run)');
});

it('failing and not-assessed rules are counted in the words of the design, and rules come back in the reader order with an invented rule kept', async () => {
  const rules = [rule('R2', 'pass', 0, 27), rule('R2i', 'pass', 0, 7), rule('R5', 'fail', 3, 170, { grades: { A: 1, B: 7, C: 4, R: 159, D: 3 }, amount: 120 }), rule('R8b', 'not_assessed', 0, 4), rule('R11', 'pass', 0, 9), rule('X1', 'pass', 0, 2)];
  serve(status([gateYear(2024, { run: run(rules) as any })]));
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  expect(text(card('2024'))).toContain('1 rule failing');
  expect(text(card('2024').querySelector('.accounting-docket-verdict'))).toBe('Not trusted');
  expect(text(card('2024'))).toContain('1 of 6 rules failing; 1 of 6 rules not assessed');
  const chips = Array.from(card('2024').querySelectorAll('.accounting-docket-chip'));
  expect(chips.map(c => c.getAttribute('aria-label'))).toEqual(['R2: passed', 'R2i: passed', 'R5: failing', 'R8b: not assessed', 'R11: passed', 'X1: passed']);
  expect(chips.map(c => c.getAttribute('data-rule-state'))).toEqual(['pass', 'pass', 'fail', 'not_assessed', 'pass', 'pass']);
  // the first rule that is not a clean pass is open to begin with
  expect(chips[2].getAttribute('aria-pressed')).toBe('true');
  expect(text(card('2024').querySelector('.accounting-docket-rule'))).toContain('R5 · title of R5 · 3 failing of 170 checked · $120');
  expect(text(card('2024'))).toContain('Evidence grades: A 1 · B 7 · C 4 · R 159 · D 3');
  await act(async () => (chips[3] as HTMLButtonElement).click());
  expect(text(card('2024').querySelector('.accounting-docket-rule'))).toBe('R8b · title of R8b · not assessed (4 in the population)');
  expect(text(card('2024'))).toContain('Not checked: rule R9 was not assessed.');
});

it('a run that did not finish says so and is not a zero; a later attempt that failed is reported beside the earlier run', async () => {
  const timedOut = { status: 'timed_out', started_at: '2026-10-29T17:30:00Z', finished_at: '2026-10-29T17:32:00Z', duration_ms: 120000 } as const;
  serve(status([gateYear(2025, { attempt: timedOut }), gateYear(2024, { run: run(cleanRules) as any, attempt: timedOut })]));
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  expect(text(card('2025').querySelector('.accounting-docket-verdict'))).toBe('Did not finish');
  expect(text(card('2025'))).toContain('Did not finish (stopped at 120 s)');
  expect(text(card('2024'))).toContain('A later run did not finish (stopped at 120 s, Oct 29, 2026, 10:32 AM)');
  expect(text(card('2024').querySelector('.accounting-docket-verdict'))).toBe('Trusted');
});

it('how the deductions are supported: tier C leads, every figure is the view\'s own column, and a percentage is printed as stored', async () => {
  // a_usd over deduction_usd would be 10 percent; the fixture stores 77.7: the page must print what is stored.
  serve(status([gateYear(2024, { run: run(cleanRules) as any })]), { tiers: [tier('2024', { a_pct: 77.7 })] });
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  const c = text(card('2024'));
  expect(c).toContain('Tier C: 2 of 10 deductions, $200, 20.0% of $1,000');
  expect(c).toContain('C · the rest: no bank line, or no cited allocation basis');
  expect(c).toContain('$100 · 77.7%');
  expect(c).not.toContain('10.0%');
  expect(c.indexOf('C · the rest')).toBeLessThan(c.indexOf('B · a bank line and a cited allocation basis'));
  expect(c.indexOf('B · a bank line and a cited allocation basis')).toBeLessThan(c.indexOf('A · a bank line, a cited allocation basis and a document'));
  expect(c).toContain('2 rows ($100) are outside this count');
  expect(c).toContain('1 tier B deduction ($50) have no bank line');
  expect(c).toContain('Section 274 lines that need a receipt and have none: $40; not caveated: $25.');
  expect(c).not.toContain('has no payment proof and no owner ruling');
  // the bars are drawn from the stored percentages themselves (A 77.7, B 70, C 20), nothing added or divided
  const widths = Array.from(card('2024').querySelectorAll('.accounting-docket-bar__fill')).map(r => r.getAttribute('width'));
  expect(widths).toEqual(['20', '70', '77.7']);
  expect(card('2024').querySelectorAll('.accounting-docket-bar')[0].getAttribute('aria-hidden')).toBe('true'); // decorative: the share is printed beside it
  expect(c).toContain('Counted apart (3)');
});

it('each tier number opens the decisions behind it in the one row list', async () => {
  const onDrill = vi.fn();
  serve(status([gateYear(2024, { run: run(cleanRules) as any })]), { tiers: [tier('2024')] });
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={onDrill} />));
  const buttons = Array.from(card('2024').querySelectorAll('button.accounting-close-item__button'));
  const click = async (startsWith: string) => act(async () => (buttons.find(b => b.textContent!.startsWith(startsWith)) as HTMLButtonElement).click());
  await click('C · the rest');
  await click('B · a bank line and a cited');
  await click('A · a bank line, a cited');
  expect(onDrill.mock.calls.map(c => c[0])).toEqual([
    { year: '2024', item: 'tier_c', label: 'Tier C deductions' }, { year: '2024', item: 'tier_b', label: 'Tier B deductions' }, { year: '2024', item: 'tier_a', label: 'Tier A deductions' }]);
  const apart = Array.from(card('2024').querySelectorAll('.accounting-docket-apart button')).map(b => b.parentElement!.textContent!);
  expect(apart).toHaveLength(3);
  expect(apart[0]).toMatch(/^1 tier B deduction \(\$50\) have no bank line/);
  expect(apart[1]).toMatch(/^Section 274 lines that need a receipt and have none/);
  expect(apart[2]).toMatch(/^2 rows \(\$100\) are outside this count/);
  await act(async () => (card('2024').querySelectorAll('.accounting-docket-apart button')[1] as HTMLButtonElement).click());
  expect(onDrill).toHaveBeenLastCalledWith({ year: '2024', item: 's274_needs_receipt', label: 'Section 274 lines that need a receipt and have none' });
});

it('a tier with nothing in it is not a button: there is nothing to open', async () => {
  serve(status([gateYear(2024, { run: run(cleanRules) as any })]), { tiers: [tier('2024', { a_n: 0, a_usd: 0, a_pct: 0 })] });
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  const buttons = Array.from(card('2024').querySelectorAll('button.accounting-close-item__button')).map(b => b.textContent!);
  expect(buttons.some(b => b.startsWith('C · the rest'))).toBe(true);
  expect(buttons.some(b => b.startsWith('A · a bank line, a cited'))).toBe(false);
  expect(text(card('2024'))).toContain('A · a bank line, a cited allocation basis and a document');
  expect(text(card('2024'))).toContain('0 of 10 deductions');
});

it('ties to a statement line: the five classes with their counts, which sum to the expenses, and the definition of a bank line', async () => {
  serve(status([gateYear(2024, { run: run(cleanRules) as any })]), { ties: [tie('2024')] });
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  const c = text(card('2024'));
  expect(c).toContain('9 of 12 expenses tie to a statement line we hold');
  const counts = Array.from(card('2024').querySelectorAll('[data-tie] b')).map(b => Number(b.textContent));
  expect(counts).toEqual([2, 5, 2, 2, 1]);
  expect(counts.reduce((a, b) => a + b, 0)).toBe(12);
  // each class is stated as n of the year's expenses
  expect(Array.from(card('2024').querySelectorAll('[data-tie]')).map(li => li.textContent!.slice(0, 11))).toEqual(['2 of 12 lin', '5 of 12 cit', '2 of 12 are', '2 of 12 cit', '1 of 12 hav']);
  expect(c).toContain('cite lines that are not in the books (15 of 20 citations point at a line we hold)');
  expect(c).toContain('8 of 9 tied expenses equal their statement lines to the cent');
});

it('the definitions are printed once for the whole docket, not on every year', async () => {
  serve(status([gateYear(2024, { run: run(cleanRules) as any }), gateYear(2023, { run: run(cleanRules) as any })]), { tiers: [tier('2024'), tier('2023')], ties: [tie('2024'), tie('2023')] });
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  const legend = text(node.querySelector('.accounting-docket-legend'));
  expect(legend).toContain('Trusted: the stored gate run passed every rule');
  expect(legend).toContain('no rule passed over zero records');
  expect(legend).toContain('A has a bank line, a cited allocation basis and a document; B has a bank line and a cited allocation basis; C is the rest.');
  expect(legend).toContain('The "no bank line" count under Finish your taxes counts only the second.');
  expect(node.textContent!.split('counts only the second').length - 1).toBe(1);
  expect(text(card('2024'))).not.toContain('By your rule');
  expect(text(card('2023'))).not.toContain('Here a bank line counts either way');
});

it('paperwork: the state from the facts with its form, pages, date and deadline; otherwise "Filing state not recorded"', async () => {
  const states = { '2024': yearState({ facts: [filingFact('prepared', { deadline: '2026-12-15' }) as any] }) };
  serve(status([gateYear(2024, { run: run(cleanRules) as any }), gateYear(2023, { run: run(cleanRules) as any })]), { states });
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  expect(text(card('2024'))).toContain('Prepared as of Oct 29, 2026');
  expect(text(card('2024'))).toContain('Form 1040 · 14 pages · deadline Dec 15, 2026');
  expect(text(card('2023'))).toContain('Filing state not recorded');
});

it('a year marked mail-ready whose gate is failing, not run or stale is flagged, and one whose gate is trusted is not', async () => {
  const states: Record<string, YearState> = {}; for (const y of ['2025', '2024', '2023', '2022']) states[y] = yearState({ facts: [filingFact('mail_ready') as any] });
  serve(status([
    gateYear(2025, { run: run([rule('R1', 'fail', 2, 100)]) as any }), gateYear(2024), gateYear(2023, { run: run(cleanRules, { stale: true, stale_books: true, trusted: false }) as any }), gateYear(2022, { run: run(cleanRules) as any }),
  ]), { states });
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  expect(text(card('2025'))).toContain('Marked mail-ready, but the gate has failing rules.');
  expect(text(card('2024'))).toContain('Marked mail-ready, but the gate has not been run.');
  expect(text(card('2023'))).toContain('Marked mail-ready, but the gate run is stale.');
  expect(text(card('2022'))).toContain('Mail-ready as of Oct 29, 2026');
  expect(text(card('2022'))).not.toContain('Marked mail-ready');
});

it('a filing state recorded for a draft that is not the newest never reads as the current state', async () => {
  const states = { '2024': yearState({ facts: [filingFact('mail_ready', { packet_document_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }) as any] }) };
  serve(status([gateYear(2024, { drafts_on_file: 3 })]), { states });
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  expect(text(card('2024'))).toContain('Recorded for an earlier draft: Mail-ready as of Oct 29, 2026');
  expect(text(card('2024'))).toContain('3 drafts on file');
  expect(text(card('2024'))).not.toContain('Marked mail-ready');
});

it('until a filing fact is recorded, the older filing-hold ruling reads as on hold, by its key and never by its text', async () => {
  const hold = { local_id: '2023-FACT-filing-hold', key: 'filing-hold', topic: 'owner_ruling', status: 'settled', date: '2026-10-28', decision: 'Anything at all.', source: 's' };
  serve(status([gateYear(2023)]), { states: { '2023': yearState({ year: 2023, facts: [hold as any] }) } });
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  expect(text(card('2023'))).toContain('On hold as of Oct 28, 2026');
  expect(text(card('2023'))).toContain('read from the filing-hold ruling');
});

it('what is open: counts by who closes them from the reader, the first "Closes with", and a button that brings the year into view', async () => {
  const states = { '2024': yearState({ open_items: [{ local_id: '2024-FACT-x', key: 'x', topic: 'other', status: 'open', date: '2026-10-29', decision: 'Open.', closes_with: 'a signed corrected form', source: 's' } as any] }) };
  serve(status([gateYear(2024, { open_items: { total: 7, owner: 3, cpa: 2, agent: 0, unassigned: 2 } }), gateYear(2023)]), { states });
  const target = document.createElement('article'); target.id = 'close-2024'; const scroll = vi.fn(); target.scrollIntoView = scroll; document.body.append(target);
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  expect(text(card('2024'))).toContain('7 return items open: you 3, your CPA 2, unassigned 2');
  expect(text(card('2024'))).not.toMatch(/books agent \d/);
  expect(text(card('2024'))).toContain('Closes with: a signed corrected form');
  expect(text(card('2023'))).toContain('No return items open');
  const go = Array.from(card('2024').querySelectorAll('button')).find(b => b.textContent!.includes('Go to 2024 in Finish your taxes')) as HTMLButtonElement;
  await act(async () => go.click());
  expect(scroll).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' });
  target.remove();
});

it('a failed gate read says so, offers a retry that reads again, and never shows a zero', async () => {
  serve(null);
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(node.querySelector('[role="alert"]')?.textContent).toContain('The books docket could not load.');
  expect(node.textContent).not.toMatch(/\b0 of 0\b|\$0\b/);
  expect(node.querySelector('.accounting-docket-year')).toBeNull();
  const before = fixture.rpc.mock.calls.filter(c => c[0] === 'books_gate_status').length;
  expect(before).toBe(2); // the read and its one automatic retry
  serve(status([gateYear(2024, { run: run(cleanRules) as any })]));
  await act(async () => (node.querySelector('[role="alert"] button') as HTMLButtonElement).click());
  await act(async () => { await vi.advanceTimersByTimeAsync(900); });
  expect(card('2024')).not.toBeNull();
});

it('a failed tier read says it could not load and offers a retry; the rest of the card still shows', async () => {
  serve(status([gateYear(2024, { run: run(cleanRules) as any })]));
  fixture.tables.v_books_audit_tier_years = { data: null, error: { code: '57014' } };
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  const c = text(card('2024'));
  expect(c).toContain('How the deductions are supported could not load.');
  expect(c).toContain('Passed, 3 of 3 rules');
  expect(c).not.toContain('Tier C:');
  expect(card('2024').querySelector('[role="alert"] button')).not.toBeNull();
});

it('while the slower views load the cheap one is already on screen; the large sums start with it and the two views follow one after the other', async () => {
  serve(status([gateYear(2024, { run: run(cleanRules) as any })]), { tiers: [tier('2024')] });
  await act(async () => root.render(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />)));
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  expect(text(card('2024'))).toContain('Passed, 3 of 3 rules');
  expect(text(card('2024'))).toContain('Reading how the deductions are supported…');
  expect(text(card('2024'))).not.toContain('Tier C:');
  expect(fixture.rpc.mock.calls.map(c => c[0])).toContain('books_large_sum_rows'); // the first screen is asked for with the gate status
  expect(fixture.from).not.toHaveBeenCalled(); // neither slow view has been asked for yet
  await act(async () => { await vi.advanceTimersByTimeAsync(2600); });
  expect(fixture.from.mock.calls.map(c => c[0])).toEqual(['v_books_audit_tier_years']);
  expect(text(card('2024'))).toContain('Tier C:');
  await act(async () => { await vi.advanceTimersByTimeAsync(2600); });
  expect(fixture.from.mock.calls.map(c => c[0])).toEqual(['v_books_audit_tier_years', 'v_books_citation_links']);
});

it('every time is printed on the owner\'s Pacific clock and the read is dated', async () => {
  serve(status([gateYear(2024, { run: run(cleanRules, { finished_at: '2026-10-29T01:05:00Z' }) as any })]));
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  expect(text(card('2024'))).toContain('Ran Oct 28, 2026, 6:05 PM');
  expect(text(node.querySelector('.accounting-docket'))).toContain('Read Oct 29, 2026, 10:40 AM: gate runs (books_gate_runs)');
});

it('another book never shows the first book\'s answer', async () => {
  serve(status([gateYear(2024, { run: run(cleanRules) as any })]));
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  expect(card('2024')).not.toBeNull();
  serve(status([gateYear(2021)]));
  await act(async () => root.render(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />, { ownerId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })));
  expect(card('2024')).toBeNull();
});


// ── The first screen: the paper the books still need ───────────────────────────────────────────────────────────────────────

const largeRow = (n: number, over: Partial<LargeSumRow> = {}): LargeSumRow => ({ year: '2024', id: `id-${n}`, document_id: `doc-${n}`, local_id: `L${n}`, dollar_rank: n, amount: 5000 - n * 100, share: 0.01,
  cum_share: 0.01, category: 'Synthetic category', tier: 'B', pay_proof: true, doc_proof: false, basis_strength: 'bank_and_rule', proof_flag: null, required_doc_kind: 'invoice_or_agreement',
  required_doc_rule: 'contractor', missing_doc: true, doc_found_n: 0, doc_cited_n: 0, cites: [],
  record: { record_kind: 'retained_ledger_decision', local_id: `L${n}`, year: '2024', date: '2024-02-0' + n, account: 'Synthetic', section: 'Expense', category: 'Synthetic category', amount: '4800.00', currency: 'USD',
    description: `Payee ${n} — work ${n}`, status: 'Synthetic', source_key: String(n).repeat(64) } as any, attached: [], ...over });
const largeYear = (rows: LargeSumRow[], over: Partial<LargeSumYear> = {}): LargeSumYear => ({ year: '2024', year_usd: 20000, deductions_n: 90, head_n: 30, head_usd: 16000, flagged_n: rows.length, flagged_usd: 9000,
  missing_doc_n: rows.filter(r => r.missing_doc).length, missing_doc_usd: 8000, no_payment_n: 0, no_payment_usd: 0, filed_return_only_n: 0, filed_return_only_usd: 0, beyond_head_missing_doc_n: 0,
  beyond_head_missing_doc_usd: 0, rows_shown: rows.length, rows, ...over });
const sumsOf = (...years: LargeSumYear[]): LargeSums => ({ read_at: '2026-10-29T17:40:00Z', years } as LargeSums);
const stored = (over: object = {}) => run([rule('R10', 'fail', 12, 200), rule('R12', 'fail', 2, 30, { missing_doc: { n: 2, amount: 8000, cite_no_document: 1, by_kind: { invoice_or_agreement: { n: 2, amount: 8000 } } } })],
  { context: { deductions: { n: 200, usd: 150000 }, no_bank: { n: 30, usd: 20000 }, no_pay_no_ruling: { n: 12, usd: 9000 }, head: { n: 30, usd: 16000, year_usd: 20000 } }, ...over });

it('the card opens on the paper: the two stored totals, then the live rows, then the gate and what stands behind it', async () => {
  serve(status([gateYear(2024, { run: stored() as any })]), { sums: sumsOf(largeYear([largeRow(1), largeRow(2)])), tiers: [tier('2024')] });
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  const c = text(card('2024'));
  const at = ['Paid outside a linked bank line', 'Missing a document', 'Large sums that need paper', 'Reconciliation gate', 'How the deductions are supported'].map(label => c.indexOf(label));
  expect(at.every(i => i >= 0)).toBe(true);
  expect(at).toEqual([...at].sort((a, b) => a - b));
  expect(c).toContain('$9,000 of $150,000 in deductions');
  expect(c).toContain('$8,000 of $16,000 in the 30 largest deductions');
  expect(c).toContain('Payee 1 — work 1');
  expect(c).toContain('Needs: Contractor invoice');
  expect(fixture.rpc).toHaveBeenCalledWith('books_large_sum_rows', { p_owner_id: owner });
  expect(text(node.querySelector('.accounting-docket'))).toMatch(/Large sums \(v_books_large_sums\) read [A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2} (AM|PM)\./);
});

it('a failed read of the large sums says so with a retry and never shows zero rows; the rest of the card still shows', async () => {
  serve(status([gateYear(2024, { run: stored() as any })]), { sums: null, tiers: [tier('2024')] });
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  const c = text(card('2024'));
  expect(c).toContain('The large sums could not load.');
  expect(c).not.toContain('No large sum is flagged');
  expect(c).not.toContain('0 rows need a document');
  expect(c).toContain('Reconciliation gate');
  expect(c).toContain('$8,000 of $16,000 in the 30 largest deductions'); // the stored totals do not depend on the live list
  serve(status([gateYear(2024, { run: stored() as any })]), { sums: sumsOf(largeYear([largeRow(1)])), tiers: [tier('2024')] });
  await act(async () => { (card('2024').querySelector('[role="alert"] button') as HTMLButtonElement).click(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(10); });
  expect(text(card('2024'))).toContain('Payee 1 — work 1');
});

it('adding the paper re-reads the list; the row that was answered shows its attached file and stays until the books writer cites it', async () => {
  const before = largeYear([largeRow(1), largeRow(2)]);
  serve(status([gateYear(2024, { run: stored() as any })]), { sums: sumsOf(before) });
  fixture.process.mockResolvedValue({ documentId: 'new-doc', status: 'blocked', reused: false, readback: {}, linked: { field_key: 'k', already: false } });
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  const reads = () => fixture.rpc.mock.calls.filter(c => c[0] === 'books_large_sum_rows').length;
  expect(reads()).toBe(1);
  const firstRow = card('2024').querySelector('.accounting-paper-row') as HTMLElement;
  await act(async () => { (Array.from(firstRow.querySelectorAll('button')).find(b => b.textContent === 'Add the invoice') as HTMLButtonElement).click(); });
  const input = firstRow.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [new File(['x'], 'invoice-1.pdf', { type: 'application/pdf' })], configurable: true });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  const after = largeYear([largeRow(1, { attached: [{ document_id: 'new-doc', filename: 'invoice-1.pdf', doc_kind: 'Invoice', ref: 'r', attached_at: '2026-10-29T19:12:00Z' }] }), largeRow(2)]);
  serve(status([gateYear(2024, { run: stored() as any })]), { sums: sumsOf(after) });
  await act(async () => { (Array.from(firstRow.querySelectorAll('button')).find(b => b.textContent === 'Add to this row') as HTMLButtonElement).click(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(10); });
  expect(reads()).toBe(2);
  const again = card('2024').querySelector('.accounting-paper-row') as HTMLElement;
  expect(text(again)).toContain('Invoice · invoice-1.pdf · attached Oct 29, 2026, 12:12 PM');
  expect(text(again)).toContain('Document received, link pending');
  expect(card('2024').querySelectorAll('.accounting-paper-row')).toHaveLength(2);
});

it('a year with deductions but no return draft or stored run still gets its card; a stored count that the live list has moved on from is said, with both numbers', async () => {
  serve(status([gateYear(2024, { run: stored() as any })]), { sums: sumsOf(largeYear([largeRow(1)], { missing_doc_n: 1 }), largeYear([largeRow(5, { year: '2021' })], { year: '2021' })) });
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  expect(card('2021')).not.toBeNull();
  expect(text(card('2021'))).toContain('Not run');
  expect(text(card('2021'))).toContain('Payee 5 — work 5');
  expect(Array.from(node.querySelectorAll('.accounting-docket-year')).map(el => el.id)).toEqual(['docket-2024', 'docket-2021']);
  expect(text(card('2024'))).toContain('The gate run of Oct 29, 2026, 10:31 AM counted 2 rows missing a document; the list now has 1.');
});

it('opening a row opens that record\'s evidence', async () => {
  const onOpen = vi.fn(); const r = largeRow(1);
  serve(status([gateYear(2024, { run: stored() as any })]), { sums: sumsOf(largeYear([r])) });
  await mount(inBook(<BooksDocket onOpen={onOpen} onDrill={vi.fn()} />));
  await act(async () => { (card('2024').querySelector('.accounting-paper-row .accounting-link-button') as HTMLButtonElement).click(); });
  expect(onOpen).toHaveBeenCalledWith('doc-1', r.record);
});


it('Read again reads the stored runs and the live rows again, and never runs the gate', async () => {
  serve(status([gateYear(2024, { run: stored() as any })]), { sums: sumsOf(largeYear([largeRow(1)])), tiers: [tier('2024')] });
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  const calls = (name: string) => fixture.rpc.mock.calls.filter(c => c[0] === name).length;
  expect([calls('books_gate_status'), calls('books_large_sum_rows')]).toEqual([1, 1]);
  const again = Array.from(node.querySelectorAll('.accounting-docket .accounting-section-heading button')).find(b => b.textContent === 'Read again') as HTMLButtonElement;
  await act(async () => again.click());
  await act(async () => { await vi.advanceTimersByTimeAsync(5500); });
  expect([calls('books_gate_status'), calls('books_large_sum_rows')]).toEqual([2, 2]);
  expect(fixture.rpc.mock.calls.some(c => c[0] === 'books_year_gate')).toBe(false);
  expect(text(card('2024'))).toContain('Payee 1 — work 1');
});


it('the dollars paid outside a linked bank line open the deductions behind them through the docket\'s drill', async () => {
  const onDrill = vi.fn();
  serve(status([gateYear(2024, { run: stored() as any })]), { sums: sumsOf(largeYear([largeRow(1)])) });
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={onDrill} />));
  const first = card('2024').querySelector('.accounting-close-item .accounting-paper-total')!.closest('button')!;
  await act(async () => first.click());
  expect(onDrill).toHaveBeenCalledWith({ year: '2024', item: 'no_pay_no_ruling', label: 'Paid outside a linked bank line' });
});

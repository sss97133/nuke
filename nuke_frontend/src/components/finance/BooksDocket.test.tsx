// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), process: vi.fn(), tables: {} as Record<string, { data: unknown; error: unknown }> }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc, from: fixture.from, functions: { invoke: vi.fn() }, auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } } }));
// The words of the intake stay; the work is replaced.
vi.mock('../../services/financialEvidenceIntake', async importOriginal => ({ ...(await importOriginal<typeof import('../../services/financialEvidenceIntake')>()), processFinancialDocument: fixture.process }));
import BooksDocket from './BooksDocket';
import { AccountingBookContext } from './AccountingBookContext';
import type { GateStatus, LargeSums, TieYear, TierYear, YearState } from '../../services/accountingCloseout';
import {
  answer, cleanRules, filingFact, freshClient, gateYear, inQuery, largeRow, largeYear, owner, rule, run, status, storedRun, sumsOf, tableRead, tier, tie, yearState,
} from './__fixtures__/books';

let node: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-29T18:00:00Z')); client = freshClient();
  fixture.rpc.mockReset(); fixture.from.mockReset(); fixture.process.mockReset(); fixture.tables = {};
  fixture.from.mockImplementation((name: string) => tableRead(() => fixture.tables[name] ?? { data: [], error: null }));
  node = document.createElement('div'); document.body.append(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.useRealTimers(); client.clear(); });
const inBook = (child: React.ReactNode, ctx: { shared?: boolean; ownerId?: string; liveRevision?: string } = {}) => inQuery(client,
  <AccountingBookContext.Provider value={{ ownerId: ctx.ownerId ?? owner, shared: ctx.shared ?? false, canCorrect: true, liveRevision: ctx.liveRevision ?? '1:rev' }}>{child}</AccountingBookContext.Provider>);
type Served = { tiers?: TierYear[]; ties?: TieYear[]; states?: Record<string, YearState>; sums?: LargeSums | null; seen?: AbortSignal[] };
const serve = (gate: GateStatus | null, opts: Served = {}) => {
  fixture.tables.v_books_audit_tier_years = { data: opts.tiers ?? [], error: null };
  fixture.tables.v_books_citation_links = { data: opts.ties ?? [], error: null };
  fixture.rpc.mockImplementation((name: string, args: any) => answer(
    name === 'books_gate_status' ? (gate ? { data: gate, error: null } : { data: null, error: { code: '57014' } })
    : name === 'books_year_state' ? { data: (opts.states ?? {})[String(args.p_year)] ?? yearState({ year: args.p_year }), error: null }
    : name === 'books_large_sum_rows' ? (opts.sums === null ? { data: null, error: { code: '57014' } } : { data: opts.sums ?? { reader: 'books_large_sum_rows', read_at: '2026-10-29T17:40:00Z', years: [] }, error: null })
    : { data: null, error: { message: 'unexpected ' + name } }, opts.seen));
};
const calls = (name: string) => fixture.rpc.mock.calls.filter(c => c[0] === name).length;
const fromCalls = (name: string) => fixture.from.mock.calls.filter(c => c[0] === name).length;
// The gate status comes first; the large sums start 0.5 s after it, the deduction view at 2.5 s and the tie view at 5 s.
// Time passes in steps of 100 ms, each its own act: a staggered read starts from a state change, and React flushes a state change at the end of an act.
const later = async (ms: number) => { for (let left = ms; left > 0; left -= 100) await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(100, left)); }); };
const mount = async (ui: React.ReactNode) => { await act(async () => root.render(ui)); await later(5500); };
const card = (year: string) => node.querySelector(`#docket-${year}`) as HTMLElement;
const text = (el: Element | null) => el?.textContent ?? '';
const chips = (year: string) => Array.from(card(year).querySelectorAll('.accounting-chips button')) as HTMLButtonElement[];

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

it('a year with no stored run reads Not run, and says how many years have one and when they were read', async () => {
  serve(status([gateYear(2024), gateYear(2023, { run: run(cleanRules) })]));
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  expect(text(card('2024').querySelector('.accounting-docket-verdict'))).toBe('Not run');
  expect(text(card('2024'))).toContain('Reconciliation gate');
  expect(text(card('2024'))).toContain('Not run');
  expect(text(card('2024'))).toContain('Not checked: there is no stored gate run.');
  expect(text(node.querySelector('.k-coverage'))).toBe('1 of 2 tax years with a stored gate run · Oct 29, 2026');
});

it('a year trusted only when the stored run passed, is fresh and every rule checked something; the rules sit beneath as the office\'s chips with their checked counts', async () => {
  serve(status([gateYear(2024, { run: run(cleanRules) })]));
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  const verdict = card('2024').querySelector('.accounting-docket-verdict')!;
  expect(text(verdict)).toBe('Trusted');
  expect(verdict.getAttribute('data-state')).toBe('trusted');
  expect(verdict.getAttribute('data-tone')).toBe('good');
  expect(card('2024').getAttribute('data-tone')).toBe('good');
  expect(text(card('2024'))).toContain('Passed, 3 of 3 rules');
  expect(text(card('2024'))).toContain('Ran Oct 29, 2026, 10:31 AM · 30 s');
  expect(text(card('2024'))).toContain('The return matches the books: rule R9, 0 failing of 18 checked, run Oct 29, 2026, 10:31 AM.');
  // every rule is a chip of the office's own chip row; with nothing wrong none is open, and opening one shows what it checked and how many failed
  expect(chips('2024').map(c => c.getAttribute('aria-label'))).toEqual(['R1: passed', 'R9: passed', 'R10: passed']);
  expect(chips('2024').map(c => c.getAttribute('data-tone'))).toEqual(['good', 'good', 'good']);
  expect(card('2024').querySelector('.accounting-docket-chip')).toBeNull();
  expect(text(card('2024'))).toContain('Every rule passed. Open one to see what it checked.');
  await act(async () => chips('2024')[1].click());
  expect(text(card('2024').querySelector('.accounting-docket-rule'))).toBe('R9 · title of R9 · 0 failing of 18 checked');
  expect(chips('2024')[1].getAttribute('aria-pressed')).toBe('true');
  await act(async () => chips('2024')[1].click());
  expect(card('2024').querySelector('.accounting-docket-rule')).toBeNull();
});

it('a rule that checked nothing is not a pass: it reads "nothing checked" and the year is not trusted', async () => {
  serve(status([gateYear(2024, { run: run([rule('R1', 'pass', 0, 100), rule('R2i', 'pass', 0, 0)]) })]));
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  expect(text(card('2024').querySelector('.accounting-docket-verdict'))).toBe('Not trusted');
  expect(card('2024').getAttribute('data-tone')).toBe('bad');
  expect(text(card('2024'))).toContain('1 rule had nothing to test (0 checked): R2i');
  expect(text(card('2024'))).toContain('R2i · title of R2i · nothing checked');
  expect(text(card('2024'))).not.toContain('R2i · title of R2i · 0 failing of 0 checked');
});

it('a stale pass reads Last run passed, never plain Passed, and says what changed', async () => {
  serve(status([gateYear(2024, { run: run(cleanRules, { stale: true, stale_books: true, trusted: false }) }), gateYear(2023, { run: run(cleanRules, { stale: true, stale_gate: true, trusted: false }) })]));
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
  serve(status([gateYear(2024, { run: run(rules) })]));
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  expect(text(card('2024'))).toContain('1 rule failing');
  expect(text(card('2024').querySelector('.accounting-docket-verdict'))).toBe('Not trusted');
  expect(text(card('2024'))).toContain('1 of 6 rules failing; 1 of 6 rules not assessed');
  expect(chips('2024').map(c => c.getAttribute('aria-label'))).toEqual(['R2: passed', 'R2i: passed', 'R5: failing', 'R8b: not assessed', 'R11: passed', 'X1: passed']);
  expect(chips('2024').map(c => c.getAttribute('data-rule-state'))).toEqual(['pass', 'pass', 'fail', 'not_assessed', 'pass', 'pass']);
  expect(chips('2024').map(c => c.getAttribute('data-tone'))).toEqual(['good', 'good', 'bad', 'warn', 'good', 'good']);
  // the first rule that is not a clean pass is open to begin with
  expect(chips('2024')[2].getAttribute('aria-pressed')).toBe('true');
  expect(text(card('2024').querySelector('.accounting-docket-rule'))).toContain('R5 · title of R5 · 3 failing of 170 checked · $120');
  expect(card('2024').querySelector('.accounting-docket-rule')!.getAttribute('data-tone')).toBe('bad');
  expect(text(card('2024'))).toContain('Evidence grades: A 1 · B 7 · C 4 · R 159 · D 3');
  await act(async () => chips('2024')[3].click());
  expect(text(card('2024').querySelector('.accounting-docket-rule'))).toBe('R8b · title of R8b · not assessed (4 in the population)');
  expect(text(card('2024'))).toContain('Not checked: rule R9 was not assessed.');
});

it('a run that did not finish says so and is not a zero; a later attempt that failed is reported beside the earlier run', async () => {
  const timedOut = { status: 'timed_out', started_at: '2026-10-29T17:30:00Z', finished_at: '2026-10-29T17:32:00Z', duration_ms: 120000 } as const;
  serve(status([gateYear(2025, { attempt: timedOut }), gateYear(2024, { run: run(cleanRules), attempt: timedOut })]));
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  expect(text(card('2025').querySelector('.accounting-docket-verdict'))).toBe('Did not finish');
  expect(text(card('2025'))).toContain('Did not finish (stopped at 120 s)');
  expect(text(card('2024'))).toContain('A later run did not finish (stopped at 120 s, Oct 29, 2026, 10:32 AM)');
  expect(text(card('2024').querySelector('.accounting-docket-verdict'))).toBe('Trusted');
});

it('how the deductions are supported: tier C leads, every figure is the view\'s own column, and a percentage is printed as stored', async () => {
  // a_usd over deduction_usd would be 10 percent; the fixture stores 77.7: the page must print what is stored.
  serve(status([gateYear(2024, { run: run(cleanRules) })]), { tiers: [tier('2024', { a_pct: 77.7 })] });
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  const c = text(card('2024'));
  expect(c).toContain('Tier C: 2 of 10 deductions, $200, 20.0% of $1,000 net of credits');
  expect(c).toContain('C · the rest: no bank line, or no cited allocation basis');
  expect(c).toContain('$100 · 77.7%');
  expect(c).not.toContain('10.0%');
  expect(c.indexOf('C · the rest')).toBeLessThan(c.indexOf('B · a bank line and a cited allocation basis'));
  expect(c.indexOf('B · a bank line and a cited allocation basis')).toBeLessThan(c.indexOf('A · a bank line, a cited allocation basis and a document'));
  expect(c).toContain('2 rows ($100) are outside this count');
  expect(c).toContain('1 tier B deduction ($50) have no bank line');
  expect(c).toContain('Section 274 lines that need a receipt and have none: $40 of $400 in section 274 lines; not caveated: $25.');
  expect(c).not.toContain('has no payment proof and no owner ruling');
  // the bars are drawn from the stored percentages themselves (A 77.7, B 70, C 20), nothing added or divided
  const widths = Array.from(card('2024').querySelectorAll('.k-share-bar__fill')).map(r => r.getAttribute('width'));
  expect(widths).toEqual(['20', '70', '77.7']);
  expect(card('2024').querySelectorAll('.k-share-bar')[0].getAttribute('aria-hidden')).toBe('true'); // decorative: the share is printed beside it
  expect(card('2024').querySelector('.accounting-docket-bar')).toBeNull();
  expect(c).toContain('Counted apart (3)');
});

it('each tier number opens the decisions behind it in the one row list', async () => {
  const onDrill = vi.fn();
  serve(status([gateYear(2024, { run: run(cleanRules) })]), { tiers: [tier('2024')] });
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
  serve(status([gateYear(2024, { run: run(cleanRules) })]), { tiers: [tier('2024', { a_n: 0, a_usd: 0, a_pct: 0 })] });
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  const buttons = Array.from(card('2024').querySelectorAll('button.accounting-close-item__button')).map(b => b.textContent!);
  expect(buttons.some(b => b.startsWith('C · the rest'))).toBe(true);
  expect(buttons.some(b => b.startsWith('A · a bank line, a cited'))).toBe(false);
  expect(text(card('2024'))).toContain('A · a bank line, a cited allocation basis and a document');
  expect(text(card('2024'))).toContain('0 of 10 deductions');
});

it('ties to a statement line are folded away: closed to begin with, the five classes with their counts (which sum to the expenses), the citation tally on its own line, and the definition of a bank line', async () => {
  serve(status([gateYear(2024, { run: run(cleanRules) })]), { ties: [tie('2024')] });
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  const fold = card('2024').querySelector('.accounting-docket-ties')!.closest('details') as HTMLDetailsElement;
  expect(fold.open).toBe(false);
  expect(text(fold.querySelector('summary'))).toBe('Ties to a statement line 9 of 12 expenses tie to a statement line we hold');
  const counts = Array.from(card('2024').querySelectorAll('[data-tie] b')).map(b => Number(b.textContent));
  expect(counts).toEqual([2, 5, 2, 2, 1]);
  expect(counts.reduce((a, b) => a + b, 0)).toBe(12);
  // each class is stated as n of the year's expenses
  expect(Array.from(card('2024').querySelectorAll('[data-tie]')).map(li => li.textContent!.slice(0, 11))).toEqual(['2 of 12 lin', '5 of 12 cit', '2 of 12 are', '2 of 12 cit', '1 of 12 hav']);
  const c = text(card('2024'));
  expect(c).toContain('15 of 20 citations written point at a statement line we hold');
  expect(text(card('2024').querySelector('[data-tie="cites_missing"]'))).toBe('2 of 12 cite lines that are not in the books');
  expect(c).toContain('8 of 9 tied expenses equal their statement lines to the cent');
});

it('the definitions are printed once for the whole docket, not on every year', async () => {
  serve(status([gateYear(2024, { run: run(cleanRules) }), gateYear(2023, { run: run(cleanRules) })]), { tiers: [tier('2024'), tier('2023')], ties: [tie('2024'), tie('2023')] });
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  const legend = text(node.querySelector('.accounting-docket-legend'));
  expect(legend).toContain('Trusted: the stored gate run passed every rule');
  expect(legend).toContain('no rule passed over zero records');
  expect(legend).toContain('A has a bank line, a cited allocation basis and a document; B has a bank line and a cited allocation basis; C is the rest.');
  expect(legend).toContain('The "no bank line" count under Finish your taxes counts only the second.');
  expect(legend).toContain('net of credits');
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
  await later(2000);
  expect(node.querySelector('[role="alert"]')?.textContent).toContain('The books docket could not load.');
  expect(node.textContent).not.toMatch(/\b0 of 0\b|\$0\b/);
  expect(node.querySelector('.accounting-docket-year')).toBeNull();
  expect(calls('books_gate_status')).toBe(2); // the read and its one automatic retry
  serve(status([gateYear(2024, { run: run(cleanRules) })]));
  await act(async () => (node.querySelector('[role="alert"] button') as HTMLButtonElement).click());
  await later(900);
  expect(card('2024')).not.toBeNull();
});

it('a failed tier read says it could not load and offers a retry; the total that rests on it says so and states no dollars; the rest of the card still shows', async () => {
  serve(status([gateYear(2024, { run: run(cleanRules) })]));
  fixture.tables.v_books_audit_tier_years = { data: null, error: { code: '57014' } };
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  await later(2000);
  const c = text(card('2024'));
  expect(c).toContain('How the deductions are supported could not load.');
  expect(c).toContain('Passed, 3 of 3 rules');
  expect(c).not.toContain('Tier C:');
  expect(c).toContain('No bank line, no owner ruling, no ruleCould not load');
  expect(card('2024').querySelector('[role="alert"] button')).not.toBeNull();
});

it('the large sums start 0.5 s behind the gate status, the deduction view at 2.5 s and the tie view at 5 s: a loaded database sees a trickle, not a burst', async () => {
  serve(status([gateYear(2024, { run: run(cleanRules) })]), { tiers: [tier('2024')] });
  await act(async () => root.render(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />)));
  await later(50);
  expect(text(card('2024'))).toContain('Passed, 3 of 3 rules');
  expect(text(card('2024'))).toContain('Reading how the deductions are supported…');
  expect(text(card('2024'))).not.toContain('Tier C:');
  expect(calls('books_gate_status')).toBe(1);
  expect(calls('books_large_sum_rows')).toBe(0); // the gate status paints first
  expect(fixture.from).not.toHaveBeenCalled();
  await later(500);
  expect(calls('books_large_sum_rows')).toBe(1);
  expect(fixture.from).not.toHaveBeenCalled();
  await later(2100);
  expect(fixture.from.mock.calls.map(c => c[0])).toEqual(['v_books_audit_tier_years']);
  expect(text(card('2024'))).toContain('Tier C:');
  await later(2600);
  expect(fixture.from.mock.calls.map(c => c[0])).toEqual(['v_books_audit_tier_years', 'v_books_citation_links']);
});

it('every time is printed on the owner\'s Pacific clock and the read is dated', async () => {
  serve(status([gateYear(2024, { run: run(cleanRules, { finished_at: '2026-10-29T01:05:00Z' }) })]));
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  expect(text(card('2024'))).toContain('Ran Oct 28, 2026, 6:05 PM');
  expect(text(node.querySelector('.accounting-docket'))).toContain('Read Oct 29, 2026, 10:40 AM: gate runs (books_gate_runs)');
});

it('another book never shows the first book\'s answer', async () => {
  serve(status([gateYear(2024, { run: run(cleanRules) })]));
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  expect(card('2024')).not.toBeNull();
  serve(status([gateYear(2021)]));
  await act(async () => root.render(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />, { ownerId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })));
  expect(card('2024')).toBeNull();
});

// ── The first screen: the paper the books still need ───────────────────────────────────────────────────────────────────────

it('the card opens on the paper: the two totals, read live from the same rows that open beneath them, then the rows, then the gate and what stands behind it', async () => {
  serve(status([gateYear(2024, { run: storedRun() })]), { sums: sumsOf(largeYear([largeRow(1), largeRow(2)])), tiers: [tier('2024', { no_pay_no_ruling_usd: 9000, deduction_usd: 150000 })] });
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  const c = text(card('2024'));
  const at = ['No bank line, no owner ruling, no rule', 'Large deductions missing their document', 'Large sums that need paper', 'Reconciliation gate', 'How the deductions are supported'].map(label => c.indexOf(label));
  expect(at.every(i => i >= 0)).toBe(true);
  expect(at).toEqual([...at].sort((a, b) => a - b));
  expect(c).toContain('$9,000 of $150,000 in deductions, net of credits');
  expect(c).toContain('Rule R10 part b, read live from v_books_audit_tier_years');
  expect(c).toContain('$8,000 of $16,000 in the 30 largest deductions');
  expect(c).toContain('Rule R12, read live from v_books_large_sums');
  expect(c).toContain('This counts missing paper.');
  expect(c).toContain('Payee 1 — work 1');
  expect(c).toContain('Needs: Contractor invoice');
  expect(fixture.rpc).toHaveBeenCalledWith('books_large_sum_rows', { p_owner_id: owner });
  expect(text(node.querySelector('.accounting-docket'))).toMatch(/Large sums \(v_books_large_sums\) read [A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2} (AM|PM)\./);
  // the first number on the card and the rows under it are one answer: the totals do not come from the stored run
  expect(c).not.toContain('from the gate run');
});

it('where the stored run counted differently from the live rows now, the card says so with both numbers, and the live ones head it', async () => {
  const live = largeYear([largeRow(1)], { missing_doc_n: 1, missing_doc_usd: 4900, head_usd: 16000 });
  serve(status([gateYear(2024, { run: storedRun() })]), { sums: sumsOf(live), tiers: [tier('2024', { no_pay_no_ruling_usd: 6556, deduction_usd: 150000 })] });
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  const c = text(card('2024'));
  expect(c).toContain('$4,900 of $16,000 in the 30 largest deductions');
  expect(c).toContain('The gate run of Oct 29, 2026, 10:31 AM counted 2 rows missing a document ($8,000); the list now has 1 ($4,900).');
  expect(c).toContain('The gate run of Oct 29, 2026, 10:31 AM counted $9,000 (12 deductions) with no bank line, no owner ruling and no rule; the deductions now stand at $6,556.');
  expect(c).toContain('$6,556 of $150,000 in deductions, net of credits');
});

it('a failed read of the large sums says so with a retry and never shows zero rows or a made-up total; the rest of the card still shows', async () => {
  serve(status([gateYear(2024, { run: storedRun() })]), { sums: null, tiers: [tier('2024')] });
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  await later(2000);
  const c = text(card('2024'));
  expect(c).toContain('The large sums could not load.');
  expect(c).not.toContain('No large sum is flagged');
  expect(c).not.toContain('0 rows need a document');
  expect(c).toContain('Reconciliation gate');
  expect(c).toContain('Large deductions missing their documentCould not load');
  expect(c).not.toContain('$8,000 of $16,000'); // the stored run is not a stand-in for the live read
  serve(status([gateYear(2024, { run: storedRun() })]), { sums: sumsOf(largeYear([largeRow(1)])), tiers: [tier('2024')] });
  await act(async () => { (card('2024').querySelector('[role="alert"] button') as HTMLButtonElement).click(); });
  await later(10);
  expect(text(card('2024'))).toContain('Payee 1 — work 1');
});

it('a read that never answers ends as "could not load" after its bound, and is tried once more', async () => {
  serve(status([gateYear(2024, { run: storedRun() })]));
  const stalled: AbortSignal[] = [];
  fixture.rpc.mockImplementation((name: string) => name === 'books_large_sum_rows'
    ? Object.assign(new Promise(() => undefined), { abortSignal(signal: AbortSignal) { stalled.push(signal); return this; } })
    : answer(name === 'books_gate_status' ? { data: status([gateYear(2024, { run: storedRun() })]), error: null } : { data: yearState(), error: null }));
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  expect(text(card('2024'))).toContain('Reading the large sums…');
  expect(stalled).toHaveLength(1);
  await later(21000);
  expect(stalled[0].aborted).toBe(true); // 20 s after it began
  expect(stalled).toHaveLength(2); // and the one retry has begun
  expect(text(card('2024'))).toContain('Reading the large sums…');
  await later(18000);
  expect(stalled[1].aborted).toBe(true);
  expect(stalled).toHaveLength(2);
  expect(text(card('2024'))).toContain('The large sums could not load.');
});

it('a row the page cannot read is left out and said, with the year\'s totals intact', async () => {
  const sums = sumsOf(largeYear([largeRow(1), largeRow(2, { record: null as any })]));
  fixture.rpc.mockImplementation((name: string) => answer(name === 'books_gate_status' ? { data: status([gateYear(2024, { run: storedRun() })]), error: null }
    : name === 'books_large_sum_rows' ? { data: { ...sums, years: sums.years.map(y => ({ ...y, rows_shown: 2 })) }, error: null } : { data: yearState(), error: null }));
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  expect(card('2024').querySelectorAll('.accounting-paper-row')).toHaveLength(1);
  expect(text(card('2024'))).toContain('1 row of the answer could not be read and is not listed; the totals count it.');
  expect(text(card('2024'))).toContain('$8,000 of $16,000 in the 30 largest deductions');
});

it('adding the paper re-reads the list; the row that was answered shows its attached file and stays until the books writer cites it', async () => {
  const before = largeYear([largeRow(1), largeRow(2)]);
  serve(status([gateYear(2024, { run: storedRun() })]), { sums: sumsOf(before) });
  fixture.process.mockResolvedValue({ documentId: 'new-doc', status: 'blocked', reused: false, readback: {}, linked: { field_key: 'k', already: false } });
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  expect(calls('books_large_sum_rows')).toBe(1);
  const firstRow = card('2024').querySelector('.accounting-paper-row') as HTMLElement;
  await act(async () => { (Array.from(firstRow.querySelectorAll('button')).find(b => b.textContent === 'Add the invoice') as HTMLButtonElement).click(); });
  const input = firstRow.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [new File(['x'], 'invoice-1.pdf', { type: 'application/pdf' })], configurable: true });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  const after = largeYear([largeRow(1, { attached: [{ document_id: 'new-doc', filename: 'invoice-1.pdf', doc_kind: 'Invoice', ref: 'r', attached_at: '2026-10-29T19:12:00Z' }] }), largeRow(2)]);
  serve(status([gateYear(2024, { run: storedRun() })]), { sums: sumsOf(after) });
  await act(async () => { (Array.from(firstRow.querySelectorAll('button')).find(b => b.textContent === 'Add to this row') as HTMLButtonElement).click(); });
  await later(10);
  expect(calls('books_large_sum_rows')).toBe(2);
  const again = card('2024').querySelector('.accounting-paper-row') as HTMLElement;
  expect(text(again)).toContain('Invoice · invoice-1.pdf · attached Oct 29, 2026, 12:12 PM');
  expect(text(again)).toContain('Document received, link pending');
  expect(card('2024').querySelectorAll('.accounting-paper-row')).toHaveLength(2);
});

it('the years are the database\'s: a year the status lists with deductions and no draft or run is a card, and a year only the large sums name is not invented', async () => {
  serve(status([gateYear(2024, { run: storedRun() }), gateYear(2021, { draft_document_id: null, drafts_on_file: 0 })]),
    { sums: sumsOf(largeYear([largeRow(1)], { missing_doc_n: 1 }), largeYear([largeRow(5, { year: '2021' })], { year: '2021' }), largeYear([largeRow(7, { year: '2019' })], { year: '2019' })) });
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  expect(Array.from(node.querySelectorAll('.accounting-docket-year')).map(el => el.id)).toEqual(['docket-2024', 'docket-2021']);
  expect(text(card('2021'))).toContain('Not run');
  expect(text(card('2021'))).toContain('Payee 5 — work 5');
  // the open count of that year is the database's (zero, said), never an invention of the page
  expect(text(card('2021'))).toContain('No return items open');
  expect(card('2019')).toBeNull();
});

it('opening a row opens that record\'s evidence', async () => {
  const onOpen = vi.fn(); const r = largeRow(1);
  serve(status([gateYear(2024, { run: storedRun() })]), { sums: sumsOf(largeYear([r])) });
  await mount(inBook(<BooksDocket onOpen={onOpen} onDrill={vi.fn()} />));
  await act(async () => { (card('2024').querySelector('.accounting-paper-row .accounting-link-button') as HTMLButtonElement).click(); });
  expect(onOpen).toHaveBeenCalledWith('doc-1', r.record);
});

it('Read again reads the stored runs and the live rows again, and never runs the gate', async () => {
  serve(status([gateYear(2024, { run: storedRun() })]), { sums: sumsOf(largeYear([largeRow(1)])), tiers: [tier('2024')] });
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  expect([calls('books_gate_status'), calls('books_large_sum_rows')]).toEqual([1, 1]);
  const again = Array.from(node.querySelectorAll('.accounting-docket .accounting-section-heading button')).find(b => b.textContent === 'Read again') as HTMLButtonElement;
  await act(async () => again.click());
  await later(5500);
  expect([calls('books_gate_status'), calls('books_large_sum_rows'), fromCalls('v_books_audit_tier_years'), fromCalls('v_books_citation_links')]).toEqual([2, 2, 2, 2]);
  expect(fixture.rpc.mock.calls.some(c => c[0] === 'books_year_gate')).toBe(false);
  expect(text(card('2024'))).toContain('Payee 1 — work 1');
});

it('the dollars with no bank line, ruling or rule open the deductions behind them through the docket\'s drill; when there are none it is not a door', async () => {
  const onDrill = vi.fn();
  serve(status([gateYear(2024, { run: storedRun() })]), { sums: sumsOf(largeYear([largeRow(1)])), tiers: [tier('2024', { no_pay_no_ruling_usd: 9000 })] });
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={onDrill} />));
  const first = card('2024').querySelector('.accounting-close-item .accounting-paper-total')!.closest('button')!;
  await act(async () => first.click());
  expect(onDrill).toHaveBeenCalledWith({ year: '2024', item: 'no_pay_no_ruling', label: 'No bank line, no owner ruling, no rule' });
  serve(status([gateYear(2024, { run: storedRun() })]), { sums: sumsOf(largeYear([largeRow(1)])), tiers: [tier('2024', { no_pay_no_ruling_usd: 0 })] });
  await act(async () => { (Array.from(node.querySelectorAll('.accounting-section-heading button')).find(b => b.textContent === 'Read again') as HTMLButtonElement).click(); });
  await later(5500);
  expect(card('2024').querySelector('.accounting-paper-total')!.closest('button')).toBeNull();
});

// ── How often the books are read ──────────────────────────────────────────────────────────────────────────────────────────

it('a view that comes back on screen keeps its answer: the heavy reads are not asked again for the same book, and the cheap one only when its answer is old', async () => {
  serve(status([gateYear(2024, { run: storedRun() })]), { sums: sumsOf(largeYear([largeRow(1)])), tiers: [tier('2024')], ties: [tie('2024')] });
  const ui = (active: boolean) => inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} active={active} />);
  await mount(ui(true));
  const once = () => [calls('books_gate_status'), calls('books_large_sum_rows'), fromCalls('v_books_audit_tier_years'), fromCalls('v_books_citation_links'), calls('books_year_state')];
  expect(once()).toEqual([1, 1, 1, 1, 1]);
  await mount(ui(false));
  expect(card('2024')).not.toBeNull(); // hidden, not forgotten
  await mount(ui(true));
  expect(once()).toEqual([1, 1, 1, 1, 1]);
  await later(31000);
  await mount(ui(false)); await mount(ui(true));
  // 30 s on, the cheap status is read again when the view returns; the books have not changed, so nothing heavy is
  expect(once()).toEqual([2, 1, 1, 1, 1]);
});

it('when the books change the reads are asked again once the change has settled, and a heavy read is not repeated within a minute however often they change', async () => {
  serve(status([gateYear(2024, { run: storedRun() })]), { sums: sumsOf(largeYear([largeRow(1)])), tiers: [tier('2024')], ties: [tie('2024')] });
  const ui = (revision: string) => inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />, { liveRevision: revision });
  await mount(ui('1:rev'));
  const heavy = () => [calls('books_large_sum_rows'), fromCalls('v_books_audit_tier_years'), fromCalls('v_books_citation_links')];
  expect([calls('books_gate_status'), calls('books_year_state'), ...heavy()]).toEqual([1, 1, 1, 1, 1]);
  // the first revision known is the book the first read already saw: it counts as nothing
  await mount(ui('1:rev'));
  expect([calls('books_gate_status'), ...heavy()]).toEqual([1, 1, 1, 1]);
  // a change: nothing yet, then once it has held still the reads come
  await act(async () => root.render(ui('2:rev')));
  await later(1000);
  expect(calls('books_gate_status')).toBe(1);
  await later(700);
  expect([calls('books_gate_status'), calls('books_year_state'), ...heavy()]).toEqual([2, 2, 2, 2, 2]);
  // changes that keep coming: the cheap reads follow each, the heavy ones wait for the minute
  await act(async () => root.render(ui('3:rev')));
  await later(1600);
  expect([calls('books_gate_status'), ...heavy()]).toEqual([3, 2, 2, 2]);
  await act(async () => root.render(ui('4:rev')));
  await later(1600);
  expect([calls('books_gate_status'), ...heavy()]).toEqual([4, 2, 2, 2]);
  await later(60000);
  expect(heavy()).toEqual([3, 3, 3]);
  expect(calls('books_gate_status')).toBe(4); // the heavy catch-up is for the latest change only
});

it('a read still in flight when a newer one replaces it is cancelled, not left to pile up on the database', async () => {
  const seen: AbortSignal[] = [];
  serve(status([gateYear(2024, { run: storedRun() })]), { sums: sumsOf(largeYear([largeRow(1)])), seen });
  await mount(inBook(<BooksDocket onOpen={vi.fn()} onDrill={vi.fn()} />));
  const sumsSignals = () => seen.length;
  const before = sumsSignals();
  // a slow read of the large sums, then Read again: the slow one is aborted
  fixture.rpc.mockImplementation((name: string) => name === 'books_large_sum_rows'
    ? Object.assign(new Promise(() => undefined), { abortSignal(signal: AbortSignal) { seen.push(signal); return this; } })
    : answer(name === 'books_gate_status' ? { data: status([gateYear(2024, { run: storedRun() })]), error: null } : { data: yearState(), error: null }, seen));
  const again = () => Array.from(node.querySelectorAll('.accounting-docket .accounting-section-heading button')).find(b => b.textContent === 'Read again') as HTMLButtonElement;
  await act(async () => again().click());
  await later(10);
  const slow = seen.at(-1)!;
  expect(slow.aborted).toBe(false);
  await act(async () => again().click());
  await later(10);
  expect(slow.aborted).toBe(true);
  expect(seen.length).toBeGreaterThan(before);
});


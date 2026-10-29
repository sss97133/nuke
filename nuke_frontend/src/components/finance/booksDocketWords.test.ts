import { expect, it } from 'vitest';
import { gateRowCaption, gateRowLine, gateVerdict, openLine, paperwork, pct, returnMatchesLine, ruleLine, ruleState, shortCauses, tierExcludedLine } from './booksDocketWords';
import { filingOf, forEarlierDraft, yearsPhrase } from './filingState';
import type { GateRule, GateYear, TierYear, YearState } from '../../services/accountingCloseout';

// Synthetic values only.
const rule = (id: string, status: string, n: number, of: number | null, extra: object = {}): GateRule => ({ rule: id, title: `t ${id}`, status, n, of, amount: null, ...extra });
const counts = (rules: GateRule[]) => ({ total: rules.length, pass: rules.filter(r => r.status === 'pass').length, fail: rules.filter(r => r.status === 'fail').length,
  not_assessed: rules.filter(r => r.status !== 'pass' && r.status !== 'fail').length, empty: rules.filter(r => r.status === 'pass' && r.of === 0).length });
const withRun = (rules: GateRule[], over: object = {}): GateYear => {
  const c = counts(rules); const pass = c.fail === 0 && c.not_assessed === 0;
  return { year: 2024, draft_document_id: 'd1', drafts_on_file: 1, attempt: null, open_items: { total: 0, owner: 0, cpa: 0, agent: 0, unassigned: 0 },
    run: { id: 'r', started_at: '2026-10-29T17:30:30Z', finished_at: '2026-10-29T17:31:00Z', duration_ms: 30000, pass, stale: false, stale_books: false, stale_gate: false,
      trusted: pass && c.empty === 0, rule_counts: c, rules, ...over } };
};
const attempt = (status: 'timed_out' | 'error' | 'complete', finished_at = '2026-10-29T17:32:00Z') => ({ status, started_at: '2026-10-29T17:30:00Z', finished_at, duration_ms: 120000 });
const clean = [rule('R1', 'pass', 0, 10), rule('R9', 'pass', 0, 5)];

it('the verdict is Trusted only for a fresh pass over populations, and every other state says why', () => {
  expect(gateVerdict(withRun(clean))).toMatchObject({ state: 'trusted', word: 'Trusted', reason: 'Passed 2 of 2 rules on Oct 29, 2026, 10:31 AM' });
  expect(gateVerdict({ ...withRun(clean), run: null })).toMatchObject({ state: 'not_run', word: 'Not run' });
  expect(gateVerdict({ ...withRun(clean), run: null, attempt: attempt('timed_out') })).toMatchObject({ state: 'did_not_finish', word: 'Did not finish', reason: expect.stringContaining('Stopped at 120 s') });
  expect(gateVerdict({ ...withRun(clean), run: null, attempt: attempt('error') })).toMatchObject({ state: 'did_not_finish', word: 'Run failed' });
  expect(gateVerdict(withRun([rule('R1', 'fail', 3, 10), rule('R2', 'not_assessed', 0, 4)]))).toMatchObject({ state: 'not_trusted', reason: '1 of 2 rules failing; 1 of 2 rules not assessed' });
  expect(gateVerdict(withRun(clean, { stale: true, stale_books: true, stale_gate: true, trusted: false }))).toMatchObject({ reason: 'the last run passed, but the books and the gate rules changed since the run' });
  expect(gateVerdict(withRun(clean, { stale: true, stale_gate: true, trusted: false }))).toMatchObject({ reason: 'the last run passed, but the gate rules changed since the run' });
  // a failing run that is also stale does not claim it passed
  expect(gateVerdict(withRun([rule('R1', 'fail', 1, 5)], { stale: true, stale_books: true, trusted: false })).reason).toBe('1 of 1 rules failing; the books changed since the run');
});

it('a rule that checked nothing keeps the year from being trusted and is named', () => {
  const v = gateVerdict(withRun([rule('R1', 'pass', 0, 10), rule('R2i', 'pass', 0, 0), rule('R7', 'pass', 0, 0)]));
  expect(v).toMatchObject({ state: 'not_trusted', reason: '2 rules had nothing to test (0 checked): R2i, R7' });
});

it('the gate row line follows the design: Passed | Last run passed | N rules failing | N rules not assessed | Not run | Did not finish', () => {
  expect(gateRowLine(withRun(clean))).toBe('Passed, 2 of 2 rules');
  expect(gateRowLine(withRun(clean, { stale: true, stale_books: true, trusted: false }))).toBe('Last run passed, 2 of 2 rules');
  expect(gateRowLine(withRun([rule('R1', 'fail', 1, 5), rule('R2', 'fail', 1, 5)]))).toBe('2 rules failing');
  expect(gateRowLine(withRun([rule('R1', 'fail', 1, 5)]))).toBe('1 rule failing');
  expect(gateRowLine(withRun([rule('R8b', 'not_assessed', 0, 4), rule('R1', 'pass', 0, 4)]))).toBe('1 rule not assessed');
  expect(gateRowLine({ ...withRun(clean), run: null })).toBe('Not run');
  expect(gateRowLine({ ...withRun(clean), run: null, attempt: attempt('timed_out') })).toBe('Did not finish (stopped at 120 s)');
});

it('the caption says when it ran, how long it took, and what changed or failed since', () => {
  expect(gateRowCaption(withRun(clean))).toEqual(['Ran Oct 29, 2026, 10:31 AM · 30 s']);
  expect(gateRowCaption(withRun(clean, { stale: true, stale_books: true, stale_gate: true }))).toEqual(['Ran Oct 29, 2026, 10:31 AM · 30 s', 'Books changed since this run', 'The gate rules changed since this run']);
  expect(gateRowCaption({ ...withRun(clean), attempt: attempt('timed_out', '2026-10-30T17:32:00Z') }).at(-1)).toBe('A later run did not finish (stopped at 120 s, Oct 30, 2026, 10:32 AM)');
  // an attempt older than the run is history, not a warning
  expect(gateRowCaption({ ...withRun(clean), attempt: attempt('timed_out', '2026-10-28T17:32:00Z') })).toHaveLength(1);
});

it('rule lines state their population; a rule with no population concept says passed; the rule ids are never reordered or dropped', () => {
  expect(ruleLine(rule('R5', 'fail', 3, 170, { amount: 120 }))).toBe('R5 · t R5 · 3 failing of 170 checked · $120');
  expect(ruleLine(rule('R5', 'pass', 0, 170))).toBe('R5 · t R5 · 0 failing of 170 checked');
  expect(ruleLine(rule('R2i', 'pass', 0, 0))).toBe('R2i · t R2i · nothing checked');
  expect(ruleLine(rule('R8a', 'pass', 0, null))).toBe('R8a · t R8a · passed');
  expect(ruleLine(rule('R8b', 'not_assessed', 0, 4))).toBe('R8b · t R8b · not assessed (4 in the population)');
  expect(ruleLine(rule('R11', 'something_new', 0, null))).toBe('R11 · t R11 · not assessed');
  expect(['pass', 'fail', 'not_assessed', 'empty']).toEqual([ruleState(rule('a', 'pass', 0, 3)), ruleState(rule('a', 'fail', 1, 3)), ruleState(rule('a', 'not_assessed', 0, 3)), ruleState(rule('a', 'pass', 0, 0))]);
});

it('whether the return matches the books comes from R9 of the stored run and never from the clock', () => {
  expect(returnMatchesLine({ ...withRun(clean), run: null })).toBe('Not checked: there is no stored gate run.');
  expect(returnMatchesLine(withRun(clean))).toBe('The return matches the books: rule R9, 0 failing of 5 checked, run Oct 29, 2026, 10:31 AM.');
  expect(returnMatchesLine(withRun([rule('R9', 'fail', 2, 5)]))).toBe('The return does not match the books: rule R9, 2 failing of 5 checked.');
  expect(returnMatchesLine(withRun([rule('R1', 'pass', 0, 5)]))).toBe('Not checked: rule R9 was not assessed.');
  expect(returnMatchesLine(withRun([rule('R9', 'pass', 0, 0)]))).toBe('Not checked: rule R9 had nothing to compare.');
  expect(returnMatchesLine(withRun(clean, { stale: true, stale_books: true }))).toContain('(the books or the gate changed since that run)');
});

it('percentages are printed as stored; an unknown share is unknown, never zero', () => {
  expect(pct(11.2)).toBe('11.2%');
  expect(pct(5)).toBe('5.0%');
  expect(pct(null)).toBe('unknown');
  const t = { excluded_n: 0, excluded_usd: 0 } as TierYear;
  expect(tierExcludedLine(t)).toBeNull();
});

it('what is open lists only the people who have something to close', () => {
  expect(openLine({ total: 0, owner: 0, cpa: 0, agent: 0, unassigned: 0 })).toBe('No return items open');
  expect(openLine({ total: 1, owner: 0, cpa: 0, agent: 1, unassigned: 0 })).toBe('1 return item open: books agent 1');
  expect(openLine({ total: 13, owner: 3, cpa: 2, agent: 1, unassigned: 7 })).toBe('13 return items open: you 3, your CPA 2, books agent 1, unassigned 7');
});

const fact = (over: object) => ({ local_id: 'f', key: 'k', topic: 'other', status: 'settled', date: '2026-10-01', decision: 'x', source: 's', ...over }) as any;
const stateWith = (facts: any[]): YearState => ({ year: 2024, read_at: '2026-10-29T17:40:00Z', result: null, schedule_c: {}, rulings: [], facts, open_items: [], unmapped: [] });
const filing = (state: string, as_of: string, over: object = {}) => fact({ local_id: `filing-${as_of}`, key: `filing-${as_of}`, topic: 'filing', filing: { state, as_of, form: '1040', ...over } });

it('the filing state is the newest settled filing fact by its as_of date; superseded and open facts are ignored', () => {
  const s = stateWith([filing('prepared', '2026-10-20'), filing('mail_ready', '2026-10-25', { packet_pages: 9, packet_document_id: 'd1' }), filing('draft', '2026-10-10'),
    fact({ ...filing('filed', '2026-10-28'), status: 'superseded' }), fact({ ...filing('mailed', '2026-10-29'), status: 'open' })]);
  expect(filingOf(s)).toMatchObject({ state: 'mail_ready', as_of: '2026-10-25', packet_pages: 9, packet_document_id: 'd1', from: 'fact' });
  expect(filingOf(stateWith([]))).toBeNull();
  expect(filingOf(undefined)).toBeNull();
});

it('the legacy hold ruling reads as on hold only while no filing fact is recorded, and only by its key', () => {
  const hold = fact({ local_id: '2023-FACT-filing-hold', key: 'filing-hold', topic: 'owner_ruling', date: '2026-10-28', decision: 'the packet is mail-ready' });
  expect(filingOf(stateWith([hold]))).toMatchObject({ state: 'on_hold', as_of: '2026-10-28', from: 'legacy_hold' });
  expect(filingOf(stateWith([hold, filing('prepared', '2026-10-30')]))).toMatchObject({ state: 'prepared', from: 'fact' });
  expect(filingOf(stateWith([fact({ key: 'something-else', decision: 'filing hold on hold' })]))).toBeNull();
});

it('a state recorded for a draft that is not the newest is flagged, and paperwork words reflect it', () => {
  const f = filingOf(stateWith([filing('mail_ready', '2026-10-25', { packet_pages: 9, packet_document_id: 'old' })]));
  expect(forEarlierDraft(f, 'new')).toBe(true);
  expect(forEarlierDraft(f, 'old')).toBe(false);
  expect(forEarlierDraft(f, null)).toBe(false);
  const y = withRun(clean, {}); y.draft_document_id = 'new'; y.drafts_on_file = 2;
  expect(paperwork(y, stateWith([filing('mail_ready', '2026-10-25', { packet_pages: 9, packet_document_id: 'old' })]), 'ready'))
    .toEqual({ headline: 'Recorded for an earlier draft: Mail-ready as of Oct 25, 2026', details: ['Form 1040', '9 pages', '2 drafts on file'], flags: [] });
  expect(paperwork(y, undefined, 'loading').headline).toBe('Reading the filing state…');
  expect(paperwork(y, undefined, 'error').headline).toBe('The filing state could not load');
  expect(paperwork({ ...y, drafts_on_file: 0, draft_document_id: null }, stateWith([]), 'ready')).toEqual({ headline: 'Filing state not recorded', details: ['No draft in the books'], flags: [] });
});

it('years read as a phrase', () => {
  expect(yearsPhrase([])).toBe('');
  expect(yearsPhrase(['2024'])).toBe('2024');
  expect(yearsPhrase(['2025', '2022'])).toBe('2022 and 2025');
  expect(yearsPhrase(['2025', '2022', '2024'])).toBe('2022, 2024 and 2025');
});

it('short causes name what keeps a year from being trusted in a few words, and are empty for a run that is', () => {
  expect(shortCauses({ ...withRun(clean), run: null })).toEqual([]);
  expect(shortCauses(withRun(clean))).toEqual([]);
  expect(shortCauses(withRun([rule('R1', 'fail', 1, 5), rule('R2', 'fail', 1, 5), rule('R3', 'not_assessed', 0, 2), rule('R4', 'pass', 0, 0)], { stale: true, stale_books: true, stale_gate: true })))
    .toEqual(['2 rules failing', '1 rule not assessed', '1 rule checked nothing', 'books changed since', 'gate rules changed since']);
});

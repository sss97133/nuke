import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import {
  ATTACH_ANY, DOC_KIND, FLAG_ASKS, LEGEND, THREAD_KINDS, PAPER_BY_RULE, RULE_STATE_WORDS, RULE_TONE, VERDICT_TONE, attachChoices, attachLabel, attachedLine, byKindLine, canAttach, citedLine, doorLine, driftLines,
  gateRowCaption, gateRowLine, gateVerdict, liveCaption, liveHeading, missingDocTotal, needsOf, openLine, outsideBankTotal, paperWord, paperwork, pct, returnMatchesLine, rowTitle, ruleLine, ruleState,
  shortCauses, tier274Line, tierExcludedLine, tierHeadline, tieClasses, tieCitationLine,
} from './booksDocketWords';
import { filingOf, forEarlierDraft, yearsPhrase } from './filingState';
import { linkRef } from '../../services/financialEvidenceIntake';
import type { GateYear, LargeSumYear, RunContext, TierYear, YearState } from '../../services/accountingCloseout';
import { attempt, gateYear, largeRow, largeYear, record as rec, rule, run, tie, tier } from './__fixtures__/books';

// Synthetic values only (see __fixtures__/books.ts).
const clean = [rule('R1', 'pass', 0, 10), rule('R9', 'pass', 0, 5)];
/** The one row most tests need: a contractor invoice missing on a bank-backed tier B decision, with the payee the title tests read. */
const sumRow = (over: Partial<ReturnType<typeof largeRow>> = {}) => largeRow(1, { record: rec('L1') as any, ...over });
const withRun = (rules: ReturnType<typeof rule>[], over: Parameters<typeof run>[1] = {}): GateYear => gateYear(2024, { run: run(rules, over) });

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
  expect(ruleLine(rule('R5', 'fail', 3, 170, { amount: 120 }))).toBe('R5 · title of R5 · 3 failing of 170 checked · $120');
  expect(ruleLine(rule('R5', 'pass', 0, 170))).toBe('R5 · title of R5 · 0 failing of 170 checked');
  expect(ruleLine(rule('R2i', 'pass', 0, 0))).toBe('R2i · title of R2i · nothing checked');
  expect(ruleLine(rule('R8a', 'pass', 0, null))).toBe('R8a · title of R8a · passed');
  expect(ruleLine(rule('R8b', 'not_assessed', 0, 4))).toBe('R8b · title of R8b · not assessed (4 in the population)');
  expect(ruleLine(rule('R11', 'something_new', 0, null))).toBe('R11 · title of R11 · not assessed');
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


// ── Large sums that need paper ────────────────────────────────────────────────────────────────────────────────────────

const ctx = (over: Partial<RunContext> = {}): RunContext => ({ deductions: { n: 200, usd: 150000 }, no_bank: { n: 30, usd: 20000 }, no_pay_no_ruling: { n: 12, usd: 9000 },
  head: { n: 40, usd: 120000, year_usd: 150000 }, ...over });
const r12 = (over: object = {}) => rule('R12', 'fail', 15, 40, { missing_doc: { n: 11, amount: 36000, cite_no_document: 4, by_kind: { receipt_or_order: { n: 6, amount: 6000 }, invoice_or_agreement: { n: 4, amount: 27000 }, purchase_agreement: { n: 1, amount: 3000 } } }, ...over });
const sumYear = (over: Partial<LargeSumYear> = {}): LargeSumYear => largeYear([], {
  year_usd: 10000, deductions_n: 50, head_n: 12, head_usd: 8000, flagged_n: 3, flagged_usd: 6000, missing_doc_n: 2, missing_doc_usd: 5000, missing_doc_cite_no_document: 1, missing_doc_by_kind: { invoice_or_agreement: { n: 2, amount: 5000 } },
  no_payment_n: 1, no_payment_usd: 1000, rows_shown: 0, ...over });

it('a row says what it still needs in plain words, the document first; a rule or flag the table does not know yet is shown humanized, never dropped', () => {
  expect(needsOf(sumRow())).toEqual(['Contractor invoice']);
  expect(needsOf(sumRow({ required_doc_rule: 'vehicle_deal', required_doc_kind: 'purchase_agreement' }))).toEqual(['Purchase agreement or bill of sale']);
  expect(needsOf(sumRow({ required_doc_rule: 'parts_supplies', required_doc_kind: 'receipt_or_order', proof_flag: 'no_payment_proof' }))).toEqual(['Receipt or order confirmation', FLAG_ASKS.no_payment_proof]);
  expect(needsOf(sumRow({ missing_doc: false, required_doc_kind: null, required_doc_rule: null, proof_flag: 'filed_return_only' }))).toEqual([FLAG_ASKS.filed_return_only]);
  expect(needsOf(sumRow({ required_doc_rule: 'new_rule', required_doc_kind: 'new_kind' }))).toEqual(['New rule']);
  expect(needsOf(sumRow({ required_doc_rule: null, required_doc_kind: 'new_kind' }))).toEqual(['New kind']);
  expect(needsOf(sumRow({ missing_doc: false, proof_flag: 'a_new_flag' as any }))).toEqual(['A new flag']);
  expect(needsOf(sumRow({ missing_doc: false, proof_flag: null }))).toEqual(['Flagged by the rules']);
  expect(paperWord(sumRow({ missing_doc: false }))).toBeNull();
});

it('a file can answer a row that misses a document (except the asset register, which is the books agent\'s), rests only on the filed return, or has no cited basis; never a missing bank line', () => {
  expect(canAttach(sumRow())).toBe(true);
  expect(canAttach(sumRow({ required_doc_kind: 'register_asset', required_doc_rule: 'depreciation' }))).toBe(false);
  expect(canAttach(sumRow({ missing_doc: false, proof_flag: 'filed_return_only' }))).toBe(true);
  expect(canAttach(sumRow({ missing_doc: false, proof_flag: 'no_basis' }))).toBe(true);
  expect(canAttach(sumRow({ missing_doc: false, proof_flag: 'no_payment_proof' }))).toBe(false);
  expect(canAttach(sumRow({ missing_doc: true, proof_flag: 'no_payment_proof' }))).toBe(true);
  expect(attachLabel(sumRow())).toBe('Add the invoice');
  expect(attachLabel(sumRow({ required_doc_kind: 'purchase_agreement' }))).toBe('Add the purchase agreement');
  expect(attachLabel(sumRow({ missing_doc: false, proof_flag: 'filed_return_only', required_doc_kind: null }))).toBe('Add a document');
  expect(attachLabel(sumRow({ attached: [{ document_id: 'd', filename: 'a.pdf', doc_kind: 'Invoice', ref: 'r', attached_at: '2026-10-29T19:12:00Z' }] }))).toBe('Add another');
  expect(attachChoices(sumRow())).toEqual(DOC_KIND.invoice_or_agreement.offers);
  expect(attachChoices(sumRow({ required_doc_kind: 'purchase_agreement' }))).toEqual(['Purchase agreement', 'Bill of sale', 'Title', 'Text message thread', 'Email thread']);
  expect(attachChoices(sumRow({ missing_doc: false, proof_flag: 'filed_return_only', required_doc_kind: null }))).toEqual(ATTACH_ANY);
});

it('the row\'s title is its payee and what was bought; an attached file is named with what the owner said it is and when', () => {
  expect(rowTitle(sumRow())).toBe('Painter Co — paint and bodywork');
  expect(rowTitle(sumRow({ record: rec('L1', { description: '' }) as any }))).toBe('Synthetic category');
  expect(attachedLine({ document_id: 'd', filename: 'inv.pdf', doc_kind: 'Invoice', ref: 'x', attached_at: '2026-10-29T19:12:00Z' })).toBe('Invoice · inv.pdf · attached Oct 29, 2026, 12:12 PM');
  expect(attachedLine({ document_id: 'd', filename: null, doc_kind: null, ref: null, attached_at: '2026-10-29T19:12:00Z' })).toBe('Document · file · attached Oct 29, 2026, 12:12 PM');
});

// The words must stay true to the rules in SQL. The newest migration that defines v_books_large_sums is the contract: every document rule and flag it can
// produce has a word here, and every kind of paper a file may be called satisfies the level the rule requires by the keyword patterns the view reads.
const migrations = fileURLToPath(new URL('../../../../supabase/migrations/', import.meta.url));
const largeSumsSql = (() => {
  const files = readdirSync(migrations).filter(f => f.endsWith('.sql')).sort();
  const newest = [...files].reverse().find(f => /CREATE OR REPLACE VIEW public\.v_books_large_sums/.test(readFileSync(migrations + f, 'utf8')));
  return readFileSync(migrations + newest!, 'utf8');
})();
const viewSql = largeSumsSql.slice(largeSumsSql.indexOf('CREATE OR REPLACE VIEW public.v_books_large_sums'), largeSumsSql.indexOf('COMMENT ON VIEW public.v_books_large_sums'));

it('every document rule and kind the view can produce has its words (the contract is the view in SQL)', () => {
  const rules = [...viewSql.matchAll(/\(\d+, '([a-z_]+)',\s+'[^']*',\s+'([a-z_]+)',\s+(?:\d+|NULL(?:::int)?)\)/g)].map(m => [m[1], m[2]]);
  expect(rules.length).toBeGreaterThanOrEqual(7);
  for (const [rule, kind] of rules) {
    expect(PAPER_BY_RULE[rule], `rule ${rule}`).toBeTruthy();
    expect(DOC_KIND[kind]?.words, `kind ${kind}`).toBeTruthy();
  }
  const flags = [...viewSql.matchAll(/THEN '(no_payment_proof|no_basis|filed_return_only)'/g)].map(m => m[1]);
  expect(new Set(flags)).toEqual(new Set(['filed_return_only', 'no_payment_proof', 'no_basis']));
  for (const flag of flags) expect(FLAG_ASKS[flag], `flag ${flag}`).toBeTruthy();
});

it('each kind of paper offered satisfies the level the view requires, by the keyword patterns the view itself reads', () => {
  // (3, 'purchase agreement|…'), (2, 'invoice|…'), (1, 'receipt|…'): \m and \M are word boundaries in PostgreSQL regular expressions.
  const levels = [...viewSql.matchAll(/\((\d), '([^']+)'\)/g)].map(m => ({ lvl: Number(m[1]), re: new RegExp(m[2].replace(/\\m|\\M/g, '\\b'), 'i') })).filter(l => l.lvl >= 1 && l.lvl <= 3);
  expect(levels.map(l => l.lvl).sort()).toEqual([1, 2, 3]);
  const levelOf = (text: string) => Math.max(0, ...levels.filter(l => l.re.test(text.replace(/_/g, ' '))).map(l => l.lvl));
  const required: Record<string, number> = { purchase_agreement: 3, invoice_or_agreement: 2, receipt_or_order: 1 };
  for (const [kind, level] of Object.entries(required)) {
    // a thread satisfies the row through the view's message-thread patterns, not its levels (next test)
    for (const word of DOC_KIND[kind].offers!.filter((w: string) => !THREAD_KINDS.includes(w))) expect(levelOf(`${word}: scan.pdf (sha256 abcdef012345)`), `${word} for ${kind}`).toBeGreaterThanOrEqual(level);
  }
  // a lease is read by its own pattern, not by the levels
  expect(viewSql).toMatch(/lease\|rental agreement\|tenan/);
  for (const word of DOC_KIND.lease_or_ruling.offers!) expect(`${word}: lease.pdf`.toLowerCase()).toMatch(/lease|rental agreement|tenan/);
});

it('a screenshot said to be a text or email thread satisfies the agreement a row requires by the view\'s own message-thread patterns, and is never offered for a receipt, lease, title or bill of sale', () => {
  // The view names the media it accepts, requires a date or an id to locate the exchange, and refuses a cite that records a search with no result.
  const pg = (re: string) => new RegExp(re.replace(/\\m|\\M/g, '\\b'), 'i');
  const medium = pg(viewSql.match(/AND \(m\.r ~ '([^']+)'/)![1]);
  const locator = pg(viewSql.match(/AND m\.r ~ '(\[0-9\]\{4\}[^']+)'/)![1]);
  const refused = pg(viewSql.match(/AND m\.r !~ '([^']+)'/)![1]);
  expect(THREAD_KINDS.length).toBeGreaterThan(0);
  for (const word of THREAD_KINDS) {
    const ref = linkRef(word, 'IMG_4821.png', 'f'.repeat(64)).toLowerCase();
    expect(medium.test(ref), `${word}: names a medium`).toBe(true);
    expect(locator.test(ref), `${word}: locates the exchange (the stored file's hash is its id)`).toBe(true);
    expect(refused.test(ref), `${word}: is not a record of a search with no result`).toBe(false);
  }
  expect(refused.test('text messages: searched, no message found')).toBe(true);
  for (const kind of ['invoice_or_agreement', 'purchase_agreement']) for (const word of THREAD_KINDS) expect(DOC_KIND[kind].offers).toContain(word);
  for (const kind of ['receipt_or_order', 'lease_or_ruling']) for (const word of THREAD_KINDS) expect(DOC_KIND[kind].offers).not.toContain(word);
  expect(viewSql).toMatch(/rq\.required_doc_kind IN \('invoice_or_agreement', 'purchase_agreement'\)/);
  expect(ATTACH_ANY.some(word => THREAD_KINDS.includes(word))).toBe(false);
});

it('the live heading and caption state the reader\'s counts: how many of the head are flagged, which answers they need, that a row can need more than one, the 80% line, the smaller rows beyond it, a cap and unread rows', () => {
  const y = sumYear({ missing_doc_n: 11, no_payment_n: 7, filed_return_only_n: 1, head_n: 40, head_usd: 120000, year_usd: 150000, beyond_head_missing_doc_n: 22, beyond_head_missing_doc_usd: 5000, flagged_n: 25, rows_shown: 20 });
  expect(liveHeading(y)).toBe('25 of the 40 largest deductions flagged · 11 rows need a document · 7 rows need a bank line · 1 row rests on the filed return only');
  expect(liveCaption(y)).toBe('Rule R12 tests the 40 largest deductions, the 80% line. A row can need more than one thing. 22 smaller deductions below that line ($5,000) also miss a document; no rule tests them. Showing the largest 20 of 25.');
  expect(liveCaption(sumYear({ beyond_head_missing_doc_n: 1, beyond_head_missing_doc_usd: 40, flagged_n: 0, rows_shown: 0, head_n: 1 })))
    .toBe('Rule R12 tests the 1 largest deduction, the 80% line. A row can need more than one thing. 1 smaller deduction below that line ($40) also misses a document; no rule tests them.');
  expect(liveCaption(sumYear({ flagged_n: 3, rows_shown: 3, unreadable_rows: 2, head_n: 1 }))).toContain('2 rows of the answer could not be read and are not listed; the totals count them.');
  expect(liveCaption(sumYear({ flagged_n: 3, rows_shown: 3, unreadable_rows: 1, head_n: 1 }))).toContain('1 row of the answer could not be read and is not listed; the totals count it.');
});

// ── the two totals are the live readers' own figures ─────────────────────────────────────────────────────────────────────────

it('rows with no bank line, ruling or rule (R10 part b): the audit tiers\' own dollars of the year\'s deductions, net of credits, read live; the label says what is counted and no more', () => {
  const t = tier('2024', { no_pay_no_ruling_usd: 9000.4, deduction_usd: 150000.4 });
  expect(outsideBankTotal({ phase: 'ready', data: t })).toMatchObject({ label: 'No bank line, no owner ruling, no rule', rule: 'R10 part b', from: 'v_books_audit_tier_years',
    headline: '$9,000 of $150,000 in deductions, net of credits', tone: 'bad' });
  expect(outsideBankTotal({ phase: 'ready', data: t }).details).toEqual(['Deductions with no linked bank line, no owner ruling and no structural rule (rule R10 part b). A deduction resting on an owner ruling or the asset register is counted apart.']);
  expect(outsideBankTotal({ phase: 'ready', data: { ...t, no_pay_no_ruling_usd: 0 } })).toMatchObject({ headline: '$0 of $150,000 in deductions, net of credits', tone: 'good' });
  // a credit can make the net negative; it is still money, still not "none"
  expect(outsideBankTotal({ phase: 'ready', data: { ...t, no_pay_no_ruling_usd: -200 } }).tone).toBe('bad');
});

it('large deductions missing their document (R12): the live reader\'s own dollars of the head, with how many cite nothing and by kind; it says it counts paper, not unreconciled money', () => {
  const live = sumYear({ head_n: 40, head_usd: 120000.4, year_usd: 150000, missing_doc_n: 11, missing_doc_usd: 36000.4, missing_doc_cite_no_document: 4,
    missing_doc_by_kind: { receipt_or_order: { n: 6, amount: 6000 }, invoice_or_agreement: { n: 4, amount: 27000 }, purchase_agreement: { n: 1, amount: 3000 } } });
  expect(missingDocTotal({ phase: 'ready', data: live })).toMatchObject({ label: 'Large deductions missing their document', rule: 'R12', from: 'v_books_large_sums',
    headline: '$36,000 of $120,000 in the 40 largest deductions', tone: 'bad' });
  expect(missingDocTotal({ phase: 'ready', data: live }).details).toEqual([
    '11 of those 40 lack the document their kind requires; 4 of those cite no document at all.',
    'Purchase agreement or bill of sale 1 ($3,000) · Invoice or agreement 4 ($27,000) · Receipt or order confirmation 6 ($6,000)',
    'This counts missing paper. Whether a row has a bank line is a separate flag, shown on the row and counted in the line above.',
    "The 40 largest deductions are the smallest set of the year's largest deductions that reaches 80% of its $150,000 (absolute amounts, credits counted as positive; rule R12 tests them)."]);
  expect(missingDocTotal({ phase: 'ready', data: { ...live, missing_doc_n: 1, missing_doc_cite_no_document: 1 } }).details[0]).toBe('1 of those 40 lack the document their kind requires; 1 of those cites no document at all.');
  // nothing missing is a pass with its denominator, not a blank
  expect(missingDocTotal({ phase: 'ready', data: { ...live, missing_doc_n: 0, missing_doc_usd: 0, missing_doc_by_kind: {} } }))
    .toMatchObject({ headline: 'None: every one of the 40 largest deductions has the document its kind requires', tone: 'good' });
});

it('a total is the live read and nothing else: in flight it says Reading, failed it says so and states no number, and a year with no deductions says that', () => {
  for (const total of [outsideBankTotal({ phase: 'loading', data: undefined }), missingDocTotal({ phase: 'loading', data: undefined }), outsideBankTotal(), missingDocTotal()]) {
    expect(total).toMatchObject({ headline: 'Reading…', details: [] });
    expect(total.tone).toBeUndefined();
  }
  for (const total of [outsideBankTotal({ phase: 'error', data: undefined }), missingDocTotal({ phase: 'error', data: undefined })]) {
    expect(total).toMatchObject({ headline: 'Could not load', tone: 'warn' });
    expect(total.details[0]).toMatch(/could not be read; the retry is further down this card/);
    expect(JSON.stringify(total)).not.toMatch(/\$\d/);
  }
  for (const total of [outsideBankTotal({ phase: 'ready', data: undefined }), missingDocTotal({ phase: 'ready', data: undefined })]) expect(total).toMatchObject({ headline: 'No deductions are in the books for this year' });
});

it('by-kind totals come in the order of the kinds, an unknown kind last and named', () => {
  expect(byKindLine({ zeta_kind: { n: 1, amount: 5 }, receipt_or_order: { n: 2, amount: 20 }, purchase_agreement: { n: 3, amount: 300 } }))
    .toBe('Purchase agreement or bill of sale 3 ($300) · Receipt or order confirmation 2 ($20) · Zeta kind 1 ($5)');
});

it('where the stored run and the live readers disagree the page says so with both numbers; where they agree, or nothing is stored, or a read is not in, it says nothing', () => {
  const y = withRun([rule('R10', 'fail', 12, 200), r12()], { context: ctx() });
  const live = sumYear({ missing_doc_n: 8, missing_doc_usd: 30000 });
  expect(driftLines(y, live, undefined)).toEqual(['The gate run of Oct 29, 2026, 10:31 AM counted 11 rows missing a document ($36,000); the list now has 8 ($30,000).']);
  // same count, different dollars is still a difference
  expect(driftLines(y, sumYear({ missing_doc_n: 11, missing_doc_usd: 35000 }), undefined)).toHaveLength(1);
  expect(driftLines(y, sumYear({ missing_doc_n: 11, missing_doc_usd: 36000 }), undefined)).toEqual([]);
  const part = tier('2024', { no_pay_no_ruling_usd: 6556 });
  expect(driftLines(y, undefined, part)).toEqual(['The gate run of Oct 29, 2026, 10:31 AM counted $9,000 (12 deductions) with no bank line, no owner ruling and no rule; the deductions now stand at $6,556.']);
  expect(driftLines(y, undefined, tier('2024', { no_pay_no_ruling_usd: 9000 }))).toEqual([]);
  expect(driftLines(y, live, part)).toHaveLength(2);
  expect(driftLines({ ...y, run: null }, live, part)).toEqual([]);
  expect(driftLines(y, undefined, undefined)).toEqual([]);
  // a run without its denominators, or from before rule R12, has nothing to compare
  expect(driftLines(withRun([rule('R10', 'pass', 0, 5)]), live, part)).toEqual([]);
});

it('colour is a tone: the verdicts, the rules and the totals each map their states to good, bad or warn, and nothing else', () => {
  expect(VERDICT_TONE).toEqual({ trusted: 'good', not_trusted: 'bad', did_not_finish: 'bad', not_run: 'warn' });
  expect(RULE_TONE).toEqual({ pass: 'good', fail: 'bad', not_assessed: 'warn', empty: 'warn' });
  expect(Object.keys(RULE_STATE_WORDS).sort()).toEqual(Object.keys(RULE_TONE).sort());
  expect(RULE_STATE_WORDS).toEqual({ pass: 'passed', fail: 'failing', not_assessed: 'not assessed', empty: 'nothing checked' });
});

it('the legend says what the first screen is, once, and which dollars are net and which absolute', () => {
  expect(LEGEND.paper).toContain('Large sums that need paper');
  expect(LEGEND.paper).toContain('the row leaves the list when the books agent cites it');
  expect(LEGEND.dollars).toContain('net of credits');
  expect(LEGEND.dollars).toContain('absolute amounts');
});

it('a row that already cites a paper says what it cites, as written, so a cited paper of the wrong kind is visible; with more cites than shown it says how many in all', () => {
  expect(citedLine(sumRow())).toBeNull();
  expect(citedLine(sumRow({ doc_cited_n: 1, cites: [{ kind: 'file', ref: 'photo of the shelf' }] }))).toBe('Already cites: photo of the shelf (file)');
  expect(citedLine(sumRow({ doc_cited_n: 5, cites: [{ kind: 'file', ref: 'a' }, { kind: 'gmail', ref: 'b' }, { kind: 'photo', ref: 'c' }, { kind: 'file', ref: 'd' }] })))
    .toBe('Already cites 5 documents, among them: a (file); b (gmail); c (photo)');
  expect(citedLine(sumRow({ doc_cited_n: 3, cites: [{ kind: 'file', ref: 'a' }, { kind: 'gmail', ref: 'b' }, { kind: 'photo', ref: 'c' }] }))).toBe('Already cites: a (file); b (gmail); c (photo)');
  expect(citedLine(sumRow({ doc_cited_n: 1, cites: [{ kind: 'file', ref: 'x'.repeat(200) }] }))).toBe(`Already cites: ${'x'.repeat(78)}… (file)`);
});

// ── lines that state a count carry the population they are counted in ────────────────────────────────────────────────────────

it('the tier lines carry their denominators: the headline and the part-b line say net of credits and of how many dollars; the section 274 line says of how many section 274 dollars', () => {
  const t = tier('2024', { c_n: 2, deductions: 10, c_usd: 200, c_pct: 20, deduction_usd: 1000, s274_usd: 400, s274_needs_receipt_usd: 40, s274_uncaveated_usd: 25, no_pay_no_ruling_usd: 60 });
  expect(tierHeadline(t)).toBe('Tier C: 2 of 10 deductions, $200, 20.0% of $1,000 net of credits');
  expect(tier274Line(t)).toBe('Section 274 lines that need a receipt and have none: $40 of $400 in section 274 lines; not caveated: $25.');
  expect(tier274Line({ ...t, s274_needs_receipt_usd: 0 })).toBeNull();
  expect(tierExcludedLine({ ...t, excluded_n: 0 })).toBeNull();
});

it('the ties list the five classes of decisions and nothing else; the citation tally is its own line, not inside the class it is not the denominator of', () => {
  const t = tie('2024', { decisions: 879, links: 879, links_resolved: 193, cites_missing_n: 67 });
  const classes = tieClasses(t);
  expect(classes.map(c => c.key)).toEqual(['both', 'cites_only', 'cited_by_only', 'cites_missing', 'none']);
  expect(classes.every(c => c.of === 879)).toBe(true);
  expect(classes.find(c => c.key === 'cites_missing')!.text).toBe('cite lines that are not in the books');
  expect(tieCitationLine(t)).toBe('193 of 879 citations written point at a statement line we hold');
});

it('the profile door names what ran and when, and the large rows missing a document out of the rows the rule checked; a run that found none says nothing of it', () => {
  const missing = (n: number, of: number | null = 40) => rule('R12', n ? 'fail' : 'pass', n, of, { missing_doc: { n, amount: 100, cite_no_document: 0, by_kind: {} } });
  const open = { total: 2, owner: 1, cpa: 0, agent: 0, unassigned: 1 };
  // a run whose counts are those of R1 alone: it passed, and its R12 rule states what it found
  const door = (n: number, of: number | null = 40) => gateYear(2024, { run: run([rule('R1', 'pass', 0, 10)], { rules: [rule('R1', 'pass', 0, 10), missing(n, of)] }), open_items: open });
  expect(doorLine(door(11))).toBe('Trusted · Oct 29, 2026, 10:31 AM · 11 of 40 large rows need a document · 2 open');
  expect(doorLine(door(1))).toContain('1 of 40 large rows need a document');
  expect(doorLine(door(0))).toBe('Trusted · Oct 29, 2026, 10:31 AM · 2 open');
  // without a stated population the count stands alone, in the right number
  expect(doorLine(door(1, null))).toContain('1 large row needs a document');
  // not trusted: the causes, when it ran, then the paper
  const failing = gateYear(2024, { run: run([rule('R1', 'fail', 2, 10)], { rules: [rule('R1', 'fail', 2, 10), missing(11)], stale: true, stale_books: true, trusted: false }) });
  expect(doorLine(failing)).toBe('Not trusted · 1 rule failing · books changed since · ran Oct 29, 2026, 10:31 AM · 11 of 40 large rows need a document');
  expect(doorLine({ ...gateYear(2024), run: null })).toBe('Gate not run');
  expect(doorLine({ ...gateYear(2024), run: null, attempt: attempt('timed_out') })).toBe('Gate did not finish (stopped at 120 s)');
  expect(doorLine({ ...gateYear(2024), run: null, attempt: attempt('error') })).toBe('Gate run failed');
});

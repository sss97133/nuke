import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import {
  ATTACH_ANY, ATTACH_KINDS, FLAG_ASKS, THREAD_KINDS, PAPER_BY_KIND, PAPER_BY_RULE, attachChoices, attachLabel, attachedLine, byKindLine, canAttach, citedLine, gateRowCaption, gateRowLine, gateVerdict, liveCaption, liveHeading,
  listVsRun, missingDocTotal, needsOf, openLine, outsideBankTotal, paperWord, paperwork, pct, returnMatchesLine, rowTitle, ruleLine, ruleState, shortCauses, tierExcludedLine,
} from './booksDocketWords';
import { filingOf, forEarlierDraft, yearsPhrase } from './filingState';
import { linkRef } from '../../services/financialEvidenceIntake';
import type { GateRule, GateYear, LargeSumRow, LargeSumYear, RunContext, TierYear, YearState } from '../../services/accountingCloseout';

// Synthetic values only.
const rule = (id: string, status: string, n: number, of: number | null, extra: object = {}): GateRule => ({ rule: id, title: `t ${id}`, status, n, of, amount: null, ...extra });
const counts = (rules: GateRule[]) => ({ total: rules.length, pass: rules.filter(r => r.status === 'pass').length, fail: rules.filter(r => r.status === 'fail').length,
  not_assessed: rules.filter(r => r.status !== 'pass' && r.status !== 'fail').length, empty: rules.filter(r => r.status === 'pass' && r.of === 0).length });
const withRun = (rules: GateRule[], over: object = {}): GateYear => {
  const c = counts(rules); const pass = c.fail === 0 && c.not_assessed === 0;
  return { year: 2024, draft_document_id: 'd1', drafts_on_file: 1, attempt: null, open_items: { total: 0, owner: 0, cpa: 0, agent: 0, unassigned: 0 },
    run: { id: 'r', started_at: '2026-10-29T17:30:30Z', finished_at: '2026-10-29T17:31:00Z', duration_ms: 30000, pass, stale: false, stale_books: false, stale_gate: false,
      trusted: pass && c.empty === 0, rule_counts: c, context: null, rules, ...over } };
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


// ── Large sums that need paper ────────────────────────────────────────────────────────────────────────────────────────

const rec = (over: object = {}) => ({ record_kind: 'retained_ledger_decision', local_id: 'L1', year: '2024', date: '2024-01-05', account: 'Synthetic', section: 'Expense', category: 'Synthetic category',
  amount: '4800.00', currency: 'USD', description: 'Painter Co — paint and bodywork', status: 'Synthetic', source_key: 'a'.repeat(64), ...over });
const sumRow = (over: Partial<LargeSumRow> = {}): LargeSumRow => ({ year: '2024', id: 'id-1', document_id: 'doc-1', local_id: 'L1', dollar_rank: 1, amount: 4800, share: 0.05, cum_share: 0.05,
  category: 'Synthetic category', tier: 'B', pay_proof: true, doc_proof: false, basis_strength: 'bank_and_rule', proof_flag: null, required_doc_kind: 'invoice_or_agreement',
  required_doc_rule: 'contractor', missing_doc: true, doc_found_n: 0, doc_cited_n: 0, cites: [], record: rec(), attached: [], ...over });
const sumYear = (over: Partial<LargeSumYear> = {}): LargeSumYear => ({ year: '2024', year_usd: 10000, deductions_n: 50, head_n: 12, head_usd: 8000, flagged_n: 3, flagged_usd: 6000,
  missing_doc_n: 2, missing_doc_usd: 5000, no_payment_n: 1, no_payment_usd: 1000, filed_return_only_n: 0, filed_return_only_usd: 0, beyond_head_missing_doc_n: 0, beyond_head_missing_doc_usd: 0,
  rows_shown: 0, rows: [], ...over });
const ctx = (over: Partial<RunContext> = {}): RunContext => ({ deductions: { n: 200, usd: 150000 }, no_bank: { n: 30, usd: 20000 }, no_pay_no_ruling: { n: 12, usd: 9000 },
  head: { n: 40, usd: 120000, year_usd: 150000 }, ...over });
const r12 = (over: object = {}) => rule('R12', 'fail', 15, 40, { missing_doc: { n: 11, amount: 36000, cite_no_document: 4, by_kind: { receipt_or_order: { n: 6, amount: 6000 }, invoice_or_agreement: { n: 4, amount: 27000 }, purchase_agreement: { n: 1, amount: 3000 } } }, ...over });

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
  expect(attachChoices(sumRow())).toEqual(ATTACH_KINDS.invoice_or_agreement);
  expect(attachChoices(sumRow({ required_doc_kind: 'purchase_agreement' }))).toEqual(['Purchase agreement', 'Bill of sale', 'Title', 'Text message thread', 'Email thread']);
  expect(attachChoices(sumRow({ missing_doc: false, proof_flag: 'filed_return_only', required_doc_kind: null }))).toEqual(ATTACH_ANY);
});

it('the row\'s title is its payee and what was bought; an attached file is named with what the owner said it is and when', () => {
  expect(rowTitle(sumRow())).toBe('Painter Co — paint and bodywork');
  expect(rowTitle(sumRow({ record: rec({ description: '' }) as any }))).toBe('Synthetic category');
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
    expect(PAPER_BY_KIND[kind], `kind ${kind}`).toBeTruthy();
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
    for (const word of ATTACH_KINDS[kind].filter(w => !THREAD_KINDS.includes(w))) expect(levelOf(`${word}: scan.pdf (sha256 abcdef012345)`), `${word} for ${kind}`).toBeGreaterThanOrEqual(level);
  }
  // a lease is read by its own pattern, not by the levels
  expect(viewSql).toMatch(/lease\|rental agreement\|tenan/);
  for (const word of ATTACH_KINDS.lease_or_ruling) expect(`${word}: lease.pdf`.toLowerCase()).toMatch(/lease|rental agreement|tenan/);
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
  for (const kind of ['invoice_or_agreement', 'purchase_agreement']) for (const word of THREAD_KINDS) expect(ATTACH_KINDS[kind]).toContain(word);
  for (const kind of ['receipt_or_order', 'lease_or_ruling']) for (const word of THREAD_KINDS) expect(ATTACH_KINDS[kind]).not.toContain(word);
  expect(viewSql).toMatch(/rq\.required_doc_kind IN \('invoice_or_agreement', 'purchase_agreement'\)/);
  expect(ATTACH_ANY.some(word => THREAD_KINDS.includes(word))).toBe(false);
});

it('the live heading and caption state the reader\'s counts; the 80% line and the smaller rows beyond it are named, a cap is said', () => {
  const y = sumYear({ missing_doc_n: 11, no_payment_n: 7, filed_return_only_n: 1, head_n: 40, head_usd: 120000, year_usd: 150000, beyond_head_missing_doc_n: 22, beyond_head_missing_doc_usd: 5000, flagged_n: 25, rows_shown: 20 });
  expect(liveHeading(y)).toBe('11 rows need a document · 7 rows need a bank line · 1 row rests on the filed return only');
  expect(liveCaption(y)).toBe('Rule R12 tests the 40 largest deductions, the 80% line. 22 smaller deductions below that line ($5,000) also miss a document; no rule tests them. Showing the largest 20 of 25.');
  expect(liveCaption(sumYear({ beyond_head_missing_doc_n: 1, beyond_head_missing_doc_usd: 40, flagged_n: 0, rows_shown: 0, head_n: 1 }))).toBe('Rule R12 tests the 1 largest deduction, the 80% line. 1 smaller deduction below that line ($40) also misses a document; no rule tests them.');
});

it('the totals come from the stored run with their denominators: paid outside a linked bank line (R10 part b) and missing a document (R12)', () => {
  const y = withRun([rule('R10', 'fail', 12, 200), r12()], { context: ctx() });
  expect(outsideBankTotal(y)).toMatchObject({ label: 'Paid outside a linked bank line', rule: 'R10 part b', headline: '$9,000 of $150,000 in deductions', state: 'bad' });
  expect(outsideBankTotal(y).details).toEqual([
    '12 of 200 deductions have no bank line, no owner ruling and no structural rule (rule R10 part b; R10 is failing).',
    'In all, 30 deductions ($20,000) have no linked bank line; the ones not counted above rest on an owner ruling, the asset register or another structural rule.']);
  expect(missingDocTotal(y)).toMatchObject({ label: 'Missing a document', rule: 'R12', headline: '$36,000 of $120,000 in the 40 largest deductions', state: 'bad' });
  expect(missingDocTotal(y).details).toEqual([
    '11 of the 40 largest deductions lack the document their kind requires; 4 of those cite no document at all.',
    'Purchase agreement or bill of sale 1 ($3,000) · Invoice or agreement 4 ($27,000) · Receipt or order confirmation 6 ($6,000)',
    "The 40 largest deductions are the smallest set of the year's largest deductions that reaches 80% of its $150,000 (rule R12 tests them)."]);
  // one row that cites no document reads in the singular; a run without its denominators states the count it has
  expect(missingDocTotal(withRun([r12({ missing_doc: { n: 1, amount: 900, cite_no_document: 1, by_kind: {} } })], { context: ctx() })).details[0]).toBe('1 of the 40 largest deductions lack the document their kind requires; 1 of those cites no document at all.');
  expect(missingDocTotal(withRun([r12()])).headline).toBe('$36,000 across 11 of the 40 largest deductions');
  // nothing missing is a pass with its denominator, not a blank
  const clean = withRun([rule('R10', 'pass', 0, 200), r12({ status: 'pass', n: 0, missing_doc: { n: 0, amount: 0, cite_no_document: 0, by_kind: {} } })], { context: ctx({ no_pay_no_ruling: { n: 0, usd: 0 } }) });
  expect(outsideBankTotal(clean)).toMatchObject({ headline: '$0 of $150,000 in deductions', state: 'ok' });
  expect(missingDocTotal(clean)).toMatchObject({ headline: 'None: every one of the 40 largest deductions has the document its kind requires', state: 'ok' });
});

it('with no stored run, a run without its denominators, or a run before rule R12, the totals say so and state no number', () => {
  const none = { ...withRun([rule('R10', 'pass', 0, 5)]), run: null };
  for (const total of [outsideBankTotal(none), missingDocTotal(none)]) expect(total).toMatchObject({ headline: 'Not run', state: 'unknown', details: ['There is no stored gate result for 2024.'] });
  expect(outsideBankTotal(withRun([rule('R10', 'pass', 0, 5)]))).toMatchObject({ headline: 'Not recorded', state: 'unknown' });
  expect(missingDocTotal(withRun([rule('R10', 'pass', 0, 5)]))).toMatchObject({ headline: 'Not in this run', state: 'unknown' });
  expect(missingDocTotal(withRun([rule('R12', 'not_assessed', 0, null)]))).toMatchObject({ headline: 'Not assessed', state: 'unknown' });
  // a stale run still states its numbers; the page says it is stale beside them
  expect(missingDocTotal(withRun([r12()], { stale: true, stale_books: true, trusted: false, context: ctx() })).headline).toBe('$36,000 of $120,000 in the 40 largest deductions');
});

it('by-kind totals come in the order of the kinds, an unknown kind last and named', () => {
  expect(byKindLine({ zeta_kind: { n: 1, amount: 5 }, receipt_or_order: { n: 2, amount: 20 }, purchase_agreement: { n: 3, amount: 300 } }))
    .toBe('Purchase agreement or bill of sale 3 ($300) · Receipt or order confirmation 2 ($20) · Zeta kind 1 ($5)');
});

it('when the live list and the stored run disagree about the rows missing a document, the page says so; when they agree it says nothing', () => {
  const y = withRun([r12()], { context: ctx() });
  expect(listVsRun(y, sumYear({ missing_doc_n: 8 }))).toBe('The gate run of Oct 29, 2026, 10:31 AM counted 11 rows missing a document; the list now has 8.');
  expect(listVsRun(y, sumYear({ missing_doc_n: 11 }))).toBeNull();
  expect(listVsRun({ ...y, run: null }, sumYear({ missing_doc_n: 8 }))).toBeNull();
  expect(listVsRun(y, undefined)).toBeNull();
});


it('with no stored run the totals fall back to the live readers\' own figures for the same conditions, and say they are live; a read in flight or failed states no number', () => {
  const none = { ...withRun([rule('R10', 'pass', 0, 5)]), run: null };
  const tierRow = { year: '2024', deduction_usd: 150000.4, no_pay_no_ruling_usd: 9000.4 } as TierYear;
  expect(outsideBankTotal(none, { phase: 'ready', data: tierRow })).toMatchObject({ headline: '$9,000 of $150,000 in deductions', state: 'bad', source: 'live' });
  expect(outsideBankTotal(none, { phase: 'ready', data: tierRow }).details[0]).toContain('No gate run is stored for 2024.');
  expect(outsideBankTotal(none, { phase: 'ready', data: { ...tierRow, no_pay_no_ruling_usd: 0 } as TierYear })).toMatchObject({ headline: '$0 of $150,000 in deductions', state: 'ok', source: 'live' });
  const live = sumYear({ head_n: 40, head_usd: 120000.4, missing_doc_n: 11, missing_doc_usd: 36000.4 });
  expect(missingDocTotal(none, { phase: 'ready', data: live })).toMatchObject({ headline: '$36,000 of $120,000 in the 40 largest deductions', state: 'bad', source: 'live' });
  expect(missingDocTotal(none, { phase: 'ready', data: live }).details).toEqual(['No gate run is stored for 2024. 11 of those 40 lack the document their kind requires, read live.']);
  for (const total of [outsideBankTotal(none, { phase: 'loading', data: undefined }), missingDocTotal(none, { phase: 'loading', data: undefined })]) expect(total).toMatchObject({ headline: 'Reading…', source: 'live' });
  for (const total of [outsideBankTotal(none, { phase: 'error', data: undefined }), missingDocTotal(none, { phase: 'ready', data: undefined })]) expect(total).toMatchObject({ headline: 'Not run', source: 'none' });
  // a stored run is never replaced by the live figure: the live reader only stands in where nothing is stored
  const stored = withRun([rule('R10', 'fail', 12, 200), r12()], { context: ctx() });
  expect(outsideBankTotal(stored, { phase: 'ready', data: tierRow }).source).toBe('stored');
  expect(missingDocTotal(stored, { phase: 'ready', data: live }).source).toBe('stored');
});

it('the legend says what the first screen is, once', async () => {
  const { LEGEND } = await import('./booksDocketWords');
  expect(LEGEND.paper).toContain('Large sums that need paper');
  expect(LEGEND.paper).toContain('the row leaves the list when the books agent cites it');
});


it('a row that already cites a paper says what it cites, as written, so a cited paper of the wrong kind is visible', () => {
  expect(citedLine(sumRow())).toBeNull();
  expect(citedLine(sumRow({ doc_cited_n: 1, cites: [{ kind: 'file', ref: 'photo of the shelf' }] }))).toBe('Already cites: photo of the shelf (file)');
  expect(citedLine(sumRow({ doc_cited_n: 5, cites: [{ kind: 'file', ref: 'a' }, { kind: 'gmail', ref: 'b' }, { kind: 'photo', ref: 'c' }, { kind: 'file', ref: 'd' }] })))
    .toBe('Already cites: a (file); b (gmail); c (photo), and 2 more');
  expect(citedLine(sumRow({ doc_cited_n: 1, cites: [{ kind: 'file', ref: 'x'.repeat(200) }] }))).toBe(`Already cites: ${'x'.repeat(78)}… (file)`);
});

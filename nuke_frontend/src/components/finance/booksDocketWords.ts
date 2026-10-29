import { dollars, pacific, type GateRule, type GateYear, type OpenItemCounts, type TieYear, type TierYear, type YearState } from '../../services/accountingCloseout';
import { formatMeasure } from '../../kit';
import { FILING_WORDS, filingOf, forEarlierDraft } from './filingState';

/** The words of the books docket. The database decides every count, class, rule order and staleness; these functions only name them. Nothing here
 *  sums, divides or compares a number the reader did not already state, and a percentage is printed exactly as the view stores it. */

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
export const secondsOf = (ms: number) => `${Math.round(ms / 1000).toLocaleString('en-US')} s`;
export const pct = (value: number | null) => value === null ? 'unknown' : formatMeasure(value, '%');

// ── The reconciliation gate ───────────────────────────────────────────────────────────────────────────────────────────

export type VerdictState = 'trusted' | 'not_trusted' | 'not_run' | 'did_not_finish';
export type Verdict = { state: VerdictState; word: string; reason: string };

/** The year's headline. "Trusted" is AGENTS.md's word: the stored run passed every rule, it is fresh (neither the books nor the gate's own rules
 *  changed since), and no rule passed over a population of zero. Anything else is "Not trusted" with the reasons. */
export function gateVerdict(y: GateYear): Verdict {
  const run = y.run, attempt = y.attempt;
  if (!run) {
    if (!attempt) return { state: 'not_run', word: 'Not run', reason: `No stored gate run for ${y.year}. The books agent records one after the last landing.` };
    return attempt.status === 'timed_out'
      ? { state: 'did_not_finish', word: 'Did not finish', reason: `Stopped at ${secondsOf(attempt.duration_ms)} on ${pacific(attempt.finished_at)}. No earlier run is stored.` }
      : { state: 'did_not_finish', word: 'Run failed', reason: `The run of ${pacific(attempt.finished_at)} ended in an error. No earlier run is stored.` };
  }
  const c = run.rule_counts;
  const reasons: string[] = [];
  if (c.fail > 0) reasons.push(`${c.fail} of ${c.total} rules failing`);
  if (c.not_assessed > 0) reasons.push(`${c.not_assessed} of ${c.total} rules not assessed`);
  if (c.empty > 0) reasons.push(`${plural(c.empty, 'rule', 'rules')} had nothing to test (0 checked): ${run.rules.filter(r => r.status === 'pass' && r.of === 0).map(r => r.rule).join(', ')}`);
  const changed = run.stale_books && run.stale_gate ? 'the books and the gate rules changed since the run' : run.stale_books ? 'the books changed since the run' : run.stale_gate ? 'the gate rules changed since the run' : '';
  if (changed) reasons.push(run.pass ? `the last run passed, but ${changed}` : changed);
  if (run.trusted && !reasons.length) return { state: 'trusted', word: 'Trusted', reason: `Passed ${c.pass} of ${c.total} rules on ${pacific(run.finished_at)}` };
  if (!reasons.length) reasons.push('the stored run does not qualify');
  return { state: 'not_trusted', word: 'Not trusted', reason: reasons.join('; ') };
}

/** The short causes of a run that is not trusted, for places with little room (the profile door): "1 rule failing", "books changed since". */
export function shortCauses(y: GateYear): string[] {
  const run = y.run;
  if (!run) return [];
  const c = run.rule_counts;
  return [c.fail > 0 ? `${plural(c.fail, 'rule', 'rules')} failing` : '', c.not_assessed > 0 ? `${plural(c.not_assessed, 'rule', 'rules')} not assessed` : '',
    c.empty > 0 ? `${plural(c.empty, 'rule', 'rules')} checked nothing` : '', run.stale_books ? 'books changed since' : '', run.stale_gate ? 'gate rules changed since' : ''].filter(Boolean);
}

/** The gate row's first line, in the design's words. A stale pass is "Last run passed", never plain "Passed". */
export function gateRowLine(y: GateYear): string {
  const run = y.run, attempt = y.attempt;
  if (!run) {
    if (!attempt) return 'Not run';
    return attempt.status === 'timed_out' ? `Did not finish (stopped at ${secondsOf(attempt.duration_ms)})` : 'Run failed';
  }
  const c = run.rule_counts;
  if (c.fail > 0) return `${plural(c.fail, 'rule', 'rules')} failing`;
  if (c.not_assessed > 0) return `${plural(c.not_assessed, 'rule', 'rules')} not assessed`;
  return `${run.stale ? 'Last run passed' : 'Passed'}, ${c.pass} of ${c.total} rules`;
}

/** When it ran and how long it took, then what has changed since. */
export function gateRowCaption(y: GateYear): string[] {
  const run = y.run, attempt = y.attempt;
  const lines: string[] = [];
  if (run) lines.push(`Ran ${pacific(run.finished_at)} · ${secondsOf(run.duration_ms)}`);
  else if (attempt) lines.push(`Attempted ${pacific(attempt.finished_at)}`);
  if (run?.stale_books) lines.push('Books changed since this run');
  if (run?.stale_gate) lines.push('The gate rules changed since this run');
  if (run && attempt && attempt.status !== 'complete' && attempt.finished_at > run.finished_at) {
    lines.push(attempt.status === 'timed_out' ? `A later run did not finish (stopped at ${secondsOf(attempt.duration_ms)}, ${pacific(attempt.finished_at)})` : `A later run failed (${pacific(attempt.finished_at)})`);
  }
  return lines;
}

/** "R5 · title · 0 failing of 170 checked". A rule that checked nothing is never a pass. */
export function ruleLine(r: GateRule): string {
  const parts = [r.rule, r.title];
  if (r.status === 'fail') parts.push(`${(r.n ?? 0).toLocaleString('en-US')} failing of ${r.of === null || r.of === undefined ? 'an unstated number' : r.of.toLocaleString('en-US')} checked${r.amount ? ` · ${dollars(r.amount)}` : ''}`);
  else if (r.status === 'pass') parts.push(r.of === null || r.of === undefined ? 'passed' : r.of === 0 ? 'nothing checked' : `${(r.n ?? 0).toLocaleString('en-US')} failing of ${r.of.toLocaleString('en-US')} checked`);
  else parts.push(`not assessed${r.of ? ` (${r.of.toLocaleString('en-US')} in the population)` : ''}`);
  return parts.join(' · ');
}
export const ruleState = (r: GateRule): 'pass' | 'fail' | 'not_assessed' | 'empty' => r.status === 'fail' ? 'fail' : r.status === 'pass' ? (r.of === 0 ? 'empty' : 'pass') : 'not_assessed';
/** Rule R5's evidence grades, exactly as stored: A statement and receipt, B statement, C receipt, R owner ruling only, D none. */
export const gradesLine = (r: GateRule): string | null => r.grades ? Object.entries(r.grades).map(([grade, n]) => `${grade} ${n.toLocaleString('en-US')}`).join(' · ') : null;

/** Whether the return matches the books, from rule R9 of the stored run. Never from the clock. */
export function returnMatchesLine(y: GateYear): string {
  const run = y.run;
  if (!run) return 'Not checked: there is no stored gate run.';
  const r9 = run.rules.find(r => r.rule === 'R9');
  const when = run.stale ? ' (the books or the gate changed since that run)' : '';
  if (!r9 || r9.status === 'not_assessed') return `Not checked: rule R9 was not assessed${when}.`;
  if (r9.status === 'fail') return `The return does not match the books: rule R9, ${(r9.n ?? 0).toLocaleString('en-US')} failing of ${(r9.of ?? 0).toLocaleString('en-US')} checked${when}.`;
  if (r9.of === 0) return `Not checked: rule R9 had nothing to compare${when}.`;
  return `The return matches the books: rule R9, ${(r9.n ?? 0).toLocaleString('en-US')} failing of ${(r9.of ?? 0).toLocaleString('en-US')} checked, run ${pacific(run.finished_at)}${when}.`;
}

// ── How the deductions are supported ──────────────────────────────────────────────────────────────────────────────────

export const TIER_WORDS = {
  A: 'A · a bank line, a cited allocation basis and a document',
  B: 'B · a bank line and a cited allocation basis',
  C: 'C · the rest: no bank line, or no cited allocation basis',
} as const;

/** C first: the share not yet supported is the number that matters. Every figure is a column of v_books_audit_tier_years. */
export function tierHeadline(t: TierYear): string {
  return `Tier C: ${t.c_n.toLocaleString('en-US')} of ${plural(t.deductions, 'deduction', 'deductions')}, ${dollars(t.c_usd)}, ${pct(t.c_pct)} of ${dollars(t.deduction_usd)}`;
}
export function tierExcludedLine(t: TierYear): string | null {
  return t.excluded_n > 0 ? `${plural(t.excluded_n, 'row', 'rows')} (${dollars(t.excluded_usd)}) are outside this count: credits, shares of an order that is counted on its own row, and pool allocations. They are not deductions of their own.` : null;
}
export function tierBNoBankLine(t: TierYear): string | null {
  return t.b_nobank_n > 0 ? `${plural(t.b_nobank_n, 'tier B deduction', 'tier B deductions')} (${dollars(t.b_nobank_usd)}) have no bank line: they rest on the asset register or an owner ruling.` : null;
}
export function tier274Line(t: TierYear): string | null {
  return t.s274_needs_receipt_usd !== 0 ? `Section 274 lines that need a receipt and have none: ${dollars(t.s274_needs_receipt_usd)}; not caveated: ${dollars(t.s274_uncaveated_usd)}.` : null;
}
export function tierNoPayLine(t: TierYear): string | null {
  return t.no_pay_no_ruling_usd !== 0 ? `${dollars(t.no_pay_no_ruling_usd)} has no payment proof and no owner ruling.` : null;
}

// ── Ties to a statement line ──────────────────────────────────────────────────────────────────────────────────────────

export const TIE_DEFINITION = 'Here a bank line counts either way: the expense cites a statement line we hold, or a statement line lists the expense. The "no bank line" count under Finish your taxes counts only the second.';

/** The definitions the docket rests on, printed once for the whole page rather than on every year's card. */
export const LEGEND = {
  trusted: 'Trusted: the stored gate run passed every rule, neither the books nor the gate rules have changed since it ran, and no rule passed over zero records. Anything else is Not trusted, with the reason.',
  tiers: 'Tiers, by your rule that a bank line needs no explanation and its allocation does, and that a receipt on every line is needed only where section 274 requires one: A has a bank line, a cited allocation basis and a document; B has a bank line and a cited allocation basis; C is the rest.',
  ties: TIE_DEFINITION,
} as const;

export function tieHeadline(t: TieYear): string {
  return `${t.tied_n.toLocaleString('en-US')} of ${t.decisions.toLocaleString('en-US')} expenses tie to a statement line we hold`;
}
export function tieClasses(t: TieYear): { key: string; n: number; of: number; text: string }[] {
  return [
    { key: 'both', n: t.both_n, text: 'linked both ways: the expense cites the line and the line lists the expense' },
    { key: 'cites_only', n: t.cites_only_n, text: 'cite a statement line we hold; the line does not list them' },
    { key: 'cited_by_only', n: t.cited_by_only_n, text: 'are listed by a statement line; they cite none we hold' },
    { key: 'cites_missing', n: t.cites_missing_n, text: `cite lines that are not in the books (${t.links_resolved.toLocaleString('en-US')} of ${t.links.toLocaleString('en-US')} citations point at a line we hold)` },
    { key: 'none', n: t.none_n, text: 'have no bank citation' },
  ].map(c => ({ ...c, of: t.decisions }));
}
export const tieAmountLine = (t: TieYear) => `${t.amount_equal_n.toLocaleString('en-US')} of ${t.tied_n.toLocaleString('en-US')} tied expenses equal their statement lines to the cent`;

// ── Paperwork ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type PaperworkRead = 'loading' | 'ready' | 'error';
export function paperwork(y: GateYear, state: YearState | undefined, read: PaperworkRead): { headline: string; details: string[]; flags: string[] } {
  if (read === 'loading') return { headline: 'Reading the filing state…', details: [], flags: [] };
  if (read === 'error' || !state) return { headline: 'The filing state could not load', details: [], flags: [] };
  const filing = filingOf(state);
  const drafts = y.drafts_on_file > 1 ? [`${y.drafts_on_file.toLocaleString('en-US')} drafts on file`] : y.drafts_on_file === 0 ? ['No draft in the books'] : [];
  if (!filing) return { headline: 'Filing state not recorded', details: drafts, flags: [] };
  const earlier = forEarlierDraft(filing, y.draft_document_id);
  const word = FILING_WORDS[filing.state];
  const details = [filing.form ? `Form ${filing.form}` : '', filing.packet_pages ? `${filing.packet_pages.toLocaleString('en-US')} pages` : '',
    filing.deadline ? `deadline ${pacific(filing.deadline, false)}` : '', ...drafts,
    filing.from === 'legacy_hold' ? 'read from the filing-hold ruling' : ''].filter(Boolean);
  if (earlier) return { headline: `Recorded for an earlier draft: ${word} as of ${pacific(filing.as_of, false)}`, details, flags: [] };
  const flags: string[] = [];
  if (filing.state === 'mail_ready') {
    const run = y.run;
    if (!run) flags.push('Marked mail-ready, but the gate has not been run.');
    else if (run.rule_counts.fail > 0) flags.push('Marked mail-ready, but the gate has failing rules.');
    else if (run.rule_counts.not_assessed > 0) flags.push('Marked mail-ready, but the gate has rules not assessed.');
    else if (run.stale) flags.push('Marked mail-ready, but the gate run is stale.');
  }
  return { headline: `${word} as of ${pacific(filing.as_of, false)}`, details, flags };
}

// ── What is open ──────────────────────────────────────────────────────────────────────────────────────────────────────

export function openLine(open: OpenItemCounts): string {
  if (open.total === 0) return 'No return items open';
  const who = [open.owner ? `you ${open.owner}` : '', open.cpa ? `your CPA ${open.cpa}` : '', open.agent ? `books agent ${open.agent}` : '', open.unassigned ? `unassigned ${open.unassigned}` : ''].filter(Boolean).join(', ');
  return `${plural(open.total, 'return item', 'return items')} open: ${who}`;
}

// ── The profile door ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** "Trusted · Oct 29, 10:31 AM", "Gate not run", "1 rule failing · books changed since", with the open return items beside it. The reasons in full are in the docket. */
export function doorLine(y: GateYear): string {
  const v = gateVerdict(y);
  const head = v.state === 'trusted' ? `Trusted · ${pacific(y.run?.finished_at)}`
    : v.state === 'not_run' ? 'Gate not run'
    : v.state === 'did_not_finish' ? (y.attempt?.status === 'timed_out' ? `Gate did not finish (stopped at ${secondsOf(y.attempt.duration_ms)})` : 'Gate run failed')
    : ['Not trusted', ...shortCauses(y)].join(' · ');
  return y.open_items.total > 0 ? `${head} · ${y.open_items.total.toLocaleString('en-US')} open` : head;
}

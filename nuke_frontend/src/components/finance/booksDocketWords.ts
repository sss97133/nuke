import { describeRecord, dollars, pacific, type AttachedDocument, type CountDollars, type GateRule, type GateRun, type GateYear, type LargeSumRow, type LargeSumYear, type OpenItemCounts, type TieYear, type TierYear, type YearState } from '../../services/accountingCloseout';
import { formatMeasure, plural } from '../../kit';
import { FILING_WORDS, filingOf, forEarlierDraft } from './filingState';
import type { Tone } from './CloseItem';

/** The words of the books docket. The database decides every count, class, rule order and staleness; these functions only name them. Nothing here
 *  sums, divides or subtracts a number the reader did not already state (comparing two stated numbers is the one thing that is done), and a percentage is
 *  printed exactly as the view stores it. */

export const secondsOf = (ms: number) => `${Math.round(ms / 1000).toLocaleString('en-US')} s`;
export const pct = (value: number | null) => value === null ? 'unknown' : formatMeasure(value, '%');

// ── The reconciliation gate ───────────────────────────────────────────────────────────────────────────────────────────

export type VerdictState = 'trusted' | 'not_trusted' | 'not_run' | 'did_not_finish';
export type Verdict = { state: VerdictState; word: string; reason: string };
/** The colour a verdict, a rule or a total takes is one of three tones; the style sheet knows nothing else. */
export const VERDICT_TONE: Record<VerdictState, Tone> = { trusted: 'good', not_trusted: 'bad', did_not_finish: 'bad', not_run: 'warn' };

/** What keeps a stored run from being trusted, said once in two lengths: `long` for the verdict, `short` for places with little room (the profile door). The
 *  rule counts come first, then what changed since. */
type Cause = { key: 'fail' | 'not_assessed' | 'empty' | 'books' | 'gate'; long: string; short: string };
function causes(run: GateRun): Cause[] {
  const c = run.rule_counts;
  const out: Cause[] = [];
  if (c.fail > 0) out.push({ key: 'fail', long: `${c.fail} of ${c.total} rules failing`, short: `${plural(c.fail, 'rule', 'rules')} failing` });
  if (c.not_assessed > 0) out.push({ key: 'not_assessed', long: `${c.not_assessed} of ${c.total} rules not assessed`, short: `${plural(c.not_assessed, 'rule', 'rules')} not assessed` });
  if (c.empty > 0) {
    const named = run.rules.filter(r => r.status === 'pass' && r.of === 0).map(r => r.rule).join(', ');
    out.push({ key: 'empty', long: `${plural(c.empty, 'rule', 'rules')} had nothing to test (0 checked): ${named}`, short: `${plural(c.empty, 'rule', 'rules')} checked nothing` });
  }
  if (run.stale_books) out.push({ key: 'books', long: 'the books changed since the run', short: 'books changed since' });
  if (run.stale_gate) out.push({ key: 'gate', long: 'the gate rules changed since the run', short: 'gate rules changed since' });
  return out;
}

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
  const all = causes(run);
  const counted = all.filter(c => c.key !== 'books' && c.key !== 'gate').map(c => c.long);
  // "the books changed" and "the gate rules changed" are one clause when both are so
  const books = all.some(c => c.key === 'books'), gate = all.some(c => c.key === 'gate');
  const changed = books && gate ? 'the books and the gate rules changed since the run' : books ? 'the books changed since the run' : gate ? 'the gate rules changed since the run' : '';
  const reasons = changed ? [...counted, run.pass ? `the last run passed, but ${changed}` : changed] : counted;
  if (run.trusted && !reasons.length) return { state: 'trusted', word: 'Trusted', reason: `Passed ${run.rule_counts.pass} of ${run.rule_counts.total} rules on ${pacific(run.finished_at)}` };
  if (!reasons.length) reasons.push('the stored run does not qualify');
  return { state: 'not_trusted', word: 'Not trusted', reason: reasons.join('; ') };
}

/** The short causes of a run that is not trusted, for places with little room (the profile door): "1 rule failing", "books changed since". */
export function shortCauses(y: GateYear): string[] {
  return y.run ? causes(y.run).map(c => c.short) : [];
}

/** The gate row's first line, in the design's words. A stale pass is "Last run passed", never plain "Passed". */
export function gateRowLine(y: GateYear): string {
  const run = y.run, attempt = y.attempt;
  if (!run) {
    if (!attempt) return 'Not run';
    return attempt.status === 'timed_out' ? `Did not finish (stopped at ${secondsOf(attempt.duration_ms)})` : 'Run failed';
  }
  const rules = causes(run).find(c => c.key === 'fail' || c.key === 'not_assessed');
  if (rules) return rules.short;
  return `${run.stale ? 'Last run passed' : 'Passed'}, ${run.rule_counts.pass} of ${run.rule_counts.total} rules`;
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
export type RuleState = 'pass' | 'fail' | 'not_assessed' | 'empty';
export const ruleState = (r: GateRule): RuleState => r.status === 'fail' ? 'fail' : r.status === 'pass' ? (r.of === 0 ? 'empty' : 'pass') : 'not_assessed';
export const RULE_STATE_WORDS: Record<RuleState, string> = { pass: 'passed', fail: 'failing', not_assessed: 'not assessed', empty: 'nothing checked' };
export const RULE_TONE: Record<RuleState, Tone> = { pass: 'good', fail: 'bad', not_assessed: 'warn', empty: 'warn' };
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

/** C first: the share not yet supported is the number that matters. Every figure is a column of v_books_audit_tier_years; its dollars are net of credits. */
export function tierHeadline(t: TierYear): string {
  return `Tier C: ${t.c_n.toLocaleString('en-US')} of ${plural(t.deductions, 'deduction', 'deductions')}, ${dollars(t.c_usd)}, ${pct(t.c_pct)} of ${dollars(t.deduction_usd)} net of credits`;
}
export function tierExcludedLine(t: TierYear): string | null {
  return t.excluded_n > 0 ? `${plural(t.excluded_n, 'row', 'rows')} (${dollars(t.excluded_usd)}) are outside this count: credits, shares of an order that is counted on its own row, and pool allocations. They are not deductions of their own.` : null;
}
export function tierBNoBankLine(t: TierYear): string | null {
  return t.b_nobank_n > 0 ? `${plural(t.b_nobank_n, 'tier B deduction', 'tier B deductions')} (${dollars(t.b_nobank_usd)}) have no bank line: they rest on the asset register or an owner ruling.` : null;
}
export function tier274Line(t: TierYear): string | null {
  return t.s274_needs_receipt_usd !== 0 ? `Section 274 lines that need a receipt and have none: ${dollars(t.s274_needs_receipt_usd)} of ${dollars(t.s274_usd)} in section 274 lines; not caveated: ${dollars(t.s274_uncaveated_usd)}.` : null;
}
export function tierNoPayLine(t: TierYear): string | null {
  return t.no_pay_no_ruling_usd !== 0 ? `${dollars(t.no_pay_no_ruling_usd)} of ${dollars(t.deduction_usd)} has no payment proof and no owner ruling.` : null;
}

// ── Ties to a statement line ──────────────────────────────────────────────────────────────────────────────────────────

export const TIE_DEFINITION = 'Here a bank line counts either way: the expense cites a statement line we hold, or a statement line lists the expense. The "no bank line" count under Finish your taxes counts only the second.';

/** The definitions the docket rests on, printed once for the whole page rather than on every year's card. */
export const LEGEND = {
  paper: 'Large sums that need paper: the rows that make up 80% of a year\'s deduction dollars, each flagged when it has no bank line, no cited basis, or lacks the document its kind requires (an invoice, a purchase agreement or bill of sale, a receipt, a lease). Adding a file points it at the row; the row leaves the list when the books agent cites it.',
  trusted: 'Trusted: the stored gate run passed every rule, neither the books nor the gate rules have changed since it ran, and no rule passed over zero records. Anything else is Not trusted, with the reason.',
  tiers: 'Tiers, by your rule that a bank line needs no explanation and its allocation does, and that a receipt on every line is needed only where section 274 requires one: A has a bank line, a cited allocation basis and a document; B has a bank line and a cited allocation basis; C is the rest.',
  ties: TIE_DEFINITION,
  dollars: 'Dollars: the deduction totals and the tiers are net of credits. Rule R12 reads absolute amounts, credits counted as positive, so its totals are on that basis and say so.',
} as const;

export function tieHeadline(t: TieYear): string {
  return `${t.tied_n.toLocaleString('en-US')} of ${t.decisions.toLocaleString('en-US')} expenses tie to a statement line we hold`;
}
export function tieClasses(t: TieYear): { key: string; n: number; of: number; text: string }[] {
  return [
    { key: 'both', n: t.both_n, text: 'linked both ways: the expense cites the line and the line lists the expense' },
    { key: 'cites_only', n: t.cites_only_n, text: 'cite a statement line we hold; the line does not list them' },
    { key: 'cited_by_only', n: t.cited_by_only_n, text: 'are listed by a statement line; they cite none we hold' },
    { key: 'cites_missing', n: t.cites_missing_n, text: 'cite lines that are not in the books' },
    { key: 'none', n: t.none_n, text: 'have no bank citation' },
  ].map(c => ({ ...c, of: t.decisions }));
}
/** The year-wide tally of written citations, apart from the classes of decisions it is not the denominator of. */
export const tieCitationLine = (t: TieYear) => `${t.links_resolved.toLocaleString('en-US')} of ${plural(t.links, 'citation', 'citations')} written point at a statement line we hold`;
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

// ── The profile door ─────────────────────────────────────────────────────────────────────────────────────────────────

/** "Trusted · Oct 29, 10:31 AM", "Gate not run", "Not trusted · 1 rule failing · ran Oct 29, 10:31 AM · 64 of 125 large rows need a document · 2 open". The head says
 *  what the stored run found and when it ran; the paper is rule R12's own count of the rows it checked, as the run stored it. The reasons in full are in the docket. */
export function doorLine(y: GateYear): string {
  const v = gateVerdict(y);
  const ran = y.run ? `ran ${pacific(y.run.finished_at)}` : '';
  const head = v.state === 'trusted' ? `Trusted · ${pacific(y.run?.finished_at)}`
    : v.state === 'not_run' ? 'Gate not run'
    : v.state === 'did_not_finish' ? (y.attempt?.status === 'timed_out' ? `Gate did not finish (stopped at ${secondsOf(y.attempt.duration_ms)})` : 'Gate run failed')
    : ['Not trusted', ...shortCauses(y), ran].filter(Boolean).join(' · ');
  const r12 = y.run?.rules.find(r => r.rule === 'R12');
  const m = r12?.missing_doc;
  const paper = !m || m.n === 0 ? '' : typeof r12?.of === 'number' ? `${m.n.toLocaleString('en-US')} of ${r12.of.toLocaleString('en-US')} large rows need a document` : `${plural(m.n, 'large row needs', 'large rows need')} a document`;
  return [head, paper, y.open_items.total > 0 ? `${y.open_items.total.toLocaleString('en-US')} open` : ''].filter(Boolean).join(' · ');
}

// ── Large sums that need paper ────────────────────────────────────────────────────────────────────────────────────────

const humanize = (key: string) => key.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

/** What a row of the large sums is missing, by the rule that matched its category (v_books_large_sums.required_doc_rule). The view decides which
 *  rule matched; these only name it. A key the view starts to use that is not here is shown humanized, never dropped. */
export const PAPER_BY_RULE: Record<string, string> = {
  contractor: 'Contractor invoice', cost_of_goods: 'Supplier invoice', transport: 'Transport invoice', vehicle_deal: 'Purchase agreement or bill of sale',
  parts_supplies: 'Receipt or order confirmation', rent: 'Lease', depreciation: 'Asset register entry',
};
/** What the other flags of the view ask for (v_books_large_sums.proof_flag). */
export const FLAG_ASKS: Record<string, string> = {
  no_payment_proof: 'A bank line: no statement line is linked to this row',
  no_basis: 'A cited basis for how this row is allocated',
  filed_return_only: 'A document or ruling: only the filed return and its category support this row',
};

/** A screenshot of the text or email thread that states the work and the price is the agreement for an invoice or purchase-agreement row (owner ruling,
 *  2026-10-29; the view names the media it accepts). It is never a receipt, a lease, a title or a bill of sale, so those lists do not offer it. */
export const THREAD_KINDS = ['Text message thread', 'Email thread'];

/** The kinds of paper a row can require (v_books_large_sums.required_doc_kind), once each: how it reads, the button that offers a file for it, and the kinds of
 *  paper a file may be said to be, in the words the view reads (its keyword levels: 3 purchase agreement, bill of sale, title; 2 invoice, agreement,
 *  contract, work order; 1 receipt, order, confirmation, packing slip). A paper of a higher level also satisfies a lower requirement, so "Purchase agreement"
 *  would clear any of them; the list offers what the rule asks for. The order of the table is the order the kinds are listed in. A kind with no file to offer
 *  (the asset register is the books agent's) has no button and no offers. */
export const DOC_KIND: Record<string, { words: string; button?: string; offers?: string[] }> = {
  purchase_agreement: { words: 'Purchase agreement or bill of sale', button: 'Add the purchase agreement', offers: ['Purchase agreement', 'Bill of sale', 'Title', ...THREAD_KINDS] },
  invoice_or_agreement: { words: 'Invoice or agreement', button: 'Add the invoice', offers: ['Invoice', 'Agreement', 'Contract', 'Work order', ...THREAD_KINDS] },
  receipt_or_order: { words: 'Receipt or order confirmation', button: 'Add the receipt', offers: ['Receipt', 'Order confirmation', 'Packing slip'] },
  lease_or_ruling: { words: 'Lease or owner ruling', button: 'Add the lease', offers: ['Lease', 'Rental agreement'] },
  register_asset: { words: 'Asset register entry' },
};
const kindWords = (kind: string) => DOC_KIND[kind]?.words ?? humanize(kind);
/** For a row the rules flag without naming a kind of paper (resting on the filed return, or no cited basis): any supporting paper cites the row. */
export const ATTACH_ANY = ['Invoice', 'Receipt', 'Purchase agreement', 'Bill of sale', 'Agreement', 'Supporting document'];

/** The paper the row's rule requires, in words; null when the row misses no document. */
export function paperWord(row: LargeSumRow): string | null {
  if (!row.missing_doc) return null;
  return (row.required_doc_rule && PAPER_BY_RULE[row.required_doc_rule]) || (row.required_doc_kind && DOC_KIND[row.required_doc_kind]?.words)
    || (row.required_doc_rule ? humanize(row.required_doc_rule) : row.required_doc_kind ? humanize(row.required_doc_kind) : 'A document');
}
/** Everything the row still needs, document first. */
export function needsOf(row: LargeSumRow): string[] {
  const out: string[] = [];
  const paper = paperWord(row);
  if (paper) out.push(paper);
  if (row.proof_flag) out.push(FLAG_ASKS[row.proof_flag] ?? humanize(row.proof_flag));
  return out.length ? out : ['Flagged by the rules'];
}
/** The row can be answered with a file: it misses a document (the asset register is the books agent's), or rests only on the filed return, or has no cited basis. */
export const canAttach = (row: LargeSumRow): boolean =>
  (row.missing_doc && row.required_doc_kind !== 'register_asset') || row.proof_flag === 'filed_return_only' || row.proof_flag === 'no_basis';
/** The button on a row that a file can answer: it names the paper the rule asks for. A row already holding a file offers another. */
export const attachLabel = (row: LargeSumRow): string =>
  row.attached.length > 0 ? 'Add another' : (row.missing_doc && row.required_doc_kind && DOC_KIND[row.required_doc_kind]?.button) || 'Add a document';
export const attachChoices = (row: LargeSumRow): string[] => (row.missing_doc && row.required_doc_kind && DOC_KIND[row.required_doc_kind]?.offers) || ATTACH_ANY;
/** The row's payee and what was bought, from its booked description. */
export const rowTitle = (row: LargeSumRow): string => describeRecord(row.record.description).title || row.category || row.local_id;
/** What the row already cites as a document, as written (the view's own document cites): a row can cite a paper and still miss the kind its rule requires.
 *  The reader sends at most five cites; when the row cites more, the line says how many in all and shows the first three. */
export function citedLine(row: LargeSumRow): string | null {
  if (!row.cites.length) return null;
  const shown = row.cites.slice(0, 3).map(c => `${c.ref.length > 80 ? `${c.ref.slice(0, 78)}…` : c.ref} (${c.kind})`);
  return row.doc_cited_n > shown.length ? `Already cites ${plural(row.doc_cited_n, 'document', 'documents')}, among them: ${shown.join('; ')}` : `Already cites: ${shown.join('; ')}`;
}
/** One attached document, in words. The row stays flagged until the books writer cites it: this says received, never done. */
export function attachedLine(a: AttachedDocument): string {
  return `${a.doc_kind || 'Document'} · ${a.filename || 'file'} · attached ${pacific(a.attached_at)}`;
}
export const ATTACHED_WAITING = 'Document received, link pending: it is linked to this row when the books agent cites it, and the row stays on the list until then.';

/** The live heading of a year's list: how many of the head rows rule R12 tests are flagged, and how many need which answer. A row can need more than one. */
export function liveHeading(y: LargeSumYear): string {
  return [`${y.flagged_n.toLocaleString('en-US')} of the ${plural(y.head_n, 'largest deduction', 'largest deductions')} flagged`, `${plural(y.missing_doc_n, 'row needs', 'rows need')} a document`,
    `${plural(y.no_payment_n, 'row needs', 'rows need')} a bank line`, `${plural(y.filed_return_only_n, 'row rests', 'rows rest')} on the filed return only`].join(' · ');
}
export function liveCaption(y: LargeSumYear): string {
  const head = `Rule R12 tests the ${plural(y.head_n, 'largest deduction', 'largest deductions')}, the 80% line. A row can need more than one thing.`;
  const beyond = y.beyond_head_missing_doc_n > 0 ? ` ${plural(y.beyond_head_missing_doc_n, 'smaller deduction', 'smaller deductions')} below that line (${dollars(y.beyond_head_missing_doc_usd)}) also ${y.beyond_head_missing_doc_n === 1 ? 'misses' : 'miss'} a document; no rule tests them.` : '';
  const cap = y.rows_shown < y.flagged_n ? ` Showing the largest ${y.rows_shown.toLocaleString('en-US')} of ${y.flagged_n.toLocaleString('en-US')}.` : '';
  const unread = y.unreadable_rows > 0 ? ` ${plural(y.unreadable_rows, 'row', 'rows')} of the answer could not be read and ${y.unreadable_rows === 1 ? 'is' : 'are'} not listed; the totals count ${y.unreadable_rows === 1 ? 'it' : 'them'}.` : '';
  return head + beyond + cap + unread;
}

// ── The two totals, read live ─────────────────────────────────────────────────────────────────────────────────────────

/** The two totals at the top of a card are the live readers' own figures, the same rows the list and the drill show, so a total and the rows under it are
 *  one answer. The stored gate run supplies the verdict and, beside the totals, what it counted when it ran (driftLines). */
export type PaperTotal = { label: string; headline: string; details: string[]; tone?: Tone; rule: string; from: string };
/** A live read of the page's: loading, ready (data is undefined for a year the reader has no row for) or failed. */
export type LiveRead<T> = { data: T | undefined; phase: 'loading' | 'ready' | 'error' };
/** "Invoice or agreement 18 ($4,100) · Receipt or order confirmation 43 ($1,900)": the by-kind totals, in the order of the kinds, an unknown kind last. */
export function byKindLine(byKind: Record<string, CountDollars>): string {
  const order = Object.keys(DOC_KIND);
  const keys = Object.keys(byKind).sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b));
  return keys.map(k => `${kindWords(k)} ${byKind[k].n.toLocaleString('en-US')} (${dollars(byKind[k].amount)})`).join(' · ');
}

const R10B = { label: 'No bank line, no owner ruling, no rule', rule: 'R10 part b', from: 'v_books_audit_tier_years' };
const R12 = { label: 'Large deductions missing their document', rule: 'R12', from: 'v_books_large_sums' };
function unreadable(base: Pick<PaperTotal, 'label' | 'rule' | 'from'>, live: LiveRead<unknown> | undefined): PaperTotal | null {
  if (!live || live.phase === 'loading') return { ...base, headline: 'Reading…', details: [] };
  if (live.phase === 'error') return { ...base, headline: 'Could not load', details: [`${base.from} could not be read; the retry is further down this card.`], tone: 'warn' };
  return null;
}

/** Deductions with no bank line, no owner ruling and no structural rule (rule R10 part b), in dollars net of credits, of the year's deduction dollars: the
 *  audit tiers' own live figure (v_books_audit_tier_years). The deductions behind it are the rows the number opens. */
export function outsideBankTotal(live?: LiveRead<TierYear>): PaperTotal {
  const pending = unreadable(R10B, live);
  if (pending) return pending;
  const t = live?.data;
  if (!t) return { ...R10B, headline: 'No deductions are in the books for this year', details: [] };
  return { ...R10B, headline: `${dollars(t.no_pay_no_ruling_usd)} of ${dollars(t.deduction_usd)} in deductions, net of credits`,
    details: ['Deductions with no linked bank line, no owner ruling and no structural rule (rule R10 part b). A deduction resting on an owner ruling or the asset register is counted apart.'],
    tone: t.no_pay_no_ruling_usd !== 0 ? 'bad' : 'good' };
}

/** The large deductions that lack the document their kind requires (rule R12), in absolute dollars, of the head of the year's largest deductions: the
 *  live reader's own figure over the rows listed below it. This counts missing paper, not unreconciled money; the bank line is a separate flag on each row. */
export function missingDocTotal(live?: LiveRead<LargeSumYear>): PaperTotal {
  const pending = unreadable(R12, live);
  if (pending) return pending;
  const l = live?.data;
  if (!l) return { ...R12, headline: 'No deductions are in the books for this year', details: [] };
  const heads = `the ${l.head_n.toLocaleString('en-US')} largest deductions`;
  const headLine = `${heads.replace(/^the /, 'The ')} are the smallest set of the year's largest deductions that reaches 80% of its ${l.year_usd === null ? 'unknown total' : dollars(l.year_usd)} (absolute amounts, credits counted as positive; rule R12 tests them).`;
  if (l.missing_doc_n === 0) return { ...R12, headline: `None: every one of ${heads} has the document its kind requires`, details: [headLine], tone: 'good' };
  return { ...R12, headline: `${dollars(l.missing_doc_usd)} of ${dollars(l.head_usd)} in ${heads}`,
    details: [`${l.missing_doc_n.toLocaleString('en-US')} of those ${l.head_n.toLocaleString('en-US')} lack the document their kind requires; ${l.missing_doc_cite_no_document.toLocaleString('en-US')} of those ${l.missing_doc_cite_no_document === 1 ? 'cites' : 'cite'} no document at all.`,
      byKindLine(l.missing_doc_by_kind), 'This counts missing paper. Whether a row has a bank line is a separate flag, shown on the row and counted in the line above.', headLine],
    tone: 'bad' };
}

/** Where the stored gate run and the live readers disagree, the page says so with both numbers (the database's own): the books moved since the run. Nothing
 *  when they agree, when no run is stored, or while a live read is not in. */
export function driftLines(y: GateYear, sums: LargeSumYear | undefined, tier: TierYear | undefined): string[] {
  const run = y.run;
  if (!run) return [];
  const when = pacific(run.finished_at);
  const out: string[] = [];
  const stored = run.rules.find(r => r.rule === 'R12')?.missing_doc;
  if (stored && sums && (stored.n !== sums.missing_doc_n || stored.amount !== sums.missing_doc_usd)) {
    out.push(`The gate run of ${when} counted ${plural(stored.n, 'row', 'rows')} missing a document (${dollars(stored.amount)}); the list now has ${sums.missing_doc_n.toLocaleString('en-US')} (${dollars(sums.missing_doc_usd)}).`);
  }
  const part = run.context?.no_pay_no_ruling;
  if (part && tier && part.usd !== tier.no_pay_no_ruling_usd) {
    out.push(`The gate run of ${when} counted ${dollars(part.usd)} (${plural(part.n, 'deduction', 'deductions')}) with no bank line, no owner ruling and no rule; the deductions now stand at ${dollars(tier.no_pay_no_ruling_usd)}.`);
  }
  return out;
}

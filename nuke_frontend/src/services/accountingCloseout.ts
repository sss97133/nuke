import { supabase } from '../lib/supabase';
import type { SavedRecord } from '../components/finance/FinancialWorkpapers';

/** Typed reads of the close-out readers (migration 20261028174500). All are SECURITY INVOKER: the book's row
 *  policies decide what comes back; nothing here writes. */

export type CloseoutItemKey = 'expense_no_proof' | 'expense_no_receipt' | 'car_cost_no_car' | 'statement_gaps' | 'revenue_no_payer';
/** The classes of books_tier_records (migration 20261106130000): one per number of the audit-tier rollup. */
export type TierDrillKey = 'tier_a' | 'tier_b' | 'tier_c' | 'excluded' | 'b_no_bank' | 's274_needs_receipt' | 'no_pay_no_ruling';
/** What the office's one row list can be asked to list: a close-out item, or the decisions behind a tier number. */
export type DrillItem = CloseoutItemKey | TierDrillKey;
const TIER_DRILL_KEYS: readonly string[] = ['tier_a', 'tier_b', 'tier_c', 'excluded', 'b_no_bank', 's274_needs_receipt', 'no_pay_no_ruling'];
export const isTierDrill = (item: DrillItem): item is TierDrillKey => TIER_DRILL_KEYS.includes(item);
export type CloseoutItem = {
  key: CloseoutItemKey; n: number | null; of: number | null; amount: number | null; assessed: boolean; deferred?: boolean;
  accounts?: { account: string | null; months_without_lines: string[]; months_in_span: number }[];
};
export type ReturnDraft = {
  tax_year: string; form: string; result: 'owe' | 'refund'; amount: number | null; schedule_c_net: number | null;
  total_tax: number | null; agi: number | null; built_at: string | null; books_as_of: string | null;
  tax_per_1000_expense: number | null; status?: string; document_id: string; recorded_at: string;
  filing?: { method?: string; signers?: string; mail_to?: string; deadline?: string | null; before_signing?: string; open_items?: string };
};
export type CloseoutYear = {
  year: string; return: ReturnDraft | null; draft_stale: boolean | null; items: CloseoutItem[];
  books: { decisions: number; revenue_records: number; revenue: number | null; expense_records: number; expense: number | null; revised_at: string | null } | null;
};
export type Closeout = {
  read_at: string; books_revised_at: string | null; years: CloseoutYear[];
  questions: { pending_current: number; by_resolver: Record<string, number> };
};

export type RecordEvidence = {
  revised_at: string | null; strength: 'artifact' | 'keyed_source' | 'attestation' | 'narrative' | 'none';
  record: { local_id: string; kind: string; date: string | null; year: string; amount: string | null; currency: string | null;
    account: string | null; section: string | null; category: string | null; description: string | null; status: string | null };
  statement_lines: { document_id: string; source_key: string; local_id: string; date: string | null; amount: string | null; currency: string | null; account: string | null; description: string | null }[];
  linked_decisions: { document_id: string; source_key: string; local_id: string; date: string | null; amount: string | null; section: string | null; category: string | null }[];
  artifacts: { document_id: string; filename: string | null; kind: 'image' | 'pdf' | 'file'; via: string; issuer: string | null; date: string | null; amount: number | null; currency: string | null }[];
  use: { label: string | null; use_type: string | null; vehicle_id: string | null; allocated: string | null; unallocated: string | null; status: string | null; basis: string | null } | null;
  vehicles: { id: string; label: string; via: string }[];
  jobs: { id: string; title: string | null }[];
  messages: EvidenceMessage[];
  attestations: { by: string; at: string | null; text: string | null; via: string }[];
  questions: { id: string; type: string; resolver: string | null; detail: string | null }[];
  notes: string | null; source_cells: number;
  /** Added here, from record.description: the payee and what was bought, without the source references. */
  title: string | null;
  /** Sources the description names that resolve to no row yet (a statement period, a file, a transaction number). */
  cited: { kind: 'statement' | 'file' | 'reference'; text: string }[];
};
/** A message the record cites: a Gmail id (linkable) or a message on another channel, named by its channel. */
export type EvidenceMessage = { kind: 'gmail'; id: string; sent_at: string; quote: string | null } | { kind: 'channel'; channel: string; id: string; sent_at: string | null; quote: null };

export type ActivityPass = {
  actor_user_id: string | null; run_family: string | null; method: string | null; started_at: string; ended_at: string;
  revisions: number; documents: number; records_changed: number; years: Record<string, { records: number; amount: number | null }>;
  questions_opened: number; first_reading: boolean; latest_document_id: string; partial: boolean;
};

const fail = (what: string) => new Error(`${what} could not load.`);

export async function readCloseout(ownerId: string): Promise<Closeout> {
  const { data, error } = await supabase.rpc('accounting_closeout', { p_owner_id: ownerId });
  if (error || !data || !Array.isArray(data.years)) throw fail('The close-out');
  return data as Closeout;
}

/** One tax year's settled state (books_year_state, migration 20261101170000): Schedule C lines per schedule, owner
 *  rulings, return-level facts, the newest return result and open items with what closes each. */
/** The structured paperwork state of one year's return (a fact with topic filing, written by scripts/books/return_facts.py). */
export type FilingState = 'draft' | 'prepared' | 'mail_ready' | 'on_hold' | 'mailed' | 'filed';
export type FilingFact = { state: FilingState; as_of: string; form: string; packet_pages?: number; packet_document_id?: string; deadline?: string };
export type YearFact = {
  local_id: string; key: string; topic: string; status: 'settled' | 'open' | 'superseded'; date: string; decision: string;
  amount?: number; closes_with?: string; supersedes?: string; source: string | null;
  /** Who closes an open item: the owner, the CPA or the books agent. Absent means unassigned. */
  actor?: 'owner' | 'cpa' | 'agent';
  filing?: FilingFact;
};
export type YearState = {
  year: number; read_at: string;
  result: { form: string; result: 'owe' | 'refund'; amount: number; built_at: string | null; from: 'tax_return_summary' | 'return_fact'; amount_source?: string } | null;
  schedule_c: Record<string, Record<string, number>>;
  rulings: { local_id: string; schedule: string; line: string; label: string; amount: number | null; decision: string | null; date: string | null }[];
  facts: YearFact[]; open_items: YearFact[]; unmapped: string[];
};

export async function readYearState(ownerId: string, year: string): Promise<YearState> {
  const { data, error } = await supabase.rpc('books_year_state', { p_owner_id: ownerId, p_year: Number(year) });
  if (error || !data || typeof data.schedule_c !== 'object') throw fail('The year state');
  return data as YearState;
}

export async function readCloseoutRecords(ownerId: string, year: string, item: CloseoutItemKey, limit: number, offset: number):
  Promise<{ assessed: boolean; total: number | null; amount: number | null; rows: SavedRecord[] }> {
  const { data, error } = await supabase.rpc('accounting_closeout_records', { p_owner_id: ownerId, p_year: year, p_item: item, p_limit: limit, p_offset: offset });
  if (error || !data || !Array.isArray(data.rows)) throw fail('These records');
  return { assessed: data.assessed !== false, total: data.total ?? null, amount: data.amount ?? null, rows: data.rows as SavedRecord[] };
}

/** One automatic retry for a transient failure: under load the data API answers 503 or a read hits its statement cap, and the same read a moment later succeeds. */
export const RETRY_AFTER_MS = 1500;
export async function withOneRetry<T>(read: () => Promise<T>, delayMs = RETRY_AFTER_MS): Promise<T> {
  try { return await read(); } catch {
    await new Promise(resolve => setTimeout(resolve, delayMs));
    return read();
  }
}

/** books_year_state is read by the docket and by Finish your taxes; one in-flight or settled read per book, year and revision serves both.
 *  A failed read is not kept, so a retry reads again. */
const yearStateReads = new Map<string, Promise<YearState>>();
export function readYearStateOnce(ownerId: string, year: string, revision: string | undefined): Promise<YearState> {
  const key = `${ownerId}:${year}:${revision ?? ''}`;
  let read = yearStateReads.get(key);
  if (!read) {
    read = readYearState(ownerId, year);
    yearStateReads.set(key, read);
    read.catch(() => { if (yearStateReads.get(key) === read) yearStateReads.delete(key); });
    while (yearStateReads.size > 24) yearStateReads.delete(yearStateReads.keys().next().value as string);
  }
  return read;
}
export function clearYearStateReads(): void { yearStateReads.clear(); }

/** The proof a tier-drill row carries (books_tier_records): its tier, why, and the citations the audit-tier view used. */
export type RowProof = {
  tier: 'A' | 'B' | 'C' | 'X'; tier_reason: string; proof_basis: string | null;
  pay_proof: boolean; doc_proof: boolean; purpose_proof: boolean; has_owner_ruling: boolean; is_274: boolean; needs_receipt: boolean; is_caveat: boolean;
  structural_rule: string | null;
  payment_cites: string[]; document_cites: { kind: string; ref: string }[]; ruling_cites: { kind: string; ref: string }[];
  rule_cites: { basis: string; citation: string }[]; structural_cites: { rule: string; basis?: string; citation?: string; detail?: string }[] | null;
};

/** The decisions behind one tier number (books_tier_records, migration 20261106130000), in the envelope the close-out drill returns. */
export async function readTierRecords(ownerId: string, year: string, cls: TierDrillKey, limit: number, offset: number):
  Promise<{ assessed: boolean; total: number | null; amount: number | null; rows: SavedRecord[] }> {
  const { data, error } = await supabase.rpc('books_tier_records', { p_owner_id: ownerId, p_year: year, p_class: cls, p_limit: limit, p_offset: offset });
  if (error || !data || !Array.isArray(data.rows)) throw fail('These records');
  return { assessed: data.assessed !== false, total: data.total ?? null, amount: data.amount ?? null, rows: data.rows as SavedRecord[] };
}

/** The one reader behind the office's row list: a close-out item or a tier number. */
export function readDrillRecords(ownerId: string, year: string, item: DrillItem, limit: number, offset: number) {
  return isTierDrill(item) ? readTierRecords(ownerId, year, item, limit, offset) : readCloseoutRecords(ownerId, year, item, limit, offset);
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const numberOrNull = (value: unknown): number | null => value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;

/** One rule of a stored books_year_gate run, as books_gate_status returns it: sorted by the database, never with ids or detail text. */
export type GateRule = {
  rule: string; title: string; status: string; n: number | null; of: number | null; amount: number | null;
  grades?: Record<string, number>; ruling_only?: { n: number; amount: number | null };
  b_no_bank?: { n: number; amount: number | null }; excluded?: { n: number; amount: number | null };
};
export type GateRun = {
  id: string; started_at: string; finished_at: string; duration_ms: number; pass: boolean;
  stale: boolean; stale_books: boolean; stale_gate: boolean; trusted: boolean;
  rule_counts: { total: number; pass: number; fail: number; not_assessed: number; empty: number };
  rules: GateRule[];
};
export type GateAttempt = { status: 'complete' | 'timed_out' | 'error'; started_at: string; finished_at: string; duration_ms: number };
export type OpenItemCounts = { total: number; owner: number; cpa: number; agent: number; unassigned: number };
export type GateYear = {
  year: number; draft_document_id: string | null; drafts_on_file: number; attempt: GateAttempt | null; run: GateRun | null; open_items: OpenItemCounts;
};
export type GateStatus = {
  owner_id: string; read_at: string; book_signature: string; gate_md5: string | null;
  summary: { years: number; with_run: number; passed: number; trusted: number; failing: number; not_assessed: number; stale: number; open_items: number };
  years: GateYear[];
};

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function isGateYear(y: unknown): y is GateYear {
  if (!isRecord(y) || !Number.isInteger(y.year) || !Number.isInteger(y.drafts_on_file)) return false;
  if (!isRecord(y.open_items) || !['total', 'owner', 'cpa', 'agent', 'unassigned'].every(k => finite((y.open_items as Record<string, unknown>)[k]))) return false;
  if (y.attempt !== null && !(isRecord(y.attempt) && typeof y.attempt.status === 'string' && typeof y.attempt.finished_at === 'string')) return false;
  if (y.run === null) return true;
  const run = y.run;
  return isRecord(run) && typeof run.finished_at === 'string' && typeof run.pass === 'boolean' && typeof run.stale === 'boolean' && typeof run.trusted === 'boolean'
    && isRecord(run.rule_counts) && ['total', 'pass', 'fail', 'not_assessed', 'empty'].every(k => finite((run.rule_counts as Record<string, unknown>)[k]))
    && Array.isArray(run.rules) && run.rules.every(r => isRecord(r) && typeof r.rule === 'string' && typeof r.title === 'string' && typeof r.status === 'string');
}

/** The stored gate runs of the owner's book, per tax year (books_gate_status, migration 20261106110000). Cheap; never runs the gate. */
export async function readGateStatus(ownerId: string): Promise<GateStatus> {
  const { data, error } = await supabase.rpc('books_gate_status', { p_owner_id: ownerId });
  if (error || !isRecord(data) || !isRecord(data.summary) || !Array.isArray(data.years) || !data.years.every(isGateYear)
    || !['years', 'with_run', 'passed', 'trusted', 'failing', 'not_assessed', 'stale', 'open_items'].every(k => finite((data.summary as Record<string, unknown>)[k]))) {
    throw fail('The gate status');
  }
  return data as unknown as GateStatus;
}

/** One row of v_books_audit_tier_years, exactly as stored: the page prints these columns and computes nothing from them. */
export type TierYear = {
  year: string; decisions: number; deductions: number; total_usd: number; deduction_usd: number;
  a_usd: number; b_usd: number; c_usd: number; a_pct: number | null; b_pct: number | null; c_pct: number | null; a_n: number; b_n: number; c_n: number;
  excluded_n: number; excluded_usd: number; b_nobank_n: number; b_nobank_usd: number;
  s274_needs_receipt_usd: number; s274_uncaveated_usd: number; no_pay_no_ruling_usd: number;
};
const TIER_YEAR_COLUMNS = 'year, decisions, deductions, total_usd, deduction_usd, a_usd, b_usd, c_usd, a_pct, b_pct, c_pct, a_n, b_n, c_n, excluded_n, excluded_usd, b_nobank_n, b_nobank_usd, s274_needs_receipt_usd, s274_uncaveated_usd, no_pay_no_ruling_usd';
const TIER_YEAR_REQUIRED = ['decisions', 'deductions', 'total_usd', 'deduction_usd', 'a_usd', 'b_usd', 'c_usd', 'a_n', 'b_n', 'c_n', 'excluded_n', 'excluded_usd', 'b_nobank_n', 'b_nobank_usd',
  's274_needs_receipt_usd', 's274_uncaveated_usd', 'no_pay_no_ruling_usd'] as const;

export async function readTierYears(ownerId: string): Promise<TierYear[]> {
  const { data, error } = await supabase.from('v_books_audit_tier_years').select(TIER_YEAR_COLUMNS).eq('owner_id', ownerId).order('year');
  if (error || !Array.isArray(data)) throw fail('The deduction support');
  return (data as unknown as Record<string, unknown>[]).map(row => {
    if (typeof row.year !== 'string' || TIER_YEAR_REQUIRED.some(k => numberOrNull(row[k]) === null)) throw fail('The deduction support');
    const out: Record<string, unknown> = { year: row.year };
    for (const k of TIER_YEAR_REQUIRED) out[k] = Number(row[k]);
    for (const k of ['a_pct', 'b_pct', 'c_pct'] as const) out[k] = numberOrNull(row[k]);
    return out as unknown as TierYear;
  });
}

/** One row of v_books_citation_links (migration 20261106120000): every Expense decision of the year in exactly one class. */
export type TieYear = {
  year: string; decisions: number; both_n: number; cites_only_n: number; cited_by_only_n: number; cites_missing_n: number; none_n: number;
  links: number; links_resolved: number; tied_n: number; amount_equal_n: number;
};
const TIE_COLUMNS = ['decisions', 'both_n', 'cites_only_n', 'cited_by_only_n', 'cites_missing_n', 'none_n', 'links', 'links_resolved', 'tied_n', 'amount_equal_n'] as const;

export async function readCitationLinks(ownerId: string): Promise<TieYear[]> {
  const { data, error } = await supabase.from('v_books_citation_links').select(`year, ${TIE_COLUMNS.join(', ')}`).eq('owner_id', ownerId).order('year');
  if (error || !Array.isArray(data)) throw fail('The statement ties');
  return (data as unknown as Record<string, unknown>[]).map(row => {
    if (typeof row.year !== 'string' || TIE_COLUMNS.some(k => numberOrNull(row[k]) === null)) throw fail('The statement ties');
    const out: Record<string, unknown> = { year: row.year };
    for (const k of TIE_COLUMNS) out[k] = Number(row[k]);
    return out as unknown as TieYear;
  });
}

/** Split a balanced trailing "( … )" off a phrase; repeated, it peels every trailing group. */
function peelTrailingGroups(text: string): { head: string; groups: string[] } {
  let head = text.trim();
  const groups: string[] = [];
  while (head.endsWith(')')) {
    let depth = 0, start = -1;
    for (let i = head.length - 1; i >= 0; i--) {
      if (head[i] === ')') depth++;
      else if (head[i] === '(' && --depth === 0) { start = i; break; }
    }
    if (start < 0) break;
    groups.unshift(head.slice(start + 1, -1).trim());
    head = head.slice(0, start).trim();
  }
  return { head, groups };
}
/** Split on a separator outside parentheses. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0, from = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && text.startsWith(separator, i)) { parts.push(text.slice(from, i)); from = i + separator.length; }
  }
  parts.push(text.slice(from));
  return parts.map(part => part.trim()).filter(Boolean);
}
const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
const FILE = /^[\w.-]+\.(jpe?g|png|heic|pdf|csv|xlsx?)$/i;

/** A booked description reads "Payee (role) — what was bought (who said so) (source; source)". Keep payee and purchase as the title;
 *  turn each source reference into the structured line it names. Unrecognized text stays in `cited`, never dropped. */
export function describeRecord(description: string | null | undefined): Pick<RecordEvidence, 'title' | 'messages' | 'attestations' | 'cited'> {
  const out: Pick<RecordEvidence, 'title' | 'messages' | 'attestations' | 'cited'> = { title: null, messages: [], attestations: [], cited: [] };
  const text = (description || '').replace(/\s+/g, ' ').trim();
  if (!text) return out;
  const [payeePart, ...rest] = splitTopLevel(text, ' — ');
  const short = (title: string) => title.length <= 90 ? title : `${title.slice(0, 88).replace(/\s+\S*$/, '')}…`;
  if (!rest.length) { out.title = short(text); return out; }
  const payee = peelTrailingGroups(payeePart);
  // "O'reilly 4748 (o'reilly 4748)" repeats the payee; "(upholstery / labor)" says what was bought.
  const same = (a: string, b: string) => a.toLowerCase().startsWith(b.toLowerCase()) || b.toLowerCase().startsWith(a.toLowerCase());
  const role = payee.groups.find(g => !same(g, payee.head));
  const first = peelTrailingGroups(rest[0]);
  const references: string[] = [...first.groups];
  // "order 111-… of 13 Oct: sanding sponges, …" or "bumper; order 72727993; paid …": the goods lead, the keys follow.
  const keyed = first.head.match(/^(.*\b(?:order|invoice|receipt)\b[^:]*):\s*(.+)$/i);
  const [goods, ...keys] = keyed ? [keyed[2], keyed[1]] : splitTopLevel(first.head, ';');
  for (const key of keys) out.cited.push({ kind: 'reference', text: key });
  const purchase = !goods ? '' : FILE.test(goods) ? (out.cited.push({ kind: 'file', text: goods }), '') : goods;
  // When the payee's own parenthesis names the work, the purchase line is kept as a detail, not lost.
  if (role && purchase) out.cited.unshift({ kind: 'reference', text: purchase });
  for (const extra of rest.slice(1)) {
    const peeled = peelTrailingGroups(extra);
    if (peeled.head) out.cited.push({ kind: FILE.test(peeled.head) ? 'file' : 'reference', text: peeled.head });
    references.push(...peeled.groups);
  }
  const named = new Set<string>();
  for (const reference of references.flatMap(group => splitTopLevel(group, ';'))) {
    const message = reference.match(/^(.*?)\bmessage ([0-9A-F]{6,})\b\s*(?:\((\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?Z?)\))?$/i);
    const dated = reference.match(/^([A-Z][\w'-]*) (\d{4}-\d{2}-\d{2})(?::\s*(.+))?$/);
    const closeout = reference.match(/^([A-Z][\w'-]*) (closeout|attestation|confirmed) (\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})$/);
    if (message) {
      const at = message[3] ? `${message[3].replace(/Z$/, '')}${message[3].length === 16 ? ':00' : ''}Z` : null;
      out.messages.push({ kind: 'channel', channel: message[1].trim() || 'Message', id: message[2], sent_at: at, quote: null });
    } else if (dated) {
      named.add(dated[1]);
      out.attestations.push({ by: dated[1], at: dated[2], text: dated[3] || null, via: 'stated' });
    } else if (closeout && MONTHS[closeout[4].toLowerCase()]) {
      named.add(closeout[1]);
      out.attestations.push({ by: closeout[1], at: `${closeout[5]}-${MONTHS[closeout[4].toLowerCase()]}-${closeout[3].padStart(2, '0')}`, text: null, via: closeout[2] });
    } else if (/^[A-Z][\w'-]*$/.test(reference)) {
      // "(Name)": who supplied the classification. Recorded as their word, without a date.
      if (!named.has(reference)) { named.add(reference); out.attestations.push({ by: reference, at: null, text: null, via: 'stated' }); }
    } else {
      out.cited.push({ kind: /statement|history/i.test(reference) ? 'statement' : FILE.test(reference) ? 'file' : 'reference', text: reference });
    }
  }
  // A dated attestation by the same person supersedes their undated one.
  out.attestations = out.attestations.filter(a => a.at || !out.attestations.some(b => b.by === a.by && b.at));
  out.title = short([payee.head, role || purchase].filter(Boolean).join(' — ') || text);
  return out;
}

const STRENGTH_ORDER: RecordEvidence['strength'][] = ['none', 'narrative', 'attestation', 'keyed_source', 'artifact'];

export async function readRecordEvidence(ownerId: string, documentId: string, sourceKey: string): Promise<RecordEvidence | null> {
  const { data, error } = await supabase.rpc('accounting_record_evidence', { p_owner_id: ownerId, p_document_id: documentId, p_source_key: sourceKey });
  if (error) throw fail('The evidence');
  if (data === null || data === undefined) return null;
  const e = data as RecordEvidence;
  const arrays = ['statement_lines', 'linked_decisions', 'artifacts', 'vehicles', 'jobs', 'messages', 'attestations', 'questions'] as const;
  if (typeof e !== 'object' || !e.record || typeof e.record !== 'object' || arrays.some(key => !Array.isArray(e[key]))) throw fail('The evidence');
  const described = describeRecord(e.record.description);
  const messages = [...e.messages, ...described.messages.filter(m => !e.messages.some(known => known.id === m.id))];
  const attestations = [...e.attestations, ...described.attestations];
  // References parsed from the description lift the strength the same way the reader's own would.
  const lifted = described.messages.length ? 'keyed_source' : described.attestations.some(a => a.at) ? 'attestation' : e.strength;
  const strength = STRENGTH_ORDER.indexOf(lifted) > STRENGTH_ORDER.indexOf(e.strength) ? lifted : e.strength;
  // A file the description names that the reader already resolved to a document is shown once, as that document.
  const cited = described.cited.filter(c => c.kind !== 'file' || !e.artifacts.some(a => a.filename === c.text));
  return { ...e, strength, messages, attestations, title: described.title, cited };
}

export async function readActivityPasses(ownerId: string, limit = 12): Promise<ActivityPass[]> {
  const { data, error } = await supabase.rpc('accounting_activity_runs', { p_owner_id: ownerId, p_limit: limit });
  if (error || !Array.isArray(data)) throw fail('Activity');
  return (data as ActivityPass[]).filter(p => p && typeof p === 'object' && p.years && typeof p.years === 'object' && typeof p.started_at === 'string' && typeof p.latest_document_id === 'string');
}

/** The private original of a financial document, verified by the server against its hash (existing `original` action). */
export async function fetchAccountingOriginal(ownerId: string, documentId: string): Promise<{ blob: Blob; filename: string }> {
  const result = await supabase.functions.invoke('ingest-observation', { body: { mode: 'financial_evidence_v1', action: 'original', owner_user_id: ownerId, document_id: documentId } });
  const source = result.data?.data;
  if (result.error || !source?.bytes_base64) throw new Error('Original unavailable or access revoked.');
  const bytes = Uint8Array.from(atob(source.bytes_base64), c => c.charCodeAt(0));
  return { blob: new Blob([bytes], { type: source.mime_type || 'application/octet-stream' }), filename: source.source_filename || 'accounting-original' };
}

/** Pacific wall-clock time, the owner's clock. */
export function pacific(iso: string | null | undefined, withTime = true): string {
  if (!iso) return 'unknown';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'unknown';
  // A calendar date (a bank or document date) has no clock: show it as written, never shifted into a time zone.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return new Date(t).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
  return new Date(t).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}) });
}

/** Whole dollars, the way the return prints them. */
export function dollars(value: number | string | null | undefined): string {
  const n = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(n)) return 'unknown';
  return `${n < 0 ? '−' : ''}$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
}

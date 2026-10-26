import { supabase } from '../lib/supabase';
import type { SavedRecord } from '../components/finance/FinancialWorkpapers';

/** Typed reads of the close-out readers (migration 20261028174500). All are SECURITY INVOKER: the book's row
 *  policies decide what comes back; nothing here writes. */

export type CloseoutItemKey = 'expense_no_proof' | 'expense_no_receipt' | 'car_cost_no_car' | 'statement_gaps' | 'revenue_no_payer';
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

export async function readCloseoutRecords(ownerId: string, year: string, item: CloseoutItemKey, limit: number, offset: number):
  Promise<{ assessed: boolean; total: number | null; amount: number | null; rows: SavedRecord[] }> {
  const { data, error } = await supabase.rpc('accounting_closeout_records', { p_owner_id: ownerId, p_year: year, p_item: item, p_limit: limit, p_offset: offset });
  if (error || !data || !Array.isArray(data.rows)) throw fail('These records');
  return { assessed: data.assessed !== false, total: data.total ?? null, amount: data.amount ?? null, rows: data.rows as SavedRecord[] };
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

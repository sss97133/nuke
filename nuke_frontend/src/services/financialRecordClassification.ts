import { supabase } from '../lib/supabase';
import { carriedRevision, readAccountingSnapshot, type AccountingSnapshot } from './financialExpenseUse';

// Revision JSON is shaped and checked by the writer; typed loosely here as in financialExpenseUse.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
/** What a reviewer chooses for one or more records. */
export type Classification = { section: string; category: string; note: string };
/** A record as the reviewer saw it when choosing. A different current value means someone else changed it since. */
export type ClassificationTarget = { source_key: string; section: string | null; category: string | null };
export type ClassificationConflict = { source_key: string; section: string | null; category: string | null };
export type ClassificationOutcome = {
  /** Source keys written by this revision, with the records as written. */
  saved: string[]; records: Json[];
  /** Records that already carried the chosen classification. */
  unchanged: string[];
  /** Records another reviewer changed after this reviewer saw them; left as they are. */
  conflicts: ClassificationConflict[];
};

export const CLASSIFICATION_FIELD = 'record_classification_review';
export const classificationLabel = (section?: string | null, category?: string | null) => section ? `${section}${category ? ` · ${category}` : ''}` : 'Unclassified';
const same = (a?: string | null, b?: string | null) => (a || '') === (b || '');
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const MAX_ATTEMPTS = 4;

/** One complete revision of a source that classifies the given records and carries everything else unchanged. */
export function classificationCorrection(snapshot: AccountingSnapshot, sourceKeys: string[], next: Classification, requestId: string) {
  const section = next.section.trim(), category = next.category.trim(), note = next.note.trim();
  if (!section || section.length > 80) throw new Error('Choose a classification.');
  if (category.length > 200) throw new Error('Keep the category under 200 characters.');
  if (note.length > 500) throw new Error('Keep the note under 500 characters.');
  const keys = new Set(sourceKeys);
  const { fields: carried, records: current, lines, concerns } = carriedRevision(snapshot);
  const prior: Record<string, string> = {};
  const written: Json[] = [];
  const records = current.map(record => {
    if (!keys.has(record.source_key)) return record;
    const was = classificationLabel(record.section, record.category);
    prior[record.local_id] = was;
    const next = { ...record, section, category, status: 'Reviewer classification',
      decision: `${note ? `${note} ` : ''}Reviewer classification: ${classificationLabel(section, category)} (was ${was}).` };
    written.push(next);
    return next;
  });
  if (written.length !== keys.size) throw new Error('A selected record is no longer in its source. Reload and try again.');
  const value: Json = { scope_source_keys: [...keys], section, category, ...(note ? { note } : {}), status: 'reviewer_classification', prior };
  if (bytes(value) > 3800) delete value.prior;
  if (bytes(value) > 3900) throw new Error('Classify fewer records of this source at once.');
  const fields = carried.filter(f => f.field_key !== CLASSIFICATION_FIELD);
  fields.push({ field_key: CLASSIFICATION_FIELD, value_type: 'text', value_normalized: value,
    value_raw: `${keys.size} record${keys.size === 1 ? '' : 's'} classified as ${classificationLabel(section, category)}${note ? `; ${note}` : ''}`.slice(0, 2000),
    evidence: { stage: 'record_classification_review', source_kind: 'authenticated_reviewer_decision', prior_run_id: snapshot.runId, ...(note ? { basis: note } : {}) } });
  if (fields.length > 100) throw new Error('This source has reached its field limit. No evidence has been changed.');
  const doc = snapshot.document;
  return { written, payload: { mode: 'financial_evidence_v1', action: 'correct', owner_user_id: doc.owner_id,
    original: { sha256: doc.content_sha256, storage_path: doc.storage_path, source_filename: doc.source_filename, source_kind: doc.source_kind },
    revision: { idempotency_key: `record-classification:${requestId}`, method: 'authenticated-record-classification', version: '1', supersedes_run_id: snapshot.runId, fields, accounting_records: records, lines, concerns } } };
}

/** Classifies records of one source through the attributed writer. When another reviewer saved a newer revision of the
 *  source first, it is read again and the change applied on top of it, so their other edits are kept. A record someone
 *  else changed after this reviewer saw it is reported as a conflict and left as it is. */
export async function classifyRecords(ownerId: string, documentId: string, targets: ClassificationTarget[], next: Classification): Promise<ClassificationOutcome> {
  let snapshot = await readAccountingSnapshot(ownerId, documentId);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const outcome: ClassificationOutcome = { saved: [], records: [], unchanged: [], conflicts: [] };
    for (const target of targets) {
      const current = snapshot.records.find(r => r.source_key === target.source_key);
      if (!current) throw new Error('A selected record is no longer in its source. Reload and try again.');
      const asChosen = same(current.section, next.section.trim()) && same(current.category, next.category.trim());
      if (asChosen && !next.note.trim()) outcome.unchanged.push(target.source_key);
      else if (asChosen || (same(current.section, target.section) && same(current.category, target.category))) outcome.saved.push(target.source_key);
      else outcome.conflicts.push({ source_key: target.source_key, section: current.section ?? null, category: current.category ?? null });
    }
    if (!outcome.saved.length) return outcome;
    const { written, payload } = classificationCorrection(snapshot, outcome.saved, next, crypto.randomUUID());
    const response = await supabase.functions.invoke('ingest-observation', { body: payload });
    if (!response.error && !response.data?.error) return { ...outcome, records: written };
    const latest = await readAccountingSnapshot(ownerId, documentId);
    if (latest.runId === snapshot.runId) throw new Error('The ledger refused this change and nothing was saved. Remove any account number from the note, or reload and try again.');
    snapshot = latest;
  }
  throw new Error('This source kept changing while saving. Nothing was overwritten. Try again in a moment.');
}

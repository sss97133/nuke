import { supabase } from '../lib/supabase';

type Json = Record<string, any>;
/** Shop and vehicle serve the restoration business; software and image_production are the two NUKE LTD activities. */
export const EXPENSE_USE_TYPES = ['shop', 'vehicle', 'software', 'image_production', 'unassigned'] as const;
export type ExpenseUseType = typeof EXPENSE_USE_TYPES[number];
export const EXPENSE_USE_LABELS: Record<Exclude<ExpenseUseType, 'vehicle'>, string> = { shop: 'Shop', software: 'NUKE software development', image_production: 'Photography & image production', unassigned: 'Unassigned' };
const useTypes: readonly string[] = EXPENSE_USE_TYPES;
export type ExpenseUse = { source_key: string; use_type: ExpenseUseType; destination_label: string; vehicle_id: string | null; allocated_amount: string | null; unallocated_amount: string; basis: string; status?: string };
export type ExpenseSnapshot = { document: Json; fields: Json[]; lines: Json[]; concerns?: Json[]; record: Json; runId: string; use: ExpenseUse | null };
const object = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const hash = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export const expenseUseKey = (sourceKey: string) => `expense_use_${sourceKey.slice(0, 24)}`;
export function decimalUnits(value: string): bigint {
  if (!/^-?\d{1,12}(?:\.\d{1,6})?$/.test(value)) throw new Error('Enter an amount with at most six decimal places.');
  const [whole, fraction = ''] = value.replace('-', '').split('.');
  return (BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'))) * (value.startsWith('-') ? -1n : 1n);
}
const decimalString = (value: bigint) => `${value < 0n ? '-' : ''}${(value < 0n ? -value : value) / 1000000n}.${String((value < 0n ? -value : value) % 1000000n).padStart(6, '0')}`;

export async function readExpenseSnapshot(ownerId: string, documentId: string, sourceKey: string): Promise<ExpenseSnapshot> {
  const [read, original] = await Promise.all([
    supabase.functions.invoke('ingest-observation', { body: { mode: 'financial_evidence_v1', action: 'read', owner_user_id: ownerId, document_id: documentId, include_context: false } }),
    supabase.from('financial_documents').select('id, owner_id, content_sha256, storage_path, source_filename, source_kind').eq('id', documentId).eq('owner_id', ownerId).single(),
  ]);
  const data = read.data?.data;
  if (read.error || read.data?.error || original.error || !data || !Array.isArray(data.fields) || !Array.isArray(data.lines) || data.concerns_truncated || original.data?.owner_id !== ownerId) throw new Error('Current expense unavailable. Check your accounting access.');
  const records = data.lines.map((line: Json) => line.attributes?.accounting_record).filter(object);
  const record = records.find((r: Json) => r.source_key === sourceKey);
  const runs = new Set(data.fields.map((f: Json) => f.extraction_run_id));
  if (!record || record.record_kind !== 'retained_ledger_decision' || record.section !== 'Expense' || !hash.test(sourceKey) || runs.size !== 1 || !uuid.test(String([...runs][0]))) throw new Error('A complete current expense revision is required.');
  const field = data.fields.find((f: Json) => f.field_key === expenseUseKey(sourceKey));
  const use = field?.value_normalized?.value;
  if (use && (!object(use) || use.source_key !== sourceKey || !useTypes.includes(use.use_type) || typeof use.destination_label !== 'string' || typeof use.basis !== 'string')) throw new Error('Expense-use reference conflict.');
  return { document: original.data, fields: data.fields, lines: data.lines, concerns: data.concerns || [], record, runId: String([...runs][0]), use: use || null };
}

/** Complete attributed correction through the existing writer and stale-run gate. */
export function expenseUseCorrection(snapshot: ExpenseSnapshot, use: ExpenseUse, requestId: string) {
  const { document: doc, record } = snapshot;
  if (!hash.test(record.source_key) || use.source_key !== record.source_key || !useTypes.includes(use.use_type)) throw new Error('Choose an expense destination.');
  if (use.basis.trim().length < 1 || use.basis.length > 500 || use.destination_label.length > 200) throw new Error('Add a short reason for the assignment.');
  if (use.use_type === 'vehicle' ? !uuid.test(use.vehicle_id || '') : use.vehicle_id !== null) throw new Error('Select the actual recipient vehicle.');
  const total = decimalUnits(record.amount ?? '');
  const amount = decimalUnits(use.use_type === 'unassigned' ? '0' : use.allocated_amount ?? '');
  if (total >= 0n ? amount < 0n || amount > total : amount > 0n || amount < total) throw new Error('The assigned amount must keep the expense sign and cannot exceed the recorded expense.');
  const value = { ...use, allocated_amount: decimalString(amount), unallocated_amount: decimalString(total - amount), book_amount: record.amount, currency: record.currency, ledger_id: record.local_id, year: record.year, status: 'reviewer_assigned_use', new_expense: false, payment_match_changed: false };
  const key = expenseUseKey(record.source_key);
  const fields = snapshot.fields.map(f => {
    const wrapper = f.value_normalized;
    if (f.field_key === 'redacted_source' || !object(wrapper) || !('value' in wrapper) || !object(wrapper.evidence)) throw new Error('This source needs its specialized correction flow; no evidence has been changed.');
    return { field_key: f.field_key, value_raw: f.value_raw, value_type: f.value_type, value_normalized: wrapper.value, evidence: wrapper.evidence };
  }).filter(f => f.field_key !== key);
  fields.push({ field_key: key, value_raw: `${use.destination_label}; ${use.basis}`, value_type: 'text', value_normalized: value, evidence: { stage: 'expense_use_reconciliation', source_kind: 'authenticated_reviewer_decision', source_key: record.source_key, prior_run_id: snapshot.runId, basis: use.basis } });
  if (fields.length > 100) throw new Error('This source has reached its field limit. No evidence has been changed.');
  const records = snapshot.lines.filter(l => object(l.attributes?.accounting_record)).map(l => l.attributes.accounting_record);
  const lines = snapshot.lines.filter(l => object(l.attributes?.staging)).map(l => l.attributes.staging);
  const concerns = (snapshot.concerns || []).filter(q => q.status === 'pending' && (q.is_current_revision === true || !q.confidence_factors?.extraction_run_id)).map(q => ({ concern_type: q.concern_type, priority: q.priority, detail: q.detail || '', resolver: q.resolver }));
  if (concerns.length > 30) throw new Error('This source needs its complete concern review before correction.');
  return { mode: 'financial_evidence_v1', action: 'correct', owner_user_id: doc.owner_id,
    original: { sha256: doc.content_sha256, storage_path: doc.storage_path, source_filename: doc.source_filename, source_kind: doc.source_kind },
    revision: { idempotency_key: `expense-use-edit:${requestId}`, method: 'authenticated-expense-use-review', version: '1', supersedes_run_id: snapshot.runId, fields, accounting_records: records, lines, concerns } };
}

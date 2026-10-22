import { supabase } from '../lib/supabase';

const MAX_BUNDLE = 50 * 1024 * 1024;
const MAX_ORIGINAL = 10 * 1024 * 1024;
const ORIGINAL_MIME: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', heic: 'image/heic', csv: 'text/csv' };
const HASH = /^[a-f0-9]{64}$/;
const DECIMAL = /^-?\d{1,12}(\.\d{1,6})?$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
type Json = Record<string, unknown>;
interface Revision { local_ref: string; supersedes_local_ref: string | null; revision: Json; }
interface Item { original: { sha256: string; source_filename: string; source_kind: string }; bytes: Uint8Array; revisions: Revision[]; }
export interface RestoreProgress { stage: 'validating' | 'uploading' | 'admitting' | 'verifying'; completed: number; total: number; }
export interface RestoreResult { documents: number; revisions: number; verified: number; expense_posted: false; tax_ready: false; }
const object = (x: unknown): x is Json => !!x && typeof x === 'object' && !Array.isArray(x);
function requireShape(condition: unknown, message = 'Invalid retained evidence bundle.'): asserts condition {
  if (!condition) throw new Error(message);
}
function keys(x: Json, allowed: string[]) { return Object.keys(x).every(k => allowed.includes(k)); }
function bounded(x: unknown, max: number): x is string { return typeof x === 'string' && x.length > 0 && x.length <= max; }
// A repeated-group regex can exhaust the engine stack on ordinary image bytes.
// Scan once with constant auxiliary space; padding is legal only at the end.
function base64Shape(value: string): boolean {
  if (value.length % 4 !== 0) return false;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  for (let i = 0; i < value.length - padding; i++) {
    const c = value.charCodeAt(i);
    if (!(c >= 65 && c <= 90 || c >= 97 && c <= 122 || c >= 48 && c <= 57 || c === 43 || c === 47)) return false;
  }
  return true;
}
async function digest(bytes: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)), b => b.toString(16).padStart(2, '0')).join('');
}
// Match jsonb textual byte bounds (spaces after separators), not JS UTF-16 length.
function jsonbBytes(x: unknown): number {
  const serialize = (v: unknown): string => Array.isArray(v) ? '[' + v.map(serialize).join(', ') + ']'
    : object(v) ? '{' + Object.entries(v).map(([k, value]) => JSON.stringify(k) + ': ' + serialize(value)).join(', ') + '}'
    : JSON.stringify(v ?? null);
  return new TextEncoder().encode(serialize(x)).length;
}
function privateRevision(x: unknown, depth = 0): void {
  requireShape(depth <= 32);
  if (typeof x === 'number') requireShape(Number.isFinite(x) && Math.abs(x) <= Number.MAX_SAFE_INTEGER && (Number.isInteger(x) || Math.abs(x) >= 0.000001));
  if (typeof x === 'string') requireShape(!x.includes('\u0000') && x.length <= 2000 && !/[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}/.test(x));
  if (Array.isArray(x)) x.forEach(v => privateRevision(v, depth + 1));
  else if (object(x)) for (const [k, v] of Object.entries(x)) {
    requireShape(!k.includes('\u0000') && !['ocr_text', 'raw_text', 'full_ocr', 'full_text', 'iban', 'bank_iban', 'full_iban'].includes(k.toLowerCase()));
    privateRevision(v, depth + 1);
  }
}
function validateRevision(r: unknown): asserts r is Json {
  requireShape(object(r) && keys(r, ['idempotency_key', 'method', 'version', 'fields', 'concerns', 'lines', 'accounting_records']));
  privateRevision(r);
  requireShape(bounded(r.idempotency_key, 200) && bounded(r.method, 120) && bounded(r.version, 120));
  requireShape(jsonbBytes(r) <= 240000 && Array.isArray(r.fields) && r.fields.length >= 1 && r.fields.length <= 100);
  const fieldKeys = new Set<string>();
  for (const f of r.fields) {
    requireShape(object(f) && keys(f, ['field_key', 'value_raw', 'value_normalized', 'value_type', 'page_number', 'evidence']));
    requireShape(bounded(f.field_key, 160) && !fieldKeys.has(f.field_key) && !['ocr_text', 'raw_text', 'full_ocr', 'full_text', 'redacted_source'].includes(f.field_key.toLowerCase()));
    fieldKeys.add(f.field_key);
    requireShape(bounded(f.value_raw, 2000) && object(f.evidence) && Object.keys(f.evidence).length > 0 && jsonbBytes(f.evidence) <= 4000);
    requireShape(jsonbBytes(f.value_normalized ?? null) <= 4000);
    requireShape(f.value_type === undefined || ['text', 'amount', 'date', 'number', 'percentage', 'identifier', 'iban', 'bic', 'tax_id', 'currency', 'email', 'phone', 'url', 'event'].includes(String(f.value_type)));
    requireShape(f.page_number === undefined || f.page_number === null || Number.isSafeInteger(f.page_number) && Number(f.page_number) > 0 && Number(f.page_number) <= 2147483647);
  }
  for (const name of ['lines', 'accounting_records', 'concerns']) {
    const list = r[name]; if (list === undefined) continue;
    requireShape(Array.isArray(list) && list.length <= (name === 'concerns' ? 30 : name === 'accounting_records' ? 100 : 500) && list.every(object));
    if (name !== 'concerns') requireShape(new Set(list.map(x => x[name === 'lines' ? 'source_line_key' : 'source_key'])).size === list.length);
    if (name === 'concerns') for (const q of list) {
      requireShape(keys(q, ['concern_type', 'priority', 'detail', 'resolver']) && bounded(q.resolver, 120));
      requireShape(['montant_non_corrobore', 'ecart_arithmetique', 'ecart_tva', 'doublon_suspect', 'piece_illisible', 'tiers_non_identifie', 'hors_perimetre', 'cut_off'].includes(String(q.concern_type)));
      requireShape(q.priority === undefined || ['low', 'medium', 'high', 'critical'].includes(String(q.priority)));
      requireShape(q.detail === undefined || typeof q.detail === 'string' && q.detail.length <= 2000);
    }
    if (name === 'lines') for (const line of list) {
      requireShape(keys(line, ['source_line_key', 'source_row', 'source_file_sha256', 'source_document_sha256', 'line_number', 'description_raw', 'sku_raw', 'quantity', 'unit_price', 'amount', 'currency', 'raw_line_sha256', 'evidence_stage', 'geometry', 'issues']));
      requireShape(['source_line_key', 'source_file_sha256', 'source_document_sha256', 'raw_line_sha256'].every(k => typeof line[k] === 'string' && HASH.test(line[k] as string)));
      requireShape(Number.isSafeInteger(line.source_row) && Number(line.source_row) >= 2 && Number(line.source_row) <= 99999999 && Number.isSafeInteger(line.line_number) && Number(line.line_number) > 0 && Number(line.line_number) <= 99999999);
      requireShape(line.evidence_stage === 'attributed_retained_parse' && line.geometry === null && Array.isArray(line.issues) && line.issues.every(x => typeof x === 'string'));
      requireShape(typeof line.description_raw === 'string' && line.description_raw.length <= 500 && (line.sku_raw === null || typeof line.sku_raw === 'string' && line.sku_raw.length <= 100));
      for (const k of ['amount', 'quantity', 'unit_price']) requireShape((k !== 'amount' && line[k] === null) || typeof line[k] === 'string' && DECIMAL.test(line[k] as string));
      requireShape(jsonbBytes(line) <= 4000);
      requireShape(line.currency === null || typeof line.currency === 'string' && /^[A-Z]{3}$/.test(line.currency));
    }
    if (name === 'accounting_records') for (const record of list) {
      requireShape(keys(record, ['record_kind', 'source_key', 'source_sha256', 'source_row', 'local_id', 'year', 'date', 'account', 'currency', 'currency_basis', 'amount', 'section', 'category', 'description', 'decision', 'status', 'source_reference', 'bank_links', 'recognition_status', 'payment_status', 'vehicle_status', 'reimbursement_status', 'entity_status']));
      requireShape(['retained_ledger_decision', 'retained_bank_movement'].includes(String(record.record_kind)) && bounded(record.local_id, 200));
      requireShape(typeof record.source_key === 'string' && HASH.test(record.source_key) && typeof record.source_sha256 === 'string' && HASH.test(record.source_sha256));
      requireShape(Number.isSafeInteger(record.source_row) && Number(record.source_row) > 0 && Number(record.source_row) <= 99999999 && typeof record.year === 'string' && /^\d{4}$/.test(record.year));
      requireShape(record.date === null || typeof record.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(record.date));
      requireShape(typeof record.currency === 'string' && /^[A-Z]{3}$/.test(record.currency) && bounded(record.currency_basis, 500));
      requireShape(record.amount === null || typeof record.amount === 'string' && DECIMAL.test(record.amount));
      requireShape(Array.isArray(record.bank_links) && record.bank_links.length <= 100 && record.bank_links.every(x => bounded(x, 300)));
      requireShape(jsonbBytes(record) <= 12000);
      requireShape(record.recognition_status === (record.record_kind === 'retained_bank_movement' ? 'not_applicable' : 'retained_decision'));
      requireShape(record.payment_status === 'unresolved' && record.vehicle_status === 'unresolved' && record.reimbursement_status === 'unresolved' && record.entity_status === 'retained_scope_unallocated');
      for (const [k, value] of Object.entries(record)) requireShape(k === 'bank_links' || value === null || typeof value === 'number' && k === 'source_row' || typeof value === 'string' && value.length <= 1800);
    }
  }
}

/** Validate every byte, shape and local revision chain before any upload. */
export async function validateFinancialRestoreBundle(file: File): Promise<Item[]> {
  requireShape(file.size > 0 && file.size <= MAX_BUNDLE, 'Recovery bundle must be between 1 byte and 50 MiB.');
  let bundle: unknown;
  try { bundle = JSON.parse(await file.text()); } catch { throw new Error('Recovery bundle is not valid JSON.'); }
  requireShape(object(bundle) && keys(bundle, ['contract', 'items']) && bundle.contract === 'financial_evidence_restore_v1');
  requireShape(Array.isArray(bundle.items) && bundle.items.length > 0 && bundle.items.length <= 500);
  const items: Item[] = []; const hashes = new Set<string>(); const refs = new Set<string>(); let bytesTotal = 0; let revisionsTotal = 0;
  for (const raw of bundle.items) {
    requireShape(object(raw) && keys(raw, ['original', 'revisions']) && object(raw.original));
    const o = raw.original;
    requireShape(keys(o, ['sha256', 'source_filename', 'source_kind', 'base64']) && typeof o.sha256 === 'string' && HASH.test(o.sha256) && !hashes.has(o.sha256));
    requireShape(bounded(o.source_filename, 255) && /^[^/\\\x00-\x1f]+\.(pdf|png|jpe?g|webp|heic|csv)$/i.test(o.source_filename), 'Original format is not supported by private document storage.');
    requireShape(['email_attachment', 'email_body', 'scan', 'upload', 'bank_export', 'other'].includes(String(o.source_kind)));
    requireShape(bounded(o.base64, Math.ceil(MAX_ORIGINAL / 3) * 4) && base64Shape(o.base64));
    let bytes: Uint8Array;
    try { bytes = Uint8Array.from(atob(o.base64), c => c.charCodeAt(0)); } catch { throw new Error('Invalid original encoding.'); }
    bytesTotal += bytes.length; requireShape(bytes.length > 0 && bytes.length <= MAX_ORIGINAL && bytesTotal <= MAX_BUNDLE);
    requireShape(await digest(bytes) === o.sha256, 'An original does not match its retained source hash.');
    requireShape(Array.isArray(raw.revisions) && raw.revisions.length > 0 && raw.revisions.length <= 100); revisionsTotal += raw.revisions.length; requireShape(revisionsTotal <= 1000);
    let previous: string | null = null; const revisions: Revision[] = []; const keysSeen = new Set<string>();
    for (const r of raw.revisions) {
      requireShape(object(r) && keys(r, ['local_ref', 'supersedes_local_ref', 'revision']) && bounded(r.local_ref, 300) && !refs.has(r.local_ref) && r.supersedes_local_ref === previous);
      validateRevision(r.revision);
      const before = revisions.at(-1)?.revision;
      if (before) {
        const nextKeys = new Set((r.revision.fields as Json[]).map(f => f.field_key));
        requireShape((before.fields as Json[]).every(f => nextKeys.has(f.field_key)));
        for (const property of ['lines', 'accounting_records']) {
          if (Array.isArray(before[property]) && (before[property] as unknown[]).length) requireShape(Array.isArray(r.revision[property]));
        }
      } requireShape(!keysSeen.has(String(r.revision.idempotency_key)));
      if (Array.isArray(r.revision.lines)) requireShape(r.revision.lines.every(line => (line as Json).source_document_sha256 === o.sha256));
      refs.add(r.local_ref); keysSeen.add(String(r.revision.idempotency_key)); previous = r.local_ref;
      revisions.push({ local_ref: r.local_ref, supersedes_local_ref: r.supersedes_local_ref as string | null, revision: r.revision });
    }
    hashes.add(o.sha256); items.push({ original: { sha256: o.sha256, source_filename: o.source_filename, source_kind: String(o.source_kind) }, bytes, revisions });
  }
  const currentSourceKeys = new Set<string>(); const currentRecordIds = new Set<string>();
  for (const item of items) for (const record of (item.revisions[item.revisions.length - 1].revision.accounting_records ?? []) as Json[]) {
    const sourceKey = String(record.source_key); const identity = JSON.stringify([record.record_kind, record.local_id]);
    requireShape(!currentSourceKeys.has(sourceKey) && !currentRecordIds.has(identity), 'Duplicate current accounting record across originals.');
    currentSourceKeys.add(sourceKey); currentRecordIds.add(identity);
  }
  return items;
}

/** Explicit file selection + restore, using the ordinary signed-in session only. */
export async function restoreFinancialEvidence(file: File, onProgress: (p: RestoreProgress) => void = () => {}, signal?: AbortSignal): Promise<RestoreResult> {
  const initial = await supabase.auth.getUser();
  if (initial.error || !initial.data.user || initial.data.user.is_anonymous) throw new Error('Sign in before restoring retained evidence.');
  const ownerId = initial.data.user.id; let ownerChanged = false;
  const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => { if (session?.user.id !== ownerId) ownerChanged = true; });
  const check = async () => {
    if (signal?.aborted || ownerChanged) throw new Error('Restore stopped. Sign in to the original account to resume.');
    const current = await supabase.auth.getUser();
    if (current.error || current.data.user?.is_anonymous || current.data.user?.id !== ownerId || ownerChanged || signal?.aborted) throw new Error('Restore stopped because the account changed.');
  };
  const invoke = async (body: Json) => {
    await check(); const response = await supabase.functions.invoke('ingest-observation', { body }); await check();
    if (response.error || response.data?.error) throw new Error('Evidence admission could not be verified. Retry the same bundle to resume.');
    return response.data;
  };
  try {
    onProgress({ stage: 'validating', completed: 0, total: 0 });
    const items = await validateFinancialRestoreBundle(file); await check();
    const total = items.reduce((sum, i) => sum + i.revisions.length, 0); let completed = 0; let verified = 0;
    for (const item of items) {
      await check(); const extension = item.original.source_filename.split('.').pop()!.toLowerCase();
      const path = `${ownerId}/financial-recovery/${item.original.sha256}.${extension}`;
      onProgress({ stage: 'uploading', completed, total });
      const uploaded = await supabase.storage.from('user-documents').upload(path, new Blob([item.bytes as BlobPart], { type: ORIGINAL_MIME[extension] }), { upsert: false, contentType: ORIGINAL_MIME[extension] });
      await check();
      if (uploaded.error && String((uploaded.error as { statusCode?: string }).statusCode) !== '409') throw new Error('Private upload failed. Retry the same bundle to resume.');
      // A storage conflict is not proof of custody: sanctioned admission below hashes held bytes.
      let priorRun: string | null = null; let documentId: string | null = null;
      for (const r of item.revisions) {
        onProgress({ stage: 'admitting', completed, total });
        const revision = { ...r.revision, ...(priorRun ? { supersedes_run_id: priorRun } : {}) };
        const admitted = await invoke({ mode: 'financial_evidence_v1', action: 'submit', original: { ...item.original, storage_path: path }, revision });
        requireShape(object(admitted?.data) && typeof admitted.data.document_id === 'string' && UUID.test(admitted.data.document_id) &&
          typeof admitted.data.extraction_run_id === 'string' && UUID.test(admitted.data.extraction_run_id), 'Admission returned no verifiable receipt.');
        requireShape(documentId === null || documentId === admitted.data.document_id, 'Revision changed original identity.');
        documentId = admitted.data.document_id; priorRun = admitted.data.extraction_run_id; completed++;
      }
      onProgress({ stage: 'verifying', completed, total });
      const read = await invoke({ mode: 'financial_evidence_v1', action: 'read', document_id: documentId, include_context: false });
      requireShape(read?.data?.document?.id === documentId && read.data.document.content_sha256 === item.original.sha256 &&
        Array.isArray(read.data.fields) && read.data.fields.some((f: Json) => f.extraction_run_id === priorRun && f.is_superseded === false),
      'Current retained revision could not be verified. Retry the bundle; no completion is claimed.');
      const expected = item.revisions[item.revisions.length - 1].revision;
      const canonical = (value: unknown): string => {
        const sort = (x: unknown): unknown => Array.isArray(x) ? x.map(sort) : object(x)
          ? Object.fromEntries(Object.keys(x).sort().map(k => [k, sort(x[k])])) : x;
        return JSON.stringify(sort(value ?? null));
      };
      const currentFields = read.data.fields.filter((f: Json) => f.extraction_run_id === priorRun && f.is_superseded === false);
      requireShape(currentFields.length === (expected.fields as Json[]).length, 'Restored field population differs from the retained revision.');
      for (const field of expected.fields as Json[]) {
        const found = currentFields.find((f: Json) => f.field_key === field.field_key);
        requireShape(found && found.value_raw === field.value_raw && found.value_type === (field.value_type ?? 'text') &&
          canonical(found.value_normalized?.value) === canonical(field.value_normalized) &&
          canonical(found.value_normalized?.evidence) === canonical(field.evidence), 'Restored field content differs from the retained revision.');
      }
      const expectedLines = (expected.lines ?? []) as Json[];
      const expectedRecords = (expected.accounting_records ?? []) as Json[];
      requireShape(Array.isArray(read.data.lines) && read.data.lines.length === expectedLines.length + expectedRecords.length,
        'Restored accounting population differs from the retained revision.');
      for (const [property, expectedRows] of [['staging', expectedLines], ['accounting_record', expectedRecords]] as const) {
        const actual = read.data.lines.filter((l: Json) => object(l.attributes) && l.attributes[property] !== undefined)
          .map((l: Json) => canonical((l.attributes as Json)[property])).sort();
        requireShape(canonical(actual) === canonical(expectedRows.map(canonical).sort()), 'Restored accounting content differs from the retained revision.');
      }
      const expectedConcerns = (expected.concerns ?? []) as Json[];
      const actualConcerns = (Array.isArray(read.data.concerns) ? read.data.concerns : [])
        .filter((q: Json) => object(q.confidence_factors) && q.confidence_factors.extraction_run_id === priorRun);
      const concernValue = (q: Json) => canonical({ concern_type: q.concern_type, priority: q.priority ?? 'medium', detail: q.detail ?? null, resolver: q.resolver });
      requireShape(canonical(actualConcerns.map(concernValue).sort()) === canonical(expectedConcerns.map(concernValue).sort()),
        'Restored review concerns differ from the retained revision.');
      verified++;
    }
    return { documents: items.length, revisions: completed, verified, expense_posted: false, tax_ready: false };
  } finally { authListener.subscription.unsubscribe(); }
}

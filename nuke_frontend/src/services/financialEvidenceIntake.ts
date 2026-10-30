import { supabase } from '../lib/supabase';
import { carriedRevision, readAccountingSnapshot } from './financialExpenseUse';

export type FinancialIntakeStage = 'checking' | 'uploading' | 'processing' | 'verifying' | 'linking';
export interface FinancialIntakeResult {
  documentId: string;
  status: 'needs_review' | 'complete' | 'blocked';
  reused: boolean;
  message?: string;
  readback: Record<string, unknown>;
  /** Set when the file was added as the paper for a row of the books (see DocumentLinkTarget). */
  linked?: { field_key: string; already: boolean };
}

/** The row of the books an added file is the paper for. The file lands as an ordinary financial document, with one cell that points it at the record:
 *  supports_record_<first 24 characters of the record's source key>. The cell states what the owner says the file is (doc_kind) and the exact
 *  citation text (ref) that would clear the flag; the books writer cites the document in the decision's proof_links from it. */
export type DocumentLinkTarget = {
  year: string; local_id: string; source_key: string; decision_document_id: string;
  /** What the owner says the file is, in the words the large-sum rules read ("Invoice", "Purchase agreement"). */
  doc_kind: string;
  /** The kind of paper the row's rule requires (v_books_large_sums.required_doc_kind), or null. */
  required_doc_kind: string | null;
};
/** A file name that looks like a Social Security number (nine digits in the 3-2-4 pattern, with or without separators). The name is written into the
 *  citation of the row, so such a file is refused before anything is sent; never a document with one. */
export const looksLikeSsn = (filename: string): boolean => /(^|[^0-9])\d{3}[- ]?\d{2}[- ]?\d{4}([^0-9]|$)/.test(filename);
export const linkFieldKey = (sourceKey: string) => `supports_record_${sourceKey.slice(0, 24)}`;
/** The citation text for the decision: what the owner says the file is, its name and the start of its hash, so a later reader can find the stored original. */
export function linkRef(docKind: string, filename: string, sha256: string): string {
  const name = Array.from(filename, ch => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 || ch === '/' || ch === '\\' ? ' ' : ch)).join('').replace(/\s+/g, ' ').trim().slice(0, 120);
  return `${docKind.trim()}: ${name} (sha256 ${sha256.slice(0, 12)})`.slice(0, 300);
}
// Revision JSON is shaped and checked by the writer; typed loosely as in financialExpenseUse.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
export function linkCell(target: DocumentLinkTarget, filename: string, sha256: string): Json {
  const ref = linkRef(target.doc_kind, filename, sha256);
  return {
    field_key: linkFieldKey(target.source_key), value_type: 'text', value_raw: `${target.doc_kind.trim()} for ${target.local_id}`.slice(0, 2000),
    value_normalized: { year: target.year, local_id: target.local_id, source_key: target.source_key, decision_document_id: target.decision_document_id,
      doc_kind: target.doc_kind.trim(), required_doc_kind: target.required_doc_kind, ref, status: 'pending_link' },
    evidence: { stage: 'owner_document_attachment', source_kind: 'authenticated_owner_selection', method: 'authenticated_document_attachment', source_sha256: sha256 },
  };
}

async function owner(expected?: string) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user || (expected && data.user.id !== expected)) {
    throw new Error('Sign in to your account before continuing.');
  }
  return data.user.id;
}

async function invoke(body: Record<string, unknown>) {
  // The normal signed-in Supabase session supplies authorization; no user API key.
  const { data, error } = await supabase.functions.invoke('ingest-observation', { body });
  if (error || data?.error) throw new Error(data?.error || 'Document processing could not finish. You can retry the selected file.');
  return data;
}

/** Called only after explicit selection and submit; never from an ambient watcher. With a link target the file is added as the paper for that row. */
export async function processFinancialDocument(file: File, onStage: (stage: FinancialIntakeStage) => void = () => {}, link?: DocumentLinkTarget): Promise<FinancialIntakeResult> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!extension || !['jpg', 'jpeg', 'png', 'webp', 'pdf', 'heic'].includes(extension) || file.size < 1 || file.size > 10485760) {
    throw new Error('Choose a JPG, PNG, WebP, HEIC or PDF between 1 byte and 10 MiB.');
  }
  if (link && looksLikeSsn(file.name)) throw new Error('This file name looks like it holds a Social Security number. Rename the file and add it again; never add a document with one.');
  const userId = await owner();
  onStage('checking');
  const bytes = await file.arrayBuffer();
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  await owner(userId);
  const prior = await invoke({ mode: 'financial_evidence_v1', action: 'read', original_sha256: sha256 });
  await owner(userId);
  // A prior document is reused as evidence; its presence alone never means accounting is complete.
  if (prior?.data?.document?.id) {
    return link ? linkExistingFinancialDocument(prior.data.document.id, userId, link, file.name, sha256, onStage) : processExistingFinancialDocument(prior.data.document.id, userId);
  }
  const storagePath = `${userId}/financial/${sha256}.${extension}`;
  onStage('uploading');
  const { error } = await supabase.storage.from('user-documents').upload(storagePath, file, { upsert: false, contentType: file.type || undefined });
  // Conflict is an upload checkpoint only. Server validates stored bytes against this SHA.
  if (error && String((error as { statusCode?: string }).statusCode) !== '409') throw new Error('The private upload failed. Retry this file to continue.');
  await owner(userId);
  onStage('processing');
  const original = { sha256, storage_path: storagePath, source_filename: file.name, source_kind: 'scan' };
  // A file added for a row is admitted with its link cell in the same revision as its capture; any other file takes the plain process path.
  const processed = link
    ? await invoke({ mode: 'financial_evidence_v1', action: 'submit', original, revision: {
        idempotency_key: `attach:v1:${sha256}:${link.source_key.slice(0, 24)}`, method: 'authenticated_document_attachment', version: '1',
        fields: [CAPTURE_CELL(sha256), linkCell(link, file.name, sha256)] } })
    : await invoke({ mode: 'financial_evidence_v1', action: 'process', original });
  await owner(userId);
  onStage('verifying');
  const verified = await invoke({ mode: 'financial_evidence_v1', action: 'read', original_sha256: sha256 });
  await owner(userId);
  if (!verified?.data?.document?.id) throw new Error('The upload is retained, but processing could not be verified. Retry this file.');
  const output = result(verified.data, false);
  // Completion must be asserted by the server's accounting consumer, never inferred from upload.
  if (processed?.processing_status === 'complete') output.status = 'complete';
  else if (processed?.processing_status === 'blocked') output.status = 'blocked';
  if (typeof processed?.message === "string") output.message = processed.message;
  if (link) output.linked = { field_key: linkFieldKey(link.source_key), already: false };
  return output;
}

/** The capture cell the plain process path writes, so a file added for a row starts as the same kind of document. */
const CAPTURE_CELL = (sha256: string): Json => ({
  field_key: 'capture_status', value_raw: 'Private original captured; extraction pending', value_type: 'event',
  value_normalized: { processing_status: 'blocked', reason: 'ocr_entitlement_unavailable' },
  evidence: { stage: 'original_capture_only', source_sha256: sha256, method: 'authenticated_original_capture', extraction_performed: false },
});

/** A file the books already hold, added again as the paper for a row: one correction that carries every field the document has and adds the link cell.
 *  A document already linked to that record is left as it is. */
async function linkExistingFinancialDocument(documentId: string, userId: string, link: DocumentLinkTarget, filename: string, sha256: string,
  onStage: (stage: FinancialIntakeStage) => void): Promise<FinancialIntakeResult> {
  onStage('linking');
  const snapshot = await readAccountingSnapshot(userId, documentId);
  await owner(userId);
  const key = linkFieldKey(link.source_key);
  const held = snapshot.fields.find((f: Json) => f.field_key === key);
  const linked = held?.value_normalized?.value?.source_key === link.source_key;
  if (!linked) {
    const { fields, records, lines, concerns } = carriedRevision(snapshot);
    const next = [...fields.filter((f: Json) => f.field_key !== key), linkCell(link, filename, sha256)];
    if (next.length > 100) throw new Error('This document has reached its field limit. Nothing was changed.');
    const doc = snapshot.document;
    await invoke({ mode: 'financial_evidence_v1', action: 'correct', owner_user_id: userId,
      original: { sha256: doc.content_sha256, storage_path: doc.storage_path, source_filename: doc.source_filename, source_kind: doc.source_kind },
      revision: { idempotency_key: `document-link:${crypto.randomUUID()}`, method: 'authenticated_document_attachment', version: '1',
        supersedes_run_id: snapshot.runId, fields: next, accounting_records: records, lines, concerns } });
    await owner(userId);
  }
  const verified = await invoke({ mode: 'financial_evidence_v1', action: 'read', document_id: documentId });
  await owner(userId);
  if (verified?.data?.document?.id !== documentId) throw new Error('The document is retained, but the link could not be verified. Retry this file.');
  const output = result(verified.data, true);
  output.linked = { field_key: key, already: linked };
  return output;
}

function result(readback: Record<string, any>, reused: boolean): FinancialIntakeResult {
  return { documentId: readback.document.id, status: readback.processing_status === 'complete' ? 'complete' : 'needs_review', reused, readback };
}

/** Explicit resume of retained private evidence; never requires the original to be uploaded again. */
export async function processExistingFinancialDocument(documentId: string, expectedOwner?: string): Promise<FinancialIntakeResult> {
  const userId = await owner(expectedOwner);
  const processed = await invoke({ mode: 'financial_evidence_v1', action: 'process', document_id: documentId });
  await owner(userId);
  const verified = await invoke({ mode: 'financial_evidence_v1', action: 'read', document_id: documentId });
  await owner(userId);
  if (verified?.data?.document?.id !== documentId) throw new Error('Document processing could not be verified.');
  const output = result(verified.data, true);
  if (processed?.processing_status === 'complete') output.status = 'complete';
  else if (processed?.processing_status === 'blocked') output.status = 'blocked';
  if (typeof processed?.message === "string") output.message = processed.message;
  return output;
}

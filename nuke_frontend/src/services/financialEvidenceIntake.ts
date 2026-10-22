import { supabase } from '../lib/supabase';

export type FinancialIntakeStage = 'checking' | 'uploading' | 'processing' | 'verifying';
export interface FinancialIntakeResult {
  documentId: string;
  status: 'needs_review' | 'complete' | 'blocked';
  reused: boolean;
  message?: string;
  readback: Record<string, unknown>;
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

/** Called only after explicit selection and submit; never from an ambient watcher. */
export async function processFinancialDocument(file: File, onStage: (stage: FinancialIntakeStage) => void = () => {}): Promise<FinancialIntakeResult> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!extension || !['jpg', 'jpeg', 'png', 'webp', 'pdf', 'heic'].includes(extension) || file.size < 1 || file.size > 10485760) {
    throw new Error('Choose a JPG, PNG, WebP, HEIC or PDF between 1 byte and 10 MiB.');
  }
  const userId = await owner();
  onStage('checking');
  const bytes = await file.arrayBuffer();
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  await owner(userId);
  const prior = await invoke({ mode: 'financial_evidence_v1', action: 'read', original_sha256: sha256 });
  await owner(userId);
  // A prior document is reused as evidence; its presence alone never means accounting is complete.
  if (prior?.data?.document?.id) return processExistingFinancialDocument(prior.data.document.id, userId);
  const storagePath = `${userId}/financial/${sha256}.${extension}`;
  onStage('uploading');
  const { error } = await supabase.storage.from('user-documents').upload(storagePath, file, { upsert: false, contentType: file.type || undefined });
  // Conflict is an upload checkpoint only. Server validates stored bytes against this SHA.
  if (error && String((error as { statusCode?: string }).statusCode) !== '409') throw new Error('The private upload failed. Retry this file to continue.');
  await owner(userId);
  onStage('processing');
  const processed = await invoke({ mode: 'financial_evidence_v1', action: 'process', original: {
    sha256, storage_path: storagePath, source_filename: file.name, source_kind: 'scan',
  } });
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

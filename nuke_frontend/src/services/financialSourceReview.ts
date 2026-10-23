import { supabase } from '../lib/supabase';

export type SourceMask = { x: number; y: number; width: number; height: number };
export const sourceDigest = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(n => n.toString(16).padStart(2, '0')).join('');

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, payload: Uint8Array) {
  const chunk = new Uint8Array(payload.length + 12);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, payload.length);
  chunk.set(new TextEncoder().encode(type), 4); chunk.set(payload, 8);
  view.setUint32(payload.length + 8, crc32(chunk.subarray(4, payload.length + 8)));
  return chunk;
}

// Encode fresh RGB pixels only: no alpha, text, source metadata or original bytes.
export async function sourceRasterPng(pixels: Uint8ClampedArray, width: number, height: number) {
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0) || width * height > 80_000_000 || pixels.length !== width * height * 4) throw new Error('Image dimensions unavailable');
  const rows = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const input = (y * width + x) * 4, output = y * (width * 3 + 1) + 1 + x * 3;
    const alpha = pixels[input + 3] / 255;
    for (let channel = 0; channel < 3; channel++) rows[output + channel] = Math.round(pixels[input + channel] * alpha + 255 * (1 - alpha));
  }
  const compressed = new Uint8Array(await new Response(new Blob([rows]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, width); view.setUint32(4, height); header[8] = 8; header[9] = 2;
  return new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', compressed), pngChunk('IEND', new Uint8Array())], { type: 'image/png' });
}

export async function loadPrivateSource(documentId: string) {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user || user.is_anonymous) throw new Error('Sign in to review your source');
  const result = await supabase.from('financial_documents').select('id, owner_id, storage_path, content_sha256').eq('id', documentId).eq('owner_id', user.id).single();
  if (result.error || !result.data || !result.data.storage_path?.startsWith(`${user.id}/`)) throw new Error('Source is not available to this account');
  const held = await supabase.storage.from('user-documents').download(result.data.storage_path);
  if (held.error || !held.data || held.data.size > 10 * 1024 * 1024) throw new Error('Private source could not load');
  if (await sourceDigest(await held.data.arrayBuffer()) !== result.data.content_sha256) throw new Error('Private source changed; review stopped');
  return { document: result.data, blob: held.data, userId: user.id };
}

export async function saveReviewedSource(documentId: string, ownerId: string, sourceHash: string, blob: Blob, width: number, height: number) {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user || user.is_anonymous || user.id !== ownerId) throw new Error('Account changed; reopen source review');
  const hash = await sourceDigest(await blob.arrayBuffer());
  const storagePath = `${ownerId}/redacted/${sourceHash}/${hash}.png`;
  const upload = await supabase.storage.from('user-documents').upload(storagePath, blob, { contentType: 'image/png', upsert: false });
  if (upload.error) {
    // Immutable same-hash retry is safe only after verifying the held bytes.
    const held = await supabase.storage.from('user-documents').download(storagePath);
    if (held.error || !held.data || await sourceDigest(await held.data.arrayBuffer()) !== hash) throw new Error('Reviewed copy could not be saved; retry');
  }
  const source = { contract: 'financial_redacted_source_v1', source_sha256: sourceHash, derivative_sha256: hash,
    bucket: 'user-documents', storage_path: storagePath, mime_type: 'image/png', width, height,
    policy_version: 'financial-private-v1', geometry_status: 'not_available',
    verification: { pixel_masks: true, metadata_removed: true, embedded_text_removed: true, visual_reviewed: true,
      reviewer: user.id, reviewed_at: new Date().toISOString() } };
  const admitted = await supabase.functions.invoke('ingest-observation', { body: { mode: 'financial_evidence_v1', action: 'review_source', document_id: documentId, source } });
  if (admitted.error || admitted.data?.error || !admitted.data?.data) throw new Error('Private copy saved; its review could not be recorded. Retry to finish.');
  return admitted.data.data;
}

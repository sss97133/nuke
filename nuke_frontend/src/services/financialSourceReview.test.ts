import { beforeEach, expect, it, vi } from 'vitest';
import { inflateSync } from 'node:zlib';
const state = vi.hoisted(() => ({ user: { id: 'owner', is_anonymous: false } as any, stored: null as Blob | null, calls: [] as any[], uploadError: false, admitError: false }));
vi.mock('../lib/supabase', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
  storage: { from: (bucket: string) => ({
    upload: async (path: string, blob: Blob, options: any) => { state.calls.push({ kind: 'upload', bucket, path, options }); if (!state.uploadError) state.stored = blob; return { error: state.uploadError ? new Error('existing') : null }; },
    download: async (path: string) => { state.calls.push({ kind: 'download', path }); return { data: state.stored, error: null }; },
  }) },
  functions: { invoke: async (name: string, args: any) => { state.calls.push({ kind: 'invoke', name, ...args }); return { data: state.admitError ? { error: 'refused' } : { data: { document_id: 'document' } }, error: null }; } },
} }));
import { saveReviewedSource, sourceDigest, sourceRasterPng } from './financialSourceReview';
beforeEach(() => { state.user = { id: 'owner', is_anonymous: false }; state.stored = null; state.calls = []; state.uploadError = false; state.admitError = false; });

it('encodes only RGB image chunks and flattens hidden transparent pixels', async () => {
  const blob = await sourceRasterPng(new Uint8ClampedArray([0, 0, 0, 255, 123, 45, 67, 0]), 2, 1);
  const png = Buffer.from(await blob.arrayBuffer());
  const chunks: string[] = []; const compressed: Buffer[] = [];
  for (let i = 8; i < png.length;) {
    const size = png.readUInt32BE(i), type = png.toString('ascii', i + 4, i + 8); chunks.push(type);
    if (type === 'IDAT') compressed.push(png.subarray(i + 8, i + 8 + size));
    i += size + 12;
  }
  expect(chunks).toEqual(['IHDR', 'IDAT', 'IEND']); expect(png[25]).toBe(2);
  expect([...inflateSync(Buffer.concat(compressed))]).toEqual([0, 0, 0, 0, 255, 255, 255]);
  await expect(sourceRasterPng(new Uint8ClampedArray(3), 1, 1)).rejects.toThrow('dimensions');
});
it('uses the current account, immutable hash path and sanctioned review action', async () => {
  const blob = await sourceRasterPng(new Uint8ClampedArray([0, 0, 0, 255]), 1, 1);
  const hash = await sourceDigest(await blob.arrayBuffer());
  await saveReviewedSource('document', 'owner', 'a'.repeat(64), blob, 1, 1);
  expect(state.calls[0]).toMatchObject({ kind: 'upload', bucket: 'user-documents', path: `owner/redacted/${'a'.repeat(64)}/${hash}.png`, options: { upsert: false } });
  expect(state.calls[1]).toMatchObject({ kind: 'invoke', name: 'ingest-observation', body: { action: 'review_source', document_id: 'document', source: { derivative_sha256: hash, verification: { reviewer: 'owner', visual_reviewed: true } } } });
});
it('refuses an account change before any write', async () => {
  state.user = { id: 'other', is_anonymous: false };
  await expect(saveReviewedSource('document', 'owner', 'a'.repeat(64), new Blob(['test']), 1, 1)).rejects.toThrow('Account changed');
  expect(state.calls).toEqual([]);
});
it('does not mistake upload success for completed review admission', async () => {
  state.admitError = true;
  await expect(saveReviewedSource('document', 'owner', 'a'.repeat(64), new Blob(['test']), 1, 1)).rejects.toThrow('review could not be recorded');
});
it('permits immutable retry only after matching held bytes', async () => {
  const blob = new Blob(['test']); state.stored = blob; state.uploadError = true;
  await saveReviewedSource('document', 'owner', 'a'.repeat(64), blob, 1, 1);
  expect(state.calls.map(c => c.kind)).toEqual(['upload', 'download', 'invoke']);
  state.calls = []; state.stored = new Blob(['tampered']);
  await expect(saveReviewedSource('document', 'owner', 'a'.repeat(64), blob, 1, 1)).rejects.toThrow('could not be saved');
  expect(state.calls.map(c => c.kind)).toEqual(['upload', 'download']);
});

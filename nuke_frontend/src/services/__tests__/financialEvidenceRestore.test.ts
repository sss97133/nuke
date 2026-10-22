// @vitest-environment node
import { beforeEach, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), onAuthStateChange: vi.fn(), upload: vi.fn(), invoke: vi.fn(), unsubscribe: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { auth: { getUser: mocks.getUser, onAuthStateChange: mocks.onAuthStateChange }, storage: { from: () => ({ upload: mocks.upload }) }, functions: { invoke: mocks.invoke } } }));
import { restoreFinancialEvidence, validateFinancialRestoreBundle } from '../financialEvidenceRestore';
const owner = '11111111-1111-4111-8111-111111111111', doc = '22222222-2222-4222-8222-222222222222';
const run1 = '33333333-3333-4333-8333-333333333333', run2 = '44444444-4444-4444-8444-444444444444';
const sha = createHash('sha256').update('a').digest('hex');
const field = { field_key: 'amount', value_raw: '1.00', value_normalized: '1.00', value_type: 'amount', evidence: { source_sha256: sha } };
const bundle = () => ({ contract: 'financial_evidence_restore_v1', items: [{ original: { sha256: sha, source_filename: 'source.csv', source_kind: 'bank_export', base64: 'YQ==' }, revisions: [
  { local_ref: 'r1', supersedes_local_ref: null, revision: { idempotency_key: 'r1', method: 'retained', version: '1', fields: [field] } },
  { local_ref: 'r2', supersedes_local_ref: 'r1', revision: { idempotency_key: 'r2', method: 'retained', version: '1', fields: [{ ...field, value_raw: '2.00', value_normalized: '2.00' }] } },
] }] });
const file = (data: unknown) => { const text = JSON.stringify(data); return { size: Buffer.byteLength(text), text: async () => text } as File; };
beforeEach(() => {
  vi.resetAllMocks(); mocks.getUser.mockResolvedValue({ data: { user: { id: owner, is_anonymous: false } }, error: null });
  mocks.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: mocks.unsubscribe } } });
  mocks.upload.mockResolvedValue({ error: null });
  mocks.invoke.mockImplementation(async (_name, { body }) => body.action === 'submit'
    ? { data: { data: { document_id: doc, extraction_run_id: body.revision.idempotency_key === 'r1' ? run1 : run2 } }, error: null }
    : { data: { data: { document: { id: doc, content_sha256: sha }, fields: [{ ...field, value_raw: '2.00', value_normalized: { value: '2.00', evidence: field.evidence }, extraction_run_id: run2, is_superseded: false }], lines: [] } }, error: null });
});
it('uploads an original once and binds complete successor to returned run before exact readback', async () => {
  const result = await restoreFinancialEvidence(file(bundle()));
  expect(result).toEqual({ documents: 1, revisions: 2, verified: 1, expense_posted: false, tax_ready: false });
  expect(mocks.upload).toHaveBeenCalledTimes(1);
  expect(mocks.upload.mock.calls[0][2].upsert).toBe(false);
  expect(mocks.invoke.mock.calls[1][1].body.revision.supersedes_run_id).toBe(run1);
  expect(mocks.invoke.mock.calls[2][1].body).toEqual({ mode: 'financial_evidence_v1', action: 'read', document_id: doc, include_context: false });
  expect(mocks.unsubscribe).toHaveBeenCalled();
});
it('retry after retained upload conflict replays unchanged keys and actual predecessor receipts', async () => {
  mocks.upload.mockResolvedValue({ error: { statusCode: '409' } });
  await restoreFinancialEvidence(file(bundle())); await restoreFinancialEvidence(file(bundle()));
  const submissions = mocks.invoke.mock.calls.filter(([, args]) => args.body.action === 'submit').map(([, args]) => args.body);
  expect(submissions.slice(0, 2)).toEqual(submissions.slice(2));
});
it('rejects auth/agent overrides in any revision before upload', async () => {
  const b = bundle(); Object.assign(b.items[0].revisions[1].revision, { actor_context: { kind: 'service_role' } });
  await expect(restoreFinancialEvidence(file(b))).rejects.toThrow(); expect(mocks.upload).not.toHaveBeenCalled();
});
it.each([['JPG', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['png', 'image/png'], ['webp', 'image/webp'], ['heic', 'image/heic'], ['pdf', 'application/pdf'], ['csv', 'text/csv']])('uses the private bucket-supported type for %s', async (extension, mime) => {
  const b = bundle(); b.items[0].original.source_filename = `source.${extension}`;
  await restoreFinancialEvidence(file(b));
  expect(mocks.upload.mock.calls[0][1].type).toBe(mime);
  expect(mocks.upload.mock.calls[0][2].contentType).toBe(mime);
});
it('rejects a late unsupported original format before any upload', async () => {
  const b = bundle();
  b.items.push({ ...b.items[0], original: { ...b.items[0].original, sha256: 'b'.repeat(64), source_filename: 'unsupported.numbers' } });
  await expect(restoreFinancialEvidence(file(b))).rejects.toThrow('Original format is not supported');
  expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.invoke).not.toHaveBeenCalled();
});
it('cancellation cannot begin an upload', async () => {
  const controller = new AbortController(); controller.abort();
  await expect(restoreFinancialEvidence(file(bundle()), undefined, controller.signal)).rejects.toThrow(); expect(mocks.upload).not.toHaveBeenCalled();
});
it.skipIf(!process.env.FINANCIAL_RESTORE_VALIDATION_FILE)('validates an explicitly selected private bundle locally without uploading', async () => {
  const text = await readFile(process.env.FINANCIAL_RESTORE_VALIDATION_FILE!, 'utf8');
  const items = await validateFinancialRestoreBundle({ size: Buffer.byteLength(text), text: async () => text } as File);
  expect(items.length).toBeGreaterThan(0); expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.invoke).not.toHaveBeenCalled();
});

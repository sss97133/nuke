import { beforeEach, expect, it, vi } from 'vitest';
// Revision JSON is shaped and checked by the writer; typed loosely as in financialExpenseUse.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const owner = '11111111-1111-4111-8111-111111111111', runA = '22222222-2222-4222-8222-222222222222', doc = '33333333-3333-4333-8333-333333333333';
const fixture = vi.hoisted(() => ({
  calls: [] as Json[], priorDocument: null as string | null, snapshot: null as Json | null, uploaded: [] as string[], uploadError: null as unknown, refuse: null as string | null, user: 'x' as string | null,
}));
vi.mock('../lib/supabase', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: fixture.user ? { id: fixture.user } : null }, error: null }) },
  storage: { from: () => ({ upload: async (path: string) => { fixture.uploaded.push(path); return { error: fixture.uploadError }; } }) },
  functions: { invoke: async (_name: string, { body }: { body: Json }) => {
    fixture.calls.push(body);
    if (fixture.refuse && body.action === fixture.refuse) return { data: { error: 'refused' }, error: null };
    if (body.action === 'read' && body.original_sha256) return { data: { data: fixture.priorDocument ? { document: { id: fixture.priorDocument }, processing_status: 'needs_review' } : null }, error: null };
    if (body.action === 'read' && body.document_id) {
      // the snapshot read (include_context false) carries fields and lines; the verification read carries the document
      return { data: { data: body.include_context === false ? fixture.snapshot : { document: { id: body.document_id }, processing_status: 'needs_review' } }, error: null };
    }
    // a new original is admitted: from now on the books hold it, so the verifying read finds it
    if (body.action === 'submit' || body.action === 'process') fixture.priorDocument = doc;
    return { data: { data: { document_id: doc }, processing_status: 'blocked', message: 'Original saved.' }, error: null };
  } },
  from() { const q = { select: () => q, eq: () => q, single: async () => ({ data: { id: doc, owner_id: owner, content_sha256: 'c'.repeat(64), storage_path: `${owner}/financial/old.pdf`, source_filename: 'old.pdf', source_kind: 'scan' }, error: null }) }; return q; },
} }));
import { linkCell, linkFieldKey, linkRef, looksLikeSsn, processFinancialDocument, type DocumentLinkTarget } from './financialEvidenceIntake';

const target: DocumentLinkTarget = { year: '2024', local_id: 'L1', source_key: 'a'.repeat(64), decision_document_id: 'decision-doc', doc_kind: 'Invoice', required_doc_kind: 'invoice_or_agreement' };
const pdf = (name = 'Invoice 1.pdf') => new File([new Uint8Array([1, 2, 3, 4])], name, { type: 'application/pdf' });
const sha = async (file: File) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), b => b.toString(16).padStart(2, '0')).join('');
const captured = (run: string): Json => ({ field_key: 'capture_status', value_raw: 'Private original captured; extraction pending', value_type: 'event', extraction_run_id: run,
  value_normalized: { value: { processing_status: 'blocked', reason: 'ocr_entitlement_unavailable' }, evidence: { stage: 'original_capture_only' } } });
beforeEach(() => { fixture.calls = []; fixture.priorDocument = null; fixture.snapshot = null; fixture.uploaded = []; fixture.uploadError = null; fixture.refuse = null; fixture.user = owner; });

it('the link cell points the file at the record and states what the owner said it is and the citation text that would clear the flag', async () => {
  const file = pdf('Painter / Co: invoice.pdf'), hash = await sha(file);
  const cell = linkCell(target, file.name, hash);
  expect(cell.field_key).toBe(`supports_record_${'a'.repeat(24)}`);
  expect(linkFieldKey('b'.repeat(64))).toBe(`supports_record_${'b'.repeat(24)}`);
  expect(cell.value_normalized).toEqual({ year: '2024', local_id: 'L1', source_key: 'a'.repeat(64), decision_document_id: 'decision-doc', doc_kind: 'Invoice', required_doc_kind: 'invoice_or_agreement',
    ref: `Invoice: Painter Co: invoice.pdf (sha256 ${hash.slice(0, 12)})`, status: 'pending_link' });
  expect(cell.evidence).toMatchObject({ stage: 'owner_document_attachment', method: 'authenticated_document_attachment', source_sha256: hash });
  expect(cell.value_raw).toBe('Invoice for L1');
  expect(cell.field_key.length).toBeLessThanOrEqual(160);
});

it('the citation text names the kind first (the view reads its keywords), strips path separators and control characters, and stays inside the writer\'s 300 characters', () => {
  expect(linkRef('Purchase agreement', 'a/b\\c\nd.pdf', 'f'.repeat(64))).toBe('Purchase agreement: a b c d.pdf (sha256 ffffffffffff)');
  const long = linkRef('Invoice', 'x'.repeat(500), 'f'.repeat(64));
  expect(long.length).toBeLessThanOrEqual(300);
  expect(long.startsWith('Invoice: ')).toBe(true);
});

it('a new file for a row is checked, uploaded privately and admitted in one revision that carries its capture and its link cell; nothing is invoked as the plain process path', async () => {
  const file = pdf(), hash = await sha(file), stages: string[] = [];
  const result = await processFinancialDocument(file, stage => stages.push(stage), target);
  expect(fixture.uploaded).toEqual([`${owner}/financial/${hash}.pdf`]);
  expect(stages).toEqual(['checking', 'uploading', 'processing', 'verifying']);
  const submit = fixture.calls.find(c => c.action === 'submit')!;
  expect(fixture.calls.some(c => c.action === 'process')).toBe(false);
  expect(submit.mode).toBe('financial_evidence_v1');
  expect(submit.original).toEqual({ sha256: hash, storage_path: `${owner}/financial/${hash}.pdf`, source_filename: 'Invoice 1.pdf', source_kind: 'scan' });
  expect(submit.revision.idempotency_key).toBe(`attach:v1:${hash}:${'a'.repeat(24)}`);
  expect(submit.revision.method).toBe('authenticated_document_attachment');
  expect(submit.revision.fields.map((f: Json) => f.field_key)).toEqual(['capture_status', `supports_record_${'a'.repeat(24)}`]);
  expect(submit.revision.fields[0].value_normalized).toEqual({ processing_status: 'blocked', reason: 'ocr_entitlement_unavailable' });
  expect(result.linked).toEqual({ field_key: `supports_record_${'a'.repeat(24)}`, already: false });
  expect(result.documentId).toBe(doc);
});

it('a file added with no link target takes the plain process path, unchanged', async () => {
  const stages: string[] = [];
  const result = await processFinancialDocument(pdf(), stage => stages.push(stage));
  expect(fixture.calls.map(c => c.action)).toEqual(['read', 'process', 'read']);
  expect(stages).toEqual(['checking', 'uploading', 'processing', 'verifying']);
  expect(result.linked).toBeUndefined();
});

it('a file the books already hold is not uploaded again: one correction carries every field it has and adds the link cell', async () => {
  fixture.priorDocument = doc;
  fixture.snapshot = { fields: [captured(runA)], lines: [], concerns: [] };
  const stages: string[] = [];
  const file = pdf(), hash = await sha(file);
  const result = await processFinancialDocument(file, stage => stages.push(stage), target);
  expect(fixture.uploaded).toEqual([]);
  expect(stages).toEqual(['checking', 'linking']);
  const correction = fixture.calls.find(c => c.action === 'correct')!;
  expect(correction.owner_user_id).toBe(owner);
  expect(correction.original).toEqual({ sha256: 'c'.repeat(64), storage_path: `${owner}/financial/old.pdf`, source_filename: 'old.pdf', source_kind: 'scan' });
  expect(correction.revision.supersedes_run_id).toBe(runA);
  expect(correction.revision.fields.map((f: Json) => f.field_key)).toEqual(['capture_status', `supports_record_${'a'.repeat(24)}`]);
  expect(correction.revision.fields[0]).toMatchObject({ field_key: 'capture_status', value_normalized: { processing_status: 'blocked', reason: 'ocr_entitlement_unavailable' }, evidence: { stage: 'original_capture_only' } });
  expect(correction.revision.fields[1].value_normalized.ref).toBe(`Invoice: Invoice 1.pdf (sha256 ${hash.slice(0, 12)})`);
  expect(correction.revision.accounting_records).toEqual([]);
  expect(result).toMatchObject({ reused: true, linked: { already: false } });
});

it('a file already linked to that record is left as it is: no correction is written', async () => {
  fixture.priorDocument = doc;
  fixture.snapshot = { fields: [captured(runA), { field_key: `supports_record_${'a'.repeat(24)}`, value_raw: 'x', value_type: 'text', extraction_run_id: runA,
    value_normalized: { value: { source_key: 'a'.repeat(64) }, evidence: { stage: 'owner_document_attachment' } } }], lines: [], concerns: [] };
  const result = await processFinancialDocument(pdf(), () => {}, target);
  expect(fixture.calls.some(c => c.action === 'correct')).toBe(false);
  expect(result.linked).toEqual({ field_key: `supports_record_${'a'.repeat(24)}`, already: true });
});

it('the same file for a second record keeps the first link and adds the second', async () => {
  fixture.priorDocument = doc;
  const first = { field_key: `supports_record_${'b'.repeat(24)}`, value_raw: 'x', value_type: 'text', extraction_run_id: runA, value_normalized: { value: { source_key: 'b'.repeat(64) }, evidence: { stage: 'owner_document_attachment' } } };
  fixture.snapshot = { fields: [captured(runA), first], lines: [], concerns: [] };
  await processFinancialDocument(pdf(), () => {}, target);
  const correction = fixture.calls.find(c => c.action === 'correct')!;
  expect(correction.revision.fields.map((f: Json) => f.field_key)).toEqual(['capture_status', `supports_record_${'b'.repeat(24)}`, `supports_record_${'a'.repeat(24)}`]);
});

it('a failed upload or a refused admission is an error in words and links nothing', async () => {
  fixture.uploadError = { statusCode: '500' };
  await expect(processFinancialDocument(pdf(), () => {}, target)).rejects.toThrow('The private upload failed. Retry this file to continue.');
  fixture.uploadError = null; fixture.refuse = 'submit';
  await expect(processFinancialDocument(pdf(), () => {}, target)).rejects.toThrow('refused');
});

it('a file of the wrong type or size, and a signed-out session, are refused before anything is sent', async () => {
  await expect(processFinancialDocument(new File(['x'], 'notes.txt'), () => {}, target)).rejects.toThrow('Choose a JPG, PNG, WebP, HEIC or PDF');
  fixture.user = null;
  await expect(processFinancialDocument(pdf(), () => {}, target)).rejects.toThrow('Sign in to your account');
  expect(fixture.calls).toEqual([]);
});


it('a file name that looks like a Social Security number is refused before anything is sent, so it never becomes a citation; ordinary names and numbers pass', async () => {
  for (const name of ['123-45-6789.pdf', 'ssn 123 45 6789 invoice.pdf', '123456789.pdf', 'tax-123-45-6789-w2.jpg']) {
    expect(looksLikeSsn(name), name).toBe(true);
    await expect(processFinancialDocument(pdf(name), () => {}, target)).rejects.toThrow('Social Security number');
  }
  for (const name of ['Invoice 1.pdf', 'invoice-2024-12-1234.pdf', 'IMG_20241203_101530.jpg', 'order 1118-2233-4455.pdf', 'po 12345.pdf', 'scan 2024.pdf']) expect(looksLikeSsn(name), name).toBe(false);
  expect(fixture.calls).toEqual([]);
  // the plain Add documents flow is unchanged: the guard belongs to the citation a row carries
  await processFinancialDocument(pdf('123456789.pdf'), () => {});
  expect(fixture.calls.length).toBeGreaterThan(0);
});

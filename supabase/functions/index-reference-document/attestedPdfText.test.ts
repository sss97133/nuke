import { recordAttestedPdfText } from './attestedPdfText.ts';
import { ReferenceError } from './suppliedReference.ts';

const source = {
  title: 'Synthetic SUV catalog', source_url: 'https://example.com/catalog.pdf',
  object_id: '00000000-0000-4000-8000-000000000001', object_version: 'v1',
  object_name: `catalog-public/${'a'.repeat(64)}.pdf`, pdf_sha256: 'a'.repeat(64), pdf_size: 123,
  text_sha256: 'b'.repeat(64), page_count: 3, reader_actor: 'agent:test',
  reader_method: 'client_sha256_pdftotext_v1', reader_run_id: 'test', reader_verified_at: new Date().toISOString(),
};
function deps() {
  const calls: unknown[] = [];
  return { calls, authorize: async () => true,
    record: async (s: Record<string, unknown>, pages: string[]) => {
      calls.push({ s, pages });
      return { success: true, document_id: '00000000-0000-4000-8000-000000000003', revision: 'c'.repeat(64),
        page_count: 3, duplicate: false, pdf_hash_status: 'client_attested_not_server_rehashed',
        text_provenance_status: 'client_attested_extraction_not_server_verified' };
    } };
}
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
async function rejects(p: Promise<unknown>, code: string) {
  try { await p; } catch (e) { if (e instanceof ReferenceError && e.code === code) return; throw e; }
  throw new Error(`Expected ${code}`);
}

Deno.test('attested PDF source requires service authority before recording', async () => {
  const d = deps(); d.authorize = async () => false;
  await rejects(recordAttestedPdfText({ mode: 'attested_pdf_text', source, pages: ['a', '', 'b'] }, d), 'attested_pdf_service_required');
  assert(d.calls.length === 0, 'unauthorized source reached the writer');
});
Deno.test('attested PDF source rejects malformed metadata and page snapshots', async () => {
  for (const bad of [
    { ...source, page_count: 0 }, { ...source, pdf_size: 7 }, { ...source, text_sha256: 'wrong' },
    { ...source, object_name: '../other.pdf' }, { ...source, reader_verified_at: '2099-01-01T00:00:00Z' },
    { ...source, reader_method: 'untrusted' }, { ...source, invented: true },
  ]) {
    const d = deps();
    await rejects(recordAttestedPdfText({ mode: 'attested_pdf_text', source: bad, pages: ['a', '', 'b'] }, d), 'attested_pdf_contract_invalid');
    assert(d.calls.length === 0, 'invalid source reached writer');
  }
  for (const pages of [['a'], ['a', '\f', 'b'], ['a', '\0', 'b'], ['a', 3, 'b']]) {
    const d = deps();
    await rejects(recordAttestedPdfText({ mode: 'attested_pdf_text', source, pages }, d), 'attested_pdf_contract_invalid');
    assert(d.calls.length === 0, 'invalid pages reached writer');
  }
  for (const source_url of ['http://example.com/catalog.pdf', 'https://u:p@example.com/catalog.pdf', 'https://example.com/a.pdf?secret=x']) {
    const d = deps();
    await rejects(recordAttestedPdfText({ mode: 'attested_pdf_text', source: { ...source, source_url }, pages: ['a', '', 'b'] }, d), 'attested_pdf_source_invalid');
  }
});
Deno.test('attested PDF source returns source-only receipt and preserves empty pages', async () => {
  const d = deps();
  const result = await recordAttestedPdfText({ mode: 'attested_pdf_text', source, pages: ['a', '', 'b'] }, d);
  assert(d.calls.length === 1 && result.source_pages_only === true && result.model_calls === 0, 'source-only receipt missing');
  assert((d.calls[0] as { pages: string[] }).pages[1] === '', 'empty page lost');
});
Deno.test('attested PDF source refuses a malformed persistence receipt', async () => {
  const d = deps(); d.record = async () => ({ success: true, document_id: 'bad', revision: 'c'.repeat(64), page_count: 3,
    duplicate: false, pdf_hash_status: 'client_attested_not_server_rehashed',
    text_provenance_status: 'client_attested_extraction_not_server_verified' });
  await rejects(recordAttestedPdfText({ mode: 'attested_pdf_text', source, pages: ['a', '', 'b'] }, d), 'attested_pdf_receipt_invalid');
});

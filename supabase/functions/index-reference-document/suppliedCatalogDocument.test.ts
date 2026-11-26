import { sha256 } from './suppliedReference.ts';
import { validateCatalogDocument, recordSuppliedCatalogDocument } from './suppliedCatalogDocument.ts';
const assert = (v: unknown, m = 'assertion failed') => { if (!v) throw Error(m); };
export async function catalogDocumentFixture(body = 'Item No. TEST-KIT\r\n$1.00 / Each\r\n## Overview\r\nPack Quantity: 6 Each\r\nRubber 90º boots\r\n') {
  const bytes = new TextEncoder().encode(body);
  return { mode: 'supplied_catalog_source', document: { title: 'Synthetic supplied source', source_url: 'https://supplier.example/TEST-KIT',
    file_sha256: await sha256(bytes), claimed_captured_at: '2026-09-27T00:19:17Z', media_type: 'text/markdown' },
    body_base64: btoa(String.fromCharCode(...bytes)) };
}
Deno.test('Markdown bytes, CRLF, unicode and claimed capture clock survive unchanged', async () => {
  const input = await catalogDocumentFixture(), v = await validateCatalogDocument(input);
  assert(v.body.includes('90º') && v.body.includes('\r\n') && await sha256(new TextEncoder().encode(v.body)) === input.document.file_sha256);
  const bom = await catalogDocumentFixture('\ufeffItem No. TEST-KIT\n');
  assert((await validateCatalogDocument(bom)).body.charCodeAt(0) === 0xfeff, 'BOM must not disappear');
});
Deno.test('bad hash, NUL, malformed UTF8 and caller authority cannot enter supplied import', async () => {
  const invalid = [
    { ...await catalogDocumentFixture(), document: { ...(await catalogDocumentFixture()).document, file_sha256: 'a'.repeat(64) } },
    await catalogDocumentFixture('nul\0byte'),
    { ...await catalogDocumentFixture(), body_base64: btoa(String.fromCharCode(0xc3, 0x28)) },
    { ...await catalogDocumentFixture(), document: { ...(await catalogDocumentFixture()).document, authority: 'manufacturer_verified' } },
  ];
  for (const x of invalid) { let rejected = false; try { await validateCatalogDocument(x); } catch { rejected = true; } assert(rejected); }
});
Deno.test('supplier source import retains then records then uses only canonical source selector', async () => {
  const calls: string[] = [], input = await catalogDocumentFixture();
  const result = await recordSuppliedCatalogDocument(input, {
    authorize: async () => true,
    retain: async (_bytes, hash) => { assert(hash === input.document.file_sha256); calls.push('retain'); },
    record: async (document, body) => { assert(body.includes('90º') && document.claimed_captured_at === input.document.claimed_captured_at);
      calls.push('record'); return { success: true, document_id: '10000000-0000-4000-8000-000000000001', file_hash: document.file_sha256 }; },
    ingest: async selector => { assert(Object.keys(selector).sort().join(',') === 'document_id,mode');
      calls.push('ingest'); return { success: true, observation_id: '20000000-0000-4000-8000-000000000001' }; },
  });
  assert(calls.join(',') === 'retain,record,ingest' && result.authority === 'supplied_document_unverified' && !result.purchasing_eligible);
});

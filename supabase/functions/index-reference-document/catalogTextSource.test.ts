import { recordCatalogTextSource } from './catalogTextSource.ts';
import { ReferenceError } from './suppliedReference.ts';

const source = {
  catalog_id: '00000000-0000-4000-8000-000000000002',
  object_id: '00000000-0000-4000-8000-000000000001',
  object_version: 'v1', object_name: 'test catalog/a.pdf',
  pdf_sha256: 'a'.repeat(64), text_sha256: 'b'.repeat(64),
  page_count: 3, chunk_count: 2, reader_actor: 'agent:test', reader_method: 'local_exact_replay', reader_run_id: 'test',
};
function deps() {
  const calls: Record<string, unknown>[] = [];
  return { calls, authorize: async () => true, projectUrl: 'https://sample.supabase.co',
    record: async (input: Record<string, unknown>) => {
      calls.push(input);
      return { success: true, document_id: '00000000-0000-4000-8000-000000000003', revision: 'c'.repeat(64),
        page_count: 3, duplicate: false, pdf_hash_status: 'client_attested_not_server_rehashed' };
    } };
}
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
async function rejects(p: Promise<unknown>, code: string) {
  try { await p; } catch (e) { if (e instanceof ReferenceError && e.code === code) return; throw e; }
  throw new Error(`Expected ${code}`);
}

Deno.test('catalog source requires service authority before any record attempt', async () => {
  const d = deps(); d.authorize = async () => false;
  await rejects(recordCatalogTextSource({ mode: 'retained_catalog_text', source }, d), 'catalog_text_service_required');
  assert(d.calls.length === 0, 'unauthorized source reached the writer');
});

Deno.test('catalog source rejects malformed snapshots and caller-supplied project origin', async () => {
  for (const bad of [
    { ...source, page_count: 0 }, { ...source, chunk_count: 1.5 }, { ...source, text_sha256: 'x' },
    { ...source, object_name: '../other.pdf' }, { ...source, project_origin: 'https://other.example' },
  ]) {
    const d = deps();
    await rejects(recordCatalogTextSource({ mode: 'retained_catalog_text', source: bad }, d), 'catalog_text_contract_invalid');
    assert(d.calls.length === 0, 'invalid source reached the writer');
  }
});

Deno.test('catalog source derives the origin and returns a source-only receipt', async () => {
  const d = deps();
  const result = await recordCatalogTextSource({ mode: 'retained_catalog_text', source }, d);
  assert(d.calls.length === 1 && d.calls[0].project_origin === 'https://sample.supabase.co', 'origin was not derived from service configuration');
  assert(result.source_pages_only === true && result.model_calls === 0, 'source-only receipt missing');
});

Deno.test('catalog source fails closed on a wrong receipt', async () => {
  const d = deps();
  d.record = async () => ({ success: true, document_id: 'wrong', revision: 'c'.repeat(64), page_count: 3,
    duplicate: false, pdf_hash_status: 'client_attested_not_server_rehashed' });
  await rejects(recordCatalogTextSource({ mode: 'retained_catalog_text', source }, d), 'catalog_text_receipt_invalid');
});

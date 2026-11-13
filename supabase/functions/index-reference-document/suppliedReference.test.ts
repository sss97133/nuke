import { recordSuppliedReference, ReferenceError, sha256, validateReference } from './suppliedReference.ts';
import { referenceFixture } from './suppliedReference.fixture.ts';
const assert = (ok: unknown, message = 'assertion failed') => { if (!ok) throw new Error(message); };
const documentId = '10000000-0000-4000-8000-000000000001';
const observationId = '20000000-0000-4000-8000-000000000001';
function effects() {
  const calls: any[] = [];
  return { calls, authorize: async () => true,
    retain: async (bytes: Uint8Array, hash: string) => { calls.push(['retain', bytes.length, hash]); },
    record: async (d: any, pages: any, reader: any, at: any) => { calls.push(['record', d, pages, reader, at]);
      return { success: true, document_id: documentId, file_hash: d.pdf_sha256, reference_revision: 'r'.repeat(64) }; },
    ingest: async (o: any) => { calls.push(['ingest', o]); return { success: true, observation_id: observationId }; },
    project: async (id: string) => { calls.push(['project', id]); return { success: true, observation_id: id, document_id: documentId }; },
  };
}
Deno.test('supplied reference retains exact bytes and emits deferred source-only testimony', async () => {
  const f = await referenceFixture(), e = effects(); const result = await recordSuppliedReference(f, e);
  assert(result.model_calls === 0 && e.calls.map(c => c[0]).join(',') === 'retain,record,ingest,project');
  const o = e.calls.find(c => c[0] === 'ingest')[1];
  assert(o.agent_inferred && o.defer_analysis && !('vehicle_id' in o) && !('vehicle_hints' in o));
  assert(o.citation.document_id === documentId && o.citation.page_number === 2 && o.citation.excerpt === f.pages[0].extracted_text);
  assert(o.structured_data.taxonomy_binding === 'unresolved' && o.observed_at === f.reviewed_at);
  assert(e.calls[1][1].retrieved_at === null && !('pdf_base64' in e.calls[1][1]), 'no invented capture clock or bytes in SQL');
});
Deno.test('authorization precedes all validation and persistence', async () => {
  const e = effects();e.authorize = async () => false;
  try { await recordSuppliedReference({}, e); throw Error('accepted'); } catch (error) { assert(error instanceof ReferenceError && error.status === 403); }
  assert(e.calls.length === 0);
});
const refusals: [string, (x: any) => void][] = [
  ['wrong PDF hash', x => x.document.pdf_sha256 = '0'.repeat(64)],
  ['invalid source URL', x => x.document.source_url = 'not a URL'],
  ['source credentials', x => x.document.source_url = 'https://token@manufacturer.example/reference.pdf'],
  ['missing review clock', x => delete x.reviewed_at],
  ['infinite review clock', x => x.reviewed_at = 'infinity'],
  ['invalid capture day', x => x.document.retrieved_day = '2026-02-30'],
  ['future review', x => x.reviewed_at = '2100-01-01T00:00:00Z'],
  ['missing reader', x => delete x.reader.model],
  ['duplicate page', x => x.pages.push(x.pages[0])],
  ['nonexistent page citation', x => x.assembly.positions[0].source_refs[0].page_number = 3],
  ['invented citation text', x => x.assembly.positions[0].source_refs[0].excerpt = 'unread statement'],
  ['duplicate position', x => x.assembly.positions[1].key = 'upper'],
  ['invented subject binding', x => x.assembly.positions[0].subject_id = documentId],
  ['fractional physical quantity', x => x.assembly.positions[0].quantity = .5],
  ['unknown quantity', x => x.assembly.positions[0].quantity = null],
  ['unordered pair claimed exact', x => x.assembly.positions[3].part_number_binding = 'exact_position'],
  ['no scope exclusion', x => x.assembly.exclusions = []],
  ['wrong application interval', x => x.assembly.application.year_end = 1972],
  ['owner confirmation injection', x => x.assembly.owner_confirmed = true],
];
for (const [name, change] of refusals) Deno.test(`supplied reference refuses ${name} before effects`, async () => {
  const f = await referenceFixture(), e = effects(); change(f);
  try { await recordSuppliedReference(f, e); throw Error('accepted'); } catch (error) { assert(error instanceof ReferenceError); }
  assert(e.calls.length === 0);
});
Deno.test('correct digest does not admit non-PDF bytes', async () => {
  const f = await referenceFixture(), bytes = new TextEncoder().encode('ordinary text with no PDF');
  f.document.pdf_base64 = btoa(String.fromCharCode(...bytes)); f.document.pdf_sha256 = await sha256(bytes);
  try { await validateReference(f); throw Error('accepted'); } catch (error) { assert(error instanceof ReferenceError && error.code === 'reference_pdf_invalid'); }
});
Deno.test('identical retained input creates stable source identifier without inventing unit identities', async () => {
  const f = await referenceFixture(), a = effects(), b = effects(); await recordSuppliedReference(f, a); await recordSuppliedReference(f, b);
  assert(a.calls[2][1].source_identifier === b.calls[2][1].source_identifier);
  assert(a.calls[2][1].structured_data.reference_assembly.positions.every((p: any) => p.subject_id === null));
});
Deno.test('failed source or projection cannot report success', async () => {
  const f = await referenceFixture(), a = effects(); a.record = async () => ({ success: false } as any);
  try { await recordSuppliedReference(f, a); throw Error('accepted'); } catch (error) { assert(error instanceof ReferenceError && error.status === 502); }
  assert(a.calls.every(c => c[0] !== 'ingest'));
  const b = effects(); b.project = async () => ({ success: true, observation_id: documentId, document_id: documentId });
  try { await recordSuppliedReference(f, b); throw Error('accepted'); } catch (error) { assert(error instanceof ReferenceError && error.status === 409); }
});

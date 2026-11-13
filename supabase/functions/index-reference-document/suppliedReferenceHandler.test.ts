import { referenceFixture } from './suppliedReference.fixture.ts';
const project = 'https://reference-fixture.invalid', secret = 'sb_secret_reference_fixture';
Deno.env.set('SUPABASE_URL', project); Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', secret); Deno.env.delete('SUPABASE_SECRET_KEYS');
let handler: (req: Request) => Promise<Response>;
const serve = Deno.serve; Deno.serve = ((cb: typeof handler) => { handler = cb; }) as typeof Deno.serve;
const calls: string[] = []; let intake: any, rejectProjection = false, duplicate = false, wrongBytes = false;
const assert = (v: unknown, m = 'assertion failed') => { if (!v) throw Error(m); };
const docId = '10000000-0000-4000-8000-000000000001', obsId = '20000000-0000-4000-8000-000000000001';
globalThis.fetch = (async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const headers = new Headers(init?.headers); assert(url.origin === project && headers.get('apikey') === secret, 'service credentials stay at project');
  calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
  if (url.pathname.startsWith('/storage/v1/object/reference-docs/supplied/')) {
    assert(init?.method === 'POST' && headers.get('x-upsert') === 'false', 'immutable upload only');
    return duplicate ? Response.json({ statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }, { status: 409 }) : Response.json({ Key: url.pathname, Id: docId });
  }
  if (url.pathname.startsWith('/storage/v1/object/authenticated/reference-docs/supplied/')) {
    const f = await referenceFixture(); return new Response(wrongBytes ? 'wrong PDF' : atob(f.document.pdf_base64));
  }
  if (url.pathname === '/rest/v1/rpc/record_supplied_reference_document') {
    const args = JSON.parse(String(init?.body)); assert(!('pdf_base64' in args.p_document));
    return Response.json({ success: true, document_id: docId, file_hash: args.p_document.pdf_sha256, reference_revision: 'r'.repeat(64) });
  }
  if (url.pathname === '/functions/v1/ingest-observation') {
    intake = JSON.parse(String(init?.body)); return Response.json({ success: true, observation_id: obsId });
  }
  if (url.pathname === '/rest/v1/rpc/project_reference_assembly') return rejectProjection ? Response.json({ message: 'source changed' }, { status: 400 }) :
    Response.json({ success: true, observation_id: obsId, document_id: docId, assembly_id: '30000000-0000-4000-8000-000000000001' });
  throw Error(`Unexpected provider/queue/filing call: ${url.pathname}`);
}) as typeof fetch;
await import('./index.ts'); Deno.serve = serve;
async function request(token = secret) { return new Request(`${project}/functions/v1/index-reference-document`, {
  method: 'POST', headers: { apikey: token, 'Content-Type': 'application/json' }, body: JSON.stringify(await referenceFixture()) }); }
Deno.test('actual supplied-reference handler only archives, records, ingests and projects', async () => {
  calls.length = 0; rejectProjection = duplicate = wrongBytes = false;
  const response = await handler(await request()), result = await response.json();
  assert(response.status === 200 && result.success && result.model_calls === 0);
  assert(calls.length === 4 && calls[0].startsWith('POST /storage/v1/object/reference-docs/supplied/')
    && calls.slice(1).join('|') === 'POST /rest/v1/rpc/record_supplied_reference_document|POST /functions/v1/ingest-observation|POST /rest/v1/rpc/project_reference_assembly');
  assert(intake.defer_analysis && intake.agent_inferred && !intake.vehicle_id && !intake.vehicle_hints);
});
Deno.test('actual reference handler rejects anonymous credentials before effects', async () => {
  calls.length = 0; const response = await handler(await request('sb_publishable_fixture')); assert(response.status === 401 && calls.length === 0); await response.body?.cancel();
});
Deno.test('actual replay verifies existing bytes and never overwrites', async () => {
  calls.length = 0; duplicate = true; const response = await handler(await request()); assert(response.status === 200 && calls.length === 5); await response.body?.cancel();
  wrongBytes = true; calls.length = 0; const refused = await handler(await request()); assert(refused.status === 409 && calls.length === 2); await refused.body?.cancel();
  duplicate = wrongBytes = false;
});
Deno.test('actual source withdrawal returns409 without legacy model routes', async () => {
  calls.length = 0; rejectProjection = true; const response = await handler(await request()); const result = await response.json();
  assert(response.status === 409 && result.model_calls === 0 && calls.length === 4); rejectProjection = false;
});

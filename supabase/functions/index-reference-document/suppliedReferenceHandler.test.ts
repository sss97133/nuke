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
  if (url.pathname.startsWith('/storage/v1/object/reference-docs/supplied/') && init?.method === 'POST') {
    assert(init?.method === 'POST' && headers.get('x-upsert') === 'false', 'immutable upload only');
    return duplicate ? Response.json({ statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }, { status: 409 }) : Response.json({ Key: url.pathname, Id: docId });
  }
  if (url.pathname.startsWith('/storage/v1/object/authenticated/reference-docs/supplied/')
    || url.pathname.startsWith('/storage/v1/object/reference-docs/supplied/') && init?.method === 'GET') {
    const f = await referenceFixture(); return new Response(wrongBytes ? 'wrong PDF' : atob(f.document.pdf_base64));
  }
  if (url.pathname === '/rest/v1/rpc/record_supplied_reference_document') {
    const args = JSON.parse(String(init?.body)); assert(!('pdf_base64' in args.p_document));
    return Response.json({ success: true, document_id: docId, file_hash: args.p_document.pdf_sha256, reference_revision: 'r'.repeat(64) });
  }
  if (url.pathname === '/rest/v1/rpc/record_catalog_text_source') {
    const args = JSON.parse(String(init?.body));
    assert(args.p_source.project_origin === project, 'origin comes from the configured project');
    return Response.json({ success: true, document_id: docId, revision: 'c'.repeat(64),
      page_count: args.p_source.page_count, duplicate: false, pdf_hash_status: 'client_attested_not_server_rehashed' });
  }
  if (url.pathname === '/rest/v1/rpc/record_attested_pdf_text') {
    const args = JSON.parse(String(init?.body)); assert(args.p_pages.length === args.p_source.page_count);
    return Response.json({ success: true, document_id: docId, revision: 'd'.repeat(64),
      page_count: args.p_source.page_count, duplicate: false, pdf_hash_status: 'client_attested_not_server_rehashed',
      text_provenance_status: 'client_attested_extraction_not_server_verified' });
  }
  if (url.pathname === '/rest/v1/rpc/record_catalog_page_membership') {
    const args = JSON.parse(String(init?.body));
    assert(args.p_pages.length === 1 && args.p_catalog.provider === 'LMC');
    return Response.json({ success: true, catalog_id: '30000000-0000-4000-8000-000000000001',
      pages_submitted: args.p_pages.length, inserted: 1, replayed: 0,
      mapping_status: 'client_attested_not_server_reextracted' });
  }
  if (url.pathname === '/rest/v1/rpc/record_catalog_page_word_geometry') {
    const args=JSON.parse(String(init?.body)), geometry=JSON.parse(args.p_geometry);
    assert(args.p_page===20 && geometry.words.length===1);
    return Response.json({success:true,extraction_id:'40000000-0000-4000-8000-000000000001',
      page_id:'20000000-0000-4000-8000-000000000001',word_count:1,duplicate:false,extractor_version:args.p_extractor_version,
      geometry_status:'client_attested_not_server_reextracted'});
  }
  if (url.pathname === '/rest/v1/rpc/record_catalog_document_page_word_geometry') {
    const args=JSON.parse(String(init?.body)), geometry=JSON.parse(args.p_geometry);
    assert(args.p_document===docId && args.p_page===2 && args.p_actor==='agent:test' && geometry.words.length===1);
    return Response.json({success:true,extraction_id:'40000000-0000-4000-8000-000000000001',
      page_id:'20000000-0000-4000-8000-000000000001',word_count:1,duplicate:false,extractor_version:args.p_extractor_version,
      geometry_status:'client_attested_not_server_reextracted'});
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

function membershipRequest(token = secret, change?: (input: any) => void) {
  const input: any = { mode: 'catalog_page_membership', catalog: {
    name: 'Synthetic SUV catalog', provider: 'LMC', base_url: 'https://example.test/suv/full.pdf',
    full_pdf_sha256: 'f'.repeat(64), expected_page_count: 220, reader_actor: 'agent:test',
    reader_run_id: 'test', reader_verified_at: new Date().toISOString(),
  }, pages: [{ catalog_page_number: 11, document_id: '10000000-0000-4000-8000-000000000011',
    document_page_id: '20000000-0000-4000-8000-000000000011', pdf_sha256: '1'.repeat(64),
    full_geometry_sha256: '7'.repeat(64), individual_geometry_sha256: '7'.repeat(64),
    full_render_sha256: '8'.repeat(64), individual_render_sha256: '8'.repeat(64) }] };
  change?.(input);
  return new Request(`${project}/functions/v1/index-reference-document`, {
    method: 'POST', headers: { apikey: token, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
}
Deno.test('actual page membership handler invokes only the protected source writer', async () => {
  calls.length = 0; const response = await handler(membershipRequest()), result = await response.json();
  assert(response.status === 200 && result.source_membership_only === true && result.model_calls === 0);
  assert(calls.length === 1 && calls[0] === 'POST /rest/v1/rpc/record_catalog_page_membership');
});
Deno.test('actual page membership handler rejects anonymous and invented claims', async () => {
  calls.length = 0; const denied = await handler(membershipRequest('sb_publishable_fixture'));
  assert(denied.status === 401 && calls.length === 0); await denied.body?.cancel();
  const invalid = await handler(membershipRequest(secret, input => input.pages[0].fitment = 'invented'));
  assert(invalid.status === 400 && calls.length === 0); await invalid.body?.cancel();
});
function wordGeometryRequest(token=secret,change?: (input:any)=>void) {
  const input:any={mode:'catalog_page_word_geometry',catalog_id:'30000000-0000-4000-8000-000000000001',
    catalog_page_number:20,catalog_edition_sha256:'f'.repeat(64),extractor_version:'pdftotext version fixture',
    geometry:JSON.stringify({width:'100',height:'200',words:[['1','2','3','4','cover']]})};
  change?.(input);
  return new Request(`${project}/functions/v1/index-reference-document`,{
    method:'POST',headers:{apikey:token,'Content-Type':'application/json'},body:JSON.stringify(input)});
}
Deno.test('actual word geometry handler uses only the protected source writer',async()=>{
  calls.length=0;const response=await handler(wordGeometryRequest()),result=await response.json();
  assert(response.status===200 && result.source_geometry_only===true && result.model_calls===0);
  assert(calls.length===1 && calls[0]==='POST /rest/v1/rpc/record_catalog_page_word_geometry');
});
Deno.test('actual word geometry handler rejects anonymous or invented claims',async()=>{
  calls.length=0;const denied=await handler(wordGeometryRequest('sb_publishable_fixture'));
  assert(denied.status===401 && calls.length===0);await denied.body?.cancel();
  const invalid=await handler(wordGeometryRequest(secret,input=>input.fitment='invented'));
  assert(invalid.status===400 && calls.length===0);await invalid.body?.cancel();
});
Deno.test('legacy model part extraction refuses before source, model or database effects',async()=>{
  calls.length=0;
  const response=await handler(new Request(`${project}/functions/v1/index-reference-document`,{
    method:'POST',headers:{apikey:secret,'Content-Type':'application/json'},
    body:JSON.stringify({mode:'extract_parts',pdf_url:'https://example.test/catalog.pdf',page_start:1,page_end:50}),
  }));
  const result=await response.json();
  assert(response.status===409 && result.error==='catalog_source_scope_unqualified' && result.model_calls===0);
  assert(calls.length===0,'unqualified extraction reached an external or database request');
});
function documentWordGeometryRequest(token=secret,change?:(input:any)=>void) {
  const input:any={mode:'catalog_document_page_word_geometry',catalog_id:'30000000-0000-4000-8000-000000000001',
    document_id:docId,catalog_page_number:2,pdf_sha256:'f'.repeat(64),extractor_version:'pdftotext version fixture',
    geometry:JSON.stringify({width:'100',height:'200',words:[['1','2','3','4','word']]}),
    reader:{actor:'agent:test',run_id:'fixed-run',verified_at:'2026-01-01T00:00:00Z'}};
  change?.(input);
  return new Request(`${project}/functions/v1/index-reference-document`,{
    method:'POST',headers:{apikey:token,'Content-Type':'application/json'},body:JSON.stringify(input)});
}
Deno.test('actual whole catalog geometry handler records only attributed page geometry',async()=>{
  calls.length=0;const response=await handler(documentWordGeometryRequest()),result=await response.json();
  assert(response.status===200 && result.source_geometry_only===true && result.model_calls===0);
  assert(calls.length===1 && calls[0]==='POST /rest/v1/rpc/record_catalog_document_page_word_geometry');
});
Deno.test('actual whole catalog geometry handler rejects anonymous or invented claims',async()=>{
  calls.length=0;const denied=await handler(documentWordGeometryRequest('sb_publishable_fixture'));
  assert(denied.status===401 && calls.length===0);await denied.body?.cancel();
  const invalid=await handler(documentWordGeometryRequest(secret,input=>input.fitment='invented'));
  assert(invalid.status===400 && calls.length===0);await invalid.body?.cancel();
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
  calls.length = 0; duplicate = wrongBytes = false; rejectProjection = true; const response = await handler(await request()); const result = await response.json();
  assert(response.status === 409 && result.model_calls === 0 && calls.length === 4); rejectProjection = false;
});

async function documentRequest(token = secret, change?: (input: any) => void) {
  const { assembly: _, ...input } = await referenceFixture();
  input.mode = 'supplied_document'; input.document.category = 'component_datasheet'; change?.(input);
  return new Request(`${project}/functions/v1/index-reference-document`, {
    method: 'POST', headers: { apikey: token, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
}
Deno.test('actual supplied-document handler persists custody without assembly, observation or model work', async () => {
  calls.length = 0; duplicate = wrongBytes = rejectProjection = false; intake = undefined;
  const response = await handler(await documentRequest()), result = await response.json();
  assert(response.status === 200 && result.success && result.custody_only === true && result.model_calls === 0);
  assert(result.document_id === docId && calls.length === 2 && calls[0].startsWith('POST /storage/v1/object/reference-docs/supplied/')
    && calls[1] === 'POST /rest/v1/rpc/record_supplied_reference_document' && intake === undefined);
});
Deno.test('actual document mode rejects anonymous credentials and assembly injection without effects', async () => {
  calls.length = 0; const denied = await handler(await documentRequest('sb_publishable_fixture'));
  assert(denied.status === 401 && calls.length === 0); await denied.body?.cancel();
  const invalid = await handler(await documentRequest(secret, input => input.assembly = { name: 'invented' }));
  assert(invalid.status === 400 && calls.length === 0); await invalid.body?.cancel();
});
Deno.test('actual document replay verifies bytes and refuses changed storage contents', async () => {
  calls.length = 0; duplicate = true; wrongBytes = rejectProjection = false;
  const replay = await handler(await documentRequest());
  assert(replay.status === 200 && calls.length === 3 && calls[1].startsWith('GET /storage/v1/object/')
    && calls[2] === 'POST /rest/v1/rpc/record_supplied_reference_document'); await replay.body?.cancel();
  calls.length = 0; wrongBytes = true;
  const changed = await handler(await documentRequest());
  assert(changed.status === 409 && calls.length === 2); await changed.body?.cancel(); duplicate = wrongBytes = false;
});

function catalogRequest(token = secret, change?: (input: any) => void) {
  const input: any = { mode: 'retained_catalog_text', source: {
    catalog_id: '00000000-0000-4000-8000-000000000002', object_id: '00000000-0000-4000-8000-000000000001',
    object_version: 'v1', object_name: 'test catalog/a.pdf', pdf_sha256: 'a'.repeat(64), text_sha256: 'b'.repeat(64),
    page_count: 3, chunk_count: 2, reader_actor: 'agent:test', reader_method: 'local_exact_replay', reader_run_id: 'test',
    reader_verified_at: new Date().toISOString() } };
  change?.(input);
  return new Request(`${project}/functions/v1/index-reference-document`, {
    method: 'POST', headers: { apikey: token, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
}
Deno.test('actual retained-catalog handler only invokes source-page admission', async () => {
  calls.length = 0; const response = await handler(catalogRequest()), result = await response.json();
  assert(response.status === 200 && result.source_pages_only === true && result.model_calls === 0);
  assert(calls.length === 1 && calls[0] === 'POST /rest/v1/rpc/record_catalog_text_source');
});
Deno.test('actual retained-catalog handler rejects anonymous and caller-supplied origins', async () => {
  calls.length = 0; const denied = await handler(catalogRequest('sb_publishable_fixture'));
  assert(denied.status === 401 && calls.length === 0); await denied.body?.cancel();
  const invalid = await handler(catalogRequest(secret, input => input.source.project_origin = 'https://other.example'));
  assert(invalid.status === 400 && calls.length === 0); await invalid.body?.cancel();
});

function attestedRequest(token = secret, change?: (input: any) => void) {
  const input: any = { mode: 'attested_pdf_text', source: {
    title: 'Synthetic SUV catalog', source_url: 'https://example.com/catalog.pdf',
    object_id: '00000000-0000-4000-8000-000000000001', object_version: 'v1',
    object_name: `catalog-public/${'a'.repeat(64)}.pdf`, pdf_sha256: 'a'.repeat(64), pdf_size: 123,
    text_sha256: 'b'.repeat(64), page_count: 3, reader_actor: 'agent:test',
    reader_method: 'client_sha256_pdftotext_v1', reader_run_id: 'test', reader_verified_at: new Date().toISOString(),
  }, pages: ['a', '', 'b'] };
  change?.(input);
  return new Request(`${project}/functions/v1/index-reference-document`, {
    method: 'POST', headers: { apikey: token, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
}
Deno.test('actual attested PDF handler only invokes source-page admission', async () => {
  calls.length = 0; const response = await handler(attestedRequest()), result = await response.json();
  assert(response.status === 200 && result.source_pages_only === true && result.model_calls === 0);
  assert(calls.length === 1 && calls[0] === 'POST /rest/v1/rpc/record_attested_pdf_text');
});
Deno.test('actual attested PDF handler rejects anonymous and injected assembly without effects', async () => {
  calls.length = 0; const denied = await handler(attestedRequest('sb_publishable_fixture'));
  assert(denied.status === 401 && calls.length === 0); await denied.body?.cancel();
  const invalid = await handler(attestedRequest(secret, input => input.assembly = { name: 'invented' }));
  assert(invalid.status === 400 && calls.length === 0); await invalid.body?.cancel();
});

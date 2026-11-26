// Both real HTTP entry points and SDK routes; only storage/database are mocked.
// SQL contract independently executes the real qualifier/guard/projection.
import { sha256 } from '../index-reference-document/suppliedReference.ts';
const assert = (v: unknown, m = 'assertion failed') => { if (!v) throw Error(m); };
const project = 'https://catalog-fixture.invalid', secret = 'sb_secret_catalog_fixture';
Deno.env.set('SUPABASE_URL', project); Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', secret); Deno.env.delete('SUPABASE_SECRET_KEYS');
type Handler = (r: Request) => Promise<Response>;
let importer: Handler, intake: Handler;
const serve = Deno.serve;
Deno.serve = ((h: Handler) => { importer = h; }) as typeof Deno.serve;
await import('../index-reference-document/index.ts');
Deno.serve = ((h: Handler) => { intake = h; }) as typeof Deno.serve;
await import('./index.ts');
Deno.serve = serve;
const docId = '10000000-0000-4000-8000-000000000001', sourceId = '20000000-0000-4000-8000-000000000001';
const propertyId = '30000000-0000-4000-8000-000000000001', partId = '40000000-0000-4000-8000-000000000001';
const json = (x: unknown, status = 200) => Response.json(x, { status });
const request = (handler: Handler, body: unknown, key: string | null = secret) => handler(new Request(project + '/functions/v1/fixture',
 { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { apikey: key } : {}) }, body: JSON.stringify(body) }));
Deno.test('actual import and property intake preserve custody and reject forged selectors without fetching supplier', async () => {
  const body = 'Item No. TEST-KIT\n$1.00 / Each\n## Overview\nPack Quantity: 6 Each\nRubber 90º boots\n';
  const bytes = new TextEncoder().encode(body), hash = await sha256(bytes);
  const input = { mode: 'supplied_catalog_source', document: { title: 'Synthetic source', source_url: 'https://supplier.example/TEST-KIT',
    file_sha256: hash, claimed_captured_at: '2026-09-27T00:19:17Z', media_type: 'text/markdown' },
    body_base64: btoa(String.fromCharCode(...bytes)) };
  const sourceRecipe = { source_id: '50000000-0000-4000-8000-000000000001', source_identifier: 'fixture-source',
    content_hash: 'source-fixture', extraction_method: 'supplied_catalog_source_v1', content_text: body };
  const property = { quantity: 6, quantity_unit: 'ea', authority: 'supplied_document_unverified', purchasing_eligible: false };
  const propertyRecipe = { source_id: sourceRecipe.source_id, source_identifier: 'fixture-property', content_hash: 'property-fixture',
    extraction_method: 'catalog_supply_property_v1', structured_data: property, source_observation_id: sourceId };
  const rows: any[] = [], calls: string[] = []; let stored = false, corruptBytes = false, current = true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (resource, init) => {
    const url = new URL(resource instanceof Request ? resource.url : String(resource));
    assert(url.origin === project, 'no supplier, model or external fetch');
    calls.push((init?.method ?? 'GET') + ' ' + url.pathname);
    if (url.pathname.startsWith('/storage/v1/object/reference-docs/')) {
      if (!init?.method || init.method === 'GET') return new Response(corruptBytes ? 'corrupted' : bytes);
      assert(init?.method === 'POST' && new Headers(init.headers).get('x-upsert') === 'false');
      assert(new Headers(init?.headers).get('content-type') === 'text/markdown', 'Markdown keeps correct MIME');
      if (stored) return json({ statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }, 409);
      stored = true; return json({ Key: url.pathname, Id: docId });
    }
    if (url.pathname.startsWith('/storage/v1/object/authenticated/reference-docs/'))
      return new Response(corruptBytes ? 'corrupted' : bytes);
    if (url.pathname.endsWith('/rpc/record_supplied_catalog_document')) {
      const a = JSON.parse(String(init?.body)); assert(a.p_body === body && a.p_document.file_sha256 === hash);
      return json({ success: true, document_id: docId, file_hash: hash, duplicate: rows.length > 0 });
    }
    if (url.pathname === '/functions/v1/ingest-observation') return intake(new Request(url, init));
    if (url.pathname.endsWith('/rpc/qualify_catalog_document') || url.pathname.endsWith('/rpc/qualify_catalog_supply_property')) {
      const a = JSON.parse(String(init?.body)), isProperty = url.pathname.endsWith('qualify_catalog_supply_property');
      if (!current || isProperty && (a.p_source !== sourceId || a.p_part !== partId || a.p_line !== 4)) return json(null);
      return json({ input: isProperty ? propertyRecipe : sourceRecipe, property: isProperty ? property : undefined,
        result_verified: a.p_result ? rows.some(x => x.id === a.p_result) : false });
    }
    if (url.pathname === '/rest/v1/vehicle_observations') {
      if (init?.method === 'POST') {
        const row = JSON.parse(String(init.body)), id = row.extraction_method === 'supplied_catalog_source_v1' ? sourceId : propertyId;
        assert(JSON.stringify(row) === JSON.stringify(id === sourceId ? sourceRecipe : propertyRecipe), 'only qualified recipe inserted');
        const saved = { ...row, id }; rows.push(saved); return json(saved, 201);
      }
      const found = rows.filter(x => 'eq.' + x.content_hash === url.searchParams.get('content_hash'));
      return json(found);
    }
    throw Error('Unexpected SDK route: ' + url.pathname);
  }) as typeof fetch;
  try {
    let r = await request(importer, input); let value = await r.json();
    assert(r.status === 200 && value.source_observation_id === sourceId && rows.length === 1, JSON.stringify(value));
    r = await request(importer, input); value = await r.json();
    assert(r.status === 200 && value.duplicate && rows.length === 1, 'duplicate checks existing original bytes: ' + JSON.stringify({ status: r.status, value, calls }));
    const selector = { mode: 'catalog_supply_property', source_observation_id: sourceId, catalog_part_id: partId, source_line: 4 };
    r = await request(intake, selector); value = await r.json();
    assert(r.status === 200 && value.property.quantity === 6 && !value.purchasing_eligible && rows.length === 2);
    r = await request(intake, { ...selector, quantity: 99 }); assert(r.status === 400); await r.body?.cancel();
    r = await request(intake, { source_slug: 'supplied-catalog-document', ...propertyRecipe }); assert(r.status === 400); await r.body?.cancel();
    r = await request(intake, selector, null); assert(r.status === 403); await r.body?.cancel();
    current = false; r = await request(intake, selector); assert(r.status === 422 && rows.length === 2); await r.body?.cancel();
    corruptBytes = true; r = await request(importer, input); assert(r.status === 409); await r.body?.cancel();
  } finally { globalThis.fetch = originalFetch; }
});

import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { retainImage } from '../_shared/catalogStockImage.ts';
import { firecrawlScrape } from '../_shared/firecrawl.ts';

const url = 'https://images-prod.oreillyauto.com/parts/img/large/brand/exact-sku.jpg';
const jpeg = new Uint8Array(128); jpeg.set([0xff, 0xd8, 0xff, 0xe0]);
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
function fixture(directStatus = 403) {
  const objects = new Map<string, Uint8Array>();
  const requests: any[] = []; let uploads = 0;
  const bucket = {
    upload(path: string, bytes: Uint8Array, options: any) {
      uploads++; assertEquals(options, { contentType: 'image/jpeg', upsert: false });
      if (objects.has(path)) return { error: { statusCode: '409' } };
      objects.set(path, bytes.slice()); return { error: null };
    },
    download(path: string) { return { data: objects.has(path) ? new Blob([new Uint8Array(objects.get(path)!)]) : null }; },
    getPublicUrl(path: string) { return { data: { publicUrl: 'https://storage.example/' + path } }; },
  };
  const admin = { storage: { from(name: string) { assertEquals(name, 'catalog-images'); return bucket; } } };
  const payload: any = { success: true, data: { rawBase64: base64(jpeg), metadata: { sourceURL: url, url, statusCode: 200, contentType: 'image/jpeg' } } };
  const remote: any = { ok: true, success: true, httpStatus: 200, error: null, blocked: false, raw: payload };
  const effects = {
    fetch: (async (input: any, options: any) => { assertEquals(input, url); assertEquals(options.redirect, 'error');
      return new Response(directStatus === 200 ? jpeg : 'Access denied', { status: directStatus }); }) as typeof fetch,
    firecrawlScrape: (async (request: any, options: any) => { requests.push({ request, options }); return remote; }) as typeof firecrawlScrape,
  };
  return { admin, bucket, objects, requests, effects, payload, remote, uploads: () => uploads };
}

Deno.test('direct supplier image uses no paid fallback and retains immutable verified bytes', async () => {
  const f = fixture(200); const image = await retainImage(f.admin, url, f.effects);
  assertEquals(f.requests.length, 0); assertEquals(f.uploads(), 1);
  assertEquals(f.objects.get(image.image_storage_path), jpeg);
});

Deno.test('one exact US original-byte request recovers a regional403 and reuses identical immutable bytes', async () => {
  const f = fixture(); const image = await retainImage(f.admin, url, f.effects);
  assertEquals(f.requests, [{ request: { url, formats: ['rawBase64'], location: { country: 'US', languages: ['en-US'] }, proxy: 'basic', timeout: 30000 },
    options: { caller: 'receipt-products-stock-image', maxAttempts: 1, timeoutMs: 45000 } }]);
  assertEquals(f.objects.get(image.image_storage_path), jpeg);
  const again = await retainImage(f.admin, url, f.effects);
  assertEquals(again, image); assertEquals(f.objects.size, 1);
});

Deno.test('an unapproved host or a non403 failure cannot trigger paid acquisition', async () => {
  const f = fixture();
  await assertRejects(() => retainImage(f.admin, 'https://unapproved.example/x.jpg', f.effects), Error, 'stock_image_host_unapproved');
  for (const status of [401, 404, 429, 500]) {
    const g = fixture(status); await assertRejects(() => retainImage(g.admin, url, g.effects), Error, 'stock_image_unavailable');
    assertEquals(g.requests.length, 0); assertEquals(g.uploads(), 0);
  }
  assertEquals(f.requests.length, 0);
});

Deno.test('remote error pages, screenshots, wrong source, MIME/signature mismatch and oversized data never enter storage', async () => {
  const mutations = [
    (f: ReturnType<typeof fixture>) => { f.payload.data.metadata.statusCode = 403; },
    (f: ReturnType<typeof fixture>) => { f.payload.data.metadata.sourceURL = 'https://images-prod.oreillyauto.com/other-sku.jpg'; },
    (f: ReturnType<typeof fixture>) => { f.payload.data.metadata.url = 'https://images-prod.oreillyauto.com/other-sku.jpg'; },
    (f: ReturnType<typeof fixture>) => { f.payload.data.metadata.url = 'https://other-host.example/exact-sku.jpg'; },
    (f: ReturnType<typeof fixture>) => { delete f.payload.data.metadata.url; },
    (f: ReturnType<typeof fixture>) => { f.payload.data.metadata.contentType = 'text/html'; f.payload.data.rawBase64 = btoa('<html>Denied</html>'); },
    (f: ReturnType<typeof fixture>) => { f.payload.data.rawBase64 = btoa('<html>' + 'Denied'.repeat(50) + '</html>'); },
    (f: ReturnType<typeof fixture>) => { f.payload.data.screenshot = 'https://provider.example/render.png'; },
    (f: ReturnType<typeof fixture>) => { delete f.payload.data.rawBase64; f.payload.data.actions = { screenshots: ['https://provider.example/render.png'] }; },
    (f: ReturnType<typeof fixture>) => { f.payload.data.metadata.contentType = 'image/png'; },
    (f: ReturnType<typeof fixture>) => { f.payload.data.rawBase64 = 'A'.repeat(20_000_004); },
    (f: ReturnType<typeof fixture>) => { f.payload.data.rawBase64 = 'data:image/jpeg;base64,' + base64(jpeg); },
    (f: ReturnType<typeof fixture>) => { f.remote.ok = false; f.remote.error = 'upstream authentication failed'; },
  ];
  for (const mutate of mutations) {
    const f = fixture(); mutate(f);
    await assertRejects(() => retainImage(f.admin, url, f.effects)); assertEquals(f.uploads(), 0);
  }
});

Deno.test('remote recovery still refuses persistence errors and corrupt immutable readback', async () => {
  const f = fixture(); f.bucket.upload = () => ({ error: { statusCode: '500' } });
  await assertRejects(() => retainImage(f.admin, url, f.effects), Error, 'stock_image_persistence_failed');
  const g = fixture(); g.bucket.download = () => ({ data: new Blob([new Uint8Array(128)]) });
  await assertRejects(() => retainImage(g.admin, url, g.effects), Error, 'stock_image_readback_mismatch');
});

Deno.test('actual Firecrawl allowance refusal leaves image pending without API request or storage write', async () => {
  const f = fixture(); let calls = 0;
  f.effects.firecrawlScrape = (request, options) => firecrawlScrape(request, { ...options, apiKey: 'fixture',
    meterClient: { rpc: (name) => { calls++; assertEquals(name, 'firecrawl_allowance_for_url'); return Promise.resolve({ data: 0 }); } } });
  await assertRejects(() => retainImage(f.admin, url, f.effects), Error, 'stock_image_budget_deferred');
  assertEquals(calls, 1); assertEquals(f.uploads(), 0);
});

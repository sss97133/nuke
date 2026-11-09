// Real extractor + archiveFetch + SDK, with deterministic HTTP boundaries only.
import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
const base = 'https://fixture.supabase.test', key = 'sb_secret_cc_capture_fixture';
Deno.env.set('SUPABASE_URL', base); Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', key);
Deno.env.set('SUPABASE_SECRET_KEYS', JSON.stringify({ default: key }));
const url = 'https://collectingcars.com/for-sale/2017-porsche-911-991-2-carrera-s-2';
const html = await Deno.readTextFile(new URL('./fixtures/lot-911.html', import.meta.url));
const snapshot = '22222222-2222-4222-8222-222222222222';
const clock = new Date(Date.now() - 3_600_000).toISOString();
const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(x => x.toString(16).padStart(2, '0')).join('');
const hash = await sha(html);
let mode = 'cache', calls: any[] = [], archivePayload: any;
globalThis.fetch = async (input, init) => {
  const req = new Request(input, init), u = new URL(req.url), read = ['GET', 'HEAD'].includes(req.method);
  const body = read ? null : JSON.parse(await req.text());
  calls.push({ url: req.url, method: req.method, body });
  if (u.origin === 'https://collectingcars.com') {
    assertEquals(req.url, url, 'Publisher URL is normalized before fetch');
    return new Response(mode === 'nul' ? html + '\u0000' : html, { status: 200, headers: { 'content-type': 'text/html' } });
  }
  assertEquals(u.origin, base, 'No other network or paid-service call');
  if (u.pathname === '/rest/v1/listing_page_snapshots') {
    if (!read) {
      archivePayload = body;
      if (mode === 'failed') return Response.json({ code: '57014', message: 'synthetic retention unavailable' }, { status: 500 });
      return Response.json({ code: '23505', message: 'synthetic identical retained body' }, { status: 409 });
    }
    if (u.searchParams.get('select')?.includes('html_storage_path')) {
      assert(Date.parse(clock) >= Date.parse(u.searchParams.get('fetched_at')!.slice(4)), 'Synthetic retained hit satisfies actual cache cutoff');
      return Response.json(['cache', 'changed'].includes(mode) ? [{ id: snapshot, html, fetched_at: clock, fetch_method: 'direct' }] : []);
    }
    if (!u.searchParams.has('id')) {
      assertEquals(u.searchParams.get('listing_url'), `eq.${url}`);
      assertEquals(u.searchParams.get('html_sha256'), `eq.${hash}`);
    }
    return Response.json([{ id: snapshot, listing_url: url, platform: 'collectingcars', fetched_at: clock,
      html_sha256: mode === 'changed' ? 'b'.repeat(64) : hash, success: true }]);
  }
  throw Error(`Unexpected capture request ${req.method} ${u.pathname}`);
};
let handler: (request: Request) => Response | Promise<Response>;
(Deno as any).serve = (fn: typeof handler) => { handler = fn; return { finished: Promise.resolve() }; };
await import('./index.ts');
async function run(next: string, sourceUrl = url) {
  mode = next; calls = []; archivePayload = null;
  const response = await handler(new Request(base + '/functions/v1/extract-collecting-cars', { method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ url: sourceUrl }) }));
  return { status: response.status, body: await response.json() };
}
Deno.test('real CC extractor cache receipt retains original clock and normalizes slash without fetching source', async () => {
  const r = await run('cache', url + '/'); assertEquals(r.status, 200); assertEquals(r.body.success, true);
  assertEquals(r.body.source_capture, { snapshot_id: snapshot, sha256: hash, observed_at: clock, source_url: url });
  assertEquals(r.body.extracted.url, url);
  assertEquals(calls.some(c => c.url.startsWith('https://collectingcars.com')), false);
});
for (const scenario of ['dedup', 'nul']) Deno.test(`real CC archive ${scenario} resolves23505 retained bytes with old clock`, async () => {
  const r = await run(scenario); assertEquals(r.status, 200); assertEquals(r.body.success, true);
  assertEquals(r.body.source_capture.observed_at, clock); assertEquals(r.body.source_capture.snapshot_id, snapshot);
  assertEquals(r.body.source_capture.sha256, hash); assertEquals(archivePayload.html, html);
  assertEquals(archivePayload.html_sha256, hash); assertEquals(archivePayload.listing_url, url);
  assertEquals(calls.filter(c => c.url.startsWith('https://collectingcars.com')).length, 1);
});
for (const scenario of ['failed', 'changed']) Deno.test(`real CC capture ${scenario} refuses success`, async () => {
  const r = await run(scenario); assertEquals(r.status, 500); assertEquals(r.body.success, undefined);
  assert(typeof r.body.error === 'string'); assertEquals(r.body.source_capture, undefined);
});

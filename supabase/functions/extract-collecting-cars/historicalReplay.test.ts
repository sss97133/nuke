import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { replayClosedCollectingCars, collectingCarsReplayCandidates } from './historicalReplay.ts';
const html = await Deno.readTextFile(new URL('./fixtures/lot-911.html', import.meta.url));
const url = 'https://collectingcars.com/for-sale/2017-porsche-911-991-2-carrera-s-2';
const id = '22222222-2222-4222-8222-222222222222', clock = '2020-01-01T00:00:00.000Z';
const sha = async (body: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)))].map(x => x.toString(16).padStart(2, '0')).join('');
const hash = await sha(html), pin = { snapshot_id: id, expected_sha256: hash };
function fixture(overrides: any = {}, body = html) {
  const calls: URL[] = [], row = { id, listing_url: url, platform: 'collectingcars', success: true, http_status: 200,
    html, html_sha256: hash, fetched_at: clock, created_at: clock, metadata: {}, ...overrides };
  const db = createClient('https://fixture.invalid', 'synthetic', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async input => {
    const u = new URL(String(input)); calls.push(u); assertEquals(u.origin, 'https://fixture.invalid');
    if (u.pathname.startsWith('/storage/v1/object/')) return new Response(body);
    assertEquals(u.pathname, '/rest/v1/listing_page_snapshots');
    if (u.searchParams.has('id')) { assertEquals(u.searchParams.get('id'), `eq.${id}`); return Response.json(row); }
    assertEquals(u.searchParams.get('listing_url'), `eq.${url}`); assertEquals(u.searchParams.get('platform'), 'eq.collectingcars');
    assertEquals(u.searchParams.get('limit'), '3'); assertEquals(u.searchParams.get('http_status'), 'eq.200');
    return Response.json([{ id, html_sha256: hash, fetched_at: clock }]);
  } } });
  return { db, calls };
}
Deno.test('pinned archived unsold full HTML reuses original clock with zero publisher requests', async () => {
  const f = fixture(), r = await replayClosedCollectingCars(f.db, url + '/', pin);
  assertEquals(r.extracted.stage, 'unsold'); assertEquals(r.extracted.price_kind, 'high_bid'); assertEquals(r.extracted.currency, 'NZD');
  assertEquals(r.source_capture.observed_at, clock); assertEquals(r.source_capture.snapshot_id, id); assertEquals(f.calls.length, 1);
});
Deno.test('protected storage bytes are hash verified without rearchiving', async () => {
  const f = fixture({ html: null, html_storage_path: 'collectingcars/retained.html' });
  const r = await replayClosedCollectingCars(f.db, url, pin); assertEquals(r.source_capture.sha256, hash); assertEquals(f.calls.length, 2);
  await assertRejects(() => replayClosedCollectingCars(fixture({ html: null, html_storage_path: 'collectingcars/retained.html' }, html + 'changed').db, url, pin));
});
Deno.test('candidate lookup is exact full-page source URL and bounded, not closure proof', async () => {
  const f = fixture(); assertEquals(await collectingCarsReplayCandidates(f.db, url + '/'), [{ ...pin, fetched_at: clock }]);
});
for (const [name, change] of Object.entries({ wrongUrl: { listing_url: url + '-other' }, boardPayload: { platform: 'collecting-cars' },
  failed: { success: false }, non200: { http_status: 403 }, hash: { html_sha256: 'b'.repeat(64) },
  rowsOnly: { metadata: { rows_only: true } }, withdrawn: { metadata: { withdrawn: true } },
  future: { fetched_at: '2099-01-01' }, invalidClock: { fetched_at: 'unknown' }, archiveBeforeRead: { created_at: '2019-01-01' },
  wrongId: { id: '33333333-3333-4333-8333-333333333333' }, storageTraversal: { html: null, html_storage_path: '../other' },
  encodedStorageTraversal: { html: null, html_storage_path: '%2e%2e/other' }, oversizedStorage: { html: null, html_storage_path: 'valid.html', content_length: 3_000_000 } }))
  Deno.test(`pinned ${name} refuses without source fallback`, async () => {
    const f = fixture(change); await assertRejects(() => replayClosedCollectingCars(f.db, url, pin)); assertEquals(f.calls.length, 1);
  });
for (const stage of ['live', 'comingsoon', 'withdrawn', 'unknown']) Deno.test(`native ${stage} is not closed-auction replay evidence`, async () => {
  const changed = html.replaceAll('\\"stage\\":\\"unsold\\"', `\\"stage\\":\\"${stage}\\"`);
  assertEquals(changed === html, false); const hash2 = await sha(changed);
  await assertRejects(() => replayClosedCollectingCars(fixture({ html: changed, html_sha256: hash2 }).db, url, { ...pin, expected_sha256: hash2 }));
});

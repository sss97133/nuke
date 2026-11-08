// node --test scripts/garage/garage-scripts.test.mjs   (pure parsers and SQL builders; no network, no database)
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCards, parseMemberHtml, parseAjax, parseDetail, parseResultText, buildValuesSql, toBatListingRow, listingSlug } from './ingest-bat-seller-history.mjs';
import { buildSql, publicUrl, shapeSessions } from './scene-sessions.mjs';
import { normalizeSession, buildPrompt, parseLabel, toInference, valuesCte as sceneCte, applyBody, isHeic, labelSession, SCENE_LABELS } from './label-scenes.mjs';

const card = (slug, title, ts, result) => `<div class="listing-card listing-card-separate listing-card-h" data-listing_id="1" data-timestamp_end="${ts}">
<div class="thumbnail"><a class="image-overlay" href="https://bringatrailer.com/listing/${slug}/"></a></div>
<div class="content"><div class="content-main"><h3><a href="https://bringatrailer.com/listing/${slug}/">${title}</a></h3>
<div class="item-results">${result}</div></div></div></div>`;

test('parseResultText reads sold / no sale / price', () => {
  assert.deepEqual(parseResultText('Sold for USD $35,000 <span> on 8/4/2026 </span>'), { status: 'sold', price: 35000 });
  assert.deepEqual(parseResultText('Bid to USD $29,500 <span> on 8/4/2026 </span>'), { status: 'no_sale', price: 29500 });
  assert.equal(parseResultText('').status, null);
});

test('parseMemberHtml: user id, next page and page-1 cards', () => {
  const html = `<html>${card('2006-pontiac-solstice-92', '2006 Pontiac Solstice', 1790000000, 'Sold for USD $16,500')}
    ${card('1977-scout-8', 'Vortec &#215; Scout', 1789000000, 'Bid to USD $5,000')}
    <button data-item-type="listings_past" data-item-paged="2" data-user-id="49132">Show more</button>
    <button data-item-type="comments_other" data-item-last="5" data-user-id="49132">Show more</button></html>`;
  const m = parseMemberHtml(html);
  assert.equal(m.userId, '49132');
  assert.equal(m.nextPage, 2);
  assert.equal(m.cards.length, 2);
  assert.equal(m.cards[0].url, 'https://bringatrailer.com/listing/2006-pontiac-solstice-92/');
  assert.equal(m.cards[0].end_date, '2026-09-21');
  assert.equal(m.cards[0].result.status, 'sold');
  assert.equal(m.cards[1].title, 'Vortec × Scout');
});

test('parseAjax: itemMore / itemPaged / html output', () => {
  const j = JSON.stringify({ itemType: 'listings_past', itemMore: true, itemPaged: 3, output: card('a-1', 'A', 1700000000, 'Sold for USD $1,000') });
  const a = parseAjax(j);
  assert.equal(a.more, true);
  assert.equal(a.nextPage, 3);
  assert.equal(a.cards.length, 1);
  assert.equal(parseAjax(JSON.stringify({ itemMore: false, itemPaged: 4, output: '' })).more, false);
});

test('parseDetail: lot, chassis, seller, title, end date and result', () => {
  const html = `<html><head><title>1978 GMC K1500 for sale on BaT Auctions - closed on August 4, 2026 (Lot #255,909) | Bring a Trailer</title></head>
  <body><h1 class="post-title">1978 GMC K1500 Sierra Classic 4&#215;4</h1>
  <div class="listing-available-info"><span class="info-value">Bid to <strong>USD $29,500</strong> <span class="date date-localize" data-timestamp="1785869460" data-format="L">on 8/4/26</span></span></div>
  <div class="item item-seller"><strong>Seller</strong>: <a href="https://bringatrailer.com/member/vivalasvegasautos/" target="_blank">VivaLasVegasAutos</a></div>
  <div class="item"><strong>Chassis</strong>: <a href="/x">TKL148F714125</a></div></body></html>`;
  const d = parseDetail(html);
  assert.equal(d.lot_number, '255909');
  assert.equal(d.vin, 'TKL148F714125');
  assert.equal(d.seller_username, 'vivalasvegasautos');
  assert.equal(d.end_date, '2026-08-04');
  assert.deepEqual(d.result, { status: 'no_sale', price: 29500 });
  assert.match(d.title, /^1978 GMC K1500/);
});

test('listingSlug', () => assert.equal(listingSlug('https://bringatrailer.com/listing/1978-gmc-k1500-8/'), '1978-gmc-k1500-8'));

test('buildValuesSql: escaped read-only VALUES CTE, matcher, no writes', () => {
  const sql = buildValuesSql([
    { url: "https://bringatrailer.com/listing/o'brien-1/", lot_number: '1', vin: 'ABC123456789', seller_username: 's', title: "O'Brien 1990 Car", end_date: '2026-01-02' },
    { url: 'https://bringatrailer.com/listing/b-2/', lot_number: null, vin: null, seller_username: null, title: null, end_date: null },
  ]);
  assert.match(sql, /hist_listings\(url, lot, vin, seller, title, end_date\) AS \(/);
  assert.match(sql, /'https:\/\/bringatrailer.com\/listing\/o''brien-1\/'::text/);
  assert.match(sql, /DATE '2026-01-02'/);
  assert.match(sql, /NULL::date\)/);
  assert.match(sql, /'exact_vin'/);
  assert.match(sql, /'seller_year_model_window'::text AS match_basis, 'low'::text AS confidence/);
  assert.match(sql, /normalize_vehicle_model_family/);
  assert.doesNotMatch(sql, /\b(insert|update|delete|drop|alter|truncate)\b\s/i);
});

test('buildValuesSql with no rows still parses as one NULL row', () => {
  assert.match(buildValuesSql([]), /VALUES\n  \(NULL::text, NULL::text/);
});

test('toBatListingRow: additive columns, run id in raw_data, sold vs bid', () => {
  const r = toBatListingRow({ handle: 'h', url: 'u', title: 't', lot_number: '9', vin: 'V', end_date: '2026-01-02', seller_username: 'h',
    result: { status: 'sold', price: 5000 } }, 'run-1');
  assert.equal(r.listing_status, 'sold');
  assert.equal(r.sale_price, 5000);
  assert.equal(r.raw_data.run_id, 'run-1');
  assert.equal(r.raw_data.vin, 'V');
  const n = toBatListingRow({ handle: 'h', url: 'u', end_date: '2026-01-02', result: { status: 'no_sale', price: 100 } }, 'run-1');
  assert.equal(n.sale_price, null);
  assert.equal(n.listing_status, 'no_sale');
});

test('scene-sessions: SQL needs a uuid, is one read-only SELECT, URLs come from image_url or storage path', () => {
  assert.throws(() => buildSql("x'; drop table vehicles; --"));
  const sql = buildSql('0B9F107A-D124-49DE-9DED-94698F63C1C4');
  assert.match(sql, /'0b9f107a-d124-49de-9ded-94698f63c1c4'::uuid/);
  assert.doesNotMatch(sql, /\b(insert|update|delete|drop|alter)\b\s/i);
  assert.match(sql, /HAVING count\(DISTINCT n\.nn\) >= 1/); // one OR MORE organizations in range, not only ties
  assert.doesNotMatch(sql, />= 2/);
  assert.match(sql, /'image_ids', x\.image_ids/);
  assert.equal(publicUrl({ image_url: 'https://cdn.example/a.jpg', storage_path: 'x' }), 'https://cdn.example/a.jpg');
  assert.equal(publicUrl({ image_url: 'p', storage_path: 'u/a b.jpg' }, 'https://s.example'), 'https://s.example/storage/v1/object/public/vehicle-photos/u/a%20b.jpg');
  assert.equal(publicUrl({ image_url: null, storage_path: null }), null);
  const s = shapeSessions([{ vehicle_id: 'v', session_key: 'k', samples: [1, 2, 3, 4, 5].map((i) => ({ image_id: `i${i}`, image_url: `https://x/${i}.jpg` })) }]);
  assert.equal(s[0].sample_urls.length, 4);
  assert.deepEqual(s[0].image_ids, ['i1', 'i2', 'i3', 'i4', 'i5']);
});

import { dhashFromGray9x8, hamming, matchAll, valuesCte, candidatesSql, unknownPhotosSql } from './dhash-match.mjs';

test('dhash-match: dhash, hamming, nearest match and VALUES CTE', () => {
  const rising = Uint8Array.from({ length: 72 }, (_, i) => (i % 9) * 10);   // left < right everywhere: all bits 0
  const falling = Uint8Array.from({ length: 72 }, (_, i) => 100 - (i % 9) * 10); // left > right: all bits 1
  assert.equal(dhashFromGray9x8(rising), '0000000000000000');
  assert.equal(dhashFromGray9x8(falling), 'ffffffffffffffff');
  assert.equal(hamming('f0f0f0f0f0f0f0f0', 'f0f0f0f0f0f0f0ef'), 5);
  const m = matchAll([{ image_id: 'a', dhash: 'f0f0f0f0f0f0f0f0' }],
    () => [{ id: 'c2', source: 'bat', dhash: 'f0f0f0f0f0f0f0ef' }, { id: 'c1', source: 'mecum', dhash: 'f0f0f0f0f0f0f08f' }, { id: 'a', source: 'x', dhash: 'f0f0f0f0f0f0f0f0' }], 6);
  assert.deepEqual(m, [{ image_id: 'a', matched_image_id: 'c2', matched_source: 'bat', hamming_distance: 5 }]);
  assert.equal(matchAll([{ image_id: 'a', dhash: '0000000000000000' }], () => [{ id: 'c', source: 'bat', dhash: 'ffffffffffffffff' }]).length, 0);
  assert.match(valuesCte([]), /WHERE false -- \(dhash_matches\)/);
  assert.match(valuesCte(m), /\('a'::uuid, 'c2'::uuid, 'bat', 5\)/);
  assert.throws(() => unknownPhotosSql('nope'));
  assert.match(candidatesSql({ year: 1985, make: "o'x", family: null }), /BETWEEN 1984 AND 1986[\s\S]*IS NOT DISTINCT FROM NULL/);
});

const V = '0b9f107a-d124-49de-9ded-94698f63c1c4';
const I = '11111111-1111-4111-8111-111111111111';

test('label-scenes: sessions from scene-sessions (sample_urls) or the older shape; at most four samples', () => {
  const n = normalizeSession({ vehicle_id: V.toUpperCase(), session_key: 'k', image_ids: [I, 'nope'], sample_urls: ['a', 'b', 'c', 'd', 'e'] });
  assert.equal(n.vehicle_id, V);
  assert.deepEqual(n.image_ids, [I]);
  assert.equal(n.sample_urls.length, 4);
  assert.deepEqual(normalizeSession({ vehicle_id: V, session_key: 'k', sample_image_urls: ['a'], sample_image_ids: [I] }).sample_urls, ['a']);
  assert.throws(() => normalizeSession({ vehicle_id: 'x', session_key: 'k' }));
  assert.throws(() => normalizeSession({ vehicle_id: V }));
});

test('label-scenes: prompt names the files and every allowed label; no vehicle or organization input', () => {
  const p = buildPrompt(['/c/a.jpg', '/c/b.jpg']);
  assert.match(p, /- \/c\/a\.jpg\n- \/c\/b\.jpg/);
  for (const l of SCENE_LABELS) assert.ok(p.includes(l), l);
  assert.match(p, /Read tool/);
  assert.doesNotMatch(p, new RegExp(V));
});

test('label-scenes: parseLabel validates strict JSON (fenced or with stray text), label, confidence and rationale', () => {
  assert.deepEqual(parseLabel('{"scene_label":"showroom","confidence":0.8,"rationale":"polished floor"}'),
    { scene_label: 'showroom', confidence: 0.8, rationale: 'polished floor' });
  assert.equal(parseLabel('```json\n{"scene_label":"dealer_lot","confidence":"0.7","rationale":"rows of cars"}\n```').confidence, 0.7);
  assert.throws(() => parseLabel('no json here'), /no JSON/);
  assert.throws(() => parseLabel('{"scene_label":"kitchen","confidence":0.5,"rationale":"x"}'), /scene_label/);
  assert.throws(() => parseLabel('{"scene_label":"other","confidence":1.5,"rationale":"x"}'), /confidence/);
  assert.throws(() => parseLabel('{"scene_label":"other","confidence":0.5}'), /rationale/);
  assert.throws(() => parseLabel('{"scene_label":"other","confidence":null,"rationale":"x"}'), /confidence/);
});

test('label-scenes: inference carries run, model, producer and the session; CTE and apply body match the table columns', () => {
  const s = normalizeSession({ vehicle_id: V, session_key: 'k', image_ids: [I], sample_urls: ['u'] });
  const inf = toInference(s, { scene_label: 'paint_body', confidence: 0.9, rationale: "o'brien's masking" }, { runId: I, model: 'claude-cli:default', createdAt: '2026-11-07T00:00:00.000Z' });
  assert.deepEqual(Object.keys(inf), ['run_id', 'vehicle_id', 'session_key', 'image_ids', 'scene_label', 'model', 'confidence', 'rationale', 'producer', 'created_at']);
  assert.equal(inf.producer, 'scripts/garage/label-scenes.mjs');
  const cte = sceneCte([inf]);
  assert.match(cte, /^scene_labels AS \(/);
  assert.match(cte, /ARRAY\['11111111-1111-4111-8111-111111111111'::uuid\]/);
  assert.match(cte, /'o''brien''s masking'\)/);
  assert.match(cte, /WHERE true -- \(scene_labels\)/);
  assert.match(sceneCte([]), /WHERE false -- \(scene_labels\)/);
  assert.doesNotMatch(cte, /\b(insert|update|delete|drop)\b\s/i);
  assert.deepEqual(Object.keys(applyBody([inf])[0]), ['run_id', 'vehicle_id', 'session_key', 'image_ids', 'scene_label', 'model', 'confidence', 'rationale']);
});

test('label-scenes: HEIC is recognised by its ftyp brand', () => {
  assert.ok(isHeic(Buffer.from('\0\0\0\x18ftypheic\0\0\0\0mif1heic')));
  assert.ok(!isHeic(Buffer.from('\xff\xd8\xff\xe0\0\x10JFIF\0\x01\x01\x01\0')));
});

test('label-scenes: one retry on invalid output, then a cited failure; a good reply is returned as parsed', async () => {
  const sess = normalizeSession({ vehicle_id: V, session_key: 'k', image_ids: [I], sample_urls: ['https://x/1.jpg', 'https://x/2.jpg'] });
  const fetchFn = async (u) => `/cache/${u.split('/').pop()}`;
  let calls = 0;
  const seen = [];
  const flaky = async ({ files }) => { seen.push(files); calls++; return calls === 1 ? 'sorry, I cannot' : '{"scene_label":"outdoor_street","confidence":0.55,"rationale":"curb and trees"}'; };
  const ok = await labelSession(sess, { backend: flaky, cacheDir: '/cache', fetchFn });
  assert.equal(calls, 2);
  assert.deepEqual(seen[0], ['/cache/1.jpg', '/cache/2.jpg']);
  assert.equal(ok.scene_label, 'outdoor_street');
  calls = 0;
  await assert.rejects(labelSession(sess, { backend: async () => { calls++; return 'nope'; }, cacheDir: '/cache', fetchFn }), /after retry/);
  assert.equal(calls, 2);
  await assert.rejects(labelSession({ ...sess, sample_urls: [] }, { backend: flaky, cacheDir: '/cache', fetchFn }), /no sample urls/);
});

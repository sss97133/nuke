// node --test scripts/garage/garage-scripts.test.mjs   (pure parsers and SQL builders; no network, no database)
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCards, parseMemberHtml, parseAjax, parseDetail, parseResultText, buildValuesSql, toBatListingRow, listingSlug } from './ingest-bat-seller-history.mjs';
import { buildSql, publicUrl, shapeSessions } from './scene-sessions.mjs';
import { orgKind, normName, distinctOrgs, representatives, parseGallery, pickWide, sceneExemplars, mergeExemplars, buildExemplarRows, vinMatchedExemplars, mergeBySources, isExcluded, vinOwners, signExemplars } from './build-place-exemplars.mjs';
import { namePhrases, organizationsNamed, mineSigns, valuesCte as signCte } from './mine-sign-evidence.mjs';
import { readFileSync as readSql } from 'node:fs';
import { shuffle, candidatesFor, buildPrompt as placePrompt, parseMatch, toRow as placeRow, needsSecondViewer, valuesCte as placeCte, matchSession } from './match-places.mjs';
import { sessionVerdicts, classifyVehicle, selectSessions } from './select-sessions.mjs';
import { buildPromptV2, shuffle as sceneShuffle } from './label-scenes.mjs';
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
  const s = normalizeSession({ vehicle_id: V, session_key: 'k', image_ids: [I], sample_urls: ['u'], photos: 14 });
  assert.equal(s.photo_count, 14);
  assert.equal(normalizeSession({ vehicle_id: V, session_key: 'k' }).photo_count, null);
  const inf = toInference(s, { scene_label: 'paint_body', confidence: 0.9, rationale: "o'brien's masking" }, { runId: I, model: 'claude-cli:default', createdAt: '2026-11-07T00:00:00.000Z' });
  assert.deepEqual(Object.keys(inf), ['run_id', 'vehicle_id', 'session_key', 'image_ids', 'scene_label', 'model', 'confidence', 'rationale', 'photo_count', 'producer', 'created_at']);
  assert.equal(inf.producer, 'scripts/garage/label-scenes.mjs');
  const cte = sceneCte([inf]);
  assert.match(cte, /^scene_labels AS \(/);
  assert.match(cte, /ARRAY\['11111111-1111-4111-8111-111111111111'::uuid\]/);
  assert.match(cte, /'o''brien''s masking', 14::int\)/);
  assert.match(cte, /WHERE true -- \(scene_labels\)/);
  assert.match(sceneCte([]), /WHERE false -- \(scene_labels\)/);
  assert.match(sceneCte([{ ...inf, photo_count: null }]), /NULL::int\)/);
  assert.ok(readText(new URL('../../supabase/sql/derive_vehicle_relationships_preview.sql', import.meta.url), 'utf8').includes(sceneCte([])), 'empty scene CTE equals the preview placeholder');
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

import { readFileSync as readText } from 'node:fs';
import { buildPairsSql, normalizePair, pairKey, buildPrompt as dupPrompt, parseJudgment, toJudgment, valuesCte as dupCte, judgePair, combineViewers, spreadPick, listingUrls } from './compare-duplicates.mjs';

const W = '22222222-2222-4222-8222-222222222222';

test('compare-duplicates: pair rows, at most four photos per side, same-vehicle pair refused', () => {
  const p = normalizePair({ a_id: V.toUpperCase(), b_id: W, a_samples: ['1', '2', '3', '4', '5'], b_samples: ['x'], fields: { a: { color: 'red' } } });
  assert.equal(p.a_id, V);
  assert.equal(p.a_samples.length, 4);
  assert.deepEqual(p.fields, { a: { color: 'red' } });
  assert.equal(pairKey(V, W), pairKey(W, V));
  assert.throws(() => normalizePair({ a_id: V, b_id: V }));
  assert.throws(() => normalizePair({ a_id: 'x', b_id: W }));
});

test('compare-duplicates: pairs SQL is one read-only SELECT with the dup scoring, the review band and photos on both sides', () => {
  const sql = buildPairsSql(V);
  assert.match(sql, /normalize_vehicle_model_family\(v\.model\)/);
  assert.match(sql, /abs\(b\.year - a\.year\) <= 1/);
  assert.match(sql, /s\.score >= 0\.6 - 1e-9 AND s\.score < 0\.7 - 1e-9/);
  assert.match(sql, /cardinality\(a\.samples\) > 0 AND cardinality\(b\.samples\) > 0/);
  assert.match(sql, new RegExp(`user_id = '${V}'`));
  assert.doesNotMatch(sql, /\b(insert|update|delete|drop|alter|create|truncate)\b\s/i);
  assert.throws(() => buildPairsSql("x'; drop table vehicles; --"), /uuid/);
  assert.match(buildPairsSql(V, { reviewMin: 0.55, dupMin: 0.8 }), /s\.score >= 0\.55 - 1e-9 AND s\.score < 0\.8 - 1e-9/);
});

test('compare-duplicates: the viewer sees photos only (no record fields) and is asked for strict JSON', () => {
  const p = dupPrompt(['/c/a1.jpg'], ['/c/b1.jpg', '/c/b2.jpg']);
  assert.match(p, /vehicle A:\n- \/c\/a1\.jpg/);
  assert.match(p, /vehicle B:\n- \/c\/b1\.jpg\n- \/c\/b2\.jpg/);
  assert.match(p, /same_vehicle/);
  assert.match(p, /Read tool/);
  assert.doesNotMatch(p, /\b(VIN|year|model)\s*[:=]/i);
});

test('compare-duplicates: parseJudgment validates true / false / "unsure", confidence, rationale and contradictions', () => {
  assert.deepEqual(parseJudgment('{"same_vehicle":true,"confidence":0.9,"rationale":"same dent","contradictions":[]}'),
    { same_vehicle: true, confidence: 0.9, rationale: 'same dent', contradictions: [] });
  assert.equal(parseJudgment('```json\n{"same_vehicle":"unsure","confidence":"0.3","rationale":"no detail"}\n```').same_vehicle, 'unsure');
  assert.equal(parseJudgment('{"same_vehicle":"False","confidence":0.8,"rationale":"x","contradictions":["bed length"]}').contradictions[0], 'bed length');
  assert.throws(() => parseJudgment('{"same_vehicle":"maybe","confidence":0.5,"rationale":"x"}'), /same_vehicle/);
  assert.throws(() => parseJudgment('{"same_vehicle":true,"confidence":2,"rationale":"x"}'), /confidence/);
  assert.throws(() => parseJudgment('{"same_vehicle":true,"confidence":0.5}'), /rationale/);
  assert.throws(() => parseJudgment('{"same_vehicle":true,"confidence":0.5,"rationale":"x","contradictions":"red"}'), /contradictions/);
  assert.throws(() => parseJudgment('nothing'), /no JSON/);
});

test('compare-duplicates: judgment row and visual_dup_judgments CTE match the preview placeholder columns', () => {
  const pair = normalizePair({ a_id: V, b_id: W, a_samples: ['a'], b_samples: ['b'], fields: { a: { vin: 'X' } } });
  const row = toJudgment(pair, { same_vehicle: false, confidence: 0.85, rationale: "o'neil's truck", contradictions: ['bed length', 'wheels'] },
    { runId: I, model: 'claude-cli:default', createdAt: '2026-11-08T00:00:00.000Z' });
  assert.equal(row.verdict, 'false');
  assert.equal(row.producer, 'scripts/garage/compare-duplicates.mjs');
  const cte = dupCte([row, toJudgment(pair, { same_vehicle: true, confidence: 0.9, rationale: 'same dent', contradictions: [] }, { runId: I, model: 'm' })]);
  assert.match(cte, /^visual_dup_judgments AS \(\n  SELECT t\.a_id, t\.b_id, t\.verdict, t\.confidence, t\.model, t\.rationale, t\.run_id/);
  assert.match(cte, /'false', 0\.85::numeric, 'claude-cli:default', 'o''neil''s truck Contradictions: bed length; wheels', '11111111-1111-4111-8111-111111111111'::uuid\)/);
  assert.match(cte, /'true', 0\.9::numeric/);
  assert.match(cte, /WHERE true -- \(visual_dup_judgments\)/);
  assert.match(dupCte([]), /WHERE false -- \(visual_dup_judgments\)/);
  assert.doesNotMatch(cte, /\b(insert|update|delete|drop)\b\s/i);
});

test('compare-duplicates: both sides downloaded, one retry on invalid output, a side without photos is not guessed', async () => {
  const pair = normalizePair({ a_id: V, b_id: W, a_samples: ['https://x/a1.jpg', 'https://x/a2.jpg'], b_samples: ['https://x/b1.jpg'] });
  const fetchFn = async (u) => `/cache/${u.split('/').pop()}`;
  let calls = 0; let prompt;
  const flaky = async (o) => { calls++; prompt = o.prompt; return calls === 1 ? 'hmm' : '{"same_vehicle":true,"confidence":0.8,"rationale":"same wheels"}'; };
  const j = await judgePair(pair, { backend: flaky, cacheDir: '/cache', fetchFn });
  assert.equal(calls, 2);
  assert.equal(j.same_vehicle, true);
  assert.match(prompt, /- \/cache\/a1\.jpg\n- \/cache\/a2\.jpg/);
  assert.match(prompt, /- \/cache\/b1\.jpg/);
  await assert.rejects(judgePair({ ...pair, b_samples: [] }, { backend: flaky, cacheDir: '/cache', fetchFn }), /no photo/);
  calls = 0;
  await assert.rejects(judgePair(pair, { backend: async () => { calls++; return 'nope'; }, cacheDir: '/cache', fetchFn }), /after retry/);
  assert.equal(calls, 2);
});

test('compare-duplicates: the empty CTE is byte-identical to the placeholder in the preview (so a filled CTE replaces it cleanly)', () => {
  const preview = readText(new URL('../../supabase/sql/derive_vehicle_relationships_preview.sql', import.meta.url), 'utf8');
  assert.ok(preview.includes(dupCte([])), 'placeholder block differs from valuesCte([])');
});

// ---- place exemplars and place matching ----------------------------------------------------------------------------------------
const O1 = 'a0a0a0a0-0000-4000-8000-000000000001'; const O2 = 'a0a0a0a0-0000-4000-8000-000000000002'; const V1 = '00000000-0000-4000-8000-000000000001';

test('build-place-exemplars: organization kind mirrors the preview; same normalized name is one place', () => {
  assert.equal(orgKind('dealer'), 'dealer'); assert.equal(orgKind('restoration_shop'), 'shop'); assert.equal(orgKind('dealer restoration'), null); assert.equal(orgKind(null), null);
  assert.equal(normName("Gz Custom Classic, LLC"), 'gz classic');
  const orgs = [{ id: O2, name: 'Gz Classic LLC' }, { id: O1, name: 'GZ Classic' }];
  assert.equal(distinctOrgs(orgs).length, 1);
  assert.equal(representatives([{ organizations: orgs }]).get('gz classic'), O1);
  assert.equal(distinctOrgs(orgs, representatives([{ organizations: orgs }]))[0].id, O1);
});

test('build-place-exemplars: BaT gallery parse and wide-shot pick (front of the gallery, landscape, spread)', () => {
  const items = [{ large: { url: 'https://x/1.jpg', width: 1500, height: 1000 } }, { large: { url: 'https://x/2.jpg', width: 1000, height: 1500 } },
    { large: { url: 'https://x/3.jpg', width: 1500, height: 1000 } }, { large: { url: 'https://x/4.jpg', width: 1500, height: 1000 } }, { dimensions: '800x500', large: { url: 'https://x/5.jpg', width: 800, height: 500 } }];
  const html = `<div data-gallery-items="${JSON.stringify(items).replace(/"/g, '&quot;').replace(/\//g, '\\/')}"></div>`;
  const g = parseGallery(html);
  assert.equal(g.length, 5); assert.equal(g[0].url, 'https://x/1.jpg');
  const w = pickWide(g, 2);
  assert.deepEqual(w.map((x) => x.url), ['https://x/1.jpg', 'https://x/4.jpg']);
  assert.deepEqual(parseGallery('<p>none</p>'), []);
});

test('build-place-exemplars: scene exemplars need confidence >= 0.85, an informative label, and exactly one place (or one shop for a shop label)', () => {
  const s = (k, orgs, extra = {}) => ({ vehicle_id: V1, session_key: k, organizations: orgs, sample_urls: [`https://p/${k}.jpg`], ...extra });
  const sessions = [s('a', [{ id: O1, name: 'One', business_type: 'dealer' }]), s('b', [{ id: O1, name: 'One', business_type: 'dealer' }, { id: O2, name: 'Two', business_type: 'restoration_shop' }]),
    s('c', [{ id: O1, name: 'One', business_type: 'dealer' }, { id: O2, name: 'Two', business_type: 'restoration_shop' }]), s('d', [{ id: O1, name: 'One', business_type: 'dealer' }])];
  const L = (k, label, confidence) => ({ vehicle_id: V1, session_key: k, scene_label: label, confidence });
  const m = sceneExemplars(sessions, [L('a', 'dealer_lot', 0.9), L('b', 'shop_interior', 0.9), L('c', 'dealer_lot', 0.95), L('d', 'dealer_lot', 0.8)]);
  assert.deepEqual([...m.keys()].sort(), [O1, O2]);
  assert.equal(m.get(O1).length, 1); assert.equal(m.get(O1)[0].source, 'scene_session'); assert.equal(m.get(O1)[0].cite.session_key, 'a');
  assert.equal(m.get(O2)[0].cite.session_key, 'b'); // a shop label with exactly one shop-kind place; session c (dealer label, two places) and d (0.8) give nothing
  assert.equal(sceneExemplars(sessions, [L('a', 'outdoor_street', 0.99)]).size, 0);
});

test('build-place-exemplars: exemplars interleave BaT and scene photos, max per organization, empty organizations dropped', () => {
  const b = [1, 2, 3, 4].map((i) => ({ url: `b${i}`, source: 'bat_listing' })); const sc = [1, 2, 3].map((i) => ({ url: `s${i}`, source: 'scene_session' }));
  assert.deepEqual(mergeExemplars(b, sc, 6).map((e) => e.url), ['b1', 's1', 'b2', 's2', 'b3', 's3']);
  const rows = buildExemplarRows([{ id: O1, name: 'One', business_type: 'dealer' }, { id: O2, name: 'Two' }], new Map([[O1, b]]), new Map(), 6);
  assert.equal(rows.length, 1); assert.equal(rows[0].org_kind, 'dealer'); assert.equal(rows[0].exemplars.length, 4);
});

test('build-place-exemplars: vin_matched_session uses only dealer_lot/showroom sessions of VIN-matched vehicles (2 per vehicle, exclusions, no cross-org)', () => {
  const VA = 'aaaaaaaa-0000-4000-8000-000000000001'; const VB = 'bbbbbbbb-0000-4000-8000-000000000002'; const VC = 'cccccccc-0000-4000-8000-000000000003';
  const org = { id: O1, name: 'One', business_type: 'dealer' };
  const ses = (v, k, orgs) => ({ vehicle_id: v, session_key: k, organizations: orgs, sample_urls: [`https://p/${v.slice(0, 2)}${k}.jpg`] });
  const sessions = [ses(VA, '1', [org]), ses(VA, '2', [org]), ses(VA, '3', [org]), ses(VA, '4', [org]), ses(VB, '1', []), ses(VB, '2', []), ses(VB, '3', []), ses(VC, '1', [org])];
  const L = (v, k, scene_label) => ({ vehicle_id: v, session_key: k, scene_label });
  const labels = [L(VA, '1', 'dealer_lot'), L(VA, '2', 'showroom'), L(VA, '3', 'dealer_lot'), L(VA, '4', 'outdoor_street'), L(VB, '1', 'shop_interior'), L(VB, '2', 'outdoor_street'), L(VB, '3', 'showroom'), L(VC, '1', 'dealer_lot')];
  const listings = new Map([[O1, [{ url: 'https://bat/a', vin: 'vin-aaaaaaaaa1' }, { url: 'https://bat/b', vin: 'VINBBBBBBBBB2' }, { url: 'https://bat/c', vin: 'VINCCCCCCCCC3' }]]]);
  const garage = [{ id: VA, vin: 'vinaaaaaaaaa1' }, { id: VB, vin: 'VINBBBBBBBBB2' }, { id: VC, vin: 'VINCCCCCCCCC3' }, { id: 'dd', vin: 'NOMATCH00000' }];
  const m = vinMatchedExemplars([{ id: O1, name: 'One' }], listings, garage, sessions, labels, { exclude: ['cccccccc'] });
  const ex = m.get(O1);
  assert.deepEqual(ex.filter((e) => e.cite.vehicle_id === VA).map((e) => e.cite.session_key), ['1', '2']); // capped at 2; outdoor never
  assert.deepEqual(ex.filter((e) => e.cite.vehicle_id === VB).map((e) => e.cite.session_key), ['3']); // only the showroom session, not shop/outdoor
  assert.ok(!ex.some((e) => e.cite.vehicle_id === VC)); // excluded by prefix
  assert.deepEqual(ex[0].cite, { vehicle_id: VA, session_key: '1', vin: 'VINAAAAAAAAA1', listing_url: 'https://bat/a', source: 'vin_matched_session' });
  assert.equal(ex[0].source, 'vin_matched_session');
  // no dealer/showroom label -> nothing, even for an in-range session
  assert.equal(vinMatchedExemplars([{ id: O1, name: 'One' }], listings, garage, sessions, [L(VA, '1', 'outdoor_street')]).size, 0);
  assert.equal(vinMatchedExemplars([{ id: O1, name: 'One' }], listings, [], sessions, labels).size, 0);
  assert.ok(isExcluded('abc123', ['ABC']) && !isExcluded('abc123', ['x']) && !isExcluded('abc', ['']));
  const sc = sceneExemplars([ses(VA, '1', [org])], [{ vehicle_id: VA, session_key: '1', scene_label: 'dealer_lot', confidence: 0.9 }], { exclude: [VA] });
  assert.equal(sc.size, 0);
  // cross-org: VA is matched to One, so Two gets neither a vin nor a scene exemplar from it
  const O3 = 'dddddddd-0000-4000-8000-0000000000d3';
  const two = { id: O3, name: 'Two' };
  const lm = new Map([[O1, [{ url: 'https://bat/a', vin: 'VINAAAAAAAAA1' }]], [O3, [{ url: 'https://bat/y', vin: 'VINBBBBBBBBB2' }]]]);
  const owners = vinOwners([{ id: O1, name: 'One' }, two], new Map([[O1, lm.get(O1)]]), garage);
  assert.deepEqual([...owners.get(VA)], ['one']);
  const both = vinMatchedExemplars([{ id: O1, name: 'One' }, two], new Map([[O1, lm.get(O1)], [O3, [{ url: 'https://bat/y', vin: 'VINBBBBBBBBB2' }]]]), garage, sessions, labels);
  assert.ok(both.get(O1).every((e) => e.cite.vehicle_id === VA)); assert.deepEqual(both.get(O3).map((e) => e.cite.vehicle_id), [VB]); // each place gets only its own vehicle
  const ses2 = sceneExemplars([ses(VA, '1', [two])], [{ vehicle_id: VA, session_key: '1', scene_label: 'dealer_lot', confidence: 0.9 }], { owners });
  assert.equal(ses2.size, 0);
  assert.equal(sceneExemplars([ses(VA, '1', [org])], [{ vehicle_id: VA, session_key: '1', scene_label: 'dealer_lot', confidence: 0.9 }], { owners }).size, 1);
});

test('build-place-exemplars: fewer than min vin exemplars -> bat_listing fills the remaining slots after them', () => {
  const mk = (src, n) => Array.from({ length: n }, (_, i) => ({ url: `${src}${i}`, source: src }));
  const src = { bat: mk('bat_listing', 5), scene: mk('scene_session', 2), vin: mk('vin_matched_session', 2) };
  assert.deepEqual(mergeBySources(src, 6).map((e) => e.url), ['vin_matched_session0', 'vin_matched_session1', 'bat_listing0', 'bat_listing1', 'bat_listing2', 'bat_listing3']);
  assert.deepEqual(mergeBySources({ ...src, vin: mk('vin_matched_session', 4) }, 6).map((e) => e.url), ['vin_matched_session0', 'vin_matched_session1', 'vin_matched_session2', 'vin_matched_session3', 'bat_listing0', 'scene_session0']); // at the minimum: old fill
  assert.equal(mergeBySources(src, 6, null, 2).filter((e) => e.source === 'bat_listing').length, 2); // min 2 reached: old fill (interleaved)
  const rows = buildExemplarRows([{ id: O1, name: 'One', business_type: 'dealer' }], new Map([[O1, src.bat]]), new Map(), 6, { vinByOrg: new Map([[O1, src.vin]]), minVin: 4 });
  assert.equal(rows[0].exemplars.length, 6);
});

test('build-place-exemplars: --prefer-sources orders the fill; BaT never precedes vin_matched_session', () => {
  const mk = (src, n) => Array.from({ length: n }, (_, i) => ({ url: `${src}${i}`, source: src }));
  const src = { bat: mk('bat_listing', 3), scene: mk('scene_session', 2), vin: mk('vin_matched_session', 2) };
  assert.deepEqual(mergeBySources(src, 4, null, 2).map((e) => e.url), ['vin_matched_session0', 'vin_matched_session1', 'bat_listing0', 'scene_session0']);
  assert.deepEqual(mergeBySources(src, 4).map((e) => e.url), ['vin_matched_session0', 'vin_matched_session1', 'bat_listing0', 'bat_listing1']); // below the default minimum of 4: bat fills
  assert.deepEqual(mergeBySources(src, 5, ['vin_matched_session', 'scene_session', 'bat_listing'], 2).map((e) => e.url), ['vin_matched_session0', 'vin_matched_session1', 'scene_session0', 'scene_session1', 'bat_listing0']);
  assert.deepEqual(mergeBySources(src, 4, ['bat_listing', 'vin_matched_session'], 2).map((e) => e.url), ['vin_matched_session0', 'vin_matched_session1', 'bat_listing0', 'bat_listing1']);
  assert.deepEqual(mergeBySources({ ...src, vin: [] }, 4).map((e) => e.url), ['bat_listing0', 'scene_session0', 'bat_listing1', 'scene_session1']); // unchanged without vin exemplars
  assert.deepEqual(mergeBySources({ ...src, vin: [] }, 4, ['scene_session', 'bat_listing']).map((e) => e.url), ['scene_session0', 'scene_session1', 'bat_listing0', 'bat_listing1']);
});

test('match-places: candidates are the in-range places with exemplars; the prompt names no organization, id or vehicle', () => {
  const ex = [{ org_id: O1, org_kind: 'dealer', exemplars: [{ url: 'u1' }] }, { org_id: O2, org_kind: 'shop', exemplars: [] }];
  const c = candidatesFor({ organizations: [{ id: O1, name: 'Secret Dealer Name' }, { id: O2, name: 'Other' }] }, ex);
  assert.deepEqual(c.map((x) => x.org_id), [O1]);
  const p = placePrompt({ sampleFiles: ['/tmp/s1.jpg'], sheets: [{ letter: 'A', file: '/tmp/a.jpg' }, { letter: 'B', file: '/tmp/b.jpg' }] });
  assert.match(p, /Place A: \/tmp\/a\.jpg/); assert.match(p, /or neither/); assert.doesNotMatch(p, /Secret Dealer Name|a0a0a0a0|00000000-0000/);
});

test('match-places: parseMatch accepts a letter offered or none; rejects other letters, bad confidence, missing rationale', () => {
  const ok = parseMatch('```json\n{"place":"b","confidence":0.8,"rationale":"same gate","cues":["gate"]}\n```', ['A', 'B']);
  assert.deepEqual(ok, { place: 'B', confidence: 0.8, rationale: 'same gate', sign_text: null, cues: ['gate'] });
  assert.equal(parseMatch('{"place":"none","confidence":"0.9","rationale":"no"}', ['A']).place, null);
  assert.throws(() => parseMatch('{"place":"C","confidence":0.5,"rationale":"x"}', ['A', 'B']), /not one of/);
  assert.throws(() => parseMatch('{"place":"A","confidence":2,"rationale":"x"}', ['A']), /confidence/);
  assert.throws(() => parseMatch('{"place":"A","confidence":0.5}', ['A']), /rationale/);
});

test('match-places: row maps the letter to the organization; shuffle is deterministic; second viewer on low confidence or kind disagreement', () => {
  const s = { vehicle_id: V1, session_key: 'k', image_ids: [], photo_count: 5 };
  const r = placeRow(s, { place: 'A', confidence: 0.8, rationale: 'r', cues: [] }, { A: O1 }, { runId: V1, model: 'm', viewer: 1, candidates: [O1] });
  assert.equal(r.org_id, O1); assert.equal(r.viewer, 1);
  assert.equal(placeRow(s, { place: null, confidence: 0.8, rationale: 'r', cues: [] }, { A: O1 }, { runId: V1, model: 'm', viewer: 1, candidates: [O1] }).org_id, null);
  assert.deepEqual(shuffle([1, 2, 3, 4, 5, 6], 'x'), shuffle([1, 2, 3, 4, 5, 6], 'x'));
  const kinds = new Map([[O1, 'dealer'], [O2, 'shop']]);
  assert.deepEqual(needsSecondViewer({ confidence: 0.6, org_id: O1 }, null, kinds), { call: true, why: 'low_confidence' });
  assert.deepEqual(needsSecondViewer({ confidence: 0.9, org_id: O1 }, 'shop_interior', kinds), { call: true, why: 'scene_kind_disagrees' });
  assert.equal(needsSecondViewer({ confidence: 0.9, org_id: O1 }, 'showroom', kinds).call, false);
  assert.deepEqual(needsSecondViewer({ confidence: 0.9, org_id: O1 }, 'outdoor_street', kinds), { call: true, why: 'sole_decider' });
  assert.equal(needsSecondViewer({ confidence: 0.9, org_id: null }, 'outdoor_street', kinds).call, false);
});

test('match-places: the empty CTE is byte-identical to the preview placeholder; a filled CTE has the placeholder columns', async () => {
  const { readFileSync } = await import('node:fs');
  const pre = readFileSync(new URL('../../supabase/sql/derive_vehicle_relationships_preview.sql', import.meta.url), 'utf8');
  assert.ok(pre.includes(placeCte([])), 'empty CTE matches the placeholder');
  const c = placeCte([{ run_id: V1, vehicle_id: V1, session_key: "k'1", image_ids: [O1], photo_count: 4, org_id: O1, confidence: 0.9, model: 'm', viewer: 2, rationale: 'r', cues: ['a'] }]);
  assert.match(c, /WHERE true -- \(place_matches\)/); assert.match(c, /'k''1'/); assert.match(c, /, 2::int, 'r Cues: a'\)/);
});

test('match-places: viewer 2 uses a different sample selection when the session has one, a shuffled place order, and retries once', async () => {
  const calls = [];
  const backend = async ({ prompt }) => { calls.push(prompt); return calls.length === 1 ? 'garbage' : '{"place":"A","confidence":0.8,"rationale":"gate"}'; };
  const s = { vehicle_id: V1, session_key: 'k', sample_urls: ['p1', 'p2'], alt_sample_urls: ['a1', 'a2'] };
  const cands = [{ org_id: O1, exemplars: [{ url: 'e1' }, { url: 'e2' }] }, { org_id: O2, exemplars: [{ url: 'e3' }] }];
  const fetched = [];
  const r = await matchSession(s, cands, { backend, cacheDir: '/x', viewer: 2, fetchFn: async (u) => { fetched.push(u); return `/f/${u}`; }, sheetFn: (files, letter) => `/sheet-${letter}-${files.length}` });
  assert.equal(calls.length, 2); assert.ok(fetched.includes('a1') && fetched.includes('a2') && !fetched.includes('p1'));
  assert.ok(['A', 'B'].includes(Object.keys(r.letterToOrg)[0])); assert.equal(r.match.place, 'A');
});

test('second viewer (label-scenes): fresh prompt with shuffled labels, alternative samples, CTE under its own name, scene-sessions emits alternatives', async () => {
  const labels = sceneShuffle(SCENE_LABELS, 'seed');
  const p2 = buildPromptV2(['/a.jpg'], labels);
  assert.notEqual(p2, buildPrompt(['/a.jpg'])); assert.ok(SCENE_LABELS.every((l) => p2.includes(l)));
  assert.deepEqual([...labels].sort(), [...SCENE_LABELS].sort());
  const fetched = []; const prompts = [];
  const backend = async ({ prompt }) => { prompts.push(prompt); return '{"scene_label":"showroom","confidence":0.8,"rationale":"floor"}'; };
  const s = normalizeSession({ vehicle_id: V1, session_key: 'k', sample_urls: ['p1'], alt_sample_urls: ['a1', 'a2'] });
  assert.deepEqual(s.alt_sample_urls, ['a1', 'a2']);
  const l = await labelSession(s, { backend, cacheDir: '/x', viewer: 2, fetchFn: async (u) => { fetched.push(u); return `/f/${u}`; } });
  assert.equal(l.scene_label, 'showroom'); assert.ok(fetched.every((u) => u.startsWith('a'))); assert.equal(prompts.length, 1); assert.ok(prompts[0] !== undefined);
  const row = toInference(s, l, { runId: V1, model: 'm#viewer2', viewer: 2 });
  assert.equal(row.viewer, 2);
  assert.match(sceneCte([row], 'scene_labels_v2'), /^scene_labels_v2 AS \(/); assert.match(sceneCte([], 'scene_labels_v2'), /WHERE false -- \(scene_labels_v2\)/);
  const shaped = shapeSessions([{ vehicle_id: V1, session_key: 'k', samples: [{ image_id: O1, image_url: 'https://a/1.jpg', primary: true }, { image_id: O2, image_url: 'https://a/2.jpg', primary: false }] }]);
  assert.deepEqual(shaped[0].sample_urls, ['https://a/1.jpg']); assert.deepEqual(shaped[0].alt_sample_urls, ['https://a/2.jpg']);
  const { readFileSync } = await import('node:fs');
  const pre = readFileSync(new URL('../../supabase/sql/derive_vehicle_relationships_preview.sql', import.meta.url), 'utf8');
  assert.ok(pre.includes(sceneCte([], 'scene_labels_v2')));
});

test('select-sessions: low-information vehicles (no informative label, < 50% informative photos, one labelled session) get all sessions; others the cap', () => {
  const V = (n) => `00000000-0000-4000-8000-0000000000${n}`;
  const S = (v, k, photos) => ({ vehicle_id: V(v), session_key: k, photos });
  const L = (v, k, label, confidence, viewer) => ({ vehicle_id: V(v), session_key: k, scene_label: label, confidence, ...(viewer ? { viewer } : {}) });
  const sessions = [
    ...['a', 'b', 'c', 'd'].map((k) => S(11, k, 10)),             // 11: informative everywhere -> cap
    ...['a', 'b', 'c', 'd'].map((k) => S(12, k, 10)),             // 12: only street labels -> low information
    S(13, 'a', 10), S(13, 'b', 40),                               // 13: informative 10 of 50 photos -> low information
    S(14, 'a', 10), S(14, 'b', 10),                               // 14: one session labelled -> low information
    ...['a', 'b', 'c'].map((k) => S(15, k, 5)),                   // 15: no labels yet -> first pass, cap
    S(16, 'a', 10), S(16, 'b', 10)];                              // 16: viewers disagree -> not informative -> low information
  const labels = [L(11, 'a', 'dealer_lot', 0.9), L(11, 'b', 'showroom', 0.8), L(11, 'c', 'dealer_lot', 0.7),
    L(12, 'a', 'outdoor_street', 0.9), L(12, 'b', 'other', 0.9), L(13, 'a', 'shop_interior', 0.9), L(13, 'b', 'outdoor_street', 0.9),
    L(14, 'a', 'dealer_lot', 0.9), L(16, 'a', 'dealer_lot', 0.9), L(16, 'a', 'shop_interior', 0.9, 2), L(16, 'b', 'dealer_lot', 0.5)];
  const v = sessionVerdicts(labels);
  assert.equal(v.get(`${V(16)}|a`).informative, false);
  assert.equal(v.get(`${V(11)}|c`).informative, true);
  const { toLabel, report } = selectSessions(sessions, labels, { cap: 2, allForLowInfo: true });
  const r = (n) => report.find((x) => x.vehicle_id === V(n));
  assert.deepEqual(r(11).reasons, []); assert.equal(r(11).rule, 'cap_2'); assert.equal(r(11).to_label, 0); // a, b chosen and both labelled
  assert.deepEqual(r(12).reasons, ['no_informative_label']); assert.equal(r(12).rule, 'all_sessions'); assert.equal(r(12).to_label, 2); // c, d still to label
  assert.deepEqual(r(13).reasons, ['informative_weight_below_half']); assert.equal(r(14).reasons.join(), 'only_one_session_labelled');
  assert.equal(r(15).judged, false); assert.equal(r(15).rule, 'cap_2'); assert.equal(r(15).to_label, 2);
  assert.ok(r(16).low_information);
  assert.equal(toLabel.filter((s) => s.vehicle_id === V(14)).length, 1); // only b
  assert.equal(selectSessions(sessions, labels, { cap: 2 }).report.find((x) => x.vehicle_id === V(12)).rule, 'cap_2'); // without --all-for-low-info the cap holds
  assert.equal(classifyVehicle([S(20, 'a', 3), S(20, 'b', 3)], new Map(), { forced: true }).low_information, true); // --low-info-json
});

test('compare-duplicates: a year gap of one with a listed VIN is a review pair 0.05 below the band; seller-history VINs are inlined, validated', async () => {
  const { buildPairsSql } = await import('./compare-duplicates.mjs');
  const sql = buildPairsSql('00000000-0000-4000-8000-000000000001', { histVins: ['rv-vin 0000000014', 'short', "x'; drop table t;--"] });
  assert.match(sql, /abs\(b\.year - a\.year\) = 1 AND \(a\.vin_listing OR b\.vin_listing\)/);
  assert.match(sql, /s\.score >= 0\.6 - 0\.05 - 1e-9 AND s\.score < 0\.6 - 1e-9/);
  assert.match(sql, /bat_listings bl/); assert.match(sql, /ARRAY\['RVVIN0000000014', 'XDROPTABLET'\]/); assert.doesNotMatch(sql, /drop table|;\s*drop/i); // 'short' is dropped; punctuation is stripped, never quoted through
  assert.match(sql, /'vin_matches_listing'/);
  assert.doesNotMatch(buildPairsSql('00000000-0000-4000-8000-000000000001'), /unnest\(ARRAY/);
  assert.doesNotMatch(sql, /\b(insert|update|delete|drop|alter)\b\s/i);
});

test('compare-duplicates deep: combineViewers is true only when both say true, false on a confident false, else unsure', () => {
  const v = (same_vehicle, confidence) => ({ same_vehicle, confidence, rationale: 'r', contradictions: [] });
  assert.deepEqual(pick(combineViewers([v(true, 0.9), v(true, 0.8)])), { same_vehicle: true, confidence: 0.8 });
  assert.deepEqual(pick(combineViewers([v(true, 0.9), v('unsure', 0.6)])), { same_vehicle: 'unsure', confidence: 0.6 });
  assert.deepEqual(pick(combineViewers([v(true, 0.95), v(false, 0.7)])), { same_vehicle: false, confidence: 0.7 });
  assert.deepEqual(pick(combineViewers([v(true, 0.95), v(false, 0.69)])), { same_vehicle: 'unsure', confidence: 0.69 });
  assert.deepEqual(pick(combineViewers([v(false, 0.9), v(false, 0.75)])), { same_vehicle: false, confidence: 0.75 });
  assert.deepEqual(pick(combineViewers([v(false, 0.5), v(false, 0.6)])), { same_vehicle: 'unsure', confidence: 0.5 });
  assert.throws(() => combineViewers([]));
  const c = combineViewers([{ ...v(false, 0.8), contradictions: ['wheels'] }, { ...v(true, 0.9), contradictions: ['wheels', 'paint'] }]);
  assert.deepEqual(c.contradictions, ['wheels', 'paint']);
  assert.match(c.rationale, /Viewer 1 \(false, 0.8\)/);
});
const pick = (c) => ({ same_vehicle: c.same_vehicle, confidence: c.confidence });

test('compare-duplicates deep: photos spread across sessions; listing url by pair field or history VIN', () => {
  const items = [...Array(10).keys()].map((i) => ({ url: `s1-${i}`, session: 's1' })).concat([{ url: 's2-0', session: 's2' }, { url: 's3-0', session: 's3' }]);
  const got = spreadPick(items, 4).map((x) => x.url);
  assert.equal(got.length, 4);
  assert.ok(got.includes('s2-0') && got.includes('s3-0'));
  assert.equal(spreadPick([{ url: 'a' }], 4).length, 1);
  const flat = spreadPick([...Array(30).keys()].map((i) => ({ url: `u${i}` })), 5).map((x) => x.url);
  assert.deepEqual([flat[0], flat[4]], ['u0', 'u29']);
  const pair = normalizePair({ a_id: V, b_id: W, a_samples: ['x'], b_samples: ['y'], listing_url: 'https://bringatrailer.com/listing/x/', listing_side: 'b', fields: { a: { vin: 'ABC12345678901234' } } });
  assert.deepEqual(listingUrls(pair, []), { a: null, b: 'https://bringatrailer.com/listing/x/' });
  assert.equal(listingUrls(pair, [{ vin: 'abc1-2345678901234', url: 'https://bringatrailer.com/listing/h/' }]).a, 'https://bringatrailer.com/listing/h/');
});

const SGN = { v: '11111111-1111-4111-8111-111111111111', r: '22222222-2222-4222-8222-222222222222', a: 'aaaaaaaa-0000-4000-8000-000000000001', b: 'bbbbbbbb-0000-4000-8000-000000000002', b2: 'bbbbbbbb-0000-4000-8000-000000000003' };

test('mine-sign-evidence: name phrases keep the distinctive token sequence and drop generic words', () => {
  assert.deepEqual(namePhrases('Viva Las Vegas Autos'), [['viva', 'las', 'vegas', 'autos'], ['viva']]);
  assert.ok(namePhrases("Ernie's Upholstery").some((p) => p.join(' ') === 'ernies'));
  assert.ok(namePhrases("Ernie's Upholstery").some((p) => p.join(' ') === 'ernie s'));
  assert.deepEqual(namePhrases('Las Vegas Autos Inc'), []); // only generic words
  assert.deepEqual(namePhrases('Acme Motors', ['acme_motors']).map((p) => p.join(' ')), ['acme motors', 'acme']);
});

test('mine-sign-evidence: one organization named -> quote <= 160 chars; several -> none; whole words only', () => {
  const places = [{ id: SGN.a, name: 'Viva Las Vegas Autos' }, { id: SGN.b, name: "Ernie's Upholstery" }];
  assert.deepEqual(organizationsNamed(places, ['A banner reading VIVA LAS VEGAS AUTOS above the gate']), [{ org_id: SGN.a, quote: 'A banner reading VIVA LAS VEGAS AUTOS above the gate' }]);
  assert.equal(organizationsNamed(places, ["Sign says Ernie's on the door"])[0].org_id, SGN.b);
  assert.equal(organizationsNamed(places, ['Ernies Upholstery sign'])[0].org_id, SGN.b);
  assert.equal(organizationsNamed(places, ['a vivacious crowd', 'revived lot']).length, 0);
  assert.equal(organizationsNamed(places, ['Viva sign next to Ernie s shop']).length, 2);
  const long = 'x '.repeat(200) + 'Viva Las Vegas Autos' + ' y'.repeat(200);
  const [hit] = organizationsNamed(places, [long]);
  assert.ok(hit.quote.length <= 160 && /Viva Las Vegas Autos/.test(hit.quote));
  assert.deepEqual(organizationsNamed([{ id: SGN.a, name: 'Foo Bar', aliases: ['vivacars'] }], ['VivaCars lot']), [{ org_id: SGN.a, quote: 'VivaCars lot' }]);
});

test('mine-sign-evidence: rows come from sign_text, cues or rationale; ambiguous and out-of-range names are skipped; deduped per org', () => {
  const sess = { vehicle_id: SGN.v, session_key: 's1', organizations: [{ id: SGN.a, name: 'Viva Las Vegas Autos' }, { id: SGN.b, name: "Ernie's Upholstery" }, { id: SGN.b2, name: "Ernie's Upholstery" }] };
  const rep = representatives([sess]);
  const m = new Map([[`${SGN.v}|s1`, sess]]);
  const row = (o) => ({ run_id: SGN.r, vehicle_id: SGN.v, session_key: 's1', viewer: 1, rationale: 'generic lot', cues: [], ...o });
  const rows = mineSigns([row({ sign_text: 'VIVA LAS VEGAS AUTOS' }), row({ viewer: 2, cues: ['viva sign'] }), row({ session_key: 's2', sign_text: 'Viva' })], m, rep);
  assert.equal(rows.length, 1);
  assert.deepEqual({ ...rows[0], quote: undefined }, { vehicle_id: SGN.v, session_key: 's1', org_id: SGN.a, quote: undefined, source_run_id: SGN.r, source_viewer: 1, producer: 'scripts/garage/mine-sign-evidence.mjs' });
  assert.equal(mineSigns([row({ sign_text: 'Viva and Ernie s' })], m, rep).length, 0); // two organizations in one row
  assert.equal(mineSigns([row({ sign_text: 'Viva' }), row({ viewer: 2, rationale: 'sign: Ernies Upholstery' })], m, rep).length, 0); // rows contradict
  assert.equal(mineSigns([row({ rationale: 'a sign for Unknown Place Motors' })], m, rep).length, 0); // not in range: no organization to name
  assert.equal(mineSigns([row({ sign_text: "Ernie's" })], m, rep)[0].org_id, rep.get(normName("Ernie's Upholstery"))); // same-name ids are one place
});

test('mine-sign-evidence: the empty CTE is byte-identical to the preview placeholder; a filled CTE has the placeholder columns', () => {
  const sql = readSql(new URL('../../supabase/sql/derive_vehicle_relationships_preview.sql', import.meta.url), 'utf8');
  assert.ok(sql.includes(signCte([])));
  const f = signCte([{ vehicle_id: SGN.v, session_key: "s'1", org_id: SGN.a, quote: "Ernie's", source_run_id: SGN.r }]);
  assert.match(f, /WHERE true -- \(sign_matches\)/);
  assert.ok(f.includes("'Ernie''s'") && f.includes('t(vehicle_id, session_key, org_id, quote, source_run_id)'));
  assert.ok(signCte([{ vehicle_id: SGN.v, session_key: 's', org_id: SGN.a, quote: 'q', source_run_id: null }]).includes('WHERE false')); // no citation, no row
});

test('match-places: the viewer is asked for sign_text and the row keeps it (not a CTE column)', () => {
  assert.match(placePrompt({ sampleFiles: ['a.jpg'], sheets: [{ letter: 'A', file: 'A.jpg' }] }), /"sign_text"/);
  const m = parseMatch('{"place":"none","confidence":0.8,"rationale":"r","cues":[],"sign_text":" ERNIE\'S "}', ['A']);
  assert.equal(m.sign_text, "ERNIE'S");
  assert.equal(parseMatch('{"place":"A","confidence":0.8,"rationale":"r","sign_text":null}', ['A']).sign_text, null);
  const row = placeRow({ vehicle_id: SGN.v, session_key: 's', image_ids: [] }, m, {}, { runId: SGN.r, model: 'm', viewer: 1, candidates: [] });
  assert.equal(row.sign_text, "ERNIE'S");
  assert.ok(!placeCte([row]).includes('sign_text'));
});

test('build-place-exemplars: sign_session exemplars fill first, 2 per vehicle, honor exclusions and the cross-org VIN rule', () => {
  const sess = (v, k, u) => ({ vehicle_id: v, session_key: k, sample_urls: [u] });
  const sessions = [sess('veh-1', 's1', 'u1'), sess('veh-1', 's2', 'u2'), sess('veh-1', 's3', 'u3'), sess('veh-2', 's1', 'u4'), sess('veh-3', 's1', 'u5'), sess('veh-4', 's1', 'u6'), sess('veh-5', 's1', 'u7')];
  const sign = ['veh-1|s1', 'veh-1|s2', 'veh-1|s3', 'veh-2|s1', 'veh-3|s1', 'veh-4|s1', 'veh-5|s1'].map((k) => ({ vehicle_id: k.split('|')[0], session_key: k.split('|')[1], org_id: 'org-a', quote: 'Viva', source_run_id: 'run-1' }));
  const owners = new Map([['veh-3', new Set(['someone else'])]]);
  const by = signExemplars(sign, sessions, { exclude: ['veh-4'], owners, orgOf: () => ({ id: 'org-a', name: 'Viva Las Vegas Autos' }) });
  assert.deepEqual(by.get('org-a').map((e) => e.url), ['u1', 'u2', 'u4', 'u7']);
  assert.deepEqual(by.get('org-a')[0], { url: 'u1', source: 'sign_session', cite: { vehicle_id: 'veh-1', session_key: 's1', quote: 'Viva', source_run_id: 'run-1' } });
  const bat = [{ url: 'b1', source: 'bat_listing', cite: {} }]; const vin = [{ url: 'v1', source: 'vin_matched_session', cite: {} }];
  assert.deepEqual(mergeBySources({ bat, vin, sign: by.get('org-a') }, 6, null, 1).map((e) => e.url), ['u1', 'u2', 'u4', 'u7', 'v1', 'b1']);
  assert.deepEqual(buildExemplarRows([{ id: 'org-a', name: 'A' }], new Map(), new Map(), 2, { signByOrg: by })[0].exemplars.map((e) => e.url), ['u1', 'u2']);
});

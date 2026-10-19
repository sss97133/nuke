import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateCapture } from '../../../supabase/functions/extract-facebook-marketplace/capture.ts';

process.env.NUKE_FB_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'nukefb-'));
const { buildPackets, listingPagePackets, BASE, VARIANTS } = await import('./runner.mjs');
const { checkAck } = await import('./pull-spool.mjs');
const classify = new Function('globalThis', `${fs.readFileSync(new URL('../extension/classify.js', import.meta.url), 'utf8')}; return globalThis.NukeClassify.classify;`)({});
const card = (id, title, year, price) => ({ facebook_id: id, url: `https://www.facebook.com/marketplace/item/${id}/`, title, parsed_year: year, price, content_text: '{}', status: 'active' });
const pass = cards => ({ cards, scans: 5, last: { actual_url: BASE, actual_region: 'Fixture', observed_at: new Date().toISOString(), displayed_filters: { year_values: [], newest_first_checked: false } } });

test('packets carry only accepted cards, tiers, and every rejection with its reason; passes the server validator', () => {
  const cards = [card('1', '1965 Volkswagen beetle', 1965, 6800), card('2', '1989 Chevrolet dolphin', 1989, 6000), card('3', '1982 Dodge ram 1500', 1982, 4500), card('4', '2019 Toyota highlander', 2019, 20900)];
  const { packets, screening, rejected } = buildPackets(pass(cards), BASE + VARIANTS.years_cartruck, classify);
  assert.equal(packets.length, 1); assert.deepEqual(packets[0].batch.map(c => c.facebook_id), ['1', '3']);
  assert.deepEqual(screening.tiers, { 1: 1, 3: 2 }); assert.equal(screening.rejected_count, 2);
  assert.deepEqual(rejected.map(r => [r.facebook_id, r.reasons[0]]), [['2', 'boat'], ['4', 'year_after_1991']]);
  assert.equal(packets[0].capture.rejected.length, 2); assert.equal(packets[0].capture.retrieval_surface, 'playwright_rendered_search_cards');
  validateCapture(packets[0].capture, packets[0].batch);
});
test('all-rejected pass yields no packet; 120 accepted cards split into packets of at most 50', () => {
  assert.equal(buildPackets(pass([card('9', '2024 Arrow trailer', 2024, 5)]), BASE, classify).packets.length, 0);
  const many = Array.from({ length: 120 }, (_, i) => card(String(100 + i), '1970 Ford F100', 1970, 5000));
  assert.deepEqual(buildPackets(pass(many), BASE, classify).packets.map(p => p.batch.length), [50, 50, 20]);
});
test('ack requires every canonical stage for the same capture', () => {
  const p = { capture: { capture_id: 'a' }, batch: [1, 2] }, ok = { success: true, capture_id: 'a', counts: { errors: 0, raw_landed: 2, listings_landed: 2, sightings_landed: 2 } };
  assert.equal(checkAck(p, ok), true);
  assert.equal(checkAck(p, { ...ok, counts: { ...ok.counts, sightings_landed: 1 } }), false);
  assert.equal(checkAck(p, { ...ok, capture_id: 'b' }), false);
});

const detail = await import('./detail.mjs');
const fixtureText = ['1968 Ford Mustang', '$18,500', 'Listed 2 days ago in Tucson, AZ', 'Details', 'Driven 80,000 miles', "Seller's description", 'Runs and drives.', 'Clean title in hand.', 'See more', 'Seller information', 'Pat Example', 'Message seller'].join('\n');
test('listing page reader pulls description, price, seller and full image list; unknown stays null', () => {
  const imgs = [{ url: 'https://scontent.fbcdn.net/a.jpg', width: 960, height: 720 }, { url: 'https://scontent.fbcdn.net/a.jpg', width: 960, height: 720 }, { url: 'https://other.example/x.jpg', width: 10, height: 10 }];
  const p = detail.readListingPage({ text: fixtureText, title: '1968 Ford Mustang', images: imgs }, '2026-10-14T08:00:00Z');
  assert.equal(p.price, 18500); assert.equal(p.description, 'Runs and drives.\nClean title in hand.'); assert.equal(p.description_complete, false);
  assert.equal(p.seller_name, 'Pat Example'); assert.equal(p.seller_type, null); assert.equal(p.seller_type_basis, 'not_shown'); assert.equal(p.images.length, 1);
  const card = detail.revisitCard('123', p, { text: fixtureText });
  assert.equal(card.removal, undefined); assert.deepEqual(card.all_images, ['https://scontent.fbcdn.net/a.jpg']);
  assert.equal(card.seller_profile_url, undefined, 'no profile link read, no key sent');
});
test('the seller profile link travels as the key; anything but a numeric Marketplace profile is dropped', () => {
  const linked = detail.readListingPage({ text: fixtureText, title: '1968 Ford Mustang', seller_profile_url: 'https://www.facebook.com/marketplace/profile/100012345678/?ref=listing' }, '2026-10-14T08:00:00Z');
  assert.equal(detail.revisitCard('123', linked, { text: fixtureText }).seller_profile_url, 'https://www.facebook.com/marketplace/profile/100012345678/');
  assert.equal(detail.readListingPage({ text: fixtureText, seller_profile_url: 'https://www.facebook.com/some.page' }, '2026-10-14T08:00:00Z').seller_profile_url, null);
});
test('removed page becomes removal evidence; Sold label is attributed, not a confirmed sale', () => {
  const gone = detail.readListingPage({ text: "This listing isn't available anymore.\nIt may have been removed.", title: null }, '2026-10-14T08:00:00Z');
  assert.equal(gone.unavailable, true);
  const c = detail.revisitCard('9', gone, { text: "This listing isn't available anymore." });
  assert.equal(c.removal.reason, 'revisit_unavailable');
  const sold = detail.readListingPage({ text: ['Sold', '1970 GMC C10', '$3,500'].join('\n'), title: '1970 GMC C10' }, '2026-10-14T08:00:00Z');
  assert.equal(detail.revisitCard('8', sold, { text: 'Sold' }).removal.reason, 'displayed_sold');
  validateCapture({ capture_id: '00000000-0000-4000-a000-000000000009', observed_at: '2026-10-14T08:00:00Z', target_url: 'https://www.facebook.com/marketplace/item/9/', actual_url: 'https://www.facebook.com/marketplace/item/9/', actual_region: 'listing page', retrieval_surface: 'playwright_rendered_listing_page', complete: false, access_state: 'available' }, [c]);
});

test('listing pages: one packet per item, named by its URL as the history reader requires; redirects claim nothing', async () => {
  const sql = (await import('../../../supabase/functions/db-stats/listingHistory.ts')).LISTING_HISTORY_SQL;
  const itemRe = new RegExp(sql.match(/substring\(j\.capture->>'actual_url' FROM '([^']+)'\)/)[1]);
  const at = '2026-10-18T05:32:58.184Z';
  const packets = listingPagePackets([
    { card: card('1575513783791705', '1973 Volkswagen beetle', 1973, 9000), finalUrl: 'https://www.facebook.com/marketplace/item/1575513783791705/?ref=search', observedAt: at },
    { card: card('42', 'gone', 1970, null), finalUrl: 'https://www.facebook.com/marketplace/', observedAt: at },
    { card: card('77', 'no final url', 1972, 5000), observedAt: at },
    { card: card('78', 'left marketplace', 1972, 5000), finalUrl: 'https://www.facebook.com/', observedAt: at },
  ]);
  assert.equal(packets.length, 4);
  assert.equal(new Set(packets.map(p => p.capture.source_cycle_id)).size, 1);
  for (const p of packets) { assert.equal(p.batch.length, 1); assert.equal(p.capture.observed_at, at); validateCapture(p.capture, p.batch); }
  assert.equal(packets[0].capture.actual_url.match(itemRe)?.[1], '1575513783791705');
  assert.equal(packets[1].capture.actual_url.match(itemRe), null);
  assert.equal(packets[2].capture.actual_url.match(itemRe), null);
  assert.equal(packets[3].capture.actual_url.match(itemRe), null);
});

const { due } = await import('./make-revisit-list.mjs');
test('revisit policy: tier 1 first, 3 h minimum age, once a day, 45 day horizon', () => {
  const now = Date.parse('2026-10-14T12:00:00Z'), h = n => new Date(now - n * 3600_000).toISOString();
  const rows = [{ facebook_id: 'a', parsed_year: 1980, first_seen_at: h(5) }, { facebook_id: 'b', parsed_year: 1970, first_seen_at: h(30) }, { facebook_id: 'c', parsed_year: 1970, first_seen_at: h(1) },
    { facebook_id: 'd', parsed_year: 1985, first_seen_at: h(50) }, { facebook_id: 'e', parsed_year: 1970, first_seen_at: h(24 * 46) }];
  assert.deepEqual(due(rows, {}, now), ['b', 'a', 'd']);
  assert.deepEqual(due(rows, { b: now - 3600_000, a: now - 25 * 3600_000 }, now), ['a', 'd']);
});

const { pageScripts, PASS } = await import('./runner.mjs');
const { createRequire } = await import('node:module');
test('dry run on a saved search page: gate keeps cars/trucks 1964-1991, drops the rest with reasons, packet validates and stages', async () => {
  const { JSDOM } = createRequire(new URL('../../../nuke_frontend/package.json', import.meta.url))('jsdom');
  const html = fs.readFileSync(new URL('./fixtures/vehicles-search.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: BASE + VARIANTS.years_cartruck, runScripts: 'outside-only' });
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 200, height: 100, top: 10, bottom: 110, left: 10, right: 210 });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } }); // jsdom has no layout text
  dom.window.eval(pageScripts);
  const pass = JSON.parse(JSON.stringify(await dom.window.eval(`${PASS}({ maxScrolls: 0, maxCards: 200, pauseMs: [1] })`)));
  dom.window.close();
  assert.equal(pass.cards.length, 17, 'outside-main recommendation excluded');
  const { packets, screening, rejected } = buildPackets(pass, BASE + VARIANTS.years_cartruck, classify);
  const kept = packets[0].batch.map(c => c.facebook_id).sort();
  assert.deepEqual(kept, ['1001', '1002', '1003', '1004', '1005', '1006', '1017']);
  assert.deepEqual(screening.tiers, { 1001: 1, 1002: 1, 1003: 1, 1004: 2, 1005: 2, 1006: 2, 1017: 2 });
  const byReason = {}; for (const r of rejected) for (const x of r.reasons) byReason[x] = (byReason[x] ?? 0) + 1;
  assert.deepEqual(byReason, { boat: 1, motorcycle: 1, rv_camper_trailer: 2, parts: 1, year_after_1991: 1, year_unknown: 1, price_placeholder: 1, offroad_utility: 1, year_before_1964: 1 });
  validateCapture(packets[0].capture, packets[0].batch);
  const out = path.join(process.env.NUKE_FB_HOME, 'dry.json'); fs.writeFileSync(out, JSON.stringify(packets[0]));
  const staged = (await import('node:child_process')).spawnSync('node', ['--import', 'tsx', new URL('../../fb-import-urls.ts', import.meta.url).pathname, '--capture', out], { encoding: 'utf8' });
  assert.equal(staged.status, 0, staged.stderr); assert.equal(JSON.parse(staged.stdout.trim().split('\n').at(-1)).cards, 7);
});

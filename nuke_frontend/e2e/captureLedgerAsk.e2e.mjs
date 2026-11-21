// The capture ledger's "Which vehicle?" question for a held photo set, end to end in a real browser against the dev
// server with Supabase mocked at the network (mockSupabase.mjs). Asserts: the block renders; picking a car, leaving a
// photo out, opening the garage list and typing a filter write nothing; File sends exactly the photos left in, the
// picked car and the reason; after a successful File the day and the totals are read again. A partial answer and a
// refusal (42501) show their lines, on screen and clear of the phone's tab bar. His vehicles are read the phone's way
// (the vehicles table, five columns, his by user or owner), live records only; a closest car that is not one of them is a muted line, and
// with no closest car to tap the list of his vehicles opens by default, without scrolling. A car picked from that list
// and then hidden by the filter is no longer picked. A photo whose picture stayed on the phone, a reviewed non-vehicle
// photo and a test address read in their own words, in the rows, the day's pills and the summary. Screenshots go to E2E_SHOTS_DIR when it is set (none otherwise), at a 390x844
// phone (touch) and a 1280x900 desktop, light and dark.
// Run: NODE_PATH=/tmp/pw/node_modules node --test e2e/captureLedgerAsk.e2e.mjs
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startDevServer } from './devServer.mjs';
import { MOCK_HOST, mockSupabase, persona } from './mockSupabase.mjs';
import {
  CANDIDATES_MIXED, CANDIDATES_NONE_MINE, CAR, COLOURS, DAY, JUNK_THUMB, NOT_MINE, OWNER_ID, SCORES, SET_A, SET_A_IDS, SET_B, TZ, VEHICLES, dayFixture,
  ledgerFixture, nameOfCar, solidPng,
} from './captureLedgerAskFixtures.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const OWNER = persona(OWNER_ID, 'e2eowner');
const SHOTS = process.env.E2E_SHOTS_DIR || null;
const WIDTHS = {
  390: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  1280: { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 },
};
const metrics = [];
let server, browser;

before(async () => {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  server = await startDevServer(Number(process.env.E2E_LEDGER_PORT ?? 4331));
  browser = await chromium.launch();
  // Warm the dev server (dependency optimisation can force one reload on first visit).
  const ctx = await browser.newContext();
  await mockSupabase(ctx, {});
  const page = await ctx.newPage();
  await page.goto(`${server.base}/capture/ledger`, { timeout: 120_000 });
  await page.waitForLoadState('networkidle', { timeout: 120_000 }).catch(() => {});
  await ctx.close();
}, { timeout: 240_000 });

after(async () => {
  await browser?.close(); server?.stop();
  if (SHOTS) writeFileSync(path.join(SHOTS, 'metrics.json'), JSON.stringify(metrics, null, 2));
});

/**
 * One signed-in page on /capture/ledger. `answer` is what attribute_image_session returns: a number (photos filed) or
 * 'all' (as many as were sent), or { status, body } for a refusal. `candidates`: set A's closest cars (the fixture's three
 * by default). Returns the page, the writes it sent and counters of the reads.
 */
async function open(width, { answer = 'all', theme = 'light', candidates } = {}) {
  const ctx = await browser.newContext({ ...WIDTHS[width], timezoneId: TZ, locale: 'en-US', colorScheme: theme });
  await ctx.addInitScript((t) => { try { localStorage.setItem('themePreference', t); } catch { /* none */ } }, theme);
  let filed = null;
  const reads = { day: 0, ledger: 0, vehicles: [] };
  const writes = [];
  const images = [];
  await mockSupabase(ctx, {
    who: OWNER,
    readers: {
      get_capture_ledger: () => { reads.ledger++; return ledgerFixture(filed); },
      get_capture_ledger_day: (args) => { reads.day++; assert.equal(args.p_day, DAY); return dayFixture(filed, candidates); },
    },
  });
  // his vehicles: the query is recorded (select, filters, order) and answered with the rows the table would return. Other
  // vehicles reads on the page (the app shell's own) carry no or= filter and keep the mock's empty answer.
  await ctx.route((u) => u.origin === MOCK_HOST && u.pathname === '/rest/v1/vehicles', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS' || !new URL(req.url()).searchParams.has('or')) return route.fallback();
    reads.vehicles.push({ method: req.method(), ...Object.fromEntries(new URL(req.url()).searchParams) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(VEHICLES) });
  });
  // Routes registered later run first: the writer (with a status code) and the pictures.
  await ctx.route(`${MOCK_HOST}/rest/v1/rpc/attribute_image_session`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fallback();
    const args = req.postDataJSON();
    writes.push({ rpc: 'attribute_image_session', args });
    if (typeof answer === 'number' || answer === 'all') {
      // 'all': every photo sent was filed (the writer counts what it filed)
      const count = answer === 'all' ? args.p_image_ids.length : answer;
      const vehicle = VEHICLES.find(c => c.id === args.p_vehicle_id);
      filed = { vehicle, ids: args.p_image_ids.slice(0, count) };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(count) });
    }
    return route.fulfill({ status: answer.status, contentType: 'application/json', body: JSON.stringify(answer.body) });
  });
  await ctx.route(`${MOCK_HOST}/storage/v1/**`, async (route) => {
    const url = new URL(route.request().url());
    const m = /\/([a-z]+-\d{2})\.png$/.exec(url.pathname);
    if (!m || !COLOURS[m[1]]) return route.fallback();
    images.push(url.pathname.replace(/^\/storage\/v1\//, '') + url.search);
    return route.fulfill({ status: 200, contentType: 'image/png', body: solidPng(COLOURS[m[1]]) });
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  await page.goto(`${server.base}/capture/ledger`);
  return { ctx, page, writes, reads, images };
}

const setA = (page) => page.locator('section.cl-ask').filter({ hasText: '6 photos' });
const setB = (page) => page.locator('section.cl-ask').filter({ hasText: '2 photos' });

async function openDay(page) {
  await page.getByRole('button', { name: /Nov 18, 2026/ }).click();
  await setA(page).getByRole('heading', { name: 'Which vehicle?' }).waitFor();
  // pictures settle
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(300);
}

async function shot(page, name, width) {
  if (!SHOTS) return;
  await page.screenshot({ path: path.join(SHOTS, `${name}-${width}.png`) });
  await page.screenshot({ path: path.join(SHOTS, `${name}-${width}-full.png`), fullPage: true });
}

/** Geometry a phone user trips on: control sizes, sideways scroll, what is on screen. */
async function measure(page, label, width, extraSelectors = {}) {
  const m = await page.evaluate((extra) => {
    const box = (el) => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom) }; };
    const se = document.scrollingElement;
    const controls = [...document.querySelectorAll('.cl-ask button, .cl-ask input, .cl-ask a')]
      .map(el => ({ text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 50), cls: el.className, ...box(el) }));
    const small = controls.filter(c => c.w > 0 && (c.w < 44 || c.h < 44));
    const photos = [...document.querySelectorAll('.cl-ask__photo')].slice(0, 1).map(box);
    const pics = [...document.querySelectorAll('.cl-ask__pic')].slice(0, 1).map(box);
    const rowThumb = [...document.querySelectorAll('.cl-frame__thumb')].slice(0, 1).map(box);
    const inView = Object.fromEntries(Object.entries(extra).map(([k, sel]) => {
      const el = document.querySelector(sel); if (!el) return [k, 'absent'];
      const r = el.getBoundingClientRect(); return [k, r.bottom > 0 && r.top < innerHeight ? `in view (top ${Math.round(r.top)})` : `off screen (top ${Math.round(r.top)}, viewport ${innerHeight})`];
    }));
    return { scrollWidth: se.scrollWidth, clientWidth: se.clientWidth, sideways: se.scrollWidth > se.clientWidth, small, photo: photos[0], pic: pics[0], rowThumb: rowThumb[0], inView, scrollY: Math.round(scrollY) };
  }, extraSelectors);
  metrics.push({ label, width, ...m });
  return m;
}

async function noRawOnScreen(page) {
  const text = await page.locator('.cl-page').innerText();
  for (const s of SCORES) assert.ok(!text.includes(String(s)) && !text.includes(s.toFixed(1) + ' '), `score ${s} on screen`);
  for (const k of [SET_A, SET_B, ...SET_A_IDS, ...VEHICLES.map(c => c.id), ...NOT_MINE.map(c => c.vehicle_id)]) assert.ok(!text.includes(k), `raw key ${k} on screen`);
  for (const w of ['score_below_threshold', 'no_clear_lead', 'not_scored', 'owner_ledger_answer', 'attribute_image_session', 'empty_url_relay',
    'empty url relay', 'placeholder_url', 'reviewed_non_vehicle', 'no_file', 'non_vehicle']) assert.ok(!text.includes(w), `${w} on screen`);
}

/** The element is fully on screen: below the top edge and above the phone's fixed tab bar (when it shows). Polls for up
 * to 3 s, since the page scrolls it in smoothly or after a re-read. */
async function assertOnScreen(page, selector, what) {
  const probe = () => page.evaluate((sel) => {
    const el = document.querySelector(sel); if (!el) return null;
    const b = el.getBoundingClientRect();
    const nav = document.querySelector('.mobile-bottom-nav');
    const navTop = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect().top : innerHeight;
    return { top: Math.round(b.top), bottom: Math.round(b.bottom), limit: Math.round(Math.min(innerHeight, navTop)) };
  }, selector);
  const end = Date.now() + 3000;
  let r = await probe();
  while (Date.now() < end && !(r && r.top >= 0 && r.bottom <= r.limit)) { await new Promise(res => setTimeout(res, 100)); r = await probe(); }
  assert.ok(r, `${what}: ${selector} absent`);
  assert.ok(r.top >= 0 && r.bottom <= r.limit, `${what} off screen: top ${r.top}, bottom ${r.bottom}, visible to ${r.limit}`);
}

async function waitFor(cond, ms = 10_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (cond()) return true; await new Promise(r => setTimeout(r, 100)); }
  return cond();
}

const C10_82 = CAR[2], C10_78 = CAR[1];

for (const width of [390, 1280]) {
  describe(`which vehicle, ${width}px`, () => {
    it('asks for both held sets, writes nothing until File, files the photos left in, then reads the day again', async () => {
      const { ctx, page, writes, reads, images } = await open(width);
      await openDay(page);
      // the block renders: set A with 6 toggles and its 3 closest cars, set B with 2 toggles and no closest list
      assert.equal(await setA(page).locator('.cl-ask__photo').count(), 6);
      assert.equal(await setB(page).locator('.cl-ask__photo').count(), 2);
      const closest = setA(page).locator('.cl-ask__choices').first().locator(':scope > li > .cl-ask__choice:not(.cl-ask__more)');
      assert.deepEqual(await closest.allInnerTexts(), [nameOfCar(C10_82), nameOfCar(C10_78), nameOfCar(CAR[3])]);
      assert.equal(await setB(page).getByText('Closest matches').count(), 0);
      // set B has no closest car to tap, so his vehicles are listed open below it
      assert.equal(await setB(page).getByRole('button', { name: /Another vehicle/ }).getAttribute('aria-expanded'), 'true');
      assert.equal(await setB(page).locator('.cl-ask__all .cl-ask__choice').count(), 14);
      assert.equal(await setA(page).locator('.cl-ask__all').count(), 0);
      // his vehicles: one read, the phone's picker read without removed or merged-away records
      assert.deepEqual(reads.vehicles, [{ method: 'GET', select: 'id,year,make,model,primary_image_url',
        or: `(user_id.eq.${OWNER_ID},owner_id.eq.${OWNER_ID})`, make: 'neq.UNRESOLVED', deleted_at: 'is.null', merged_into_vehicle_id: 'is.null',
        order: 'updated_at.desc' }]);
      // the day's rows draw their thumbnails through the render endpoint, not the original file
      const rowSrc = await page.locator('.cl-frame img.cl-frame__thumb').first().getAttribute('src');
      assert.match(rowSrc, /\/storage\/v1\/render\/image\/public\/.*\?width=150&quality=75&resize=contain$/);
      // the questions come first in the day, ahead of the photos already filed
      const order = await page.locator('.cl-frames > li').evaluateAll(lis => lis.map(li => li.querySelector('section.cl-ask') ? 'ask' : 'row'));
      assert.deepEqual(order, ['ask', 'ask', 'row', 'row', 'row', 'row', 'row', 'row', 'row']);
      // the unsorted frame, the three filed frames and the three settled ones are plain rows
      assert.equal(await page.locator('.cl-frame').count(), 7);
      await noRawOnScreen(page);
      await measure(page, '01-day-open', width);
      await shot(page, '01-day-open', width);

      // (02) leave the third photo out
      const third = setA(page).locator('.cl-ask__photo').nth(2);
      await third.click();
      assert.equal(await third.getAttribute('aria-pressed'), 'false');
      await shot(page, '02-photo-left-out', width);

      // (03) pick a closest car: the confirm line opens beside it, nothing is written
      const pickBtn = setA(page).getByRole('button', { name: nameOfCar(C10_82), exact: true }).first();
      await pickBtn.scrollIntoViewIfNeeded();
      await pickBtn.click();
      assert.equal(await pickBtn.getAttribute('aria-pressed'), 'true');
      const confirm = setA(page).locator('.cl-ask__confirm');
      await confirm.getByText(`File 5 photos to ${nameOfCar(C10_82)}?`).waitFor();
      // File is off for a moment after a pick (a double tap must not file), then on
      assert.equal(await confirm.getByRole('button', { name: 'File', exact: true }).isDisabled(), true);
      await confirm.getByRole('button', { name: 'File', exact: true }).waitFor();
      await page.waitForFunction(() => !document.querySelector('.cl-ask__confirm .cl-rescan__button')?.disabled);
      assert.deepEqual(writes, [], 'a pick wrote');
      await assertOnScreen(page, '.cl-ask__confirm', 'the confirm line');
      await measure(page, '03-car-picked', width, { confirm: '.cl-ask__confirm', picked: '.cl-ask__choice[aria-pressed=true]' });
      await shot(page, '03-car-picked', width);

      // (04) the garage list with a filter typed: still nothing written
      const more = setA(page).getByRole('button', { name: /Another vehicle/ });
      await more.click();
      assert.equal(await more.getAttribute('aria-expanded'), 'true');
      await page.waitForTimeout(300);
      await assertOnScreen(page, '.cl-ask__filter', 'the garage filter');
      const filter = setA(page).getByRole('searchbox', { name: /Find a vehicle/ });
      assert.equal(await setA(page).locator('.cl-ask__all .cl-ask__choice').count(), 14);
      // the picked car reads as picked in both lists
      assert.equal(await setA(page).locator('.cl-ask__all .cl-ask__choice[aria-pressed=true]').count(), 1);
      await filter.fill('chev');
      assert.deepEqual(await setA(page).locator('.cl-ask__all .cl-ask__choice').allInnerTexts(),
        VEHICLES.filter(c => nameOfCar(c).toLowerCase().includes('chev')).map(nameOfCar));
      await page.waitForTimeout(300);
      assert.deepEqual(writes, [], 'the list or the filter wrote');
      await measure(page, '04-all-cars-filtered', width, { filter: '.cl-ask__filter', confirm: '.cl-ask__confirm' });
      await shot(page, '04-all-cars-filtered', width);

      // (05) File: exactly the five photos left in, the picked car, the reason; then the day and the totals again
      const dayReads = reads.day, ledgerReads = reads.ledger;
      await confirm.getByRole('button', { name: 'File', exact: true }).click();
      assert.ok(await waitFor(() => writes.length > 0), 'File sent nothing');
      assert.equal(writes.length, 1);
      assert.deepEqual(writes[0].args, { p_image_ids: SET_A_IDS.filter((_, i) => i !== 2), p_vehicle_id: C10_82.id, p_reason: 'owner_ledger_answer' });
      await page.getByRole('status').filter({ hasText: `Filed 5 photos to ${nameOfCar(C10_82)}.` }).waitFor();
      assert.ok(await waitFor(() => reads.day > dayReads && reads.ledger > ledgerReads), `no re-read: day ${reads.day}/${dayReads}, ledger ${reads.ledger}/${ledgerReads}`);
      await page.waitForTimeout(500);
      await assertOnScreen(page, '.cl-filed', 'the Filed line');
      // the photo left out asks again with the garage list closed and the filter cleared
      assert.equal(await setA(page).locator('.cl-ask__all').count(), 0);
      await measure(page, '05-filed', width, { result: '.cl-filed' });
      await shot(page, '05-filed', width);
      // which picture URLs were asked for (the rewrite to /render/image and the plain rows)
      metrics.push({ label: 'images', width, images: [...new Set(images)].slice(0, 40) });
      await ctx.close();
    });

    it('a partial answer says how many of how many, and the photos still held ask again', async () => {
      const { ctx, page, writes } = await open(width, { answer: 4 });
      await openDay(page);
      await setA(page).getByRole('button', { name: nameOfCar(C10_78), exact: true }).first().click();
      await setA(page).locator('.cl-ask__confirm').getByRole('button', { name: 'File', exact: true }).click();
      await page.getByRole('status').filter({ hasText: `Filed 4 of 6 to ${nameOfCar(C10_78)}. 2 photos still wait below.` }).waitFor();
      assert.deepEqual(writes.map(w => w.args), [{ p_image_ids: SET_A_IDS, p_vehicle_id: C10_78.id, p_reason: 'owner_ledger_answer' }]);
      await page.locator('section.cl-ask').filter({ hasText: /^.*2 photos.*Held: not sure enough/s }).first().waitFor().catch(() => {});
      await page.waitForTimeout(500);
      await assertOnScreen(page, '.cl-filed', 'the partial line');
      await measure(page, '06-partial', width, { result: '.cl-filed' });
      await shot(page, '06-partial', width);
      await ctx.close();
    });

    it('a refusal says, inside the confirm line he tapped, that this car cannot take them, after one write', async () => {
      const { ctx, page, writes } = await open(width, { answer: { status: 403, body: { code: '42501', message: 'attribute_image_session: you can only file your own photos onto a vehicle you can edit', details: null, hint: null } } });
      await openDay(page);
      // worst case: picked from the open list of his vehicles (the writer can still refuse one), then File
      await setA(page).getByRole('button', { name: /Another vehicle/ }).click();
      const car = setA(page).locator('.cl-ask__all').getByRole('button', { name: nameOfCar(CAR[9]), exact: true });
      await car.scrollIntoViewIfNeeded();
      await car.click();
      await setA(page).locator('.cl-ask__confirm').getByRole('button', { name: 'File', exact: true }).click();
      const alert = setA(page).locator('.cl-ask__confirm').getByRole('alert');
      await alert.waitFor();
      assert.equal((await alert.innerText()).trim(), "You can't file photos onto this vehicle. Pick one you own or can edit.");
      assert.equal(writes.length, 1);
      assert.equal(writes[0].args.p_vehicle_id, CAR[9].id);
      await page.waitForTimeout(300);
      await assertOnScreen(page, '.cl-ask__failure', 'the refusal');
      await measure(page, '07-error', width, { alert: '.cl-ask [role=alert]', confirm: '.cl-ask__confirm' });
      await shot(page, '07-error', width);
      await ctx.close();
    });

    it('a double tap or a held Enter on a car never files: File waits for its own tap', async () => {
      const { ctx, page, writes } = await open(width);
      await openDay(page);
      // a closest car just above the bottom edge (the tab bar on the phone), so the confirm line scrolls in under the finger
      const car = setA(page).getByRole('button', { name: nameOfCar(C10_78), exact: true }).first();
      await car.scrollIntoViewIfNeeded();
      await page.evaluate((sel) => {
        const el = document.querySelectorAll(sel)[1]; const nav = document.querySelector('.mobile-bottom-nav');
        const limit = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect().top : innerHeight;
        window.scrollBy(0, el.getBoundingClientRect().bottom - (limit - 8));
      }, 'section.cl-ask .cl-ask__choices > li > .cl-ask__choice');
      await car.dblclick();
      await setA(page).locator('.cl-ask__confirm').waitFor();
      await page.waitForTimeout(800);
      assert.deepEqual(writes, [], 'a double tap on a car filed');
      // a held Enter on a car: the key repeats on the car, not on File
      const bronco = setA(page).getByRole('button', { name: nameOfCar(CAR[3]), exact: true }).first();
      await bronco.focus();
      await page.keyboard.down('Enter'); await page.keyboard.down('Enter'); await page.keyboard.down('Enter');
      await page.keyboard.up('Enter');
      await page.waitForTimeout(800);
      assert.deepEqual(writes, [], 'a held Enter on a car filed');
      assert.equal(await bronco.getAttribute('aria-pressed'), 'true');
      await ctx.close();
    });

    it('a closest car that is not one of his vehicles is a muted line beside the one he can pick', async () => {
      for (const theme of ['light', 'dark']) {
        const { ctx, page, writes } = await open(width, { candidates: CANDIDATES_MIXED, theme });
        await openDay(page);
        const closest = setA(page).locator('.cl-ask__choices').first().locator(':scope > li > .cl-ask__choice:not(.cl-ask__more)');
        assert.deepEqual(await closest.allInnerTexts(), [nameOfCar(C10_82)]);
        const line = setA(page).locator('.cl-ask__choices > li > .cl-ask__hint');
        assert.equal((await line.innerText()).trim(), `Closest, but can't take photos (merged, removed or not linked to your account): ${NOT_MINE[0].name}.`);
        // not a button, not reachable by Tab
        assert.equal(await setA(page).getByRole('button', { name: new RegExp(NOT_MINE[0].name) }).count(), 0);
        assert.equal(await line.evaluate(el => el.querySelector('button, a, input, [tabindex]') === null && el.closest('button') === null), true);
        // his car to tap is there, so the list stays closed
        assert.equal(await setA(page).locator('.cl-ask__all').count(), 0);
        await noRawOnScreen(page);
        await line.scrollIntoViewIfNeeded();
        await page.evaluate(() => window.scrollBy(0, 120));
        await page.waitForTimeout(300);
        await assertOnScreen(page, '.cl-ask__choices > li > .cl-ask__hint', 'the muted line');
        await measure(page, `08-candidate-not-yours-${theme}`, width, { line: '.cl-ask__choices > li > .cl-ask__hint' });
        await shot(page, theme === 'dark' ? '08-candidate-not-yours-dark' : '08-candidate-not-yours', width);
        assert.deepEqual(writes, []);
        await ctx.close();
      }
    });

    it('with no closest car to tap, his vehicles are listed open, and opening the day does not scroll', async () => {
      const { ctx, page, writes } = await open(width, { candidates: CANDIDATES_NONE_MINE });
      await openDay(page);
      assert.equal(await page.evaluate(() => Math.round(scrollY)), 0, 'opening the day scrolled the page');
      await assertOnScreen(page, 'section.cl-ask h2', 'the question');
      assert.equal(await setA(page).locator('.cl-ask__choices').first().locator(':scope > li > .cl-ask__choice:not(.cl-ask__more)').count(), 0);
      assert.deepEqual((await setA(page).locator('.cl-ask__choices > li > .cl-ask__hint').allInnerTexts()).map(t => t.trim()),
        [`Closest, but can't take photos (merged, removed or not linked to your account): ${NOT_MINE.map(c => c.name).join(', ')}.`]);
      assert.equal(await setA(page).getByRole('button', { name: /Another vehicle/ }).getAttribute('aria-expanded'), 'true');
      assert.equal(await setA(page).locator('.cl-ask__all .cl-ask__choice').count(), 14);
      await measure(page, '09-no-tappable-candidate-first-screen', width, { question: 'section.cl-ask h2', line: '.cl-ask__choices > li > .cl-ask__hint' });
      await setA(page).locator('.cl-ask__choices > li > .cl-ask__hint').first().scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, 160));
      await page.waitForTimeout(300);
      await measure(page, '09-no-tappable-candidate', width, { line: '.cl-ask__choices > li > .cl-ask__hint', filter: '.cl-ask__filter' });
      await shot(page, '09-no-tappable-candidate', width);
      // a car from the open list files the same way
      const car = setA(page).locator('.cl-ask__all').getByRole('button', { name: nameOfCar(CAR[5]), exact: true });
      await car.scrollIntoViewIfNeeded();
      await car.click();
      const file = setA(page).locator('.cl-ask__confirm').getByRole('button', { name: 'File', exact: true });
      await page.waitForFunction(() => !document.querySelector('.cl-ask__confirm .cl-rescan__button')?.disabled);
      await file.click();
      assert.ok(await waitFor(() => writes.length > 0), 'File sent nothing');
      assert.deepEqual(writes[0].args, { p_image_ids: SET_A_IDS, p_vehicle_id: CAR[5].id, p_reason: 'owner_ledger_answer' });
      await ctx.close();
    });

    it('a car picked from his list that the filter then hides is no longer picked, and clearing the filter brings nothing back', async () => {
      const { ctx, page, writes } = await open(width);
      await openDay(page);
      await setA(page).getByRole('button', { name: /Another vehicle/ }).click();
      const filter = setA(page).getByRole('searchbox', { name: /Find a vehicle/ });
      await filter.fill('chevelle');
      await setA(page).locator('.cl-ask__all').getByRole('button', { name: nameOfCar(CAR[7]), exact: true }).click();
      const confirm = setA(page).locator('.cl-ask__confirm');
      await confirm.getByText(`File 6 photos to ${nameOfCar(CAR[7])}?`).waitFor();
      await filter.fill('ford');
      await page.waitForTimeout(200);
      assert.equal(await confirm.count(), 0, 'the confirm line outlived its row');
      await filter.fill('');
      await page.waitForTimeout(200);
      assert.equal(await setA(page).locator('.cl-ask__all .cl-ask__choice').count(), 14);
      assert.equal(await confirm.count(), 0, 'clearing the filter brought a hidden pick back');
      assert.equal(await setA(page).locator('.cl-ask__choice[aria-pressed=true]').count(), 0);
      // a closest match picked from the list is checked in both its rows; the one filter change that hides it clears it
      await setA(page).locator('.cl-ask__all').getByRole('button', { name: nameOfCar(CAR[2]), exact: true }).click();
      await confirm.getByText(`File 6 photos to ${nameOfCar(CAR[2])}?`).waitFor();
      assert.equal(await setA(page).locator('.cl-ask__choice[aria-pressed=true]').count(), 2);
      await filter.fill('ford');
      await page.waitForTimeout(200);
      assert.equal(await setA(page).locator('.cl-ask__choice[aria-pressed=true]').count(), 0, 'a hidden pick is still checked under Closest matches');
      assert.equal(await confirm.count(), 0);
      assert.deepEqual(writes, []);
      await ctx.close();
    });

    it('a picture kept on the phone, a non-vehicle photo and a test address read in their own words', async () => {
      const { ctx, page } = await open(width);
      const asked = [];
      page.on('request', (r) => { if (r.url().startsWith(new URL(JUNK_THUMB).origin)) asked.push(r.url()); });
      await page.locator('.cl-bar').waitFor();
      const summary = await page.locator('.cl-bar__summary .k-body').innerText();
      assert.match(summary, / · 4 kept on the phone · 3 not vehicle photos · 1 not a photo$/);
      const pills = (d) => page.locator('.cl-day').nth(d).locator('.cl-pill').allInnerTexts();
      assert.deepEqual((await pills(0)).slice(-3), ['1 kept on the phone', '1 not a vehicle photo', '1 not a photo']);
      assert.deepEqual((await pills(1)).slice(-2), ['3 kept on the phone', '2 not vehicle photos']);
      await measure(page, '10-settled-pills', width);
      await shot(page, '10-settled-pills', width);
      await openDay(page);
      const row = (state) => page.locator(`.cl-frame--${state}`);
      assert.equal(await row('no_file').locator('.k-body').innerText(), 'Picture kept on the phone');
      assert.match(await row('no_file').locator('.k-caption').innerText(), /^IMG_4113 · 2:00 PM · only the time and rough place were sent$/);
      assert.equal(await row('non_vehicle').locator('.k-body').innerText(), 'Not a vehicle photo');
      assert.match(await row('non_vehicle').locator('.k-caption').innerText(), /^IMG_4114 · 2:05 PM · checked: no vehicle in it$/);
      assert.equal(await row('junk').locator('.k-body').innerText(), 'Not a photo');
      assert.match(await row('junk').locator('.k-caption').innerText(), /^IMG_4115 · 2:10 PM · no stored picture$/);
      // no picture was sent, and an address that is not a stored picture is not one: the placeholder; the reviewed photo keeps its picture
      assert.equal(await row('no_file').locator('img').count(), 0);
      assert.equal(await row('junk').locator('img').count(), 0);
      assert.equal(await row('non_vehicle').locator('img').count(), 1);
      // an empty circle (no dots, no arrow) on the placeholder and as the row's icon
      for (const sel of ['.cl-frame--no_file .cl-frame__thumb svg', '.cl-frame--junk .cl-frame__thumb svg', '.cl-frame--no_file svg.cl-frame__icon'])
        assert.equal(await page.locator(sel).innerHTML(), '<circle cx="12" cy="12" r="9.5"></circle>', sel);
      // only the fixture's one unscored frame reads "Not sorted yet"
      assert.deepEqual(await page.locator('.cl-frame .k-body').filter({ hasText: /^Not sorted yet$/ }).count(), 1);
      await noRawOnScreen(page);
      await row('junk').scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, 160));
      await page.waitForTimeout(300);
      await assertOnScreen(page, '.cl-frame--no_file', 'the kept-on-the-phone row');
      await assertOnScreen(page, '.cl-frame--junk', 'the not-a-photo row');
      const m = await measure(page, '10-settled-rows', width, { no_file: '.cl-frame--no_file', junk: '.cl-frame--junk' });
      assert.equal(m.sideways, false, 'the page scrolls sideways');
      await shot(page, '10-settled-rows', width);
      assert.deepEqual(asked, [], 'the test address was asked for');
      await ctx.close();
    });

    it('dark theme: the day open and a car picked', async () => {
      const { ctx, page, writes } = await open(width, { theme: 'dark' });
      await openDay(page);
      assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark');
      await shot(page, '01-day-open-dark', width);
      const pickBtn = setA(page).getByRole('button', { name: nameOfCar(C10_82), exact: true }).first();
      await pickBtn.scrollIntoViewIfNeeded();
      await pickBtn.click();
      await setA(page).locator('.cl-ask__confirm').waitFor();
      await page.waitForTimeout(600);
      await shot(page, '03-car-picked-dark', width);
      assert.deepEqual(writes, []);
      await ctx.close();
    });
  });
}

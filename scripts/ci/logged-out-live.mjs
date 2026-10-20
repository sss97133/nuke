#!/usr/bin/env node
// Is the public site working for a stranger? A headless browser with no cookies opens real pages and fails on what a
// visitor would call broken: permission or bad-request errors from the data API, error text on the page, and a vehicle
// whose photos the database admits to anonymous readers but whose page shows none.
//
//   node scripts/ci/logged-out-live.mjs            # exit 1 on any failure, 0 when the site works
//   LIVE_SITE=https://staging.example node scripts/ci/logged-out-live.mjs
//
// Why this exists (2026-10-19): a privacy migration limited anon to column grants; every logged-out gallery read
// failed with 42501 and no profile showed a photo. Every pre-merge check was green and nobody looked at the live
// page. This runs after each deploy and every 30 minutes (.github/workflows/logged-out-live.yml) and opens an issue.
//
// Gated: any 400/401/403 from supabase.co/rest|rpc|functions (deterministic: a permission, grant or query-shape
// break), "permission denied"/42501 in the console, error text on the page, a vehicle with anon-visible photos
// and none on screen. Reported, not gated: 5xx and timeouts (a loaded database jitters; the job-health views own those).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const SITE = process.env.LIVE_SITE || 'https://nuke.ag';
const OUT = process.env.LIVE_OUT || path.resolve('logged-out-live-out');
// Vehicles that hold photos: the profile baseline's three and the owner's C-10. A vehicle with no anon-visible photos
// at probe time is checked for errors only.
const VEHICLES = (process.env.LIVE_VEHICLES ||
  '83f6f033-a3c3-4cf4-a85e-a60d2c588838,e08bf694-970f-4cbe-8a74-8715158a0f2e,be853856-e450-4d0e-b2a1-613391956ad6,ac070808-4cbd-4d03-9c39-2ec5b0f0708c').split(',');
const PAGES = ['/', '/market', ...VEHICLES.map(v => `/vehicle/${v}`)];
const ERROR_TEXT = /Failed to load|permission denied|Something went wrong|Application error/i;
const API = /supabase\.co\/(rest|functions)\//;

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const failures = [];
const warnings = [];
let anonKey = '';
let supabaseOrigin = '';

async function visit(route, mobile) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 } });
  // LIVE_BREAK=<substring>: answer matching data requests with 401, to prove this check catches a broken grant.
  if (process.env.LIVE_BREAK) await context.route(u => API.test(u.href) && u.href.includes(process.env.LIVE_BREAK), r => r.fulfill({ status: 401, contentType: 'application/json', body: '{"code":"42501","message":"permission denied for table vehicle_images"}' }));
  const page = await context.newPage();
  const bad = [];
  const soft = [];
  const consoleErrors = [];
  page.on('response', r => {
    const url = r.url();
    if (!API.test(url)) return;
    if (!anonKey) { anonKey = r.request().headers()['apikey'] || ''; supabaseOrigin = new URL(url).origin; }
    const s = r.status();
    const label = `${s} ${decodeURIComponent(url).replace(/^https:\/\/[^/]+/, '').slice(0, 160)}`;
    if (s === 400 || s === 401 || s === 403) bad.push(label); else if (s >= 500) soft.push(label);
  });
  page.on('console', m => { if (m.type() === 'error' && /permission denied|42501/i.test(m.text())) consoleErrors.push(m.text().slice(0, 160)); });
  await page.goto(SITE + route, { waitUntil: 'networkidle', timeout: 90000 }).catch(e => bad.push('goto: ' + e.message.slice(0, 120)));
  await page.waitForTimeout(3000);
  const seen = await page.evaluate(() => {
    const root = document.querySelector('.vehicle-profile-page') || document.body;
    const text = document.body.innerText || '';
    const imgs = [...root.querySelectorAll('img')].filter(i => i.complete && i.naturalWidth > 50 && i.getBoundingClientRect().width > 40);
    return { text: text.slice(0, 20000), images: imgs.length };
  });
  const tag = `${route}${mobile ? ' (mobile)' : ''}`;
  if (bad.length) failures.push({ page: tag, what: 'data API refused or rejected requests', detail: [...new Set(bad)].slice(0, 6) });
  if (consoleErrors.length) failures.push({ page: tag, what: 'permission errors in the console', detail: [...new Set(consoleErrors)].slice(0, 3) });
  const errText = seen.text.match(ERROR_TEXT);
  if (errText) failures.push({ page: tag, what: `error text on the page: "${errText[0]}"`, detail: [] });
  if (soft.length) warnings.push({ page: tag, what: `${soft.length} 5xx responses`, detail: [...new Set(soft)].slice(0, 3) });
  const safe = route.replace(/[^a-z0-9]+/gi, '_');
  await page.screenshot({ path: path.join(OUT, `${safe}${mobile ? '_m' : ''}.png`), fullPage: false }).catch(() => {});
  await context.close();
  return seen;
}

for (const route of PAGES) {
  const seen = await visit(route, false);
  const m = route.match(/^\/vehicle\/([0-9a-f-]{36})$/);
  if (!m) continue;
  // The database's own answer: how many photos does an anonymous reader get for this vehicle?
  let anonPhotos = null;
  if (anonKey) {
    const res = await fetch(`${supabaseOrigin}/rest/v1/vehicle_images_public?select=id&vehicle_id=eq.${m[1]}&vehicle_image_gallery_eligible=eq.true&limit=1`,
      { headers: { apikey: anonKey, Prefer: 'count=exact', Range: '0-0' } }).catch(() => null);
    if (res && res.ok) anonPhotos = Number((res.headers.get('content-range') || '').split('/')[1]);
    else if (res) failures.push({ page: route, what: `anonymous photo read answered ${res.status}`, detail: [] });
  }
  if (anonPhotos > 0 && seen.images === 0) {
    failures.push({ page: route, what: `the database admits ${anonPhotos} photos to anonymous readers; the page shows none`, detail: [] });
  }
}
// One phone-width pass on the owner's truck: the layout that most visitors use.
await visit(`/vehicle/${VEHICLES[VEHICLES.length - 1]}`, true);
await browser.close();

fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ site: SITE, at: new Date().toISOString(), failures, warnings }, null, 1));
for (const w of warnings) console.log(`warn  ${w.page}: ${w.what}`);
for (const f of failures) console.log(`FAIL  ${f.page}: ${f.what}${f.detail.length ? '\n        ' + f.detail.join('\n        ') : ''}`);
console.log(failures.length ? `${failures.length} failure(s) on ${SITE}` : `ok: ${PAGES.length} pages, logged out, no permission errors, photos shown where admitted`);
process.exit(failures.length ? 1 : 0);

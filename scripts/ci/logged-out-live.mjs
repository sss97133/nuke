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
//
// Private pages (the accounting office and the owner's own profile) are checked the other way round: a visitor must be sent to
// /login, no request to a books reader may fire from the page load, and no private heading may be in the text (2026-10-29:
// /publishing/finance mounted the office to a visitor with no sign-in gate; only its data calls failed).
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
// A contributor's public profile: its photo gallery reads vehicle_images with an embed of vehicles and device_attributions.
const PROFILE = process.env.LIVE_PROFILE || '01718395-bd19-47d3-b701-9867b653dd5b';
const PAGES = ['/', '/market', `/profile/${PROFILE}`, ...VEHICLES.map(v => `/vehicle/${v}`)];
// Pages that belong to the signed-in owner. A visitor is redirected to /login; nothing of the books may load for them.
const PRIVATE_PAGES = ['/accounting', '/publishing/finance', '/profile'];
// The books readers: the accounting RPCs and the book's views and tables. A visitor's page load must not call any of them.
const BOOKS_READERS = /supabase\.co\/rest\/v1\/(rpc\/(accounting_|books_|get_user_reconciliation|related_party|list_accounting_access|owner_working_notes)|(v_books_|v_financial_|financial_documents|financial_document_|financial_review_queue|accounting_access_grants))/;
const PRIVATE_TEXT = /Books docket|Finish your taxes|Your private office|Open the books docket/;
// Reads a stranger's browser makes that no page load reliably triggers: policy-guarded tables and the gate on its own.
const ANON_READS = ['observation_witnesses?select=id&witness_role=eq.derived&limit=1'];
const ERROR_TEXT = /Failed to load|permission denied|Something went wrong|Application error/i;
const API = /supabase\.co\/(rest|functions)\//;

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const failures = [];
const warnings = [];
let anonKey = '';
let supabaseOrigin = '';

async function visit(route, mobile, privatePage = false) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 } });
  // LIVE_BREAK=<substring>: answer matching data requests with 401, to prove this check catches a broken grant.
  if (process.env.LIVE_BREAK) await context.route(u => API.test(u.href) && u.href.includes(process.env.LIVE_BREAK), r => r.fulfill({ status: 401, contentType: 'application/json', body: '{"code":"42501","message":"permission denied for table vehicle_images"}' }));
  const page = await context.newPage();
  const bad = [];
  const soft = [];
  const consoleErrors = [];
  const booksCalls = [];
  page.on('request', r => {
    if (privatePage && BOOKS_READERS.test(r.url())) booksCalls.push(`${r.method()} ${decodeURIComponent(r.url()).replace(/^https:\/\/[^/]+/, '').slice(0, 120)}`);
  });
  page.on('response', r => {
    const url = r.url();
    if (!API.test(url)) return;
    if (!anonKey) { anonKey = r.request().headers()['apikey'] || ''; supabaseOrigin = new URL(url).origin; }
    const s = r.status();
    const label = `${s} ${decodeURIComponent(url).replace(/^https:\/\/[^/]+/, '').slice(0, 160)}`;
    if (s === 400 || s === 401 || s === 403) bad.push(label); else if (s >= 500) soft.push(label);
  });
  page.on('console', m => { if (m.type() === 'error' && /permission denied|42501/i.test(m.text())) consoleErrors.push(m.text().slice(0, 160)); });
  let navigationError;
  await page.goto(SITE + route, { waitUntil: 'networkidle', timeout: 90000 }).catch(e => { navigationError = e; });
  await page.waitForTimeout(3000);
  let anonPhotos = null;
  const vehicle = route.match(/^\/vehicle\/([0-9a-f-]{36})$/);
  if (vehicle && anonKey) {
    const res = await fetch(`${supabaseOrigin}/rest/v1/vehicle_images_public?select=id&vehicle_id=eq.${vehicle[1]}&vehicle_image_gallery_eligible=eq.true&limit=1`,
      { headers: { apikey: anonKey, Prefer: 'count=exact', Range: '0-0' } }).catch(() => null);
    if (res && res.ok) anonPhotos = Number((res.headers.get('content-range') || '').split('/')[1]);
    else if (res) failures.push({ page: route, what: `anonymous photo read answered ${res.status}`, detail: [] });
  }
  if (anonPhotos > 0) {
    // The text-first response can become idle before React mounts. Wait for an admitted photo, then sample again.
    await page.waitForFunction(() => {
      const root = document.querySelector('.vehicle-profile-page') || document.body;
      return [...root.querySelectorAll('img')].some(i => i.complete && i.naturalWidth > 50 && i.getBoundingClientRect().width > 40);
    }, null, { timeout: 30000 }).catch(() => {});
  }
  const seen = await page.evaluate(() => {
    const root = document.querySelector('.vehicle-profile-page') || document.body;
    const text = document.body.innerText || '';
    const imgs = [...root.querySelectorAll('img')].filter(i => i.complete && i.naturalWidth > 50 && i.getBoundingClientRect().width > 40);
    return { text: text.slice(0, 20000), images: imgs.length };
  });
  const tag = `${route}${mobile ? ' (mobile)' : ''}`;
  if (navigationError) {
    const idleTimeout = navigationError.name === 'TimeoutError' && seen.text.trim().length > 0;
    (idleTimeout ? warnings : failures).push({ page: tag,
      what: idleTimeout ? 'navigation did not become idle within 90 seconds' : 'page navigation failed',
      detail: [navigationError.message.slice(0, 160)] });
  }
  if (privatePage) {
    if (!navigationError) {
      const ended = new URL(page.url()).pathname;
      if (ended !== '/login') failures.push({ page: tag, what: `a private page opened for a visitor (it ended at ${ended}, not /login)`, detail: [] });
    }
    if (booksCalls.length) failures.push({ page: tag, what: 'a visitor page load called a books reader', detail: [...new Set(booksCalls)].slice(0, 6) });
    const leaked = seen.text.match(PRIVATE_TEXT);
    if (leaked) failures.push({ page: tag, what: `a private heading is on a visitor page: "${leaked[0]}"`, detail: [] });
  }
  if (bad.length) failures.push({ page: tag, what: 'data API refused or rejected requests', detail: [...new Set(bad)].slice(0, 6) });
  if (consoleErrors.length) failures.push({ page: tag, what: 'permission errors in the console', detail: [...new Set(consoleErrors)].slice(0, 3) });
  const errText = seen.text.match(ERROR_TEXT);
  if (errText) failures.push({ page: tag, what: `error text on the page: "${errText[0]}"`, detail: [] });
  if (anonPhotos > 0 && seen.images === 0) {
    failures.push({ page: tag, what: `the database admits ${anonPhotos} photos to anonymous readers; the page shows none`, detail: [] });
  }
  if (soft.length) warnings.push({ page: tag, what: `${soft.length} 5xx responses`, detail: [...new Set(soft)].slice(0, 3) });
  const safe = route.replace(/[^a-z0-9]+/gi, '_');
  await page.screenshot({ path: path.join(OUT, `${safe}${mobile ? '_m' : ''}.png`), fullPage: false }).catch(() => {});
  await context.close();
  return seen;
}

for (const route of PAGES) await visit(route, false);
for (const route of PRIVATE_PAGES) await visit(route, false, true);
for (const q of ANON_READS) {
  if (!anonKey) break;
  const res = await fetch(`${supabaseOrigin}/rest/v1/${q}`, { headers: { apikey: anonKey } }).catch(() => null);
  if (res && !res.ok && res.status < 500) failures.push({ page: 'anon read', what: `${res.status} on ${q}`, detail: [(await res.text()).slice(0, 160)] });
}
// One phone-width pass on the owner's truck: the layout that most visitors use.
await visit(`/vehicle/${VEHICLES[VEHICLES.length - 1]}`, true);
await browser.close();

fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ site: SITE, at: new Date().toISOString(), failures, warnings }, null, 1));
for (const w of warnings) console.log(`warn  ${w.page}: ${w.what}`);
for (const f of failures) console.log(`FAIL  ${f.page}: ${f.what}${f.detail.length ? '\n        ' + f.detail.join('\n        ') : ''}`);
console.log(failures.length ? `${failures.length} failure(s) on ${SITE}` : `ok: ${PAGES.length} pages, logged out, no permission errors, photos shown where admitted; ${PRIVATE_PAGES.length} private pages send a visitor to /login and call no books reader`);
process.exit(failures.length ? 1 : 0);

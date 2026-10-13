#!/usr/bin/env node
// The vehicle profile's logged-out contract: a headless browser opens each listed vehicle as an
// anonymous visitor and measures what the page does, then ratchets each number against
// scripts/ci/profile-baseline.json. A number may go down. It may not go up.
//
//   node scripts/ci/profile-contract.mjs                   # measure and compare, exit 1 on any regression
//   node scripts/ci/profile-contract.mjs --write-baseline  # seed or lower the floors from the current page
//   PROFILE_CONTRACT_OUT=/path node scripts/ci/profile-contract.mjs   # screenshots and box dumps go here
//
// Metrics per vehicle (desktop 1440x900, fresh context, no cookies):
//   requests     Supabase REST, RPC and function calls to reach network idle (the request budget)
//   errors       console errors
//   fontSizes    distinct computed font sizes outside the kit's scale (20, 14, 10, 9, 8 px, and the dense entity
//                and measure at 13 and 12 px) on text-bearing
//                elements inside the profile: the count that falls as pages move onto the kit
//   inlineStyled elements inside the profile carrying a style attribute
//   snakeTokens  snake_case tokens in the visible text (internal vocabulary reaching a human)
//   money        dollar amounts in the visible text (an anonymous reader's view of money)
//   plateText    license-plate-looking text next to the word PLATE
//   loadMs       time to network idle (reported, never gated: too noisy to ratchet)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASELINE = path.join(ROOT, 'scripts', 'ci', 'profile-baseline.json');
const OUT = process.env.PROFILE_CONTRACT_OUT || path.join(ROOT, 'profile-contract-out');
const SITE = process.env.PROFILE_CONTRACT_SITE || 'https://nuke.ag';
const GATED = ['requests', 'errors', 'fontSizes', 'inlineStyled', 'snakeTokens', 'money', 'plateText'];

const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : { vehicles: {} };
const vehicles = Object.keys(baseline.vehicles || {});
if (vehicles.length === 0) { console.error('No vehicles in', BASELINE); process.exit(2); }

fs.mkdirSync(OUT, { recursive: true });
const PASSES = Number(process.env.PROFILE_CONTRACT_PASSES || 2);   // noise inflates a reading, never deflates it: keep the best of two
const REQUEST_TOLERANCE = 3;                                        // request counts jitter by a few on a timing-out reader
const ERROR_TOLERANCE = 1;                                          // one intermittent 500 from a popup reader is not a regression
const browser = await chromium.launch({ headless: true });
const results = {};
async function measureOnce(id) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', e => errors.push('pageerror: ' + String(e).slice(0, 200)));
  let requests = 0;
  page.on('request', r => { if (/supabase\.co\/(rest|functions)\//.test(r.url())) requests += 1; });
  const started = Date.now();
  await page.goto(`${SITE}/vehicle/${id}`, { waitUntil: 'networkidle', timeout: 120000 }).catch(e => errors.push('goto: ' + e.message.slice(0, 120)));
  const loadMs = Date.now() - started;
  await page.waitForTimeout(3000);
  const measured = await page.evaluate(() => {
    const root = document.querySelector('.vehicle-profile-page') || document.body;
    const text = root.innerText || '';
    const sizes = new Set();
    for (const el of root.querySelectorAll('*')) {
      const own = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim());
      if (!own) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      sizes.add(getComputedStyle(el).fontSize);
    }
    const kitScale = new Set(['20px', '14px', '13px', '12px', '10px', '9px', '8px']);
    const foreign = [...sizes].filter(size => !kitScale.has(size));
    return {
      fontSizes: foreign.length,
      fontSizeList: [...sizes].sort((a, b) => parseFloat(a) - parseFloat(b)),
      inlineStyled: root.querySelectorAll('[style]').length,
      snakeTokens: (text.match(/\b[a-z]+_[a-z_]+\b/g) || []).length,
      money: (text.match(/\$\s?\d[\d,]*/g) || []).length,
      // a PLATE label followed by anything but the mask (an unmasked plate reads like 'PLATE Utah 04AP4')
      plateText: (text.match(/\bPLATE\s*(?!\u2022\u2022\u2022\u2022)[A-Za-z0-9][A-Za-z0-9 -]{3,}/g) || []).length,
      loggedOut: /LOGIN|SIGN IN|LOG IN/i.test(document.body.innerText),
      title: document.title,
    };
  });
  await page.screenshot({ path: path.join(OUT, `${id.slice(0, 8)}.png`), fullPage: true });
  await context.close();
  return { ...measured, requests, errors: errors.length, errorSamples: [...new Set(errors)].slice(0, 5), loadMs };
}
for (const id of vehicles) {
  const passes = [];
  for (let i = 0; i < PASSES; i++) passes.push(await measureOnce(id));
  // Gate on the best pass (noise only inflates a reading); seed the floor from the worst pass
  // (so ordinary jitter on a timing-out reader stays under it). Structural metrics are identical across passes.
  const best = { ...passes[0], worst: {} };
  for (const k of [...GATED, 'loadMs']) { best[k] = Math.min(...passes.map(p => p[k])); best.worst[k] = Math.max(...passes.map(p => p[k])); }
  best.errorSamples = [...new Set(passes.flatMap(p => p.errorSamples))].slice(0, 5);
  best.loggedOut = passes.every(p => p.loggedOut);
  results[id] = best;
}
await browser.close();

const write = process.argv.includes('--write-baseline');
let failed = false;
console.log(`profile contract · ${SITE} · ${new Date().toISOString()}`);
for (const [id, r] of Object.entries(results)) {
  const floor = baseline.vehicles[id] || {};
  const cells = GATED.map(k => {
    const cur = r[k]; const base = floor[k];
    const limit = base == null ? null : base + (k === 'requests' ? REQUEST_TOLERANCE : k === 'errors' ? ERROR_TOLERANCE : 0);
    const mark = base == null ? '·' : cur > limit ? '✗' : cur < base ? '↓' : '=';
    if (limit != null && cur > limit) failed = true;
    return `${k} ${cur}${base != null ? `/${base}` : ''} ${mark}`;
  });
  console.log(`${id.slice(0, 8)} ${r.title.slice(0, 40).padEnd(40)} loggedOut=${r.loggedOut} load=${r.loadMs}ms | ${cells.join('  ')}`);
  if (!r.loggedOut) { console.log('   probe invalid: the page did not render as a logged-out visitor'); failed = true; }
  if (r.errorSamples.length) for (const e of r.errorSamples) console.log('   error:', e);
  console.log('   font sizes:', r.fontSizeList.join(' '), '(kit scale 20 14 13 12 10 9 8; the rest counts)');
}
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));

if (write) {
  const next = { generated: new Date().toISOString().slice(0, 10), note: baseline.note || 'Logged-out vehicle profile floors for scripts/ci/profile-contract.mjs. A metric may go down, never up. Re-seed with --write-baseline after a page gets better.', vehicles: {} };
  for (const [id, r] of Object.entries(results)) next.vehicles[id] = Object.fromEntries(GATED.map(k => [k, r.worst[k]]));
  fs.writeFileSync(BASELINE, JSON.stringify(next, null, 2) + '\n');
  console.log('baseline written:', BASELINE);
  process.exit(0);
}
if (failed) { console.log('PROFILE CONTRACT FAILED: a metric rose above its floor, or the probe was not logged out.'); process.exit(1); }
console.log('PROFILE CONTRACT PASS');

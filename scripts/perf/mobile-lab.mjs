// Mobile lab measurement of the public and sign-in routes on a deployed site: Playwright Chromium, 412x823 @2.625,
// Slow 4G (150 ms RTT, ~1.6 Mbps down, 750 kbps up), 4x CPU, cache disabled, median of RUNS. Reports LCP, FCP,
// TBT (long tasks after FCP), JS transferred and reader calls per page (to spot duplicates).
//
//   mkdir -p /tmp/pw && cd /tmp/pw && npm i playwright@1.61.1 && npx playwright install chromium
//   cp scripts/perf/mobile-lab.mjs /tmp/pw/ && cd /tmp/pw && BASE=https://nuke.ag RUNS=3 node mobile-lab.mjs
//
// Not a CI gate: against branch previews it was not reliable enough to block a PR. Preview deployments serve the root
// vercel.json headers (no-cache, CSP) rather than production's; the first request to a fresh preview pays a cold edge
// and build-cache warm-up; the readers hit the shared production database, whose load varies; and run-to-run spread in
// these lab runs was roughly ±300 ms on the slower pages (2026-10-19). The deterministic part — initial JS per
// route — is gated by scripts/ci/route-js-budget.mjs. Use this script before and after a performance change.
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'https://nuke.ag';
const RUNS = Number(process.env.RUNS || 3);
const PAGES = [
  ['vehicle (baseline)', '/vehicle/d9d56f37-24dc-4b32-8849-59d1f0b83c6f'],
  ['jobs', '/jobs'],
  ['job K2500', '/jobs/3df0f925-1b79-49b4-9181-fd0f4c6e14ad'],
  ['provider skylar', '/providers/skylar'],
  ['org', '/org/50c4c2f1-3e91-44bb-9600-2168e0037ff4'],
  ['work/setup (signed out)', '/work/setup'],
  ['login', '/login'],
];

const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

async function once(browser, path) {
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 823 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1638400 / 8, uploadThroughput: 750000 / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const rpc = {};
  const jsBytes = { total: 0 };
  page.on('request', r => {
    const m = /\/rest\/v1\/(rpc\/)?([a-z_]+)/.exec(r.url());
    if (m) { const k = (m[1] ? 'rpc:' : 'rest:') + m[2]; rpc[k] = (rpc[k] || 0) + 1; }
  });
  cdp.on('Network.loadingFinished', () => {});
  const sizes = new Map();
  cdp.on('Network.responseReceived', e => { if (e.type === 'Script') sizes.set(e.requestId, 0); });
  cdp.on('Network.loadingFinished', e => { if (sizes.has(e.requestId)) { sizes.set(e.requestId, e.encodedDataLength); } });
  await page.addInitScript(() => {
    window.__lcp = 0; window.__long = []; window.__fcp = 0;
    new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(l => { for (const e of l.getEntries()) window.__long.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true });
    new PerformanceObserver(l => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__fcp = e.startTime; }).observe({ type: 'paint', buffered: true });
  });
  const t0 = Date.now();
  await page.goto(BASE + path, { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(6000);
  const m = await page.evaluate(() => ({ lcp: window.__lcp, fcp: window.__fcp, long: window.__long, url: location.pathname }));
  const tbt = m.long.filter(([s]) => s >= m.fcp).reduce((n, [, d]) => n + Math.max(0, d - 50), 0);
  for (const v of sizes.values()) jsBytes.total += v;
  await ctx.close();
  return { lcp: m.lcp, fcp: m.fcp, tbt, js: jsBytes.total, final: m.url, rpc, wall: Date.now() - t0 };
}

const browser = await chromium.launch();
const out = [];
for (const [name, path] of PAGES) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await once(browser, path));
  const row = { name, path, final: runs[0].final, lcp_ms: Math.round(median(runs.map(r => r.lcp))), fcp_ms: Math.round(median(runs.map(r => r.fcp))),
    tbt_ms: Math.round(median(runs.map(r => r.tbt))), js_kb: Math.round(median(runs.map(r => r.js)) / 1024), rpc: runs[runs.length - 1].rpc };
  out.push(row);
  console.log(JSON.stringify(row));
}
await browser.close();

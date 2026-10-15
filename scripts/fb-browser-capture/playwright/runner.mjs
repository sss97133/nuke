#!/usr/bin/env node
/**
 * Dedicated-browser Marketplace capture. One real Chrome window on its own persistent profile (never the owner's
 * daily profile), logged in once by the owner. Each run views the targeted vehicles page like a person: load, a few
 * slow scrolls, read the rendered cards (same dom.js/classify.js as the extension), write one immutable packet into
 * a local spool. It sends nothing anywhere: the laptop pulls the spool over ssh and lands it through the existing
 * writer, so this machine holds no Nuke keys. Login wall, challenge or rate message => stop and stay stopped.
 *
 *   node runner.mjs --mode probe     first run after login: record URL variants' actual_url/filters/first 20 cards
 *   node runner.mjs --mode search    one targeted pass (launchd, every ~20 min)
 *   node runner.mjs --mode revisit   visit listing pages named in in/revisit.json (new/tier-1 first), read state+detail
 *   node runner.mjs --mode login     open the profile at facebook.com and wait for the owner (no capture)
 * Env: NUKE_FB_HOME (default ~/nuke-fb), NUKE_FB_CHANNEL (default chrome).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readListingPage, revisitCard } from './detail.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ext = path.join(here, '..', 'extension');
const HOME = process.env.NUKE_FB_HOME ?? path.join(os.homedir(), 'nuke-fb');
const dirs = { profile: path.join(HOME, 'profile'), out: path.join(HOME, 'spool', 'out'), inbox: path.join(HOME, 'spool', 'in'), state: path.join(HOME, 'state') };
for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
const args = process.argv.slice(2), mode = args[args.indexOf('--mode') + 1] ?? 'search';

export const BASE = 'https://www.facebook.com/marketplace/category/vehicles/';
export const VARIANTS = {
  bare: '',
  years: '?minYear=1964&maxYear=1991&sortBy=creation_time_descend',
  years_cartruck: '?minYear=1964&maxYear=1991&sortBy=creation_time_descend&topLevelVehicleType=car_truck&exact=false',
  years_cartruck_private: '?minYear=1964&maxYear=1991&sortBy=creation_time_descend&topLevelVehicleType=car_truck&exact=false&sellerType=private',
};
const LIMITS = { maxPassesDay: 48, maxScrolls: 4, maxCycleCards: 200, revisitPerRun: 12, minGapMs: 8000 };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jitter = (lo, hi) => lo + Math.random() * (hi - lo);
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeAtomic = (f, v) => { const t = `${f}.tmp-${process.pid}`; fs.writeFileSync(t, JSON.stringify(v), { mode: 0o600 }); fs.renameSync(t, f); };

function lock() {
  const f = path.join(HOME, 'runner.lock');
  try { fs.writeFileSync(f, String(process.pid), { flag: 'wx' }); }
  catch { const pid = Number(fs.readFileSync(f, 'utf8')); try { process.kill(pid, 0); console.log('runner_already_running'); process.exit(0); } catch { fs.writeFileSync(f, String(process.pid)); } }
  process.on('exit', () => { try { fs.unlinkSync(f); } catch {} });
}
function stopped() {
  const f = path.join(dirs.state, 'STOP.json'); return fs.existsSync(f) ? readJson(f, { reason: 'unknown' }) : null;
}
function halt(reason, detail = {}) {
  writeAtomic(path.join(dirs.state, 'STOP.json'), { reason, at: new Date().toISOString(), ...detail });
  console.error('STOPPED', reason); process.exitCode = 2;
}

// Page-side: dom.js + classify.js are classic scripts; this wraps the same pass the extension makes.
export const pageScripts = ['dom.js', 'classify.js'].map(n => fs.readFileSync(path.join(ext, n), 'utf8')).join('\n;');
export const PASS = `(async (cfg) => {
  const dom = globalThis.NukeMarketplaceDOM, cards = new Map(); let last, scans = 0;
  for (let step = 0; step <= cfg.maxScrolls; step++) {
    last = dom.scan(cfg.maxCards - cards.size, new Set(cards.keys())); scans++;
    for (const c of last.cards) if (!cards.has(c.facebook_id) && cards.size < cfg.maxCards) cards.set(c.facebook_id, c);
    if (cards.size >= cfg.maxCards || step === cfg.maxScrolls) break;
    const m = last.main, within = m.scrollHeight > m.clientHeight && /auto|scroll/.test(getComputedStyle(m).overflowY);
    (within ? m : window).scrollBy({ top: Math.max(500, innerHeight * 0.8), behavior: 'instant' });
    await new Promise(r => setTimeout(r, cfg.pauseMs[step % cfg.pauseMs.length]));
  }
  return { cards: [...cards.values()], last: { actual_url: last.actual_url, actual_region: last.actual_region, observed_at: last.observed_at, displayed_filters: last.displayed_filters }, scans };
})`;

async function challenge(page) {
  const url = page.url();
  if (/\/(login|checkpoint|recover|two_step_verification)/.test(url)) return `url:${new URL(url).pathname}`;
  const text = await page.evaluate(() => [...document.querySelectorAll('[role="alert"],[role="dialog"] h1,[role="dialog"] h2,form[action*="login"]')].map(n => n.innerText || 'login_form').join(' ')).catch(() => '');
  if (/log in|sign in|login_form|checkpoint|captcha|verify (your|you)|temporarily blocked|too many requests|try again later|confirm your identity|restricted/i.test(text)) return `page:${text.slice(0, 80)}`;
  return null;
}

async function viewSearch(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(jitter(3500, 6000));
  const why = await challenge(page); if (why) return { challenge: why };
  await page.evaluate(pageScripts);
  const pass = await page.evaluate(`${PASS}(${JSON.stringify({ maxScrolls: LIMITS.maxScrolls, maxCards: LIMITS.maxCycleCards, pauseMs: [2200, 3100, 2600, 3400, 2900] })})`);
  return { pass };
}

export function buildPackets(pass, targetUrl, classify) {
  const cycleId = randomUUID(), startedAt = pass.last.observed_at, kept = [], rejected = [], tiers = {}, reasons = {};
  for (const card of pass.cards) {
    const v = classify(card);
    if (v.accept) { kept.push(card); tiers[card.facebook_id] = v.tier; continue; }
    for (const r of v.reasons) reasons[r] = (reasons[r] ?? 0) + 1;
    rejected.push({ facebook_id: card.facebook_id, title: card.title, price: card.price ?? null, location: card.location ?? null, reasons: v.reasons });
  }
  kept.sort((a, b) => tiers[a.facebook_id] - tiers[b.facebook_id]);
  const screening = { rule: 'cars_trucks_1964_1991_v1', seen: pass.cards.length, accepted: kept.length, rejected_count: rejected.length, rejected_reasons: reasons, tiers };
  const capture = { target_url: targetUrl, actual_url: pass.last.actual_url, observed_at: pass.last.observed_at, retrieval_surface: 'playwright_rendered_search_cards',
    actual_region: pass.last.actual_region, access_state: 'available', complete: false, source_listed_at: null, source_cycle_id: cycleId, capture_started_at: startedAt,
    capture_finished_at: new Date().toISOString(), displayed_filters: pass.last.displayed_filters, viewport_scans: pass.scans, enumeration_tail: 'unknown', cycle_card_budget: LIMITS.maxCycleCards, screening };
  const packets = [];
  for (let o = 0; o < kept.length; o += 50) packets.push({ mode: 'browser_capture', capture: { ...capture, capture_id: randomUUID(), packet_index: packets.length, ...(packets.length === 0 ? { rejected: rejected.slice(0, 150) } : {}) }, batch: kept.slice(o, o + 50) });
  return { packets, screening, rejected };
}

/** One listing page, read like a person: load, open "See more", step through the photo gallery, read role=main only. */
async function visitListing(page, id) {
  await page.goto(`https://www.facebook.com/marketplace/item/${id}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(jitter(3500, 6500));
  const why = await challenge(page); if (why) return { challenge: why };
  const more = page.getByRole('button', { name: /^see more$/i }).first();
  if (await more.isVisible().catch(() => false)) { await more.click().catch(() => {}); await sleep(jitter(700, 1500)); }
  const read = () => page.evaluate(() => {
    const main = document.querySelector('[role="main"]') ?? document.body;
    const imgs = [...main.querySelectorAll('img')].filter(i => /fbcdn\.net/.test(i.currentSrc || i.src)).map(i => ({ url: i.currentSrc || i.src, width: i.naturalWidth, height: i.naturalHeight }));
    const h1 = [...main.querySelectorAll('h1')].map(n => n.innerText.trim()).find(t => t && !/^(marketplace|notifications)$/i.test(t)) ?? null;
    return { text: main.innerText, title: h1, images: imgs };
  });
  const first = await read(), seen = new Map(first.images.map(i => [i.url, i]));
  const next = page.getByRole('button', { name: /next (photo|image)/i }).first();
  for (let n = 0; n < 30 && await next.isVisible().catch(() => false); n++) {
    await next.click().catch(() => {}); await sleep(jitter(500, 1100));
    for (const i of (await read()).images) { const prior = seen.get(i.url); if (!prior || (i.width ?? 0) > (prior.width ?? 0)) seen.set(i.url, i); }
  }
  return { ...first, images: [...seen.values()], final_url: page.url() };
}

async function revisit(page, nodeClassify) {
  const list = readJson(path.join(dirs.inbox, 'revisit.json'), { ids: [] }).ids.slice(0, LIMITS.revisitPerRun);
  const cards = [], log = [];
  for (const id of list) {
    const r = await visitListing(page, id);
    if (r.challenge) { halt('source_access_challenge', { challenge: r.challenge, during: 'revisit' }); break; }
    const observedAt = new Date().toISOString();
    const parsed = readListingPage(r, observedAt);
    cards.push(revisitCard(id, parsed, r)); log.push({ id, unavailable: parsed.unavailable, status_label: parsed.status_label, photos: parsed.images.length, max_photo_px: Math.max(0, ...parsed.images.map(i => i.width ?? 0)), description_chars: parsed.description?.length ?? 0, seller_type: parsed.seller_type });
    await sleep(jitter(8000, 20000));
  }
  if (cards.length) {
    const now = new Date().toISOString(), cycleId = randomUUID();
    for (let o = 0; o < cards.length; o += 50) {
      const capture_id = randomUUID();
      writeAtomic(path.join(dirs.out, `${capture_id}.json`), { mode: 'browser_capture', capture: { capture_id, observed_at: now, target_url: 'https://www.facebook.com/marketplace/item/', actual_url: 'https://www.facebook.com/marketplace/item/',
        retrieval_surface: 'playwright_rendered_listing_page', actual_region: 'listing page', access_state: 'available', complete: false, source_listed_at: null, source_cycle_id: cycleId, packet_index: o / 50, revisit: true }, batch: cards.slice(o, o + 50) });
    }
    fs.rmSync(path.join(dirs.inbox, 'revisit.json'), { force: true });
  }
  return log;
}

async function openContext() {
  const { chromium } = await import('playwright-core');
  return chromium.launchPersistentContext(dirs.profile, { channel: process.env.NUKE_FB_CHANNEL ?? 'chrome', headless: false, viewport: { width: 1280, height: 900 }, args: ['--no-first-run', '--no-default-browser-check'] });
}

async function main() {
  lock();
  if (mode === 'login') {
    const ctx = await openContext(), page = ctx.pages()[0] ?? await ctx.newPage();
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
    console.log('Log in to Facebook in this window yourself, then close the window.');
    await new Promise(r => ctx.on('close', r)); fs.rmSync(path.join(dirs.state, 'STOP.json'), { force: true }); return;
  }
  const stop = stopped(); if (stop) { console.log('stopped_until_owner_clears', JSON.stringify(stop)); process.exitCode = 2; return; }
  const day = readJson(path.join(dirs.state, 'visits.json'), []).filter(t => Date.now() - t < 86400000);
  if (day.length >= LIMITS.maxPassesDay) { console.log('daily_source_budget'); return; }
  if (mode === 'search' || mode === 'revisit') await sleep(jitter(0, 240000));
  const ctx = await openContext(), page = ctx.pages()[0] ?? await ctx.newPage();
  try {
    const nodeClassify = new Function('globalThis', `${fs.readFileSync(path.join(ext, 'classify.js'), 'utf8')}; return globalThis.NukeClassify.classify;`)({});
    if (mode === 'probe') {
      const report = {};
      for (const [name, query] of Object.entries(VARIANTS)) {
        const r = await viewSearch(page, BASE + query);
        if (r.challenge) { halt('source_access_challenge', { variant: name, challenge: r.challenge }); break; }
        const first = r.pass.cards.slice(0, 20);
        const verdicts = first.map(nodeClassify);
        report[name] = { target: BASE + query, ...r.pass.last, cards_read: r.pass.cards.length,
          first20: first.map((c, i) => ({ id: c.facebook_id, title: c.title, price: c.price ?? null, location: c.location ?? null, accept: verdicts[i].accept, reasons: verdicts[i].reasons })),
          accepted_in_first20: verdicts.filter(v => v.accept).length };
        day.push(Date.now()); await sleep(jitter(60000, 120000));
      }
      // Raw listing-page capture for two accepted cards so the page reader can be checked against retained text.
      const sample = Object.values(report).flatMap(v => v.first20).filter(c => c.accept).slice(0, 2);
      report.detail_samples = [];
      for (const c of (stopped() ? [] : sample)) { const r = await visitListing(page, c.id); report.detail_samples.push(r.challenge ? { id: c.id, challenge: r.challenge } : { id: c.id, parsed: readListingPage(r, new Date().toISOString()), raw_text: r.text.slice(0, 20000), images: r.images }); await sleep(jitter(10000, 20000)); }
      // Keep the variant Facebook actually served the most wanted cards for: params still in the final URL, then most accepted of the first 20, ties to the stricter URL.
      const order = Object.keys(VARIANTS), usable = order.filter(k => report[k] && (k === 'bare' || /minYear=1964/.test(report[k].actual_url ?? '')));
      const best = usable.sort((a, b) => report[b].accepted_in_first20 - report[a].accepted_in_first20 || order.indexOf(b) - order.indexOf(a))[0];
      if (best) { writeAtomic(path.join(dirs.state, 'variant.json'), { name: best, chosen_at: new Date().toISOString(), accepted_in_first20: report[best].accepted_in_first20 }); report.chosen_variant = best; }
      writeAtomic(path.join(dirs.state, `probe-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), report);
      console.log('chosen_variant', report.chosen_variant ?? 'none (kept default years_cartruck)');
      console.log(JSON.stringify(Object.fromEntries(Object.entries(report).filter(([k]) => k in VARIANTS).map(([k, v]) => [k, { actual_url: v.actual_url, filters: v.displayed_filters, accepted_in_first20: v.accepted_in_first20 }])), null, 1));
    } else if (mode === 'revisit') {
      const log = await revisit(page, nodeClassify); day.push(Date.now());
      writeAtomic(path.join(dirs.state, `revisit-${Date.now()}.json`), { at: new Date().toISOString(), log }); console.log(JSON.stringify(log));
    } else if (mode === 'search') {
      const variant = readJson(path.join(dirs.state, 'variant.json'), { name: 'years_cartruck' }).name;
      const target = BASE + (VARIANTS[variant] ?? VARIANTS.years_cartruck);
      const r = await viewSearch(page, target);
      day.push(Date.now());
      if (r.challenge) halt('source_access_challenge', { challenge: r.challenge });
      else {
        const built = buildPackets(r.pass, target, nodeClassify);
        for (const p of built.packets) writeAtomic(path.join(dirs.out, `${p.capture.capture_id}.json`), p);
        writeAtomic(path.join(dirs.state, `cycle-${Date.now()}.json`), { at: new Date().toISOString(), variant, screening: built.screening, packets: built.packets.length });
        console.log(JSON.stringify({ variant, ...built.screening, packets: built.packets.length }));
      }
    }
  } finally { writeAtomic(path.join(dirs.state, 'visits.json'), day); await ctx.close(); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch(e => { console.error(e.message); process.exitCode = 1; });

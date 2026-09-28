#!/usr/bin/env node
/**
 * bat-keep-fresh.mjs — BaT completed-auction sync via the listings-filter API.
 *
 * Default (daily launchd job): pages the completed-auctions feed newest-first
 * and upserts new-or-changed rows into bat_listings (conflict key:
 * bat_listing_url). Stops after CAUGHT_UP_PAGES consecutive clean pages.
 *
 * The unfiltered feed only pages the newest ~10,000 results. Measured
 * 2026-09-24: items_total 264,808, but page 250 (x50) comes back empty — which
 * is why bat-api-save-all.cjs's March "full crawl" saved 3,725 empty pages.
 * --by-year slices the catalog with minimum_year/maximum_year (each model
 * year is its own feed, 1965 = 4,726 results) so every result is reachable.
 * A year over 10,000 results is reported as OVERFLOW (needs a finer slice).
 *
 * --by-year inserts NEW rows only. Existing rows whose status/price differ
 * from BaT's feed are written to <save-dir>/diffs.jsonl for review, never
 * silently overwritten.
 *
 * Lots with no model year (parts, wheels, signs, literature, replicas: 9,301 of
 * 265,275 on 2026-09-26) match no year slice. --by-category slices the catalog
 * by BaT's category ids instead (the results page toolbar's `category` filter).
 * A slice over 10,000 is paged from both ends (sort td = newest first, sort ta
 * = oldest first: page 201 is empty either way), and over 20,000 it is split
 * by auction result (state sold/unsold) first. Every no-year lot BaT files
 * under a category is reachable this way; the pages save under cat-<id>/.
 * --by-category --fresh is the daily top-up: each category newest-first until
 * two pages in a row hold nothing unsaved (~30 requests a day), saved under
 * cat-<id>-<date>/. The unfiltered feed carries no-year lots too, for ~25 days.
 *
 * Downstream: trigger sync_bat_listing_to_vehicle updates a matching vehicles
 * row by bat_auction_url (indexed); the org/profile triggers no-op on rows
 * without vehicle_id / external identities.
 *
 * Usage:
 *   dotenvx run -- node scripts/bat-keep-fresh.mjs                   # daily
 *   dotenvx run -- node scripts/bat-keep-fresh.mjs --max-pages 200 --dry-run
 *   dotenvx run -- node scripts/bat-keep-fresh.mjs --census          # per-year totals only
 *   dotenvx run -- node scripts/bat-keep-fresh.mjs --by-year --save-dir scripts/data/bat-catalog
 *   dotenvx run -- node scripts/bat-keep-fresh.mjs --by-year --year-from 1965 --year-to 1970 --no-db
 *   node scripts/bat-keep-fresh.mjs --by-category --no-db --save-dir scripts/data/bat-catalog
 *   node scripts/bat-keep-fresh.mjs --by-category --category 379,380 --no-db --save-dir scripts/data/bat-catalog
 *   node scripts/bat-keep-fresh.mjs --by-category --fresh --no-db --save-dir scripts/data/bat-catalog   # daily
 *
 * --save-dir keeps every raw feed page on disk; a re-run reuses saved pages
 * instead of refetching (resume), unless --refetch.
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
function getArg(name, def) {
  const idx = args.indexOf(name);
  return idx >= 0 ? parseInt(args[idx + 1]) : def;
}
function getStr(name, def) {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : def;
}
const MAX_PAGES = getArg('--max-pages', 200);
const START_PAGE = getArg('--start-page', 1);
const DELAY_MS = getArg('--delay-ms', 750);
const CAUGHT_UP_PAGES = getArg('--caught-up', 2);
const DRY_RUN = args.includes('--dry-run');
const NO_DB = args.includes('--no-db');
const BY_YEAR = args.includes('--by-year');
const BY_CATEGORY = args.includes('--by-category');
const CENSUS = args.includes('--census');
const REFETCH = args.includes('--refetch');
const FRESH = args.includes('--fresh');
const THIS_YEAR = new Date().getUTCFullYear();
const YEAR_FROM = getArg('--year-from', 1885);
const YEAR_TO = getArg('--year-to', THIS_YEAR + 1);
const SAVE_DIR = getStr('--save-dir', null);
const FEED_CAP = 10000; // page 201 (x50) is empty for any query and either sort: measured 2026-09-26
const PER_PAGE = 50;

// BaT's listing categories: ids from the results page's toolbar config
// (BAT_MODEL_LISTINGS_COMPLETED_TOOLBAR.categories, read 2026-09-26). --category 379,380 picks a subset.
const CATEGORIES = {
  543: 'Aircraft', 431: 'All-Terrain Vehicles', 383: 'Boats', 415: 'Charity & Non-Profit', 434: 'Convertibles',
  426: 'Electric Vehicles', 428: 'Go-Karts', 429: 'Hot Rods', 556: 'Kei Vehicles', 447: 'Military Vehicles',
  430: 'Minibikes & Scooters', 70: 'Motorcycles', 379: 'Parts', 10: 'Projects', 11: 'Race Cars',
  557: 'Right-Hand Drive', 436: 'RVs & Campers', 479: 'Service Vehicles', 553: 'Side-by-Sides',
  433: 'Station Wagons', 432: 'Tractors', 544: 'Trains', 21: 'Truck & 4x4', 418: 'Vans', 380: 'Wheels',
};
const CATEGORY_IDS = (getStr('--category', '') || Object.keys(CATEGORIES).join(','))
  .split(',').map((s) => parseInt(s)).filter(Boolean);

// --no-db runs without credentials (local catalog pulls need none).
const supabase = NO_DB ? null : createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const API = 'https://bringatrailer.com/wp-json/bringatrailer/1.0/data/listings-filter';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decodeEntities(s) {
  return (s || '')
    .replace(/&#8220;|&#8221;/g, '"').replace(/&#8216;|&#8217;/g, "'")
    .replace(/&#8211;/g, '–').replace(/&#8212;/g, '—')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
}

async function fetchPageOnce(page, filter, perPage) {
  const resp = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ page, per_page: perPage, get_items: 1, get_stats: 0, include_s: '', sort: 'td', ...filter }),
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) {
    const err = new Error(`HTTP ${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

// Backs off on 429/5xx/network errors: 5s, 20s, 60s. Other 4xx fail fast.
async function fetchPage(page, filter = {}, perPage = 50) {
  const waits = [5000, 20000, 60000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchPageOnce(page, filter, perPage);
    } catch (e) {
      const clientError = e.status >= 400 && e.status < 500 && e.status !== 429;
      if (clientError || attempt >= waits.length) throw e;
      console.log(`  page ${page} ${JSON.stringify(filter)}: ${e.message}, retry in ${waits[attempt] / 1000}s`);
      await sleep(waits[attempt]);
    }
  }
}

function toRow(item) {
  const ts = item.sold_text_timestamp || item.timestamp_end;
  const endDate = ts ? new Date(ts * 1000).toISOString().slice(0, 10) : null;
  const sold = (item.sold_text || '').includes('Sold for');
  const { country_flag, ...raw } = item;
  return {
    bat_listing_url: item.url,
    bat_listing_title: decodeEntities(item.title),
    final_bid: item.current_bid || null,
    sale_price: sold ? item.current_bid || null : null,
    auction_end_date: endDate,
    sale_date: sold ? endDate : null,
    listing_status: sold ? 'sold' : item.active ? 'active' : 'ended',
    scraped_at: new Date().toISOString(),
    raw_data: raw,
  };
}

function differs(existing, row) {
  return existing.listing_status !== row.listing_status
    || existing.sale_price !== row.sale_price
    || existing.final_bid !== row.final_bid;
}

// Dedup a page of feed items against bat_listings and write. insertOnly=true
// writes only unseen URLs and returns the would-be updates as diffs.
async function processItems(items, { insertOnly }) {
  const rows = items.map(toRow);
  if (NO_DB) return { nNew: 0, nChanged: 0, diffs: [] };
  const urls = rows.map((r) => r.bat_listing_url);
  const { data: existing, error: selErr } = await supabase
    .from('bat_listings')
    .select('bat_listing_url, listing_status, sale_price, final_bid')
    .in('bat_listing_url', urls);
  if (selErr) throw new Error(`select failed: ${selErr.message}`);

  const byUrl = new Map((existing || []).map((e) => [e.bat_listing_url, e]));
  const fresh = rows.filter((r) => !byUrl.has(r.bat_listing_url));
  const changed = rows.filter((r) => byUrl.has(r.bat_listing_url) && differs(byUrl.get(r.bat_listing_url), r));
  const toWrite = insertOnly ? fresh : fresh.concat(changed);

  if (toWrite.length && !DRY_RUN) {
    const { error } = await supabase.from('bat_listings').upsert(toWrite, { onConflict: 'bat_listing_url' });
    if (error) throw new Error(`upsert failed: ${error.message}`);
  }
  const diffs = insertOnly
    ? changed.map((r) => {
      const e = byUrl.get(r.bat_listing_url);
      return {
        url: r.bat_listing_url,
        db: { listing_status: e.listing_status, sale_price: e.sale_price, final_bid: e.final_bid },
        feed: { listing_status: r.listing_status, sale_price: r.sale_price, final_bid: r.final_bid },
      };
    })
    : [];
  return { nNew: fresh.length, nChanged: changed.length, diffs };
}

function savedPagePath(key, page) {
  return SAVE_DIR ? path.join(SAVE_DIR, key, `p${page}.json`) : null;
}

// Fetch a feed page, or reuse the saved copy (resume) unless --refetch.
async function getPage(key, page, filter) {
  const file = savedPagePath(key, page);
  if (file && !REFETCH && fs.existsSync(file)) {
    return { ...JSON.parse(fs.readFileSync(file, 'utf8')), fromDisk: true };
  }
  const data = await fetchPage(page, filter);
  if (file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
      fetched_at: new Date().toISOString(), filter, page,
      items_total: data.items_total, pages_total: data.pages_total, items: data.items || [],
    }));
  }
  return data;
}

async function census() {
  const all = await fetchPage(1, {});
  console.log(`catalog items_total (unfiltered): ${all.items_total}`);
  let sum = 0;
  const overflow = [];
  const rows = [];
  for (let y = YEAR_TO; y >= YEAR_FROM; y--) {
    const d = await fetchPage(1, { minimum_year: y, maximum_year: y });
    const n = d.items_total || 0;
    sum += n;
    if (n) rows.push(`${y}:${n}`);
    if (n > FEED_CAP) overflow.push(`${y}:${n}`);
    await sleep(DELAY_MS);
  }
  console.log(rows.join(' '));
  console.log(`sum of year slices ${YEAR_FROM}-${YEAR_TO}: ${sum} of ${all.items_total} (${(100 * sum / all.items_total).toFixed(2)}%)`);
  console.log(`years over ${FEED_CAP} (need a finer slice): ${overflow.length ? overflow.join(' ') : 'none'}`);
}

async function byYear() {
  const diffsFile = SAVE_DIR ? path.join(SAVE_DIR, 'diffs.jsonl') : null;
  if (SAVE_DIR) fs.mkdirSync(SAVE_DIR, { recursive: true });
  const seen = new Set();
  let totalNew = 0, totalChanged = 0, expected = 0;
  const overflow = [];

  for (let y = YEAR_TO; y >= YEAR_FROM; y--) {
    const filter = { minimum_year: y, maximum_year: y };
    const first = await getPage(`y${y}`, 1, filter);
    const total = first.items_total || 0;
    if (!total) { if (!first.fromDisk) await sleep(DELAY_MS); continue; }
    expected += total;
    if (total > FEED_CAP) overflow.push(`${y}:${total}`);
    const pages = Math.min(first.pages_total || 1, MAX_PAGES);
    let yNew = 0, yChanged = 0, ySeen = 0;

    for (let page = 1; page <= pages; page++) {
      const data = page === 1 ? first : await getPage(`y${y}`, page, filter);
      const items = (data.items || []).filter((i) => i.url);
      if (!items.length) break;
      items.forEach((i) => seen.add(i.url));
      ySeen += items.length;
      const { nNew, nChanged, diffs } = await processItems(items, { insertOnly: true });
      yNew += nNew; yChanged += nChanged;
      if (diffsFile && diffs.length) fs.appendFileSync(diffsFile, diffs.map((d) => JSON.stringify(d)).join('\n') + '\n');
      if (!data.fromDisk) await sleep(DELAY_MS);
    }
    totalNew += yNew; totalChanged += yChanged;
    console.log(`${y}: ${ySeen}/${total} feed items, ${yNew} new${NO_DB ? '' : ' (inserted)'}, ${yChanged} differ from db | unique so far ${seen.size}`);
  }

  console.log(`[${new Date().toISOString()}] by-year done: ${seen.size} unique URLs seen of ${expected} expected across years; ${totalNew} new${DRY_RUN || NO_DB ? ' (not written)' : ' inserted'}; ${totalChanged} differing rows${diffsFile ? ` logged to ${diffsFile}` : ''}`);
  console.log(`years over ${FEED_CAP} (partially reachable, need a finer slice): ${overflow.length ? overflow.join(' ') : 'none'}`);
}

// Every URL already saved under <save-dir> (except keys matching `skip`) — the baseline a pull is measured against.
function savedUrls(skip = null) {
  const urls = new Set();
  if (!SAVE_DIR || !fs.existsSync(SAVE_DIR)) return urls;
  for (const key of fs.readdirSync(SAVE_DIR)) {
    if ((skip && skip.test(key)) || !fs.statSync(path.join(SAVE_DIR, key)).isDirectory()) continue;
    for (const f of fs.readdirSync(path.join(SAVE_DIR, key))) {
      if (!/^p\d+\.json$/.test(f)) continue;
      for (const it of JSON.parse(fs.readFileSync(path.join(SAVE_DIR, key, f), 'utf8')).items || []) if (it.url) urls.add(it.url);
    }
  }
  return urls;
}

// Page one filter to the end and return its URLs. Over FEED_CAP the query is paged from both ends
// (td newest-first to page 200, then ta oldest-first for the remainder, +2 pages of overlap for ties
// at the boundary); over 2*FEED_CAP it is split by auction result first. Beyond that: OVERFLOW.
async function pullSlice(key, filter, urls, overflow) {
  const first = await getPage(key, 1, filter);
  const total = first.items_total || 0;
  if (!total) { if (!first.fromDisk) await sleep(DELAY_MS); return total; }
  if (total > 2 * FEED_CAP) {
    if (filter.state) { overflow.push(`${key}:${total}`); }
    else {
      await pullSlice(`${key}-sold`, { ...filter, state: 'sold' }, urls, overflow);
      await pullSlice(`${key}-unsold`, { ...filter, state: 'unsold' }, urls, overflow);
    }
    return total;
  }
  const pagesTotal = first.pages_total || Math.ceil(total / PER_PAGE);
  const passes = [[key, filter, Math.min(pagesTotal, FEED_CAP / PER_PAGE)]];
  if (total > FEED_CAP) passes.push([`${key}-ta`, { ...filter, sort: 'ta' }, pagesTotal - FEED_CAP / PER_PAGE + 2]);
  for (const [k, f, pages] of passes) {
    for (let page = 1; page <= pages; page++) {
      const data = page === 1 && k === key ? first : await getPage(k, page, f);
      const items = (data.items || []).filter((i) => i.url);
      if (!items.length) break;
      items.forEach((i) => urls.add(i.url));
      await processItems(items, { insertOnly: true });
      if (!data.fromDisk) await sleep(DELAY_MS);
    }
  }
  return total;
}

// --by-category --fresh: the daily top-up. Each category newest-first until CAUGHT_UP_PAGES consecutive
// pages hold no unsaved URL; pages save under cat-<id>-<date>/ so the full slices are never overwritten.
// ~1 request per category per day: a no-year lot shows up here the day it closes.
async function freshCategories() {
  const known = savedUrls();
  const day = new Date().toISOString().slice(0, 10);
  let totalNew = 0, requests = 0;
  for (const id of CATEGORY_IDS) {
    let streak = 0, n = 0;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const data = await getPage(`cat-${id}-${day}`, page, { category: [id] });
      const items = (data.items || []).filter((i) => i.url);
      if (!items.length) break;
      const fresh = items.filter((i) => !known.has(i.url));
      fresh.forEach((i) => known.add(i.url));
      n += fresh.length;
      await processItems(items, { insertOnly: true });
      streak = fresh.length ? 0 : streak + 1;
      if (!data.fromDisk) { requests++; await sleep(DELAY_MS); }
      if (streak >= CAUGHT_UP_PAGES) break;
    }
    totalNew += n;
    if (n) console.log(`${CATEGORIES[id] || id} (${id}): ${n} new`);
  }
  console.log(`[${new Date().toISOString()}] by-category fresh done: ${totalNew} lots not saved before, ${requests} requests, ${known.size} URLs saved in all`);
}

async function byCategory() {
  if (SAVE_DIR) fs.mkdirSync(SAVE_DIR, { recursive: true });
  if (FRESH) return freshCategories();
  const known = savedUrls(/^cat-/);
  console.log(`baseline: ${known.size} URLs saved under year/feed slices`);
  const seen = new Set();
  const overflow = [];
  let expected = 0;
  for (const id of CATEGORY_IDS) {
    const urls = new Set();
    const total = await pullSlice(`cat-${id}`, { category: [id] }, urls, overflow);
    expected += total;
    const recovered = [...urls].filter((u) => !known.has(u) && !seen.has(u)).length;
    urls.forEach((u) => seen.add(u));
    console.log(`${CATEGORIES[id] || id} (${id}): ${urls.size}/${total} reached, ${recovered} not in any year/feed slice | recovered so far ${[...seen].filter((u) => !known.has(u)).length}`);
  }
  const recovered = [...seen].filter((u) => !known.has(u)).length;
  console.log(`[${new Date().toISOString()}] by-category done: ${seen.size} unique URLs across ${CATEGORY_IDS.length} categories (${expected} category memberships); ${recovered} lots not in any year/feed slice${NO_DB ? '' : ' (new rows inserted)'}`);
  console.log(`slices over ${2 * FEED_CAP} even split by result (partially reachable): ${overflow.length ? overflow.join(' ') : 'none'}`);
}

async function daily() {
  let totalNew = 0, totalChanged = 0, caughtUpStreak = 0;
  const key = `feed-${new Date().toISOString().slice(0, 10)}`;

  for (let page = START_PAGE; page <= MAX_PAGES; page++) {
    let data;
    try {
      data = await getPage(key, page, {});
    } catch (e) {
      console.log(`page ${page}: failed after retries (${e.message}), stopping.`);
      break;
    }
    const items = (data.items || []).filter((i) => i.url);
    if (!items.length) break;

    const { nNew, nChanged } = await processItems(items, { insertOnly: false });
    totalNew += nNew;
    totalChanged += nChanged;
    console.log(`page ${page}: ${items.length} items, ${nNew} new, ${nChanged} changed`);

    caughtUpStreak = nNew + nChanged === 0 ? caughtUpStreak + 1 : 0;
    if (caughtUpStreak >= CAUGHT_UP_PAGES) {
      console.log(`caught up (${CAUGHT_UP_PAGES} clean pages).`);
      break;
    }
    if (!data.fromDisk) await sleep(DELAY_MS);
  }

  console.log(`[${new Date().toISOString()}] done: ${totalNew} new, ${totalChanged} changed${DRY_RUN ? ' (dry run, no writes)' : ''}`);
}

async function main() {
  const mode = CENSUS ? 'census' : BY_YEAR ? `by-year ${YEAR_FROM}-${YEAR_TO}`
    : BY_CATEGORY ? `by-category${FRESH ? ' fresh' : ''} ${CATEGORY_IDS.join(',')}` : `daily (max ${MAX_PAGES} pages)`;
  console.log(`[${new Date().toISOString()}] bat-keep-fresh ${mode}${DRY_RUN ? ', DRY RUN' : ''}${NO_DB ? ', NO DB' : ''}${SAVE_DIR ? `, saving to ${SAVE_DIR}` : ''}`);
  if (CENSUS) return census();
  if (BY_YEAR) return byYear();
  if (BY_CATEGORY) return byCategory();
  return daily();
}

main().catch((e) => { console.error(e); process.exit(1); });

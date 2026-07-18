#!/usr/bin/env node
/**
 * bat-keep-fresh.mjs — Daily BaT freshness sync via the listings-filter API.
 *
 * Pages the completed-auctions feed newest-first and upserts into bat_listings
 * (conflict key: bat_listing_url). Downstream sync triggers on bat_listings
 * propagate to vehicles / organization_vehicles / profile queue.
 *
 * Run-til-done: stops after CAUGHT_UP_PAGES consecutive pages with zero
 * new-or-changed rows, so a daily run touches ~1-3 pages and a month-long
 * gap self-heals by paging deeper. The API serves ~200 pages (~10K items);
 * gaps older than that need bat-full-discovery.mjs instead.
 *
 * Usage:
 *   dotenvx run -- node scripts/bat-keep-fresh.mjs
 *   dotenvx run -- node scripts/bat-keep-fresh.mjs --max-pages 200 --dry-run
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const args = process.argv.slice(2);
function getArg(name, def) {
  const idx = args.indexOf(name);
  return idx >= 0 ? parseInt(args[idx + 1]) : def;
}
const MAX_PAGES = getArg('--max-pages', 200);
const START_PAGE = getArg('--start-page', 1);
const DELAY_MS = getArg('--delay-ms', 750);
const CAUGHT_UP_PAGES = getArg('--caught-up', 2);
const DRY_RUN = args.includes('--dry-run');

const API = 'https://bringatrailer.com/wp-json/bringatrailer/1.0/data/listings-filter';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decodeEntities(s) {
  return (s || '')
    .replace(/&#8220;|&#8221;/g, '"').replace(/&#8216;|&#8217;/g, "'")
    .replace(/&#8211;/g, '–').replace(/&#8212;/g, '—')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
}

async function fetchPage(page) {
  const resp = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ page, per_page: 50, get_items: 1, get_stats: 0, include_s: '', sort: 'td' }),
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
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

async function main() {
  console.log(`[${new Date().toISOString()}] bat-keep-fresh start (max ${MAX_PAGES} pages${DRY_RUN ? ', DRY RUN' : ''})`);
  let totalNew = 0, totalChanged = 0, caughtUpStreak = 0;

  for (let page = START_PAGE; page <= MAX_PAGES; page++) {
    let data;
    try {
      data = await fetchPage(page);
    } catch (e) {
      console.log(`page ${page}: fetch failed (${e.message}), retrying once...`);
      await sleep(3000);
      try { data = await fetchPage(page); } catch (e2) {
        console.log(`page ${page}: failed twice (${e2.message}), stopping.`);
        break;
      }
    }
    const items = (data.items || []).filter((i) => i.url);
    if (!items.length) break;

    const rows = items.map(toRow);
    const urls = rows.map((r) => r.bat_listing_url);
    const { data: existing, error: selErr } = await supabase
      .from('bat_listings')
      .select('bat_listing_url, listing_status, sale_price, final_bid')
      .in('bat_listing_url', urls);
    if (selErr) throw new Error(`select failed: ${selErr.message}`);

    const byUrl = new Map((existing || []).map((e) => [e.bat_listing_url, e]));
    const fresh = rows.filter((r) => {
      const e = byUrl.get(r.bat_listing_url);
      if (!e) return true;
      return e.listing_status !== r.listing_status || e.sale_price !== r.sale_price || e.final_bid !== r.final_bid;
    });
    const nNew = fresh.filter((r) => !byUrl.has(r.bat_listing_url)).length;
    const nChanged = fresh.length - nNew;

    if (fresh.length && !DRY_RUN) {
      const { error } = await supabase.from('bat_listings').upsert(fresh, { onConflict: 'bat_listing_url' });
      if (error) throw new Error(`upsert failed: ${error.message}`);
    }
    totalNew += nNew;
    totalChanged += nChanged;
    console.log(`page ${page}: ${items.length} items, ${nNew} new, ${nChanged} changed`);

    caughtUpStreak = fresh.length === 0 ? caughtUpStreak + 1 : 0;
    if (caughtUpStreak >= CAUGHT_UP_PAGES) {
      console.log(`caught up (${CAUGHT_UP_PAGES} clean pages).`);
      break;
    }
    await sleep(DELAY_MS);
  }

  console.log(`[${new Date().toISOString()}] done: ${totalNew} new, ${totalChanged} changed${DRY_RUN ? ' (dry run, no writes)' : ''}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

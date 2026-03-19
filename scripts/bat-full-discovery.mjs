#!/usr/bin/env node
/**
 * bat-full-discovery.mjs — Crawl ALL BaT results pages to discover every listing URL.
 *
 * BaT has ~233K listings across ~5,300 results pages (44 per page).
 * We have ~155K URLs. This script crawls the remaining ~5,000 pages.
 *
 * Usage:
 *   dotenvx run -- node scripts/bat-full-discovery.mjs --start 1 --end 5400
 *   dotenvx run -- node scripts/bat-full-discovery.mjs --start 1 --end 5400 --dry-run
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const LISTING_RE = /href="(https:\/\/bringatrailer\.com\/listing\/[a-z0-9][a-z0-9-]*)\/?"/gi;
const BAD_PATTERNS = [/\/contact$/, /\/embed$/, /\.js$/, /\.css$/, /\.png$/, /\.jpg$/, /\.jpeg$/, /\.gif$/, /\.svg$/, /\.webp$/, /%22/, /%5C/, /&quot;/, /&amp;/, /\\"$/, /",$/];

function isValidListingUrl(url) {
  const clean = url.replace(/\/$/, '');
  if (!/^https:\/\/bringatrailer\.com\/listing\/[a-z0-9-]+$/i.test(clean)) return false;
  for (const p of BAD_PATTERNS) { if (p.test(clean)) return false; }
  return true;
}

async function scrapePage(page) {
  const url = `https://bringatrailer.com/auctions/results/?page=${page}`;
  const resp = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "text/html", "Accept-Language": "en-US,en;q=0.9" },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const html = await resp.text();
  const urls = new Set();
  let m;
  while ((m = LISTING_RE.exec(html)) !== null) {
    const u = m[1].replace(/\/$/, '');
    if (isValidListingUrl(u)) urls.add(u);
  }
  return Array.from(urls);
}

async function main() {
  const args = process.argv.slice(2);
  const startPage = parseInt(args[args.indexOf('--start') + 1] || '1');
  const endPage = parseInt(args[args.indexOf('--end') + 1] || '5400');
  const dryRun = args.includes('--dry-run');
  const concurrency = parseInt(args[args.indexOf('--concurrency') + 1] || '3');
  const delayMs = parseInt(args[args.indexOf('--delay') + 1] || '500');

  console.log(`BaT Full Discovery: pages ${startPage}-${endPage}, concurrency=${concurrency}, delay=${delayMs}ms${dryRun ? ' [DRY RUN]' : ''}`);

  // Load ALL known BaT URLs using paginated fetches (1000 per page, Supabase default)
  console.log('Loading known URLs...');
  const known = new Set();

  async function loadAll(table, column, filter) {
    let offset = 0;
    let total = 0;
    while (true) {
      let q = supabase.from(table).select(column).range(offset, offset + 999);
      if (filter) q = filter(q);
      const { data, error } = await q;
      if (error) { console.error(`  Error loading ${table}: ${error.message}`); break; }
      if (!data || data.length === 0) break;
      for (const r of data) {
        const val = r[column.split(',')[0].trim()];
        if (val) known.add(val.replace(/\/$/, ''));
      }
      total += data.length;
      offset += data.length;
      if (data.length < 1000) break;
    }
    return total;
  }

  const q1 = await loadAll('bat_extraction_queue', 'bat_url');
  console.log(`  ${q1} rows from bat_extraction_queue (${known.size} unique)`);

  const q2 = await loadAll('vehicles', 'bat_auction_url', q => q.not('bat_auction_url', 'is', null));
  console.log(`  ${q2} rows from vehicles.bat_auction_url (${known.size} unique)`);

  const q3 = await loadAll('bat_listings', 'bat_listing_url');
  console.log(`  ${q3} rows from bat_listings (${known.size} unique)`);

  console.log(`${known.size} URLs already known`);

  let totalFound = 0;
  let totalNew = 0;
  let totalQueued = 0;
  let emptyPages = 0;
  let errors = 0;
  const newUrls = [];

  for (let page = startPage; page <= endPage; page += concurrency) {
    const batch = [];
    for (let i = 0; i < concurrency && page + i <= endPage; i++) {
      batch.push(page + i);
    }

    const results = await Promise.allSettled(batch.map(p => scrapePage(p)));

    for (let i = 0; i < results.length; i++) {
      const p = batch[i];
      const result = results[i];

      if (result.status === 'rejected') {
        errors++;
        if (errors > 20) { console.log('Too many errors, stopping.'); process.exit(1); }
        continue;
      }

      const urls = result.value;
      totalFound += urls.length;

      if (urls.length === 0) {
        emptyPages++;
        if (emptyPages >= 5) {
          console.log(`\n${emptyPages} consecutive empty pages at page ${p}. End of results.`);
          // Flush remaining
          if (newUrls.length > 0 && !dryRun) await flushBatch(newUrls.splice(0));
          console.log(`\nDONE: Found ${totalFound} URLs, ${totalNew} new, ${totalQueued} queued, ${errors} errors`);
          process.exit(0);
        }
        continue;
      }
      emptyPages = 0;

      for (const url of urls) {
        if (!known.has(url)) {
          totalNew++;
          known.add(url);
          newUrls.push(url);
        }
      }

      // Flush in batches of 200
      if (newUrls.length >= 200 && !dryRun) {
        const batch = newUrls.splice(0, 200);
        const queued = await flushBatch(batch);
        totalQueued += queued;
      }
    }

    if ((page - startPage) % 100 < concurrency) {
      const pct = ((page - startPage) / (endPage - startPage) * 100).toFixed(1);
      console.log(`  page ${page}/${endPage} (${pct}%) — found: ${totalFound}, new: ${totalNew}, queued: ${totalQueued}, errors: ${errors}`);
    }

    await new Promise(r => setTimeout(r, delayMs));
  }

  // Flush remaining
  if (newUrls.length > 0 && !dryRun) {
    totalQueued += await flushBatch(newUrls);
  }

  console.log(`\nDONE: Found ${totalFound} URLs, ${totalNew} new, ${totalQueued} queued, ${errors} errors`);
}

async function flushBatch(urls) {
  if (!urls.length) return 0;

  // Insert into bat_extraction_queue (creates vehicle on extraction)
  const records = urls.map(url => ({
    bat_url: url,
    status: 'pending',
    priority: 5,
    created_at: new Date().toISOString(),
  }));

  let queued = 0;
  // Batch insert, skip duplicates
  for (let i = 0; i < records.length; i += 50) {
    const chunk = records.slice(i, i + 50);
    const { error } = await supabase
      .from('bat_extraction_queue')
      .upsert(chunk, { onConflict: 'bat_url', ignoreDuplicates: true });
    if (!error) queued += chunk.length;
  }
  return queued;
}

main().catch(e => { console.error(e); process.exit(1); });

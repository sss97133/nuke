#!/usr/bin/env node
/**
 * bat-models-discovery.mjs — Discover ALL BaT listing URLs via their REST API.
 *
 * Uses the undocumented BaT REST endpoint:
 *   /wp-json/bringatrailer/1.0/data/listings-filter?page=N&per_page=36&get_items=1&sort=td
 *
 * BaT has ~234,943 completed auction listings across ~6,527 pages (36 per page).
 * This script crawls all pages, deduplicates against the database, and queues new URLs.
 *
 * Rate limit: BaT returns 429 if called too fast. Default delay is 2s per request.
 * At 2s/request and 6527 pages, full crawl takes ~3.5 hours.
 *
 * Usage:
 *   dotenvx run -- node scripts/bat-models-discovery.mjs
 *   dotenvx run -- node scripts/bat-models-discovery.mjs --start 1 --end 6527
 *   dotenvx run -- node scripts/bat-models-discovery.mjs --dry-run
 *   dotenvx run -- node scripts/bat-models-discovery.mjs --delay 3000  # slower for safety
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const API_BASE = "https://bringatrailer.com/wp-json/bringatrailer/1.0/data/listings-filter";
const PER_PAGE = 36;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchPage(page, retries = 3) {
  const url = `${API_BASE}?page=${page}&per_page=${PER_PAGE}&get_items=1&get_stats=0&sort=td`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(20000),
      });

      if (resp.status === 429) {
        const waitSec = attempt * 10;
        console.log(`  Rate limited on page ${page}, waiting ${waitSec}s (attempt ${attempt}/${retries})`);
        await sleep(waitSec * 1000);
        continue;
      }

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const data = await resp.json();

      if (!data.items || !Array.isArray(data.items)) {
        if (attempt < retries) {
          await sleep(3000);
          continue;
        }
        return { items: [], total: data.items_total || 0, pages: data.pages_total || 0, rateLimited: false };
      }

      return {
        items: data.items,
        total: data.items_total || 0,
        pages: data.pages_total || 0,
        rateLimited: false,
      };
    } catch (err) {
      if (attempt < retries) {
        await sleep(2000 * attempt);
        continue;
      }
      throw err;
    }
  }

  // If all retries were rate-limited, signal that
  return { items: [], total: 0, pages: 0, rateLimited: true };
}

async function loadKnownUrls() {
  console.log('Loading known BaT URLs from database...');
  const known = new Set();

  // Load from vehicles.bat_auction_url
  let offset = 0;
  let loaded = 0;
  while (true) {
    const { data, error } = await supabase
      .from('vehicles')
      .select('bat_auction_url')
      .not('bat_auction_url', 'is', null)
      .range(offset, offset + 999);
    if (error) { console.error(`  Error: ${error.message}`); break; }
    if (!data || data.length === 0) break;
    for (const r of data) {
      if (r.bat_auction_url) known.add(r.bat_auction_url.replace(/\/$/, ''));
    }
    loaded += data.length;
    offset += data.length;
    if (data.length < 1000) break;
  }
  console.log(`  Loaded ${loaded} from vehicles.bat_auction_url (${known.size} unique)`);

  // Load from bat_extraction_queue
  offset = 0;
  loaded = 0;
  while (true) {
    const { data, error } = await supabase
      .from('bat_extraction_queue')
      .select('bat_url')
      .range(offset, offset + 999);
    if (error) { console.error(`  Error: ${error.message}`); break; }
    if (!data || data.length === 0) break;
    for (const r of data) {
      if (r.bat_url) known.add(r.bat_url.replace(/\/$/, ''));
    }
    loaded += data.length;
    offset += data.length;
    if (data.length < 1000) break;
  }
  console.log(`  Loaded ${loaded} from bat_extraction_queue (${known.size} total unique)`);

  // Load from vehicles.listing_url (BaT ones)
  offset = 0;
  loaded = 0;
  while (true) {
    const { data, error } = await supabase
      .from('vehicles')
      .select('listing_url')
      .not('listing_url', 'is', null)
      .ilike('listing_url', '%bringatrailer%')
      .range(offset, offset + 999);
    if (error) { console.error(`  Error: ${error.message}`); break; }
    if (!data || data.length === 0) break;
    for (const r of data) {
      if (r.listing_url) known.add(r.listing_url.replace(/\/$/, ''));
    }
    loaded += data.length;
    offset += data.length;
    if (data.length < 1000) break;
  }
  console.log(`  Loaded ${loaded} from vehicles.listing_url (${known.size} total unique)`);

  // Load from vehicles.discovery_url (BaT ones)
  offset = 0;
  loaded = 0;
  while (true) {
    const { data, error } = await supabase
      .from('vehicles')
      .select('discovery_url')
      .not('discovery_url', 'is', null)
      .ilike('discovery_url', '%bringatrailer%')
      .range(offset, offset + 999);
    if (error) { console.error(`  Error: ${error.message}`); break; }
    if (!data || data.length === 0) break;
    for (const r of data) {
      if (r.discovery_url) known.add(r.discovery_url.replace(/\/$/, ''));
    }
    loaded += data.length;
    offset += data.length;
    if (data.length < 1000) break;
  }
  console.log(`  Loaded ${loaded} from vehicles.discovery_url (${known.size} total unique)`);

  // Load from vehicle_events.source_url (BaT ones)
  offset = 0;
  loaded = 0;
  while (true) {
    const { data, error } = await supabase
      .from('vehicle_events')
      .select('source_url')
      .not('source_url', 'is', null)
      .ilike('source_url', '%bringatrailer%')
      .range(offset, offset + 999);
    if (error) { console.error(`  Error: ${error.message}`); break; }
    if (!data || data.length === 0) break;
    for (const r of data) {
      if (r.source_url) known.add(r.source_url.replace(/\/$/, ''));
    }
    loaded += data.length;
    offset += data.length;
    if (data.length < 1000) break;
  }
  console.log(`  Loaded ${loaded} from vehicle_events.source_url (${known.size} total unique)`);

  // Load from import_queue (BaT ones)
  offset = 0;
  loaded = 0;
  while (true) {
    const { data, error } = await supabase
      .from('import_queue')
      .select('listing_url')
      .not('listing_url', 'is', null)
      .ilike('listing_url', '%bringatrailer%')
      .range(offset, offset + 999);
    if (error) { console.error(`  Error: ${error.message}`); break; }
    if (!data || data.length === 0) break;
    for (const r of data) {
      if (r.listing_url) known.add(r.listing_url.replace(/\/$/, ''));
    }
    loaded += data.length;
    offset += data.length;
    if (data.length < 1000) break;
  }
  console.log(`  Loaded ${loaded} from import_queue (${known.size} total unique)`);

  return known;
}

function isValidListingUrl(url) {
  if (!url) return false;
  const clean = url.replace(/\/$/, '');
  return /^https:\/\/bringatrailer\.com\/listing\/[a-z0-9][a-z0-9-]+$/i.test(clean);
}

async function flushBatch(urls, dryRun) {
  if (!urls.length || dryRun) return 0;

  // First, check which URLs already exist in bat_extraction_queue
  const urlsToCheck = urls.map(u => u.replace(/\/$/, ''));
  const existingUrls = new Set();

  for (let i = 0; i < urlsToCheck.length; i += 50) {
    const chunk = urlsToCheck.slice(i, i + 50);
    const { data } = await supabase
      .from('bat_extraction_queue')
      .select('bat_url')
      .in('bat_url', chunk);
    if (data) {
      for (const r of data) existingUrls.add(r.bat_url);
    }
  }

  // Only insert URLs that don't exist yet
  const newUrls = urlsToCheck.filter(u => !existingUrls.has(u));
  if (!newUrls.length) return 0;

  const now = new Date().toISOString();
  let queued = 0;
  for (let i = 0; i < newUrls.length; i += 50) {
    const chunk = newUrls.slice(i, i + 50).map(url => ({
      bat_url: url,
      status: 'pending',
      priority: 5,
      created_at: now,
      updated_at: now,
      attempts: 0,
    }));
    const { error } = await supabase
      .from('bat_extraction_queue')
      .insert(chunk);
    if (!error) {
      queued += chunk.length;
    } else {
      console.error(`  Queue insert error: ${error.message}`);
      // Try one by one for the failing batch
      for (const record of chunk) {
        const { error: singleError } = await supabase
          .from('bat_extraction_queue')
          .insert([record]);
        if (!singleError) queued++;
      }
    }
  }
  return queued;
}

async function main() {
  const args = process.argv.slice(2);
  const startPage = parseInt(args[args.indexOf('--start') + 1]) || 1;
  let endPage = parseInt(args[args.indexOf('--end') + 1]) || 0;
  const dryRun = args.includes('--dry-run');
  const delayMs = parseInt(args[args.indexOf('--delay') + 1]) || 2000;
  const checkpointFile = '/tmp/bat-discovery-checkpoint.json';

  console.log('==========================================================');
  console.log('  BaT MODELS DISCOVERY — REST API Crawler');
  console.log('==========================================================\n');

  // Step 1: Get total pages if not specified
  if (!endPage) {
    console.log('Fetching total pages...');
    const { total, pages } = await fetchPage(1);
    endPage = pages;
    console.log(`Total listings: ${total.toLocaleString()}, Pages: ${pages.toLocaleString()}\n`);
  }

  // Step 2: Load known URLs
  const known = await loadKnownUrls();
  console.log(`\nTotal known URLs: ${known.size.toLocaleString()}\n`);

  // Step 3: Check for checkpoint (resume from where we left off)
  let resumePage = startPage;
  try {
    const fs = await import('fs');
    if (fs.existsSync(checkpointFile)) {
      const cp = JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
      if (cp.lastPage && cp.lastPage > startPage) {
        resumePage = cp.lastPage + 1;
        console.log(`Resuming from checkpoint: page ${resumePage} (last completed: ${cp.lastPage})`);
        console.log(`Previous stats: ${cp.totalFound} found, ${cp.totalNew} new, ${cp.totalQueued} queued\n`);
      }
    }
  } catch (e) {
    // No checkpoint, start fresh
  }

  console.log(`Crawling pages ${resumePage}-${endPage} (delay: ${delayMs}ms)${dryRun ? ' [DRY RUN]' : ''}\n`);

  // Step 4: Crawl all pages
  let totalFound = 0;
  let totalNew = 0;
  let totalQueued = 0;
  let errors = 0;
  let consecutiveErrors = 0;
  const newUrlBuffer = [];
  const startTime = Date.now();

  for (let page = resumePage; page <= endPage; page++) {
    try {
      const { items, rateLimited } = await fetchPage(page);

      if (!items || items.length === 0) {
        if (rateLimited) {
          // Rate limited even after retries — back off significantly but don't count as empty
          console.log(`  Page ${page}: still rate limited after all retries, backing off 30s`);
          await sleep(30000);
          errors++;
          // Don't increment consecutiveErrors for rate limits
          continue;
        }
        errors++;
        consecutiveErrors++;
        if (consecutiveErrors >= 20) {
          console.log(`\n20 consecutive empty pages at page ${page}. End of results.`);
          break;
        }
        continue;
      }

      consecutiveErrors = 0;

      for (const item of items) {
        const url = (item.url || '').replace(/\/$/, '');
        if (!isValidListingUrl(url)) continue;

        totalFound++;
        if (!known.has(url)) {
          totalNew++;
          known.add(url);
          newUrlBuffer.push(url);
        }
      }

      // Flush buffer every 500 new URLs
      if (newUrlBuffer.length >= 500) {
        const batch = newUrlBuffer.splice(0, 500);
        const queued = await flushBatch(batch, dryRun);
        totalQueued += queued;
        console.log(`  Flushed ${batch.length} URLs (${queued} queued)`);
      }

      // Progress logging every 50 pages
      if (page % 50 === 0 || page === endPage) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const pct = (((page - resumePage + 1) / (endPage - resumePage + 1)) * 100).toFixed(1);
        const eta = ((endPage - page) * delayMs / 1000 / 60).toFixed(1);
        console.log(
          `  page ${page}/${endPage} (${pct}%) — found: ${totalFound}, new: ${totalNew}, ` +
          `queued: ${totalQueued}, buffer: ${newUrlBuffer.length}, errors: ${errors} ` +
          `[${elapsed}s elapsed, ~${eta}min remaining]`
        );

        // Save checkpoint
        try {
          const fs = await import('fs');
          fs.writeFileSync(checkpointFile, JSON.stringify({
            lastPage: page,
            totalFound,
            totalNew,
            totalQueued,
            timestamp: new Date().toISOString(),
          }));
        } catch (e) {
          // Ignore checkpoint write errors
        }
      }

    } catch (err) {
      errors++;
      consecutiveErrors++;
      console.error(`  Page ${page} error: ${err.message}`);

      if (consecutiveErrors >= 50) {
        console.log('\n50 consecutive errors. Stopping.');
        break;
      }

      // Exponential backoff on errors
      const backoff = Math.min(30000, 3000 * Math.pow(1.5, Math.min(consecutiveErrors, 8)));
      await sleep(backoff);
    }

    // Respect rate limit
    await sleep(delayMs);
  }

  // Flush remaining buffer
  if (newUrlBuffer.length > 0) {
    const queued = await flushBatch(newUrlBuffer, dryRun);
    totalQueued += queued;
    console.log(`  Final flush: ${newUrlBuffer.length} URLs (${queued} queued)`);
  }

  const totalElapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log('\n==========================================================');
  console.log(`  COMPLETE in ${totalElapsed} minutes`);
  console.log(`  Found: ${totalFound.toLocaleString()} listing URLs`);
  console.log(`  New:   ${totalNew.toLocaleString()} (not in DB)`);
  console.log(`  Queued: ${totalQueued.toLocaleString()} to bat_extraction_queue`);
  console.log(`  Errors: ${errors}`);
  console.log('==========================================================');

  // Clean up checkpoint
  try {
    const fs = await import('fs');
    if (fs.existsSync(checkpointFile)) {
      fs.unlinkSync(checkpointFile);
    }
  } catch (e) {}
}

main().catch(e => { console.error(e); process.exit(1); });

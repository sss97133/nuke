#!/usr/bin/env node
/**
 * bat-make-pages-discovery.mjs — Discover BaT listing URLs from make/model page HTML.
 *
 * Each make/model page (e.g., /porsche/911/, /ford/mustang/) embeds up to 24 listing
 * items as JSON in the initial HTML. This script scrapes all 2,044 make/model pages
 * (and 401 make pages) to extract listing URLs without needing the rate-limited API.
 *
 * This approach gets ~48K+ URLs from initial page loads (24 per page * 2,044 pages).
 * Many will be duplicates, but we'll find listings the API's 277-page limit can't reach.
 *
 * Usage:
 *   dotenvx run -- node scripts/bat-make-pages-discovery.mjs
 *   dotenvx run -- node scripts/bat-make-pages-discovery.mjs --dry-run
 *   dotenvx run -- node scripts/bat-make-pages-discovery.mjs --makes-only  # skip model pages
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0",
];

function getUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

const LISTING_URL_RE = /https:\/\/bringatrailer\.com\/listing\/[a-z0-9][a-z0-9-]+/gi;

function isValidListingUrl(url) {
  if (!url) return false;
  const clean = url.replace(/\/$/, '');
  return /^https:\/\/bringatrailer\.com\/listing\/[a-z0-9][a-z0-9-]+$/i.test(clean);
}

async function fetchMakePage(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: {
          "User-Agent": getUA(),
          "Accept": "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: AbortSignal.timeout(20000),
      });

      if (resp.status === 429) {
        const waitSec = attempt * 10;
        console.log(`  Rate limited on ${url}, waiting ${waitSec}s`);
        await sleep(waitSec * 1000);
        continue;
      }

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      return await resp.text();
    } catch (err) {
      if (attempt < retries) {
        await sleep(3000 * attempt);
        continue;
      }
      throw err;
    }
  }
  return null;
}

function extractListingUrls(html) {
  const urls = new Set();

  // Method 1: Extract from embedded JSON items array
  const itemsMatch = html.match(/"items"\s*:\s*\[/);
  if (itemsMatch) {
    const startIdx = html.indexOf('"items":[', itemsMatch.index);
    if (startIdx >= 0) {
      // Find the array bounds
      const arrStart = startIdx + '"items":'.length;
      let depth = 0;
      let inString = false;
      let escape = false;
      let arrEnd = arrStart;

      for (let i = arrStart; i < Math.min(arrStart + 500000, html.length); i++) {
        const c = html[i];
        if (escape) { escape = false; continue; }
        if (c === '\\' && inString) { escape = true; continue; }
        if (c === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (c === '[') depth++;
        else if (c === ']') {
          depth--;
          if (depth === 0) { arrEnd = i + 1; break; }
        }
      }

      try {
        const items = JSON.parse(html.substring(arrStart, arrEnd));
        for (const item of items) {
          if (item.url) {
            const clean = item.url.replace(/\/$/, '');
            if (isValidListingUrl(clean)) urls.add(clean);
          }
        }
      } catch (e) {
        // Fall through to regex extraction
      }
    }
  }

  // Method 2: Regex extraction as fallback
  let match;
  const re = new RegExp(LISTING_URL_RE.source, 'gi');
  while ((match = re.exec(html)) !== null) {
    const clean = match[0].replace(/\/$/, '');
    if (isValidListingUrl(clean)) urls.add(clean);
  }

  return urls;
}

function extractItemsTotal(html) {
  const match = html.match(/"items_total"\s*:\s*(\d+)/);
  return match ? parseInt(match[1]) : 0;
}

async function loadKnownUrls() {
  console.log('Loading known BaT URLs...');
  const known = new Set();

  async function loadTable(table, column, filter) {
    let offset = 0;
    let loaded = 0;
    while (true) {
      let q = supabase.from(table).select(column).range(offset, offset + 999);
      if (filter) q = filter(q);
      const { data, error } = await q;
      if (error || !data || data.length === 0) break;
      for (const r of data) {
        const val = r[column];
        if (val) known.add(val.replace(/\/$/, ''));
      }
      loaded += data.length;
      offset += data.length;
      if (data.length < 1000) break;
    }
    return loaded;
  }

  await loadTable('vehicles', 'bat_auction_url', q => q.not('bat_auction_url', 'is', null));
  await loadTable('bat_extraction_queue', 'bat_url');
  await loadTable('vehicles', 'listing_url', q => q.not('listing_url', 'is', null).ilike('listing_url', '%bringatrailer%'));
  await loadTable('vehicles', 'discovery_url', q => q.not('discovery_url', 'is', null).ilike('discovery_url', '%bringatrailer%'));
  await loadTable('import_queue', 'listing_url', q => q.not('listing_url', 'is', null).ilike('listing_url', '%bringatrailer%'));

  console.log(`  Loaded ${known.size.toLocaleString()} known URLs\n`);
  return known;
}

async function queueNewUrls(urls) {
  if (!urls.length) return 0;

  // Check which already exist in bat_extraction_queue
  const existingUrls = new Set();
  for (let i = 0; i < urls.length; i += 50) {
    const chunk = urls.slice(i, i + 50);
    const { data } = await supabase
      .from('bat_extraction_queue')
      .select('bat_url')
      .in('bat_url', chunk);
    if (data) {
      for (const r of data) existingUrls.add(r.bat_url);
    }
  }

  const toInsert = urls.filter(u => !existingUrls.has(u));
  if (!toInsert.length) return 0;

  const now = new Date().toISOString();
  let queued = 0;
  for (let i = 0; i < toInsert.length; i += 50) {
    const chunk = toInsert.slice(i, i + 50).map(url => ({
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
      // Insert one by one
      for (const record of chunk) {
        const { error: e } = await supabase.from('bat_extraction_queue').insert([record]);
        if (!e) queued++;
      }
    }
  }
  return queued;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const makesOnly = args.includes('--makes-only');
  const delayMs = parseInt(args[args.indexOf('--delay') + 1]) || 1500;
  const checkpointFile = '/tmp/bat-make-discovery-checkpoint.json';

  console.log('==========================================================');
  console.log('  BaT MAKE/MODEL PAGE DISCOVERY');
  console.log('==========================================================\n');

  // Step 1: Get make and model URLs from /models/ page
  console.log('Fetching /models/ page to get make/model URLs...');
  const modelsHtml = await fetchMakePage('https://bringatrailer.com/models/');
  if (!modelsHtml) {
    console.error('Failed to fetch /models/ page');
    process.exit(1);
  }

  // Extract make URLs (single-slug paths)
  const SKIP_SLUGS = new Set([
    'about', 'auctions', 'calendar', 'ccpa-request-form', 'charity', 'charity-auctions',
    'contact', 'faq', 'login', 'register', 'sell', 'submit', 'account', 'how-it-works',
    'press', 'privacy', 'terms', 'newsletter', 'members', 'listings', 'models', 'results',
    'catalog', 'listing', 'wp-admin', 'wp-content', 'wp-json', 'feed', 'search', 'blog',
    'editorial', 'premium', 'whiteglove', 'store',
  ]);

  const makeUrlRe = /href="https:\/\/bringatrailer\.com\/([a-z0-9-]+)\/"/gi;
  const makeModelUrlRe = /href="https:\/\/bringatrailer\.com\/([a-z0-9-]+)\/([a-z0-9-]+)\/"/gi;

  const makeUrls = new Set();
  const modelUrls = new Set();
  let m;

  while ((m = makeUrlRe.exec(modelsHtml)) !== null) {
    const slug = m[1];
    if (!SKIP_SLUGS.has(slug)) {
      makeUrls.add(`https://bringatrailer.com/${slug}/`);
    }
  }

  if (!makesOnly) {
    while ((m = makeModelUrlRe.exec(modelsHtml)) !== null) {
      const makeSlug = m[1];
      const modelSlug = m[2];
      if (!SKIP_SLUGS.has(makeSlug) && !['auctions', 'listing', 'contact', 'feed'].includes(modelSlug)) {
        modelUrls.add(`https://bringatrailer.com/${makeSlug}/${modelSlug}/`);
      }
    }
  }

  const allPages = [...makeUrls, ...modelUrls];
  console.log(`Found ${makeUrls.size} make pages and ${modelUrls.size} model pages (${allPages.length} total)\n`);

  // Step 2: Load known URLs
  const known = await loadKnownUrls();

  // Step 3: Check for checkpoint
  let startIdx = 0;
  let prevFound = 0;
  let prevNew = 0;
  let prevQueued = 0;
  try {
    if (existsSync(checkpointFile)) {
      const cp = JSON.parse(readFileSync(checkpointFile, 'utf8'));
      if (cp.lastIndex >= 0) {
        startIdx = cp.lastIndex + 1;
        prevFound = cp.totalFound || 0;
        prevNew = cp.totalNew || 0;
        prevQueued = cp.totalQueued || 0;
        console.log(`Resuming from index ${startIdx} (${cp.totalFound} found, ${cp.totalNew} new, ${cp.totalQueued} queued)\n`);
      }
    }
  } catch (e) {}

  // Step 4: Scrape each page
  let totalFound = prevFound;
  let totalNew = prevNew;
  let totalQueued = prevQueued;
  let errors = 0;
  const newUrlBuffer = [];
  const startTime = Date.now();
  const makeStats = [];

  for (let i = startIdx; i < allPages.length; i++) {
    const pageUrl = allPages[i];
    const slug = pageUrl.replace('https://bringatrailer.com/', '').replace(/\/$/, '');

    try {
      const html = await fetchMakePage(pageUrl);
      if (!html) {
        errors++;
        continue;
      }

      const urls = extractListingUrls(html);
      const itemsTotal = extractItemsTotal(html);
      totalFound += urls.size;

      let pageNew = 0;
      for (const url of urls) {
        if (!known.has(url)) {
          totalNew++;
          pageNew++;
          known.add(url);
          newUrlBuffer.push(url);
        }
      }

      if (pageNew > 0 || (i % 50 === 0)) {
        makeStats.push({ slug, urls: urls.size, new: pageNew, total: itemsTotal });
      }

      // Flush buffer every 200 new URLs
      if (newUrlBuffer.length >= 200 && !dryRun) {
        const batch = newUrlBuffer.splice(0, 200);
        const queued = await queueNewUrls(batch);
        totalQueued += queued;
        console.log(`  Flushed ${batch.length} URLs (${queued} queued)`);
      }

      // Progress logging
      if (i % 50 === 0 || i === allPages.length - 1) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const pct = (((i - startIdx + 1) / (allPages.length - startIdx)) * 100).toFixed(1);
        const eta = ((allPages.length - i) * delayMs / 1000 / 60).toFixed(1);
        console.log(
          `  [${i}/${allPages.length}] (${pct}%) ${slug}: ${urls.size} urls, ${pageNew} new ` +
          `| total: ${totalFound} found, ${totalNew} new, ${totalQueued} queued ` +
          `[${elapsed}s, ~${eta}min left]`
        );

        // Save checkpoint
        writeFileSync(checkpointFile, JSON.stringify({
          lastIndex: i,
          totalFound, totalNew, totalQueued,
          timestamp: new Date().toISOString(),
        }));
      }

    } catch (err) {
      errors++;
      console.error(`  Error on ${slug}: ${err.message}`);
    }

    await sleep(delayMs);
  }

  // Flush remaining
  if (newUrlBuffer.length > 0 && !dryRun) {
    const queued = await queueNewUrls(newUrlBuffer);
    totalQueued += queued;
    console.log(`  Final flush: ${newUrlBuffer.length} URLs (${queued} queued)`);
  }

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log('\n==========================================================');
  console.log(`  COMPLETE in ${elapsed} minutes`);
  console.log(`  Pages scraped: ${allPages.length}`);
  console.log(`  Listing URLs found: ${totalFound.toLocaleString()}`);
  console.log(`  New (not in DB): ${totalNew.toLocaleString()}`);
  console.log(`  Queued: ${totalQueued.toLocaleString()}`);
  console.log(`  Errors: ${errors}`);
  console.log('==========================================================');

  // Show top makes by new discoveries
  if (makeStats.length > 0) {
    const topNew = makeStats.filter(s => s.new > 0).sort((a, b) => b.new - a.new).slice(0, 20);
    if (topNew.length > 0) {
      console.log('\nTop makes/models by new discoveries:');
      for (const s of topNew) {
        console.log(`  ${s.slug}: ${s.new} new (${s.urls} on page, ${s.total} total)`);
      }
    }
  }

  // Clean up checkpoint
  try {
    if (existsSync(checkpointFile)) {
      const { unlinkSync } = await import('fs');
      unlinkSync(checkpointFile);
    }
  } catch (e) {}
}

main().catch(e => { console.error(e); process.exit(1); });

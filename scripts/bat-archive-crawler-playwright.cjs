#!/usr/bin/env node
/**
 * BaT Archive Crawler (Playwright)
 *
 * Crawls BaT's auction archive by year range to discover all historical listings.
 * Uses the search page with year filters to get around the 10k listing limit.
 *
 * Usage: node scripts/bat-archive-crawler-playwright.cjs [options]
 *   --year-start N    Start year (default: 1920)
 *   --year-end N      End year (default: 2026)
 *   --max-clicks N    Max "Show More" clicks per year (default: 500)
 */

const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : def;
};

const YEAR_START = parseInt(getArg('year-start', '1920'));
const YEAR_END = parseInt(getArg('year-end', '2026'));
const MAX_CLICKS = parseInt(getArg('max-clicks', '500'));
const LOG_FILE = '/Users/skylar/nuke/logs/bat-archive-crawler.log';

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function getEnv() {
  try {
    const output = execSync('dotenvx run -- printenv 2>/dev/null', {
      cwd: '/Users/skylar/nuke',
      encoding: 'utf8'
    });
    const lines = output.split('\n');
    const env = {};
    for (const line of lines) {
      const match = line.match(/^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=(.+)$/);
      if (match) env[match[1]] = match[2];
    }
    return env;
  } catch (e) {
    log(`Failed to get env vars: ${e.message}`);
    process.exit(1);
  }
}

async function queueUrls(urls, env) {
  if (urls.length === 0) return 0;

  let queued = 0;
  const batchSize = 100;

  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    const records = batch.map(url => ({
      listing_url: url,
      status: 'pending',
      priority: 1,
      raw_data: { source: 'playwright_archive_crawler', discovered_at: new Date().toISOString() }
    }));

    const resp = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/import_queue?on_conflict=listing_url`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=ignore-duplicates,return=minimal'
      },
      body: JSON.stringify(records)
    });

    if (resp.ok) {
      queued += batch.length;
    }
  }
  return queued;
}

async function crawlYear(page, year, env) {
  // Navigate to search with year filter
  const url = `https://bringatrailer.com/auctions/results/?years_min=${year}&years_max=${year}`;
  log(`Crawling year ${year}...`);

  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

  // Dismiss cookie consent if present
  try {
    const acceptBtn = await page.$('button:has-text("ACCEPT"), button#onetrust-accept-btn-handler');
    if (acceptBtn) {
      await acceptBtn.click();
      await page.waitForTimeout(1000);
    }
  } catch (e) {}

  const allUrls = new Set();

  // Extract initial URLs
  const extractUrls = async () => {
    const links = await page.$$eval('a[href*="/listing/"]', els =>
      [...new Set(els.map(e => e.href))].filter(h => !h.includes('#'))
    );
    return links;
  };

  let urls = await extractUrls();
  urls.forEach(u => allUrls.add(u));

  // Click "Show More" until no more
  let clicks = 0;
  let noChangeCount = 0;
  let lastCount = allUrls.size;

  while (clicks < MAX_CLICKS) {
    const showMore = await page.$('button:has-text("Show More")');
    if (!showMore) break;

    try {
      await showMore.click();
      await page.waitForTimeout(1500);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      urls = await extractUrls();
      urls.forEach(u => allUrls.add(u));
      clicks++;

      if (allUrls.size === lastCount) {
        noChangeCount++;
        if (noChangeCount >= 3) break;
      } else {
        noChangeCount = 0;
      }
      lastCount = allUrls.size;

      if (clicks % 20 === 0) {
        log(`  Year ${year}: ${clicks} clicks, ${allUrls.size} URLs`);
      }
    } catch (e) {
      noChangeCount++;
      if (noChangeCount >= 3) break;
    }
  }

  // Queue URLs
  const queued = await queueUrls([...allUrls], env);
  log(`Year ${year}: ${allUrls.size} found, ${queued} queued (${clicks} clicks)`);

  return { found: allUrls.size, queued };
}

async function main() {
  // Clear log
  fs.writeFileSync(LOG_FILE, '');

  log(`BaT Archive Crawler starting...`);
  log(`Year range: ${YEAR_START} - ${YEAR_END}`);
  log(`Max clicks per year: ${MAX_CLICKS}`);

  const env = getEnv();
  log('Environment loaded.');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  let totalFound = 0;
  let totalQueued = 0;

  // Crawl each year
  for (let year = YEAR_END; year >= YEAR_START; year--) {
    try {
      const { found, queued } = await crawlYear(page, year, env);
      totalFound += found;
      totalQueued += queued;
    } catch (e) {
      log(`Year ${year} error: ${e.message}`);
    }
  }

  await browser.close();

  log(`\n=== ARCHIVE CRAWL COMPLETE ===`);
  log(`Years crawled: ${YEAR_END} - ${YEAR_START}`);
  log(`Total URLs found: ${totalFound}`);
  log(`Total URLs queued: ${totalQueued}`);
}

main().catch(err => {
  log(`Fatal error: ${err.message}`);
  process.exit(1);
});

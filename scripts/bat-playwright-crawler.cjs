#!/usr/bin/env node
/**
 * BaT Playwright Crawler
 *
 * Uses Playwright to load BaT's auction results page and click "Show More"
 * repeatedly to discover all historical listing URLs.
 *
 * Usage: node scripts/bat-playwright-crawler.cjs [options]
 *   --max-clicks N    Maximum "Show More" clicks (default: 100)
 *   --batch-size N    Queue URLs in batches of N (default: 500)
 *   --dry-run         Don't actually queue URLs, just count them
 */

const { chromium } = require('playwright');
const { execSync } = require('child_process');

// Parse args
const args = process.argv.slice(2);
const getArg = (name, def) => {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : def;
};
const MAX_CLICKS = parseInt(getArg('max-clicks', '500'));
const BATCH_SIZE = parseInt(getArg('batch-size', '500'));
const DRY_RUN = args.includes('--dry-run');

// Get env vars via dotenvx
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
    console.error('Failed to get env vars:', e.message);
    process.exit(1);
  }
}

async function getExistingUrls(env) {
  // We rely on upsert to handle duplicates, so just return empty set
  // This is faster than fetching 100k+ URLs
  return new Set();
}

async function queueUrls(urls, env) {
  if (urls.length === 0) return 0;

  // Queue in smaller batches to avoid timeout issues
  let queued = 0;
  const batchSize = 100;

  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    const records = batch.map(url => ({
      listing_url: url,
      status: 'pending',
      priority: 1,
      raw_data: { source: 'playwright_crawler', discovered_at: new Date().toISOString() }
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
    } else {
      const err = await resp.text();
      // Only log non-duplicate errors
      if (!err.includes('duplicate')) {
        console.error('Queue error:', err);
      }
    }
  }

  return queued;
}

async function main() {
  console.log(`[${new Date().toISOString()}] BaT Playwright Crawler starting...`);
  console.log(`Max clicks: ${MAX_CLICKS}, Batch size: ${BATCH_SIZE}, Dry run: ${DRY_RUN}`);

  const env = getEnv();
  console.log('Environment loaded.');

  // Get existing URLs to avoid duplicates
  console.log('Fetching existing URLs from queue...');
  const existingUrls = await getExistingUrls(env);
  console.log(`${existingUrls.size} URLs already in queue.`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log('Navigating to BaT auction results...');
  await page.goto('https://bringatrailer.com/auctions/results/', {
    waitUntil: 'networkidle',
    timeout: 60000
  });

  // Dismiss cookie consent if present
  try {
    const acceptBtn = await page.$('button:has-text("ACCEPT"), button#onetrust-accept-btn-handler');
    if (acceptBtn) {
      await acceptBtn.click();
      console.log('Dismissed cookie consent.');
      await page.waitForTimeout(1000);
    }
  } catch (e) {
    // Cookie banner may not be present
  }

  let clickCount = 0;
  let lastLinkCount = 0;
  let noChangeCount = 0;
  const allUrls = new Set();
  let queuedTotal = 0;

  // Extract initial URLs
  const extractUrls = async () => {
    const links = await page.$$eval('a[href*="/listing/"]', els =>
      [...new Set(els.map(e => e.href))].filter(h => !h.includes('#'))
    );
    return links;
  };

  // Initial extraction
  let currentUrls = await extractUrls();
  currentUrls.forEach(u => allUrls.add(u));
  console.log(`Initial load: ${currentUrls.length} listings`);

  // Click "Show More" repeatedly
  while (clickCount < MAX_CLICKS) {
    try {
      // Find and click "Show More" button
      const showMore = await page.$('button:has-text("Show More")');
      if (!showMore) {
        console.log('No more "Show More" button found. All listings loaded.');
        break;
      }

      await showMore.click();
      clickCount++;

      // Wait for new content to load
      await page.waitForTimeout(1500);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      // Extract URLs
      currentUrls = await extractUrls();
      currentUrls.forEach(u => allUrls.add(u));

      // Check if we're getting new results
      if (allUrls.size === lastLinkCount) {
        noChangeCount++;
        if (noChangeCount >= 5) {
          console.log('No new listings after 5 clicks. Stopping.');
          break;
        }
      } else {
        noChangeCount = 0;
      }

      lastLinkCount = allUrls.size;

      // Log progress every 10 clicks
      if (clickCount % 10 === 0) {
        console.log(`Click ${clickCount}: ${allUrls.size} total listings discovered`);
      }

      // Queue in batches
      if (allUrls.size - queuedTotal >= BATCH_SIZE && !DRY_RUN) {
        const newUrls = [...allUrls].filter(u => !existingUrls.has(u));
        const toQueue = newUrls.slice(queuedTotal, queuedTotal + BATCH_SIZE);
        const queued = await queueUrls(toQueue, env);
        queuedTotal += queued;
        toQueue.forEach(u => existingUrls.add(u));
        console.log(`Queued batch: ${queued} URLs (total queued: ${queuedTotal})`);
      }

    } catch (err) {
      console.error(`Click ${clickCount} error:`, err.message);
      noChangeCount++;
      if (noChangeCount >= 5) break;
    }
  }

  console.log(`\n=== CRAWL COMPLETE ===`);
  console.log(`Total clicks: ${clickCount}`);
  console.log(`Total URLs discovered: ${allUrls.size}`);

  // Queue remaining URLs
  if (!DRY_RUN) {
    const newUrls = [...allUrls].filter(u => !existingUrls.has(u));
    const remaining = newUrls.slice(queuedTotal);
    if (remaining.length > 0) {
      const queued = await queueUrls(remaining, env);
      queuedTotal += queued;
      console.log(`Queued final batch: ${queued} URLs`);
    }
    console.log(`Total URLs queued: ${queuedTotal}`);
  } else {
    const newUrls = [...allUrls].filter(u => !existingUrls.has(u));
    console.log(`Would queue: ${newUrls.length} new URLs (dry run)`);
  }

  await browser.close();
  console.log(`[${new Date().toISOString()}] Done.`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

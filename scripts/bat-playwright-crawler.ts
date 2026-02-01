import { chromium } from 'playwright';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function queueUrls(urls: string[]): Promise<number> {
  if (urls.length === 0) return 0;

  const response = await fetch(`${SUPABASE_URL}/functions/v1/bat-year-crawler`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ action: 'queue_urls', urls })
  });

  const result = await response.json();
  return result.urls_queued || 0;
}

async function crawlBatListings() {
  console.log('Starting BAT Playwright crawler...');
  console.log('Time:', new Date().toISOString());

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  });
  const page = await context.newPage();

  // Navigate to results page
  console.log('Navigating to BAT results...');
  await page.goto('https://bringatrailer.com/auctions/results/', {
    waitUntil: 'networkidle',
    timeout: 60000
  });

  // Wait for listings to render
  await page.waitForSelector('.listing-card', { timeout: 30000 });

  let totalQueued = 0;
  let totalFound = 0;
  const allUrls = new Set<string>();
  const maxClicks = 5000; // We need ~228k / 46 per page = ~5000 clicks

  for (let click = 0; click < maxClicks; click++) {
    // Extract all listing URLs currently visible
    const urls = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="/listing/"]');
      return Array.from(links)
        .map(a => (a as HTMLAnchorElement).href)
        .filter(url => url.includes('/listing/') && !url.includes('/listing/#'));
    });

    // Add new URLs
    const newUrls: string[] = [];
    for (const url of urls) {
      if (!allUrls.has(url)) {
        allUrls.add(url);
        newUrls.push(url);
      }
    }

    // Queue new URLs in batches
    if (newUrls.length > 0) {
      const queued = await queueUrls(newUrls);
      totalQueued += queued;
      totalFound += newUrls.length;

      if (click % 10 === 0 || newUrls.length > 40) {
        console.log(`Click ${click}: +${newUrls.length} found, +${queued} queued. Total: ${allUrls.size} found, ${totalQueued} queued`);
      }
    }

    // Look for "Load More" button and click it
    const loadMoreButton = await page.$('button:has-text("Load More"), button:has-text("Show More"), .load-more, [data-bind*="loadMore"], button.auctions-footer-button');

    if (!loadMoreButton) {
      // Try finding any button at bottom of list
      const anyLoadMore = await page.$('.auctions-list-footer button, .auctions-footer button, button[data-bind*="click"]');
      if (anyLoadMore) {
        await anyLoadMore.click();
        await page.waitForTimeout(2000);
        continue;
      }

      console.log('No Load More button found, taking screenshot for debug...');
      await page.screenshot({ path: '/tmp/bat-no-button.png', fullPage: false });

      // Try scrolling to see if it triggers loading
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(3000);

      const afterScrollUrls = await page.evaluate(() => {
        return document.querySelectorAll('a[href*="/listing/"]').length;
      });

      if (afterScrollUrls === urls.length) {
        console.log('No new content loaded. Ending crawl.');
        break;
      }
      continue;
    }

    try {
      await loadMoreButton.click();
      await page.waitForTimeout(1500);
    } catch (e) {
      console.log('Click failed, trying scroll...');
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2000);
    }

    // Every 100 clicks, log status
    if (click % 100 === 0 && click > 0) {
      console.log(`=== Progress: ${click} clicks, ${allUrls.size} URLs found, ${totalQueued} queued ===`);
    }
  }

  console.log('Crawl complete!');
  console.log(`Total unique URLs found: ${allUrls.size}`);
  console.log(`Total queued: ${totalQueued}`);

  await browser.close();
}

crawlBatListings().catch(console.error);

import { chromium } from 'playwright';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function queueUrls(urls: string[]): Promise<number> {
  if (urls.length === 0) return 0;

  try {
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
  } catch (e) {
    console.error('Queue error:', e);
    return 0;
  }
}

async function crawlBatListings() {
  console.log('Starting BAT Show More crawler...');
  console.log('Time:', new Date().toISOString());

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  console.log('Navigating to BAT results...');
  await page.goto('https://bringatrailer.com/auctions/results/', {
    waitUntil: 'networkidle',
    timeout: 60000
  });

  await page.waitForSelector('.listing-card', { timeout: 30000 });
  console.log('Page loaded, starting to click Show More...');

  let totalQueued = 0;
  const allUrls = new Set<string>();
  let clicks = 0;
  let noNewUrlsCount = 0;
  const maxClicks = 6000; // 228k / 46 per click ≈ 5000 clicks needed

  while (clicks < maxClicks && noNewUrlsCount < 20) {
    // Extract all listing URLs currently visible
    const urls = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a.listing-card[href*="/listing/"]'));
      return links.map(a => (a as HTMLAnchorElement).href);
    });

    // Track new URLs
    const prevSize = allUrls.size;
    for (const url of urls) {
      allUrls.add(url);
    }
    const newCount = allUrls.size - prevSize;

    // Queue every 1000 URLs found
    if (allUrls.size >= 1000 && allUrls.size % 1000 < 50) {
      console.log(`Queueing batch at ${allUrls.size} URLs...`);
      const queued = await queueUrls(Array.from(allUrls));
      totalQueued = queued; // Total queued (deduped by server)
    }

    if (newCount === 0) {
      noNewUrlsCount++;
    } else {
      noNewUrlsCount = 0;
    }

    // Log progress every 50 clicks or when we find new URLs
    if (clicks % 50 === 0 || newCount > 0) {
      console.log(`Click ${clicks}: ${allUrls.size} URLs (${newCount > 0 ? '+' + newCount : 'no'} new), ${totalQueued} queued`);
    }

    // Find and click the Show More button
    const showMoreBtn = await page.$('button.auctions-footer-button');
    if (!showMoreBtn) {
      console.log('Show More button not found, checking if we reached the end...');

      // Check if there's a loading indicator or if we're at the end
      const isLoading = await page.$('[data-bind*="itemsLoading"]:not([style*="none"])');
      if (isLoading) {
        console.log('Page is loading, waiting...');
        await page.waitForTimeout(3000);
        continue;
      }

      // Maybe button just disappeared temporarily
      await page.waitForTimeout(2000);
      const btnRetry = await page.$('button.auctions-footer-button');
      if (!btnRetry) {
        console.log('No Show More button found after retry. May have reached end.');
        break;
      }
    }

    try {
      // Scroll to button first
      await page.evaluate(() => {
        const btn = document.querySelector('button.auctions-footer-button');
        if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      await page.waitForTimeout(500);

      await page.click('button.auctions-footer-button');
      clicks++;

      // Wait for new content to load
      await page.waitForTimeout(1000);

      // Every 100 clicks, take a longer break
      if (clicks % 100 === 0) {
        console.log(`=== ${clicks} clicks, ${allUrls.size} URLs, ${totalQueued} queued ===`);
        await page.waitForTimeout(2000);
      }

    } catch (e) {
      console.log('Click error, retrying...', e);
      await page.waitForTimeout(3000);
    }
  }

  // Final queue of remaining URLs
  const remaining = Array.from(allUrls);
  const finalQueued = await queueUrls(remaining);
  totalQueued += finalQueued;

  console.log('\n=== Crawl Complete ===');
  console.log(`Total clicks: ${clicks}`);
  console.log(`Total unique URLs: ${allUrls.size}`);
  console.log(`Total queued: ${totalQueued}`);
  console.log(`Time: ${new Date().toISOString()}`);

  await browser.close();
}

crawlBatListings().catch(console.error);

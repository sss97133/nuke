import { chromium } from 'playwright';

// Crawl a specific year archive using Show More
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const YEAR = process.argv[2] || '2020';

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

async function crawlYear() {
  console.log(`Starting BAT ${YEAR} crawler...`);
  console.log('Time:', new Date().toISOString());

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  });
  const page = await context.newPage();

  // Navigate to year archive
  const url = `https://bringatrailer.com/${YEAR}/`;
  console.log(`Navigating to ${url}...`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

  await page.waitForSelector('.listing-card, .auction-item', { timeout: 30000 }).catch(() => {
    console.log('No listing cards found');
  });

  let totalQueued = 0;
  const allUrls = new Set<string>();
  let clicks = 0;
  let noNewCount = 0;

  while (clicks < 3000 && noNewCount < 15) {
    const urls = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="/listing/"]'));
      return links.map(a => (a as HTMLAnchorElement).href).filter(u => u.includes('/listing/'));
    });

    const prevSize = allUrls.size;
    urls.forEach(u => allUrls.add(u.replace(/\/$/, '')));
    const newCount = allUrls.size - prevSize;

    if (newCount === 0) {
      noNewCount++;
    } else {
      noNewCount = 0;
    }

    // Queue every 500 URLs
    if (allUrls.size > 0 && allUrls.size % 500 < 40) {
      const queued = await queueUrls(Array.from(allUrls));
      totalQueued = queued;
      console.log(`[${YEAR}] Click ${clicks}: ${allUrls.size} URLs, ${queued} queued`);
    } else if (clicks % 25 === 0) {
      console.log(`[${YEAR}] Click ${clicks}: ${allUrls.size} URLs (+${newCount})`);
    }

    // Click Show More
    const btn = await page.$('button.auctions-footer-button, button:has-text("Show More")');
    if (!btn) {
      console.log('No Show More button found');
      break;
    }

    try {
      await btn.scrollIntoViewIfNeeded();
      await btn.click();
      await page.waitForTimeout(1200);
    } catch (e) {
      console.log('Click failed, stopping');
      break;
    }

    clicks++;
  }

  // Final queue
  const finalQueued = await queueUrls(Array.from(allUrls));
  console.log(`\n=== ${YEAR} Complete ===`);
  console.log(`Clicks: ${clicks}, URLs: ${allUrls.size}, Queued: ${finalQueued}`);

  await browser.close();
}

crawlYear().catch(console.error);

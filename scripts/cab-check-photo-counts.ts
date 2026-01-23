/**
 * Check actual photo counts on C&B auctions
 * Use the same warm-up pattern that works in the backfill
 */

import { chromium } from 'playwright';

const TEST_URLS = [
  'https://carsandbids.com/auctions/9a7XbAL8/2022-porsche-911-carrera-cabriolet',
  'https://carsandbids.com/auctions/r0Y2xP4K/2023-range-rover-sport-p530-deer-valley-edition',
  'https://carsandbids.com/auctions/rJvOJPgX/2017-porsche-911-turbo-s-coupe',
];

async function main() {
  console.log('Checking photo counts on C&B auctions...\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  // Warm up - same as backfill
  console.log('Warming up...');
  await page.goto('https://carsandbids.com', { waitUntil: 'load' });
  for (let i = 0; i < 15; i++) {
    const title = await page.title();
    if (!title.includes('Just a moment')) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(3000);

  for (const url of TEST_URLS) {
    const name = url.split('/').pop();
    console.log(`\n=== ${name} ===`);

    try {
      await page.goto(url, { waitUntil: 'load', timeout: 60000 });

      // Wait for Cloudflare
      for (let i = 0; i < 15; i++) {
        const title = await page.title();
        if (!title.includes('Just a moment')) break;
        await page.waitForTimeout(1000);
      }
      await page.waitForTimeout(2000);

      // Get photo count from page
      const pageData = await page.evaluate(`
        (function() {
          var result = {
            photoCountText: null,
            domImageCount: 0,
            uniqueHashes: [],
            auctionHash: null
          };

          // Find "X Photos" text
          var text = document.body.innerText;
          var match = text.match(/(\\d+)\\s*Photos?/i);
          result.photoCountText = match ? match[0] : null;

          // Count images in DOM
          var imgs = document.querySelectorAll('img[src*="media.carsandbids.com"]');
          var seen = {};
          for (var i = 0; i < imgs.length; i++) {
            var src = imgs[i].src || '';
            if (src.indexOf('width=80') >= 0 && src.indexOf('height=80') >= 0) continue;

            var hashMatch = src.match(/\\/([a-f0-9]{32,})\\/photos\\//);
            if (hashMatch) {
              var hash = hashMatch[1];
              if (!result.auctionHash) result.auctionHash = hash;
              if (hash === result.auctionHash) {
                var base = src.split('?')[0];
                if (!seen[base]) {
                  seen[base] = true;
                  result.domImageCount++;
                }
              }
            }
          }

          return result;
        })()
      `);

      console.log('Page says:', pageData.photoCountText || 'No photo count found');
      console.log('DOM images (this auction):', pageData.domImageCount);
      console.log('Auction hash:', pageData.auctionHash?.substring(0, 20) + '...');

      // Also count from page source
      const html = await page.content();
      const allUrls = html.match(/https?:\/\/media\.carsandbids\.com[^"'\s<>)]+/g) || [];
      const photoUrls = allUrls.filter(u =>
        u.includes('/photos/') &&
        !u.includes('width=80') &&
        pageData.auctionHash && u.includes(pageData.auctionHash)
      );

      // Dedupe by base path
      const basePaths = new Set<string>();
      photoUrls.forEach(url => {
        const base = url.split('?')[0];
        basePaths.add(base);
      });

      console.log('Unique photo paths in source:', basePaths.size);

    } catch (e: any) {
      console.log('Error:', e.message);
    }

    await page.waitForTimeout(2000);
  }

  await browser.close();
}

main().catch(console.error);

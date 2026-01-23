/**
 * Simple image count - just log everything
 */

import { chromium } from 'playwright';

const TEST_URL = 'https://carsandbids.com/auctions/9a7XbAL8/2022-porsche-911-carrera-cabriolet';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  // Warm up
  await page.goto('https://carsandbids.com', { waitUntil: 'load' });
  for (let i = 0; i < 15; i++) {
    const title = await page.title();
    if (!title.includes('Just a moment')) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(3000);

  await page.goto(TEST_URL, { waitUntil: 'load', timeout: 60000 });
  for (let i = 0; i < 15; i++) {
    const title = await page.title();
    if (!title.includes('Just a moment')) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(2000);

  // Click All Photos
  try {
    await page.locator('text=/All Photos/i').first().click();
    await page.waitForTimeout(3000);
  } catch (e) {}

  // Scroll
  for (let i = 0; i < 10; i++) {
    await page.evaluate(`window.scrollBy(0, 500)`);
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(2000);

  // Get ALL image src values
  const allSrcs = await page.evaluate(`
    (function() {
      var imgs = document.querySelectorAll('img');
      var srcs = [];
      for (var i = 0; i < imgs.length; i++) {
        var src = imgs[i].src || '';
        if (src.indexOf('media.carsandbids.com') >= 0) {
          srcs.push(src);
        }
      }
      return srcs;
    })()
  `);

  console.log('Total img elements with C&B media:', allSrcs.length);

  // Find auction hash
  let auctionHash = '';
  for (const src of allSrcs) {
    if (src.includes('width=80') && src.includes('height=80')) continue;
    const match = (src as string).match(/\/([a-f0-9]{32,})\/photos\//);
    if (match) {
      auctionHash = match[1];
      break;
    }
  }
  console.log('Auction hash:', auctionHash.substring(0, 20) + '...');

  // Filter to this auction's photos only
  const thisAuction = allSrcs.filter((src: string) =>
    src.includes(auctionHash) && src.includes('/photos/')
  );
  console.log('This auction photos (with duplicates):', thisAuction.length);

  // Extract unique photo IDs
  const photoIds = new Set<string>();
  for (const src of thisAuction) {
    // Photo ID pattern: /photos/TYPE/PHOTOID/...
    const match = (src as string).match(/\/photos\/[^/]+\/([^/]+)/);
    if (match) {
      photoIds.add(match[1]);
    }
  }
  console.log('Unique photo IDs:', photoIds.size);

  // Show first 20 photo IDs
  console.log('\nPhoto IDs:');
  Array.from(photoIds).slice(0, 20).forEach((id, i) => {
    console.log(`  ${i + 1}. ${id}`);
  });

  await browser.close();
}

main().catch(console.error);

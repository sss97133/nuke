/**
 * Intercept ALL network requests to find photo URLs
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

  // Collect ALL requests to media.carsandbids.com
  const photoRequests: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('media.carsandbids.com') && url.includes('/photos/')) {
      photoRequests.push(url);
    }
  });

  // Warm up
  await page.goto('https://carsandbids.com', { waitUntil: 'load' });
  for (let i = 0; i < 15; i++) {
    const title = await page.title();
    if (!title.includes('Just a moment')) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(3000);

  console.log('Loading auction page...');
  await page.goto(TEST_URL, { waitUntil: 'networkidle', timeout: 60000 });
  for (let i = 0; i < 15; i++) {
    const title = await page.title();
    if (!title.includes('Just a moment')) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(3000);

  console.log('Photo requests so far:', photoRequests.length);

  // Get auction hash
  const auctionHash = await page.evaluate(`
    (function() {
      var imgs = document.querySelectorAll('.gallery-preview img');
      for (var i = 0; i < imgs.length; i++) {
        var src = imgs[i].src || '';
        var match = src.match(/\\/([a-f0-9]{32,})\\/photos\\//);
        if (match) return match[1];
      }
      return null;
    })()
  `);
  console.log('Auction hash:', auctionHash?.substring(0, 20) + '...');

  // Filter to this auction
  const thisAuctionRequests = photoRequests.filter(url =>
    auctionHash && url.includes(auctionHash)
  );
  console.log('Requests for THIS auction:', thisAuctionRequests.length);

  // Click All Photos
  console.log('\nClicking All Photos...');
  try {
    await page.locator('text=/All Photos/i').first().click();
    await page.waitForTimeout(3000);
  } catch (e) {}

  console.log('Photo requests after click:', photoRequests.length);
  const afterClick = photoRequests.filter(url => auctionHash && url.includes(auctionHash));
  console.log('THIS auction requests:', afterClick.length);

  // Click on main image to open lightbox
  console.log('\nClicking main image...');
  try {
    await page.locator('.gallery-preview img').first().click();
    await page.waitForTimeout(3000);
  } catch (e) {}

  console.log('Photo requests after main click:', photoRequests.length);

  // Navigate with arrow keys
  console.log('\nNavigating with arrows...');
  for (let i = 0; i < 150; i++) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(2000);

  console.log('Photo requests after navigation:', photoRequests.length);
  const afterNav = photoRequests.filter(url => auctionHash && url.includes(auctionHash));
  console.log('THIS auction requests:', afterNav.length);

  // Extract unique photo IDs from requests
  const photoIds = new Set<string>();
  afterNav.forEach(url => {
    const match = url.match(/\/photos\/[^/]+\/([^/]+)/);
    if (match) photoIds.add(match[1]);
  });

  console.log('\n=== RESULTS ===');
  console.log('Unique photo IDs from network requests:', photoIds.size);

  // Show sample
  console.log('\nSample photo IDs:');
  Array.from(photoIds).slice(0, 20).forEach((id, i) => {
    console.log(`  ${i + 1}. ${id}`);
  });

  await browser.close();
}

main().catch(console.error);

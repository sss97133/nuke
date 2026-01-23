/**
 * Test photo counts on multiple auctions
 */

import { chromium } from 'playwright';

const TEST_URLS = [
  // Completed auction (tested before)
  'https://carsandbids.com/auctions/9a7XbAL8/2022-porsche-911-carrera-cabriolet',
  // Try some different auctions
  'https://carsandbids.com/auctions/3GjodmOv/2021-lexus-lc-500',
  'https://carsandbids.com/auctions/KZPlQZkL/2020-chevrolet-corvette-stingray-2lt-coupe',
];

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

  for (const url of TEST_URLS) {
    const name = url.split('/').pop()?.substring(0, 50);
    console.log(`\n=== ${name} ===`);

    try {
      await page.goto(url, { waitUntil: 'load', timeout: 60000 });
      for (let i = 0; i < 15; i++) {
        const title = await page.title();
        if (!title.includes('Just a moment')) break;
        await page.waitForTimeout(1000);
      }
      await page.waitForTimeout(2000);

      // Get expected photo count
      const pageInfo = await page.evaluate(`
        (function() {
          var text = document.body.innerText;
          var allMatch = text.match(/All Photos\\s*\\((\\d+)\\)/i);
          var extMatch = text.match(/Exterior\\s*\\((\\d+)\\)/i);
          var intMatch = text.match(/Interior\\s*\\((\\d+)\\)/i);

          // Get auction hash
          var hash = null;
          var imgs = document.querySelectorAll('.gallery-preview img');
          for (var i = 0; i < imgs.length; i++) {
            var src = imgs[i].src || '';
            var m = src.match(/\\/([a-f0-9]{32,})\\/photos\\//);
            if (m) { hash = m[1]; break; }
          }

          // Count unique photo IDs from this auction
          var photoIds = {};
          var allImgs = document.querySelectorAll('img');
          for (var j = 0; j < allImgs.length; j++) {
            var isrc = allImgs[j].src || '';
            if (!hash || isrc.indexOf(hash) < 0) continue;
            if (isrc.indexOf('/photos/') < 0) continue;
            var pm = isrc.match(/\\/photos\\/[^/]+\\/([^/]+)/);
            if (pm) photoIds[pm[1]] = true;
          }

          return {
            expected: allMatch ? parseInt(allMatch[1]) : 0,
            exterior: extMatch ? parseInt(extMatch[1]) : 0,
            interior: intMatch ? parseInt(intMatch[1]) : 0,
            actual: Object.keys(photoIds).length,
            hash: hash ? hash.substring(0, 20) : null
          };
        })()
      `);

      console.log('Expected:', pageInfo.expected, '(Ext:', pageInfo.exterior, '+ Int:', pageInfo.interior + ')');
      console.log('Actually loaded:', pageInfo.actual);
      console.log('Hash:', pageInfo.hash + '...');
      console.log('Coverage:', Math.round(pageInfo.actual / pageInfo.expected * 100) + '%');

    } catch (e: any) {
      console.log('Error:', e.message);
    }

    await page.waitForTimeout(2000);
  }

  await browser.close();
}

main().catch(console.error);

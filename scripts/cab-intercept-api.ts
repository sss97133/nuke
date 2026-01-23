/**
 * Intercept network requests to find gallery API
 */

import { chromium } from 'playwright';

// Try a different auction that might have more photos
const TEST_URL = 'https://carsandbids.com/auctions/rJvOJPgX/2017-porsche-911-turbo-s-coupe';

async function main() {
  console.log('Intercepting network requests...\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  // Collect all API requests
  const apiCalls: any[] = [];

  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('api') || url.includes('photo') || url.includes('gallery') || url.includes('graphql')) {
      apiCalls.push({
        url: url,
        method: request.method(),
        type: 'request'
      });
    }
  });

  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('api') || url.includes('photo') || url.includes('gallery') || url.includes('graphql')) {
      try {
        const body = await response.text();
        apiCalls.push({
          url: url,
          status: response.status(),
          size: body.length,
          hasPhotos: body.includes('media.carsandbids'),
          type: 'response'
        });
      } catch {}
    }
  });

  // Warm up
  console.log('Warming up...');
  await page.goto('https://carsandbids.com', { waitUntil: 'load' });
  for (let i = 0; i < 30; i++) {
    const title = await page.title();
    if (!title.includes('Just a moment')) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(3000);

  // Go to auction
  console.log('Loading auction...');
  await page.goto(TEST_URL, { waitUntil: 'networkidle' });
  for (let i = 0; i < 30; i++) {
    const hasImages = await page.evaluate(`
      document.querySelectorAll('img[src*="media.carsandbids.com"]').length > 0
    `);
    if (hasImages) {
      console.log('Page loaded');
      break;
    }
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(3000);

  // Get photo count text from page
  const photoCountText = await page.evaluate(`
    (function() {
      var text = document.body.innerText;
      var match = text.match(/(\\d+)\\s*Photos?/i);
      return match ? match[0] : null;
    })()
  `);
  console.log('\nPhoto count on page:', photoCountText || 'Not found');

  // Count images in DOM
  const domCount = await page.evaluate(`
    (function() {
      var imgs = document.querySelectorAll('img[src*="media.carsandbids.com"]');
      var count = 0;
      for (var i = 0; i < imgs.length; i++) {
        var src = imgs[i].src || '';
        if (src.indexOf('width=80') < 0 || src.indexOf('height=80') < 0) count++;
      }
      return count;
    })()
  `);
  console.log('Images in DOM:', domCount);

  // Try clicking main image to trigger gallery load
  console.log('\nClicking main image...');
  try {
    const mainImg = page.locator('img[src*="media.carsandbids.com"]').first();
    await mainImg.click();
    await page.waitForTimeout(3000);

    // Check for lightbox
    const lightboxOpen = await page.evaluate(`
      !!document.querySelector('.fslightbox-open, [class*="lightbox"][style*="display"], [class*="modal"][style*="display"]')
    `);
    console.log('Lightbox open:', lightboxOpen);

    // Navigate
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(2000);

    const afterNav = await page.evaluate(`
      (function() {
        var imgs = document.querySelectorAll('img[src*="media.carsandbids.com"]');
        var count = 0;
        for (var i = 0; i < imgs.length; i++) {
          var src = imgs[i].src || '';
          if (src.indexOf('width=80') < 0 || src.indexOf('height=80') < 0) count++;
        }
        return count;
      })()
    `);
    console.log('Images after navigation:', afterNav);
  } catch (e) {
    console.log('Click error:', e);
  }

  console.log('\n=== API CALLS INTERCEPTED ===');
  const photoApis = apiCalls.filter(c => c.hasPhotos || c.url.includes('photo'));
  console.log('Total API calls:', apiCalls.length);
  console.log('Photo-related:', photoApis.length);

  photoApis.forEach((call, i) => {
    console.log(`\n${i + 1}. ${call.type === 'response' ? 'RESPONSE' : 'REQUEST'}`);
    console.log(`   URL: ${call.url.substring(0, 100)}`);
    if (call.status) console.log(`   Status: ${call.status}, Size: ${call.size}`);
  });

  // Look for photo data in page scripts again, more thoroughly
  console.log('\n=== SEARCHING PAGE FOR ALL PHOTO DATA ===');

  const allPhotoData = await page.evaluate(`
    (function() {
      var results = [];

      // Get all script content
      var scripts = document.querySelectorAll('script');
      for (var i = 0; i < scripts.length; i++) {
        var content = scripts[i].textContent || '';
        if (content.length < 100) continue;

        // Look for photo URL patterns
        var matches = content.match(/https?:\\/\\/media\\.carsandbids\\.com[^"'\\s]+/g);
        if (matches && matches.length > 0) {
          results.push({
            scriptIndex: i,
            urls: matches.length,
            sample: matches.slice(0, 3)
          });
        }
      }

      return results;
    })()
  `);

  console.log('Scripts with photo URLs:');
  allPhotoData.forEach((data: any) => {
    console.log(`  Script #${data.scriptIndex}: ${data.urls} URLs`);
    data.sample.forEach((url: string) => console.log(`    ${url.substring(0, 80)}`));
  });

  // Final: extract ALL URLs from full page source
  const fullHtml = await page.content();
  const allUrls = fullHtml.match(/https?:\/\/media\.carsandbids\.com[^"'\s<>)]+/g) || [];
  const uniquePhotoUrls = [...new Set(allUrls)].filter(url => url.includes('/photos/'));

  console.log('\n=== FINAL URL COUNT ===');
  console.log('Total unique photo URLs in source:', uniquePhotoUrls.length);

  // Group by hash
  const byHash: Record<string, string[]> = {};
  uniquePhotoUrls.forEach(url => {
    const match = url.match(/\/([a-f0-9]{32,})\//);
    const hash = match ? match[1].substring(0, 16) : 'unknown';
    if (!byHash[hash]) byHash[hash] = [];
    byHash[hash].push(url);
  });

  console.log('\nPhotos by auction hash:');
  Object.entries(byHash).forEach(([hash, urls]) => {
    console.log(`  ${hash}...: ${urls.length} URLs`);
  });

  await browser.close();
}

main().catch(console.error);

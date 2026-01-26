/**
 * Click "All Photos" to load all images from C&B gallery
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
  console.log('Warming up...');
  await page.goto('https://carsandbids.com', { waitUntil: 'load' });
  for (let i = 0; i < 15; i++) {
    const title = await page.title();
    if (!title.includes('Just a moment')) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(3000);

  console.log('Loading auction...');
  await page.goto(TEST_URL, { waitUntil: 'load', timeout: 60000 });

  for (let i = 0; i < 15; i++) {
    const title = await page.title();
    if (!title.includes('Just a moment')) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(2000);

  // Get initial count
  const initialCount = await countImages(page);
  console.log('Initial image count:', initialCount);

  // Get photo counts from page
  const photoCounts = await page.evaluate(`
    (function() {
      var text = document.body.innerText;
      var extMatch = text.match(/Exterior\\s*\\((\\d+)\\)/i);
      var intMatch = text.match(/Interior\\s*\\((\\d+)\\)/i);
      var allMatch = text.match(/All Photos\\s*\\((\\d+)\\)/i);
      return {
        exterior: extMatch ? parseInt(extMatch[1]) : 0,
        interior: intMatch ? parseInt(intMatch[1]) : 0,
        all: allMatch ? parseInt(allMatch[1]) : 0
      };
    })()
  `);

  console.log('Page reports: Exterior', photoCounts.exterior, '+ Interior', photoCounts.interior, '= All', photoCounts.all);

  // Try clicking "All Photos"
  console.log('\nClicking "All Photos"...');

  try {
    // Find and click the All Photos element
    const allPhotosBtn = page.locator('text=/All Photos/i').first();
    if (await allPhotosBtn.isVisible({ timeout: 5000 })) {
      await allPhotosBtn.click();
      console.log('Clicked All Photos button');
      await page.waitForTimeout(3000);

      const afterClick = await countImages(page);
      console.log('After click:', afterClick, 'images');
    } else {
      console.log('All Photos button not visible');
    }
  } catch (e) {
    console.log('Click error');
  }

  // Try scrolling the gallery
  console.log('\nScrolling gallery...');

  await page.evaluate(`
    (function() {
      var gallery = document.querySelector('.images, .gallery-preview');
      if (gallery) {
        gallery.scrollTop = gallery.scrollHeight;
      }
      // Also scroll window
      window.scrollTo(0, 500);
    })()
  `);
  await page.waitForTimeout(2000);

  const afterScroll1 = await countImages(page);
  console.log('After scroll:', afterScroll1, 'images');

  // Keep scrolling
  for (let i = 0; i < 10; i++) {
    await page.evaluate(`window.scrollBy(0, 300)`);
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(2000);

  const afterScroll2 = await countImages(page);
  console.log('After more scroll:', afterScroll2, 'images');

  // Try clicking on the gallery to trigger load
  console.log('\nClicking gallery area...');

  try {
    const galleryArea = page.locator('.gallery-preview, .images').first();
    await galleryArea.click();
    await page.waitForTimeout(2000);

    const afterGalleryClick = await countImages(page);
    console.log('After gallery click:', afterGalleryClick, 'images');
  } catch (e) {}

  // Final extraction from page source
  console.log('\n=== FINAL EXTRACTION ===');

  // Get auction hash
  const auctionHash = await page.evaluate(`
    (function() {
      var imgs = document.querySelectorAll('img[src*="media.carsandbids.com"]');
      for (var i = 0; i < imgs.length; i++) {
        var src = imgs[i].src || '';
        var match = src.match(/\\/([a-f0-9]{32,})\\/photos\\//);
        if (match) return match[1];
      }
      return null;
    })()
  `);

  // Extract all image URLs from page source
  const html = await page.content();
  const allUrls = html.match(/https?:\/\/media\.carsandbids\.com[^"'\s<>)]+/g) || [];
  const uniqueUrls = [...new Set(allUrls)];

  // Filter to this auction's photos
  const photoUrls = uniqueUrls.filter(url =>
    auctionHash && url.includes(auctionHash) &&
    url.includes('/photos/') &&
    !url.includes('width=80')
  );

  // Dedupe by unique photo path (not size variant)
  const uniquePhotos = new Map<string, string>();
  photoUrls.forEach(url => {
    // Extract photo ID from path like /photos/exterior/r4qwO2zp-loAusV-/edit/17cU5.jpg
    const match = url.match(/\/photos\/[^/]+\/([^/]+\/[^/]+\/[^?]+)/);
    if (match) {
      const photoId = match[1];
      if (!uniquePhotos.has(photoId)) {
        uniquePhotos.set(photoId, url);
      }
    }
  });

  console.log('Unique photo URLs in page source:', uniquePhotos.size);
  console.log('Expected from page:', photoCounts.all);
  console.log('Missing:', photoCounts.all - uniquePhotos.size);

  // Show sample
  console.log('\nSample photo IDs:');
  Array.from(uniquePhotos.keys()).slice(0, 5).forEach((id, i) => {
    console.log(`  ${i + 1}. ${id}`);
  });

  await browser.close();
}

async function countImages(page: any): Promise<number> {
  return page.evaluate(`
    (function() {
      var imgs = document.querySelectorAll('img[src*="media.carsandbids.com"]');
      var count = 0;
      var seen = {};
      for (var i = 0; i < imgs.length; i++) {
        var src = imgs[i].src || '';
        if (src.indexOf('width=80') >= 0 && src.indexOf('height=80') >= 0) continue;
        if (src.indexOf('/photos/') < 0) continue;
        var base = src.split('?')[0];
        if (!seen[base]) {
          seen[base] = true;
          count++;
        }
      }
      return count;
    })()
  `);
}

main().catch(console.error);

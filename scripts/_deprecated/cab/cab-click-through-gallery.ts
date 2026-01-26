/**
 * Click through the gallery using "view next" button to load all images
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

  // Get expected photo count
  const expected = await page.evaluate(`
    (function() {
      var text = document.body.innerText;
      var match = text.match(/All Photos\\s*\\((\\d+)\\)/i);
      return match ? parseInt(match[1]) : 0;
    })()
  `);
  console.log('Expected photos:', expected);

  // Find auction hash
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

  // Initial count
  let photoIds = await getUniquePhotoIds(page, auctionHash);
  console.log('Initial unique photos:', photoIds.size);

  // Click on main image to maybe open lightbox
  console.log('\nClicking main image...');
  try {
    await page.locator('.gallery-preview img').first().click();
    await page.waitForTimeout(2000);

    photoIds = await getUniquePhotoIds(page, auctionHash);
    console.log('After main image click:', photoIds.size, 'photos');

    // Check if lightbox opened
    const hasLightbox = await page.evaluate(`
      !!document.querySelector('.fslightbox-open, .fslightbox-container, [class*="lightbox"]')
    `);
    console.log('Lightbox open:', hasLightbox);
  } catch (e) {}

  // Try clicking "view next" button many times
  console.log('\nClicking "view next" 100+ times...');
  let clickCount = 0;
  for (let i = 0; i < 150; i++) {
    try {
      // Try different selectors for next button
      const nextBtn = page.locator('button:has-text("view next"), .slide_button.right, [class*="next"]').first();
      if (await nextBtn.isVisible({ timeout: 500 })) {
        await nextBtn.click();
        clickCount++;
        await page.waitForTimeout(100);
      } else {
        // Try arrow key
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(50);
      }
    } catch {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(50);
    }
  }
  console.log('Total clicks:', clickCount);
  await page.waitForTimeout(2000);

  photoIds = await getUniquePhotoIds(page, auctionHash);
  console.log('After clicking through:', photoIds.size, 'photos');

  // Also try scrolling within the images container
  console.log('\nScrolling image thumbnails...');
  await page.evaluate(`
    var containers = document.querySelectorAll('.images, .group, .draggable');
    containers.forEach(function(c) {
      c.scrollLeft = 0;
      for (var i = 0; i < 50; i++) {
        c.scrollLeft += 200;
      }
    });
  `);
  await page.waitForTimeout(2000);

  photoIds = await getUniquePhotoIds(page, auctionHash);
  console.log('After thumbnail scroll:', photoIds.size, 'photos');

  // Final extraction
  console.log('\n=== FINAL EXTRACTION ===');
  console.log('Unique photos found:', photoIds.size);
  console.log('Expected:', expected);
  console.log('Coverage:', Math.round(photoIds.size / expected * 100) + '%');

  // Show sample IDs
  console.log('\nSample photo IDs:');
  Array.from(photoIds).slice(0, 10).forEach((id, i) => {
    console.log(`  ${i + 1}. ${id}`);
  });

  await browser.close();
}

async function getUniquePhotoIds(page: any, auctionHash: string | null): Promise<Set<string>> {
  const ids = await page.evaluate(`
    (function() {
      var hash = '${auctionHash}';
      var ids = [];
      var imgs = document.querySelectorAll('img');
      for (var i = 0; i < imgs.length; i++) {
        var src = imgs[i].src || '';
        if (!hash || src.indexOf(hash) < 0) continue;
        if (src.indexOf('/photos/') < 0) continue;
        var match = src.match(/\\/photos\\/[^/]+\\/([^/]+)/);
        if (match) ids.push(match[1]);
      }
      return ids;
    })()
  `);
  return new Set(ids);
}

main().catch(console.error);

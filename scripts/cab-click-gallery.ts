/**
 * Click on the gallery to open lightbox and get all images
 */

import { chromium } from 'playwright';

const TEST_URL = 'https://carsandbids.com/auctions/9a7XbAL8/2022-porsche-911-carrera-cabriolet';

async function main() {
  console.log('Testing gallery click expansion...\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

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
  await page.goto(TEST_URL, { waitUntil: 'load' });
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
  await page.waitForTimeout(2000);

  // Find auction hash for filtering
  const auctionHash = await page.evaluate(`
    (function() {
      var imgs = document.querySelectorAll('img[src*="media.carsandbids.com"]');
      for (var i = 0; i < imgs.length; i++) {
        var src = imgs[i].src || '';
        if (src.indexOf('width=80') >= 0 && src.indexOf('height=80') >= 0) continue;
        var match = src.match(/\\/([a-f0-9]{32,})\\/photos\\//);
        if (match) return match[1];
      }
      return null;
    })()
  `);
  console.log('Auction hash:', auctionHash?.substring(0, 20) + '...');

  // Count images before click
  const beforeClick = await countAuctionImages(page, auctionHash);
  console.log('\nBefore gallery click:', beforeClick, 'images');

  // Try clicking on the main gallery image
  console.log('\n--- Clicking main gallery image ---');

  try {
    // Find the main gallery/carousel area and click
    const mainImg = page.locator('img[src*="media.carsandbids.com"]').first();
    if (await mainImg.isVisible({ timeout: 5000 })) {
      await mainImg.click();
      console.log('Clicked main image');
      await page.waitForTimeout(3000);

      const afterClick1 = await countAuctionImages(page, auctionHash);
      console.log('After click:', afterClick1, 'images');

      // Check for lightbox/modal
      const hasLightbox = await page.evaluate(`
        !!document.querySelector('.fslightbox-container, .lightbox, [class*="lightbox"], [class*="modal"][class*="gallery"]')
      `);
      console.log('Lightbox detected:', hasLightbox);

      // If lightbox opened, try navigating through it
      if (hasLightbox) {
        console.log('\nNavigating through lightbox...');

        // Try arrow key navigation
        for (let i = 0; i < 50; i++) {
          await page.keyboard.press('ArrowRight');
          await page.waitForTimeout(100);
        }
        await page.waitForTimeout(2000);

        const afterNav = await countAuctionImages(page, auctionHash);
        console.log('After navigation:', afterNav, 'images');
      }
    }
  } catch (e) {
    console.log('Error:', e);
  }

  // Try looking for a "Photos" tab or button
  console.log('\n--- Looking for Photos tab ---');

  try {
    const photosTab = page.locator('text=/\\d+ Photos?/i').first();
    if (await photosTab.isVisible({ timeout: 3000 })) {
      const tabText = await photosTab.textContent();
      console.log('Found photos tab:', tabText);
      await photosTab.click();
      await page.waitForTimeout(3000);

      const afterTab = await countAuctionImages(page, auctionHash);
      console.log('After clicking photos tab:', afterTab, 'images');
    } else {
      console.log('No photos tab found');
    }
  } catch (e) {
    console.log('Photos tab error:', e);
  }

  // Try scrolling the gallery thumbnails
  console.log('\n--- Scrolling gallery thumbnails ---');

  try {
    // Look for thumbnail container
    const thumbContainer = page.locator('[class*="thumbnail"], [class*="thumb"], [class*="gallery-nav"]').first();
    if (await thumbContainer.isVisible({ timeout: 3000 })) {
      // Scroll it
      for (let i = 0; i < 10; i++) {
        await page.evaluate(`
          var thumbs = document.querySelector('[class*="thumbnail"], [class*="thumb"], [class*="gallery-nav"]');
          if (thumbs) thumbs.scrollLeft += 500;
        `);
        await page.waitForTimeout(300);
      }

      const afterScroll = await countAuctionImages(page, auctionHash);
      console.log('After thumbnail scroll:', afterScroll, 'images');
    }
  } catch (e) {
    console.log('Thumbnail scroll error');
  }

  // Final: Extract all image URLs from page source
  console.log('\n--- Final extraction from page source ---');

  const html = await page.content();
  const allUrls = html.match(/https?:\/\/media\.carsandbids\.com[^"'\s<>)]+/g) || [];
  const uniqueUrls = [...new Set(allUrls)];
  const auctionPhotos = uniqueUrls.filter(url =>
    auctionHash && url.includes(auctionHash) && url.includes('/photos/')
  );

  // Dedupe by base path (remove size params)
  const basePaths = new Set<string>();
  auctionPhotos.forEach(url => {
    const base = url.split('?')[0].replace(/\/[^/]+\.(jpg|jpeg|png|webp)$/i, '');
    basePaths.add(base);
  });

  console.log('Unique photo base paths:', basePaths.size);
  console.log('\nSample paths:');
  Array.from(basePaths).slice(0, 10).forEach((p, i) => console.log(`  ${i + 1}. ${p}`));

  await browser.close();
}

async function countAuctionImages(page: any, auctionHash: string | null): Promise<number> {
  return page.evaluate(`
    (function() {
      var hash = '${auctionHash}';
      if (!hash) return 0;
      var imgs = document.querySelectorAll('img[src*="media.carsandbids.com"]');
      var count = 0;
      var seen = {};
      for (var i = 0; i < imgs.length; i++) {
        var src = imgs[i].src || '';
        if (src.indexOf('width=80') >= 0 && src.indexOf('height=80') >= 0) continue;
        if (src.indexOf(hash) < 0) continue;
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

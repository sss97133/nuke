/**
 * Check what's actually in the gallery area before/after clicking All Photos
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

  // Check gallery state BEFORE clicking
  console.log('\n=== BEFORE CLICKING ALL PHOTOS ===');
  await checkGalleryState(page, auctionHash);

  // Click All Photos
  console.log('\nClicking "All Photos"...');
  try {
    // Wait for the All Photos element
    await page.waitForSelector('text=/All Photos/i', { timeout: 5000 });
    await page.locator('text=/All Photos/i').first().click();
    console.log('Clicked!');
    await page.waitForTimeout(3000);
  } catch (e: any) {
    console.log('Click failed:', e.message);
  }

  // Check gallery state AFTER clicking
  console.log('\n=== AFTER CLICKING ALL PHOTOS ===');
  await checkGalleryState(page, auctionHash);

  // Try scrolling the gallery container specifically
  console.log('\nScrolling gallery container...');
  await page.evaluate(`
    var gallery = document.querySelector('.images, .all, .gallery-all');
    if (gallery) {
      gallery.scrollTop = 10000;
      console.log('Scrolled gallery');
    }
  `);
  await page.waitForTimeout(2000);

  console.log('\n=== AFTER SCROLLING GALLERY ===');
  await checkGalleryState(page, auctionHash);

  // Check if there's a "see more" or pagination
  const pagination = await page.evaluate(`
    (function() {
      var els = document.querySelectorAll('button, a, span');
      var result = [];
      for (var i = 0; i < els.length; i++) {
        var text = (els[i].textContent || '').toLowerCase();
        if (text.includes('more') || text.includes('load') || text.includes('show') ||
            text.includes('next') || text.includes('page')) {
          result.push({
            tag: els[i].tagName,
            text: text.substring(0, 50),
            class: (els[i].className || '').substring(0, 50)
          });
        }
      }
      return result;
    })()
  `);

  console.log('\nPagination/Load more elements:');
  pagination.forEach((p: any) => {
    console.log(`  [${p.tag}] "${p.text}" class="${p.class}"`);
  });

  await browser.close();
}

async function checkGalleryState(page: any, auctionHash: string | null) {
  const state = await page.evaluate(`
    (function() {
      var hash = '${auctionHash}';
      var result = {
        galleryPreviewImgs: 0,
        allPhotosImgs: 0,
        preloadWraps: 0,
        loadedPreloadWraps: 0,
        auctionImgs: 0,
        visibleGroups: [],
        hasAllPhotosGroup: false
      };

      // Count images in gallery-preview area
      var galleryPreview = document.querySelector('.gallery-preview');
      if (galleryPreview) {
        result.galleryPreviewImgs = galleryPreview.querySelectorAll('img').length;
      }

      // Check for .all or .gallery-all group (All Photos section)
      var allGroup = document.querySelector('.gallery-all, .all, .group.all');
      if (allGroup) {
        result.hasAllPhotosGroup = true;
        result.allPhotosImgs = allGroup.querySelectorAll('img').length;
      }

      // Count preload-wrap divs
      var wraps = document.querySelectorAll('.preload-wrap');
      result.preloadWraps = wraps.length;
      for (var i = 0; i < wraps.length; i++) {
        if (wraps[i].classList.contains('loaded')) result.loadedPreloadWraps++;
      }

      // Count images from THIS auction in gallery
      var galleryImgs = document.querySelectorAll('.gallery-preview img, .images img');
      for (var j = 0; j < galleryImgs.length; j++) {
        var src = galleryImgs[j].src || '';
        if (hash && src.indexOf(hash) >= 0) result.auctionImgs++;
      }

      // Check visible groups
      var groups = document.querySelectorAll('.group, [class*="group-"]');
      for (var k = 0; k < groups.length; k++) {
        var cls = groups[k].className;
        var groupName = groups[k].querySelector('.group-name');
        if (groupName) {
          result.visibleGroups.push(groupName.textContent);
        }
      }

      return result;
    })()
  `);

  console.log('Gallery preview imgs:', state.galleryPreviewImgs);
  console.log('Has All Photos group:', state.hasAllPhotosGroup);
  console.log('All Photos imgs:', state.allPhotosImgs);
  console.log('Preload wraps:', state.preloadWraps, '(loaded:', state.loadedPreloadWraps + ')');
  console.log('Auction imgs in gallery:', state.auctionImgs);
  console.log('Visible groups:', state.visibleGroups);
}

main().catch(console.error);

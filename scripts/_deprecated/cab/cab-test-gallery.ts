/**
 * Test gallery expansion on C&B
 * Need to click "Show all photos" or similar to load full gallery
 */

import { chromium } from 'playwright';

const TEST_URL = 'https://carsandbids.com/auctions/r0Y2xP4K/2023-range-rover-sport-p530-deer-valley-edition';

async function main() {
  console.log('Testing C&B gallery expansion...\n');

  const browser = await chromium.launch({ headless: false });
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

  // Go to auction
  console.log('Loading auction...');
  await page.goto(TEST_URL, { waitUntil: 'load' });
  for (let i = 0; i < 15; i++) {
    const title = await page.title();
    if (!title.includes('Just a moment')) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(3000);

  // Count initial images
  let imageCount = await page.evaluate(`
    document.querySelectorAll('img[src*="media.carsandbids.com"]').length
  `);
  console.log('Initial image count:', imageCount);

  // Look for gallery buttons
  const galleryButtons = await page.evaluate(`
    (function() {
      var buttons = [];
      var allBtns = document.querySelectorAll('button, a, div[role="button"]');
      for (var i = 0; i < allBtns.length; i++) {
        var text = (allBtns[i].textContent || '').toLowerCase();
        var cls = (allBtns[i].className || '').toLowerCase();
        if (text.includes('photo') || text.includes('image') || text.includes('gallery') ||
            text.includes('show all') || text.includes('view all') ||
            cls.includes('gallery') || cls.includes('photo')) {
          buttons.push({
            text: text.trim().substring(0, 50),
            class: cls.substring(0, 50),
            tag: allBtns[i].tagName
          });
        }
      }
      return buttons;
    })()
  `);

  console.log('\nGallery-related buttons found:');
  galleryButtons.forEach((b: any) => {
    console.log(`  [${b.tag}] "${b.text}" class="${b.class}"`);
  });

  // Look for image count indicator
  const photoCount = await page.evaluate(`
    (function() {
      var text = document.body.innerText;
      var match = text.match(/(\\d+)\\s*(?:photos?|images?)/i);
      return match ? match[0] : null;
    })()
  `);
  console.log('\nPhoto count text found:', photoCount);

  // Try clicking "Photos" tab or gallery
  console.log('\nTrying to expand gallery...');

  // Try different selectors
  const selectors = [
    'button:has-text("Photos")',
    'a:has-text("Photos")',
    '[class*="gallery"]',
    '[class*="photo"]',
    'button:has-text("Show")',
    '.carousel',
    '.gallery-trigger',
  ];

  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 500 })) {
        console.log(`  Found: ${sel}`);
        await el.click();
        await page.waitForTimeout(2000);

        // Recount
        imageCount = await page.evaluate(`
          document.querySelectorAll('img[src*="media.carsandbids.com"]').length
        `);
        console.log(`  Image count after click: ${imageCount}`);
      }
    } catch {
      // Skip
    }
  }

  // Scroll through page to trigger lazy loading
  console.log('\nScrolling to load lazy images...');
  for (let i = 0; i < 10; i++) {
    await page.evaluate(`window.scrollBy(0, 500)`);
    await page.waitForTimeout(300);
  }

  // Final count
  const finalImages = await page.evaluate(`
    (function() {
      var imgs = document.querySelectorAll('img');
      var cabImages = [];
      var seen = {};
      for (var i = 0; i < imgs.length; i++) {
        var src = imgs[i].src || imgs[i].getAttribute('data-src') || '';
        if (src.indexOf('media.carsandbids.com') >= 0) {
          // Skip avatars
          if (src.indexOf('width=80') >= 0 && src.indexOf('height=80') >= 0) continue;
          // Get base URL
          var base = src.split('?')[0];
          if (!seen[base]) {
            seen[base] = true;
            cabImages.push(src);
          }
        }
      }
      return { count: cabImages.length, sample: cabImages.slice(0, 5) };
    })()
  `);

  console.log('\nFinal unique C&B images:', finalImages.count);
  console.log('Sample URLs:');
  finalImages.sample.forEach((url: string) => {
    console.log('  ', url.substring(0, 80) + '...');
  });

  // Check for gallery modal or overlay
  const hasModal = await page.evaluate(`
    !!document.querySelector('.modal, .lightbox, .gallery-modal, [class*="overlay"]')
  `);
  console.log('\nHas modal/overlay:', hasModal);

  console.log('\n\nKeeping browser open - check the page manually to find gallery expansion...');
  await page.waitForTimeout(60000);

  await browser.close();
}

main().catch(console.error);

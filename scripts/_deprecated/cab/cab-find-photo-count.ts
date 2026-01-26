/**
 * Find where photo count is displayed on C&B page
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

  // Search for any text containing numbers followed by photo/image
  const photoTexts = await page.evaluate(`
    (function() {
      var results = [];
      var elements = document.querySelectorAll('*');

      for (var i = 0; i < elements.length; i++) {
        var el = elements[i];
        // Only check leaf nodes or small containers
        if (el.children.length > 5) continue;

        var text = el.textContent || '';
        // Look for patterns like "34 Photos", "Photos: 34", "34 images"
        if (text.match(/\\d+\\s*(photos?|images?)/i) ||
            text.match(/(photos?|images?)\\s*[:\\(]?\\s*\\d+/i)) {
          results.push({
            tag: el.tagName,
            class: (el.className || '').substring(0, 50),
            text: text.substring(0, 100).trim()
          });
        }
      }

      // Also look for stats/info sections
      var statSections = document.querySelectorAll('[class*="stat"], [class*="info"], [class*="detail"], [class*="count"]');
      for (var j = 0; j < statSections.length; j++) {
        var sect = statSections[j];
        var sectText = sect.textContent || '';
        if (sectText.length < 200) {
          results.push({
            tag: 'SECTION',
            class: (sect.className || '').substring(0, 50),
            text: sectText.trim().substring(0, 150)
          });
        }
      }

      return results.slice(0, 20);
    })()
  `);

  console.log('\nElements with photo/number text:');
  photoTexts.forEach((el: any) => {
    console.log(`  [${el.tag}] class="${el.class}"`);
    console.log(`    text: "${el.text}"`);
  });

  // Get the gallery area HTML structure
  console.log('\n=== GALLERY AREA HTML ===');
  const galleryHtml = await page.evaluate(`
    (function() {
      // Find main image
      var mainImg = document.querySelector('img[src*="media.carsandbids.com"]');
      if (!mainImg) return 'No main image found';

      // Walk up to find gallery container
      var parent = mainImg;
      for (var i = 0; i < 10 && parent.parentElement; i++) {
        parent = parent.parentElement;
        var cls = parent.className || '';
        if (cls.indexOf('gallery') >= 0 || cls.indexOf('carousel') >= 0 ||
            cls.indexOf('slider') >= 0 || cls.indexOf('photo') >= 0) {
          break;
        }
      }

      return {
        tag: parent.tagName,
        class: parent.className,
        id: parent.id,
        children: parent.children.length,
        outerHtml: parent.outerHTML.substring(0, 2000)
      };
    })()
  `);

  if (typeof galleryHtml === 'object') {
    console.log('Tag:', galleryHtml.tag);
    console.log('Class:', galleryHtml.class);
    console.log('ID:', galleryHtml.id);
    console.log('Children:', galleryHtml.children);
    console.log('\nHTML sample:');
    console.log(galleryHtml.outerHtml.substring(0, 1500));
  } else {
    console.log(galleryHtml);
  }

  await browser.close();
}

main().catch(console.error);

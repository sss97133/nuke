/**
 * Debug image extraction - see what attributes images have
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

  // Click All Photos
  try {
    const allPhotosBtn = page.locator('text=/All Photos/i').first();
    if (await allPhotosBtn.isVisible({ timeout: 5000 })) {
      await allPhotosBtn.click();
      console.log('Clicked All Photos');
      await page.waitForTimeout(3000);
    }
  } catch (e) {}

  // Scroll to trigger loading
  for (let i = 0; i < 10; i++) {
    await page.evaluate(`window.scrollBy(0, 500)`);
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(2000);

  // Debug: what img elements exist and what are their attributes?
  const imgAnalysis = await page.evaluate(`
    (function() {
      var imgs = document.querySelectorAll('img');
      var analysis = {
        total: imgs.length,
        withSrc: 0,
        withDataSrc: 0,
        withSrcset: 0,
        cabMedia: 0,
        cabPhotos: 0,
        samples: []
      };

      for (var i = 0; i < imgs.length; i++) {
        var img = imgs[i];
        var src = img.src || '';
        var dataSrc = img.getAttribute('data-src') || '';
        var srcset = img.getAttribute('srcset') || '';

        if (src) analysis.withSrc++;
        if (dataSrc) analysis.withDataSrc++;
        if (srcset) analysis.withSrcset++;

        if (src.indexOf('media.carsandbids.com') >= 0 || dataSrc.indexOf('media.carsandbids.com') >= 0) {
          analysis.cabMedia++;
          if (src.indexOf('/photos/') >= 0 || dataSrc.indexOf('/photos/') >= 0) {
            analysis.cabPhotos++;
          }
        }

        // Sample first 10 C&B images
        if (analysis.samples.length < 10 && (
          src.indexOf('media.carsandbids.com') >= 0 ||
          dataSrc.indexOf('media.carsandbids.com') >= 0
        )) {
          analysis.samples.push({
            src: src.substring(0, 100),
            dataSrc: dataSrc.substring(0, 100),
            srcset: srcset.substring(0, 50),
            class: (img.className || '').substring(0, 50),
            parentClass: (img.parentElement?.className || '').substring(0, 50)
          });
        }
      }

      return analysis;
    })()
  `);

  console.log('\n=== IMAGE ANALYSIS ===');
  console.log('Total img elements:', imgAnalysis.total);
  console.log('With src:', imgAnalysis.withSrc);
  console.log('With data-src:', imgAnalysis.withDataSrc);
  console.log('With srcset:', imgAnalysis.withSrcset);
  console.log('C&B media:', imgAnalysis.cabMedia);
  console.log('C&B photos:', imgAnalysis.cabPhotos);

  console.log('\nSample images:');
  imgAnalysis.samples.forEach((img: any, i: number) => {
    console.log(`\n${i + 1}. class="${img.class}"`);
    console.log(`   parent="${img.parentClass}"`);
    console.log(`   src="${img.src}..."`);
    if (img.dataSrc) console.log(`   data-src="${img.dataSrc}..."`);
    if (img.srcset) console.log(`   srcset="${img.srcset}..."`);
  });

  // Also look at preload-wrap divs which contain the images
  const preloadWraps = await page.evaluate(`
    (function() {
      var wraps = document.querySelectorAll('.preload-wrap');
      var info = {
        total: wraps.length,
        loaded: 0,
        withImg: 0,
        samples: []
      };

      for (var i = 0; i < wraps.length; i++) {
        var wrap = wraps[i];
        if (wrap.classList.contains('loaded')) info.loaded++;
        if (wrap.querySelector('img')) info.withImg++;

        if (info.samples.length < 5) {
          var img = wrap.querySelector('img');
          info.samples.push({
            class: wrap.className,
            hasImg: !!img,
            imgSrc: img ? (img.src || '').substring(0, 80) : 'none'
          });
        }
      }

      return info;
    })()
  `);

  console.log('\n=== PRELOAD-WRAP DIVS ===');
  console.log('Total:', preloadWraps.total);
  console.log('With .loaded class:', preloadWraps.loaded);
  console.log('With img child:', preloadWraps.withImg);

  console.log('\nSamples:');
  preloadWraps.samples.forEach((w: any, i: number) => {
    console.log(`  ${i + 1}. class="${w.class}" hasImg=${w.hasImg}`);
    if (w.imgSrc !== 'none') console.log(`     src="${w.imgSrc}..."`);
  });

  await browser.close();
}

main().catch(console.error);

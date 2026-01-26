/**
 * Test script to understand C&B gallery structure and expand it
 */

import { chromium } from 'playwright';

const TEST_URL = 'https://carsandbids.com/auctions/r0Y2xP4K/2023-range-rover-sport-p530-deer-valley-edition';

async function main() {
  console.log('Testing C&B gallery expansion...\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  // Warm up on main page first
  console.log('Step 1: Warming up on homepage...');
  await page.goto('https://carsandbids.com', { waitUntil: 'networkidle' });

  // Wait for Cloudflare - check for page content rather than just title
  for (let i = 0; i < 30; i++) {
    const hasContent = await page.evaluate(`
      !!document.querySelector('a[href*="/auctions/"]')
    `);
    if (hasContent) {
      console.log('  Homepage loaded, found auction links');
      break;
    }
    console.log('  Waiting for Cloudflare...', i);
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(2000);

  // Go to auction
  console.log('\nStep 2: Loading auction page...');
  await page.goto(TEST_URL, { waitUntil: 'networkidle' });

  // Wait for auction content to load
  for (let i = 0; i < 30; i++) {
    const hasAuctionContent = await page.evaluate(`
      (function() {
        var hasBid = !!document.querySelector('.bid-value');
        var hasTitle = document.title.indexOf('Range Rover') >= 0 || document.title.indexOf('Cars') >= 0;
        var hasImages = document.querySelectorAll('img[src*="media.carsandbids.com"]').length > 0;
        return { hasBid: hasBid, hasTitle: hasTitle, hasImages: hasImages };
      })()
    `);

    if (hasAuctionContent.hasImages) {
      console.log('  Auction loaded! Found C&B images');
      break;
    }
    console.log('  Waiting for auction content... bid:', hasAuctionContent.hasBid, 'title:', hasAuctionContent.hasTitle);
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(2000);

  // Initial image count
  let imageCount = await page.evaluate(`
    (function() {
      var imgs = document.querySelectorAll('img[src*="media.carsandbids.com"]');
      var count = 0;
      for (var i = 0; i < imgs.length; i++) {
        var src = imgs[i].src || '';
        if (src.indexOf('width=80') < 0 || src.indexOf('height=80') < 0) {
          count++;
        }
      }
      return count;
    })()
  `);
  console.log('\nInitial non-avatar image count:', imageCount);

  // Look for gallery/carousel elements
  console.log('\n--- GALLERY ANALYSIS ---');

  const galleryInfo = await page.evaluate(`
    (function() {
      var result = {
        carouselClasses: [],
        galleryButtons: [],
        imageContainers: [],
        photoCountText: null
      };

      // Find carousel elements
      var carousels = document.querySelectorAll('[class*="carousel"], [class*="gallery"], [class*="slider"], [class*="swiper"], [class*="photo"]');
      for (var i = 0; i < carousels.length; i++) {
        var cls = carousels[i].className;
        if (typeof cls === 'string' && cls.length > 0) {
          result.carouselClasses.push(cls.substring(0, 100));
        }
      }

      // Find buttons with photo/gallery text
      var allEls = document.querySelectorAll('button, a, div[role="button"], span, div');
      for (var j = 0; j < allEls.length; j++) {
        var el = allEls[j];
        var text = (el.textContent || '').trim();
        var cls = (el.className || '');
        if (typeof cls !== 'string') cls = '';

        // Look for "X photos" pattern
        if (text.match(/^\\d+\\s*photos?$/i)) {
          result.galleryButtons.push({
            tag: el.tagName,
            text: text,
            class: cls.substring(0, 100),
            visible: el.offsetParent !== null
          });
        }
      }

      // Look for photo count like "90 photos" anywhere
      var text = document.body.innerText;
      var matches = text.match(/(\\d+)\\s*photos?/gi);
      result.photoCountText = matches ? matches.join(', ') : null;

      return result;
    })()
  `);

  console.log('Photo count text on page:', galleryInfo.photoCountText);
  console.log('\nCarousel/gallery elements found:', galleryInfo.carouselClasses.length);
  galleryInfo.carouselClasses.slice(0, 10).forEach((c: string) => console.log('  ', c));
  console.log('\nGallery buttons (showing "X photos"):');
  galleryInfo.galleryButtons.forEach((b: any) => {
    console.log(`  [${b.tag}] "${b.text}" visible=${b.visible}`);
  });

  // Try clicking the main image area to open gallery
  console.log('\n--- TRYING GALLERY EXPANSION ---');

  // Look for the main gallery/photo container and click it
  const clicked = await page.evaluate(`
    (function() {
      // Look for the main photo gallery area
      var photoArea = document.querySelector('.photo-gallery, .gallery, [class*="carousel"], [class*="slider"]');
      if (photoArea) {
        photoArea.click();
        return 'Clicked photo area: ' + photoArea.className;
      }

      // Try clicking on the first main image
      var mainImg = document.querySelector('img[src*="media.carsandbids.com"]');
      if (mainImg) {
        mainImg.click();
        return 'Clicked main image';
      }

      return 'No gallery element found to click';
    })()
  `);
  console.log(clicked);
  await page.waitForTimeout(2000);

  // Check if a modal opened
  let modalCount = await page.evaluate(`
    document.querySelectorAll('img[src*="media.carsandbids.com"]').length
  `);
  console.log('Image count after first click:', modalCount);

  // Try clicking on "X photos" text if found
  try {
    const photoBtn = page.locator('text=/^\\d+ photos?$/i').first();
    if (await photoBtn.isVisible({ timeout: 3000 })) {
      const text = await photoBtn.textContent();
      console.log(`\nFound "${text}" button, clicking...`);
      await photoBtn.click();
      await page.waitForTimeout(2000);

      modalCount = await page.evaluate(`
        document.querySelectorAll('img[src*="media.carsandbids.com"]').length
      `);
      console.log('Image count after photo button click:', modalCount);
    }
  } catch (e) {
    console.log('\nNo "X photos" button found');
  }

  // Try using keyboard to navigate (some galleries respond to arrow keys)
  console.log('\n--- TESTING KEYBOARD NAVIGATION ---');
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(1000);

  const afterKeyNav = await page.evaluate(`
    document.querySelectorAll('img[src*="media.carsandbids.com"]').length
  `);
  console.log('Image count after keyboard navigation:', afterKeyNav);

  // Check for lightbox/modal overlay
  console.log('\n--- CHECKING FOR LIGHTBOX ---');
  const lightboxInfo = await page.evaluate(`
    (function() {
      var selectors = ['.lightbox', '.modal', '[class*="lightbox"]', '[class*="modal"]',
                       '[class*="overlay"]', '[class*="fullscreen"]', '.fslightbox'];
      var found = [];
      for (var i = 0; i < selectors.length; i++) {
        var els = document.querySelectorAll(selectors[i]);
        for (var j = 0; j < els.length; j++) {
          found.push({
            selector: selectors[i],
            class: els[j].className,
            visible: els[j].offsetParent !== null,
            imgCount: els[j].querySelectorAll('img').length
          });
        }
      }
      return found;
    })()
  `);

  console.log('Lightbox elements:', lightboxInfo.length);
  lightboxInfo.forEach((l: any) => {
    console.log(`  ${l.selector} -> ${l.class.substring(0, 50)} visible=${l.visible} imgs=${l.imgCount}`);
  });

  // Final extraction of all images
  console.log('\n--- FINAL IMAGE EXTRACTION ---');
  const allImages = await page.evaluate(`
    (function() {
      var imgs = document.querySelectorAll('img');
      var urls = [];
      var seen = {};
      for (var i = 0; i < imgs.length; i++) {
        var src = imgs[i].src || imgs[i].getAttribute('data-src') || '';
        if (src.indexOf('media.carsandbids.com') >= 0) {
          if (src.indexOf('width=80') >= 0 && src.indexOf('height=80') >= 0) continue;
          var base = src.split('?')[0].replace(/\\/[^/]*$/, ''); // Remove size params and filename variant
          if (!seen[base]) {
            seen[base] = true;
            urls.push(src);
          }
        }
      }
      return urls;
    })()
  `);

  console.log('Total unique C&B images found:', allImages.length);
  console.log('Sample URLs:');
  allImages.slice(0, 5).forEach((url: string) => {
    console.log('  ', url.substring(0, 120));
  });

  // Look for image data in page scripts
  console.log('\n--- CHECKING SCRIPT DATA ---');
  const scriptData = await page.evaluate(`
    (function() {
      var scripts = document.querySelectorAll('script');
      var found = [];
      for (var i = 0; i < scripts.length; i++) {
        var content = scripts[i].textContent || '';
        // Look for photo arrays
        if (content.indexOf('photos') >= 0 || content.indexOf('images') >= 0) {
          if (content.indexOf('media.carsandbids') >= 0) {
            // Extract a sample
            var match = content.match(/photos[\\s]*[=:][\\s]*\\[([^\\]]{0,500})/);
            if (match) {
              found.push('Found photos array: ' + match[0].substring(0, 200));
            }
          }
        }
        // Look for Next.js/React state
        if (content.indexOf('__NEXT_DATA__') >= 0 || content.indexOf('window.__INITIAL_STATE__') >= 0) {
          found.push('Found app state data');
        }
      }
      return found;
    })()
  `);

  scriptData.forEach((s: string) => console.log(s));

  // Dump page HTML structure around gallery
  console.log('\n--- GALLERY HTML STRUCTURE ---');
  const galleryHtml = await page.evaluate(`
    (function() {
      // Find the main image container
      var mainImg = document.querySelector('img[src*="media.carsandbids.com"]');
      if (!mainImg) return 'No main image found';

      // Walk up to find the gallery container
      var parent = mainImg.parentElement;
      var depth = 0;
      while (parent && depth < 5) {
        if (parent.className && (
          parent.className.indexOf('gallery') >= 0 ||
          parent.className.indexOf('carousel') >= 0 ||
          parent.className.indexOf('photo') >= 0 ||
          parent.className.indexOf('slider') >= 0
        )) {
          break;
        }
        parent = parent.parentElement;
        depth++;
      }

      if (!parent) return 'No gallery container found';

      // Get outer HTML but truncate
      return {
        class: parent.className,
        childCount: parent.children.length,
        imgCount: parent.querySelectorAll('img').length,
        outerHtml: parent.outerHTML.substring(0, 1000)
      };
    })()
  `);

  console.log('Gallery container:', galleryHtml);

  console.log('\n\nKeeping browser open for 60 seconds for manual inspection...');
  console.log('HINT: Click on the main photo to see if gallery expands');
  await page.waitForTimeout(60000);

  await browser.close();
}

main().catch(console.error);

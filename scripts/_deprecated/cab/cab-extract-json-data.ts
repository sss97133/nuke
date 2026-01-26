/**
 * Extract any JSON data embedded in C&B pages
 * Many React apps embed full data in script tags
 */

import { chromium } from 'playwright';

const TEST_URL = 'https://carsandbids.com/auctions/r0Y2xP4K/2023-range-rover-sport-p530-deer-valley-edition';

async function main() {
  console.log('Extracting JSON data from C&B page...\n');

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
      console.log('Page loaded, found images');
      break;
    }
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(2000);

  // Extract all script contents looking for image data
  console.log('\n--- EXTRACTING SCRIPT DATA ---\n');

  const scriptData = await page.evaluate(`
    (function() {
      var results = {
        nextData: null,
        windowVars: [],
        imageArrays: [],
        totalImagesInDom: 0
      };

      // Check __NEXT_DATA__
      var nextDataEl = document.getElementById('__NEXT_DATA__');
      if (nextDataEl) {
        try {
          results.nextData = JSON.parse(nextDataEl.textContent);
        } catch(e) {}
      }

      // Check window variables
      ['__INITIAL_STATE__', '__NUXT__', '__DATA__', 'pageData', 'auctionData'].forEach(function(name) {
        if (window[name]) {
          results.windowVars.push(name);
        }
      });

      // Search all scripts for image arrays
      var scripts = document.querySelectorAll('script');
      for (var i = 0; i < scripts.length; i++) {
        var content = scripts[i].textContent || '';

        // Look for media.carsandbids URLs in arrays
        if (content.indexOf('media.carsandbids') >= 0) {
          // Try to find image arrays
          var matches = content.match(/\\[[^\\]]*media\\.carsandbids[^\\]]*\\]/g);
          if (matches) {
            matches.forEach(function(m) {
              if (m.length < 5000) {
                results.imageArrays.push(m.substring(0, 500));
              }
            });
          }

          // Look for photo/image properties
          var propMatches = content.match(/(photos|images|gallery)[\\s]*:[\\s]*\\[[^\\]]{0,200}/gi);
          if (propMatches) {
            results.imageArrays.push(...propMatches);
          }
        }
      }

      // Count DOM images
      var imgs = document.querySelectorAll('img[src*="media.carsandbids.com"]');
      for (var j = 0; j < imgs.length; j++) {
        var src = imgs[j].src || '';
        if (src.indexOf('width=80') < 0 || src.indexOf('height=80') < 0) {
          results.totalImagesInDom++;
        }
      }

      return results;
    })()
  `);

  console.log('Window variables found:', scriptData.windowVars);
  console.log('Images in DOM:', scriptData.totalImagesInDom);
  console.log('Image arrays found in scripts:', scriptData.imageArrays.length);

  if (scriptData.imageArrays.length > 0) {
    console.log('\nImage array samples:');
    scriptData.imageArrays.slice(0, 5).forEach((arr: string, i: number) => {
      console.log(`  ${i + 1}. ${arr.substring(0, 200)}...`);
    });
  }

  if (scriptData.nextData) {
    console.log('\n--- NEXT.JS DATA FOUND ---');
    console.log('Props keys:', Object.keys(scriptData.nextData.props || {}));

    // Look for image data in Next.js props
    const findImages = (obj: any, path: string = ''): string[] => {
      const found: string[] = [];
      if (!obj || typeof obj !== 'object') return found;

      if (Array.isArray(obj)) {
        obj.forEach((item, i) => {
          if (typeof item === 'string' && item.includes('media.carsandbids')) {
            found.push(`${path}[${i}]: ${item.substring(0, 100)}`);
          } else if (typeof item === 'object') {
            found.push(...findImages(item, `${path}[${i}]`));
          }
        });
      } else {
        for (const key of Object.keys(obj)) {
          const val = obj[key];
          if (typeof val === 'string' && val.includes('media.carsandbids')) {
            found.push(`${path}.${key}: ${val.substring(0, 100)}`);
          } else if (typeof val === 'object' && val !== null) {
            found.push(...findImages(val, `${path}.${key}`));
          }
        }
      }
      return found;
    };

    const nextImages = findImages(scriptData.nextData);
    console.log(`\nFound ${nextImages.length} image URLs in Next.js data`);
    if (nextImages.length > 0) {
      console.log('Sample paths:');
      nextImages.slice(0, 10).forEach((img: string) => console.log('  ', img));
    }

    // Check specific paths
    const pageProps = scriptData.nextData.props?.pageProps;
    if (pageProps) {
      console.log('\nPageProps keys:', Object.keys(pageProps));

      if (pageProps.auction) {
        console.log('Auction keys:', Object.keys(pageProps.auction));
        if (pageProps.auction.photos) {
          console.log('PHOTOS FOUND:', pageProps.auction.photos.length, 'items');
          console.log('Sample:', JSON.stringify(pageProps.auction.photos.slice(0, 2)));
        }
        if (pageProps.auction.images) {
          console.log('IMAGES FOUND:', pageProps.auction.images.length, 'items');
        }
      }
    }
  }

  // Also check for lazily loaded image data
  console.log('\n--- CHECKING LAZY LOAD SOURCES ---');
  const lazySources = await page.evaluate(`
    (function() {
      var sources = [];

      // Check data-src attributes
      var lazyImgs = document.querySelectorAll('[data-src*="media.carsandbids"]');
      for (var i = 0; i < lazyImgs.length; i++) {
        sources.push(lazyImgs[i].getAttribute('data-src'));
      }

      // Check srcset
      var srcsetImgs = document.querySelectorAll('[srcset*="media.carsandbids"]');
      for (var j = 0; j < srcsetImgs.length; j++) {
        sources.push(srcsetImgs[j].getAttribute('srcset').substring(0, 200));
      }

      // Check background images
      var allEls = document.querySelectorAll('*');
      for (var k = 0; k < allEls.length; k++) {
        var style = allEls[k].style.backgroundImage || '';
        if (style.indexOf('media.carsandbids') >= 0) {
          sources.push('bg: ' + style.substring(0, 200));
        }
      }

      return sources;
    })()
  `);

  console.log('Lazy-loaded sources found:', lazySources.length);
  if (lazySources.length > 0) {
    console.log('Samples:');
    lazySources.slice(0, 5).forEach((s: string) => console.log('  ', s?.substring(0, 120)));
  }

  // Get full page HTML and search for patterns
  console.log('\n--- SEARCHING PAGE SOURCE ---');
  const html = await page.content();
  const mediaMatches = html.match(/media\.carsandbids\.com[^"'\s]*/g) || [];
  const uniqueUrls = [...new Set(mediaMatches)];

  console.log('Total media.carsandbids URLs in HTML:', uniqueUrls.length);

  // Filter to photo URLs (not avatars)
  const photoUrls = uniqueUrls.filter(url =>
    url.includes('/photos/') &&
    !url.includes('width=80')
  );

  console.log('Photo URLs (not avatars):', photoUrls.length);
  console.log('Sample photo URLs:');
  photoUrls.slice(0, 10).forEach((url: string) => console.log('  ', url.substring(0, 120)));

  await browser.close();

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`Images in DOM: ${scriptData.totalImagesInDom}`);
  console.log(`Photo URLs in page source: ${photoUrls.length}`);
  console.log(`Next.js data present: ${!!scriptData.nextData}`);
}

main().catch(console.error);

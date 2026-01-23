/**
 * Find all image URLs from a C&B auction page
 * Try multiple methods: DOM, JSON data, page source
 */

import { chromium } from 'playwright';

const TEST_URL = 'https://carsandbids.com/auctions/9a7XbAL8/2022-porsche-911-carrera-cabriolet';

async function main() {
  console.log('Finding all images on C&B auction page...\n');

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

  // Get full page source
  const html = await page.content();

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('METHOD 1: Extract from page source (raw HTML)');
  console.log('═══════════════════════════════════════════════════════════════════');

  // Find all media.carsandbids URLs in the raw HTML
  const allUrls = html.match(/https?:\/\/media\.carsandbids\.com[^"'\s<>)]+/g) || [];
  const uniqueUrls = [...new Set(allUrls)];

  // Filter to photo URLs
  const photoUrls = uniqueUrls.filter(url =>
    url.includes('/photos/') && !url.includes('width=80')
  );

  // Find auction hash
  const hashMatch = photoUrls[0]?.match(/\/([a-f0-9]{32,})\//);
  const auctionHash = hashMatch ? hashMatch[1] : null;

  console.log('Total unique URLs in source:', uniqueUrls.length);
  console.log('Photo URLs (not avatars):', photoUrls.length);
  console.log('Auction hash:', auctionHash?.substring(0, 20) + '...');

  // Filter to this auction only
  const thisAuctionPhotos = photoUrls.filter(url => auctionHash && url.includes(auctionHash));
  console.log('Photos from THIS auction:', thisAuctionPhotos.length);

  // Sample
  console.log('\nSample photo URLs:');
  thisAuctionPhotos.slice(0, 5).forEach((url, i) => console.log(`  ${i + 1}. ${url.substring(0, 120)}`));

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('METHOD 2: Look for JSON data in scripts');
  console.log('═══════════════════════════════════════════════════════════════════');

  const scriptData = await page.evaluate(`
    (function() {
      var results = {
        photosInScripts: 0,
        jsonDataFound: false,
        photoArrayPath: null
      };

      // Search all script tags
      var scripts = document.querySelectorAll('script');
      for (var i = 0; i < scripts.length; i++) {
        var content = scripts[i].textContent || '';

        // Look for photo arrays
        if (content.indexOf('media.carsandbids') >= 0) {
          // Count how many URLs
          var matches = content.match(/media\\.carsandbids\\.com/g);
          if (matches && matches.length > results.photosInScripts) {
            results.photosInScripts = matches.length;
          }

          // Try to find a photo array
          if (content.indexOf('"photos"') >= 0 || content.indexOf("'photos'") >= 0) {
            results.photoArrayPath = 'Found photos key in script';
          }
        }

        // Check for Next.js data
        if (content.indexOf('__NEXT_DATA__') >= 0) {
          results.jsonDataFound = true;
        }
      }

      // Check __NEXT_DATA__ element
      var nextData = document.getElementById('__NEXT_DATA__');
      if (nextData) {
        results.jsonDataFound = true;
        try {
          var data = JSON.parse(nextData.textContent);
          var pageProps = data.props?.pageProps;
          if (pageProps?.auction?.photos) {
            results.photoArrayPath = 'pageProps.auction.photos (count: ' + pageProps.auction.photos.length + ')';
          }
        } catch(e) {}
      }

      return results;
    })()
  `);

  console.log('Photos found in scripts:', scriptData.photosInScripts);
  console.log('JSON data found:', scriptData.jsonDataFound);
  console.log('Photo array path:', scriptData.photoArrayPath);

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('METHOD 3: Extract from __NEXT_DATA__ if present');
  console.log('═══════════════════════════════════════════════════════════════════');

  const nextDataContent = await page.evaluate(`
    (function() {
      var el = document.getElementById('__NEXT_DATA__');
      if (!el) return null;
      try {
        var data = JSON.parse(el.textContent);
        return data.props?.pageProps?.auction || null;
      } catch(e) {
        return null;
      }
    })()
  `);

  if (nextDataContent) {
    console.log('Auction data keys:', Object.keys(nextDataContent));
    if (nextDataContent.photos) {
      console.log('Photos array length:', nextDataContent.photos.length);
      console.log('Sample photos:', JSON.stringify(nextDataContent.photos.slice(0, 2), null, 2));
    }
    if (nextDataContent.gallery) {
      console.log('Gallery:', nextDataContent.gallery);
    }
  } else {
    console.log('No __NEXT_DATA__ auction data found');
  }

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('METHOD 4: Check DOM for hidden/lazy images');
  console.log('═══════════════════════════════════════════════════════════════════');

  const domImages = await page.evaluate(`
    (function() {
      var results = {
        visibleImgs: 0,
        dataSrc: [],
        srcset: [],
        backgroundUrls: [],
        dataPhotos: []
      };

      // Visible images
      var imgs = document.querySelectorAll('img[src*="media.carsandbids.com"]');
      for (var i = 0; i < imgs.length; i++) {
        var src = imgs[i].src || '';
        if (src.indexOf('width=80') < 0 || src.indexOf('height=80') < 0) {
          results.visibleImgs++;
        }
      }

      // Data-src attributes
      var lazyImgs = document.querySelectorAll('[data-src*="media.carsandbids.com"]');
      for (var j = 0; j < lazyImgs.length; j++) {
        results.dataSrc.push(lazyImgs[j].getAttribute('data-src'));
      }

      // Srcset
      var srcsetEls = document.querySelectorAll('[srcset*="media.carsandbids.com"]');
      for (var k = 0; k < srcsetEls.length; k++) {
        results.srcset.push(srcsetEls[k].getAttribute('srcset'));
      }

      // Data-photos or data-images
      var dataEls = document.querySelectorAll('[data-photos], [data-images], [data-gallery]');
      for (var l = 0; l < dataEls.length; l++) {
        var attr = dataEls[l].getAttribute('data-photos') || dataEls[l].getAttribute('data-images') || dataEls[l].getAttribute('data-gallery');
        if (attr) results.dataPhotos.push(attr.substring(0, 500));
      }

      return results;
    })()
  `);

  console.log('Visible non-avatar images:', domImages.visibleImgs);
  console.log('Images with data-src:', domImages.dataSrc.length);
  console.log('Images with srcset:', domImages.srcset.length);
  console.log('Elements with data-photos:', domImages.dataPhotos.length);

  if (domImages.dataSrc.length > 0) {
    console.log('\nSample data-src:');
    domImages.dataSrc.slice(0, 3).forEach((src: string) => console.log('  ', src?.substring(0, 100)));
  }

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('Best method to get all images:');
  if (thisAuctionPhotos.length > domImages.visibleImgs) {
    console.log(`  -> PAGE SOURCE: ${thisAuctionPhotos.length} photos (vs ${domImages.visibleImgs} in DOM)`);
    console.log('  -> Parse HTML for media.carsandbids.com URLs');
  } else {
    console.log(`  -> DOM: ${domImages.visibleImgs} photos`);
  }

  await browser.close();
}

main().catch(console.error);

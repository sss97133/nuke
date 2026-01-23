/**
 * Full extraction with "All Photos" click - FIXED
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
  const initialCount = await extractImages(page);
  console.log('Initial:', initialCount.length, 'images');

  // Click "All Photos" to load all images
  console.log('\nClicking "All Photos"...');
  try {
    const allPhotosBtn = page.locator('text=/All Photos/i').first();
    if (await allPhotosBtn.isVisible({ timeout: 5000 })) {
      await allPhotosBtn.click();
      await page.waitForTimeout(3000);
    }
  } catch (e) {}

  // Scroll to load lazy images
  for (let i = 0; i < 10; i++) {
    await page.evaluate(`window.scrollBy(0, 500)`);
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(2000);

  // Extract all images from DOM
  const allImages = await extractImages(page);
  console.log('After clicking All Photos:', allImages.length, 'unique images');

  // Get photo count from page to verify
  const expected = await page.evaluate(`
    (function() {
      var text = document.body.innerText;
      var match = text.match(/All Photos\\s*\\((\\d+)\\)/i);
      return match ? parseInt(match[1]) : 0;
    })()
  `);

  console.log('Expected from page:', expected);
  console.log('Match:', allImages.length === expected ? 'YES' : 'CLOSE (' + Math.abs(expected - allImages.length) + ' diff)');

  // Show categorized
  const byCategory: Record<string, number> = {};
  allImages.forEach((img: any) => {
    byCategory[img.category] = (byCategory[img.category] || 0) + 1;
  });

  console.log('\nBy category:');
  Object.entries(byCategory).forEach(([cat, count]) => {
    console.log(`  ${cat}: ${count}`);
  });

  console.log('\nSample image URLs:');
  allImages.slice(0, 5).forEach((img: any, i: number) => {
    console.log(`  ${i + 1}. [${img.category}] ${img.fullResUrl.substring(0, 100)}...`);
  });

  await browser.close();
}

async function extractImages(page: any): Promise<any[]> {
  return page.evaluate(`
    (function() {
      // First find the auction hash from the main gallery image
      var auctionHash = null;
      var mainImg = document.querySelector('.gallery-preview img[src*="media.carsandbids.com"]');
      if (mainImg) {
        var hashMatch = mainImg.src.match(/\\/([a-f0-9]{32,})\\/photos\\//);
        if (hashMatch) auctionHash = hashMatch[1];
      }

      // Fallback: first large image
      if (!auctionHash) {
        var allImgs = document.querySelectorAll('img[src*="media.carsandbids.com"]');
        for (var ai = 0; ai < allImgs.length && !auctionHash; ai++) {
          var aiSrc = allImgs[ai].src || '';
          if (aiSrc.indexOf('width=80') >= 0 && aiSrc.indexOf('height=80') >= 0) continue;
          var aiMatch = aiSrc.match(/\\/([a-f0-9]{32,})\\/photos\\//);
          if (aiMatch) auctionHash = aiMatch[1];
        }
      }

      if (!auctionHash) return [];

      // Extract all images matching this auction
      var imgEls = document.querySelectorAll('img[src*="media.carsandbids.com"]');
      var images = [];
      var seenIds = {};

      for (var k = 0; k < imgEls.length; k++) {
        var img = imgEls[k];
        var src = img.src || '';

        // Skip avatars
        if (src.indexOf('width=80') >= 0 && src.indexOf('height=80') >= 0) continue;

        // Must be from this auction
        if (src.indexOf(auctionHash) < 0) continue;

        // Must be a photo
        if (src.indexOf('/photos/') < 0) continue;

        // Extract photo ID - the unique part is the photo name before .jpg
        // URL format: /photos/exterior/SHORTID-HASH/edit/FILENAME.jpg
        // or /photos/exterior/SHORTID-HASH.jpg
        var idMatch = src.match(/\\/photos\\/[^/]+\\/([^/]+)/);
        var photoId = idMatch ? idMatch[1] : null;

        if (!photoId) continue;

        // Skip duplicates by photo ID
        if (seenIds[photoId]) continue;
        seenIds[photoId] = true;

        // Convert to full res
        var fullRes = src.replace(/width=\\d+/, 'width=2080').replace(/,height=\\d+/, '');

        // Detect category
        var category = 'other';
        if (src.indexOf('/photos/exterior/') >= 0) category = 'exterior';
        else if (src.indexOf('/photos/interior/') >= 0) category = 'interior';
        else if (src.indexOf('/photos/mechanical/') >= 0) category = 'mechanical';
        else if (src.indexOf('/photos/docs/') >= 0) category = 'documentation';

        images.push({
          url: src,
          fullResUrl: fullRes,
          category: category,
          photoId: photoId
        });
      }

      return images;
    })()
  `);
}

main().catch(console.error);

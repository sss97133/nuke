/**
 * Test the API-based photo extraction on a single vehicle
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

  // Extract auction ID from URL
  const auctionIdMatch = TEST_URL.match(/\/auctions\/([A-Za-z0-9]+)\//);
  const auctionId = auctionIdMatch ? auctionIdMatch[1] : null;
  console.log('Auction ID:', auctionId);

  // Set up API response listener
  let apiPhotos: any = null;
  page.on('response', async (response) => {
    const url = response.url();
    if (auctionId && url.includes(`/v2/autos/auctions/${auctionId}`)) {
      try {
        const data = await response.json();
        if (data.listing?.photos) {
          apiPhotos = data.listing.photos;
          console.log('Captured API photos!');
        }
      } catch {}
    }
  });

  // Navigate to auction
  console.log('Loading auction...');
  await page.goto(TEST_URL, { waitUntil: 'load', timeout: 60000 });

  for (let i = 0; i < 15; i++) {
    const title = await page.title();
    if (!title.includes('Just a moment')) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(3000);

  // Check what we got
  console.log('\n=== API PHOTOS ===');
  if (!apiPhotos) {
    console.log('No API photos captured');
    await browser.close();
    return;
  }

  const baseUrl = apiPhotos.base_url || 'media.carsandbids.com';
  const allPhotos: any[] = [];

  // Extract photos from all categories
  const categories = ['exterior', 'interior', 'mechanical', 'docs', 'other'];
  for (const cat of categories) {
    const catPhotos = apiPhotos[cat];
    if (Array.isArray(catPhotos)) {
      console.log(`${cat}: ${catPhotos.length} photos`);
      for (const photo of catPhotos) {
        if (photo.link) {
          allPhotos.push({
            fullResUrl: `https://${baseUrl}/cdn-cgi/image/width=2080,quality=70/${photo.link}`,
            category: cat === 'docs' ? 'documentation' : cat,
            photoId: photo.id
          });
        }
      }
    }
  }

  console.log('\nTotal photos extracted:', allPhotos.length);

  // Show sample
  console.log('\nSample URLs:');
  allPhotos.slice(0, 5).forEach((p, i) => {
    console.log(`  ${i + 1}. [${p.category}] ${p.fullResUrl.substring(0, 100)}...`);
  });

  // Verify by category
  console.log('\n=== BY CATEGORY ===');
  const byCategory: Record<string, number> = {};
  allPhotos.forEach(p => {
    byCategory[p.category] = (byCategory[p.category] || 0) + 1;
  });
  Object.entries(byCategory).forEach(([cat, count]) => {
    console.log(`  ${cat}: ${count}`);
  });

  await browser.close();
}

main().catch(console.error);

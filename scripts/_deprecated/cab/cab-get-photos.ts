/**
 * Extract photos from auction API response
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

  // Capture the auction API response
  let auctionPhotos: any = null;

  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('/v2/autos/auctions/9a7XbAL8')) {
      try {
        const data = await response.json();
        auctionPhotos = data.listing?.photos;
        console.log('Captured photos from API!');
      } catch {}
    }
  });

  // Warm up
  await page.goto('https://carsandbids.com', { waitUntil: 'load' });
  for (let i = 0; i < 15; i++) {
    const title = await page.title();
    if (!title.includes('Just a moment')) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(3000);

  await page.goto(TEST_URL, { waitUntil: 'networkidle', timeout: 60000 });
  for (let i = 0; i < 15; i++) {
    const title = await page.title();
    if (!title.includes('Just a moment')) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(3000);

  console.log('\n=== PHOTOS FROM API ===');
  if (!auctionPhotos) {
    console.log('No photos found');
    await browser.close();
    return;
  }

  console.log('Type:', typeof auctionPhotos);
  console.log('Keys:', Object.keys(auctionPhotos));

  // Check different photo categories
  for (const key of Object.keys(auctionPhotos)) {
    const value = auctionPhotos[key];
    if (Array.isArray(value)) {
      console.log(`\n${key}: ${value.length} photos`);
      if (value.length > 0) {
        console.log('First photo:', JSON.stringify(value[0], null, 2));
      }
    } else if (typeof value === 'object' && value !== null) {
      console.log(`\n${key}: (object)`);
      console.log(JSON.stringify(value, null, 2).substring(0, 500));
    } else {
      console.log(`\n${key}: ${value}`);
    }
  }

  // Count total photos
  let totalPhotos = 0;
  let allPhotoUrls: string[] = [];

  for (const key of Object.keys(auctionPhotos)) {
    const value = auctionPhotos[key];
    if (Array.isArray(value)) {
      totalPhotos += value.length;
      value.forEach((photo: any) => {
        if (photo.path) {
          allPhotoUrls.push(`https://media.carsandbids.com/cdn-cgi/image/width=2080,quality=70/${photo.path}`);
        } else if (photo.url) {
          allPhotoUrls.push(photo.url);
        } else if (typeof photo === 'string') {
          allPhotoUrls.push(photo);
        }
      });
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log('Total photos from API:', totalPhotos);
  console.log('Photo URLs extracted:', allPhotoUrls.length);

  if (allPhotoUrls.length > 0) {
    console.log('\nSample URLs:');
    allPhotoUrls.slice(0, 10).forEach((url, i) => {
      console.log(`  ${i + 1}. ${url}`);
    });
  }

  await browser.close();
}

main().catch(console.error);

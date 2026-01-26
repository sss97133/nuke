/**
 * Capture the auction API response during page load
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
  let auctionApiResponse: any = null;

  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('/v2/autos/auctions/9a7XbAL8')) {
      try {
        const data = await response.json();
        auctionApiResponse = data;
        console.log('Captured auction API response!');
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

  console.log('Loading auction page...');
  await page.goto(TEST_URL, { waitUntil: 'networkidle', timeout: 60000 });
  for (let i = 0; i < 15; i++) {
    const title = await page.title();
    if (!title.includes('Just a moment')) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(3000);

  if (!auctionApiResponse) {
    console.log('No auction API response captured');
    await browser.close();
    return;
  }

  console.log('\n=== AUCTION API RESPONSE ===');
  console.log('Keys:', Object.keys(auctionApiResponse));

  // Check for photos in various locations
  const checkPhotos = (obj: any, path: string) => {
    if (!obj || typeof obj !== 'object') return;
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      if (key === 'photos' || key === 'images' || key === 'gallery') {
        if (Array.isArray(value)) {
          console.log(`\nFound ${key} at ${path}.${key}: ${value.length} items`);
          if (value.length > 0) {
            console.log('Sample:', JSON.stringify(value[0], null, 2));
          }
        } else {
          console.log(`\nFound ${key} at ${path}.${key}:`, typeof value);
        }
      }
      if (typeof value === 'object' && value !== null) {
        checkPhotos(value, `${path}.${key}`);
      }
    }
  };

  checkPhotos(auctionApiResponse, 'root');

  // Print submission data if present
  if (auctionApiResponse.submission_id) {
    console.log('\nSubmission ID:', auctionApiResponse.submission_id);
  }

  // Print the full structure
  console.log('\n=== FULL RESPONSE ===');
  console.log(JSON.stringify(auctionApiResponse, null, 2).substring(0, 5000));

  await browser.close();
}

main().catch(console.error);

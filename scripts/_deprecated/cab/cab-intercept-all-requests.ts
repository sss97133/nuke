/**
 * Intercept ALL network requests to find gallery API
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

  // Collect ALL XHR/fetch requests
  const apiRequests: {url: string, type: string, response?: string}[] = [];

  page.on('request', (request) => {
    const url = request.url();
    const type = request.resourceType();
    // Look for API calls
    if (type === 'xhr' || type === 'fetch' || url.includes('/api/') || url.includes('graphql')) {
      apiRequests.push({ url, type });
    }
  });

  page.on('response', async (response) => {
    const url = response.url();
    const type = response.request().resourceType();
    if (type === 'xhr' || type === 'fetch' || url.includes('/api/') || url.includes('graphql')) {
      try {
        const contentType = response.headers()['content-type'] || '';
        if (contentType.includes('json')) {
          const body = await response.text();
          // Check if it contains photo data
          if (body.includes('photos') || body.includes('media.carsandbids')) {
            const entry = apiRequests.find(r => r.url === url);
            if (entry) {
              entry.response = body.substring(0, 500);
            }
          }
        }
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

  console.log('API requests during load:', apiRequests.length);

  // Click All Photos
  try {
    await page.locator('text=/All Photos/i').first().click();
    await page.waitForTimeout(3000);
  } catch (e) {}

  console.log('API requests after All Photos click:', apiRequests.length);

  // Click main image
  try {
    await page.locator('.gallery-preview img').first().click();
    await page.waitForTimeout(3000);
  } catch (e) {}

  console.log('API requests after main image click:', apiRequests.length);

  // Navigate
  for (let i = 0; i < 50; i++) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(2000);

  console.log('API requests after navigation:', apiRequests.length);

  // Show all API requests
  console.log('\n=== ALL API REQUESTS ===');
  apiRequests.forEach((req, i) => {
    console.log(`${i + 1}. [${req.type}] ${req.url.substring(0, 100)}`);
    if (req.response) {
      console.log(`   Response: ${req.response.substring(0, 200)}...`);
    }
  });

  // Also check for any carsandbids API calls
  const cabApis = apiRequests.filter(r => r.url.includes('carsandbids.com') && !r.url.includes('media.'));
  console.log('\n=== C&B API CALLS ===');
  cabApis.forEach((req, i) => {
    console.log(`${i + 1}. ${req.url}`);
  });

  await browser.close();
}

main().catch(console.error);

/**
 * Directly fetch C&B auction API to get photo data
 */

import { chromium } from 'playwright';

const AUCTION_ID = '9a7XbAL8';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  // Warm up to get past Cloudflare and get cookies
  console.log('Warming up...');
  await page.goto('https://carsandbids.com', { waitUntil: 'load' });
  for (let i = 0; i < 15; i++) {
    const title = await page.title();
    if (!title.includes('Just a moment')) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(3000);

  // Get current timestamp
  const timestamp = Date.now();

  // Construct API URLs
  const auctionUrl = `https://carsandbids.com/v2/autos/auctions/${AUCTION_ID}?timestamp=${timestamp}`;
  const photosUrl = `https://carsandbids.com/v1/autos/auctions/${AUCTION_ID}/photos?timestamp=${timestamp}`;
  const submissionUrl = `https://carsandbids.com/v1/autos/submissions/r4qwO2zp?timestamp=${timestamp}`;

  console.log('\n=== FETCHING AUCTION API ===');
  console.log('URL:', auctionUrl);

  // Fetch using page.evaluate to use browser cookies
  const auctionData = await page.evaluate(async (url) => {
    try {
      const resp = await fetch(url);
      if (!resp.ok) return { error: `Status ${resp.status}` };
      return await resp.json();
    } catch (e: any) {
      return { error: e.message };
    }
  }, auctionUrl);

  if (auctionData.error) {
    console.log('Error:', auctionData.error);
  } else {
    console.log('Auction data keys:', Object.keys(auctionData));

    if (auctionData.photos) {
      console.log('Photos array length:', auctionData.photos.length);
      console.log('Sample photos:', JSON.stringify(auctionData.photos.slice(0, 3), null, 2));
    }
    if (auctionData.gallery) {
      console.log('Gallery:', auctionData.gallery);
    }
    if (auctionData.submission) {
      console.log('Submission keys:', Object.keys(auctionData.submission));
      if (auctionData.submission.photos) {
        console.log('Submission photos:', auctionData.submission.photos.length);
      }
    }

    // Print full structure (truncated)
    console.log('\nFull response (truncated):');
    console.log(JSON.stringify(auctionData, null, 2).substring(0, 3000));
  }

  // Try photos endpoint directly
  console.log('\n=== FETCHING PHOTOS API ===');
  console.log('URL:', photosUrl);

  const photosData = await page.evaluate(async (url) => {
    try {
      const resp = await fetch(url);
      if (!resp.ok) return { error: `Status ${resp.status}`, status: resp.status };
      return await resp.json();
    } catch (e: any) {
      return { error: e.message };
    }
  }, photosUrl);

  if (photosData.error) {
    console.log('Error:', photosData.error);
  } else {
    console.log('Photos data:', JSON.stringify(photosData, null, 2).substring(0, 2000));
  }

  // Try submission endpoint
  console.log('\n=== FETCHING SUBMISSION API ===');
  console.log('URL:', submissionUrl);

  const submissionData = await page.evaluate(async (url) => {
    try {
      const resp = await fetch(url);
      if (!resp.ok) return { error: `Status ${resp.status}` };
      return await resp.json();
    } catch (e: any) {
      return { error: e.message };
    }
  }, submissionUrl);

  if (submissionData.error) {
    console.log('Error:', submissionData.error);
  } else {
    console.log('Submission data keys:', Object.keys(submissionData));
    if (submissionData.photos) {
      console.log('Photos count:', submissionData.photos.length);
      console.log('Sample photos:', JSON.stringify(submissionData.photos.slice(0, 3), null, 2));
    }
    console.log('\nFull response (truncated):');
    console.log(JSON.stringify(submissionData, null, 2).substring(0, 3000));
  }

  await browser.close();
}

main().catch(console.error);

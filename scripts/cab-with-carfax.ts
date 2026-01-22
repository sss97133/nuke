/**
 * C&B extraction WITH Carfax data
 * Navigates from C&B to Carfax to maintain proper referrer
 */

import { chromium, Page } from 'playwright';

const TEST_URL = 'https://carsandbids.com/auctions/98YqkadQ/2018-ferrari-gtc4lusso-t';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  C&B + CARFAX EXTRACTION');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  // Warm up on C&B
  console.log('Warming up on C&B...');
  await page.goto('https://carsandbids.com', { waitUntil: 'load' });
  for (let i = 0; i < 15; i++) {
    const title = await page.title();
    if (!title.includes('Just a moment')) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(3000);

  // Go to auction
  console.log(`Loading auction: ${TEST_URL}\n`);
  await page.goto(TEST_URL, { waitUntil: 'load' });
  for (let i = 0; i < 15; i++) {
    const title = await page.title();
    if (!title.includes('Just a moment')) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(3000);

  // Extract C&B data first
  const cabData = await page.evaluate(`
    (function() {
      var result = {};
      var bodyText = document.body.innerText;

      // Carfax link
      var carfaxLink = document.querySelector('a.carfax, a[href*="carfax.com"]');
      result.carfaxUrl = carfaxLink ? carfaxLink.href : null;
      result.carfaxLinkSelector = carfaxLink ? 'found' : 'not found';

      // VIN
      var vinMatch = bodyText.match(/VIN[:\\s#]*([A-HJ-NPR-Z0-9]{17})/i);
      result.vin = vinMatch ? vinMatch[1] : null;

      return result;
    })()
  `);

  console.log('C&B Data:');
  console.log(`  VIN: ${cabData.vin}`);
  console.log(`  Carfax Link: ${cabData.carfaxLinkSelector}`);
  console.log(`  Carfax URL: ${cabData.carfaxUrl?.substring(0, 60)}...\n`);

  // Click the Carfax link to navigate with proper referrer
  if (cabData.carfaxUrl) {
    console.log('Clicking Carfax link to navigate with proper referrer...\n');

    // Create a new page for Carfax (opens in new tab)
    const carfaxPromise = context.waitForEvent('page');

    // Click the Carfax link
    await page.click('a.carfax, a[href*="carfax.com"]');

    // Wait for the new page
    const carfaxPage = await carfaxPromise;
    await carfaxPage.waitForLoadState('load');
    await carfaxPage.waitForTimeout(5000);

    const carfaxTitle = await carfaxPage.title();
    console.log(`Carfax page title: ${carfaxTitle}\n`);

    // Extract Carfax data
    const carfaxData = await carfaxPage.evaluate(`
      (function() {
        var result = {};
        var bodyText = document.body.innerText || '';

        // VIN
        var vinMatch = bodyText.match(/VIN[:\\s]*([A-HJ-NPR-Z0-9]{17})/i);
        result.vin = vinMatch ? vinMatch[1] : null;

        // Year/Make/Model - look for patterns
        result.vehicle = '';
        var h1 = document.querySelector('h1');
        if (h1) result.vehicle = h1.textContent || '';

        // Accidents
        result.accidentFree = bodyText.toLowerCase().indexOf('no accident') >= 0 ||
                              bodyText.toLowerCase().indexOf('0 accident') >= 0;
        result.hasAccident = bodyText.toLowerCase().indexOf('accident reported') >= 0 ||
                             bodyText.toLowerCase().indexOf('damage reported') >= 0;

        // Owners
        var ownersMatch = bodyText.match(/(\\d+)\\s*(?:-owner|owner)/i);
        result.owners = ownersMatch ? parseInt(ownersMatch[1], 10) : null;

        // Title
        result.cleanTitle = bodyText.toLowerCase().indexOf('clean title') >= 0;
        result.salvageTitle = bodyText.toLowerCase().indexOf('salvage') >= 0;

        // Service records count
        var serviceMatch = bodyText.match(/(\\d+)\\s*service\\s*record/i);
        result.serviceRecords = serviceMatch ? parseInt(serviceMatch[1], 10) : null;

        // Last odometer
        var odomMatch = bodyText.match(/([\\d,]+)\\s*(?:miles|mi)/i);
        result.lastOdometer = odomMatch ? odomMatch[1] : null;

        // History entries - look for date patterns
        var historyEntries = [];
        var datePattern = /(\\d{1,2}\\/\\d{1,2}\\/\\d{2,4})[^\\n]*?([\\d,]+)?\\s*(?:miles)?/gi;
        var match;
        while ((match = datePattern.exec(bodyText)) !== null && historyEntries.length < 10) {
          historyEntries.push({
            date: match[1],
            mileage: match[2] || null
          });
        }
        result.historyEntries = historyEntries;

        // Raw text
        result.rawText = bodyText.substring(0, 3000);

        return result;
      })()
    `);

    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('  CARFAX REPORT DATA');
    console.log('═══════════════════════════════════════════════════════════════════\n');

    console.log(`VIN: ${carfaxData.vin || 'NOT FOUND'}`);
    console.log(`Vehicle: ${carfaxData.vehicle || 'NOT FOUND'}`);
    console.log(`Owners: ${carfaxData.owners || 'UNKNOWN'}`);
    console.log(`Accidents: ${carfaxData.accidentFree ? 'NONE ✅' : carfaxData.hasAccident ? 'REPORTED ⚠️' : 'UNKNOWN'}`);
    console.log(`Title: ${carfaxData.cleanTitle ? 'CLEAN ✅' : carfaxData.salvageTitle ? 'SALVAGE ⚠️' : 'UNKNOWN'}`);
    console.log(`Service Records: ${carfaxData.serviceRecords || 'UNKNOWN'}`);
    console.log(`Last Odometer: ${carfaxData.lastOdometer || 'UNKNOWN'}`);

    if (carfaxData.historyEntries?.length > 0) {
      console.log('\nHistory Entries:');
      carfaxData.historyEntries.forEach((e: any) => {
        console.log(`  ${e.date} - ${e.mileage || 'N/A'} miles`);
      });
    }

    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log('  RAW TEXT PREVIEW');
    console.log('═══════════════════════════════════════════════════════════════════\n');
    console.log(carfaxData.rawText?.substring(0, 1500) || 'No text');

    await carfaxPage.close();
  } else {
    console.log('❌ No Carfax link found on auction page');
  }

  console.log('\n\nDone! Closing browser...');
  await browser.close();
}

main().catch(console.error);

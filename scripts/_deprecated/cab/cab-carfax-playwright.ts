/**
 * Carfax extraction using Playwright
 * Direct browser fetch since Firecrawl isn't configured
 */

import { chromium } from 'playwright';

const TEST_CARFAX_URL = 'https://www.carfax.com/vehiclehistory/ar20/SG09Ar9xmXBlwFpppiW7hFqyn3hP1HyRmv_ZBSg4i4EMnsFftK7c0UecN0PJTZH_QBiilK4j5sJcAUWvHZMSt3YFGo002FqSLsYnvSpJ';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  CARFAX EXTRACTION VIA PLAYWRIGHT');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  console.log(`Loading Carfax report...`);
  console.log(`URL: ${TEST_CARFAX_URL.substring(0, 60)}...\n`);

  await page.goto(TEST_CARFAX_URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(5000);

  // Check page content
  const title = await page.title();
  console.log(`Page title: ${title}\n`);

  // Extract data using string-based evaluate to avoid __name issue
  const data = await page.evaluate(`
    (function() {
      var result = {};
      var bodyText = document.body.innerText || '';
      var html = document.body.innerHTML || '';

      // VIN
      var vinMatch = bodyText.match(/VIN[:\\s]*([A-HJ-NPR-Z0-9]{17})/i);
      result.vin = vinMatch ? vinMatch[1] : null;

      // Year/Make/Model from title or content
      var ymmMatch = bodyText.match(/(\\d{4})\\s+(\\w+)\\s+(\\w+)/);
      result.year = ymmMatch ? ymmMatch[1] : null;
      result.make = ymmMatch ? ymmMatch[2] : null;
      result.model = ymmMatch ? ymmMatch[3] : null;

      // Accidents
      result.hasAccident = bodyText.toLowerCase().indexOf('accident reported') >= 0 ||
                           bodyText.toLowerCase().indexOf('damage reported') >= 0;
      result.accidentFree = bodyText.toLowerCase().indexOf('no accident') >= 0 ||
                            bodyText.toLowerCase().indexOf('accident-free') >= 0 ||
                            bodyText.toLowerCase().indexOf('0 accidents') >= 0;

      // Owners
      var ownersMatch = bodyText.match(/(\\d+)\\s*(?:owner|owners)/i);
      result.owners = ownersMatch ? parseInt(ownersMatch[1], 10) : null;

      // Title status
      result.cleanTitle = bodyText.toLowerCase().indexOf('clean title') >= 0;
      result.salvageTitle = bodyText.toLowerCase().indexOf('salvage') >= 0 ||
                            bodyText.toLowerCase().indexOf('rebuilt') >= 0;

      // Service records
      var serviceMatch = bodyText.match(/(\\d+)\\s*service\\s*records?/i);
      result.serviceRecords = serviceMatch ? parseInt(serviceMatch[1], 10) : null;

      // Odometer
      var odometerMatch = bodyText.match(/(?:odometer|mileage)[:\\s]*([0-9,]+)/i);
      result.lastOdometer = odometerMatch ? odometerMatch[1].replace(/,/g, '') : null;

      // Raw text for analysis
      result.rawText = bodyText.substring(0, 5000);

      return result;
    })()
  `);

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  CARFAX DATA EXTRACTED');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  console.log(`VIN: ${data.vin || 'NOT FOUND'}`);
  console.log(`Year/Make/Model: ${data.year} ${data.make} ${data.model}`);
  console.log(`Owners: ${data.owners || 'UNKNOWN'}`);
  console.log(`Accidents: ${data.accidentFree ? 'NONE ✅' : data.hasAccident ? 'REPORTED ⚠️' : 'UNKNOWN'}`);
  console.log(`Title: ${data.cleanTitle ? 'CLEAN ✅' : data.salvageTitle ? 'SALVAGE ⚠️' : 'UNKNOWN'}`);
  console.log(`Service Records: ${data.serviceRecords || 'UNKNOWN'}`);
  console.log(`Last Odometer: ${data.lastOdometer || 'UNKNOWN'}`);

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('  RAW TEXT PREVIEW');
  console.log('═══════════════════════════════════════════════════════════════════\n');
  console.log(data.rawText?.substring(0, 1500) || 'No text captured');

  // Keep browser open for inspection
  console.log('\n\nBrowser open for inspection. Press Ctrl+C to close.');
  await page.waitForTimeout(60000);

  await browser.close();
}

main().catch(console.error);

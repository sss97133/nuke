/**
 * Test script to debug dealer site scraping selectors
 */

import { chromium } from 'playwright';

const TEST_SOURCES = [
  { name: 'Gateway', url: 'https://www.gatewayclassiccars.com/vehicles?make=Chevrolet', type: 'gateway' },
  { name: 'Streetside', url: 'https://www.streetsideclassics.com/vehicles?make=Chevrolet', type: 'streetside' },
  { name: 'Hemmings', url: 'https://www.hemmings.com/classifieds/cars-for-sale/chevrolet/c10', type: 'hemmings' },
  { name: 'eBay Motors', url: 'https://www.ebay.com/sch/i.html?_nkw=chevrolet+c10&_sacat=6001', type: 'ebay' },
];

async function testDealerScrape(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  });

  for (const source of TEST_SOURCES) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing: ${source.name}`);
    console.log(`URL: ${source.url}`);
    console.log('='.repeat(60));

    try {
      const page = await context.newPage();
      await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Wait longer and scroll for dynamic/lazy content
      await page.waitForTimeout(2000);

      // Scroll down to trigger lazy loading
      await page.evaluate(() => window.scrollTo(0, 1000));
      await page.waitForTimeout(1000);
      await page.evaluate(() => window.scrollTo(0, 2000));
      await page.waitForTimeout(1500);

      // Debug: Get page info
      const debug = await page.evaluate(() => {
        const body = document.body;
        const allLinks = Array.from(document.querySelectorAll('a[href]'));

        // Find all links that might be vehicle listings
        const vehicleLinks = allLinks.filter(a => {
          const href = (a as HTMLAnchorElement).href.toLowerCase();
          return href.includes('vehicle') ||
                 href.includes('inventory') ||
                 href.includes('listing') ||
                 href.includes('/car/') ||
                 href.includes('/itm/') ||
                 href.includes('/classifieds/');
        });

        // Find links with numeric IDs (likely actual vehicle pages)
        const detailLinks = allLinks.filter(a => {
          const href = (a as HTMLAnchorElement).href;
          // Look for patterns like /vehicles/123 or /inventory/456 or /itm/789
          return /\/(vehicles?|inventory|listing|itm|classifieds)\/\d+/i.test(href) ||
                 /\/[A-Z]{3}-\d{4,}/i.test(href) ||  // Stock number patterns like PHX-1234
                 /\d{5,}/.test(href);  // Any long numeric ID
        });

        // Get sample of vehicle link patterns
        const linkPatterns = vehicleLinks.slice(0, 10).map(a => ({
          href: (a as HTMLAnchorElement).href,
          text: a.textContent?.trim().substring(0, 50),
          parent: a.parentElement?.className,
        }));

        // Sample of detail links (with numeric IDs)
        const detailSamples = detailLinks.slice(0, 10).map(a => ({
          href: (a as HTMLAnchorElement).href,
          text: a.textContent?.trim().substring(0, 100),
          classes: (a as HTMLAnchorElement).className,
        }));

        // Find potential vehicle cards
        const cards = Array.from(document.querySelectorAll('[class*="vehicle"], [class*="card"], [class*="item"], [class*="listing"]'));
        const cardSamples = cards.slice(0, 5).map(el => ({
          tag: el.tagName,
          classes: el.className,
          hasLink: !!el.querySelector('a'),
          text: el.textContent?.substring(0, 100),
        }));

        // Find inventory-item links specifically (Streetside pattern)
        const inventoryItems = Array.from(document.querySelectorAll('a.inventory-item, .inventory-item a, [class*="srp-item"] a, .s-item a'));
        const inventorySamples = inventoryItems.slice(0, 5).map(a => ({
          href: (a as HTMLAnchorElement).href,
          text: a.textContent?.trim().substring(0, 80),
        }));

        return {
          title: document.title,
          totalLinks: allLinks.length,
          vehicleLinkCount: vehicleLinks.length,
          detailLinkCount: detailLinks.length,
          linkPatterns,
          detailSamples,
          cardSamples,
          inventorySamples,
          bodyClasses: body.className,
        };
      });

      console.log(`Page title: ${debug.title}`);
      console.log(`Total links: ${debug.totalLinks}`);
      console.log(`Vehicle-related links: ${debug.vehicleLinkCount}`);
      console.log(`Detail links (with IDs): ${debug.detailLinkCount}`);

      console.log('\n>>> DETAIL LINKS (likely actual listings):');
      debug.detailSamples.forEach((dl, i) => {
        console.log(`  ${i + 1}. ${dl.href}`);
        console.log(`     Text: ${dl.text}`);
        console.log(`     Classes: ${dl.classes}`);
      });

      console.log('\n>>> INVENTORY ITEMS (specific selectors):');
      debug.inventorySamples.forEach((inv, i) => {
        console.log(`  ${i + 1}. ${inv.href}`);
        console.log(`     Text: ${inv.text}`);
      });

      console.log('\nSample vehicle links:');
      debug.linkPatterns.slice(0, 5).forEach((lp, i) => {
        console.log(`  ${i + 1}. ${lp.href}`);
      });

      await page.close();

    } catch (err: any) {
      console.log(`  Error: ${err.message}`);
    }
  }

  await browser.close();
  console.log('\n\nDone!');
}

testDealerScrape().catch(console.error);

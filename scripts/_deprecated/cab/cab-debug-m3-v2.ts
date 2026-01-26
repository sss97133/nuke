/**
 * Debug v2: BMW M3 - Use Playwright native clicks for load more
 */

import { chromium } from 'playwright';

const TEST_URL = 'https://carsandbids.com/auctions/KdlxGqJL/2008-bmw-m3-sedan';

async function main() {
  console.log('DEBUG v2: BMW M3 Comment Loading\n');

  const browser = await chromium.launch({ headless: false });
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

  // Go to auction
  console.log(`Loading: ${TEST_URL}\n`);
  await page.goto(TEST_URL, { waitUntil: 'load' });
  for (let i = 0; i < 15; i++) {
    const title = await page.title();
    if (!title.includes('Just a moment')) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(3000);

  // Initial count
  let count = await page.evaluate(`document.querySelectorAll('ul.thread > li').length`);
  console.log(`Initial comment elements: ${count}`);

  // Scroll to comments
  await page.evaluate(`document.querySelector('ul.thread')?.scrollIntoView()`);
  await page.waitForTimeout(1000);

  // Use Playwright's native click on the load more button
  console.log('\nClicking "Load more comments" with Playwright native click...');

  let attempts = 0;
  while (attempts < 10) {
    try {
      // Look for the specific load more comments button
      const loadMoreBtn = page.locator('button:has-text("Load more comments"), a:has-text("Load more comments")').first();

      if (await loadMoreBtn.isVisible({ timeout: 2000 })) {
        console.log(`  Attempt ${attempts + 1}: Found button, clicking...`);
        await loadMoreBtn.click();
        await page.waitForTimeout(1500);

        const newCount = await page.evaluate(`document.querySelectorAll('ul.thread > li').length`);
        console.log(`  Comment elements now: ${newCount}`);

        if (newCount === count) {
          console.log('  No new comments loaded, trying scroll...');
          await page.evaluate(`window.scrollBy(0, 500)`);
          await page.waitForTimeout(500);
        }
        count = newCount;
      } else {
        console.log('  Button not visible, stopping');
        break;
      }
    } catch (e: any) {
      console.log(`  Button not found: ${e.message}`);
      break;
    }
    attempts++;
  }

  // Also check for description data structure
  console.log('\n--- DESCRIPTION DATA STRUCTURE ---\n');

  const descData = await page.evaluate(`
    (function() {
      var result = {};
      var html = document.body.innerHTML;
      var text = document.body.innerText;

      // Equipment section
      var equipmentItems = [];
      var equipmentSection = html.match(/Equipment[\\s\\S]*?<ul[^>]*>([\\s\\S]*?)<\\/ul>/i);
      if (equipmentSection) {
        var liMatches = equipmentSection[1].match(/<li[^>]*>([^<]+)<\\/li>/gi);
        if (liMatches) {
          for (var i = 0; i < liMatches.length; i++) {
            var item = liMatches[i].replace(/<[^>]+>/g, '').trim();
            if (item) equipmentItems.push(item);
          }
        }
      }
      result.equipment = equipmentItems;

      // Known Flaws section
      var flawItems = [];
      var flawsSection = html.match(/Known Flaws[\\s\\S]*?<ul[^>]*>([\\s\\S]*?)<\\/ul>/i);
      if (flawsSection) {
        var flawLis = flawsSection[1].match(/<li[^>]*>([^<]+)<\\/li>/gi);
        if (flawLis) {
          for (var j = 0; j < flawLis.length; j++) {
            var flaw = flawLis[j].replace(/<[^>]+>/g, '').trim();
            if (flaw) flawItems.push(flaw);
          }
        }
      }
      result.knownFlaws = flawItems;

      // Modifications section
      var modItems = [];
      var modsSection = html.match(/Modifications[\\s\\S]*?<ul[^>]*>([\\s\\S]*?)<\\/ul>/i);
      if (modsSection) {
        var modLis = modsSection[1].match(/<li[^>]*>([^<]+)<\\/li>/gi);
        if (modLis) {
          for (var k = 0; k < modLis.length; k++) {
            var mod = modLis[k].replace(/<[^>]+>/g, '').trim();
            if (mod) modItems.push(mod);
          }
        }
      }
      result.modifications = modItems;

      // Service History section
      var serviceItems = [];
      var serviceSection = html.match(/(?:Recent )?Service History[\\s\\S]*?<ul[^>]*>([\\s\\S]*?)<\\/ul>/i);
      if (serviceSection) {
        var serviceLis = serviceSection[1].match(/<li[^>]*>([\\s\\S]*?)<\\/li>/gi);
        if (serviceLis) {
          for (var m = 0; m < serviceLis.length; m++) {
            var svc = serviceLis[m].replace(/<[^>]+>/g, '').trim();
            if (svc) serviceItems.push(svc);
          }
        }
      }
      result.serviceHistory = serviceItems;

      // Quick Facts (structured key-value)
      var quickFacts = {};
      var dtEls = document.querySelectorAll('.quick-facts dt, .auction-data dt');
      var ddEls = document.querySelectorAll('.quick-facts dd, .auction-data dd');
      for (var n = 0; n < dtEls.length && n < ddEls.length; n++) {
        var key = (dtEls[n].textContent || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
        var val = (ddEls[n].textContent || '').trim();
        if (key && val) quickFacts[key] = val;
      }
      result.quickFacts = quickFacts;

      // Auction result
      result.auctionResult = {
        sold: text.indexOf('Sold for') >= 0,
        reserveNotMet: text.indexOf('Bid to') >= 0 || text.indexOf('Reserve Not Met') >= 0,
        noSale: text.indexOf('No Sale') >= 0
      };

      var soldMatch = text.match(/Sold\\s*for\\s*\\$?([\\d,]+)/i);
      var bidToMatch = text.match(/Bid\\s*to\\s*\\$?([\\d,]+)/i);
      result.auctionResult.finalPrice = soldMatch ? parseInt(soldMatch[1].replace(/,/g, ''), 10) : null;
      result.auctionResult.highBid = bidToMatch ? parseInt(bidToMatch[1].replace(/,/g, ''), 10) : null;

      return result;
    })()
  `);

  console.log('Quick Facts:');
  Object.entries(descData.quickFacts || {}).forEach(([k, v]) => {
    console.log(`  ${k}: ${v}`);
  });

  console.log(`\nEquipment (${descData.equipment?.length || 0} items):`);
  (descData.equipment || []).slice(0, 10).forEach((e: string) => console.log(`  - ${e}`));

  console.log(`\nKnown Flaws (${descData.knownFlaws?.length || 0} items):`);
  (descData.knownFlaws || []).forEach((f: string) => console.log(`  - ${f}`));

  console.log(`\nModifications (${descData.modifications?.length || 0} items):`);
  (descData.modifications || []).forEach((m: string) => console.log(`  - ${m}`));

  console.log(`\nService History (${descData.serviceHistory?.length || 0} items):`);
  (descData.serviceHistory || []).slice(0, 10).forEach((s: string) => console.log(`  - ${s.substring(0, 80)}`));

  console.log('\nAuction Result:');
  console.log(`  Sold: ${descData.auctionResult.sold}`);
  console.log(`  Reserve Not Met: ${descData.auctionResult.reserveNotMet}`);
  console.log(`  No Sale: ${descData.auctionResult.noSale}`);
  console.log(`  Final Price: ${descData.auctionResult.finalPrice}`);
  console.log(`  High Bid: ${descData.auctionResult.highBid}`);

  // Final comment count
  const finalCount = await page.evaluate(`document.querySelectorAll('ul.thread > li').length`);
  console.log(`\nFinal comment elements: ${finalCount}`);

  await browser.close();
  console.log('\nDone.');
}

main().catch(console.error);

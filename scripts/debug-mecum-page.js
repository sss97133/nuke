#!/usr/bin/env node
import { chromium } from 'playwright';

async function debugMecumPage() {
  const url = process.argv[2] || 'https://www.mecum.com/lots/FL0125-550602/1958-cadillac-eldorado-biarritz-convertible/';

  console.log('Debugging:', url);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);

  // Scroll to load all content
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);
  }

  const debug = await page.evaluate(() => {
    const bodyText = document.body.innerText;

    // Look for price patterns
    const soldMatch = bodyText.match(/Sold\s*(?:For)?\s*\$?([\d,]+)/i);
    const highBidMatch = bodyText.match(/High\s*Bid\s*\$?([\d,]+)/i);
    const bidToMatch = bodyText.match(/Bid\s*To\s*\$?([\d,]+)/i);
    const notSoldMatch = bodyText.match(/Did\s*Not\s*Sell/i);

    // Look for any dollar amount
    const dollarMatches = bodyText.match(/\$[\d,]+/g)?.slice(0, 10);

    // Find text around SOLD
    const soldIdx = bodyText.search(/sold/i);
    const soldContext = soldIdx > -1 ? bodyText.slice(Math.max(0, soldIdx - 20), soldIdx + 80) : null;

    // Look for highlights section
    const highlightsStart = bodyText.indexOf('HIGHLIGHTS');
    const highlightsSection = highlightsStart > -1 ? bodyText.slice(highlightsStart, highlightsStart + 800) : null;

    // Equipment section
    const equipStart = bodyText.indexOf('EQUIPMENT');
    const equipSection = equipStart > -1 ? bodyText.slice(equipStart, equipStart + 500) : null;

    // First 2000 chars of page for debugging
    const pagePreview = bodyText.slice(0, 2000);

    // Look for any number patterns
    const numberPatterns = bodyText.match(/\d{1,3}(,\d{3})+/g)?.slice(0, 15);

    return {
      soldMatch: soldMatch?.[0],
      soldPrice: soldMatch?.[1],
      highBidMatch: highBidMatch?.[0],
      bidToMatch: bidToMatch?.[0],
      notSold: !!notSoldMatch,
      dollarMatches,
      numberPatterns,
      soldContext,
      highlightsSection,
      equipSection,
      bodyLength: bodyText.length,
      pagePreview
    };
  });

  console.log('\n=== PRICE DETECTION ===');
  console.log('Sold match:', debug.soldMatch);
  console.log('Sold price:', debug.soldPrice);
  console.log('High bid match:', debug.highBidMatch);
  console.log('Bid to match:', debug.bidToMatch);
  console.log('Not sold:', debug.notSold);
  console.log('Dollar amounts found:', debug.dollarMatches);
  console.log('Sold context:', debug.soldContext);

  console.log('\n=== HIGHLIGHTS ===');
  console.log(debug.highlightsSection?.slice(0, 500));

  console.log('\n=== EQUIPMENT ===');
  console.log(debug.equipSection?.slice(0, 300));

  console.log('\n=== NUMBER PATTERNS ===');
  console.log(debug.numberPatterns);

  console.log('\n=== PAGE PREVIEW (first 1500 chars) ===');
  console.log(debug.pagePreview?.slice(0, 1500));

  await browser.close();
}

debugMecumPage().catch(console.error);

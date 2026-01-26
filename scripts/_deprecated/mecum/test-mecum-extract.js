#!/usr/bin/env node
import { chromium } from 'playwright';

async function testExtract() {
  const url = process.argv[2] || 'https://www.mecum.com/lots/FL0125-550602/1958-cadillac-eldorado-biarritz-convertible/';

  console.log('Testing extraction on:', url);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);

  const data = await page.evaluate(() => {
    const bodyText = document.body.innerText;

    const findAfter = (label) => {
      const regex = new RegExp(label + '[:\\s]+([^\\n]+)', 'i');
      return bodyText.match(regex)?.[1]?.trim() || null;
    };

    const findSection = (start, end) => {
      const regex = new RegExp(start + '([\\s\\S]*?)' + end, 'i');
      return bodyText.match(regex)?.[1]?.trim() || null;
    };

    // === VEHICLE IDENTITY ===
    const vinMatch = bodyText.match(/VIN\s*\/?\s*SERIAL[:\s]+([A-Z0-9]+)/i);
    const title = document.querySelector('h1')?.innerText?.trim();

    // === AUCTION EVENT ===
    const lotMatch = bodyText.match(/LOT\s+([A-Z]?\d+)/i);
    const auctionMatch = bodyText.match(/\/\/\s*([A-Z]+\s+\d{4})/i);
    const dayMatch = bodyText.match(/(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY),?\s+([A-Z]+\s+\d+)/i);

    // === SALE RESULT ===
    const soldMatch = bodyText.match(/Sold\s*(?:For)?\s*\$?([\d,]+)/i);
    const highBidMatch = bodyText.match(/High\s*Bid\s*\$?([\d,]+)/i);
    const bidToMatch = bodyText.match(/Bid\s*To\s*\$?([\d,]+)/i);
    const notSoldMatch = bodyText.match(/Did\s*Not\s*Sell/i);

    // === SPECS ===
    const mileageMatch = bodyText.match(/ODOMETER[^\d]*([\d,]+)/i);

    // === HIGHLIGHTS ===
    const highlightsSection = findSection('HIGHLIGHTS', 'PHOTOS|EQUIPMENT|Information found');
    const highlights = highlightsSection?.split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 10 && s.length < 300 && !s.includes('VIEW ALL')) || [];

    // === EQUIPMENT ===
    const equipmentSection = findSection('EQUIPMENT', 'Information found|All rights');
    const equipment = equipmentSection?.split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 5 && s.length < 200) || [];

    // === IMAGES ===
    const images = [...document.querySelectorAll('img')]
      .map(i => i.src || i.dataset?.src)
      .filter(s => s && s.includes('mecum') && s.includes('upload'))
      .filter(s => !s.includes('logo') && !s.includes('icon'))
      .map(s => s.replace(/w_\d+/, 'w_1920').split('?')[0])
      .filter((v, i, a) => a.indexOf(v) === i);

    // Determine outcome
    let outcome = 'unknown';
    if (soldMatch) outcome = 'sold';
    else if (notSoldMatch) outcome = 'not_sold';
    else if (highBidMatch || bidToMatch) outcome = 'bid_to';

    return {
      vin: vinMatch?.[1],
      title,
      engine: findAfter('ENGINE'),
      transmission: findAfter('TRANSMISSION'),
      exterior_color: findAfter('EXTERIOR COLOR'),
      interior_color: findAfter('INTERIOR COLOR'),
      mileage: mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, '')) : null,
      highlights,
      equipment,
      images: images.length,
      auction_name: auctionMatch?.[1],
      lot_number: lotMatch?.[1],
      auction_day: dayMatch ? `${dayMatch[1]} ${dayMatch[2]}` : null,
      outcome,
      sold_price: soldMatch ? parseInt(soldMatch[1].replace(/,/g, '')) : null,
      high_bid: highBidMatch ? parseInt(highBidMatch[1].replace(/,/g, '')) : null,
      // Debug
      _highlightsSection: highlightsSection?.slice(0, 500)
    };
  });

  console.log('\n=== EXTRACTED DATA ===');
  console.log(JSON.stringify(data, null, 2));

  await browser.close();
}

testExtract().catch(console.error);

#!/usr/bin/env node
/**
 * Extract full __NEXT_DATA__ from Mecum page
 */

import { chromium } from 'playwright';

const URL = process.argv[2] || 'https://www.mecum.com/lots/550167/1978-pontiac-trans-am/';

async function extractNextData() {
  console.log(`\n🔍 Extracting NEXT_DATA from: ${URL}\n`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);

  // Extract __NEXT_DATA__
  const nextData = await page.evaluate(() => {
    const script = document.getElementById('__NEXT_DATA__');
    if (script) {
      try {
        return JSON.parse(script.textContent);
      } catch (e) {
        return { error: e.message, raw: script.textContent };
      }
    }
    return null;
  });

  if (!nextData) {
    console.log('No __NEXT_DATA__ found');
    await browser.close();
    return;
  }

  // Navigate to lot data
  const pageProps = nextData.props?.pageProps;

  console.log('=== PAGE PROPS KEYS ===');
  console.log(Object.keys(pageProps || {}));

  // Look for lot/vehicle data
  const lot = pageProps?.lot || pageProps?.data?.lot || pageProps?.vehicle;

  if (lot) {
    console.log('\n=== LOT DATA ===');
    console.log(JSON.stringify(lot, null, 2));
  }

  // Search entire object for price-related fields
  const findPriceFields = (obj, path = '') => {
    const results = [];
    if (!obj || typeof obj !== 'object') return results;

    for (const [key, value] of Object.entries(obj)) {
      const currentPath = path ? `${path}.${key}` : key;

      if (typeof key === 'string' &&
          (key.toLowerCase().includes('price') ||
           key.toLowerCase().includes('sold') ||
           key.toLowerCase().includes('bid') ||
           key.toLowerCase().includes('hammer') ||
           key.toLowerCase().includes('reserve') ||
           key.toLowerCase().includes('result') ||
           key.toLowerCase().includes('sale'))) {
        results.push({ path: currentPath, value });
      }

      if (typeof value === 'object' && value !== null) {
        results.push(...findPriceFields(value, currentPath));
      }
    }
    return results;
  };

  console.log('\n=== PRICE-RELATED FIELDS ===');
  const priceFields = findPriceFields(nextData);
  priceFields.forEach(f => {
    const val = typeof f.value === 'object' ? JSON.stringify(f.value) : f.value;
    console.log(`${f.path}: ${val}`);
  });

  // Search for auction/lot specific fields
  const findAuctionFields = (obj, path = '') => {
    const results = [];
    if (!obj || typeof obj !== 'object') return results;

    for (const [key, value] of Object.entries(obj)) {
      const currentPath = path ? `${path}.${key}` : key;

      if (typeof key === 'string' &&
          (key.toLowerCase().includes('auction') ||
           key.toLowerCase().includes('lot') ||
           key.toLowerCase().includes('event') ||
           key.toLowerCase().includes('date') ||
           key.toLowerCase().includes('location') ||
           key.toLowerCase().includes('venue'))) {
        results.push({ path: currentPath, value });
      }

      if (typeof value === 'object' && value !== null) {
        results.push(...findAuctionFields(value, currentPath));
      }
    }
    return results;
  };

  console.log('\n=== AUCTION/LOT FIELDS ===');
  const auctionFields = findAuctionFields(nextData);
  auctionFields.slice(0, 30).forEach(f => {
    const val = typeof f.value === 'object' ? JSON.stringify(f.value).slice(0, 200) : f.value;
    if (val && String(val).length < 300) {
      console.log(`${f.path}: ${val}`);
    }
  });

  // Look for vehicle/car specific data
  const findVehicleFields = (obj, path = '') => {
    const results = [];
    if (!obj || typeof obj !== 'object') return results;

    for (const [key, value] of Object.entries(obj)) {
      const currentPath = path ? `${path}.${key}` : key;

      if (typeof key === 'string' &&
          (key.toLowerCase() === 'vin' ||
           key.toLowerCase() === 'mileage' ||
           key.toLowerCase() === 'engine' ||
           key.toLowerCase() === 'transmission' ||
           key.toLowerCase() === 'exterior' ||
           key.toLowerCase() === 'interior' ||
           key.toLowerCase() === 'highlights' ||
           key.toLowerCase() === 'equipment' ||
           key.toLowerCase() === 'odometer' ||
           key.toLowerCase() === 'description')) {
        results.push({ path: currentPath, value });
      }

      if (typeof value === 'object' && value !== null) {
        results.push(...findVehicleFields(value, currentPath));
      }
    }
    return results;
  };

  console.log('\n=== VEHICLE FIELDS ===');
  const vehicleFields = findVehicleFields(nextData);
  vehicleFields.slice(0, 20).forEach(f => {
    const val = typeof f.value === 'object' ? JSON.stringify(f.value).slice(0, 300) : f.value;
    console.log(`${f.path}: ${val}`);
  });

  // Also get raw body text for result status
  const bodyText = await page.evaluate(() => document.body.innerText);

  console.log('\n=== SALE RESULT FROM PAGE TEXT ===');
  // Look for sale result
  const resultPatterns = [
    /SOLD\s*(?:FOR)?\s*\$?([\d,]+)/i,
    /BID\s*TO\s*\$?([\d,]+)/i,
    /HIGH\s*BID\s*\$?([\d,]+)/i,
    /DID\s*NOT\s*SELL/i,
    /NOT\s*SOLD/i,
    /RESERVE\s*NOT\s*MET/i,
    /NO\s*RESERVE/i,
    /HAMMER\s*PRICE\s*\$?([\d,]+)/i
  ];

  resultPatterns.forEach(p => {
    const match = bodyText.match(p);
    if (match) console.log(`  ${p.source}: ${match[0]}`);
  });

  // Check for specific Mecum result elements
  const resultInfo = await page.evaluate(() => {
    // Look for result banner/badge
    const resultEl = document.querySelector('[class*="result"], [class*="Result"], [class*="sold"], [class*="Sold"], [class*="badge"], [class*="Badge"]');
    const statusEl = document.querySelector('[class*="status"], [class*="Status"]');

    return {
      result: resultEl?.textContent?.trim(),
      status: statusEl?.textContent?.trim(),
      // Get all text that looks like a result
      resultText: [...document.querySelectorAll('*')]
        .filter(el => {
          const text = el.textContent?.toLowerCase() || '';
          return (text.includes('sold') || text.includes('bid') || text.includes('reserve')) &&
                 el.children.length === 0 &&
                 text.length < 50;
        })
        .map(el => el.textContent.trim())
        .filter((v, i, a) => a.indexOf(v) === i)
        .slice(0, 10)
    };
  });

  console.log('\n=== RESULT ELEMENTS ===');
  console.log(JSON.stringify(resultInfo, null, 2));

  await browser.close();
}

extractNextData().catch(console.error);

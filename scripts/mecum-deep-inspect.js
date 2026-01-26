#!/usr/bin/env node
/**
 * Deep inspection of Mecum page to find all hidden data
 */

import { chromium } from 'playwright';

const URL = process.argv[2] || 'https://www.mecum.com/lots/550167/1978-pontiac-trans-am/';

async function inspectPage() {
  console.log(`\n🔍 Deep inspection: ${URL}\n`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Capture network requests for API calls
  const apiResponses = [];
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('api') || url.includes('graphql') || url.includes('.json')) {
      try {
        const text = await response.text();
        if (text.includes('price') || text.includes('sold') || text.includes('bid')) {
          apiResponses.push({ url, data: text.slice(0, 1000) });
        }
      } catch (e) {}
    }
  });

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);

  const html = await page.content();

  console.log('=== 1. DOLLAR AMOUNTS IN PAGE ===');
  const prices = html.match(/\$[\d,]+/g) || [];
  console.log([...new Set(prices)].join(', '));

  console.log('\n=== 2. SOLD/BID TEXT PATTERNS ===');
  const bodyText = await page.evaluate(() => document.body.innerText);

  // Look for sale result patterns
  const patterns = [
    /sold\s*(?:for)?\s*\$?([\d,]+)/gi,
    /high\s*bid\s*\$?([\d,]+)/gi,
    /bid\s*to\s*\$?([\d,]+)/gi,
    /hammer\s*price\s*\$?([\d,]+)/gi,
    /final\s*(?:price|bid)\s*\$?([\d,]+)/gi,
    /winning\s*bid\s*\$?([\d,]+)/gi,
    /sale\s*price\s*\$?([\d,]+)/gi,
    /not\s*sold/gi,
    /reserve\s*not\s*met/gi,
    /no\s*sale/gi
  ];

  patterns.forEach(p => {
    const matches = bodyText.match(p);
    if (matches) console.log(`  ${p.source}: ${matches.join(', ')}`);
  });

  console.log('\n=== 3. AUCTION EVENT INFO ===');
  // Look for auction name, date, location
  const auctionPatterns = [
    /([A-Z][a-z]+\s+\d{4})\s*(?:Auction)?/g,  // "Glendale 2023"
    /(?:AUCTION|LOT)\s*#?\s*([A-Z0-9-]+)/gi,
    /(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY)[,\s]+([A-Z]+\s+\d+)/gi,
    /([A-Z][a-z]+,?\s+[A-Z]{2})\s*(?:\d{5})?/g,  // City, ST
  ];

  auctionPatterns.forEach(p => {
    const matches = bodyText.match(p);
    if (matches) console.log(`  ${p.source.slice(0, 30)}: ${[...new Set(matches)].slice(0, 3).join(', ')}`);
  });

  console.log('\n=== 4. JSON/DATA EMBEDDED IN SCRIPTS ===');
  const scriptData = await page.evaluate(() => {
    const results = [];

    // Look for __NEXT_DATA__ or similar
    const nextData = document.getElementById('__NEXT_DATA__');
    if (nextData) results.push({ type: 'NEXT_DATA', data: nextData.textContent.slice(0, 2000) });

    // Look for any script with JSON data
    document.querySelectorAll('script').forEach(script => {
      const text = script.textContent;
      if (text.includes('"price"') || text.includes('"sold"') || text.includes('"bid"') ||
          text.includes('"auction"') || text.includes('"lot"')) {
        results.push({ type: 'inline_script', data: text.slice(0, 2000) });
      }

      // Look for structured data (JSON-LD)
      if (script.type === 'application/ld+json') {
        results.push({ type: 'JSON-LD', data: text });
      }
    });

    // Look for data attributes on key elements
    const lotInfo = document.querySelector('[data-lot-info], [data-auction], [data-price]');
    if (lotInfo) results.push({ type: 'data-attr', data: lotInfo.outerHTML.slice(0, 500) });

    // Look for meta tags
    const metas = [...document.querySelectorAll('meta[property], meta[name]')]
      .filter(m => m.content && (m.content.includes('$') || m.getAttribute('property')?.includes('price')))
      .map(m => `${m.getAttribute('property') || m.getAttribute('name')}: ${m.content}`);
    if (metas.length) results.push({ type: 'meta', data: metas.join('\n') });

    return results;
  });

  scriptData.forEach(s => {
    console.log(`\n[${s.type}]`);
    console.log(s.data.slice(0, 800));
  });

  console.log('\n=== 5. API RESPONSES CAPTURED ===');
  apiResponses.forEach(r => {
    console.log(`\nURL: ${r.url}`);
    console.log(r.data);
  });

  console.log('\n=== 6. LOT/AUCTION SPECIFICS ===');
  const lotData = await page.evaluate(() => {
    const data = {};

    // Common selectors for auction sites
    const selectors = {
      lot: ['.lot-number', '[class*="lot"]', '[data-lot]'],
      price: ['.price', '.sale-price', '.sold-price', '[class*="price"]', '[class*="bid"]'],
      auction: ['.auction-name', '.event-name', '[class*="auction"]'],
      date: ['.auction-date', '.sale-date', '[class*="date"]'],
      location: ['.location', '.venue', '[class*="location"]']
    };

    Object.entries(selectors).forEach(([key, sels]) => {
      sels.forEach(sel => {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim()) {
          data[key] = data[key] || [];
          data[key].push({ selector: sel, text: el.textContent.trim().slice(0, 100) });
        }
      });
    });

    // Get all elements with "lot" in class
    const lotElements = [...document.querySelectorAll('[class*="lot"], [class*="Lot"]')]
      .map(el => ({ class: el.className, text: el.textContent.trim().slice(0, 100) }))
      .slice(0, 5);
    data.lotElements = lotElements;

    // Get all elements with price-like content
    const priceElements = [...document.querySelectorAll('*')]
      .filter(el => el.textContent.match(/\$[\d,]+/) && el.children.length === 0)
      .map(el => ({ class: el.className, text: el.textContent.trim().slice(0, 100) }))
      .slice(0, 10);
    data.priceElements = priceElements;

    return data;
  });

  console.log(JSON.stringify(lotData, null, 2));

  console.log('\n=== 7. FULL PAGE SECTIONS ===');
  // Get structured sections of the page
  const sections = await page.evaluate(() => {
    const results = {};

    // Get hero/header area
    const h1 = document.querySelector('h1');
    if (h1) results.title = h1.textContent.trim();

    // Look for info panels
    const panels = document.querySelectorAll('[class*="info"], [class*="detail"], [class*="spec"]');
    results.panels = [...panels].slice(0, 5).map(p => p.textContent.trim().slice(0, 300));

    // Look for result/status area
    const status = document.querySelector('[class*="result"], [class*="status"], [class*="sold"]');
    if (status) results.status = status.textContent.trim();

    return results;
  });

  console.log(JSON.stringify(sections, null, 2));

  await browser.close();
}

inspectPage().catch(console.error);

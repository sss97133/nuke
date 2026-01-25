#!/usr/bin/env node
import { chromium } from 'playwright';

const testUrl = 'https://www.mecum.com/lots/1096152/1972-datsun-240z/';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  console.log('Scraping:', testUrl);
  await page.goto(testUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  
  const data = await page.evaluate(() => {
    const getText = (sel) => document.querySelector(sel)?.innerText?.trim() || null;
    const getAll = (sel) => [...document.querySelectorAll(sel)].map(e => e.innerText?.trim()).filter(Boolean);
    
    const bodyText = document.body.innerText;
    
    // VIN pattern
    const vinMatch = bodyText.match(/VIN[:\s]+([A-HJ-NPR-Z0-9]{17})/i);
    
    // Mileage
    const mileageMatch = bodyText.match(/(\d{1,3}[,.]?\d{3})\s*(miles|mi\.?)/i);
    
    // Engine
    const engineMatch = bodyText.match(/(\d+\.?\d*)\s*[Ll](?:iter)?|([\d,]+)\s*[Cc][Cc]|(V\d+|inline|straight)/i);
    
    // Transmission  
    const transMatch = bodyText.match(/(\d-speed|automatic|manual|CVT)/i);
    
    // Images
    const images = [...document.querySelectorAll('img')]
      .map(i => i.src)
      .filter(s => s && s.includes('mecum') && s.includes('upload'))
      .slice(0, 20);
    
    // Lot details - look for definition lists
    const specs = {};
    document.querySelectorAll('dt').forEach(dt => {
      const key = dt.innerText?.trim();
      const dd = dt.nextElementSibling;
      if (dd && dd.tagName === 'DD') {
        specs[key] = dd.innerText?.trim();
      }
    });
    
    // Also look for table rows
    document.querySelectorAll('tr').forEach(tr => {
      const cells = tr.querySelectorAll('td, th');
      if (cells.length >= 2) {
        const key = cells[0].innerText?.trim();
        const val = cells[1].innerText?.trim();
        if (key && val && key.length < 50) specs[key] = val;
      }
    });
    
    // Highlights
    const highlights = getAll('ul li');
    
    // Description
    const description = getText('.lot-description, .description, [class*="description"]');
    
    // Price info
    const soldMatch = bodyText.match(/Sold\s*(?:For)?\s*\$?([\d,]+)/i);
    const bidMatch = bodyText.match(/High\s*Bid\s*\$?([\d,]+)/i);
    
    return {
      title: getText('h1'),
      vin: vinMatch?.[1] || specs['VIN'] || specs['Vin'] || null,
      mileage: mileageMatch ? parseInt(mileageMatch[1].replace(/[,.]/g, '')) : null,
      engine: engineMatch?.[0] || specs['Engine'] || null,
      transmission: transMatch?.[1] || specs['Transmission'] || null,
      soldPrice: soldMatch ? parseInt(soldMatch[1].replace(/,/g, '')) : null,
      highBid: bidMatch ? parseInt(bidMatch[1].replace(/,/g, '')) : null,
      images: images,
      highlights: highlights.filter(h => h.length > 10 && h.length < 200).slice(0, 10),
      specs: specs,
      description: description?.slice(0, 500),
      bodyPreview: bodyText.slice(0, 3000)
    };
  });
  
  console.log('\n=== EXTRACTED DATA ===');
  console.log('Title:', data.title);
  console.log('VIN:', data.vin);
  console.log('Mileage:', data.mileage);
  console.log('Engine:', data.engine);
  console.log('Transmission:', data.transmission);
  console.log('Sold Price:', data.soldPrice);
  console.log('High Bid:', data.highBid);
  console.log('Images:', data.images.length);
  console.log('Description:', data.description?.slice(0, 100));
  console.log('\n=== SPECS ===');
  console.log(JSON.stringify(data.specs, null, 2));
  console.log('\n=== HIGHLIGHTS ===');
  data.highlights.forEach(h => console.log('-', h));
  console.log('\n=== BODY PREVIEW ===');
  console.log(data.bodyPreview);
  
  await browser.close();
})();

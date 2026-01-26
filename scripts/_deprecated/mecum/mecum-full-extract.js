#!/usr/bin/env node
/**
 * Mecum FULL EXTRACTION - Get EVERYTHING from detail page
 */
import { chromium } from 'playwright';

const url = process.argv[2] || 'https://www.mecum.com/lots/550602/1958-cadillac-eldorado-biarritz-convertible/';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  console.log('Extracting:', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  
  const data = await page.evaluate(() => {
    const bodyText = document.body.innerText;
    const html = document.body.innerHTML;
    
    // Helper functions
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
    
    // === AUCTION EVENT INFO ===
    const lotMatch = bodyText.match(/LOT\s+([A-Z]?\d+)/i);
    const auctionMatch = bodyText.match(/([A-Z][a-z]+\s+\d{4})\s*$/m);  // "Monterey 2024"
    const dateMatch = bodyText.match(/(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY),?\s+([A-Z]+\s+\d+)/i);
    
    // === SALE RESULT ===
    const soldMatch = bodyText.match(/Sold\s*(?:For)?\s*\$?([\d,]+)/i);
    const highBidMatch = bodyText.match(/High\s*Bid\s*\$?([\d,]+)/i);
    const bidToMatch = bodyText.match(/Bid\s*To\s*\$?([\d,]+)/i);
    const reserveMatch = bodyText.match(/Reserve\s*(Not\s*Met|Met)/i);
    
    // === SPECS ===
    const specs = {};
    const specLabels = ['ENGINE', 'TRANSMISSION', 'EXTERIOR COLOR', 'INTERIOR COLOR', 
                        'MAKE', 'MODEL', 'BODY STYLE', 'DRIVETRAIN'];
    specLabels.forEach(label => {
      const val = findAfter(label);
      if (val) specs[label.toLowerCase().replace(' ', '_')] = val;
    });
    
    // === ODOMETER ===
    const mileageMatch = bodyText.match(/ODOMETER[^\d]*([\d,]+)/i);
    
    // === COLLECTION INFO ===
    const collectionMatch = bodyText.match(/(?:from|part of)\s+(?:the\s+)?([A-Z][^\.]+Collection)/i);
    
    // === PROVENANCE / HISTORY ===
    const provenanceSection = findSection('PROVENANCE', 'HIGHLIGHTS|EQUIPMENT|PHOTOS');
    
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
      .map(s => s.replace(/w_\d+/, 'w_1920').replace(/h_\d+/, 'h_1080'))
      .filter((v, i, a) => a.indexOf(v) === i);
    
    // === FULL TEXT for debugging ===
    return {
      // Vehicle identity
      vin: vinMatch?.[1],
      title,
      
      // Auction event
      lot_number: lotMatch?.[1],
      auction_name: auctionMatch?.[1],
      auction_day: dateMatch?.[1],
      auction_date: dateMatch?.[2],
      
      // Sale result
      sold_price: soldMatch ? parseInt(soldMatch[1].replace(/,/g, '')) : null,
      high_bid: highBidMatch ? parseInt(highBidMatch[1].replace(/,/g, '')) : null,
      bid_to: bidToMatch ? parseInt(bidToMatch[1].replace(/,/g, '')) : null,
      reserve_status: reserveMatch?.[1]?.toLowerCase().replace(' ', '_'),
      
      // Specs
      ...specs,
      mileage: mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, '')) : null,
      
      // Provenance
      collection: collectionMatch?.[1],
      provenance: provenanceSection,
      
      // Details
      highlights,
      equipment,
      
      // Media
      images,
      image_count: images.length,
      
      // Raw for debugging
      body_preview: bodyText.slice(0, 4000)
    };
  });
  
  console.log('\n' + '='.repeat(60));
  console.log('VEHICLE IDENTITY');
  console.log('='.repeat(60));
  console.log('VIN:', data.vin);
  console.log('Title:', data.title);
  
  console.log('\n' + '='.repeat(60));
  console.log('AUCTION EVENT');
  console.log('='.repeat(60));
  console.log('Lot #:', data.lot_number);
  console.log('Auction:', data.auction_name);
  console.log('Day:', data.auction_day, data.auction_date);
  console.log('Collection:', data.collection);
  
  console.log('\n' + '='.repeat(60));
  console.log('SALE RESULT');
  console.log('='.repeat(60));
  console.log('Sold Price:', data.sold_price ? '$' + data.sold_price.toLocaleString() : 'N/A');
  console.log('High Bid:', data.high_bid ? '$' + data.high_bid.toLocaleString() : 'N/A');
  console.log('Bid To:', data.bid_to ? '$' + data.bid_to.toLocaleString() : 'N/A');
  console.log('Reserve:', data.reserve_status || 'N/A');
  
  console.log('\n' + '='.repeat(60));
  console.log('SPECIFICATIONS');
  console.log('='.repeat(60));
  console.log('Engine:', data.engine);
  console.log('Trans:', data.transmission);
  console.log('Ext Color:', data.exterior_color);
  console.log('Int Color:', data.interior_color);
  console.log('Mileage:', data.mileage?.toLocaleString());
  console.log('Body:', data.body_style);
  
  console.log('\n' + '='.repeat(60));
  console.log('PROVENANCE');
  console.log('='.repeat(60));
  console.log(data.provenance || 'N/A');
  
  console.log('\n' + '='.repeat(60));
  console.log('HIGHLIGHTS (' + data.highlights.length + ')');
  console.log('='.repeat(60));
  data.highlights.slice(0, 10).forEach(h => console.log('•', h));
  
  console.log('\n' + '='.repeat(60));
  console.log('EQUIPMENT (' + data.equipment.length + ')');
  console.log('='.repeat(60));
  data.equipment.slice(0, 10).forEach(e => console.log('•', e));
  
  console.log('\n' + '='.repeat(60));
  console.log('IMAGES (' + data.image_count + ')');
  console.log('='.repeat(60));
  data.images.slice(0, 5).forEach(i => console.log(i.slice(0, 80) + '...'));
  
  await browser.close();
})();

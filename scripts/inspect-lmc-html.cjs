#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const testPart = '38-2166';

async function inspect() {
  console.log(`🔍 Inspecting LMC page for part: ${testPart}\n`);
  
  const url = `https://www.lmctruck.com/1973-87-chevy-gmc-truck/${testPart}.html`;
  
  const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      url,
      formats: ['markdown', 'html']
    })
  });

  const data = await response.json();
  
  // Save HTML to file
  fs.writeFileSync('/Users/skylar/nuke/lmc-page.html', data.data?.html || '');
  fs.writeFileSync('/Users/skylar/nuke/lmc-page.md', data.data?.markdown || '');
  
  console.log('✅ Saved to lmc-page.html and lmc-page.md');
  console.log(`\n📊 HTML length: ${data.data?.html?.length || 0}`);
  console.log(`📊 Markdown length: ${data.data?.markdown?.length || 0}`);
  
  // Look for common image patterns
  const html = data.data?.html || '';
  const imagePatterns = [
    /<img[^>]+src="([^"]+)"[^>]*>/gi,
    /data-src="([^"]+)"/gi,
    /srcset="([^"]+)"/gi,
    /"image"\s*:\s*"([^"]+)"/gi
  ];
  
  console.log('\n🖼️  Image URLs found:');
  const foundImages = new Set();
  
  imagePatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      if (match[1].includes('jpg') || match[1].includes('png') || match[1].includes('webp')) {
        foundImages.add(match[1].substring(0, 100));
      }
    }
  });
  
  Array.from(foundImages).slice(0, 10).forEach(img => console.log(`  - ${img}...`));
  
  // Look for price
  const pricePatterns = [
    /\$(\d+\.\d{2})/g,
    /price["\s:]+(\d+\.\d{2})/gi,
    /data-price="(\d+\.\d{2})"/gi
  ];
  
  console.log('\n💰 Prices found:');
  const foundPrices = new Set();
  
  pricePatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      foundPrices.add(match[1]);
    }
  });
  
  Array.from(foundPrices).slice(0, 5).forEach(price => console.log(`  - $${price}`));
}

inspect().catch(console.error);


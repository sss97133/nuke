#!/usr/bin/env node
/**
 * Find KSL listings using Firecrawl to bypass bot protection
 */

const FIRECRAWL_KEY = 'fc-12e25be3d7664da4984cd499adff7dc4';
const SEARCH_URL = process.argv[2] || 'https://cars.ksl.com/v2/search/make/Chevrolet/yearFrom/1970/yearTo/1991';

async function findListings() {
  console.log('🔍 Finding KSL listings with Firecrawl...\n');
  console.log(`URL: ${SEARCH_URL}\n`);
  
  try {
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FIRECRAWL_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: SEARCH_URL,
        waitFor: 3000,
        formats: ['html']
      })
    });
    
    if (!response.ok) {
      const error = await response.text();
      console.error(`❌ Error: ${response.status}`);
      console.error(error);
      return;
    }
    
    const data = await response.json();
    
    if (!data.success || !data.data?.html) {
      console.log('⚠️  No HTML returned');
      return;
    }
    
    // Extract listing URLs from HTML
    const html = data.data.html;
    const urlMatches = html.matchAll(/href=["']([^"']*\/listing\/\d+[^"']*)["']/gi);
    
    const urls = new Set();
    for (const match of urlMatches) {
      let url = match[1];
      if (url.startsWith('/')) {
        url = `https://cars.ksl.com${url}`;
      }
      if (url.includes('cars.ksl.com') && url.includes('/listing/')) {
        const cleanUrl = url.split('?')[0].split('#')[0];
        urls.add(cleanUrl);
      }
    }
    
    const listingUrls = Array.from(urls);
    
    console.log(`📋 Found ${listingUrls.length} listing URLs\n`);
    
    // Save to file
    const fs = await import('fs');
    fs.writeFileSync('ksl-listings-firecrawl.json', JSON.stringify(listingUrls, null, 2));
    console.log(`💾 Saved to ksl-listings-firecrawl.json\n`);
    
    // Display first 25
    console.log('Listing URLs found:');
    listingUrls.slice(0, 25).forEach((url, i) => {
      console.log(`  ${i + 1}. ${url}`);
    });
    
    return listingUrls;
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

findListings();


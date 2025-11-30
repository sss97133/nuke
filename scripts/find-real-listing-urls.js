/**
 * Find Real Listing URLs for Testing
 * 
 * Searches for actual vehicle listing URLs from various sources
 * that we can use to test the AI extraction system.
 */

import fetch from 'node-fetch';

const sources = [
  {
    name: 'ClassicCars.com',
    searchUrl: 'https://www.classiccars.com/search?q=1977+chevrolet+blazer',
    pattern: /href="(\/view\/\d+\/[^"]+)"/g
  },
  {
    name: 'Affordable Classics',
    searchUrl: 'https://www.affordableclassicsinc.com/inventory',
    pattern: /href="(\/vehicle\/\d+\/[^"]+)"/g
  }
];

async function findListingUrls() {
  console.log('🔍 Searching for real vehicle listing URLs...\n');
  
  for (const source of sources) {
    try {
      console.log(`Checking ${source.name}...`);
      const response = await fetch(source.searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; NukeBot/1.0)'
        }
      });
      
      if (!response.ok) {
        console.log(`  ❌ Failed: ${response.status}`);
        continue;
      }
      
      const html = await response.text();
      const matches = [...html.matchAll(source.pattern)];
      
      if (matches.length > 0) {
        const baseUrl = source.searchUrl.split('/').slice(0, 3).join('/');
        const urls = matches.slice(0, 3).map(m => baseUrl + m[1]);
        
        console.log(`  ✅ Found ${matches.length} listings`);
        console.log(`  📋 Sample URLs:`);
        urls.forEach((url, i) => {
          console.log(`     ${i + 1}. ${url}`);
        });
        console.log('');
        
        return urls[0]; // Return first URL for testing
      } else {
        console.log(`  ⚠️  No listings found`);
      }
    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
    }
  }
  
  return null;
}

// Run
findListingUrls().then(url => {
  if (url) {
    console.log(`\n🎯 Test URL found: ${url}`);
    console.log(`\nTo test, run:`);
    console.log(`curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-vehicle" \\`);
    console.log(`  -H "Authorization: Bearer YOUR_KEY" \\`);
    console.log(`  -H "Content-Type: application/json" \\`);
    console.log(`  -d '{"url": "${url}"}'`);
  } else {
    console.log('\n❌ No URLs found. Try manually finding a listing URL.');
  }
});


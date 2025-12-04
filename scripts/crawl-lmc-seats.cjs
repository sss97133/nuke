#!/usr/bin/env node
/**
 * CRAWL LMC SEATS CATEGORY
 * Find actual product URLs with part numbers
 */

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
require('dotenv').config();
const fs = require('fs');

async function crawlSeats() {
  console.log('🪑 CRAWLING LMC SEATS CATEGORY\n');
  
  const url = 'https://www.lmctruck.com/seats';
  
  // Start crawl
  const startResp = await fetch('https://api.firecrawl.dev/v1/crawl', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      url,
      limit: 100,
      scrapeOptions: {
        formats: ['markdown'],
        onlyMainContent: true
      }
    })
  });

  const startData = await startResp.json();
  const jobId = startData.id;
  
  console.log(`✅ Started job: ${jobId}\n`);
  console.log('⏳ Waiting for completion...\n');

  // Wait and check
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 10000));
    
    const statusResp = await fetch(`https://api.firecrawl.dev/v1/crawl/${jobId}`, {
      headers: { 'Authorization': `Bearer ${FIRECRAWL_API_KEY}` }
    });

    const status = await statusResp.json();
    console.log(`📊 ${status.status} | ${status.completed || 0}/${status.total || 0} pages`);

    if (status.status === 'completed') {
      console.log(`\n✅ COMPLETE! Pages: ${status.data?.length || 0}\n`);

      // Find product URLs (contain part numbers like 38-2166)
      const productUrls = [];
      status.data?.forEach(page => {
        const url = page.metadata?.sourceURL || page.url;
        if (url && url.match(/\d{2}-\d{4}/)) {
          productUrls.push(url);
        }
      });

      console.log(`🔗 Product URLs found: ${productUrls.length}\n`);
      
      // Show samples
      productUrls.slice(0, 20).forEach(url => console.log(`  ${url}`));

      // Save results
      fs.writeFileSync('/Users/skylar/nuke/lmc-seats-urls.json', JSON.stringify(productUrls, null, 2));
      console.log(`\n💾 Saved to lmc-seats-urls.json`);

      // Analyze URL pattern
      if (productUrls.length > 0) {
        const sample = productUrls[0];
        console.log(`\n🎯 URL Pattern discovered:`);
        console.log(`   ${sample}`);
        console.log(`\n💡 Pattern: https://www.lmctruck.com/{category}/{part-number}.html`);
      }

      break;
    }
  }
}

crawlSeats().catch(console.error);


#!/usr/bin/env node
/**
 * CRAWL LMC USING FIRECRAWL V1 API DIRECTLY
 */

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
require('dotenv').config();
const fs = require('fs');

async function crawlLMC() {
  console.log('='.repeat(70));
  console.log('🕷️  CRAWLING LMC WITH FIRECRAWL V1 API');
  console.log('='.repeat(70));
  
  const crawlUrl = 'https://www.lmctruck.com/chevy-gmc-truck-1973-1987';
  console.log(`\n🌐 URL: ${crawlUrl}`);
  console.log('⏱️  Starting crawl (may take 2-5 minutes)...\n');

  try {
    // Start crawl using v1 API
    const startResp = await fetch('https://api.firecrawl.dev/v1/crawl', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: crawlUrl,
        limit: 50, // Limit pages for testing
        scrapeOptions: {
          formats: ['markdown'],
          onlyMainContent: true
        }
      })
    });

    if (!startResp.ok) {
      const error = await startResp.text();
      console.error('❌ Start failed:', error);
      return;
    }

    const startData = await startResp.json();
    const jobId = startData.id;
    
    console.log(`✅ Crawl started!`);
    console.log(`   Job ID: ${jobId}`);
    console.log(`   Status URL: ${startData.url}\n`);
    console.log('⏳ Checking status every 10 seconds...\n');

    // Poll for status
    let attempts = 0;
    while (attempts < 60) { // Max 10 minutes
      await new Promise(r => setTimeout(r, 10000)); // Wait 10 seconds
      
      const statusResp = await fetch(`https://api.firecrawl.dev/v1/crawl/${jobId}`, {
        headers: {
          'Authorization': `Bearer ${FIRECRAWL_API_KEY}`
        }
      });

      const status = await statusResp.json();
      
      console.log(`📊 Status: ${status.status} | Completed: ${status.completed || 0}/${status.total || 0} pages | Credits: ${status.creditsUsed || 0}`);

      if (status.status === 'completed') {
        console.log(`\n✅ CRAWL COMPLETE!`);
        console.log(`   Total pages: ${status.data?.length || 0}`);
        console.log(`   Credits used: ${status.creditsUsed}`);

        // Extract product URLs
        const productUrls = [];
        if (status.data) {
          status.data.forEach(page => {
            const url = page.metadata?.sourceURL || page.url;
            if (url && (url.match(/\d{2}-\d{4}/) || url.includes('product'))) {
              productUrls.push({
                url,
                title: page.metadata?.title,
                markdown: page.markdown?.substring(0, 200)
              });
            }
          });
        }

        console.log(`\n🔗 Product URLs found: ${productUrls.length}`);

        // Save everything
        fs.writeFileSync('/Users/skylar/nuke/lmc-crawl-full.json', JSON.stringify(status, null, 2));
        fs.writeFileSync('/Users/skylar/nuke/lmc-product-urls.json', JSON.stringify(productUrls, null, 2));
        
        console.log(`💾 Saved:`);
        console.log(`   - lmc-crawl-full.json (complete crawl data)`);
        console.log(`   - lmc-product-urls.json (product URLs only)`);

        // Show sample
        console.log(`\n📦 Sample product URLs:`);
        productUrls.slice(0, 10).forEach(p => {
          console.log(`  ${p.url}`);
        });

        break;
      } else if (status.status === 'failed') {
        console.log(`\n❌ Crawl failed!`);
        break;
      }

      attempts++;
    }

    if (attempts >= 60) {
      console.log(`\n⏱️  Timeout reached. Crawl still running with job ID: ${jobId}`);
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
  }
}

crawlLMC();


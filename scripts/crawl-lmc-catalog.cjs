#!/usr/bin/env node
/**
 * CRAWL LMC CATALOG
 * Discovers all product URLs from LMC's 1973-1987 Chevy/GMC section
 */

require('dotenv').config();
const FirecrawlApp = require('@mendable/firecrawl-js').default;
const fs = require('fs');

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
if (!FIRECRAWL_API_KEY) {
  console.error('ERROR: FIRECRAWL_API_KEY environment variable is required');
  process.exit(1);
}

const firecrawl = new FirecrawlApp({ apiKey: FIRECRAWL_API_KEY });

async function crawlLMC() {
  console.log('='.repeat(70));
  console.log('🕷️  CRAWLING LMC CATALOG');
  console.log('='.repeat(70));
  console.log('\n🌐 Starting crawl: https://www.lmctruck.com/chevy-gmc-truck-1973-1987');
  console.log('⏱️  This will take several minutes...\n');

  try {
    // Start the crawl
    const crawlResult = await firecrawl.crawlUrl('https://www.lmctruck.com/chevy-gmc-truck-1973-1987', {
      limit: 100, // Limit to 100 pages for testing
      scrapeOptions: {
        formats: ['markdown'],
        onlyMainContent: true
      },
      poll_interval: 5
    });

    console.log(`\n✅ Crawl complete!`);
    console.log(`   Pages crawled: ${crawlResult.data?.length || 0}`);

    if (crawlResult.data && crawlResult.data.length > 0) {
      // Extract all URLs
      const urls = crawlResult.data.map(page => page.metadata?.sourceURL || page.url);
      
      // Find product URLs (containing part numbers)
      const productUrls = urls.filter(url => 
        url && (url.match(/\d{2}-\d{4}/) || url.includes('/p/') || url.includes('/products/'))
      );

      console.log(`\n🔗 Product URLs found: ${productUrls.length}`);
      
      // Save results
      fs.writeFileSync('/Users/skylar/nuke/lmc-crawl-results.json', JSON.stringify({
        total: urls.length,
        productUrls: productUrls,
        allPages: crawlResult.data.map(p => ({
          url: p.metadata?.sourceURL || p.url,
          title: p.metadata?.title
        }))
      }, null, 2));

      console.log(`💾 Saved to lmc-crawl-results.json`);

      // Show sample product URLs
      console.log(`\n📦 Sample product URLs:`);
      productUrls.slice(0, 10).forEach(url => console.log(`  - ${url}`));
      
      // Analyze URL patterns
      console.log(`\n🔍 URL patterns detected:`);
      const patterns = {};
      productUrls.forEach(url => {
        const path = url.replace('https://www.lmctruck.com', '');
        const parts = path.split('/').filter(Boolean);
        const pattern = parts.map(p => p.match(/\d/) ? '{id}' : p).join('/');
        patterns[pattern] = (patterns[pattern] || 0) + 1;
      });

      Object.entries(patterns)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .forEach(([pattern, count]) => {
          console.log(`  - /${pattern} (${count} URLs)`);
        });
    }

  } catch (error) {
    console.error('\n❌ Crawl error:', error.message);
    
    if (error.message.includes('timeout')) {
      console.log('\n💡 Crawl is still running. You can check status with the job ID.');
    }
  }
}

crawlLMC();


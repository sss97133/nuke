#!/usr/bin/env node
/**
 * REAL LMC SCRAPER
 * Based on actual LMC URL structure: /grilles/stock/cc-1973-74-grille-and-components
 * Images from: lmcnopstorage.blob.core.windows.net
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;


if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('ERROR: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
  process.exit(1);
}
if (!FIRECRAWL_API_KEY) {
  console.error('ERROR: FIRECRAWL_API_KEY environment variable is required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// LMC category URLs to crawl
const CATEGORIES = [
  'https://www.lmctruck.com/seats',
  'https://www.lmctruck.com/interior',
  'https://www.lmctruck.com/bumpers',
  'https://www.lmctruck.com/grilles',
  'https://www.lmctruck.com/lighting',
  'https://www.lmctruck.com/body-components',
  'https://www.lmctruck.com/mechanical',
];

async function crawlCategory(categoryUrl, maxPages = 50) {
  console.log(`\n📂 Crawling: ${categoryUrl}`);
  
  // Start crawl
  const startResp = await fetch('https://api.firecrawl.dev/v1/crawl', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      url: categoryUrl,
      limit: maxPages,
      scrapeOptions: {
        formats: ['html'],
        onlyMainContent: false // Get full page to find links
      }
    })
  });

  const startData = await startResp.json();
  const jobId = startData.id;
  
  console.log(`   Job: ${jobId}`);

  // Poll for completion
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 5000));
    
    const statusResp = await fetch(`https://api.firecrawl.dev/v1/crawl/${jobId}`, {
      headers: { 'Authorization': `Bearer ${FIRECRAWL_API_KEY}` }
    });

    const status = await statusResp.json();
    process.stdout.write(`\r   Status: ${status.completed || 0}/${status.total || 0} pages`);

    if (status.status === 'completed') {
      console.log(`\n   ✅ Complete!`);

      // Extract product URLs and images
      const products = [];
      
      status.data?.forEach(page => {
        const html = page.html || '';
        const url = page.metadata?.sourceURL || page.url;

        // Find main product image
        const imgMatch = html.match(/<img[^>]*id="main-product-img-\d+"[^>]*src="([^"]+)"/i) ||
                        html.match(/<img[^>]*class="[^"]*img-width-hotspot[^"]*"[^>]*src="([^"]+)"/i);
        
        if (imgMatch) {
          const imageUrl = imgMatch[1];
          
          // Extract part number from URL or HTML
          const partMatch = url.match(/(\d{2}-\d{4})/);
          
          if (partMatch) {
            products.push({
              part_number: partMatch[1],
              url,
              image_url: imageUrl,
              html_length: html.length
            });
          }
        }
      });

      console.log(`   📦 Products found: ${products.length}`);
      return products;
    }

    if (status.status === 'failed') {
      console.log(`\n   ❌ Failed`);
      return [];
    }
  }

  console.log(`\n   ⏱️  Timeout`);
  return [];
}

async function main() {
  const categoryLimit = parseInt(process.argv[2]) || 2; // How many categories to crawl
  
  console.log('='.repeat(70));
  console.log(`🚀 LMC PRODUCT IMAGE SCRAPER - ${categoryLimit} categories`);
  console.log('='.repeat(70));

  let allProducts = [];

  for (let i = 0; i < Math.min(categoryLimit, CATEGORIES.length); i++) {
    const products = await crawlCategory(CATEGORIES[i], 30);
    allProducts = allProducts.concat(products);
    
    console.log(`   Total so far: ${allProducts.length} products\n`);
    
    await new Promise(r => setTimeout(r, 2000)); // Brief pause between categories
  }

  console.log('\n' + '='.repeat(70));
  console.log(`📊 CRAWL SUMMARY`);
  console.log('='.repeat(70));
  console.log(`   Products found: ${allProducts.length}`);
  console.log(`   Updating database...\n`);

  // Update database
  let updated = 0;
  for (const product of allProducts) {
    const { error } = await supabase
      .from('catalog_parts')
      .update({
        product_image_url: product.image_url,
        supplier_url: product.url,
        in_stock: true // Assume in stock if we found it
      })
      .eq('part_number', product.part_number);

    if (!error) {
      updated++;
      if (updated % 10 === 0) {
        console.log(`   ✅ Updated ${updated}/${allProducts.length}`);
      }
    }
  }

  console.log(`\n✅ Database updated: ${updated} parts`);
  console.log('='.repeat(70));
}

main().catch(console.error);


#!/usr/bin/env node
/**
 * LMC BULK SCRAPER - COMPREHENSIVE
 * Crawls all LMC assembly pages, extracts images and part numbers
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

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

// All major LMC categories
const CATEGORIES_TO_CRAWL = [
  'https://www.lmctruck.com/grilles',
  'https://www.lmctruck.com/seats',
  'https://www.lmctruck.com/bumpers',
  'https://www.lmctruck.com/interior',
  'https://www.lmctruck.com/lighting',
  'https://www.lmctruck.com/body-components',
  'https://www.lmctruck.com/mechanical',
  'https://www.lmctruck.com/suspension',
  'https://www.lmctruck.com/electrical',
  'https://www.lmctruck.com/door-components',
];

async function crawlCategory(categoryUrl) {
  console.log(`\n🕷️  Crawling: ${categoryUrl}`);
  
  const startResp = await fetch('https://api.firecrawl.dev/v1/crawl', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      url: categoryUrl,
      limit: 200, // Get up to 200 pages per category
      scrapeOptions: {
        formats: ['html', 'markdown'],
        onlyMainContent: false
      }
    })
  });

  const { id: jobId } = await startResp.json();
  console.log(`   Job ID: ${jobId}`);

  // Poll for completion
  for (let i = 0; i < 120; i++) { // 20 minutes max
    await new Promise(r => setTimeout(r, 10000)); // Check every 10s
    
    const statusResp = await fetch(`https://api.firecrawl.dev/v1/crawl/${jobId}`, {
      headers: { 'Authorization': `Bearer ${FIRECRAWL_API_KEY}` }
    });

    const status = await statusResp.json();
    process.stdout.write(`\r   Progress: ${status.completed || 0}/${status.total || 0} pages (${status.creditsUsed || 0} credits)`);

    if (status.status === 'completed') {
      console.log(`\n   ✅ Complete!\n`);

      const products = [];

      status.data?.forEach(page => {
        const html = page.html || '';
        const markdown = page.markdown || '';
        const url = page.metadata?.sourceURL || page.url;

        // Find main product image (skip logo which is always first)
        const allImages = [...html.matchAll(/https:\/\/lmcnopstorage\.blob\.core\.windows\.net\/nopprodimages\/[^"<> ]*\.(?:png|jpg|jpeg)/gi)];
        const productImages = allImages.filter(m => !m[0].includes('logo'));
        const mainImage = productImages[0] ? productImages[0][0] : null;

        // Extract all part numbers from this page
        const partNumbers = [...markdown.matchAll(/(\d{2}-\d{4}(?:-[A-Z]+)?)/g)]
          .map(m => m[1])
          .filter((v, i, a) => a.indexOf(v) === i); // Unique only

        if (mainImage && partNumbers.length > 0) {
          products.push({
            url,
            image: mainImage,
            parts: partNumbers
          });
        }
      });

      console.log(`   📦 Assembly pages found: ${products.length}`);
      console.log(`   🔢 Total parts referenced: ${products.reduce((sum, p) => sum + p.parts.length, 0)}`);

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
  const categoryCount = parseInt(process.argv[2]) || 3;
  
  console.log('='.repeat(70));
  console.log(`🚀 LMC BULK SCRAPER - ${categoryCount} categories`);
  console.log('='.repeat(70));

  let allProducts = [];

  for (let i = 0; i < Math.min(categoryCount, CATEGORIES_TO_CRAWL.length); i++) {
    const products = await crawlCategory(CATEGORIES_TO_CRAWL[i]);
    allProducts = allProducts.concat(products);
    
    console.log(`\n   Running total: ${allProducts.length} assemblies found\n`);
    
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log('\n' + '='.repeat(70));
  console.log('📊 CRAWL COMPLETE');
  console.log('='.repeat(70));
  console.log(`   Assembly pages: ${allProducts.length}`);
  console.log(`   Updating database...\n`);

  // Update database
  let updated = 0;
  
  for (const assembly of allProducts) {
    for (const partNumber of assembly.parts) {
      const { error } = await supabase
        .from('catalog_parts')
        .update({
          product_image_url: assembly.image,
          supplier_url: assembly.url,
          in_stock: true // Found on LMC = in stock
        })
        .eq('part_number', partNumber);

      if (!error) updated++;
    }
  }

  console.log(`   ✅ Parts updated: ${updated}`);

  // Save detailed results
  fs.writeFileSync('/Users/skylar/nuke/lmc-scrape-results.json', JSON.stringify(allProducts, null, 2));
  console.log(`   💾 Results saved to lmc-scrape-results.json`);

  console.log('\n' + '='.repeat(70));
  console.log(`🎉 SUCCESS: ${updated} parts now have images!`);
  console.log('='.repeat(70));
}

main().catch(console.error);


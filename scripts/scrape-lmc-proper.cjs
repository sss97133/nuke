#!/usr/bin/env node
/**
 * PROPER LMC SCRAPER USING FIRECRAWL EXTRACT
 * Uses Firecrawl's structured extraction to get clean product data
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const FirecrawlApp = require('@mendable/firecrawl-js').default;

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
const firecrawl = new FirecrawlApp({ apiKey: FIRECRAWL_API_KEY });

// Schema for structured extraction
const productSchema = {
  type: 'object',
  properties: {
    part_number: { type: 'string' },
    name: { type: 'string' },
    price: { type: 'number' },
    image_url: { type: 'string' },
    description: { type: 'string' },
    in_stock: { type: 'boolean' },
    category: { type: 'string' },
    fits_years: { type: 'string' },
    fits_models: { 
      type: 'array',
      items: { type: 'string' }
    }
  }
};

async function scrapePartWithSearch(partNumber) {
  console.log(`\n🔍 Searching LMC for: ${partNumber}`);
  
  try {
    // Use Firecrawl SEARCH to find the product
    const searchResults = await firecrawl.search(
      `${partNumber} site:lmctruck.com`,
      {
        limit: 3,
        scrapeOptions: {
          formats: ['markdown', 'html']
        }
      }
    );

    console.log(`   📊 Found ${searchResults.data?.length || 0} search results`);

    if (!searchResults.data || searchResults.data.length === 0) {
      console.log(`   ⚠️  No results for ${partNumber}`);
      return null;
    }

    // Get the first result (most relevant)
    const firstResult = searchResults.data[0];
    const productUrl = firstResult.url;
    
    console.log(`   🎯 Product URL: ${productUrl}`);

    // Now use EXTRACT to get structured data from that page
    const extracted = await firecrawl.scrapeUrl(productUrl, {
      formats: ['extract'],
      extract: {
        schema: productSchema
      }
    });

    const productData = extracted.extract;
    
    console.log(`   💰 Price: $${productData.price || 'N/A'}`);
    console.log(`   📸 Image: ${productData.image_url ? 'Found' : 'Not found'}`);
    console.log(`   📦 Stock: ${productData.in_stock ? 'Yes' : 'No'}`);

    return {
      ...productData,
      url: productUrl
    };

  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return null;
  }
}

async function main() {
  const limit = parseInt(process.argv[2]) || 5;
  
  console.log('='.repeat(70));
  console.log(`🚀 PROPER FIRECRAWL LMC SCRAPER - ${limit} parts`);
  console.log('='.repeat(70));

  // Get parts without images
  const { data: parts } = await supabase
    .from('catalog_parts')
    .select('id, part_number, name, price_current, category')
    .is('product_image_url', null)
    .limit(limit);

  console.log(`\n📦 Processing ${parts.length} parts\n`);

  let success = 0;
  let failed = 0;

  for (const part of parts) {
    console.log(`[${success + failed + 1}/${parts.length}] ${part.part_number} - ${part.name}`);
    console.log(`   Current category: ${part.category || 'None'}`);
    
    const result = await scrapePartWithSearch(part.part_number);
    
    if (result && (result.image_url || result.price)) {
      // Update database with real data
      const updateData = {
        supplier_url: result.url,
        in_stock: result.in_stock ?? true
      };
      
      if (result.image_url) updateData.product_image_url = result.image_url;
      if (result.price) updateData.price_current = result.price;
      if (result.description) updateData.description = result.description;
      if (result.category) updateData.subcategory = result.category;

      const { error } = await supabase
        .from('catalog_parts')
        .update(updateData)
        .eq('id', part.id);

      if (!error) {
        console.log(`   ✅ DATABASE UPDATED`);
        success++;
      } else {
        console.log(`   ❌ DB error: ${error.message}`);
        failed++;
      }
    } else {
      console.log(`   ⚠️  No usable data found`);
      failed++;
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log('\n' + '='.repeat(70));
  console.log(`✅ COMPLETE: ${success} success, ${failed} failed`);
  console.log('='.repeat(70));
}

main().catch(console.error);


#!/usr/bin/env node
/**
 * LMC PRODUCT IMAGE SCRAPER - FIRECRAWL VERSION
 * Uses Firecrawl API to scrape product data from LMC website
 * Bypasses anti-bot protections and handles dynamic content
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const FirecrawlApp = require('@mendable/firecrawl-js').default;

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

// Get Firecrawl API key from command line args, environment, or Supabase
async function getFirecrawlApiKey() {
  // 1. Check command line argument: node script.cjs fc-xxx-xxx
  if (process.argv[2]) {
    return process.argv[2];
  }
  
  // 2. Check environment variable
  if (process.env.FIRECRAWL_API_KEY) {
    return process.env.FIRECRAWL_API_KEY;
  }
  
  // 3. Try to get from Supabase vault
  try {
    const { data, error } = await supabase
      .rpc('get_secret', { secret_name: 'FIRECRAWL_API_KEY' });
    
    if (data) {
      return data;
    }
  } catch (e) {
    // Vault might not be set up
  }
  
  console.error('❌ Error: FIRECRAWL_API_KEY not found');
  console.log('\n💡 Provide the API key in one of these ways:');
  console.log('   1. Command line: node scrape-lmc-firecrawl.cjs fc-your-key-here');
  console.log('   2. Environment: export FIRECRAWL_API_KEY="fc-your-key-here"');
  console.log('   3. Supabase vault: Store as FIRECRAWL_API_KEY secret');
  console.log('\n🔑 Get your API key from: https://www.firecrawl.dev/');
  process.exit(1);
}

async function scrapeProductWithFirecrawl(partNumber, firecrawl) {
  try {
    // Search LMC for this part number
    const searchUrl = `https://www.lmctruck.com/search?query=${encodeURIComponent(partNumber)}`;
    
    console.log(`   🔥 Firecrawl scraping: ${searchUrl}`);
    
    // Scrape the search page with Firecrawl
    const searchResult = await firecrawl.scrapeUrl(searchUrl, {
      formats: ['markdown', 'html'],
      onlyMainContent: true
    });

    if (!searchResult.success) {
      console.log(`   ⚠️  Firecrawl search failed`);
      return null;
    }

    // Extract product URL from the scraped content
    const markdown = searchResult.markdown || '';
    const html = searchResult.html || '';
    
    // Look for product links in the HTML
    const productLinkMatch = html.match(/href="([^"]*\/products\/[^"]*)"/);
    
    if (!productLinkMatch) {
      console.log(`   ⚠️  No product found for ${partNumber}`);
      return null;
    }

    let productUrl = productLinkMatch[1];
    if (!productUrl.startsWith('http')) {
      productUrl = `https://www.lmctruck.com${productUrl}`;
    }

    console.log(`   📄 Product page: ${productUrl}`);

    // Scrape the product page with Firecrawl
    const productResult = await firecrawl.scrapeUrl(productUrl, {
      formats: ['markdown', 'html'],
      onlyMainContent: true
    });

    if (!productResult.success) {
      console.log(`   ⚠️  Product page scrape failed`);
      return null;
    }

    const productHtml = productResult.html || '';
    const productMarkdown = productResult.markdown || '';

    // Extract data
    const data = {
      product_image_url: null,
      supplier_url: productUrl,
      description: null,
      in_stock: true,
      weight_lbs: null,
      subcategory: null,
      price: null
    };

    // Get main product image
    const imageMatch = productHtml.match(/src="([^"]*(?:product|item|image)[^"]*\.(?:jpg|jpeg|png|webp))"/i);
    if (imageMatch) {
      data.product_image_url = imageMatch[1].startsWith('http') 
        ? imageMatch[1] 
        : `https://www.lmctruck.com${imageMatch[1]}`;
    }

    // Get description from markdown (cleaner than HTML)
    const descLines = productMarkdown.split('\n')
      .filter(line => line.trim().length > 30 && !line.startsWith('#'))
      .slice(0, 3);
    
    if (descLines.length > 0) {
      data.description = descLines.join(' ').substring(0, 500);
    }

    // Check stock status
    const lowerContent = productMarkdown.toLowerCase() + productHtml.toLowerCase();
    data.in_stock = !lowerContent.includes('out of stock') && 
                     !lowerContent.includes('discontinued') &&
                     !lowerContent.includes('unavailable');

    // Get weight
    const weightMatch = productMarkdown.match(/(\d+\.?\d*)\s*lbs?/i);
    if (weightMatch) {
      data.weight_lbs = parseFloat(weightMatch[1]);
    }

    // Get price
    const priceMatch = productHtml.match(/\$(\d+\.?\d*)/);
    if (priceMatch) {
      data.price = parseFloat(priceMatch[1]);
    }

    // Get category from breadcrumb or URL
    const categoryMatch = productUrl.match(/\/([^\/]+)\/products/);
    if (categoryMatch) {
      data.subcategory = categoryMatch[1].replace(/-/g, ' ');
    }

    console.log(`   ✅ Data extracted successfully`);
    if (data.product_image_url) console.log(`      📸 Image: ${data.product_image_url.substring(0, 60)}...`);
    if (data.price) console.log(`      💰 Price: $${data.price}`);
    if (data.subcategory) console.log(`      📁 Subcategory: ${data.subcategory}`);

    return data;

  } catch (error) {
    console.log(`   ❌ Error scraping ${partNumber}:`, error.message);
    return null;
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('🔥 LMC PRODUCT SCRAPER - FIRECRAWL EDITION');
  console.log('='.repeat(70));

  // Get Firecrawl API key from Supabase
  console.log('\n🔑 Fetching Firecrawl API key from Supabase...');
  const FIRECRAWL_API_KEY = await getFirecrawlApiKey();
  console.log(`   ✅ API Key loaded: ${FIRECRAWL_API_KEY.substring(0, 10)}...`);
  
  const firecrawl = new FirecrawlApp({ apiKey: FIRECRAWL_API_KEY });

  // Get parts that need images
  console.log('\n📊 Fetching parts without images...');
  const { data: parts, error } = await supabase
    .from('catalog_parts')
    .select('id, part_number, name, category, price_current')
    .is('product_image_url', null)
    .limit(10); // Start with 10 to test

  if (error) {
    console.error('❌ Error fetching parts:', error);
    return;
  }

  console.log(`   Found ${parts.length} parts to process\n`);

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    console.log(`\n[${i + 1}/${parts.length}] ${part.part_number} - ${part.name}`);
    console.log(`   Category: ${part.category || 'Unknown'}`);
    console.log(`   Current Price: $${part.price_current || 'N/A'}`);

    const data = await scrapeProductWithFirecrawl(part.part_number, firecrawl);

    if (data) {
      // Update database
      const updateData = {
        product_image_url: data.product_image_url,
        supplier_url: data.supplier_url,
        description: data.description || part.name,
        in_stock: data.in_stock,
        subcategory: data.subcategory
      };

      // Update price if we found a new one
      if (data.price && data.price !== part.price_current) {
        updateData.price_current = data.price;
        console.log(`   💰 Price updated: $${part.price_current} → $${data.price}`);
      }

      if (data.weight_lbs) {
        updateData.weight_lbs = data.weight_lbs;
      }

      const { error: updateError } = await supabase
        .from('catalog_parts')
        .update(updateData)
        .eq('id', part.id);

      if (updateError) {
        console.log(`   ❌ Update failed:`, updateError.message);
        failCount++;
      } else {
        console.log(`   ✅ Database updated`);
        successCount++;
      }
    } else {
      failCount++;
    }

    // Rate limit - Firecrawl handles this but let's be conservative
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('\n' + '='.repeat(70));
  console.log('📊 SCRAPING SUMMARY');
  console.log('='.repeat(70));
  console.log(`   ✅ Success: ${successCount}`);
  console.log(`   ❌ Failed: ${failCount}`);
  console.log(`   📈 Success rate: ${((successCount / parts.length) * 100).toFixed(1)}%`);
  console.log('='.repeat(70));
  console.log('\n💡 To continue, run this script again (it processes 10 parts each time)');
}

main().catch(console.error);


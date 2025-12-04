#!/usr/bin/env node
/**
 * WORKING LMC SCRAPER
 * Uses Firecrawl to get real LMC product data
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

async function scrapePart(partNumber) {
  console.log(`\n🔥 Scraping: ${partNumber}`);
  
  // Use their main catalog search - they have predictable URLs
  const searchUrl = `https://www.lmctruck.com/icatalog/lmc/${partNumber}`;
  console.log(`   📍 URL: ${searchUrl}`);

  try {
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: searchUrl,
        formats: ['markdown', 'html'],
        waitFor: 2000 // Wait for JS to load
      })
    });

    if (!response.ok) {
      console.log(`   ❌ HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    const html = data.data?.html || '';
    const markdown = data.data?.markdown || '';

    // Save sample for debugging
    if (partNumber === '38-2166') {
      const fs = require('fs');
      fs.writeFileSync('/Users/skylar/nuke/lmc-catalog-page.html', html);
      fs.writeFileSync('/Users/skylar/nuke/lmc-catalog-page.md', markdown);
      console.log(`   💾 Saved sample to lmc-catalog-page.html/.md`);
    }

    // Extract price from markdown (cleaner)
    const priceMatch = markdown.match(/\$(\d+\.\d{2})/);
    const price = priceMatch ? parseFloat(priceMatch[1]) : null;

    // Extract image - look for product images
    const imagePatterns = [
      /src="(https:\/\/[^"]*\/images\/[^"]*\.jpg)"/i,
      /src="(https:\/\/lmcnop[^"]*\.jpg)"/i,
      /"image":"([^"]*\.jpg)"/i,
      /data-zoom-image="([^"]*)"/i
    ];

    let imageUrl = null;
    for (const pattern of imagePatterns) {
      const match = html.match(pattern);
      if (match) {
        imageUrl = match[1];
        break;
      }
    }

    // Check stock
    const inStock = !markdown.toLowerCase().includes('out of stock') && 
                    !html.toLowerCase().includes('discontinued') &&
                    !html.toLowerCase().includes('item not found');

    console.log(`   💰 Price: ${price ? `$${price}` : 'Not found'}`);
    console.log(`   📸 Image: ${imageUrl ? 'Found' : 'Not found'}`);
    console.log(`   📦 Stock: ${inStock ? 'Yes' : 'No'}`);

    return {
      price,
      imageUrl,
      inStock,
      url: searchUrl
    };

  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return null;
  }
}

async function main() {
  const limit = parseInt(process.argv[2]) || 5;
  
  console.log('='.repeat(70));
  console.log(`🚀 LMC FIRECRAWL SCRAPER - Processing ${limit} parts`);
  console.log('='.repeat(70));

  // Get parts without images
  const { data: parts } = await supabase
    .from('catalog_parts')
    .select('id, part_number, name, price_current')
    .is('product_image_url', null)
    .limit(limit);

  console.log(`\nFound ${parts.length} parts to scrape\n`);

  let success = 0;
  let failed = 0;

  for (const part of parts) {
    const result = await scrapePart(part.part_number);
    
    if (result && (result.imageUrl || result.price)) {
      // Update database
      const updateData = {
        supplier_url: result.url,
        in_stock: result.inStock
      };
      
      if (result.imageUrl) updateData.product_image_url = result.imageUrl;
      if (result.price) updateData.price_current = result.price;

      const { error } = await supabase
        .from('catalog_parts')
        .update(updateData)
        .eq('id', part.id);

      if (!error) {
        console.log(`   ✅ Updated database`);
        success++;
      } else {
        console.log(`   ❌ DB error: ${error.message}`);
        failed++;
      }
    } else {
      failed++;
    }

    await new Promise(r => setTimeout(r, 2000)); // Rate limit
  }

  console.log('\n' + '='.repeat(70));
  console.log(`✅ Complete: ${success} success, ${failed} failed`);
  console.log('='.repeat(70));
}

main().catch(console.error);


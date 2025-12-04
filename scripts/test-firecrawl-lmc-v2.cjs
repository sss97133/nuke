#!/usr/bin/env node
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
  
  // Try direct product URL instead of search
  const directUrl = `https://www.lmctruck.com/1973-87-chevy-gmc-truck/${partNumber}.html`;
  console.log(`   📍 Trying: ${directUrl}`);

  const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      url: directUrl,
      formats: ['markdown', 'html']
    })
  });

  if (!response.ok) {
    console.log(`   ❌ Failed: ${response.status}`);
    return null;
  }

  const data = await response.json();
  const html = data.data?.html || '';
  const markdown = data.data?.markdown || '';

  // Extract image
  const imageMatch = html.match(/<img[^>]*src="([^"]*(?:jpg|jpeg|png|webp))"[^>]*class="[^"]*picture[^"]*"/i) ||
                     html.match(/itemprop="image"[^>]*content="([^"]*)"/i) ||
                     html.match(/<meta property="og:image" content="([^"]*)"/i);
  
  const imageUrl = imageMatch ? imageMatch[1] : null;

  // Extract price
  const priceMatch = markdown.match(/\$(\d+\.\d{2})/) || html.match(/itemprop="price" content="(\d+\.\d{2})"/);
  const price = priceMatch ? parseFloat(priceMatch[1]) : null;

  // Check stock
  const inStock = !markdown.toLowerCase().includes('out of stock') && 
                  !markdown.toLowerCase().includes('discontinued');

  // Extract description
  const descMatch = html.match(/itemprop="description"[^>]*>([^<]{50,500})</i);
  const description = descMatch ? descMatch[1].trim().substring(0, 300) : null;

  console.log(`   📸 Image: ${imageUrl ? 'Found' : 'Not found'}`);
  console.log(`   💰 Price: ${price || 'Not found'}`);
  console.log(`   📦 Stock: ${inStock ? 'In stock' : 'Out of stock'}`);
  if (description) console.log(`   📝 Desc: ${description.substring(0, 80)}...`);

  return { imageUrl, price, inStock, description, url: directUrl };
}

async function main() {
  console.log('🚀 FIRECRAWL LMC SCRAPER TEST\n');

  // Get 3 test parts
  const { data: parts } = await supabase
    .from('catalog_parts')
    .select('id, part_number, name, price_current')
    .is('product_image_url', null)
    .limit(3);

  console.log(`Found ${parts.length} parts to test\n`);

  for (const part of parts) {
    const result = await scrapePart(part.part_number);
    
    if (result && result.imageUrl) {
      // Update database
      const { error } = await supabase
        .from('catalog_parts')
        .update({
          product_image_url: result.imageUrl,
          supplier_url: result.url,
          price_current: result.price || part.price_current,
          in_stock: result.inStock,
          description: result.description || part.name
        })
        .eq('id', part.id);

      if (error) {
        console.log(`   ❌ DB error: ${error.message}`);
      } else {
        console.log(`   ✅ Updated in database`);
      }
    }

    await new Promise(r => setTimeout(r, 2000)); // Rate limit
  }

  console.log('\n✅ Test complete!');
}

main().catch(console.error);


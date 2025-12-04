#!/usr/bin/env node
/**
 * FINAL LMC SCRAPER
 * Uses Firecrawl MAP API directly to discover LMC URLs, then scrapes them
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

async function findProductUrl(partNumber) {
  // Try common LMC URL patterns
  const urlPatterns = [
    `https://www.lmctruck.com/products/${partNumber}`,
    `https://www.lmctruck.com/p/${partNumber}`,
    `https://www.lmctruck.com/item/${partNumber}`,
    `https://www.lmctruck.com/catalog/${partNumber}`,
  ];

  for (const url of urlPatterns) {
    try {
      const resp = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          url,
          formats: ['markdown']
        })
      });

      if (resp.ok) {
        const data = await resp.json();
        const markdown = data.data?.markdown || '';
        
        // Check if it's a valid product page (not 404)
        if (!markdown.includes('404') && !markdown.includes('not found') && markdown.length > 200) {
          return url;
        }
      }
    } catch (e) {
      // Continue to next pattern
    }
  }

  return null;
}

async function scrapeProduct(url) {
  const resp = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      url,
      formats: ['markdown', 'html']
    })
  });

  if (!resp.ok) return null;

  const data = await resp.json();
  const html = data.data?.html || '';
  const markdown = data.data?.markdown || '';

  // Extract all img src URLs
  const images = [];
  const imgRegex = /<img[^>]+src="([^"]+)"/gi;
  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    const src = match[1];
    if (src.includes('.jpg') || src.includes('.png') || src.includes('.webp')) {
      if (!src.startsWith('data:')) {
        images.push(src.startsWith('http') ? src : `https://www.lmctruck.com${src}`);
      }
    }
  }

  // Find main product image (usually largest or first non-logo)
  const productImage = images.find(img => 
    !img.includes('logo') && 
    !img.includes('icon') &&
    !img.includes('banner')
  );

  // Extract price
  const priceMatch = markdown.match(/\$(\d+\.\d{2})/);
  const price = priceMatch ? parseFloat(priceMatch[1]) : null;

  // Check stock
  const inStock = !markdown.toLowerCase().includes('out of stock');

  return {
    imageUrl: productImage,
    price,
    inStock,
    allImages: images.slice(0, 5)
  };
}

async function main() {
  const limit = parseInt(process.argv[2]) || 5;
  
  console.log('='.repeat(70));
  console.log(`🚀 FINAL LMC SCRAPER - ${limit} parts`);
  console.log('='.repeat(70));

  const { data: parts } = await supabase
    .from('catalog_parts')
    .select('id, part_number, name, price_current')
    .is('product_image_url', null)
    .limit(limit);

  console.log(`\n📦 Testing ${parts.length} parts\n`);

  let success = 0;

  for (const part of parts) {
    console.log(`[${success +1}/${parts.length}] ${part.part_number}`);
    
    // Find working URL
    const url = await findProductUrl(part.part_number);
    
    if (!url) {
      console.log(`  ⚠️  No valid URL found\n`);
      continue;
    }

    console.log(`  ✅ URL: ${url}`);

    // Scrape the product
    const data = await scrapeProduct(url);
    
    if (data) {
      console.log(`  💰 Price: $${data.price || 'N/A'}`);
      console.log(`  📸 Image: ${data.imageUrl || 'None'}`);
      console.log(`  🖼️  All images: ${data.allImages.length}`);
      data.allImages.forEach(img => console.log(`     - ${img.substring(0, 80)}...`));

      if (data.imageUrl || data.price) {
        const updateData = {
          supplier_url: url,
          in_stock: data.inStock
        };
        
        if (data.imageUrl) updateData.product_image_url = data.imageUrl;
        if (data.price) updateData.price_current = data.price;

        const { error } = await supabase
          .from('catalog_parts')
          .update(updateData)
          .eq('id', part.id);

        if (!error) {
          console.log(`  ✅ UPDATED IN DATABASE`);
          success++;
        }
      }
    }
    
    console.log();
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log('='.repeat(70));
  console.log(`✅ SUCCESS: ${success}/${parts.length} parts updated`);
  console.log('='.repeat(70));
}

main().catch(console.error);


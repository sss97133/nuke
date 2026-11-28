#!/usr/bin/env node
/**
 * LMC PRODUCT IMAGE SCRAPER
 * Fetches product images and metadata from LMC website for each part
 */

import guardUnqualifiedCatalogWrites from './guard-unqualified-lmc-writes.cjs';
guardUnqualifiedCatalogWrites();
const { createClient } = await import('@supabase/supabase-js');
const { default: fetch } = await import('node-fetch');
const cheerio = await import('cheerio');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;


if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('ERROR: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function scrapeProductData(partNumber) {
  try {
    // Search LMC for this part number
    const searchUrl = `https://www.lmctruck.com/search?query=${encodeURIComponent(partNumber)}`;
    
    console.log(`   🔍 Searching: ${searchUrl}`);
    const searchResp = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });

    if (!searchResp.ok) {
      console.log(`   ⚠️  Search failed: ${searchResp.status}`);
      return null;
    }

    const searchHtml = await searchResp.text();
    const $search = cheerio.load(searchHtml);

    // Find first product link
    const productLink = $search('a.product-link, a[href*="/products/"]').first().attr('href');
    
    if (!productLink) {
      console.log(`   ⚠️  No product found for ${partNumber}`);
      return null;
    }

    const productUrl = productLink.startsWith('http') 
      ? productLink 
      : `https://www.lmctruck.com${productLink}`;

    console.log(`   📄 Product page: ${productUrl}`);

    // Fetch product page
    const productResp = await fetch(productUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });

    if (!productResp.ok) {
      console.log(`   ⚠️  Product page failed: ${productResp.status}`);
      return null;
    }

    const productHtml = await productResp.text();
    const $ = cheerio.load(productHtml);

    // Extract data
    const data = {
      product_image_url: null,
      supplier_url: productUrl,
      description: null,
      in_stock: true,
      weight_lbs: null,
      subcategory: null
    };

    // Get main product image
    const imageEl = $('img.product-image, img[data-product-image], .product-images img').first();
    if (imageEl.length) {
      let imgSrc = imageEl.attr('src') || imageEl.attr('data-src');
      if (imgSrc) {
        data.product_image_url = imgSrc.startsWith('http') 
          ? imgSrc 
          : `https://www.lmctruck.com${imgSrc}`;
      }
    }

    // Get description
    const descEl = $('.product-description, .description, [itemprop="description"]').first();
    if (descEl.length) {
      data.description = descEl.text().trim().substring(0, 500);
    }

    // Check stock status
    const stockText = $('body').text().toLowerCase();
    data.in_stock = !stockText.includes('out of stock') && 
                     !stockText.includes('discontinued') &&
                     !stockText.includes('unavailable');

    // Get weight if available
    const weightMatch = $('body').text().match(/(\d+\.?\d*)\s*lbs?/i);
    if (weightMatch) {
      data.weight_lbs = parseFloat(weightMatch[1]);
    }

    // Get breadcrumb for subcategory
    const breadcrumbs = $('.breadcrumb a, .breadcrumbs a');
    if (breadcrumbs.length > 1) {
      data.subcategory = breadcrumbs.eq(breadcrumbs.length - 2).text().trim();
    }

    console.log(`   ✅ Data extracted successfully`);
    if (data.product_image_url) console.log(`      📸 Image: ${data.product_image_url.substring(0, 60)}...`);
    if (data.subcategory) console.log(`      📁 Subcategory: ${data.subcategory}`);

    return data;

  } catch (error) {
    console.log(`   ❌ Error scraping ${partNumber}:`, error.message);
    return null;
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('🖼️  LMC PRODUCT IMAGE SCRAPER');
  console.log('='.repeat(70));

  // Get parts that need images
  console.log('\n📊 Fetching parts without images...');
  const { data: parts, error } = await supabase
    .from('catalog_parts')
    .select('id, part_number, name, category')
    .is('product_image_url', null)
    .limit(50); // Process 50 at a time

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

    const data = await scrapeProductData(part.part_number);

    if (data) {
      // Update database
      const { error: updateError } = await supabase
        .from('catalog_parts')
        .update({
          product_image_url: data.product_image_url,
          supplier_url: data.supplier_url,
          description: data.description || part.name,
          in_stock: data.in_stock,
          weight_lbs: data.weight_lbs,
          subcategory: data.subcategory
        })
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

    // Rate limit - be nice to LMC servers
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log('\n' + '='.repeat(70));
  console.log('📊 SCRAPING SUMMARY');
  console.log('='.repeat(70));
  console.log(`   ✅ Success: ${successCount}`);
  console.log(`   ❌ Failed: ${failCount}`);
  console.log(`   📈 Success rate: ${((successCount / parts.length) * 100).toFixed(1)}%`);
  console.log('='.repeat(70));
}

main().catch(console.error);


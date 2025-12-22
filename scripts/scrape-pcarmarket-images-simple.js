#!/usr/bin/env node
/**
 * SIMPLE PCARMARKET IMAGE EXTRACTOR
 * 
 * Extracts image URLs from PCarMarket HTML (works with provided HTML samples)
 * Can also use the scrape-vehicle edge function if available
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Use the scrape-vehicle edge function to extract images
 */
async function extractImagesViaEdgeFunction(url) {
  try {
    console.log('   Using scrape-vehicle edge function...');
    const response = await fetch(`${supabaseUrl}/functions/v1/scrape-vehicle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`
      },
      body: JSON.stringify({ url })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();
    
    if (result.success && result.data?.images) {
      console.log(`   ✅ Found ${result.data.images.length} images`);
      return result.data.images.filter(url => url && (url.includes('cloudfront.net') || url.includes('pcarmarket')));
    }
    
    return [];
  } catch (error) {
    console.log(`   ⚠️  Edge function failed: ${error.message}`);
    return [];
  }
}

/**
 * Extract images from HTML content
 */
function extractImagesFromHTML(html) {
  const images = new Set();
  
  // All possible image URL patterns
  const patterns = [
    // Standard img src
    /<img[^>]+src=["']([^"']+)["'][^>]*>/gi,
    // data-src
    /data-src=["']([^"']+)["']/gi,
    // data-lazy-src
    /data-lazy-src=["']([^"']+)["']/gi,
    // JSON arrays
    /"(https?:\/\/[^"]*\.(?:jpg|jpeg|png|webp)[^"]*)"/gi,
    // CloudFront CDN patterns
    /(https?:\/\/d2niwqq19lf86s\.cloudfront\.net[^"'\s<>]+)/gi,
    // Gallery paths
    /(https?:\/\/[^"'\s]*\/galleries\/[^"'\s]*\.(?:jpg|jpeg|png|webp))/gi
  ];
  
  patterns.forEach(pattern => {
    const matches = html.matchAll(pattern);
    for (const match of matches) {
      const url = match[1];
      if (url && (url.includes('cloudfront.net') || url.includes('pcarmarket'))) {
        // Clean URL (remove query params, get full size)
        const cleanUrl = url.split('?')[0].split('&')[0];
        if (!cleanUrl.includes('thumb') && !cleanUrl.includes('thumbnail') && !cleanUrl.includes('-150x')) {
          images.add(cleanUrl);
        }
      }
    }
  });
  
  return Array.from(images);
}

async function main() {
  const url = process.argv[2];
  const vehicleId = process.argv[3];
  
  if (!url) {
    console.log('Usage: node scripts/scrape-pcarmarket-images-simple.js <auction_url> [vehicle_id]');
    process.exit(1);
  }
  
  console.log(`\n🔍 Extracting images from: ${url}\n`);
  
  // Try edge function first
  let images = await extractImagesViaEdgeFunction(url);
  
  // If edge function didn't work, try direct fetch
  if (images.length === 0) {
    console.log('   Trying direct HTML extraction...');
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
      });
      const html = await response.text();
      images = extractImagesFromHTML(html);
    } catch (error) {
      console.error('   ❌ Error:', error.message);
    }
  }
  
  if (images.length === 0) {
    console.log('\n❌ No images found. Page may require JavaScript rendering.');
    console.log('   Install Playwright for full rendering: npm install playwright');
    console.log('   Or use the enhanced scraper with Playwright support.');
    process.exit(1);
  }
  
  console.log(`\n✅ Found ${images.length} images\n`);
  
  if (vehicleId) {
    console.log(`📥 Importing to vehicle ${vehicleId}...\n`);
    
    // Get user_id
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('user_id, uploaded_by')
      .eq('id', vehicleId)
      .single();
    
    const userId = vehicle?.user_id || vehicle?.uploaded_by || '0b9f107a-d124-49de-9ded-94698f63c1c4';
    
    // Delete existing
    await supabase
      .from('vehicle_images')
      .delete()
      .eq('vehicle_id', vehicleId)
      .eq('source', 'pcarmarket_listing');
    
    // Import in batches
    const batchSize = 50;
    let imported = 0;
    
    for (let i = 0; i < images.length; i += batchSize) {
      const batch = images.slice(i, i + batchSize);
      const imageInserts = batch.map((url, idx) => ({
        vehicle_id: vehicleId,
        image_url: url,
        user_id: userId,
        category: 'general',
        image_category: 'exterior',
        source: 'pcarmarket_listing',
        is_primary: (i + idx) === 0,
        filename: `pcarmarket_${i + idx}.jpg`
      }));
      
      const { error } = await supabase
        .from('vehicle_images')
        .insert(imageInserts);
      
      if (error) {
        console.error(`   ❌ Batch ${Math.floor(i/batchSize) + 1} error:`, error.message);
      } else {
        imported += batch.length;
        console.log(`   ✅ Batch ${Math.floor(i/batchSize) + 1}: ${batch.length} images (${imported}/${images.length})`);
      }
    }
    
    console.log(`\n✅ Imported ${imported} images\n`);
  } else {
    console.log('📊 Sample images:\n');
    images.slice(0, 20).forEach((img, i) => {
      console.log(`   ${i + 1}. ${img}`);
    });
    if (images.length > 20) {
      console.log(`   ... and ${images.length - 20} more`);
    }
    console.log('\n💡 To import, provide vehicle_id:');
    console.log(`   node scripts/scrape-pcarmarket-images-simple.js ${url} <vehicle_id>`);
  }
}

main();


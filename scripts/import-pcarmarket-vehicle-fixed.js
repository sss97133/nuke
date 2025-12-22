#!/usr/bin/env node
/**
 * FIXED PCARMARKET VEHICLE IMPORT
 * 
 * Fixed version that:
 * 1. Extracts ALL images from photo gallery
 * 2. Uses correct schema for organization_vehicles (no listing_url)
 * 3. Properly handles user_id requirement for vehicle_images
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey || !supabaseUrl) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Service account user ID for imports (or get from vehicle.uploaded_by)
const SERVICE_USER_ID = process.env.SERVICE_USER_ID || '0b9f107a-d124-49de-9ded-94698f63c1c4';

/**
 * Enhanced scraper that extracts ALL images from PCarMarket gallery
 */
async function scrapeAllImages(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });
    const html = await response.text();
    
    const images = new Set();
    
    // Method 1: Extract from gallery carousel/slider images
    // Look for all img tags with cloudfront URLs
    const cloudfrontMatches = html.matchAll(/src="(https:\/\/d2niwqq19lf86s\.cloudfront\.net[^"]+)"/gi);
    for (const match of cloudfrontMatches) {
      images.add(match[1]);
    }
    
    // Method 2: Extract from data attributes (data-src, data-lazy, etc.)
    const dataSrcMatches = html.matchAll(/data-src="(https:\/\/d2niwqq19lf86s\.cloudfront\.net[^"]+)"/gi);
    for (const match of dataSrcMatches) {
      images.add(match[1]);
    }
    
    // Method 3: Extract from JSON/JS data (gallery arrays)
    const jsonMatches = html.matchAll(/"(https:\/\/d2niwqq19lf86s\.cloudfront\.net[^"]+\.(?:jpg|jpeg|png|webp))"/gi);
    for (const match of jsonMatches) {
      images.add(match[1]);
    }
    
    // Method 4: Extract from background-image URLs
    const bgMatches = html.matchAll(/background-image:\s*url\(["']?(https:\/\/d2niwqq19lf86s\.cloudfront\.net[^"']+)["']?\)/gi);
    for (const match of bgMatches) {
      images.add(match[1]);
    }
    
    // Method 5: Extract from gallery/photos endpoints
    const galleryMatches = html.matchAll(/\/galleries\/photos\/[^"']+\.(?:jpg|jpeg|png|webp)/gi);
    for (const match of galleryMatches) {
      const fullUrl = match[0].startsWith('http') ? match[0] : `https://www.pcarmarket.com${match[0]}`;
      images.add(fullUrl);
    }
    
    return Array.from(images);
  } catch (error) {
    console.error('Error scraping images:', error.message);
    return [];
  }
}

/**
 * Enhanced scraper for vehicle data
 */
async function scrapeVehicleData(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });
    const html = await response.text();
    
    const data = {
      url: url,
      title: '',
      year: null,
      make: null,
      model: null,
      images: []
    };
    
    // Extract title
    const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i) || 
                      html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) {
      data.title = titleMatch[1].trim().replace(/\s*\|\s*PCARMARKET.*/i, '').trim();
    }
    
    // Parse year/make/model from title
    if (data.title) {
      const yearMatch = data.title.match(/(\d{4})/);
      if (yearMatch) {
        const year = parseInt(yearMatch[1]);
        if (year >= 1885 && year <= new Date().getFullYear() + 1) {
          data.year = year;
        }
      }
      
      // Parse make/model
      const parts = data.title.replace(/^\d+k?-Mile\s+/i, '').replace(/^MP:\s*/i, '').split(/\s+/);
      const yearIndex = parts.findIndex(p => p === String(data.year));
      if (yearIndex >= 0 && yearIndex < parts.length - 1) {
        data.make = parts.slice(yearIndex + 1, yearIndex + 3).join(' ').toLowerCase();
        if (yearIndex + 3 < parts.length) {
          data.model = parts.slice(yearIndex + 3).join(' ').toLowerCase();
        }
      }
    }
    
    // Extract VIN
    const vinMatch = html.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
    if (vinMatch) {
      data.vin = vinMatch[1];
    }
    
    // Extract bid info
    const finalBidMatch = html.match(/Final bid:\s*\$?([\d,]+)/i);
    const highBidMatch = html.match(/High bid:\s*\$?([\d,]+)/i);
    if (finalBidMatch) {
      data.salePrice = parseInt(finalBidMatch[1].replace(/,/g, ''));
      data.auctionOutcome = 'sold';
    } else if (highBidMatch) {
      data.salePrice = parseInt(highBidMatch[1].replace(/,/g, ''));
      data.auctionOutcome = null;
    }
    
    // Extract slug
    const slugMatch = url.match(/\/auction\/([^\/]+)/);
    if (slugMatch) {
      data.slug = slugMatch[1];
      data.auctionId = slugMatch[1].split('-').pop();
    }
    
    // Extract ALL images
    console.log('   📸 Extracting all images from gallery...');
    data.images = await scrapeAllImages(url);
    console.log(`   ✅ Found ${data.images.length} images`);
    
    return data;
  } catch (error) {
    console.error('Error scraping:', error.message);
    return null;
  }
}

async function importVehicle(auctionUrl) {
  console.log(`\n🚀 Importing PCarMarket listing: ${auctionUrl}\n`);
  
  // Step 1: Scrape
  console.log('📋 Step 1: Scraping auction page...');
  const scrapedData = await scrapeVehicleData(auctionUrl);
  
  if (!scrapedData || !scrapedData.year || !scrapedData.make || !scrapedData.model) {
    console.error('❌ Failed to extract required data');
    return null;
  }
  
  console.log('✅ Extracted:');
  console.log(`   Year: ${scrapedData.year}, Make: ${scrapedData.make}, Model: ${scrapedData.model}`);
  console.log(`   VIN: ${scrapedData.vin || 'N/A'}`);
  console.log(`   Images: ${scrapedData.images.length}`);
  console.log(`   Price: ${scrapedData.salePrice ? '$' + scrapedData.salePrice.toLocaleString() : 'N/A'}`);
  
  // Step 2: Find/Create org
  console.log('\n📋 Step 2: Finding organization...');
  const { data: org } = await supabase
    .from('businesses')
    .select('id')
    .eq('website', 'https://www.pcarmarket.com')
    .maybeSingle();
  
  const orgId = org?.id || 'f7c80592-6725-448d-9b32-2abf3e011cf8';
  console.log(`   Org ID: ${orgId}`);
  
  // Step 3: Find existing vehicle
  console.log('\n📋 Step 3: Checking for existing vehicle...');
  let vehicleId = null;
  
  if (scrapedData.vin) {
    const { data: existing } = await supabase
      .from('vehicles')
      .select('id, user_id')
      .eq('vin', scrapedData.vin.toUpperCase())
      .maybeSingle();
    if (existing) {
      vehicleId = existing.id;
      console.log(`   Found by VIN: ${vehicleId}`);
    }
  }
  
  if (!vehicleId) {
    const { data: existing } = await supabase
      .from('vehicles')
      .select('id, user_id')
      .eq('discovery_url', scrapedData.url)
      .maybeSingle();
    if (existing) {
      vehicleId = existing.id;
      console.log(`   Found by URL: ${vehicleId}`);
    }
  }
  
  // Step 4: Create/Update vehicle
  const vehicleData = {
    year: scrapedData.year,
    make: scrapedData.make.toLowerCase(),
    model: scrapedData.model.toLowerCase(),
    vin: scrapedData.vin ? scrapedData.vin.toUpperCase() : null,
    sale_price: scrapedData.salePrice || null,
    auction_outcome: scrapedData.auctionOutcome || null,
    description: scrapedData.title,
    profile_origin: 'pcarmarket_import',
    discovery_source: 'pcarmarket',
    discovery_url: scrapedData.url,
    listing_url: scrapedData.url,
    origin_metadata: {
      source: 'pcarmarket_import',
      pcarmarket_url: scrapedData.url,
      pcarmarket_listing_title: scrapedData.title,
      pcarmarket_auction_slug: scrapedData.slug || null,
      pcarmarket_auction_id: scrapedData.auctionId || null,
      sold_status: scrapedData.auctionOutcome === 'sold' ? 'sold' : 'unsold',
      imported_at: new Date().toISOString(),
      total_images_found: scrapedData.images.length
    },
    is_public: true,
    status: 'active'
  };
  
  if (vehicleId) {
    console.log(`   Updating existing vehicle...`);
    await supabase
      .from('vehicles')
      .update(vehicleData)
      .eq('id', vehicleId);
    
    // Get user_id from existing vehicle
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('user_id, uploaded_by')
      .eq('id', vehicleId)
      .single();
    
    // Use vehicle's user_id if available, otherwise service user
    const userId = vehicle?.user_id || vehicle?.uploaded_by || SERVICE_USER_ID;
    
    console.log('   ✅ Updated');
  } else {
    console.log('   Creating new vehicle...');
    const { data: newVehicle, error } = await supabase
      .from('vehicles')
      .insert({
        ...vehicleData,
        uploaded_by: SERVICE_USER_ID
      })
      .select('id, user_id')
      .single();
    
    if (error) {
      console.error('   ❌ Error:', error.message);
      return null;
    }
    
    vehicleId = newVehicle.id;
    const userId = newVehicle.user_id || SERVICE_USER_ID;
    console.log(`   ✅ Created: ${vehicleId}`);
  }
  
  // Get user_id for images
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('user_id, uploaded_by')
    .eq('id', vehicleId)
    .single();
  const userId = vehicle?.user_id || vehicle?.uploaded_by || SERVICE_USER_ID;
  
  // Step 5: Import ALL images
  if (scrapedData.images.length > 0) {
    console.log(`\n📋 Step 4: Importing ${scrapedData.images.length} images...`);
    
    // Delete existing PCarMarket images first
    await supabase
      .from('vehicle_images')
      .delete()
      .eq('vehicle_id', vehicleId)
      .eq('source', 'pcarmarket_listing');
    
    // Insert all images in batches
    const batchSize = 50;
    let imported = 0;
    
    for (let i = 0; i < scrapedData.images.length; i += batchSize) {
      const batch = scrapedData.images.slice(i, i + batchSize);
      const imageInserts = batch.map((url, idx) => ({
        vehicle_id: vehicleId,
        image_url: url,
        user_id: userId, // Required field
        category: 'general',
        image_category: 'exterior',
        source: 'pcarmarket_listing',
        is_primary: (i + idx) === 0, // First image is primary
        filename: `pcarmarket_${i + idx}.jpg`
      }));
      
      const { error: imgError } = await supabase
        .from('vehicle_images')
        .insert(imageInserts);
      
      if (imgError) {
        console.error(`   ⚠️  Error inserting batch ${Math.floor(i/batchSize) + 1}:`, imgError.message);
      } else {
        imported += batch.length;
        console.log(`   ✅ Imported batch ${Math.floor(i/batchSize) + 1}: ${batch.length} images (${imported}/${scrapedData.images.length})`);
      }
    }
    
    console.log(`   ✅ Total images imported: ${imported}`);
  }
  
  // Step 6: Link to org (FIXED - no listing_url column)
  console.log('\n📋 Step 5: Linking to organization...');
  const { error: orgError } = await supabase
    .from('organization_vehicles')
    .upsert({
      organization_id: orgId,
      vehicle_id: vehicleId,
      relationship_type: scrapedData.auctionOutcome === 'sold' ? 'sold_by' : 'consigner',
      status: 'active',
      auto_tagged: true,
      notes: `Imported from PCarMarket: ${scrapedData.url}`
    }, {
      onConflict: 'organization_id,vehicle_id,relationship_type'
    });
  
  if (orgError) {
    console.error('   ⚠️  Org link error:', orgError.message);
  } else {
    console.log('   ✅ Linked to organization');
  }
  
  console.log(`\n✅ Import complete! Vehicle ID: ${vehicleId}`);
  console.log(`   Total images: ${scrapedData.images.length}\n`);
  
  return vehicleId;
}

// Main
const url = process.argv[2] || 'https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-vantage-2';
importVehicle(url).then(vehicleId => {
  if (vehicleId) {
    console.log(`\n📊 Vehicle ID: ${vehicleId}`);
    console.log(`   Query with: SELECT * FROM vehicles WHERE id = '${vehicleId}';`);
  }
});


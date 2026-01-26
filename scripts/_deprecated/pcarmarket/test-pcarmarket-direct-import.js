#!/usr/bin/env node
/**
 * DIRECT PCARMARKET IMPORT TEST
 * Tests import with basic fetch (no Playwright required)
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

// Simple fetch-based scraper for testing
async function scrapeBasicData(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });
    const html = await response.text();
    
    // Basic parsing from HTML
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
      data.title = titleMatch[1].trim();
    }
    
    // Parse year/make/model from title
    if (data.title) {
      const yearMatch = data.title.match(/(\d{4})/);
      if (yearMatch) {
        data.year = parseInt(yearMatch[1]);
      }
      
      // Simple parsing: "5k-Mile 2002 Aston Martin DB7 V12 Vantage Coupe"
      const parts = data.title.replace(/^\d+k?-Mile\s+/i, '').split(/\s+/);
      if (parts.length >= 3 && data.year) {
        // After year, next 1-2 words are usually make
        const yearIndex = parts.findIndex(p => p === String(data.year));
        if (yearIndex >= 0 && yearIndex < parts.length - 1) {
          data.make = parts.slice(yearIndex + 1, yearIndex + 3).join(' ').toLowerCase();
          data.model = parts.slice(yearIndex + 3).join(' ').toLowerCase();
        }
      }
    }
    
    // Extract images
    const imageMatches = html.matchAll(/src="(https:\/\/d2niwqq19lf86s\.cloudfront\.net[^"]+)"/g);
    for (const match of imageMatches) {
      data.images.push(match[1]);
    }
    
    // Extract VIN if present
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
    
    // Extract slug from URL
    const slugMatch = url.match(/\/auction\/([^\/]+)/);
    if (slugMatch) {
      data.slug = slugMatch[1];
      data.auctionId = slugMatch[1].split('-').pop();
    }
    
    return data;
  } catch (error) {
    console.error('Error scraping:', error.message);
    return null;
  }
}

async function importVehicle(auctionUrl) {
  console.log(`\n🚀 Importing: ${auctionUrl}\n`);
  
  // Step 1: Scrape
  console.log('📋 Scraping...');
  const scrapedData = await scrapeBasicData(auctionUrl);
  
  if (!scrapedData || !scrapedData.year || !scrapedData.make || !scrapedData.model) {
    console.error('❌ Failed to extract required data');
    console.log('Scraped:', scrapedData);
    return null;
  }
  
  console.log('✅ Extracted:');
  console.log(`   Year: ${scrapedData.year}`);
  console.log(`   Make: ${scrapedData.make}`);
  console.log(`   Model: ${scrapedData.model}`);
  console.log(`   Title: ${scrapedData.title}`);
  console.log(`   Images: ${scrapedData.images.length}`);
  console.log(`   VIN: ${scrapedData.vin || 'N/A'}`);
  
  // Step 2: Find/Create org
  console.log('\n📋 Finding organization...');
  const { data: org } = await supabase
    .from('businesses')
    .select('id')
    .eq('website', 'https://www.pcarmarket.com')
    .maybeSingle();
  
  const orgId = org?.id || 'f7c80592-6725-448d-9b32-2abf3e011cf8';
  console.log(`   Org ID: ${orgId}`);
  
  // Step 3: Check for existing
  console.log('\n📋 Checking for existing vehicle...');
  let vehicleId = null;
  
  if (scrapedData.vin) {
    const { data: existing } = await supabase
      .from('vehicles')
      .select('id')
      .eq('vin', scrapedData.vin.toUpperCase())
      .maybeSingle();
    if (existing) vehicleId = existing.id;
  }
  
  if (!vehicleId) {
    const { data: existing } = await supabase
      .from('vehicles')
      .select('id')
      .eq('discovery_url', scrapedData.url)
      .maybeSingle();
    if (existing) vehicleId = existing.id;
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
      imported_at: new Date().toISOString()
    },
    is_public: true,
    status: 'active'
  };
  
  if (vehicleId) {
    console.log(`   Found existing: ${vehicleId}`);
    await supabase
      .from('vehicles')
      .update(vehicleData)
      .eq('id', vehicleId);
    console.log('   ✅ Updated');
  } else {
    console.log('   Creating new vehicle...');
    const { data: newVehicle, error } = await supabase
      .from('vehicles')
      .insert(vehicleData)
      .select('id')
      .single();
    
    if (error) {
      console.error('   ❌ Error:', error.message);
      return null;
    }
    
    vehicleId = newVehicle.id;
    console.log(`   ✅ Created: ${vehicleId}`);
  }
  
  // Step 5: Import images
  if (scrapedData.images.length > 0) {
    console.log(`\n📋 Importing ${scrapedData.images.length} images...`);
    const imageInserts = scrapedData.images.slice(0, 10).map((url, i) => ({
      vehicle_id: vehicleId,
      image_url: url,
      category: 'pcarmarket_listing',
      source: 'pcarmarket_listing',
      is_primary: i === 0,
      filename: `pcarmarket_${i}.jpg`
    }));
    
    await supabase.from('vehicle_images').insert(imageInserts);
    console.log('   ✅ Images imported');
  }
  
  // Step 6: Link to org
  console.log('\n📋 Linking to organization...');
  await supabase
    .from('organization_vehicles')
    .upsert({
      organization_id: orgId,
      vehicle_id: vehicleId,
      relationship_type: scrapedData.auctionOutcome === 'sold' ? 'sold_by' : 'consigner',
      status: 'active',
      listing_status: scrapedData.auctionOutcome === 'sold' ? 'sold' : 'listed',
      listing_url: scrapedData.url,
      auto_tagged: true
    }, {
      onConflict: 'organization_id,vehicle_id,relationship_type'
    });
  console.log('   ✅ Linked');
  
  console.log(`\n✅ Import complete! Vehicle ID: ${vehicleId}\n`);
  return vehicleId;
}

// Main
const url = process.argv[2] || 'https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-vantage-2';
importVehicle(url).then(vehicleId => {
  if (vehicleId) {
    console.log(`\n📊 Vehicle ID for query: ${vehicleId}`);
  }
});


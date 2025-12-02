#!/usr/bin/env node
/**
 * Test scraping individual KSL listings directly
 * Uses known listing URLs from KSL to test the import flow
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '../nuke_frontend/.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseKey) {
  console.error('❌ Error: SUPABASE key not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Known KSL listing URLs for testing
const TEST_LISTINGS = [
  'https://cars.ksl.com/listing/10302276', // 1980 Chevrolet C-Series
  'https://cars.ksl.com/listing/10323198', // 1988 Chevrolet S-10
  'https://cars.ksl.com/listing/10322827', // 1970 Chevrolet Chevelle
  'https://cars.ksl.com/listing/10322112', // 1980 Chevrolet 1/2 Ton
  'https://cars.ksl.com/listing/10321970', // 1978 Chevrolet C20
  'https://cars.ksl.com/listing/10321968', // 1988 Chevrolet C/K 3500
  'https://cars.ksl.com/listing/10297247', // 1987 Chevrolet R/V 10
  'https://cars.ksl.com/listing/10321302', // 1972 Chevrolet Camaro
  'https://cars.ksl.com/listing/10321283', // 1972 Chevrolet El Camino
  'https://cars.ksl.com/listing/10269335', // 1976 Chevrolet C-Series
  'https://cars.ksl.com/listing/10299803', // 1986 Chevrolet C/K 10
  'https://cars.ksl.com/listing/10320525', // 1970 Chevrolet C/K 10
  'https://cars.ksl.com/listing/10275450', // 1989 Chevrolet Astro Van
  'https://cars.ksl.com/listing/10319968', // 1989 Chevrolet Cargo Van
  'https://cars.ksl.com/listing/10319820', // 1991 Chevrolet C/K 2500
];

async function scrapeAndImport(url) {
  try {
    console.log(`\n🔍 Scraping: ${url}`);
    
    // Check if already exists
    const { data: existing } = await supabase
      .from('vehicles')
      .select('id')
      .eq('discovery_url', url)
      .maybeSingle();
    
    if (existing) {
      console.log(`   ⏭️  Already exists: ${existing.id}`);
      return { success: true, vehicleId: existing.id, created: false };
    }
    
    // Scrape the listing
    const { data: listingData, error: scrapeError } = await supabase.functions.invoke('scrape-vehicle', {
      body: { url }
    });
    
    if (scrapeError) {
      console.error(`   ❌ Scrape error: ${scrapeError.message}`);
      return { success: false, error: scrapeError.message };
    }
    
    if (!listingData) {
      console.error(`   ❌ No data returned from scraper`);
      return { success: false, error: 'No data' };
    }
    
    console.log(`   📊 Scraped: ${listingData.title || 'No title'}`);
    console.log(`      Year: ${listingData.year || 'N/A'}, Make: ${listingData.make || 'N/A'}, Model: ${listingData.model || 'N/A'}`);
    
    // Extract vehicle data
    let year = listingData.year;
    let make = listingData.make;
    let model = listingData.model;
    
    if (!year || !make || !model) {
      const title = listingData.title || '';
      const yearMatch = title.match(/\b(19|20)\d{2}\b/);
      if (yearMatch) {
        year = parseInt(yearMatch[0]);
      }
      
      const afterYear = title.replace(/\b(19|20)\d{2}\b/, '').trim();
      const parts = afterYear.split(/\s+/);
      if (parts.length >= 2) {
        make = parts[0];
        model = parts.slice(1, 3).join(' ');
      }
    }
    
    if (!year || !make || !model) {
      console.log(`   ⚠️  Could not extract year/make/model`);
      return { success: false, error: 'Could not extract vehicle info' };
    }
    
    // Create vehicle
    const { data: newVehicle, error: vehicleError } = await supabase
      .from('vehicles')
      .insert({
        year,
        make: make.toLowerCase(),
        model: model.toLowerCase(),
        vin: listingData.vin || null,
        mileage: listingData.mileage || null,
        color: listingData.color || null,
        asking_price: listingData.asking_price || null,
        profile_origin: 'ksl_import',
        discovery_source: 'ksl_automated_import',
        discovery_url: url,
        origin_metadata: {
          ksl_listing_title: listingData.title,
          scraped_at: new Date().toISOString()
        },
        is_public: true,
        status: 'active',
        description: listingData.description || null
      })
      .select('id')
      .single();
    
    if (vehicleError) {
      console.error(`   ❌ Error creating vehicle: ${vehicleError.message}`);
      return { success: false, error: vehicleError.message };
    }
    
    console.log(`   ✅ Created vehicle: ${newVehicle.id} (${year} ${make} ${model})`);
    return { success: true, vehicleId: newVehicle.id, created: true };
    
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function main() {
  const maxListings = parseInt(process.argv[2]) || 20;
  const listingsToTest = TEST_LISTINGS.slice(0, maxListings);
  
  console.log('🚀 Testing KSL Individual Listing Scraper\n');
  console.log(`📋 Processing ${listingsToTest.length} listings...\n`);
  
  let imported = 0;
  let skipped = 0;
  let errors = 0;
  
  // Process in batches of 3 to avoid rate limiting
  const batchSize = 3;
  for (let i = 0; i < listingsToTest.length; i += batchSize) {
    const batch = listingsToTest.slice(i, i + batchSize);
    
    const results = await Promise.all(
      batch.map(url => scrapeAndImport(url))
    );
    
    results.forEach(result => {
      if (result.success) {
        if (result.created) {
          imported++;
        } else {
          skipped++;
        }
      } else {
        errors++;
      }
    });
    
    // Rate limiting between batches
    if (i + batchSize < listingsToTest.length) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ Successfully imported: ${imported} vehicles`);
  console.log(`⏭️  Skipped (already exists): ${skipped}`);
  console.log(`❌ Errors: ${errors}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch(console.error);


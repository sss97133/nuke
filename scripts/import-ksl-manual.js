#!/usr/bin/env node
/**
 * Manual KSL import - imports listing data directly
 * Use this when KSL bot protection blocks automated scraping
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

// Example listing from the screenshot
const EXAMPLE_LISTING = {
  url: 'https://cars.ksl.com/listing/10322112',
  title: '1980 Chevrolet 1/2 Ton',
  year: 1980,
  make: 'Chevrolet',
  model: '1/2 Ton',
  price: 3000,
  mileage: 114638,
  vin: '1GEKRLS123484738',
  location: 'Glenns Ferry, ID',
  engine: '6.2L V8',
  body_style: 'Truck',
  title_status: 'Clean Title'
};

async function importListing(listingData) {
  const url = listingData.url;
  
  // Check if already exists
  const { data: existing } = await supabase
    .from('vehicles')
    .select('id')
    .eq('discovery_url', url)
    .maybeSingle();
  
  if (existing) {
    console.log(`⏭️  Already exists: ${existing.id}`);
    return { id: existing.id, created: false };
  }
  
  // Check by VIN
  if (listingData.vin) {
    const { data: vinMatch } = await supabase
      .from('vehicles')
      .select('id')
      .eq('vin', listingData.vin)
      .maybeSingle();
    
    if (vinMatch) {
      console.log(`⏭️  Vehicle with VIN already exists: ${vinMatch.id}`);
      await supabase
        .from('vehicles')
        .update({ discovery_url: url })
        .eq('id', vinMatch.id);
      return { id: vinMatch.id, created: false };
    }
  }
  
  console.log(`\n📝 Creating vehicle: ${listingData.year} ${listingData.make} ${listingData.model}`);
  
  // Create vehicle
  const { data: newVehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .insert({
      year: listingData.year,
      make: listingData.make.toLowerCase(),
      model: listingData.model.toLowerCase(),
      vin: listingData.vin || null,
      mileage: listingData.mileage || null,
      asking_price: listingData.price || null,
      body_style: listingData.body_style || null,
      engine_size: listingData.engine || null,
      profile_origin: 'ksl_import',
      discovery_source: 'ksl_automated_import',
      discovery_url: url,
      origin_metadata: {
        ksl_listing_title: listingData.title,
        ksl_location: listingData.location,
        ksl_listing_id: url.split('/listing/')[1],
        scraped_at: new Date().toISOString(),
        manual_import: true
      },
      is_public: true,
      status: 'active'
    })
    .select('id')
    .single();
  
  if (vehicleError) {
    throw new Error(`Failed to create vehicle: ${vehicleError.message}`);
  }
  
  console.log(`✅ Created vehicle: ${newVehicle.id}`);
  return { id: newVehicle.id, created: true };
}

async function main() {
  console.log('🚀 Manual KSL Import\n');
  
  try {
    // Import the example listing
    const result = await importListing(EXAMPLE_LISTING);
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(result.created ? '✅ Successfully imported!' : '⏭️  Already exists');
    console.log(`Vehicle ID: ${result.id}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    console.log('📋 To import more listings, add them to this script or create a JSON file.');
    console.log('💡 Note: KSL has bot protection, so manual data entry may be needed.');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main().catch(console.error);


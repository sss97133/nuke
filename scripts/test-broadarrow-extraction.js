#!/usr/bin/env node
/**
 * Test extraction of Broad Arrow Auctions listings
 * Tests the extract-premium-auction function with Broad Arrow results page
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../nuke_frontend/.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Get URL from command line or use default test URL
const testUrl = process.argv[2] || 'https://www.broadarrowauctions.com/vehicles/results?q%5Bbranch_id_eq%5D=26&q%5Bs%5D%5B0%5D%5Bname_dir%5D=stock.asc';
const maxVehicles = parseInt(process.argv[3] || '5', 10);

async function testExtraction() {
  console.log('🧪 Testing Broad Arrow Auctions Extraction\n');
  console.log(`📋 URL: ${testUrl}`);
  console.log(`📊 Max vehicles: ${maxVehicles}\n`);

  try {
    console.log('🚀 Invoking extract-premium-auction function...\n');
    
    const { data, error } = await supabase.functions.invoke('extract-premium-auction', {
      body: {
        url: testUrl,
        site_type: 'broadarrow',
        max_vehicles: maxVehicles,
        debug: true
      }
    });

    if (error) {
      console.error('❌ Function error:', error);
      return;
    }

    console.log('✅ Extraction completed!\n');
    console.log('📊 Results:');
    console.log(JSON.stringify(data, null, 2));

    if (data.success) {
      console.log('\n✅ SUCCESS: Extraction worked!');
      console.log(`   Listings discovered: ${data.listings_discovered || 0}`);
      console.log(`   Vehicles extracted: ${data.vehicles_extracted || 0}`);
      console.log(`   Vehicles created: ${data.vehicles_created || 0}`);
      console.log(`   Vehicles updated: ${data.vehicles_updated || 0}`);
      
      if (data.created_vehicle_ids && data.created_vehicle_ids.length > 0) {
        const vehicleId = data.created_vehicle_ids[0];
        console.log(`\n🔍 Checking first created vehicle ${vehicleId}...`);
        
        // Check the created vehicle
        const { data: vehicle, error: vehicleError } = await supabase
          .from('vehicles')
          .select('id, year, make, model, platform_url, origin_organization_id, origin_metadata')
          .eq('id', vehicleId)
          .single();

        if (vehicle) {
          console.log(`\n📋 Vehicle Details:`);
          console.log(`   ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
          console.log(`   Platform URL: ${vehicle.platform_url}`);
          console.log(`   Origin Organization ID: ${vehicle.origin_organization_id}`);
          
          // Check organization
          if (vehicle.origin_organization_id) {
            const { data: org } = await supabase
              .from('businesses')
              .select('id, business_name, website, type')
              .eq('id', vehicle.origin_organization_id)
              .single();
            
            if (org) {
              console.log(`\n🏢 Organization:`);
              console.log(`   Name: ${org.business_name}`);
              console.log(`   Website: ${org.website}`);
              console.log(`   Type: ${org.type || 'NULL (should be auction_house)'}`);
              
              if (!org.type || org.type !== 'auction_house') {
                console.log(`\n⚠️  WARNING: Organization type should be 'auction_house' but is '${org.type || 'NULL'}'`);
              }
            }
          }

          // Check images
          const { data: images } = await supabase
            .from('vehicle_images')
            .select('id, image_url, source')
            .eq('vehicle_id', vehicleId)
            .limit(10);

          console.log(`\n📸 Images: ${images?.length || 0}`);
          
          if (images && images.length > 0) {
            console.log(`   First image: ${images[0].image_url}`);
          }

          // Check external_listings
          const { data: listings } = await supabase
            .from('external_listings')
            .select('id, platform, listing_url, listing_status, final_price, bid_count')
            .eq('vehicle_id', vehicleId)
            .limit(5);

          console.log(`\n📋 External Listings: ${listings?.length || 0}`);
          
          if (listings && listings.length > 0) {
            listings.forEach((listing, idx) => {
              console.log(`   ${idx + 1}. Platform: ${listing.platform}, Status: ${listing.listing_status}`);
              console.log(`      URL: ${listing.listing_url}`);
              if (listing.final_price) {
                console.log(`      Final Price: $${(listing.final_price / 100).toLocaleString()}`);
              }
            });
          }
        } else if (vehicleError) {
          console.error(`   ❌ Error fetching vehicle: ${vehicleError.message}`);
        }
      }
      
      if (data.issues && data.issues.length > 0) {
        console.log(`\n⚠️  Issues (${data.issues.length}):`);
        data.issues.slice(0, 5).forEach((issue, idx) => {
          console.log(`   ${idx + 1}. ${issue}`);
        });
      }
    } else {
      console.log('\n❌ FAILED: Extraction did not succeed');
      console.log(`   Error: ${data.error || 'Unknown error'}`);
    }
  } catch (error) {
    console.error('❌ Exception:', error);
  }
}

testExtraction().catch(console.error);


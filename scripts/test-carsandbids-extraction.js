#!/usr/bin/env node
/**
 * Test extraction of a single Cars & Bids listing
 * Verifies the fixes for video URLs and thumbnail images
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

// Get listing URL from command line or use a test URL
const listingUrl = process.argv[2] || 'https://carsandbids.com/auctions';

async function testExtraction() {
  console.log('🧪 Testing Cars & Bids Extraction\n');
  console.log(`📋 URL: ${listingUrl}\n`);

  // Check if it's a video URL (should be rejected)
  if (listingUrl.includes('/video')) {
    console.error('❌ ERROR: This is a video URL! The scraper should reject this.');
    console.error('   Use a proper listing URL like: https://carsandbids.com/auctions/ID/year-make-model');
    process.exit(1);
  }

  try {
    console.log('🚀 Invoking extract-premium-auction function...\n');
    
    const { data, error } = await supabase.functions.invoke('extract-premium-auction', {
      body: {
        url: listingUrl,
        site_type: 'carsandbids',
        max_vehicles: 1,
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
      console.log(`   Vehicles extracted: ${data.vehicles_extracted || 0}`);
      console.log(`   Vehicles created: ${data.vehicles_created || 0}`);
      console.log(`   Vehicles updated: ${data.vehicles_updated || 0}`);
      
      if (data.created_vehicle_ids && data.created_vehicle_ids.length > 0) {
        const vehicleId = data.created_vehicle_ids[0];
        console.log(`\n🔍 Checking vehicle ${vehicleId}...`);
        
        // Check the created vehicle
        const { data: vehicle, error: vehicleError } = await supabase
          .from('vehicles')
          .select('id, year, make, model, discovery_url, origin_metadata')
          .eq('id', vehicleId)
          .single();

        if (vehicle) {
          console.log(`\n📋 Vehicle Details:`);
          console.log(`   ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
          console.log(`   Discovery URL: ${vehicle.discovery_url}`);
          
          // Verify no video URL
          if (vehicle.discovery_url && vehicle.discovery_url.includes('/video')) {
            console.error(`\n❌ ERROR: Vehicle has video URL in discovery_url!`);
          } else {
            console.log(`   ✅ Discovery URL is clean (no /video)`);
          }

          // Check images
          const { data: images } = await supabase
            .from('vehicle_images')
            .select('id, image_url, source')
            .eq('vehicle_id', vehicleId)
            .limit(10);

          console.log(`\n📸 Images: ${images?.length || 0}`);
          
          if (images && images.length > 0) {
            const vimeoThumbnails = images.filter(img => {
              const url = (img.image_url || '').toLowerCase();
              return url.includes('vimeocdn.com') && 
                     (url.includes('mw=80') || url.includes('mw=100') || url.includes('mw=120'));
            });

            if (vimeoThumbnails.length > 0) {
              console.error(`\n❌ ERROR: Found ${vimeoThumbnails.length} Vimeo thumbnails!`);
              vimeoThumbnails.forEach(img => {
                console.error(`   - ${img.image_url}`);
              });
            } else {
              console.log(`   ✅ No Vimeo thumbnails found`);
            }

            // Show first few image URLs
            console.log(`\n   Sample images:`);
            images.slice(0, 3).forEach((img, i) => {
              console.log(`   ${i + 1}. ${img.image_url?.substring(0, 80)}...`);
            });
          } else {
            console.log(`   ⚠️  No images extracted`);
          }
        }
      }
    } else {
      console.error('\n❌ Extraction failed:', data.error || 'Unknown error');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

testExtraction()
  .then(() => {
    console.log('\n✅ Test complete!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  });


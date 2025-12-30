#!/usr/bin/env node

/**
 * Fix empty/null fields in vehicles table
 * Backfills missing data from available sources
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env.local') });
dotenv.config({ path: join(__dirname, '..', '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const VEHICLE_ID = process.argv[2]; // Optional: specific vehicle, or all if not provided

async function fixEmptyFields() {
  console.log(`\n🔧 Fixing Empty Vehicle Fields\n`);
  console.log('='.repeat(80));

  // Get vehicles with empty fields
  let query = supabase
    .from('vehicles')
    .select('id, year, make, model, vin, primary_image_url, image_url, bat_auction_url, discovery_url, origin_metadata, profile_origin')
    .or('primary_image_url.is.null,image_url.is.null,bat_auction_url.is.null')
    .limit(100);

  if (VEHICLE_ID) {
    query = query.eq('id', VEHICLE_ID);
  }

  const { data: vehicles } = await query;

  if (!vehicles || vehicles.length === 0) {
    console.log('✅ No vehicles with empty fields found');
    return;
  }

  console.log(`\n📋 Found ${vehicles.length} vehicles with empty fields\n`);

  let fixed = 0;
  let skipped = 0;

  for (const vehicle of vehicles) {
    console.log(`\n🔍 Processing: ${vehicle.year} ${vehicle.make} ${vehicle.model} (${vehicle.id.substring(0, 8)}...)`);
    
    const updates = {};
    let needsUpdate = false;

    // 1. Fix missing primary_image_url from vehicle_images
    if (!vehicle.primary_image_url) {
      const { data: primaryImage } = await supabase
        .from('vehicle_images')
        .select('image_url')
        .eq('vehicle_id', vehicle.id)
        .eq('is_primary', true)
        .not('is_duplicate', 'is', true)
        .not('is_document', 'is', true)
        .maybeSingle();

      if (primaryImage?.image_url) {
        updates.primary_image_url = primaryImage.image_url;
        updates.image_url = primaryImage.image_url;
        needsUpdate = true;
        console.log(`   ✅ Found primary image: ${primaryImage.image_url.substring(0, 60)}...`);
      } else {
        // Try first non-duplicate image
        const { data: firstImage } = await supabase
          .from('vehicle_images')
          .select('image_url')
          .eq('vehicle_id', vehicle.id)
          .not('is_duplicate', 'is', true)
          .not('is_document', 'is', true)
          .order('position', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (firstImage?.image_url) {
          updates.primary_image_url = firstImage.image_url;
          updates.image_url = firstImage.image_url;
          needsUpdate = true;
          console.log(`   ✅ Using first image as primary: ${firstImage.image_url.substring(0, 60)}...`);
        }
      }
    }

    // 2. Fix missing bat_auction_url from discovery_url
    if (!vehicle.bat_auction_url && vehicle.discovery_url && vehicle.discovery_url.includes('bringatrailer.com/listing/')) {
      updates.bat_auction_url = vehicle.discovery_url;
      needsUpdate = true;
      console.log(`   ✅ Set bat_auction_url from discovery_url`);
    }

    // 3. Fix missing image_url if we have primary_image_url
    if (!vehicle.image_url && vehicle.primary_image_url) {
      updates.image_url = vehicle.primary_image_url;
      needsUpdate = true;
      console.log(`   ✅ Set image_url from primary_image_url`);
    }

    // 4. Backfill from origin_metadata if available
    if (vehicle.origin_metadata) {
      const om = vehicle.origin_metadata;
      
      // Set primary_image_url from origin_metadata if missing
      if (!vehicle.primary_image_url && om.thumbnail_url) {
        updates.primary_image_url = om.thumbnail_url;
        updates.image_url = om.thumbnail_url;
        needsUpdate = true;
        console.log(`   ✅ Set primary_image_url from origin_metadata.thumbnail_url`);
      } else if (!vehicle.primary_image_url && om.image_urls && Array.isArray(om.image_urls) && om.image_urls.length > 0) {
        updates.primary_image_url = om.image_urls[0];
        updates.image_url = om.image_urls[0];
        needsUpdate = true;
        console.log(`   ✅ Set primary_image_url from origin_metadata.image_urls[0]`);
      }
    }

    if (needsUpdate) {
      const { error } = await supabase
        .from('vehicles')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', vehicle.id);

      if (error) {
        console.error(`   ❌ Update failed: ${error.message}`);
        skipped++;
      } else {
        console.log(`   ✅ Updated vehicle fields`);
        fixed++;
      }
    } else {
      console.log(`   ⏭️  No updates needed`);
      skipped++;
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log(`\n✅ Complete! Fixed: ${fixed}, Skipped: ${skipped}\n`);
}

fixEmptyFields().catch(console.error);


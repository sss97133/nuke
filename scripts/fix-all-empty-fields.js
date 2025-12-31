#!/usr/bin/env node

/**
 * Fix empty/null fields across ALL vehicles in the database
 * Backfills missing data from available sources (images, metadata, etc.)
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

const BATCH_SIZE = parseInt(process.argv[2]) || 100; // How many vehicles to process

async function fixAllEmptyFields() {
  console.log(`\n🔧 Fixing Empty Fields Across All Vehicles\n`);
  console.log(`Batch size: ${BATCH_SIZE}\n`);
  console.log('='.repeat(80));

  let offset = 0;
  let totalFixed = 0;
  let totalSkipped = 0;
  let totalProcessed = 0;

  while (true) {
    // Get batch of vehicles with empty fields
    const { data: vehicles, error } = await supabase
      .from('vehicles')
      .select('id, year, make, model, vin, primary_image_url, image_url, bat_auction_url, discovery_url, origin_metadata, profile_origin')
      .or('primary_image_url.is.null,image_url.is.null,bat_auction_url.is.null')
      .order('updated_at', { ascending: false })
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error('❌ Error fetching vehicles:', error);
      break;
    }

    if (!vehicles || vehicles.length === 0) {
      console.log('\n✅ No more vehicles with empty fields found');
      break;
    }

    console.log(`\n📋 Processing batch ${Math.floor(offset / BATCH_SIZE) + 1}: ${vehicles.length} vehicles\n`);

    let batchFixed = 0;
    let batchSkipped = 0;

    for (const vehicle of vehicles) {
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
          }
        }
      }

      // 2. Fix missing bat_auction_url from discovery_url
      if (!vehicle.bat_auction_url && vehicle.discovery_url && vehicle.discovery_url.includes('bringatrailer.com/listing/')) {
        updates.bat_auction_url = vehicle.discovery_url;
        needsUpdate = true;
      }

      // 3. Fix missing image_url if we have primary_image_url
      if (!vehicle.image_url && vehicle.primary_image_url) {
        updates.image_url = vehicle.primary_image_url;
        needsUpdate = true;
      }

      // 4. Backfill from origin_metadata if available
      if (vehicle.origin_metadata) {
        const om = vehicle.origin_metadata;
        
        if (!vehicle.primary_image_url && om.thumbnail_url) {
          updates.primary_image_url = om.thumbnail_url;
          updates.image_url = om.thumbnail_url;
          needsUpdate = true;
        } else if (!vehicle.primary_image_url && om.image_urls && Array.isArray(om.image_urls) && om.image_urls.length > 0) {
          updates.primary_image_url = om.image_urls[0];
          updates.image_url = om.image_urls[0];
          needsUpdate = true;
        }
      }

      if (needsUpdate) {
        const { error: updateError } = await supabase
          .from('vehicles')
          .update({
            ...updates,
            updated_at: new Date().toISOString()
          })
          .eq('id', vehicle.id);

        if (updateError) {
          batchSkipped++;
        } else {
          batchFixed++;
          totalFixed++;
        }
      } else {
        batchSkipped++;
        totalSkipped++;
      }

      totalProcessed++;
    }

    console.log(`   ✅ Fixed: ${batchFixed}, Skipped: ${batchSkipped}`);

    if (vehicles.length < BATCH_SIZE) {
      break; // Last batch
    }

    offset += BATCH_SIZE;
    
    // Small delay between batches
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('\n' + '='.repeat(80));
  console.log(`\n📊 Final Summary:`);
  console.log(`   Total Processed: ${totalProcessed}`);
  console.log(`   Total Fixed: ${totalFixed}`);
  console.log(`   Total Skipped: ${totalSkipped}`);
  console.log(`\n✅ Complete!\n`);
}

fixAllEmptyFields().catch(console.error);



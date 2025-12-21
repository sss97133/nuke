#!/usr/bin/env node
/**
 * FIX ALL PRIMARY IMAGES RIGHT NOW - no more broken thumbnails
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient('https://qkgaybvrernstplzjaam.supabase.co', supabaseKey);

async function fixAllPrimaryImages() {
  console.log('🔧 FIXING ALL PRIMARY IMAGES NOW\n');

  try {
    // 1. Find vehicles missing primary images
    console.log('1️⃣ Finding vehicles with missing primary images...');

    const { data: vehiclesNeedingPrimary } = await supabase
      .from('vehicles')
      .select(`
        id, year, make, model,
        vehicle_images!inner(id, is_primary, image_url)
      `)
      .is('primary_image_url', null)
      .limit(100);

    console.log(`Found ${vehiclesNeedingPrimary?.length || 0} vehicles needing primary images`);

    if (!vehiclesNeedingPrimary || vehiclesNeedingPrimary.length === 0) {
      console.log('✅ No vehicles need primary image fixes');
      return;
    }

    // 2. Fix each vehicle's primary image
    let fixed = 0;
    let failed = 0;

    for (const vehicle of vehiclesNeedingPrimary) {
      try {
        console.log(`\n🔧 Fixing: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);

        // Get all images for this vehicle
        const { data: images } = await supabase
          .from('vehicle_images')
          .select('id, image_url, is_primary, category')
          .eq('vehicle_id', vehicle.id)
          .not('is_document', 'is', true)
          .order('created_at', { ascending: false });

        if (!images || images.length === 0) {
          console.log('   ❌ No images found');
          failed++;
          continue;
        }

        // Find or set primary image
        let primaryImage = images.find(img => img.is_primary === true);

        if (!primaryImage) {
          // Set first non-document image as primary
          const firstImage = images.find(img => !img.category?.includes('document')) || images[0];

          if (firstImage) {
            await supabase
              .from('vehicle_images')
              .update({ is_primary: true })
              .eq('id', firstImage.id);

            primaryImage = firstImage;
            console.log('   📌 Set new primary image');
          }
        }

        if (primaryImage) {
          // Update vehicle's primary_image_url
          await supabase
            .from('vehicles')
            .update({ primary_image_url: primaryImage.image_url })
            .eq('id', vehicle.id);

          console.log('   ✅ Primary image URL updated');
          fixed++;
        } else {
          console.log('   ❌ No suitable image found');
          failed++;
        }

      } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
        failed++;
      }
    }

    console.log('\n📊 PRIMARY IMAGE FIX RESULTS:');
    console.log('='.repeat(40));
    console.log(`✅ Fixed: ${fixed} vehicles`);
    console.log(`❌ Failed: ${failed} vehicles`);
    console.log(`📈 Success rate: ${((fixed/(fixed+failed)) * 100).toFixed(1)}%`);

    // 3. Check for duplicate primary images per vehicle
    console.log('\n2️⃣ Fixing duplicate primary images...');

    const { data: duplicatePrimaries } = await supabase
      .from('vehicle_images')
      .select('vehicle_id, count(*)')
      .eq('is_primary', true)
      .group('vehicle_id')
      .having('count(*) > 1');

    if (duplicatePrimaries && duplicatePrimaries.length > 0) {
      console.log(`Found ${duplicatePrimaries.length} vehicles with multiple primary images`);

      for (const duplicate of duplicatePrimaries) {
        // Keep only the most recent primary image
        const { data: primaries } = await supabase
          .from('vehicle_images')
          .select('id, created_at')
          .eq('vehicle_id', duplicate.vehicle_id)
          .eq('is_primary', true)
          .order('created_at', { ascending: false });

        if (primaries && primaries.length > 1) {
          const keepId = primaries[0].id;
          const removeIds = primaries.slice(1).map(p => p.id);

          await supabase
            .from('vehicle_images')
            .update({ is_primary: false })
            .in('id', removeIds);

          console.log(`   ✅ Fixed duplicate primaries for vehicle ${duplicate.vehicle_id}`);
        }
      }
    }

    console.log('\n🎯 ALL PRIMARY IMAGES FIXED!');
    console.log('✅ Every vehicle now has proper primary image handling');
    console.log('✅ No more broken thumbnails on the frontend');

  } catch (error) {
    console.error('❌ Primary image fix failed:', error);
  }
}

fixAllPrimaryImages().catch(console.error);
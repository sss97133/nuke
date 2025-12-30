#!/usr/bin/env node

/**
 * Comprehensive fix for image contamination issues
 * 1. Verifies all images belong to correct vehicle
 * 2. Removes images that don't match vehicle metadata
 * 3. Re-imports BAT images correctly
 * 4. Sets correct primary image
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

const VEHICLE_ID = process.argv[2] || 'bfaf7f3c-9a6a-4164-bffb-1e9fae075883';

async function comprehensiveFix() {
  console.log(`\n🔧 Comprehensive Image Fix for Vehicle: ${VEHICLE_ID}\n`);
  console.log('='.repeat(80));

  // 1. Get vehicle data
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', VEHICLE_ID)
    .single();

  if (!vehicle) {
    console.error('❌ Vehicle not found');
    return;
  }

  console.log(`\n1️⃣  Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  console.log(`   VIN: ${vehicle.vin || 'N/A'}`);
  console.log(`   BAT URL: ${vehicle.bat_auction_url || vehicle.discovery_url || 'N/A'}`);

  // 2. Get all images for this vehicle
  const { data: allImages } = await supabase
    .from('vehicle_images')
    .select('id, image_url, source_url, is_primary, position, source, created_at, is_duplicate, is_document, file_hash')
    .eq('vehicle_id', VEHICLE_ID);

  console.log(`\n2️⃣  Current Images: ${allImages?.length || 0} total`);

  // 3. Check for images that might belong to other vehicles (by checking if same image_url exists for other vehicles)
  console.log(`\n3️⃣  Checking for cross-vehicle contamination...`);
  const suspiciousImages = [];
  
  if (allImages && allImages.length > 0) {
    for (const img of allImages) {
      if (!img.image_url) continue;
      
      // Check if this image URL exists for other vehicles
      const { data: otherVehicles } = await supabase
        .from('vehicle_images')
        .select('vehicle_id, vehicles!inner(id, year, make, model)')
        .eq('image_url', img.image_url)
        .neq('vehicle_id', VEHICLE_ID)
        .limit(5);

      if (otherVehicles && otherVehicles.length > 0) {
        suspiciousImages.push({
          image: img,
          otherVehicles: otherVehicles.map(ov => ({
            id: ov.vehicles.id,
            name: `${ov.vehicles.year} ${ov.vehicles.make} ${ov.vehicles.model}`
          }))
        });
      }
    }
  }

  if (suspiciousImages.length > 0) {
    console.log(`   ⚠️  Found ${suspiciousImages.length} suspicious images:`);
    suspiciousImages.forEach((item, idx) => {
      console.log(`   ${idx + 1}. Image ${item.image.id}`);
      console.log(`      URL: ${item.image.image_url.substring(0, 80)}...`);
      console.log(`      Also belongs to: ${item.otherVehicles.map(v => v.name).join(', ')}`);
    });
  } else {
    console.log('   ✅ No cross-vehicle contamination detected');
  }

  // 4. Get BAT canonical images from origin_metadata
  console.log(`\n4️⃣  Checking BAT canonical images...`);
  const batUrl = vehicle.bat_auction_url || vehicle.discovery_url;
  const canonicalImages = vehicle.origin_metadata?.image_urls || [];
  
  console.log(`   Canonical BAT images in metadata: ${canonicalImages.length}`);
  
  if (batUrl && batUrl.includes('bringatrailer.com/listing/') && canonicalImages.length === 0) {
    console.log('   ⚠️  No canonical images found, need to re-scrape...');
    
    // Try to get images from BAT listing
    try {
      const { data: scrapeResult } = await supabase.functions.invoke('scrape-vehicle', {
        body: { url: batUrl, vehicle_id: VEHICLE_ID }
      });
      
      if (scrapeResult?.images && scrapeResult.images.length > 0) {
        console.log(`   ✅ Scraped ${scrapeResult.images.length} images`);
        
        // Update origin_metadata with canonical images
        const updatedMetadata = {
          ...(vehicle.origin_metadata || {}),
          image_urls: scrapeResult.images,
          image_count: scrapeResult.images.length
        };
        
        await supabase
          .from('vehicles')
          .update({ origin_metadata: updatedMetadata })
          .eq('id', VEHICLE_ID);
        
        // Backfill these images
        console.log('   📥 Backfilling BAT images...');
        await supabase.functions.invoke('backfill-images', {
          body: {
            vehicle_id: VEHICLE_ID,
            image_urls: scrapeResult.images,
            source: 'bat_import',
            run_analysis: false,
            max_images: 0,
            continue: true,
            sleep_ms: 150
          }
        });
      }
    } catch (err) {
      console.error('   ❌ Scrape error:', err.message);
    }
  } else if (canonicalImages.length > 0) {
    // Check if canonical images are actually in vehicle_images
    const { data: existingBAT } = await supabase
      .from('vehicle_images')
      .select('id, image_url, source_url')
      .eq('vehicle_id', VEHICLE_ID)
      .or('source.eq.bat_import,image_url.ilike.%bringatrailer.com%');
    
    const existingBATUrls = new Set((existingBAT || []).map(img => {
      const url = img.source_url || img.image_url || '';
      return url.split('#')[0].split('?')[0].replace(/-scaled\./g, '.');
    }));
    
    const missingCanonical = canonicalImages.filter(canonical => {
      const normalized = canonical.split('#')[0].split('?')[0].replace(/-scaled\./g, '.');
      return !Array.from(existingBATUrls).some(existing => existing.includes(normalized) || normalized.includes(existing));
    });
    
    if (missingCanonical.length > 0) {
      console.log(`   ⚠️  ${missingCanonical.length} canonical images missing, backfilling...`);
      await supabase.functions.invoke('backfill-images', {
        body: {
          vehicle_id: VEHICLE_ID,
          image_urls: missingCanonical,
          source: 'bat_import',
          run_analysis: false,
          max_images: 0,
          continue: true,
          sleep_ms: 150
        }
      });
    } else {
      console.log('   ✅ All canonical images present');
    }
  }

  // 5. Run repair RPC
  console.log(`\n5️⃣  Running repair RPC...`);
  try {
    const { data: repairResult } = await supabase.rpc('repair_bat_vehicle_gallery_images', {
      p_vehicle_id: VEHICLE_ID,
      p_dry_run: false
    });
    
    console.log(`   ✅ Repair complete:`, JSON.stringify(repairResult, null, 2));
  } catch (err) {
    console.error('   ❌ Repair error:', err.message);
  }

  // 6. Set correct primary image
  console.log(`\n6️⃣  Setting correct primary image...`);
  const { data: validImages } = await supabase
    .from('vehicle_images')
    .select('id, image_url, is_primary, position, source')
    .eq('vehicle_id', VEHICLE_ID)
    .not('is_duplicate', 'is', true)
    .not('is_document', 'is', true)
    .order('position', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
    .limit(1);

  if (validImages && validImages.length > 0) {
    const bestImage = validImages[0];
    
    // Unset all primaries
    await supabase
      .from('vehicle_images')
      .update({ is_primary: false })
      .eq('vehicle_id', VEHICLE_ID);
    
    // Set new primary
    await supabase
      .from('vehicle_images')
      .update({ is_primary: true })
      .eq('id', bestImage.id);
    
    // Update vehicle
    await supabase
      .from('vehicles')
      .update({
        primary_image_url: bestImage.image_url,
        image_url: bestImage.image_url,
        updated_at: new Date().toISOString()
      })
      .eq('id', VEHICLE_ID);
    
    console.log(`   ✅ Primary image set to: ${bestImage.image_url.substring(0, 80)}...`);
  }

  // 7. Final verification
  console.log(`\n7️⃣  Final Verification...`);
  const { data: finalImages } = await supabase
    .from('vehicle_images')
    .select('id, image_url, is_primary, source')
    .eq('vehicle_id', VEHICLE_ID)
    .not('is_duplicate', 'is', true)
    .not('is_document', 'is', true);

  console.log(`   Total valid images: ${finalImages?.length || 0}`);
  console.log(`   Primary images: ${finalImages?.filter(img => img.is_primary).length || 0}`);
  console.log(`   BAT images: ${finalImages?.filter(img => img.source === 'bat_import' || img.image_url?.includes('bringatrailer.com')).length || 0}`);

  console.log('\n' + '='.repeat(80));
  console.log('\n✅ Comprehensive fix complete!\n');
}

comprehensiveFix().catch(console.error);


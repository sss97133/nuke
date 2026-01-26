/**
 * BACKFILL C&B Images from origin_metadata
 *
 * Many C&B vehicles have image URLs stored in origin_metadata but
 * not in vehicle_images table. This script fixes that.
 *
 * Also attempts to extract VIN/mileage from origin_metadata if present.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('=== BACKFILL C&B from origin_metadata ===\n');

  // Find C&B vehicles with origin_metadata
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, mileage, discovery_url, origin_metadata')
    .ilike('discovery_url', '%carsandbids%')
    .not('origin_metadata', 'is', null)
    .limit(100);

  if (error) {
    console.log('Error:', error.message);
    return;
  }

  console.log(`Found ${vehicles?.length || 0} C&B vehicles with metadata\n`);

  let imagesAdded = 0;
  let vehiclesUpdated = 0;

  for (const v of vehicles || []) {
    const meta = v.origin_metadata as any;
    if (!meta) continue;

    console.log(`\n📋 ${v.year} ${v.make} ${v.model}`);

    // Check current image count
    const { count: currentImages } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_id', v.id);

    // Get image URLs from metadata
    const imageUrls: string[] = [];

    // Check various places images might be stored
    if (Array.isArray(meta.image_urls)) {
      imageUrls.push(...meta.image_urls);
    }
    if (Array.isArray(meta.images)) {
      for (const img of meta.images) {
        const url = typeof img === 'string' ? img : img?.url;
        if (url) imageUrls.push(url);
      }
    }

    const uniqueUrls = [...new Set(imageUrls.filter(u => u && typeof u === 'string' && u.startsWith('http')))];

    console.log(`   Current images: ${currentImages || 0}, In metadata: ${uniqueUrls.length}`);

    // Add missing images
    if (uniqueUrls.length > (currentImages || 0)) {
      const newImages = uniqueUrls.slice(0, 100).map((url, idx) => ({
        vehicle_id: v.id,
        image_url: url,
        display_order: idx,
        source: 'cars_and_bids_backfill',
        created_at: new Date().toISOString(),
      }));

      const { error: imgError, count: insertedCount } = await supabase
        .from('vehicle_images')
        .upsert(newImages, { onConflict: 'vehicle_id,image_url', ignoreDuplicates: true });

      if (imgError) {
        console.log(`   ⚠️ Image insert error: ${imgError.message}`);
      } else {
        imagesAdded += uniqueUrls.length - (currentImages || 0);
        console.log(`   ✅ Added ${uniqueUrls.length - (currentImages || 0)} images`);
      }
    }

    // Try to extract VIN/mileage from various metadata fields
    const updates: any = {};

    // Check for VIN
    if (!v.vin) {
      const possibleVin = meta.vin || meta.VIN || meta.vehicleIdentificationNumber;
      if (possibleVin && typeof possibleVin === 'string' && possibleVin.length >= 11) {
        updates.vin = possibleVin;
        console.log(`   VIN from metadata: ${possibleVin}`);
      }
    }

    // Check for mileage
    if (!v.mileage) {
      const possibleMileage = meta.mileage || meta.odometer || meta.miles;
      if (possibleMileage) {
        const mileage = typeof possibleMileage === 'string'
          ? parseInt(possibleMileage.replace(/[^0-9]/g, ''), 10)
          : possibleMileage;
        if (mileage > 0) {
          updates.mileage = mileage;
          console.log(`   Mileage from metadata: ${mileage}`);
        }
      }
    }

    // Check highlights for VIN pattern
    if (!updates.vin && meta.highlights && Array.isArray(meta.highlights)) {
      for (const h of meta.highlights) {
        if (typeof h === 'string') {
          // Look for VIN pattern (17 alphanumeric chars, often in format "VIN: XXXXX...")
          const vinMatch = h.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
          if (vinMatch) {
            updates.vin = vinMatch[1];
            console.log(`   VIN from highlights: ${vinMatch[1]}`);
            break;
          }
        }
      }
    }

    // Check story for VIN and mileage
    if (meta.story && typeof meta.story === 'string') {
      if (!updates.vin) {
        const vinMatch = meta.story.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
        if (vinMatch) {
          updates.vin = vinMatch[1];
          console.log(`   VIN from story: ${vinMatch[1]}`);
        }
      }
      if (!updates.mileage && !v.mileage) {
        const mileageMatch = meta.story.match(/([\d,]+)\s*(?:miles|mi)/i);
        if (mileageMatch) {
          const mileage = parseInt(mileageMatch[1].replace(/,/g, ''), 10);
          if (mileage > 0 && mileage < 1000000) {
            updates.mileage = mileage;
            console.log(`   Mileage from story: ${mileage}`);
          }
        }
      }
    }

    // Update vehicle if we have changes
    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      const { error: updateError } = await supabase
        .from('vehicles')
        .update(updates)
        .eq('id', v.id);

      if (updateError) {
        console.log(`   ⚠️ Update error: ${updateError.message}`);
      } else {
        vehiclesUpdated++;
        console.log(`   ✅ Vehicle updated`);
      }
    }
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Images added: ${imagesAdded}`);
  console.log(`Vehicles updated with VIN/mileage: ${vehiclesUpdated}`);
}

main().catch(console.error);

#!/usr/bin/env node
/**
 * Script to download all external vehicle images to Supabase Storage
 * 
 * Usage:
 *   node scripts/download-external-images.js [vehicle_id]
 * 
 * If vehicle_id is provided, only downloads images for that vehicle.
 * Otherwise, downloads all external images in batches.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env') });
dotenv.config({ path: join(__dirname, '../.env.local') });

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const vehicleId = process.argv[2] || null;
const BATCH_SIZE = 5;
const DELAY_MS = 1000;

async function downloadAndUploadImage(imageUrl, imgId, vehicleId) {
  try {
    if (!imageUrl || !imageUrl.startsWith('http')) {
      return { success: false, error: 'Invalid URL' };
    }

    // Download image
    const imageResponse = await fetch(imageUrl, {
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });

    if (!imageResponse.ok) {
      return { success: false, error: `HTTP ${imageResponse.status}` };
    }

    const imageBlob = await imageResponse.blob();
    const arrayBuffer = await imageBlob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // Determine file extension
    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : 
               contentType.includes('webp') ? 'webp' : 'jpg';
    
    // Generate storage path
    const fileName = `${Date.now()}_${imgId}.${ext}`;
    const storagePath = `${vehicleId}/${fileName}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('vehicle-images')
      .upload(storagePath, uint8Array, {
        contentType: contentType,
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadError) {
      return { success: false, error: uploadError.message };
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('vehicle-images')
      .getPublicUrl(storagePath);

    // Update vehicle_images record with storage path and remove is_external flag
    const { error: updateError } = await supabase
      .from('vehicle_images')
      .update({
        image_url: publicUrl,
        storage_path: storagePath,
        is_external: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', imgId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}

async function downloadExternalImages() {
  try {
    console.log('📥 Starting download of external images...');
    if (vehicleId) {
      console.log(`   Targeting vehicle: ${vehicleId}`);
    } else {
      console.log('   Processing all vehicles with external images');
    }

    // Query external images that haven't been downloaded yet
    let query = supabase
      .from('vehicle_images')
      .select('id, vehicle_id, image_url, position')
      .eq('is_external', true)
      .is('storage_path', null)
      .order('position', { ascending: true })
      .limit(1000);

    if (vehicleId) {
      query = query.eq('vehicle_id', vehicleId);
    }

    const { data: externalImages, error: fetchError } = await query;

    if (fetchError) {
      throw new Error(`Failed to fetch external images: ${fetchError.message}`);
    }

    if (!externalImages || externalImages.length === 0) {
      console.log('✅ No external images found to download');
      return;
    }

    console.log(`📥 Found ${externalImages.length} external images to download. Processing in batches of ${BATCH_SIZE} with ${DELAY_MS}ms delays...`);

    let downloaded = 0;
    const errors = [];
    const vehicleIds = new Set();

    // Process in batches with delays
    for (let i = 0; i < externalImages.length; i += BATCH_SIZE) {
      const batch = externalImages.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(externalImages.length / BATCH_SIZE);

      console.log(`📥 Processing batch ${batchNum}/${totalBatches} (${batch.length} images)...`);

      // Process batch in parallel
      const batchResults = await Promise.allSettled(
        batch.map((img) => downloadAndUploadImage(img.image_url, img.id, img.vehicle_id))
      );

      // Count successes and errors
      let batchDownloaded = 0;
      for (const result of batchResults) {
        if (result.status === 'fulfilled' && result.value.success) {
          batchDownloaded++;
          downloaded++;
          vehicleIds.add(batch[batchResults.indexOf(result)]?.vehicle_id);
        } else {
          const errorMsg = result.status === 'rejected'
            ? result.reason?.message || 'Unknown error'
            : result.value.error || 'Unknown error';
          const img = batch[batchResults.indexOf(result)];
          errors.push(`Image ${img?.id}: ${errorMsg}`);
        }
      }

      console.log(`✅ Batch ${batchNum}/${totalBatches} complete: ${batchDownloaded}/${batch.length} downloaded`);

      // Delay between batches (except for the last batch)
      if (i + BATCH_SIZE < externalImages.length) {
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      }
    }

    console.log('\n✅ Download complete!');
    console.log(`   Downloaded: ${downloaded}/${externalImages.length}`);
    console.log(`   Vehicles affected: ${vehicleIds.size}`);
    
    if (errors.length > 0) {
      console.log(`\n⚠️  Errors (${errors.length}):`);
      errors.slice(0, 10).forEach((err, i) => {
        console.log(`   ${i + 1}. ${err}`);
      });
      if (errors.length > 10) {
        console.log(`   ... and ${errors.length - 10} more errors`);
      }
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

downloadExternalImages();


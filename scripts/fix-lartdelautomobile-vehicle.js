#!/usr/bin/env node
/**
 * Fix a specific lartdelautomobile.com vehicle profile
 * 1. Extract all images from the listing page
 * 2. Import missing images
 * 3. Analyze images for VIN extraction (Porsche VIN tags)
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VEHICLE_ID = '5d851064-9b85-4fc3-a61a-7edc3f9996d7';
const LISTING_URL = 'https://www.lartdelautomobile.com/fiche/porsche-911-2-0l-1965';

// Get import user ID (system user)
async function getImportUserId() {
  const { data, error } = await supabase
    .from('auth.users')
    .select('id')
    .or('email.eq.system@n-zero.dev,email.eq.admin@n-zero.dev')
    .limit(1)
    .single();
  
  if (data) return data.id;
  
  // Fallback: get first admin user
  const { data: admin } = await supabase
    .from('auth.users')
    .select('id')
    .limit(1)
    .single();
  
  return admin?.id || null;
}

/**
 * Scrape all images from lartdelautomobile.com page
 */
async function scrapeImages() {
  console.log(`🔍 Scraping images from: ${LISTING_URL}`);
  
  try {
    // Use the scrape-vehicle edge function
    const { data: scrapeData, error: scrapeError } = await supabase.functions.invoke('scrape-vehicle', {
      body: { url: LISTING_URL }
    });

    if (scrapeError) {
      throw new Error(`Scrape failed: ${scrapeError.message}`);
    }

    if (!scrapeData?.success) {
      throw new Error('Scrape returned unsuccessful');
    }

    // Get hi-res images (prefer images_hi_res, fallback to images)
    const images = scrapeData.images_hi_res || scrapeData.images || [];
    
    console.log(`   ✅ Found ${images.length} images`);
    
    // Filter to only valid URLs
    const validImages = images.filter(img => 
      typeof img === 'string' && 
      img.startsWith('http') && 
      !img.includes('icon') && 
      !img.includes('logo')
    );

    console.log(`   ✅ ${validImages.length} valid image URLs`);
    
    return validImages;
  } catch (error) {
    console.error(`   ❌ Error scraping: ${error.message}`);
    throw error;
  }
}

/**
 * Get existing image URLs for vehicle
 */
async function getExistingImageUrls() {
  const { data: images, error } = await supabase
    .from('vehicle_images')
    .select('source_url, image_url')
    .eq('vehicle_id', VEHICLE_ID)
    .or('is_document.is.null,is_document.eq.false');

  if (error) {
    console.error(`   ❌ Error fetching existing images: ${error.message}`);
    return new Set();
  }

  const urls = new Set();
  (images || []).forEach(img => {
    if (img.source_url) urls.add(img.source_url);
    if (img.image_url) {
      // Extract source URL from Cloudinary URLs
      const match = img.image_url.match(/\/v\d+\/([^\/]+)$/);
      if (match) {
        urls.add(img.image_url);
      }
    }
  });

  return urls;
}

/**
 * Import missing images
 */
async function importImages(imageUrls, importUserId) {
  console.log(`\n📥 Importing ${imageUrls.length} images...`);
  
  const existingUrls = await getExistingImageUrls();
  console.log(`   ℹ️  Vehicle already has ${existingUrls.size} images`);

  // Filter out existing images
  const newImages = imageUrls.filter(url => {
    // Check if URL or any variation exists
    const normalized = url.toLowerCase();
    for (const existing of existingUrls) {
      if (existing.toLowerCase().includes(normalized.split('/').pop()) || 
          normalized.includes(existing.split('/').pop())) {
        return false;
      }
    }
    return true;
  });

  console.log(`   ✅ ${newImages.length} new images to import`);

  if (newImages.length === 0) {
    console.log(`   ℹ️  No new images to import`);
    return { imported: 0, skipped: imageUrls.length };
  }

  let imported = 0;
  let failed = 0;

  // Use the backfill-images edge function for bulk import
  try {
    console.log(`   📡 Calling backfill-images edge function...`);
    const { data: backfillData, error: backfillError } = await supabase.functions.invoke('backfill-images', {
      body: {
        vehicle_id: VEHICLE_ID,
        image_urls: newImages,
        source: 'external_import', // Use allowed source
        run_analysis: false // We'll analyze separately for VIN
      }
    });

    if (backfillError) {
      console.log(`   ⚠️  Backfill function error: ${backfillError.message}`);
      throw new Error(`Backfill failed: ${backfillError.message}`);
    }

    if (!backfillData) {
      throw new Error('Backfill returned no data');
    }

    imported = backfillData.uploaded || backfillData.imported || 0;
    failed = backfillData.failed || 0;
    const skipped = backfillData.skipped || 0;
    
    console.log(`   📊 Backfill result: uploaded=${imported}, failed=${failed}, skipped=${skipped}`);
    
    // Log errors if available
    if (backfillData.errors && backfillData.errors.length > 0) {
      console.log(`   ⚠️  Errors: ${backfillData.errors.slice(0, 3).join(', ')}`);
      if (backfillData.errors.length > 3) {
        console.log(`   ... and ${backfillData.errors.length - 3} more errors`);
      }
    }

    if (imported > 0) {
      console.log(`   ✅ Imported ${imported} images via backfill-images`);
    }
    if (failed > 0) {
      console.log(`   ⚠️  Failed to import ${failed} images`);
    }
    if (imported === 0 && failed === 0 && skipped > 0) {
      console.log(`   ℹ️  All images were skipped (likely duplicates)`);
      return { imported: 0, skipped: imageUrls.length, failed: 0 };
    }
    
    // If bulk import succeeded, return
    if (imported > 0) {
      return { imported, skipped: imageUrls.length - newImages.length, failed };
    }
    
    // If bulk import failed, log and continue to fallback
    if (imported === 0 && failed > 0) {
      console.log(`   ⚠️  Bulk import failed, trying individual import fallback...`);
    }
  } catch (error) {
    console.error(`   ❌ Error during bulk import: ${error.message}`);
    console.log(`   🔄 Falling back to individual import...`);
  }
  
  // Fallback: import individually (runs if bulk import failed or threw error)
  if (imported === 0 && newImages.length > 0) {
    console.log(`   📥 Starting individual image import (${newImages.length} images)...`);
    for (let i = 0; i < newImages.length; i++) {
      const url = newImages[i];
      try {
        // Download image
        const response = await fetch(url);
        if (!response.ok) {
          failed++;
          continue;
        }

        const buffer = await response.arrayBuffer();
        const fileName = url.split('/').pop() || `image-${i}.jpg`;
        const storagePath = `${VEHICLE_ID}/${fileName}`;

        // Upload to storage
        const { error: uploadError } = await supabase.storage
          .from('vehicle-images')
          .upload(storagePath, buffer, {
            contentType: response.headers.get('content-type') || 'image/jpeg',
            cacheControl: '3600',
            upsert: false
          });

        if (uploadError) {
          failed++;
          continue;
        }

        // Get public URL
        const { data: { publicUrl } } = supabase.storage
          .from('vehicle-images')
          .getPublicUrl(storagePath);

        // Create image record
        // Note: approval_status has a default value, so we don't need to set it
        const { error: insertError } = await supabase
          .from('vehicle_images')
          .insert({
            vehicle_id: VEHICLE_ID,
            image_url: publicUrl,
            source_url: url,
            user_id: importUserId || null, // Use system user ID if available
            is_primary: i === 0 && imported === 0,
            source: 'lartdelautomobile',
            taken_at: new Date().toISOString(),
            storage_path: storagePath,
            filename: fileName,
            mime_type: response.headers.get('content-type') || 'image/jpeg',
            file_size: buffer.byteLength
          });

        if (insertError) {
          console.log(`      ❌ Insert error ${i + 1}/${newImages.length}: ${insertError.message}`);
          console.log(`      📋 Error code: ${insertError.code}, details: ${insertError.details || 'none'}`);
          failed++;
        } else {
          imported++;
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));

        if ((i + 1) % 10 === 0) {
          console.log(`   📸 Imported ${i + 1}/${newImages.length}...`);
        }
      } catch (err) {
        failed++;
        console.error(`   ⚠️  Failed to import image ${i + 1}: ${err.message}`);
      }
    }
  }

  return { imported, skipped: imageUrls.length - newImages.length, failed };
}

/**
 * Analyze images for VIN extraction
 */
async function extractVINFromImages() {
  console.log(`\n🔍 Analyzing images for VIN...`);
  
  // Get all images for this vehicle
  const { data: images, error } = await supabase
    .from('vehicle_images')
    .select('id, image_url, source_url')
    .eq('vehicle_id', VEHICLE_ID)
    .or('is_document.is.null,is_document.eq.false')
    .order('created_at', { ascending: true });

  if (error || !images || images.length === 0) {
    console.log(`   ❌ No images found to analyze`);
    return null;
  }

  console.log(`   ℹ️  Analyzing ${images.length} images...`);

  // Use analyze-image edge function for VIN detection
  // Note: This will use GPT-4 Vision to detect Porsche VIN tags
  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const imageUrl = image.image_url || image.source_url;
    
    if (!imageUrl) continue;

    try {
      console.log(`   🔍 Analyzing image ${i + 1}/${images.length}...`);
      
      const { data: analysisData, error: analysisError } = await supabase.functions.invoke('analyze-image', {
        body: {
          image_url: imageUrl,
          vehicle_id: VEHICLE_ID,
          image_id: image.id
          // VIN detection is automatic in analyze-image
        }
      });

      if (analysisError) {
        console.log(`      ⚠️  Analysis error: ${analysisError.message}`);
        continue;
      }

      // Check metadata for VIN (stored in ai_scan_metadata.vin_tag)
      // The analyze-image function automatically updates the vehicle VIN if found
      // But we check the metadata to see if it was detected
      const { data: updatedImage } = await supabase
        .from('vehicle_images')
        .select('ai_scan_metadata')
        .eq('id', image.id)
        .single();

      if (updatedImage?.ai_scan_metadata?.vin_tag?.vin) {
        const vinData = updatedImage.ai_scan_metadata.vin_tag;
        const vin = vinData.vin;
        console.log(`      ✅ VIN found: ${vin}`);
        console.log(`      📍 Location: ${vinData.vin_location || 'unknown'}`);
        console.log(`      🎯 Confidence: ${vinData.confidence || 0}%`);
        console.log(`      📝 Format: ${vinData.vin_format || 'unknown'}`);
        
        // Check if vehicle was updated (analyze-image does this automatically)
        const { data: vehicle } = await supabase
          .from('vehicles')
          .select('vin')
          .eq('id', VEHICLE_ID)
          .single();

        if (vehicle?.vin === vin) {
          console.log(`      ✅ Vehicle VIN already updated by analyze-image`);
          return vin;
        } else if (!vehicle?.vin) {
          // Fallback: update manually if analyze-image didn't
          const { error: updateError } = await supabase
            .from('vehicles')
            .update({ vin: vin.toUpperCase() })
            .eq('id', VEHICLE_ID);

          if (updateError) {
            console.log(`      ⚠️  Failed to update vehicle VIN: ${updateError.message}`);
          } else {
            console.log(`      ✅ Vehicle VIN updated successfully`);
            return vin.toUpperCase();
          }
        }
      }

      // Rate limiting for API calls
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (err) {
      console.log(`      ⚠️  Error analyzing image: ${err.message}`);
    }
  }

  console.log(`   ❌ No VIN found in any images`);
  return null;
}

/**
 * Main function
 */
async function main() {
  console.log('🚀 Fixing L\'Art de l\'Automobile Vehicle Profile\n');
  console.log(`Vehicle ID: ${VEHICLE_ID}`);
  console.log(`Listing URL: ${LISTING_URL}\n`);

  // Get vehicle info
  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, listing_url, discovery_url')
    .eq('id', VEHICLE_ID)
    .single();

  if (vehicleError || !vehicle) {
    console.error(`❌ Vehicle not found: ${vehicleError?.message}`);
    process.exit(1);
  }

  console.log(`📋 Vehicle: ${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}`);
  console.log(`   Current VIN: ${vehicle.vin || 'NONE'}`);
  console.log(`   Discovery URL: ${vehicle.discovery_url || 'NONE'}\n`);

  // Step 1: Scrape images
  let images = [];
  try {
    images = await scrapeImages();
  } catch (error) {
    console.error(`❌ Failed to scrape images: ${error.message}`);
    process.exit(1);
  }

  if (images.length === 0) {
    console.log(`❌ No images found`);
    process.exit(1);
  }

  // Step 2: Import missing images
  // Get system user ID for imports (user_id is required)
  const importUserId = await getImportUserId();
  if (!importUserId) {
    console.error(`❌ Could not find system user ID for imports`);
    console.log(`   Attempting import anyway (may fail due to user_id constraint)...`);
  }
  const importResult = await importImages(images, importUserId);
  console.log(`\n📊 Import Summary:`);
  console.log(`   Total images available: ${images.length}`);
  console.log(`   Already had: ${importResult.skipped}`);
  console.log(`   Newly imported: ${importResult.imported}`);
  console.log(`   Failed: ${importResult.failed || 0}`);

  // Step 3: Extract VIN from images (if not already present)
  if (!vehicle.vin) {
    const extractedVIN = await extractVINFromImages();
    if (extractedVIN) {
      console.log(`\n✅ VIN extraction complete: ${extractedVIN}`);
    }
  } else {
    console.log(`\nℹ️  Vehicle already has VIN: ${vehicle.vin}`);
    console.log(`   Skipping VIN extraction`);
  }

  console.log(`\n✅ Profile fix complete!`);
}

main().catch(console.error);

#!/usr/bin/env node
/**
 * Download and upload images for KSL-imported vehicles
 * The scraper returns image URLs but doesn't download them
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function downloadAndUploadImage(imageUrl, vehicleId, index, listedDate = null) {
  try {
    // Check if this exact image URL already exists for this vehicle
    const { data: existing } = await supabase
      .from('vehicle_images')
      .select('id')
      .eq('vehicle_id', vehicleId)
      .eq('source', 'ksl_scrape')
      .like('image_url', `%${imageUrl.split('/').pop()}%`)
      .maybeSingle();
    
    if (existing) {
      console.log(`    ⏭️  Image ${index + 1} already exists, skipping`);
      return false;
    }
    
    // Download image
    const imageResponse = await fetch(imageUrl, {
      signal: AbortSignal.timeout(15000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (!imageResponse.ok) {
      throw new Error(`HTTP ${imageResponse.status}`);
    }
    
    const imageBlob = await imageResponse.blob();
    const arrayBuffer = await imageBlob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    // Generate filename
    const ext = imageUrl.match(/\.(jpg|jpeg|png|webp)$/i)?.[1] || 'jpg';
    const fileName = `ksl_${Date.now()}_${index}.${ext}`;
    const storagePath = `${vehicleId}/${fileName}`;
    
    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('vehicle-images')
      .upload(storagePath, uint8Array, {
        contentType: `image/${ext}`,
        cacheControl: '3600',
        upsert: false
      });
    
    if (uploadError) {
      throw uploadError;
    }
    
    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('vehicle-images')
      .getPublicUrl(storagePath);
    
    // Create vehicle_images record
    // Use admin user ID for automated imports
    const ADMIN_USER_ID = '13450c45-3e8b-4124-9f5b-5c512094ff04';
    
    // Use listing date for taken_at if available, otherwise null
    const imageData = {
      vehicle_id: vehicleId,
      user_id: ADMIN_USER_ID,
      image_url: publicUrl,
      is_primary: index === 0,
      source: 'ksl_scrape'
    };
    
    // Set taken_at to listing date so images show correct date
    if (listedDate) {
      imageData.taken_at = listedDate;
    }
    
    const { data: insertedImage, error: imageInsertError } = await supabase
      .from('vehicle_images')
      .insert(imageData)
      .select('id')
      .single();
    
    if (imageInsertError) {
      throw imageInsertError;
    }
    
    // Trigger AI analysis for the image (non-blocking)
    if (insertedImage?.id) {
      supabase.functions.invoke('analyze-image-tier1', {
        body: {
          image_url: publicUrl,
          vehicle_id: vehicleId,
          image_id: insertedImage.id,
          user_id: ADMIN_USER_ID
        }
      }).catch(err => {
        // Non-critical, just log
        console.log(`    ⚠️  AI analysis queued (may fail silently)`);
      });
    }
    
    return true;
  } catch (error) {
    console.error(`    ❌ Image ${index + 1} failed: ${error.message}`);
    return false;
  }
}

async function backfillKSLImages() {
  console.log('🔍 Finding KSL vehicles without images...\n');
  
  // Get KSL-imported vehicles
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, origin_metadata')
    .eq('discovery_source', 'ksl_automated_import')
    .order('created_at', { ascending: false });
  
  if (error) {
    console.error('❌ Error:', error);
    return;
  }
  
  console.log(`Found ${vehicles.length} KSL vehicles\n`);
  
  let processed = 0;
  let skipped = 0;
  let errors = 0;
  
  for (const vehicle of vehicles) {
    const vehicleInfo = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
    console.log(`\n[${processed + skipped + errors + 1}/${vehicles.length}] ${vehicleInfo}`);
    
    // Check if vehicle already has images
    const { count: existingImages } = await supabase
      .from('vehicle_images')
      .select('id', { count: 'exact', head: true })
      .eq('vehicle_id', vehicle.id);
    
    if (existingImages > 0) {
      console.log(`  ⏭️  Already has ${existingImages} images, skipping`);
      skipped++;
      continue;
    }
    
    // Re-scrape the listing to get image URLs
    if (!vehicle.discovery_url) {
      console.log(`  ⚠️  No discovery_url, skipping`);
      skipped++;
      continue;
    }
    
    try {
      console.log(`  📥 Scraping images from ${vehicle.discovery_url}`);
      
      const { data: scrapeData, error: scrapeError } = await supabase.functions.invoke('scrape-vehicle', {
        body: { url: vehicle.discovery_url },
        timeout: 60000
      });
      
      if (scrapeError) {
        throw new Error(`Scrape failed: ${scrapeError.message}`);
      }
      
      const listingData = scrapeData?.data || scrapeData;
      const images = listingData?.images || [];
      const listedDate = listingData?.listed_date || vehicle.origin_metadata?.listed_date || null;
      
      if (images.length === 0) {
        console.log(`  ⚠️  No images found in listing`);
        skipped++;
        continue;
      }
      
      console.log(`  📸 Found ${images.length} images, downloading ALL...`);
      if (listedDate) {
        console.log(`  📅 Using listing date: ${listedDate.split('T')[0]}`);
      }
      
      let uploaded = 0;
      for (let i = 0; i < images.length; i++) {
        const success = await downloadAndUploadImage(images[i], vehicle.id, i, listedDate);
        if (success) {
          uploaded++;
          console.log(`    ✅ Image ${i + 1}/${images.length} uploaded`);
        }
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      
      console.log(`  ✅ Uploaded ${uploaded}/${images.length} images`);
      processed++;
      
    } catch (error) {
      console.error(`  ❌ Error: ${error.message}`);
      errors++;
    }
    
    // Rate limiting between vehicles
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ Processed: ${processed} vehicles`);
  console.log(`⏭️  Skipped: ${skipped} vehicles`);
  console.log(`❌ Errors: ${errors} vehicles`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

backfillKSLImages().catch(console.error);


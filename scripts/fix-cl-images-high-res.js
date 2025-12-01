/**
 * Fix Craigslist Images - Download and Upload High-Res to Supabase
 * Replaces direct CL URLs with proper uploaded images
 */

import { createClient } from '@supabase/supabase-js';
import https from 'https';
import { readFileSync } from 'fs';

const SUPABASE_URL = 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || readFileSync('.env.local', 'utf8').match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)?.[1]?.trim();

if (!SUPABASE_SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
});

function upgradeCraigslistImageUrl(url) {
  // Upgrade to highest resolution (1200x900)
  if (url.includes('_50x50c.jpg') || url.includes('_300x300.jpg')) {
    return url.replace(/_50x50c\.jpg|_300x300\.jpg/g, '_1200x900.jpg');
  }
  if (url.includes('_600x450.jpg')) {
    return url.replace('_600x450.jpg', '_1200x900.jpg');
  }
  // Already high-res or unknown format
  return url.replace(/_(\d+x\d+)\.jpg/, '_1200x900.jpg');
}

function downloadImage(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve(buffer);
      });
      response.on('error', reject);
    }).on('error', reject);
  });
}

async function processVehicle(vehicleId, vehicleName, discoveryUrl) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Processing: ${vehicleName}`);
  console.log(`Vehicle ID: ${vehicleId}`);
  console.log(`${'='.repeat(60)}`);

  // Get vehicle data
  const { data: vehicleData, error: vehicleError } = await supabase
    .from('vehicles')
    .select('id, uploaded_by, discovery_url')
    .eq('id', vehicleId)
    .single();

  if (vehicleError || !vehicleData) {
    console.log(`❌ Vehicle not found: ${vehicleError?.message}`);
    return { success: false, reason: 'not_found' };
  }

  // Get existing CL images (if any)
  const { data: existingImages, error: imagesError } = await supabase
    .from('vehicle_images')
    .select('id, image_url, source_url')
    .eq('vehicle_id', vehicleId)
    .eq('source', 'craigslist_scrape')
    .like('image_url', '%craigslist.org%');

  const hasExistingCLImages = existingImages && existingImages.length > 0;
  
  if (hasExistingCLImages) {
    console.log(`📸 Found ${existingImages.length} CL image(s) to replace`);
  } else {
    // Check if vehicle already has any images
    const { data: anyImages } = await supabase
      .from('vehicle_images')
      .select('id')
      .eq('vehicle_id', vehicleId)
      .limit(1);
    
    if (anyImages && anyImages.length > 0) {
      console.log(`⏭️  Vehicle already has images (not CL), skipping`);
      return { success: false, reason: 'already_has_images' };
    }
    console.log(`📸 No images found, will upload new ones`);
  }

  // Scrape listing to get all high-res image URLs
  const listingUrl = vehicleData.discovery_url || discoveryUrl;
  if (!listingUrl) {
    console.log(`⏭️  No listing URL found`);
    return { success: false, reason: 'no_url' };
  }

  console.log(`🔍 Scraping listing for high-res images...`);
  const { data: scrapeData, error: scrapeError } = await supabase.functions.invoke('scrape-vehicle', {
    body: { url: listingUrl }
  });

  if (scrapeError || !scrapeData?.success) {
    console.log(`❌ Failed to scrape: ${scrapeError?.message || 'Unknown error'}`);
    return { success: false, reason: 'scrape_failed' };
  }

  const imageUrls = scrapeData.data?.images || [];
  if (imageUrls.length === 0) {
    console.log(`⏭️  No images found in listing`);
    return { success: false, reason: 'no_images_in_listing' };
  }

  console.log(`✅ Found ${imageUrls.length} image(s) in listing`);

  // Delete old CL images (direct URLs) if they exist
  if (hasExistingCLImages) {
    console.log(`🗑️  Deleting ${existingImages.length} old CL image record(s)...`);
    for (const img of existingImages) {
      const { error: deleteError } = await supabase
        .from('vehicle_images')
        .delete()
        .eq('id', img.id);

      if (deleteError) {
        console.log(`⚠️  Failed to delete image ${img.id}: ${deleteError.message}`);
      }
    }
  }

  // Download and upload high-res images
  let uploaded = 0;
  let failed = 0;

  for (let i = 0; i < imageUrls.length; i++) {
    try {
      const clUrl = imageUrls[i];
      const highResUrl = upgradeCraigslistImageUrl(clUrl);
      
      console.log(`📥 Downloading image ${i + 1}/${imageUrls.length}...`);
      const imageBuffer = await downloadImage(highResUrl);
      console.log(`   ✅ Downloaded: ${(imageBuffer.length / 1024).toFixed(2)} KB`);

      // Upload to Supabase storage
      const fileName = `cl_${Date.now()}_${i}.jpg`;
      const storagePath = `vehicle-data/${vehicleId}/${fileName}`;

      console.log(`📤 Uploading to storage...`);
      const { error: uploadError } = await supabase.storage
        .from('vehicle-data')
        .upload(storagePath, imageBuffer, {
          contentType: 'image/jpeg',
          upsert: false
        });

      if (uploadError) {
        throw uploadError;
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('vehicle-data')
        .getPublicUrl(storagePath);

      // Insert into vehicle_images
      const { error: insertError } = await supabase
        .from('vehicle_images')
        .insert({
          vehicle_id: vehicleId,
          user_id: vehicleData.uploaded_by,
          image_url: urlData.publicUrl,
          thumbnail_url: urlData.publicUrl, // TODO: Generate variants
          medium_url: urlData.publicUrl,
          large_url: urlData.publicUrl,
          organization_status: 'organized',
          organized_at: new Date().toISOString(),
          is_primary: i === 0,
          source: 'craigslist_scrape',
          source_url: listingUrl,
          taken_at: scrapeData.data?.posted_date || new Date().toISOString()
        });

      if (insertError) {
        throw insertError;
      }

      console.log(`   ✅ Uploaded image ${i + 1}/${imageUrls.length}`);
      uploaded++;

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      console.log(`   ❌ Failed image ${i + 1}: ${error.message}`);
      failed++;
    }
  }

  console.log(`\n✅ Complete: ${uploaded} uploaded, ${failed} failed`);
  return { success: true, uploaded, failed };
}

async function main() {
  const vehicles = [
    { id: '4e01734f-e51d-493f-9013-e4c40e48d0ac', name: '1976 Chevrolet Truck C10', url: 'https://sfbay.craigslist.org/eby/cto/d/suisun-city-1976-chevy-c10-pickup/7892749400.html' },
    { id: '7227bfd4-36a1-4122-9d24-cbcfc7f74362', name: '1990 Chevrolet Camaro RS', url: 'https://sfbay.craigslist.org/eby/cto/d/hayward-1990-chevrolet-camaro-rs-v6/7893436463.html' },
    { id: '69571d27-d590-432f-abf6-f78e2885b401', name: '1989 Chevrolet Truck', url: 'https://sfbay.craigslist.org/nby/cto/d/napa-1989-chevy-c10/7895457552.html' },
    { id: 'cc6a87d7-4fe7-4af2-9852-7d42397a0199', name: '1989 Chevrolet Truck Silverado', url: 'https://sfbay.craigslist.org/sfc/cto/d/san-francisco-1989-chevy-3500-lowered/7897761779.html' },
    { id: '3faa29a9-5f27-46de-83a1-9bce2b7fec6d', name: '1988 GMC Truck Sierra Classic', url: 'https://sfbay.craigslist.org/eby/cto/d/pleasanton-1988-gmc-sierra-classic-3500/7893019656.html' },
    { id: '83e27461-51f7-49ef-b9a6-b43fb3777068', name: '1983 Chevrolet Truck Silverado', url: 'https://sfbay.craigslist.org/scz/cto/d/scotts-valley-chevrolet-silverado-10/7896163654.html' },
    { id: 'e7f4bda0-1dbd-4552-b551-4ccf025ea437', name: '1981 Chevrolet Truck', url: 'https://sfbay.craigslist.org/sby/cto/d/hollister-1981-square-body/7897280605.html' },
    { id: '18377b38-4232-4549-ba36-acce06b7f67e', name: '1970 Plymouth Roadrunner', url: 'https://lasvegas.craigslist.org/cto/d/pahrump-1970-plymouth-roadrunner/7889541022.html' }
  ];

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📸 Fixing Craigslist Images - High-Res Upload');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const results = {
    success: 0,
    failed: 0,
    totalUploaded: 0
  };

  for (const vehicle of vehicles) {
    const result = await processVehicle(vehicle.id, vehicle.name, vehicle.url);
    
    if (result.success) {
      results.success++;
      results.totalUploaded += result.uploaded || 0;
    } else {
      results.failed++;
    }

    // Wait between vehicles
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📊 Final Results:`);
  console.log(`   ✅ Success: ${results.success} vehicles`);
  console.log(`   ❌ Failed: ${results.failed} vehicles`);
  console.log(`   📸 Total Images: ${results.totalUploaded} uploaded`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

main().catch(console.error);


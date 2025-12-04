#!/usr/bin/env node

/**
 * Fix pending scraped vehicles:
 * 1. Parse year/make/model from URL for Unknown entries
 * 2. Download images from origin_metadata
 * 3. Run Tier 1 analysis on images
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
// Use service role key for admin operations
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;


if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('ERROR: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Parse year/make/model from URL
function parseUrlForVehicleInfo(url) {
  if (!url) return null;
  
  // Patterns for different sites
  const patterns = [
    // Hemmings: /listing/1977-chevrolet-c10-730181 or /classifieds/listing/1973-chevrolet-c10-...
    /(\d{4})-([a-z]+)-([a-z0-9-]+?)(?:-\d+|$)/i,
    // BaT: /listing/1972-gmc-jimmy-52/
    /listing\/(\d{4})-([a-z-]+)-([a-z0-9-]+)/i,
    // KSL: already parsed
    // ClassicCars: /1978-chevrolet-blazer-for-sale
    /(\d{4})-([a-z]+)-([a-z0-9-]+)-for-sale/i
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      const [, year, make, model] = match;
      return {
        year: parseInt(year),
        make: make.charAt(0).toUpperCase() + make.slice(1).toLowerCase(),
        model: model.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
      };
    }
  }
  
  return null;
}

// Filter actual vehicle images from garbage (SVGs, icons, maps)
function filterVehicleImages(images) {
  if (!images || !Array.isArray(images)) return [];
  
  return images.filter(url => {
    if (!url || typeof url !== 'string') return false;
    
    // Exclude patterns
    const excludePatterns = [
      /\.svg$/i,
      /facebook/i,
      /twitter/i,
      /pinterest/i,
      /email/i,
      /copylink/i,
      /share/i,
      /google\.com\/maps/i,
      /assets\./i,
      /icon/i,
      /logo/i,
      /camera\.svg/i,
      /hemmings-pay/i,
      /listing-type-banner/i
    ];
    
    for (const pattern of excludePatterns) {
      if (pattern.test(url)) return false;
    }
    
    // Must be an actual image
    return /\.(jpg|jpeg|png|webp)/i.test(url) || /image\./i.test(url) || /thumbor/i.test(url) || /cdn\d+\.carsforsale/i.test(url);
  });
}

async function downloadAndUploadImage(imageUrl, vehicleId, index) {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) return null;
    
    const blob = await response.blob();
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : 'jpg';
    const filename = `fix_${Date.now()}_${index}.${ext}`;
    const storagePath = `${vehicleId}/${filename}`;
    
    // Upload to storage
    const { error: uploadError } = await supabase.storage
      .from('vehicle-images')
      .upload(storagePath, blob, { contentType, upsert: false });
    
    if (uploadError) {
      console.log(`    Upload failed: ${uploadError.message}`);
      return null;
    }
    
    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('vehicle-images')
      .getPublicUrl(storagePath);
    
    return { publicUrl, storagePath };
  } catch (error) {
    console.log(`    Download failed: ${error.message}`);
    return null;
  }
}

async function fixVehicle(vehicle) {
  console.log(`\nFixing: ${vehicle.id}`);
  console.log(`  URL: ${vehicle.discovery_url?.substring(0, 60)}`);
  
  const updates = {};
  
  // 1. Parse year/make/model from URL if missing
  if (vehicle.make === 'Unknown' || !vehicle.year) {
    const parsed = parseUrlForVehicleInfo(vehicle.discovery_url);
    if (parsed) {
      console.log(`  Parsed: ${parsed.year} ${parsed.make} ${parsed.model}`);
      if (!vehicle.year) updates.year = parsed.year;
      if (vehicle.make === 'Unknown') updates.make = parsed.make;
      if (vehicle.model === 'Unknown') updates.model = parsed.model;
    }
  }
  
  // 2. Get images from origin_metadata
  const images = vehicle.origin_metadata?.images;
  const filteredImages = filterVehicleImages(images);
  console.log(`  Images: ${images?.length || 0} total, ${filteredImages.length} actual vehicle photos`);
  
  // 3. Download and upload images (max 10)
  let uploadedCount = 0;
  for (let i = 0; i < Math.min(filteredImages.length, 10); i++) {
    const imageUrl = filteredImages[i];
    console.log(`  Downloading image ${i + 1}...`);
    
    const result = await downloadAndUploadImage(imageUrl, vehicle.id, i);
    if (result) {
      // Create image record
      const { error: dbError } = await supabase
        .from('vehicle_images')
        .insert({
          vehicle_id: vehicle.id,
          user_id: '13450c45-3e8b-4124-9f5b-5c512094ff04', // skylar@nukemannerheim.com
          image_url: result.publicUrl,
          storage_path: result.storagePath,
          source: 'scrape_fix',
          is_primary: i === 0
        });
      
      if (!dbError) {
        uploadedCount++;
      }
    }
    
    // Rate limit
    await new Promise(r => setTimeout(r, 500));
  }
  
  console.log(`  Uploaded: ${uploadedCount} images`);
  
  // 4. Update vehicle if we have changes
  if (Object.keys(updates).length > 0 || uploadedCount > 0) {
    if (uploadedCount > 0) {
      updates.status = 'active'; // Has images now
    }
    updates.updated_at = new Date().toISOString();
    
    const { error } = await supabase
      .from('vehicles')
      .update(updates)
      .eq('id', vehicle.id);
    
    if (error) {
      console.log(`  Update failed: ${error.message}`);
      return false;
    }
    
    console.log(`  Updated: ${JSON.stringify(updates)}`);
    return true;
  }
  
  return false;
}

async function main() {
  console.log('='.repeat(60));
  console.log('FIX PENDING SCRAPED VEHICLES');
  console.log('='.repeat(60));
  
  // Get pending scraped vehicles
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, origin_metadata')
    .eq('status', 'pending')
    .not('discovery_url', 'is', null)
    .limit(50); // Process 50 at a time
  
  if (error) {
    console.error('Failed to fetch vehicles:', error);
    return;
  }
  
  console.log(`Found ${vehicles.length} pending scraped vehicles to fix`);
  
  let fixed = 0;
  let failed = 0;
  
  for (const vehicle of vehicles) {
    const success = await fixVehicle(vehicle);
    if (success) fixed++;
    else failed++;
    
    // Rate limit between vehicles
    await new Promise(r => setTimeout(r, 1000));
  }
  
  console.log('\n' + '='.repeat(60));
  console.log(`Fixed: ${fixed}, Failed: ${failed}`);
}

main().catch(console.error);


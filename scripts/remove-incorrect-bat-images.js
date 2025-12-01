import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Vehicle ID to clean up
const VEHICLE_ID = 'c1b04f00-7abf-4e1c-afd2-43fba17a6a1b';

async function getVehicleInfo() {
  const { data, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin')
    .eq('id', VEHICLE_ID)
    .single();

  if (error) {
    console.error('❌ Error fetching vehicle:', error);
    return null;
  }

  return data;
}

async function getBATImages() {
  const { data, error } = await supabase
    .from('vehicle_images')
    .select('id, image_url, source, created_at')
    .eq('vehicle_id', VEHICLE_ID)
    .or('source.eq.bat_listing,source.eq.bat_scraper')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('❌ Error fetching images:', error);
    return [];
  }

  return data || [];
}

async function deleteImage(imageId, imageUrl) {
  // Extract storage path from URL
  // URL format: https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/vehicles/{vehicleId}/bat/{filename}
  const urlMatch = imageUrl.match(/vehicle-images\/vehicles\/[^/]+\/(.+)$/);
  
  if (urlMatch) {
    const storagePath = `vehicles/${VEHICLE_ID}/${urlMatch[1]}`;
    
    // Delete from storage
    const { error: storageError } = await supabase.storage
      .from('vehicle-images')
      .remove([storagePath]);

    if (storageError) {
      console.warn(`  ⚠️ Storage delete failed: ${storageError.message}`);
    } else {
      console.log(`  ✅ Deleted from storage: ${storagePath}`);
    }
  }

  // Delete database record
  const { error: dbError } = await supabase
    .from('vehicle_images')
    .delete()
    .eq('id', imageId);

  if (dbError) {
    console.error(`  ❌ DB delete failed: ${dbError.message}`);
    return false;
  }

  return true;
}

async function main() {
  console.log('🔍 Finding incorrect BAT images...\n');

  const vehicle = await getVehicleInfo();
  if (!vehicle) {
    console.error('❌ Vehicle not found');
    process.exit(1);
  }

  console.log(`Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  console.log(`VIN: ${vehicle.vin || 'N/A'}\n`);

  const images = await getBATImages();
  console.log(`Found ${images.length} BAT images\n`);

  if (images.length === 0) {
    console.log('No images to process');
    return;
  }

  // Show first few and last few images
  console.log('First 3 images:');
  images.slice(0, 3).forEach((img, i) => {
    console.log(`  ${i + 1}. ${img.image_url}`);
  });

  console.log('\nLast 3 images:');
  images.slice(-3).forEach((img, i) => {
    console.log(`  ${images.length - 2 + i}. ${img.image_url}`);
  });

  console.log('\n⚠️  This script will delete ALL BAT images for this vehicle.');
  console.log('   You should manually review which images are incorrect first.');
  console.log('   To delete specific images, modify the script to filter by image ID.\n');

  // For now, we'll delete images after the first 10 (assuming first 10 are correct)
  // User can modify this logic based on their review
  const imagesToDelete = images.slice(10); // Keep first 10, delete the rest

  if (imagesToDelete.length === 0) {
    console.log('No images to delete (keeping all images)');
    return;
  }

  console.log(`\n🗑️  Will delete ${imagesToDelete.length} images (keeping first 10)...`);
  console.log('   Modify the script if you want to keep a different number.\n');

  let deleted = 0;
  let failed = 0;

  for (const img of imagesToDelete) {
    console.log(`Deleting: ${img.image_url}`);
    const success = await deleteImage(img.id, img.image_url);
    if (success) {
      deleted++;
    } else {
      failed++;
    }
  }

  console.log(`\n✅ Deleted ${deleted} images`);
  if (failed > 0) {
    console.log(`❌ Failed to delete ${failed} images`);
  }
}

main().catch(console.error);


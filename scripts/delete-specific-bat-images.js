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

// Vehicle ID
const VEHICLE_ID = 'c1b04f00-7abf-4e1c-afd2-43fba17a6a1b';

// Array of image IDs to delete - USER MUST PROVIDE THESE
// Example: const IMAGE_IDS_TO_DELETE = ['id1', 'id2', 'id3'];
const IMAGE_IDS_TO_DELETE = [];

if (IMAGE_IDS_TO_DELETE.length === 0) {
  console.error('❌ ERROR: No image IDs provided!');
  console.error('   Edit this script and add the image IDs to IMAGE_IDS_TO_DELETE array');
  console.error('   Use identify-incorrect-bat-images.js to get the list first');
  process.exit(1);
}

async function deleteImage(imageId, imageUrl) {
  // Extract storage path from URL
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
  console.log(`🗑️  Deleting ${IMAGE_IDS_TO_DELETE.length} specific images...\n`);

  let deleted = 0;
  let failed = 0;
  let notFound = 0;

  for (const imageId of IMAGE_IDS_TO_DELETE) {
    // Get image info first
    const { data: image, error: fetchError } = await supabase
      .from('vehicle_images')
      .select('id, image_url')
      .eq('id', imageId)
      .eq('vehicle_id', VEHICLE_ID)
      .single();

    if (fetchError || !image) {
      console.log(`⚠️  Image ${imageId} not found or doesn't belong to this vehicle`);
      notFound++;
      continue;
    }

    console.log(`Deleting: ${image.image_url}`);
    const success = await deleteImage(image.id, image.image_url);
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
  if (notFound > 0) {
    console.log(`⚠️  ${notFound} images not found`);
  }
}

main().catch(console.error);


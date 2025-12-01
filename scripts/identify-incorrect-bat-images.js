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

// Vehicle ID to check
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

async function listAllBATImages() {
  const { data, error } = await supabase
    .from('vehicle_images')
    .select('id, image_url, source, created_at, metadata')
    .eq('vehicle_id', VEHICLE_ID)
    .or('source.eq.bat_listing,source.eq.bat_scraper')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('❌ Error fetching images:', error);
    return [];
  }

  return data || [];
}

async function main() {
  console.log('🔍 Listing all BAT images for manual review...\n');

  const vehicle = await getVehicleInfo();
  if (!vehicle) {
    console.error('❌ Vehicle not found');
    process.exit(1);
  }

  console.log(`Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  console.log(`VIN: ${vehicle.vin || 'N/A'}\n`);

  const images = await listAllBATImages();
  console.log(`Found ${images.length} BAT images\n`);

  if (images.length === 0) {
    console.log('No images found. They may have been deleted.');
    console.log('\n⚠️  To recover, you would need to:');
    console.log('   1. Check Supabase storage backups');
    console.log('   2. Re-scrape the BAT listing');
    console.log('   3. Check if images are still accessible via original URLs\n');
    return;
  }

  // Output JSON for manual review
  console.log('Image list (JSON format for easy review):\n');
  console.log(JSON.stringify(images.map(img => ({
    id: img.id,
    url: img.image_url,
    created_at: img.created_at,
    metadata: img.metadata
  })), null, 2));

  console.log('\n\n📋 Instructions:');
  console.log('   1. Review the images above');
  console.log('   2. Create a list of image IDs that are INCORRECT');
  console.log('   3. Use delete-specific-bat-images.js with those IDs\n');
}

main().catch(console.error);


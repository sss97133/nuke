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

// Vehicle ID to validate
const VEHICLE_ID = 'c1b04f00-7abf-4e1c-afd2-43fba17a6a1b';

async function getVehicleInfo() {
  const { data, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
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
    .select('id, image_url, ai_scan_metadata')
    .eq('vehicle_id', VEHICLE_ID)
    .or('source.eq.bat_listing,source.eq.bat_scraper')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('❌ Error fetching images:', error);
    return [];
  }

  return data || [];
}

async function validateImage(imageId, imageUrl, vehicle) {
  try {
    const { data, error } = await supabase.functions.invoke('validate-bat-image', {
      body: {
        image_id: imageId,
        image_url: imageUrl,
        vehicle_id: VEHICLE_ID,
        expected_vehicle: {
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model
        }
      }
    });

    if (error) {
      console.error(`  ❌ Validation failed: ${error.message}`);
      return null;
    }

    return data?.validation;
  } catch (err) {
    console.error(`  ❌ Validation error: ${err.message}`);
    return null;
  }
}

async function main() {
  console.log('🔍 Validating all BAT images with AI...\n');

  const vehicle = await getVehicleInfo();
  if (!vehicle) {
    console.error('❌ Vehicle not found');
    process.exit(1);
  }

  console.log(`Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}\n`);

  const images = await getBATImages();
  console.log(`Found ${images.length} BAT images to validate\n`);

  if (images.length === 0) {
    console.log('No images to validate');
    return;
  }

  let validated = 0;
  let matches = 0;
  let mismatches = 0;
  let errors = 0;

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    console.log(`[${i + 1}/${images.length}] Validating image ${img.id}...`);

    // Check if already validated (skip if you want to force re-validation)
    const existingValidation = img.ai_scan_metadata?.validation;
    const forceRevalidate = process.env.FORCE_REVALIDATE === 'true';
    
    if (existingValidation && existingValidation.validated_at && !forceRevalidate) {
      console.log(`  ⏭️  Already validated (${existingValidation.matches ? 'MATCH' : 'MISMATCH'})`);
      if (existingValidation.matches) matches++;
      else mismatches++;
      continue;
    }

    const result = await validateImage(img.id, img.image_url, vehicle);
    
    if (result) {
      validated++;
      if (result.matches) {
        matches++;
        console.log(`  ✅ MATCHES (confidence: ${result.confidence}%)`);
      } else {
        mismatches++;
        console.log(`  ❌ MISMATCH: ${result.mismatch_reason || 'Unknown reason'}`);
      }
    } else {
      errors++;
    }

    // Rate limiting - wait 1 second between requests
    if (i < images.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📈 VALIDATION RESULTS:`);
  console.log(`   ✅ Matches: ${matches}`);
  console.log(`   ❌ Mismatches: ${mismatches}`);
  console.log(`   🔄 Newly validated: ${validated}`);
  console.log(`   ⚠️  Errors: ${errors}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  if (mismatches > 0) {
    console.log('⚠️  Mismatched images found. Review them and delete if incorrect.');
    console.log('   Use: node scripts/delete-specific-bat-images.js\n');
  }
}

main().catch(console.error);


// Validate all images for a vehicle to detect mismatches
// Uses the validate-bat-image edge function to check each image

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function validateVehicleImages(vehicleId) {
  console.log(`🔍 Validating images for vehicle: ${vehicleId}\n`);

  // Get vehicle info
  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .select('year, make, model')
    .eq('id', vehicleId)
    .single();

  if (vehicleError || !vehicle) {
    console.error('❌ Vehicle not found:', vehicleError);
    return;
  }

  console.log(`Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}\n`);

  // Get all images for this vehicle
  const { data: images, error: imagesError } = await supabase
    .from('vehicle_images')
    .select('id, image_url, ai_scan_metadata')
    .eq('vehicle_id', vehicleId)
    .order('taken_at', { ascending: false });

  if (imagesError) {
    console.error('❌ Error fetching images:', imagesError);
    return;
  }

  console.log(`Found ${images.length} images to validate\n`);

  let validated = 0;
  let matches = 0;
  let mismatches = 0;
  let errors = 0;
  let skipped = 0;

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    console.log(`[${i + 1}/${images.length}] Validating image ${img.id.substring(0, 8)}...`);

    // Check if already validated
    const existingValidation = img.ai_scan_metadata?.validation;
    if (existingValidation && existingValidation.validated_at) {
      console.log(`  ⏭️  Already validated (${existingValidation.matches_vehicle ? 'MATCH' : 'MISMATCH'})`);
      skipped++;
      if (existingValidation.matches_vehicle) matches++;
      else mismatches++;
      continue;
    }

    try {
      // Call validate-bat-image function
      const { data, error } = await supabase.functions.invoke('validate-bat-image', {
        body: {
          image_id: img.id,
          image_url: img.image_url,
          vehicle_id: vehicleId,
          expected_vehicle: {
            year: vehicle.year,
            make: vehicle.make,
            model: vehicle.model
          }
        }
      });

      if (error) {
        console.error(`  ❌ Error: ${error.message}`);
        errors++;
        continue;
      }

      validated++;
      if (data.matches) {
        matches++;
        console.log(`  ✅ MATCHES (confidence: ${data.confidence}%)`);
      } else {
        mismatches++;
        console.log(`  ❌ MISMATCH: ${data.mismatch_reason || 'Unknown reason'}`);
        if (data.detected) {
          console.log(`     Detected: ${data.detected.year} ${data.detected.make} ${data.detected.model}`);
        }
      }

      // Rate limiting - wait 1 second between requests
      if (i < images.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (err) {
      console.error(`  ❌ Error: ${err.message}`);
      errors++;
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📈 VALIDATION RESULTS:`);
  console.log(`   ✅ Matches: ${matches}`);
  console.log(`   ❌ Mismatches: ${mismatches}`);
  console.log(`   ⏭️  Skipped (already validated): ${skipped}`);
  console.log(`   🔄 Newly validated: ${validated}`);
  console.log(`   ❌ Errors: ${errors}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  // Check for detected mismatches
  const { data: mismatchesData } = await supabase
    .from('active_image_mismatches')
    .select('*')
    .eq('current_vehicle_id', vehicleId);

  if (mismatchesData && mismatchesData.length > 0) {
    console.log(`🚨 DETECTED MISMATCHES:\n`);
    mismatchesData.forEach(m => {
      console.log(`  Image: ${m.image_id.substring(0, 8)}`);
      console.log(`  Current: ${m.current_vehicle}`);
      console.log(`  Detected: ${m.detected_year} ${m.detected_make} ${m.detected_model}`);
      if (m.suggested_vehicle) {
        console.log(`  Suggested: ${m.suggested_vehicle}`);
      }
      console.log(`  Reason: ${m.mismatch_reason}\n`);
    });
  }
}

// Get vehicle ID from command line
const vehicleId = process.argv[2];

if (!vehicleId) {
  console.error('Usage: node validate-vehicle-images.js <vehicle_id>');
  console.error('Example: node validate-vehicle-images.js eea40748-cdc1-4ae9-ade1-4431d14a7726');
  process.exit(1);
}

validateVehicleImages(vehicleId).catch(console.error);


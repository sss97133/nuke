// Batch validate images with progress tracking and resume capability
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function validateBatch(vehicleId, batchSize = 20, startFrom = 0) {
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

  // Get unvalidated images
  const { data: images, error: imagesError } = await supabase
    .from('vehicle_images')
    .select('id, image_url, ai_scan_metadata')
    .eq('vehicle_id', vehicleId)
    .or('ai_scan_metadata->validation.is.null,ai_scan_metadata.is.null')
    .order('taken_at', { ascending: false })
    .range(startFrom, startFrom + batchSize - 1);

  if (imagesError) {
    console.error('❌ Error fetching images:', imagesError);
    return;
  }

  if (!images || images.length === 0) {
    console.log('✅ No more images to validate');
    return;
  }

  console.log(`Validating batch: ${startFrom + 1} to ${startFrom + images.length}\n`);

  let matches = 0;
  let mismatches = 0;
  let errors = 0;

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const imageNum = startFrom + i + 1;
    process.stdout.write(`[${imageNum}] ${img.id.substring(0, 8)}... `);

    try {
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
        console.log(`❌ Error: ${error.message}`);
        errors++;
      } else if (data.matches) {
        console.log(`✅ MATCH (${data.confidence}%)`);
        matches++;
      } else {
        console.log(`❌ MISMATCH: ${data.detected?.year} ${data.detected?.make} ${data.detected?.model}`);
        mismatches++;
      }

      // Rate limiting
      if (i < images.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (err) {
      console.log(`❌ Error: ${err.message}`);
      errors++;
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Batch Results: ✅ ${matches} | ❌ ${mismatches} | ⚠️  ${errors}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  // Check total mismatches
  const { data: mismatchCount } = await supabase
    .from('image_vehicle_mismatches')
    .select('id', { count: 'exact', head: true })
    .eq('current_vehicle_id', vehicleId)
    .eq('resolved', false);

  if (mismatchCount > 0) {
    console.log(`🚨 Total mismatches detected: ${mismatchCount}\n`);
    
    // Show recent mismatches
    const { data: recentMismatches } = await supabase
      .from('active_image_mismatches')
      .select('*')
      .eq('current_vehicle_id', vehicleId)
      .order('detected_at', { ascending: false })
      .limit(5);

    if (recentMismatches && recentMismatches.length > 0) {
      console.log('Recent mismatches:');
      recentMismatches.forEach(m => {
        console.log(`  - Detected: ${m.detected_year} ${m.detected_make} ${m.detected_model}`);
        if (m.suggested_vehicle) {
          console.log(`    Suggested: ${m.suggested_vehicle}`);
        }
      });
      console.log('');
    }
  }

  return { matches, mismatches, errors, hasMore: images.length === batchSize };
}

// Get args
const vehicleId = process.argv[2];
const batchSize = parseInt(process.argv[3]) || 20;
const startFrom = parseInt(process.argv[4]) || 0;

if (!vehicleId) {
  console.error('Usage: node validate-vehicle-images-batch.js <vehicle_id> [batch_size] [start_from]');
  console.error('Example: node validate-vehicle-images-batch.js eea40748-cdc1-4ae9-ade1-4431d14a7726 20 0');
  process.exit(1);
}

validateBatch(vehicleId, batchSize, startFrom).catch(console.error);


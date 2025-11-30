import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, serviceRoleKey);

const CLASSICCARS_URL = 'https://classiccars.com/listings/view/1985175/1977-chevrolet-blazer-for-sale-in-sedona-arizona-86325';
const VEHICLE_ID = '1fe31397-4f41-490f-87a2-b8dc44cb7c09';

async function fullImport() {
  console.log('🚀 Full Import: All Images + AI Analysis + VIN Extraction\n');
  console.log(`URL: ${CLASSICCARS_URL}\n`);

  // Get user
  const { data: users } = await supabase.auth.admin.listUsers();
  const userId = users?.users[0]?.id;

  console.log('📥 Calling import-classiccars-listing function...\n');
  const { data: result, error } = await supabase.functions.invoke('import-classiccars-listing', {
    body: {
      url: CLASSICCARS_URL,
      userId: userId
    }
  });

  if (error) {
    console.error('❌ Import error:', error.message);
    return;
  }

  if (!result?.success) {
    console.error('❌ Import failed:', result?.error);
    return;
  }

  console.log('✅ Import Complete!\n');
  console.log('Results:');
  console.log(`  Vehicle ID: ${result.vehicleId}`);
  console.log(`  Images Processed: ${result.imagesProcessed}`);
  console.log(`  Condition Score: ${result.conditionScore}/10`);
  if (result.vinExtracted) {
    console.log(`  VIN Extracted: ${result.vinExtracted} (confidence: ${result.vinConfidence}%)`);
  }
  console.log('');

  // Wait for processing
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Fetch final vehicle data
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', result.vehicleId)
    .single();

  const { data: images } = await supabase
    .from('vehicle_images')
    .select('*')
    .eq('vehicle_id', result.vehicleId)
    .order('created_at', { ascending: true });

  console.log('═══════════════════════════════════════════════════════════');
  console.log('📊 COMPLETE VEHICLE PROFILE WITH AI ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  console.log('IDENTIFICATION:');
  console.log(`  Year: ${vehicle.year}`);
  console.log(`  Make: ${vehicle.make}`);
  console.log(`  Model: ${vehicle.model}`);
  if (vehicle.series) console.log(`  Series: ${vehicle.series}`);
  if (vehicle.vin) console.log(`  VIN: ${vehicle.vin} ${result.vinExtracted ? '(extracted from images)' : ''}`);
  console.log('');
  
  console.log('SPECIFICATIONS:');
  if (vehicle.color) console.log(`  Color: ${vehicle.color}`);
  if (vehicle.mileage) console.log(`  Mileage: ${vehicle.mileage.toLocaleString()}`);
  if (vehicle.transmission) console.log(`  Transmission: ${vehicle.transmission}`);
  if (vehicle.drivetrain) console.log(`  Drivetrain: ${vehicle.drivetrain}`);
  if (vehicle.engine_size) console.log(`  Engine: ${vehicle.engine_size}`);
  if (vehicle.condition_rating) console.log(`  Condition: ${vehicle.condition_rating}/10`);
  console.log('');
  
  console.log(`IMAGES: ${images?.length || 0} total`);
  if (images && images.length > 0) {
    console.log('  All images imported and analyzed');
    if (result.vinExtracted) {
      console.log(`  VIN tag found and extracted: ${result.vinExtracted}`);
    }
  }
  console.log('');
  
  console.log(`🔗 Profile: https://n-zero.dev/vehicle/${result.vehicleId}`);
  console.log('═══════════════════════════════════════════════════════════\n');
}

fullImport().catch(console.error);


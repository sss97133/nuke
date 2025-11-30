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

// First, let's test the scraping and normalization
const CLASSICCARS_URL = 'https://classiccars.com/listings/view/1985175/1977-chevrolet-blazer-for-sale-in-sedona-arizona-86325';

async function quickImport() {
  console.log('🔍 Step 1: Testing scrape and normalization...\n');
  
  // Test scrape first
  const { data: scrapeData, error: scrapeError } = await supabase.functions.invoke('scrape-vehicle', {
    body: { url: CLASSICCARS_URL }
  });

  if (scrapeError || !scrapeData?.data) {
    console.error('❌ Scrape failed:', scrapeError?.message || 'Unknown error');
    return;
  }

  const rawData = scrapeData.data;
  console.log('📥 Raw scraped data:');
  console.log(`  Make: "${rawData.make}"`);
  console.log(`  Model: "${rawData.model}"`);
  console.log(`  Transmission: "${rawData.transmission}"`);
  console.log(`  Drivetrain: "${rawData.drivetrain?.substring(0, 50)}..."`);
  console.log('');

  // Now import with normalization
  console.log('🚀 Step 2: Importing with normalization...\n');
  
  const { data: users } = await supabase.auth.admin.listUsers();
  const userId = users?.users[0]?.id;
  
  if (!userId) {
    console.error('❌ No user found');
    return;
  }

  const { data: result, error: importError } = await supabase.functions.invoke('import-classiccars-listing', {
    body: {
      url: CLASSICCARS_URL,
      userId: userId
    }
  });

  if (importError) {
    console.error('❌ Import error:', importError.message);
    return;
  }

  if (!result?.success) {
    console.error('❌ Import failed:', result?.error);
    return;
  }

  console.log('✅ Import complete! Vehicle ID:', result.vehicleId);
  console.log('');

  // Wait and fetch normalized profile
  await new Promise(resolve => setTimeout(resolve, 3000));

  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', result.vehicleId)
    .single();

  if (vehicle) {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📊 NORMALIZED PROFILE');
    console.log('═══════════════════════════════════════════════════════════\n');
    
    console.log('BEFORE → AFTER (Normalization):');
    if (vehicle.origin_metadata?.original_data) {
      const orig = vehicle.origin_metadata.original_data;
      console.log(`  Make: "${orig.original_make}" → "${vehicle.make}"`);
      console.log(`  Model: "${orig.original_model}" → "${vehicle.model}"`);
      if (orig.original_transmission) {
        console.log(`  Transmission: "${orig.original_transmission}" → "${vehicle.transmission}"`);
      }
      if (orig.original_drivetrain) {
        console.log(`  Drivetrain: "${orig.original_drivetrain.substring(0, 40)}..." → "${vehicle.drivetrain}"`);
      }
    }
    console.log('');
    
    console.log('NORMALIZED DATA:');
    console.log(`  Year: ${vehicle.year}`);
    console.log(`  Make: ${vehicle.make}`);
    console.log(`  Model: ${vehicle.model}`);
    if (vehicle.series) console.log(`  Series: ${vehicle.series}`);
    if (vehicle.trim) console.log(`  Trim: ${vehicle.trim}`);
    if (vehicle.color) console.log(`  Color: ${vehicle.color}`);
    if (vehicle.mileage) console.log(`  Mileage: ${vehicle.mileage.toLocaleString()}`);
    if (vehicle.transmission) console.log(`  Transmission: ${vehicle.transmission}`);
    if (vehicle.drivetrain) console.log(`  Drivetrain: ${vehicle.drivetrain}`);
    if (vehicle.engine_size) console.log(`  Engine: ${vehicle.engine_size}`);
    if (vehicle.condition_rating) console.log(`  Condition: ${vehicle.condition_rating}/10`);
    console.log('');
    
    console.log(`🔗 Profile: https://n-zero.dev/vehicles/${result.vehicleId}`);
  }
}

quickImport().catch(console.error);


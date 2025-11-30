/**
 * Import the 1977 Chevrolet Blazer from ClassicCars.com
 * Then open the vehicle profile
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing Supabase credentials');
  console.error('Need: SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

const CLASSICCARS_URL = 'https://classiccars.com/listings/view/1985175/1977-chevrolet-blazer-for-sale-in-sedona-arizona-86325';

async function importListing() {
  console.log('🚀 Importing ClassicCars.com listing...\n');
  console.log(`URL: ${CLASSICCARS_URL}\n`);

  try {
    // Get a user ID (use the first user or a test user)
    const { data: users, error: userError } = await supabase
      .from('profiles')
      .select('id')
      .limit(1)
      .single();

    if (userError || !users) {
      // Try to get from auth.users
      const { data: authUsers } = await supabase.auth.admin.listUsers();
      if (!authUsers || authUsers.users.length === 0) {
        throw new Error('No users found. Please create a user first.');
      }
      var userId = authUsers.users[0].id;
    } else {
      var userId = users.id;
    }

    console.log(`Using user ID: ${userId}\n`);

    // Call the import edge function
    console.log('📥 Calling import-classiccars-listing function...');
    const { data, error } = await supabase.functions.invoke('import-classiccars-listing', {
      body: {
        url: CLASSICCARS_URL,
        userId: userId
      }
    });

    if (error) {
      throw error;
    }

    if (!data?.success) {
      throw new Error(data?.error || 'Import failed');
    }

    console.log('\n✅ Import Successful!\n');
    console.log('Results:');
    console.log(`  Vehicle ID: ${data.vehicleId}`);
    console.log(`  Vehicle: ${data.vehicle.year} ${data.vehicle.make} ${data.vehicle.model}`);
    console.log(`  Images Processed: ${data.imagesProcessed}`);
    console.log(`  Condition Score: ${data.conditionScore}/10\n`);

    // Fetch the full vehicle profile
    console.log('📋 Fetching vehicle profile...');
    const { data: vehicle, error: vehicleError } = await supabase
      .from('vehicles')
      .select('*')
      .eq('id', data.vehicleId)
      .single();

    if (vehicleError) {
      console.warn('⚠️  Could not fetch full vehicle data:', vehicleError.message);
    } else {
      console.log('\n📊 Vehicle Profile:');
      console.log(JSON.stringify(vehicle, null, 2));
    }

    // Get images
    const { data: images, error: imagesError } = await supabase
      .from('vehicle_images')
      .select('*')
      .eq('vehicle_id', data.vehicleId)
      .order('created_at', { ascending: true });

    if (!imagesError && images) {
      console.log(`\n🖼️  Images (${images.length}):`);
      images.forEach((img, i) => {
        console.log(`  ${i + 1}. ${img.image_url}`);
        if (img.metadata?.ai_analysis) {
          console.log(`     Condition: ${img.metadata.ai_analysis.condition_score}/10`);
        }
      });
    }

    console.log(`\n🔗 View vehicle profile: https://n-zero.dev/vehicles/${data.vehicleId}`);
    console.log(`\n✅ Done!`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.response) {
      console.error('Response:', error.response);
    }
    process.exit(1);
  }
}

importListing();


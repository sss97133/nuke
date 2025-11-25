import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const vehicleIds = [
  '21b489eb-6449-4096-a74a-fb9b5df33772',
  '24f38dc3-b970-45b5-8063-27dd7a59445f',
  '483f6a7c-8beb-45fd-afd1-9d8e3313bec6',
  '62fe83e8-e789-4275-81b5-f2fe53f0103f'
];

async function markVehiclesPendingIfNoImages() {
  console.log('Checking vehicles for images...\n');

  for (const vehicleId of vehicleIds) {
    // Get vehicle info
    const { data: vehicle, error: vehicleError } = await supabase
      .from('vehicles')
      .select('id, year, make, model, status')
      .eq('id', vehicleId)
      .single();

    if (vehicleError) {
      console.error(`Error fetching vehicle ${vehicleId}:`, vehicleError);
      continue;
    }

    if (!vehicle) {
      console.log(`Vehicle ${vehicleId} not found`);
      continue;
    }

    // Count images
    const { count: imageCount, error: imageError } = await supabase
      .from('vehicle_images')
      .select('id', { count: 'exact', head: true })
      .eq('vehicle_id', vehicleId);

    if (imageError) {
      console.error(`Error counting images for ${vehicleId}:`, imageError);
      continue;
    }

    const hasImages = (imageCount || 0) > 0;
    const currentStatus = vehicle.status || 'active';

    console.log(`${vehicle.year} ${vehicle.make} ${vehicle.model} (${vehicleId})`);
    console.log(`  Current status: ${currentStatus}`);
    console.log(`  Image count: ${imageCount || 0}`);

    if (!hasImages) {
      if (currentStatus !== 'pending') {
        // Update to pending
        const { error: updateError } = await supabase
          .from('vehicles')
          .update({ status: 'pending' })
          .eq('id', vehicleId);

        if (updateError) {
          console.error(`  ❌ Failed to update status:`, updateError);
        } else {
          console.log(`  ✅ Updated status to 'pending'`);
        }
      } else {
        console.log(`  ℹ️  Already set to 'pending'`);
      }
    } else {
      console.log(`  ℹ️  Has images, keeping current status`);
    }
    console.log('');
  }

  console.log('Done!');
}

markVehiclesPendingIfNoImages().catch(console.error);


import { createClient } from '@supabase/supabase-js';

// Use the remote Supabase instance
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;


if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('ERROR: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const vehicleIds = [
  '89afcc13-febb-4a79-a4ad-533471c2062f',
  '0f440baa-869d-4f54-9abc-6564ac6a27b0',
  'bcb718d6-0d2c-44c6-ad8d-859b72fdd603',
  'c3dbcb65-f86d-4e66-829a-ed293e5d3b63'
];

async function deleteVehicles() {
  try {
    console.log(`Deleting ${vehicleIds.length} vehicles...\n`);
    
    for (const vehicleId of vehicleIds) {
      // First check if vehicle exists
      const { data: existingVehicle, error: checkError } = await supabase
        .from('vehicles')
        .select('id, make, model, year')
        .eq('id', vehicleId)
        .single();
      
      if (checkError) {
        console.log(`❌ Vehicle ${vehicleId}: Not found or error - ${checkError.message}`);
        continue;
      }
      
      console.log(`Found vehicle: ${existingVehicle.year || 'N/A'} ${existingVehicle.make || 'N/A'} ${existingVehicle.model || 'N/A'} (${vehicleId})`);
      
      // Delete the vehicle
      const { error } = await supabase
        .from('vehicles')
        .delete()
        .eq('id', vehicleId);
      
      if (error) {
        console.error(`❌ Error deleting vehicle ${vehicleId}:`, error.message);
      } else {
        console.log(`✅ Vehicle ${vehicleId} deleted successfully\n`);
      }
    }
    
    console.log('Deletion process complete.');
  } catch (err) {
    console.error('Exception:', err);
  }
}

deleteVehicles();


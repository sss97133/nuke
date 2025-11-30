import { createClient } from '@supabase/supabase-js';

// Use the remote Supabase instance
const supabase = createClient(
  'https://qkgaybvrernstplzjaam.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk'
);

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


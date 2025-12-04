require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Use the remote Supabase instance
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;


if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('ERROR: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function deleteVehicle() {
  try {
    console.log('Deleting vehicle f9a51928-3624-44fb-90c1-f4a70f8eaad6...');
    
    // First check if vehicle exists
    const { data: existingVehicle, error: checkError } = await supabase
      .from('vehicles')
      .select('id, make, model, year')
      .eq('id', 'f9a51928-3624-44fb-90c1-f4a70f8eaad6')
      .single();
    
    if (checkError) {
      console.log('Vehicle not found or error checking:', checkError.message);
      return;
    }
    
    console.log('Found vehicle:', existingVehicle);
    
    // Delete the vehicle
    const { data, error } = await supabase
      .from('vehicles')
      .delete()
      .eq('id', 'f9a51928-3624-44fb-90c1-f4a70f8eaad6');
    
    if (error) {
      console.error('Error deleting vehicle:', error);
    } else {
      console.log('Vehicle deleted successfully');
    }
  } catch (err) {
    console.error('Exception:', err);
  }
}

deleteVehicle();

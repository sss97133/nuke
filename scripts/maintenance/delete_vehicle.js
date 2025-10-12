const { createClient } = require('@supabase/supabase-js');

// Use the remote Supabase instance
const supabase = createClient(
  'https://qkgaybvrernstplzjaam.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzU2ODQ4MDAsImV4cCI6MjA1MTI2MDgwMH0.aBKzuFGaB_uEcaWJhEWVJjKhPKhGFKFKFKFKFKFKFKF'
);

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

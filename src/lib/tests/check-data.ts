import { supabase } from '../supabase';

export const checkUserData = async () => {
  try {
    // First, sign in with the test user
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: 'skylar@nukemannerheim.com',
      password: '1bigCowboy'
    });

    if (authError) {
      console.error('Authentication failed:', authError);
      return;
    }

    console.log('Successfully authenticated as:', authData.user?.email);

    // Check vehicles for this user
    const { data: vehicles, error: vehiclesError } = await supabase
      .from('vehicles')
      .select('*')
      .eq('user_id', authData.user?.id);

    if (vehiclesError) {
      console.error('Error fetching vehicles:', vehiclesError);
      return;
    }

    console.log('\nVehicles found:', vehicles?.length || 0);
    vehicles?.forEach(vehicle => {
      console.log('\nVehicle:', {
        id: vehicle.id,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
        vin: vehicle.vin,
        images: vehicle.images?.length || 0
      });
    });

    // Check storage for images
    const { data: storageData, error: storageError } = await supabase
      .storage
      .from('vehicle-images')
      .list();

    if (storageError) {
      console.error('Error checking storage:', storageError);
      return;
    }

    console.log('\nStorage bucket contents:', storageData?.length || 0);
    storageData?.forEach(file => {
      console.log('File:', file.name);
    });

  } catch (error) {
    console.error('Error during data check:', error);
  }
}; 
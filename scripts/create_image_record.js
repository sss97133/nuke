require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function createImageRecord() {
  // First, authenticate to get proper access
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: 'skylar@gmail.com',
    password: 'password123'
  });
  
  if (authError) {
    console.error('Auth error:', authError);
    return;
  }
  
  console.log('Authenticated as:', authData.user.email);
  
  // Create the vehicle_images record
  const imageRecord = {
    id: '53a092f0-57b8-4147-acf3-6337c6c02f1a',
    vehicle_id: '7b07531f-e73a-4adb-b52c-d45922063edf',
    image_url: 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/7b07531f-e73a-4adb-b52c-d45922063edf/53a092f0-57b8-4147-acf3-6337c6c02f1a.jpeg',
    storage_path: 'vehicle-images/7b07531f-e73a-4adb-b52c-d45922063edf/53a092f0-57b8-4147-acf3-6337c6c02f1a.jpeg',
    user_id: authData.user.id,
    is_primary: true,
    category: 'general',
    position: 0
  };
  
  console.log('Creating image record:', imageRecord);
  
  const { data, error } = await supabase
    .from('vehicle_images')
    .insert(imageRecord)
    .select();
  
  if (error) {
    console.error('Error creating image record:', error);
  } else {
    console.log('Successfully created image record:', data);
  }
  
  // Verify it was created
  const { data: verify, error: verifyError } = await supabase
    .from('vehicle_images')
    .select('*')
    .eq('vehicle_id', '7b07531f-e73a-4adb-b52c-d45922063edf');
  
  if (verify) {
    console.log('\nVerification - Images for this vehicle:', verify);
  }
}

createImageRecord().catch(console.error);

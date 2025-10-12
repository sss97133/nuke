const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';

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

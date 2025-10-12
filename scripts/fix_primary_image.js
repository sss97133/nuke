const { createClient } = require('@supabase/supabase-js');

// Using environment variables
const supabaseUrl = 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false
  }
});

async function fixPrimaryImage() {
  console.log('Fixing primary image for vehicle...');
  
  // First, check if there are any images for this vehicle
  const { data: images, error: fetchError } = await supabase
    .from('vehicle_images')
    .select('*')
    .eq('vehicle_id', '7b07531f-e73a-4adb-b52c-d45922063edf');
  
  if (fetchError) {
    console.error('Error fetching images:', fetchError);
    return;
  }
  
  console.log(`Found ${images?.length || 0} images for vehicle`);
  
  if (images && images.length > 0) {
    // Check if any image is already primary
    const hasPrimary = images.some(img => img.is_primary === true);
    
    if (!hasPrimary) {
      // Set the first image as primary
      const firstImage = images[0];
      console.log('Setting image as primary:', firstImage.id);
      
      const { data: updated, error: updateError } = await supabase
        .from('vehicle_images')
        .update({ is_primary: true })
        .eq('id', firstImage.id)
        .select();
      
      if (updateError) {
        console.error('Error updating image:', updateError);
      } else {
        console.log('Successfully set image as primary!');
        console.log('Updated record:', updated);
      }
    } else {
      console.log('Vehicle already has a primary image');
      const primaryImage = images.find(img => img.is_primary === true);
      console.log('Primary image ID:', primaryImage?.id);
    }
  } else {
    console.log('No images found for this vehicle');
    
    // Let's check if the image exists with the known ID
    const { data: specificImage, error: specificError } = await supabase
      .from('vehicle_images')
      .select('*')
      .eq('id', '53a092f0-57b8-4147-acf3-6337c6c02f1a')
      .single();
    
    if (specificImage) {
      console.log('Found image by ID:', specificImage);
      console.log('Vehicle ID in image record:', specificImage.vehicle_id);
    } else {
      console.log('Could not find image with ID 53a092f0-57b8-4147-acf3-6337c6c02f1a');
      if (specificError) console.error('Error:', specificError);
    }
  }
}

fixPrimaryImage().catch(console.error);

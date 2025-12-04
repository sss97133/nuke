require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;


if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('ERROR: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function findLaSalleImages() {
  console.log('Finding La Salle images...\n');
  
  // 1. Check if images are in Storage bucket
  const { data: storageFiles, error: storageError } = await supabase.storage
    .from('vehicle-data')
    .list('vehicles/c440a0bc-b701-4b13-9084-b93eb7c42e9f');
  
  if (!storageError && storageFiles && storageFiles.length > 0) {
    console.log(`Found ${storageFiles.length} files in Storage bucket`);
    
    // Get public URLs for the images
    const imageUrls = storageFiles.map(file => {
      const { data } = supabase.storage
        .from('vehicle-data')
        .getPublicUrl(`vehicles/c440a0bc-b701-4b13-9084-b93eb7c42e9f/${file.name}`);
      return data.publicUrl;
    });
    
    console.log('\nImage URLs from Storage:');
    imageUrls.forEach(url => console.log('- ', url));
    
    // Now migrate these to vehicle_images table
    console.log('\nMigrating to vehicle_images table...');
    
    for (let i = 0; i < imageUrls.length; i++) {
      const { error } = await supabase
        .from('vehicle_images')
        .insert({
          vehicle_id: 'c440a0bc-b701-4b13-9084-b93eb7c42e9f',
          image_url: imageUrls[i],
          file_name: storageFiles[i].name,
          is_primary: i === 0, // Set first image as primary
          user_id: '0b9f107a-d124-49de-9ded-94698f63c1c4'
        });
      
      if (error) {
        console.log('Error inserting image:', error);
      } else {
        console.log(`✓ Migrated ${storageFiles[i].name}`);
      }
    }
    
    console.log('\nMigration complete!');
  } else {
    console.log('No files found in Storage bucket');
    console.log('Storage error:', storageError);
  }
}

findLaSalleImages();

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://qkgaybvrernstplzjaam.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk'
);

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

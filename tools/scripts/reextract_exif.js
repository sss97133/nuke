const { createClient } = require('@supabase/supabase-js');
const ExifReader = require('exifreader');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

async function extractExifFromImage(imageUrl) {
  try {
    const response = await fetch(imageUrl);
    const buffer = await response.arrayBuffer();
    const tags = ExifReader.load(buffer);
    
    // Extract the dates in the correct format
    const exifData = {
      dateTimeOriginal: tags.DateTimeOriginal?.description || null,
      dateTime: tags.DateTime?.description || null,
      dateTimeDigitized: tags.DateTimeDigitized?.description || null,
      make: tags.Make?.description || null,
      model: tags.Model?.description || null,
    };
    
    // Add GPS if available
    if (tags.GPSLatitude && tags.GPSLongitude) {
      exifData.gps = {
        latitude: tags.GPSLatitude.description,
        longitude: tags.GPSLongitude.description,
        latitudeRef: tags.GPSLatitudeRef?.description || null,
        longitudeRef: tags.GPSLongitudeRef?.description || null,
      };
    }
    
    return exifData;
  } catch (error) {
    console.error('Error extracting EXIF:', error.message);
    return null;
  }
}

async function updateVehicleImagesExif(vehicleId) {
  console.log(`Processing vehicle: ${vehicleId}`);
  
  // Get all images for this vehicle
  const { data: images, error } = await supabase
    .from('vehicle_images')
    .select('id, image_url, exif_data')
    .eq('vehicle_id', vehicleId);
  
  if (error) {
    console.error('Error fetching images:', error);
    return;
  }
  
  console.log(`Found ${images.length} images to process`);
  
  let updated = 0;
  let failed = 0;
  
  for (const image of images) {
    try {
      // Re-extract EXIF data
      const newExifData = await extractExifFromImage(image.image_url);
      
      if (newExifData) {
        // Update the database
        const { error: updateError } = await supabase
          .from('vehicle_images')
          .update({ exif_data: newExifData })
          .eq('id', image.id);
        
        if (updateError) {
          console.error(`Failed to update image ${image.id}:`, updateError);
          failed++;
        } else {
          console.log(`Updated image ${image.id} - Date: ${newExifData.dateTimeOriginal || 'No date'}`);
          updated++;
        }
      } else {
        console.log(`No EXIF data found for image ${image.id}`);
        failed++;
      }
      
      // Rate limit to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`Error processing image ${image.id}:`, error);
      failed++;
    }
  }
  
  console.log(`\nCompleted: ${updated} updated, ${failed} failed`);
}

// Process specific vehicle
const vehicleId = process.argv[2] || '21ee373f-765e-4e24-a69d-e59e2af4f467';
updateVehicleImagesExif(vehicleId);

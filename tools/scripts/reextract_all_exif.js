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

async function updateAllVehicleImages() {
  // Get all vehicles with images
  const { data: vehicles, error: vError } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .order('year', { ascending: false });
  
  if (vError) {
    console.error('Error fetching vehicles:', vError);
    return;
  }
  
  console.log(`Found ${vehicles.length} vehicles to process\n`);
  
  let totalImages = 0;
  let totalUpdated = 0;
  let totalFailed = 0;
  
  for (const vehicle of vehicles) {
    console.log(`\nProcessing: ${vehicle.year} ${vehicle.make} ${vehicle.model} (${vehicle.id})`);
    
    // Get all images for this vehicle
    const { data: images, error } = await supabase
      .from('vehicle_images')
      .select('id, image_url, exif_data')
      .eq('vehicle_id', vehicle.id);
    
    if (error) {
      console.error('Error fetching images:', error);
      continue;
    }
    
    if (images.length === 0) {
      console.log('  No images found');
      continue;
    }
    
    console.log(`  Found ${images.length} images`);
    totalImages += images.length;
    
    let vehicleUpdated = 0;
    let vehicleFailed = 0;
    
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
            console.error(`  Failed to update image ${image.id}:`, updateError.message);
            vehicleFailed++;
          } else {
            // Only log every 10th update to reduce noise
            if (vehicleUpdated % 10 === 0) {
              console.log(`  Updated ${vehicleUpdated + 1}/${images.length} - Latest: ${newExifData.dateTimeOriginal || 'No date'}`);
            }
            vehicleUpdated++;
          }
        } else {
          vehicleFailed++;
        }
        
        // Rate limit to avoid overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (error) {
        console.error(`  Error processing image:`, error.message);
        vehicleFailed++;
      }
    }
    
    console.log(`  Vehicle complete: ${vehicleUpdated} updated, ${vehicleFailed} failed`);
    totalUpdated += vehicleUpdated;
    totalFailed += vehicleFailed;
  }
  
  console.log('\n========================================');
  console.log(`TOTAL: ${totalImages} images processed`);
  console.log(`SUCCESS: ${totalUpdated} images updated`);
  console.log(`FAILED: ${totalFailed} images failed`);
  console.log('========================================');
}

// Process all vehicles
updateAllVehicleImages();

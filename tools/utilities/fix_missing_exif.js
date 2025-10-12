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
    
    // Extract ALL possible date fields
    const exifData = {};
    
    // Primary date fields
    if (tags.DateTimeOriginal) exifData.dateTimeOriginal = tags.DateTimeOriginal.description;
    if (tags.DateTime) exifData.dateTime = tags.DateTime.description;
    if (tags.DateTimeDigitized) exifData.dateTimeDigitized = tags.DateTimeDigitized.description;
    
    // GPS date/time
    if (tags.GPSDateStamp) exifData.gpsDateStamp = tags.GPSDateStamp.description;
    if (tags.GPSTimeStamp) exifData.gpsTimeStamp = tags.GPSTimeStamp.description;
    
    // Other metadata
    if (tags.Make) exifData.make = tags.Make.description;
    if (tags.Model) exifData.model = tags.Model.description;
    if (tags.Software) exifData.software = tags.Software.description;
    
    // GPS coordinates
    if (tags.GPSLatitude && tags.GPSLongitude) {
      exifData.gps = {
        latitude: tags.GPSLatitude.description,
        longitude: tags.GPSLongitude.description,
        latitudeRef: tags.GPSLatitudeRef?.description || null,
        longitudeRef: tags.GPSLongitudeRef?.description || null,
      };
    }
    
    return Object.keys(exifData).length > 0 ? exifData : null;
  } catch (error) {
    console.error('Error extracting EXIF:', error.message);
    return null;
  }
}

async function findAndFixProblematicImages() {
  console.log('Finding images with missing or incorrect EXIF dates...\n');
  
  // Find images where EXIF date equals upload date or is missing
  const { data: problematicImages, error } = await supabase
    .from('vehicle_images')
    .select(`
      id, 
      image_url, 
      exif_data,
      created_at,
      vehicle_id,
      vehicles!inner(year, make, model)
    `)
    .or('exif_data.is.null,exif_data.eq.{}');
  
  if (error) {
    console.error('Error fetching images:', error);
    return;
  }
  
  // Also find images where EXIF date matches upload date (suspicious)
  const { data: suspiciousImages } = await supabase.rpc('get_suspicious_images', {
    date_threshold: '2025-09-01'  // Images uploaded after Sept 1, 2025
  }).catch(() => ({ data: [] }));
  
  const allProblematic = [...(problematicImages || []), ...(suspiciousImages || [])];
  const uniqueImages = Array.from(new Map(allProblematic.map(img => [img.id, img])).values());
  
  console.log(`Found ${uniqueImages.length} images to check\n`);
  
  let fixed = 0;
  let noExif = 0;
  let failed = 0;
  
  // Group by vehicle for better logging
  const byVehicle = {};
  uniqueImages.forEach(img => {
    const key = img.vehicle_id;
    if (!byVehicle[key]) byVehicle[key] = [];
    byVehicle[key].push(img);
  });
  
  for (const [vehicleId, images] of Object.entries(byVehicle)) {
    if (images.length === 0) continue;
    
    const vehicle = images[0].vehicles;
    console.log(`\nProcessing: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
    console.log(`  Checking ${images.length} images...`);
    
    let vehicleFixed = 0;
    let vehicleNoExif = 0;
    
    for (const image of images) {
      const newExifData = await extractExifFromImage(image.image_url);
      
      if (newExifData && (newExifData.dateTimeOriginal || newExifData.dateTime)) {
        // Update only if we found date information
        const { error: updateError } = await supabase
          .from('vehicle_images')
          .update({ exif_data: newExifData })
          .eq('id', image.id);
        
        if (updateError) {
          console.error(`  Failed to update image ${image.id}:`, updateError.message);
          failed++;
        } else {
          const date = newExifData.dateTimeOriginal || newExifData.dateTime;
          if (vehicleFixed % 10 === 0) {
            console.log(`  Fixed ${vehicleFixed + 1}/${images.length} - Date: ${date}`);
          }
          vehicleFixed++;
          fixed++;
        }
      } else {
        vehicleNoExif++;
        noExif++;
      }
      
      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    console.log(`  Results: ${vehicleFixed} fixed, ${vehicleNoExif} no EXIF`);
  }
  
  console.log('\n========================================');
  console.log(`FIXED: ${fixed} images with proper dates`);
  console.log(`NO EXIF: ${noExif} images (no date metadata)`);
  console.log(`FAILED: ${failed} images (update errors)`);
  console.log('========================================');
}

// Create the RPC function if it doesn't exist
async function createSuspiciousImagesFunction() {
  const query = `
    CREATE OR REPLACE FUNCTION get_suspicious_images(date_threshold date)
    RETURNS TABLE (
      id uuid,
      image_url text,
      exif_data jsonb,
      created_at timestamptz,
      vehicle_id uuid,
      vehicles jsonb
    )
    LANGUAGE sql
    AS $$
      SELECT 
        vi.id,
        vi.image_url,
        vi.exif_data,
        vi.created_at,
        vi.vehicle_id,
        jsonb_build_object('year', v.year, 'make', v.make, 'model', v.model) as vehicles
      FROM vehicle_images vi
      JOIN vehicles v ON vi.vehicle_id = v.id
      WHERE vi.created_at::date > date_threshold
      AND (
        vi.exif_data->>'dateTimeOriginal' = to_char(vi.created_at, 'YYYY:MM:DD HH24:MI:SS')
        OR vi.exif_data->>'dateTime' = to_char(vi.created_at, 'YYYY:MM:DD HH24:MI:SS')
      );
    $$;
  `;
  
  const { error } = await supabase.rpc('query', { sql: query }).catch(() => ({ error: true }));
  if (error) {
    console.log('Note: Could not create helper function, will use basic query');
  }
}

// Run the fix
createSuspiciousImagesFunction().then(() => {
  findAndFixProblematicImages();
});

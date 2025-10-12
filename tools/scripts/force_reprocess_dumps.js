const { createClient } = require('@supabase/supabase-js');
const ExifReader = require('exifreader');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

// Target specific date ranges with suspicious dumps
const SUSPICIOUS_DATE_RANGES = [
  { start: '2025-09-16', end: '2025-09-21' },  // September dumps
  { start: '2025-09-06', end: '2025-09-06' },  // Another potential dump
];

async function forceExtractExif(imageUrl) {
  try {
    console.log(`    Fetching: ${imageUrl.split('/').pop()}`);
    const response = await fetch(imageUrl);
    const buffer = await response.arrayBuffer();
    
    try {
      const tags = ExifReader.load(buffer);
      
      // Build comprehensive EXIF object
      const exifData = {};
      
      // Date fields - try multiple formats
      const dateFields = [
        'DateTimeOriginal',
        'DateTime', 
        'DateTimeDigitized',
        'CreateDate',
        'ModifyDate',
        'GPSDateStamp'
      ];
      
      for (const field of dateFields) {
        if (tags[field]) {
          const value = tags[field].description || tags[field].value;
          if (value) {
            // Convert field name to camelCase for consistency
            const key = field.charAt(0).toLowerCase() + field.slice(1);
            exifData[key] = value;
            console.log(`      Found ${field}: ${value}`);
          }
        }
      }
      
      // Camera info
      if (tags.Make) exifData.make = tags.Make.description;
      if (tags.Model) exifData.model = tags.Model.description;
      if (tags.Software) exifData.software = tags.Software.description;
      
      // GPS if available
      if (tags.GPSLatitude && tags.GPSLongitude) {
        exifData.gps = {
          latitude: tags.GPSLatitude.description,
          longitude: tags.GPSLongitude.description,
        };
      }
      
      return Object.keys(exifData).length > 0 ? exifData : null;
    } catch (exifError) {
      console.log(`      No EXIF found: ${exifError.message}`);
      return null;
    }
  } catch (fetchError) {
    console.error(`    Failed to fetch image: ${fetchError.message}`);
    return null;
  }
}

async function processImageDumps() {
  console.log('Finding suspicious image dumps...\n');
  
  for (const range of SUSPICIOUS_DATE_RANGES) {
    console.log(`\nProcessing dumps from ${range.start} to ${range.end}`);
    
    // Get all images uploaded in this date range
    const { data: images, error } = await supabase
      .from('vehicle_images')
      .select(`
        id,
        image_url,
        exif_data,
        created_at,
        vehicle_id,
        vehicles!inner(year, make, model)
      `)
      .gte('created_at', `${range.start} 00:00:00`)
      .lte('created_at', `${range.end} 23:59:59`)
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching images:', error);
      continue;
    }
    
    // Group by vehicle and upload date
    const grouped = {};
    images.forEach(img => {
      const key = `${img.vehicle_id}_${img.created_at.split('T')[0]}`;
      if (!grouped[key]) {
        grouped[key] = {
          vehicle: img.vehicles,
          date: img.created_at.split('T')[0],
          images: []
        };
      }
      grouped[key].images.push(img);
    });
    
    // Process large dumps (10+ images)
    for (const group of Object.values(grouped)) {
      if (group.images.length < 10) continue;
      
      console.log(`\n  ${group.vehicle.year} ${group.vehicle.make} ${group.vehicle.model}`);
      console.log(`  ${group.date}: ${group.images.length} images`);
      
      let reprocessed = 0;
      let foundDates = 0;
      
      for (const image of group.images) {
        // Always reprocess if no dateTimeOriginal
        const needsReprocess = !image.exif_data?.dateTimeOriginal && !image.exif_data?.dateTime;
        
        if (needsReprocess) {
          const newExif = await forceExtractExif(image.image_url);
          
          if (newExif) {
            // Update the database
            const { error: updateError } = await supabase
              .from('vehicle_images')
              .update({ exif_data: newExif })
              .eq('id', image.id);
            
            if (!updateError) {
              reprocessed++;
              if (newExif.dateTimeOriginal || newExif.dateTime) {
                foundDates++;
              }
            }
          }
          
          // Rate limit
          await new Promise(resolve => setTimeout(resolve, 75));
        }
      }
      
      console.log(`    Reprocessed: ${reprocessed}, Found dates: ${foundDates}`);
    }
  }
  
  console.log('\n\nNow re-run the timeline grouping SQL to fix the timeline events!');
}

// Also check for images that might have corrupted EXIF
async function findCorruptedExif() {
  console.log('\nChecking for corrupted EXIF data...\n');
  
  const { data: images } = await supabase
    .from('vehicle_images')
    .select('id, image_url, exif_data')
    .not('exif_data', 'is', null)
    .limit(1000);
  
  let corrupted = 0;
  for (const img of images || []) {
    // Check if EXIF has date field but it equals upload date (suspicious)
    if (img.exif_data?.dateTimeOriginal) {
      const exifDate = img.exif_data.dateTimeOriginal;
      // Check if it's in YYYY:MM:DD format vs other formats
      if (!exifDate.includes(':')) {
        console.log(`Corrupted format found: ${img.id} - ${exifDate}`);
        corrupted++;
      }
    }
  }
  
  console.log(`Found ${corrupted} images with corrupted EXIF format`);
}

// Run both checks
processImageDumps().then(() => {
  return findCorruptedExif();
});

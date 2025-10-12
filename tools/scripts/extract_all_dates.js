const { createClient } = require('@supabase/supabase-js');
const ExifReader = require('exifreader');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

async function extractAllPossibleDates(imageUrl) {
  try {
    const response = await fetch(imageUrl);
    const buffer = await response.arrayBuffer();
    
    // Load with expanded tags to get ALL metadata
    const tags = ExifReader.load(buffer, {expanded: true});
    
    const exifData = {};
    const foundDates = [];
    
    // Check EVERY possible date field
    const dateFields = [
      // Standard EXIF
      'DateTimeOriginal',
      'DateTime',
      'DateTimeDigitized',
      'CreateDate',
      'ModifyDate',
      'DateCreated',
      'TimeCreated',
      
      // GPS dates
      'GPSDateStamp',
      'GPSTimeStamp',
      
      // File system dates
      'FileModifyDate',
      'FileAccessDate',
      'FileCreateDate',
      'FileInodeChangeDate',
      
      // IPTC dates
      'DateCreated',
      'DigitalCreationDate',
      'ReleaseDate',
      
      // XMP dates  
      'CreateDate',
      'ModifyDate',
      'MetadataDate',
      'DateCreated',
      
      // Proprietary
      'SubSecDateTimeOriginal',
      'SubSecDateTimeDigitized',
      'SubSecDateTime',
      
      // Apple/iPhone specific
      'ContentCreateDate',
      'CreationDate',
      'ProfileDateTime'
    ];
    
    // Check main EXIF structure
    for (const field of dateFields) {
      if (tags[field]) {
        const value = tags[field].description || tags[field].value || tags[field];
        if (value && value !== 'undefined') {
          const fieldName = field.charAt(0).toLowerCase() + field.slice(1);
          exifData[fieldName] = value;
          foundDates.push(`${field}: ${value}`);
          console.log(`    Found ${field}: ${value}`);
        }
      }
    }
    
    // Check expanded metadata structures
    if (tags.exif) {
      for (const field of dateFields) {
        if (tags.exif[field]) {
          const value = tags.exif[field].description || tags.exif[field].value || tags.exif[field];
          if (value && value !== 'undefined' && !exifData[field.toLowerCase()]) {
            exifData['exif_' + field.charAt(0).toLowerCase() + field.slice(1)] = value;
            foundDates.push(`exif.${field}: ${value}`);
            console.log(`    Found exif.${field}: ${value}`);
          }
        }
      }
    }
    
    // Check file structure
    if (tags.file) {
      for (const field of dateFields) {
        if (tags.file[field]) {
          const value = tags.file[field].description || tags.file[field].value || tags.file[field];
          if (value && value !== 'undefined' && !exifData[field.toLowerCase()]) {
            exifData['file_' + field.charAt(0).toLowerCase() + field.slice(1)] = value;
            foundDates.push(`file.${field}: ${value}`);
            console.log(`    Found file.${field}: ${value}`);
          }
        }
      }
    }
    
    // Add camera info if available
    if (tags.Make) exifData.make = tags.Make.description || tags.Make.value;
    if (tags.Model) exifData.model = tags.Model.description || tags.Model.value;
    if (tags.Software) exifData.software = tags.Software.description || tags.Software.value;
    
    // Add GPS if available
    if (tags.GPSLatitude && tags.GPSLongitude) {
      exifData.gps = {
        latitude: tags.GPSLatitude.description,
        longitude: tags.GPSLongitude.description,
      };
    }
    
    if (foundDates.length === 0) {
      console.log('    No dates found in any field!');
      // Try to inspect the raw structure
      console.log('    Raw tag keys:', Object.keys(tags).slice(0, 20).join(', '));
    }
    
    return Object.keys(exifData).length > 0 ? exifData : null;
  } catch (error) {
    console.error('    Error extracting:', error.message);
    return null;
  }
}

async function findAndExtractAllDates() {
  console.log('Finding images that supposedly have no EXIF dates...\n');
  
  // Get images marked as having no dates
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
    .or(`exif_data.is.null,and(exif_data->>dateTimeOriginal.is.null,exif_data->>dateTime.is.null)`)
    .in('vehicle_id', [
      '7176a5fc-24ae-4b42-9e65-0b96c4f9e50c', // 1980 GMC K10
      'b1fd848d-c64d-4b3a-8d09-0bacfeef9561', // 1987 Suburban
      'e08bf694-970f-4cbe-8a74-8715158a0f2e', // 1977 K5
      'a84273ab-4e0d-45c4-bdaa-5c9ad023079d'  // 1985 K20
    ])
    .limit(30);
  
  if (error) {
    console.error('Error:', error);
    return;
  }
  
  console.log(`Checking ${images.length} images for hidden date fields...\n`);
  
  let foundHiddenDates = 0;
  
  for (const img of images) {
    console.log(`\n${img.vehicles.year} ${img.vehicles.make} ${img.vehicles.model}`);
    console.log(`  Image: ${img.image_url.split('/').pop()}`);
    console.log(`  Current EXIF:`, img.exif_data ? Object.keys(img.exif_data).join(', ') : 'null');
    
    const newExif = await extractAllPossibleDates(img.image_url);
    
    if (newExif && (newExif.dateTimeOriginal || newExif.dateTime || Object.keys(newExif).some(k => k.includes('date')))) {
      foundHiddenDates++;
      
      // Update the database with ALL found dates
      const { error: updateError } = await supabase
        .from('vehicle_images')
        .update({ exif_data: newExif })
        .eq('id', img.id);
      
      if (updateError) {
        console.error('    Failed to update:', updateError.message);
      } else {
        console.log('    ✓ Updated with found dates!');
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log(`\n\nFound hidden dates in ${foundHiddenDates} / ${images.length} images`);
  console.log('Run the timeline fix SQL after this completes!');
}

findAndExtractAllDates();

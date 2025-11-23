#!/usr/bin/env node
/**
 * Extract EXIF from existing storage images
 * Download images, extract EXIF, update database
 */

const { createClient } = require('@supabase/supabase-js');
const https = require('https');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Import EXIF extraction (need to use dynamic import for ES modules)
async function extractExifFromUrl(imageUrl) {
  try {
    // Download image
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(\`Failed to download image: \${response.status}\`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    // Try to extract EXIF using exifr (if available)
    try {
      const exifr = await import('exifr');
      const exifData = await exifr.default.parse(uint8Array, {
        gps: true,
        pick: [
          'DateTimeOriginal', 'DateTime', 'CreateDate',
          'GPSLatitude', 'GPSLongitude', 'latitude', 'longitude',
          'Make', 'Model', 'ImageWidth', 'ImageHeight',
          'ISO', 'FNumber', 'ExposureTime', 'FocalLength'
        ]
      });
      
      return exifData;
    } catch (exifError) {
      console.warn('EXIF extraction failed:', exifError.message);
      return null;
    }
    
  } catch (error) {
    console.error('Error downloading/processing image:', error.message);
    return null;
  }
}

async function processExistingImages() {
  console.log('🔧 EXTRACTING EXIF FROM EXISTING IMAGES');
  console.log('=======================================');
  console.log('');

  const vehicleId = '21ee373f-765e-4e24-a69d-e59e2af4f467';

  try {
    // Get images that need EXIF processing
    const { data: images } = await supabase
      .from('vehicle_images')
      .select('id, image_url, file_name, exif_data, taken_at')
      .eq('vehicle_id', vehicleId)
      .order('created_at', { ascending: false });

    console.log(\`📸 Found \${images?.length || 0} images to process\`);

    if (!images || images.length === 0) {
      console.log('❌ No images found');
      return;
    }

    const needsProcessing = images.filter(img => !img.exif_data || !img.taken_at);
    console.log(\`🔍 \${needsProcessing.length} images need EXIF processing\`);
    console.log('');

    let processed = 0;
    let errors = 0;

    for (const img of needsProcessing) {
      console.log(\`📷 Processing: \${img.file_name || 'Unknown'}\`);
      
      try {
        // Extract EXIF from the image URL
        const exifData = await extractExifFromUrl(img.image_url);
        
        if (exifData) {
          console.log('   ✅ EXIF extracted');
          
          // Determine photo date
          const photoDate = exifData.DateTimeOriginal || exifData.DateTime || exifData.CreateDate;
          const takenAt = photoDate ? new Date(photoDate).toISOString() : null;
          
          if (takenAt) {
            console.log(\`   📅 Photo taken: \${new Date(takenAt).toLocaleDateString()}\`);
          } else {
            console.log('   ⚠️  No date found in EXIF');
          }
          
          // Update database record
          const { error: updateError } = await supabase
            .from('vehicle_images')
            .update({
              taken_at: takenAt,
              exif_data: {
                DateTimeOriginal: photoDate,
                camera: exifData.Make && exifData.Model ? {
                  make: exifData.Make,
                  model: exifData.Model
                } : null,
                technical: {
                  iso: exifData.ISO,
                  aperture: exifData.FNumber,
                  shutterSpeed: exifData.ExposureTime,
                  focalLength: exifData.FocalLength
                },
                location: exifData.latitude && exifData.longitude ? {
                  latitude: exifData.latitude,
                  longitude: exifData.longitude
                } : null,
                dimensions: exifData.ImageWidth && exifData.ImageHeight ? {
                  width: exifData.ImageWidth,
                  height: exifData.ImageHeight
                } : null
              }
            })
            .eq('id', img.id);
          
          if (updateError) {
            console.log(\`   ❌ Database update failed: \${updateError.message}\`);
            errors++;
          } else {
            console.log('   ✅ Database updated with EXIF data');
            processed++;
          }
        } else {
          console.log('   ⚠️  No EXIF data found in image');
        }
      } catch (error) {
        console.log(\`   ❌ Processing failed: \${error.message}\`);
        errors++;
      }
      
      console.log('');
    }

    console.log('📊 SUMMARY:');
    console.log(\`   ✅ Processed: \${processed} images\`);
    console.log(\`   ❌ Errors: \${errors} images\`);
    console.log(\`   ⏭️  Skipped: \${images.length - needsProcessing.length} (already had EXIF)\`);
    
    if (processed > 0) {
      console.log('');
      console.log('🎉 SUCCESS!');
      console.log('🔄 Refresh the vehicle page to see photos on correct timeline dates');
      console.log('📅 Timeline will now show photos when they were taken, not uploaded');
    }

  } catch (error) {
    console.log('❌ Script failed:', error.message);
  }
}

// Run the EXIF extraction
if (require.main === module) {
  processExistingImages()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('❌ EXIF extraction failed:', error.message);
      process.exit(1);
    });
}

module.exports = { processExistingImages };

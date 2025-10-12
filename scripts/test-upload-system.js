#!/usr/bin/env node
/**
 * Test the new upload system and EXIF processing
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testUploadSystem() {
  console.log('🧪 TESTING UPLOAD SYSTEM & TIMELINE DATES');
  console.log('=========================================');
  console.log('');

  const vehicleId = 'e7ed3e29-456a-43ea-843d-2dc0468ea4ca';

  try {
    // Check current images and their EXIF data
    console.log('📸 Checking current images and EXIF data...');
    const { data: images } = await supabase
      .from('vehicle_images')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('created_at', { ascending: false })
      .limit(5);

    if (images && images.length > 0) {
      console.log(`Found ${images.length} image records:`);
      console.log('');

      images.forEach((img, i) => {
        console.log(`${i+1}. File: ${img.file_name || 'NULL'}`);
        console.log(`   Upload date: ${img.created_at}`);
        console.log(`   Taken date: ${img.taken_at || 'NULL'}`);
        console.log(`   EXIF data: ${img.exif_data ? 'Present' : 'NULL'}`);
        
        if (img.exif_data) {
          const exif = img.exif_data;
          console.log(`   EXIF DateTimeOriginal: ${exif.DateTimeOriginal || 'NULL'}`);
          console.log(`   EXIF camera: ${exif.camera ? JSON.stringify(exif.camera) : 'NULL'}`);
        }

        // What timeline will use
        const exifData = img.exif_data || {};
        const timelineDate = exifData.DateTimeOriginal || exifData.DateTime || img.created_at;
        console.log(`   Timeline will use: ${timelineDate}`);
        
        const uploadDate = img.created_at.split('T')[0];
        const timelineDisplayDate = new Date(timelineDate).toISOString().split('T')[0];
        
        if (uploadDate === timelineDisplayDate) {
          console.log(`   ⚠️  Will show on upload date (${uploadDate}) - no EXIF date found`);
        } else {
          console.log(`   ✅ Will show on photo date (${timelineDisplayDate}) - EXIF date used`);
        }
        console.log('');
      });

      console.log('🎯 DIAGNOSIS:');
      const hasProperExif = images.some(img => 
        img.exif_data && img.exif_data.DateTimeOriginal && 
        img.exif_data.DateTimeOriginal !== img.created_at
      );

      if (hasProperExif) {
        console.log('✅ Some images have proper EXIF dates');
        console.log('   Timeline should show photos on correct dates');
      } else {
        console.log('❌ No images have proper EXIF dates');
        console.log('   All photos will show on upload date, not photo date');
        console.log('   This is why timeline grouping is wrong');
      }

      console.log('');
      console.log('💡 SOLUTION:');
      console.log('1. The new upload service now extracts EXIF properly');
      console.log('2. Hard refresh the page (Cmd+Shift+R)');
      console.log('3. Upload a new photo with EXIF data');
      console.log('4. It should appear on the correct timeline date');

    } else {
      console.log('❌ No image records found');
    }

  } catch (error) {
    console.log('❌ Error:', error.message);
  }
}

// Run the test
if (require.main === module) {
  testUploadSystem()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('❌ Test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testUploadSystem };

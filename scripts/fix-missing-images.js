#!/usr/bin/env node
/**
 * Fix Missing Images Script
 * Retroactively add existing storage images to database
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function fixMissingImages() {
  console.log('🔧 Fixing Missing Vehicle Images in Database');
  console.log('============================================\n');

  const vehicleId = 'e7ed3e29-456a-43ea-843d-2dc0468ea4ca';
  
  try {
    // Check storage files
    console.log('📁 Checking storage files...');
    const { data: files, error: storageError } = await supabase.storage
      .from('vehicle-images')
      .list(vehicleId, { limit: 10 });

    if (storageError) {
      console.log('❌ Storage error:', storageError.message);
      return;
    }

    console.log(`✅ Found ${files?.length || 0} files in storage`);

    if (!files || files.length === 0) {
      console.log('⚠️  No files found in storage');
      return;
    }

    // Get current user for RLS
    const { data: profiles } = await supabase.from('profiles').select('id').limit(1);
    const userId = profiles?.[0]?.id;

    if (!userId) {
      console.log('❌ No user found for RLS - cannot insert records');
      return;
    }

    console.log(`👤 Using user ID: ${userId}`);

    // Check existing database records
    const { data: existingImages } = await supabase
      .from('vehicle_images')
      .select('file_name')
      .eq('vehicle_id', vehicleId);

    const existingFiles = new Set((existingImages || []).map(img => img.file_name));
    console.log(`📊 Existing database records: ${existingFiles.size}`);

    // Process each file
    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const file of files) {
      if (existingFiles.has(file.name)) {
        console.log(`⏭️  Skipping ${file.name} (already in database)`);
        skipped++;
        continue;
      }

      // Create database record for missing file
      const imageUrl = `https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/${vehicleId}/${file.name}`;
      
      const imageData = {
        vehicle_id: vehicleId,
        image_url: imageUrl,
        user_id: userId,
        category: 'exterior', // Default category
        file_name: file.name,
        file_size: file.metadata?.size || 0,
        mime_type: file.metadata?.mimetype || 'image/jpeg',
        storage_path: `${vehicleId}/${file.name}`,
        caption: `Retroactively added image: ${file.name}`
      };

      console.log(`📝 Creating record for: ${file.name}`);
      
      const { data: result, error } = await supabase
        .from('vehicle_images')
        .insert(imageData)
        .select('id, file_name')
        .single();

      if (error) {
        console.log(`❌ Failed to create record for ${file.name}:`, error.message);
        errors++;
      } else {
        console.log(`✅ Created record ${result.id} for ${file.name}`);
        created++;
      }
    }

    console.log('\n📊 SUMMARY:');
    console.log(`✅ Created: ${created} records`);
    console.log(`⏭️  Skipped: ${skipped} existing records`);
    console.log(`❌ Errors: ${errors} failures`);

    if (created > 0) {
      console.log('\n🎉 SUCCESS!');
      console.log('🔄 Now refresh the vehicle page to see the timeline populated:');
      console.log(`   http://localhost:5174/vehicle/${vehicleId}`);
      console.log('\n📸 The timeline should now show all uploaded images!');
    } else if (errors === 0 && skipped > 0) {
      console.log('\n✅ All images already in database - timeline should be working!');
    }

  } catch (error) {
    console.log('❌ Script failed:', error.message);
  }
}

// Run the fix
if (require.main === module) {
  fixMissingImages()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('❌ Script error:', error.message);
      process.exit(1);
    });
}

module.exports = { fixMissingImages };

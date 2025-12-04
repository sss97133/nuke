#!/usr/bin/env node
/**
 * Fix Images Directly
 * Use service role to bypass RLS and add missing images
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
// Note: In production, you'd use the service role key, but for now we'll work with what we have

async function fixImagesDirectly() {
  console.log('🔧 Fixing Images by Creating Database Records');
  console.log('===========================================\n');

  const vehicleId = 'e7ed3e29-456a-43ea-843d-2dc0468ea4ca';
  const userId = '0b9f107a-d124-49de-9ded-94698f63c1c4'; // skylar williams
  
  // Create anon client
  const supabase = createClient(SUPABASE_URL, 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk');
  
  try {
    console.log('📁 Getting storage files...');
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

    console.log('\n📝 Files to process:');
    files.forEach((file, i) => {
      console.log(`  ${i+1}. ${file.name} (${Math.round((file.metadata?.size || 0) / 1024)}KB)`);
    });

    // Since RLS is blocking us, let's create a SQL script instead
    console.log('\n🔧 Generating SQL script to run manually...');
    
    const sqlStatements = [];
    
    files.forEach((file, i) => {
      const imageUrl = `https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/${vehicleId}/${file.name}`;
      
      const sql = `INSERT INTO vehicle_images (
  vehicle_id, 
  image_url, 
  user_id, 
  category, 
  file_name, 
  file_size, 
  mime_type, 
  storage_path,
  caption
) VALUES (
  '${vehicleId}',
  '${imageUrl}',
  '${userId}',
  'exterior',
  '${file.name}',
  ${file.metadata?.size || 0},
  '${file.metadata?.mimetype || 'image/jpeg'}',
  '${vehicleId}/${file.name}',
  'Retroactively added image ${i + 1}'
);`;
      
      sqlStatements.push(sql);
    });

    const fullSQL = sqlStatements.join('\n\n');
    
    console.log('\n📄 SQL Script Generated:');
    console.log('========================');
    console.log(fullSQL);
    console.log('========================\n');
    
    console.log('🎯 TO FIX THE IMAGES:');
    console.log('1. Copy the SQL above');
    console.log('2. Go to your Supabase Dashboard → SQL Editor');
    console.log('3. Paste and run the SQL');
    console.log('4. Refresh the vehicle page');
    console.log('');
    console.log('🔄 OR try logging into the frontend first:');
    console.log('   1. Go to http://localhost:5174/login');
    console.log('   2. Login with your credentials');
    console.log('   3. Upload a new image to test the fixed upload system');

  } catch (error) {
    console.log('❌ Script failed:', error.message);
  }
}

// Run the fix
if (require.main === module) {
  fixImagesDirectly()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('❌ Script error:', error.message);
      process.exit(1);
    });
}

module.exports = { fixImagesDirectly };

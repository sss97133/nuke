#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client with service role key for admin operations
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseServiceKey) {
  throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');
}
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const IMAGES_DIR = '/Users/skylar/nuke/images';

async function uploadLocalImages() {
  try {
    console.log('🚀 Starting local image upload process...');
    
    // Get all vehicles from database
    const { data: vehicles, error: vehiclesError } = await supabase
      .from('vehicles')
      .select('id, make, model, year, vin');
    
    if (vehiclesError) {
      console.error('❌ Error fetching vehicles:', vehiclesError);
      return;
    }
    
    console.log(`📋 Found ${vehicles.length} vehicles in database`);
    
    // Get all image files
    const imageFiles = fs.readdirSync(IMAGES_DIR)
      .filter(file => /\.(jpeg|jpg|png|webp)$/i.test(file))
      .sort();
    
    console.log(`📸 Found ${imageFiles.length} local images`);
    
    // Upload images and link to vehicles
    let uploadCount = 0;
    
    for (let i = 0; i < imageFiles.length; i++) {
      const filename = imageFiles[i];
      const filePath = path.join(IMAGES_DIR, filename);
      
      // Assign images to vehicles in round-robin fashion
      const vehicle = vehicles[i % vehicles.length];
      
      try {
        console.log(`📤 Uploading ${filename} for ${vehicle.year} ${vehicle.make} ${vehicle.model}...`);
        
        // Read file
        const fileBuffer = fs.readFileSync(filePath);
        
        // Upload to Supabase storage
        const storageFilename = `${vehicle.id}/${Date.now()}_${filename}`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('vehicle-images')
          .upload(storageFilename, fileBuffer, {
            contentType: 'image/jpeg',
            upsert: false
          });
        
        if (uploadError) {
          console.error(`❌ Upload error for ${filename}:`, uploadError);
          continue;
        }
        
        // Get public URL
        const { data: urlData } = supabase.storage
          .from('vehicle-images')
          .getPublicUrl(storageFilename);
        
        // Insert into vehicle_images table
        const { error: dbError } = await supabase
          .from('vehicle_images')
          .insert({
            vehicle_id: vehicle.id,
            user_id: 'ff4173c7-350b-443c-99c3-800361f7fabd', // Use existing user ID
            image_url: urlData.publicUrl,
            is_primary: i < vehicles.length, // First image per vehicle is primary
            image_category: 'exterior'
          });
        
        if (dbError) {
          console.error(`❌ Database error for ${filename}:`, dbError);
          continue;
        }
        
        console.log(`✅ Successfully uploaded and linked ${filename}`);
        uploadCount++;
        
        // Small delay to avoid overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.error(`❌ Error processing ${filename}:`, error);
      }
    }
    
    console.log(`🎉 Upload complete! Successfully uploaded ${uploadCount}/${imageFiles.length} images`);
    
    // Show final status
    const { data: finalImages } = await supabase
      .from('vehicle_images')
      .select('vehicle_id, image_url, is_primary')
      .order('uploaded_at', { ascending: false });
    
    console.log(`📊 Total images in database: ${finalImages?.length || 0}`);
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
  }
}

// Run the upload
uploadLocalImages();

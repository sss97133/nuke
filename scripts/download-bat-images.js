/**
 * Download Images from Bring a Trailer Listing
 * 
 * Usage: node download-bat-images.js <bat-url> <vehicle-id>
 */

import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '../.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseKey) {
  console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const batUrl = process.argv[2];
const vehicleId = process.argv[3];

if (!batUrl || !vehicleId) {
  console.error('Usage: node download-bat-images.js <bat-url> <vehicle-id>');
  process.exit(1);
}

console.log(`🔍 Fetching BaT listing: ${batUrl}`);

async function downloadBaTImages() {
  try {
    // Fetch the BaT listing page
    const response = await fetch(batUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch BaT listing: ${response.status}`);
    }
    
    const html = await response.text();
    
    // Extract all image URLs from the listing
    // BaT uses patterns like: https://bringatrailer.com/wp-content/uploads/2024/...
    // Get URLs without query parameters first
    const imageUrlPattern = /https:\/\/bringatrailer\.com\/wp-content\/uploads\/[^\s"'<>]+\.jpg/gi;
    let imageUrls = [...new Set(html.match(imageUrlPattern) || [])];
    
    // Remove query parameters and deduplicate
    imageUrls = [...new Set(imageUrls.map(url => url.split('?')[0]))];
    
    console.log(`\n📸 Found ${imageUrls.length} images`);
    
    // Filter out thumbnails and keep only full-size images
    const fullSizeImages = imageUrls.filter(url => {
      const lowerUrl = url.toLowerCase();
      return !lowerUrl.includes('thumbnail') && 
             !lowerUrl.includes('-150x') && 
             !lowerUrl.includes('-300x') &&
             !lowerUrl.includes('avatar') &&
             !lowerUrl.includes('logo') &&
             (lowerUrl.includes('uploads') || lowerUrl.includes('bat-images'));
    });
    
    console.log(`✅ Filtered to ${fullSizeImages.length} full-size images\n`);
    
    let successCount = 0;
    let skipCount = 0;
    
    for (let i = 0; i < fullSizeImages.length; i++) {
      const imageUrl = fullSizeImages[i];
      console.log(`[${i + 1}/${fullSizeImages.length}] Processing: ${imageUrl.substring(0, 80)}...`);
      
      try {
        // Download the image
        const imgResponse = await fetch(imageUrl);
        if (!imgResponse.ok) {
          console.log(`   ⚠️  Failed to download (${imgResponse.status})`);
          skipCount++;
          continue;
        }
        
        const buffer = await imgResponse.buffer();
        const contentType = imgResponse.headers.get('content-type') || 'image/jpeg';
        
        // Generate a filename from the URL
        const urlParts = imageUrl.split('/');
        const originalFilename = urlParts[urlParts.length - 1].split('?')[0];
        const ext = originalFilename.split('.').pop();
        const timestamp = Date.now();
        const filename = `bat_${timestamp}_${i}.${ext}`;
        
        // Upload to Supabase storage
        const storagePath = `vehicle-data/${vehicleId}/${filename}`;
        
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('vehicle-data')
          .upload(storagePath, buffer, {
            contentType,
            cacheControl: '3600',
            upsert: false
          });
        
        if (uploadError) {
          console.log(`   ⚠️  Upload failed: ${uploadError.message}`);
          skipCount++;
          continue;
        }
        
        // Get public URL
        const { data: { publicUrl } } = supabase.storage
          .from('vehicle-data')
          .getPublicUrl(storagePath);
        
        // Create vehicle_images entry (no user_id or ghost_user_id - truly anonymous from BaT)
        const { error: dbError } = await supabase
          .from('vehicle_images')
          .insert({
            vehicle_id: vehicleId,
            image_url: publicUrl,
            source: 'bat_import',
            category: 'imported',
            imported_by: '0b9f107a-d124-49de-9ded-94698f63c1c4', // Skylar's user ID
            taken_at: null // Unknown date
          });
        
        if (dbError) {
          console.log(`   ⚠️  Database error: ${dbError.message}`);
          skipCount++;
          continue;
        }
        
        console.log(`   ✅ Saved to database`);
        successCount++;
        
      } catch (err) {
        console.log(`   ❌ Error: ${err.message}`);
        skipCount++;
      }
    }
    
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`✅ Successfully imported: ${successCount} images`);
    console.log(`⚠️  Skipped: ${skipCount} images`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

downloadBaTImages();


#!/usr/bin/env node

/**
 * Generate thumbnails for 1932 Ford Roadster images
 * Uses Supabase Edge Function for image transformation
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, '../.env') });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

const VEHICLE_ID = '21ee373f-765e-4e24-a69d-e59e2af4f467';

async function generateThumbnails() {
  console.log('Fetching images for 1932 Ford Roadster...');
  
  const { data: images, error } = await supabase
    .from('vehicle_images')
    .select('id, image_url, storage_path')
    .eq('vehicle_id', VEHICLE_ID)
    .is('thumbnail_url', null);
  
  if (error) {
    console.error('Error fetching images:', error);
    return;
  }
  
  console.log(`Found ${images.length} images needing thumbnails`);
  
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    console.log(`Processing ${i + 1}/${images.length}: ${img.id}`);
    
    try {
      // Use Supabase image transformation API
      const baseUrl = img.image_url;
      
      // Generate variant URLs using Supabase transform API
      const thumbnailUrl = `${baseUrl}?width=200&height=150&quality=70`;
      const mediumUrl = `${baseUrl}?width=600&height=450&quality=80`;
      const largeUrl = `${baseUrl}?width=1200&height=900&quality=85`;
      
      // Update database
      const { error: updateError } = await supabase
        .from('vehicle_images')
        .update({
          thumbnail_url: thumbnailUrl,
          medium_url: mediumUrl,
          large_url: largeUrl
        })
        .eq('id', img.id);
      
      if (updateError) {
        console.error(`  Failed to update ${img.id}:`, updateError);
      } else {
        console.log(`  ✓ Generated variants for ${img.id}`);
      }
      
    } catch (err) {
      console.error(`  Error processing ${img.id}:`, err.message);
    }
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  console.log('\n✅ Thumbnail generation complete!');
}

generateThumbnails()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });


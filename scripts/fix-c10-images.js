/**
 * Fix C10 images - try direct download since we don't have BaT URL
 */

import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 
                     process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || 
                     process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const VEHICLE_ID = '655f224f-d8ae-4fc6-a3ec-4ab8db234fdf';
const USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4';

async function downloadAndUploadImage(imageUrl, imageId, index) {
  try {
    const response = await fetch(imageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    });
    
    if (!response.ok) return null;
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const ext = path.extname(imageUrl).split('?')[0] || '.jpg';
    const filename = `bat_c10_${Date.now()}_${index}${ext}`;
    const storagePath = `vehicles/${VEHICLE_ID}/bat/${filename}`;
    
    let { error } = await supabase.storage
      .from('vehicle-images')
      .upload(storagePath, buffer, {
        contentType: response.headers.get('content-type') || 'image/jpeg',
        cacheControl: '3600',
        upsert: false
      });
    
    let publicUrl;
    if (error) {
      const { error: e2 } = await supabase.storage
        .from('vehicle-data')
        .upload(`vehicles/${VEHICLE_ID}/bat/${filename}`, buffer, {
          contentType: response.headers.get('content-type') || 'image/jpeg',
          cacheControl: '3600',
          upsert: false
        });
      if (e2) return null;
      const { data: { publicUrl: url } } = supabase.storage
        .from('vehicle-data')
        .getPublicUrl(`vehicles/${VEHICLE_ID}/bat/${filename}`);
      publicUrl = url;
    } else {
      const { data: { publicUrl: url } } = supabase.storage
        .from('vehicle-images')
        .getPublicUrl(storagePath);
      publicUrl = url;
    }
    
    return publicUrl;
  } catch (error) {
    return null;
  }
}

async function updateImage(imageId, newUrl, originalUrl) {
  const { data: existing } = await supabase
    .from('vehicle_images')
    .select('user_id, exif_data')
    .eq('id', imageId)
    .single();
  
  const { error } = await supabase
    .from('vehicle_images')
    .update({
      image_url: newUrl,
      is_external: false,
      source: 'bat_listing',
      source_url: originalUrl,
      user_id: existing?.user_id || USER_ID,
      exif_data: {
        ...(existing?.exif_data || {}),
        original_bat_url: originalUrl,
        downloaded_at: new Date().toISOString(),
        fixed: true
      }
    })
    .eq('id', imageId);
  
  return !error;
}

async function main() {
  console.log('🔧 Fixing C10 images...\n');
  
  const { data: images } = await supabase
    .from('vehicle_images')
    .select('id, image_url')
    .eq('vehicle_id', VEHICLE_ID)
    .like('image_url', '%bringatrailer.com%');
  
  if (!images || images.length === 0) {
    console.log('No images to fix');
    return;
  }
  
  console.log(`Found ${images.length} images to fix\n`);
  
  let fixed = 0;
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    process.stdout.write(`[${i + 1}/${images.length}] `);
    
    const newUrl = await downloadAndUploadImage(img.image_url, img.id, i);
    if (newUrl) {
      if (await updateImage(img.id, newUrl, img.image_url)) {
        console.log('✅ Fixed');
        fixed++;
      } else {
        console.log('❌ DB update failed');
      }
    } else {
      console.log('❌ Download failed');
    }
    
    await new Promise(r => setTimeout(r, 1000));
  }
  
  console.log(`\n✅ Fixed ${fixed}/${images.length} images`);
}

main().catch(console.error);


/**
 * Import Craigslist Image for 1976 Chevy C10
 * Downloads and links the image from the listing to the vehicle
 */

import { createClient } from '@supabase/supabase-js';
import https from 'https';

const SUPABASE_URL = 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
});

const vehicleId = '4e01734f-e51d-493f-9013-e4c40e48d0ac';
const imageUrl = 'https://images.craigslist.org/00K0K_k87wwjkmtCV_0x10eR_1200x900.jpg';
const userId = '13450c45-3e8b-4124-9f5b-5c512094ff04'; // uploaded_by from vehicle

function upgradeCraigslistImageUrl(url) {
  // Upgrade to highest resolution (1200x900 or 600x450)
  if (url.includes('_50x50c.jpg') || url.includes('_300x300.jpg')) {
    return url.replace(/_50x50c\.jpg|_300x300\.jpg/g, '_1200x900.jpg');
  }
  if (url.includes('_600x450.jpg')) {
    return url.replace('_600x450.jpg', '_1200x900.jpg');
  }
  return url;
}

async function downloadImage(imageUrl) {
  return new Promise((resolve, reject) => {
    https.get(imageUrl, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }

      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve(buffer);
      });
      response.on('error', reject);
    }).on('error', reject);
  });
}

async function uploadImage(buffer, vehicleId, index) {
  const fileName = `cl_${Date.now()}_${index}.jpg`;
  const storagePath = `vehicle-data/${vehicleId}/${fileName}`;

  // Upload to storage
  const { error: uploadError } = await supabase.storage
    .from('vehicle-data')
    .upload(storagePath, buffer, {
      contentType: 'image/jpeg',
      upsert: false
    });

  if (uploadError) {
    throw uploadError;
  }

  // Get public URL
  const { data: urlData } = supabase.storage
    .from('vehicle-data')
    .getPublicUrl(storagePath);

  // Insert into vehicle_images
  const { error: insertError } = await supabase
    .from('vehicle_images')
    .insert({
      vehicle_id: vehicleId,
      user_id: userId,
      image_url: urlData.publicUrl,
      thumbnail_url: urlData.publicUrl, // TODO: Generate thumbnail
      medium_url: urlData.publicUrl,    // TODO: Generate medium
      large_url: urlData.publicUrl,
      organization_status: 'organized',
      organized_at: new Date().toISOString(),
      is_primary: true // First image should be primary
    });

  if (insertError) {
    throw insertError;
  }

  return urlData.publicUrl;
}

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📸 Importing Craigslist Image for 1976 C10');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(`Vehicle ID: ${vehicleId}`);
  console.log(`Image URL: ${imageUrl}\n`);

  try {
    // Upgrade to high-res
    const highResUrl = upgradeCraigslistImageUrl(imageUrl);
    console.log(`📥 Downloading: ${highResUrl}`);

    // Download image
    const imageBuffer = await downloadImage(highResUrl);
    console.log(`✅ Downloaded: ${(imageBuffer.length / 1024).toFixed(2)} KB`);

    // Upload to Supabase
    console.log(`📤 Uploading to vehicle profile...`);
    const publicUrl = await uploadImage(imageBuffer, vehicleId, 0);
    console.log(`✅ Uploaded: ${publicUrl}\n`);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Image import complete!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();


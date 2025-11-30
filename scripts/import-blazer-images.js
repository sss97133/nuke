import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, serviceRoleKey);

const VEHICLE_ID = '1fe31397-4f41-490f-87a2-b8dc44cb7c09';

// Image URLs from the ClassicCars listing (first 10 for testing)
const imageUrls = [
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54826926-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54826927-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54826928-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54826929-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54826930-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54826933-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54826951-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54826952-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54826953-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54826954-1977-chevrolet-blazer-thumb.jpg'
];

// Convert thumb URLs to full-size (remove -thumb)
function getFullSizeUrl(thumbUrl) {
  return thumbUrl.replace('-thumb.jpg', '.jpg');
}

async function importImages() {
  console.log('📥 Importing images for 1977 Chevrolet Blazer...\n');
  console.log(`Vehicle ID: ${VEHICLE_ID}\n`);

  const { data: users } = await supabase.auth.admin.listUsers();
  const userId = users?.users[0]?.id;

  let imported = 0;
  let failed = 0;

  for (let i = 0; i < imageUrls.length; i++) {
    const thumbUrl = imageUrls[i];
    const fullUrl = getFullSizeUrl(thumbUrl);
    
    try {
      console.log(`[${i + 1}/${imageUrls.length}] Downloading: ${fullUrl.substring(0, 60)}...`);
      
      // Download image
      const response = await fetch(fullUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; NukeBot/1.0)',
          'Accept': 'image/*',
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        console.log(`  ⚠️  Failed to download (${response.status}), trying thumbnail...`);
        // Try thumbnail as fallback
        const thumbResponse = await fetch(thumbUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; NukeBot/1.0)',
            'Accept': 'image/*',
          },
          signal: AbortSignal.timeout(30000),
        });
        
        if (!thumbResponse.ok) {
          console.log(`  ❌ Thumbnail also failed`);
          failed++;
          continue;
        }
        
        const imageBuffer = await thumbResponse.arrayBuffer();
        const imageBytes = new Uint8Array(imageBuffer);
        
        // Upload to storage
        const timestamp = Date.now();
        const filename = `classiccars_${timestamp}_${i}.jpg`;
        const storagePath = `${VEHICLE_ID}/${filename}`;

        const { error: uploadError } = await supabase.storage
          .from('vehicle-images')
          .upload(storagePath, imageBytes, {
            contentType: 'image/jpeg',
            cacheControl: '3600',
            upsert: false
          });

        if (uploadError) {
          console.log(`  ❌ Upload failed: ${uploadError.message}`);
          failed++;
          continue;
        }

        const { data: { publicUrl } } = supabase.storage
          .from('vehicle-images')
          .getPublicUrl(storagePath);

        // Create vehicle_images record
        const { error: imageError } = await supabase
          .from('vehicle_images')
          .insert({
            vehicle_id: VEHICLE_ID,
            image_url: publicUrl,
            user_id: userId,
            source: 'classiccars_com',
            category: 'exterior',
            imported_by: userId,
            metadata: {
              original_url: thumbUrl,
              classiccars_listing_id: '1985175',
              imported_at: new Date().toISOString()
            },
            is_primary: i === 0
          });

        if (imageError) {
          console.log(`  ❌ DB insert failed: ${imageError.message}`);
          failed++;
        } else {
          console.log(`  ✅ Imported image ${i + 1}`);
          imported++;
        }
      } else {
        const imageBuffer = await response.arrayBuffer();
        const imageBytes = new Uint8Array(imageBuffer);

        // Upload to storage
        const timestamp = Date.now();
        const filename = `classiccars_${timestamp}_${i}.jpg`;
        const storagePath = `${VEHICLE_ID}/${filename}`;

        const { error: uploadError } = await supabase.storage
          .from('vehicle-images')
          .upload(storagePath, imageBytes, {
            contentType: 'image/jpeg',
            cacheControl: '3600',
            upsert: false
          });

        if (uploadError) {
          console.log(`  ❌ Upload failed: ${uploadError.message}`);
          failed++;
          continue;
        }

        const { data: { publicUrl } } = supabase.storage
          .from('vehicle-images')
          .getPublicUrl(storagePath);

        // Create vehicle_images record
        const { error: imageError } = await supabase
          .from('vehicle_images')
          .insert({
            vehicle_id: VEHICLE_ID,
            image_url: publicUrl,
            user_id: userId,
            source: 'classiccars_com',
            category: 'exterior',
            imported_by: userId,
            is_primary: i === 0
          });

        if (imageError) {
          console.log(`  ❌ DB insert failed: ${imageError.message}`);
          failed++;
        } else {
          console.log(`  ✅ Imported image ${i + 1}`);
          imported++;
        }
      }

      // Small delay between images
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
      failed++;
    }
  }

  console.log(`\n✅ Import complete: ${imported} imported, ${failed} failed\n`);
  
  // Show final profile
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', VEHICLE_ID)
    .single();

  const { data: images } = await supabase
    .from('vehicle_images')
    .select('*')
    .eq('vehicle_id', VEHICLE_ID)
    .order('created_at', { ascending: true });

  console.log('═══════════════════════════════════════════════════════════');
  console.log('📊 COMPLETE VEHICLE PROFILE');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.series ? ' ' + vehicle.series : ''}`);
  console.log(`Images: ${images?.length || 0}`);
  console.log(`\n🔗 Profile: https://n-zero.dev/vehicles/${VEHICLE_ID}`);
  console.log('═══════════════════════════════════════════════════════════\n');
}

importImages().catch(console.error);


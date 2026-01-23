import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const vehicleId = 'cfd289b8-b5f5-4a79-9b0e-a9298b1d442d';

async function check() {
  console.log('Checking vehicle:', vehicleId, '\n');

  // Get images with FULL URLs
  const { data: images } = await supabase
    .from('vehicle_images')
    .select('image_url, position')
    .eq('vehicle_id', vehicleId)
    .order('position');

  console.log('=== ALL IMAGE URLS (FULL) ===');
  console.log('Total:', images?.length);

  // Extract the unique hash from each URL
  const hashes = new Map<string, number[]>();

  images?.forEach((img, i) => {
    const url = img.image_url || '';
    console.log(`${i + 1}. ${url}`);

    // Extract hash from URL (the part after the last /)
    const hashMatch = url.match(/\/([a-f0-9]{20,})\//);
    if (hashMatch) {
      const hash = hashMatch[1];
      if (!hashes.has(hash)) {
        hashes.set(hash, []);
      }
      hashes.get(hash)?.push(i + 1);
    }
  });

  console.log('\n=== DUPLICATE ANALYSIS ===');
  let dupeCount = 0;
  hashes.forEach((positions, hash) => {
    if (positions.length > 1) {
      console.log(`Hash ${hash.substring(0, 20)}... appears at positions: ${positions.join(', ')}`);
      dupeCount += positions.length - 1;
    }
  });
  console.log(`\nTotal duplicates: ${dupeCount}`);
  console.log(`Unique images: ${images?.length ? images.length - dupeCount : 0}`);
}

check().catch(console.error);

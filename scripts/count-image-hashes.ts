import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  const vehicleId = '36ff163e-fc42-4655-aea4-bf220cdd9a96';

  // Get ALL images
  const { data: allImages } = await supabase
    .from('vehicle_images')
    .select('image_url')
    .eq('vehicle_id', vehicleId);

  console.log('Total images:', allImages?.length);

  // Count by hash
  const hashCounts: Record<string, number> = {};
  allImages?.forEach(img => {
    const hash = img.image_url?.match(/\/([a-f0-9]{40})\/photos/)?.[1] || 'no-hash';
    hashCounts[hash] = (hashCounts[hash] || 0) + 1;
  });

  console.log('\nImages per auction hash:');
  Object.entries(hashCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([hash, count]) => {
      const pct = ((count / (allImages?.length || 1)) * 100).toFixed(1);
      console.log('  ' + hash.substring(0, 16) + '...:', count, `(${pct}%)`);
    });

  // The correct hash is the one with most images
  const correctHash = Object.entries(hashCounts).sort((a, b) => b[1] - a[1])[0][0];
  const correctCount = hashCounts[correctHash];
  const pollutedCount = (allImages?.length || 0) - correctCount;

  console.log('\n=== SUMMARY ===');
  console.log('Correct auction hash:', correctHash.substring(0, 16) + '...');
  console.log('Correct images:', correctCount);
  console.log('Polluted images:', pollutedCount);
}

main();

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  const vehicleId = '36ff163e-fc42-4655-aea4-bf220cdd9a96';

  // Check all images with created_at
  const { data: images } = await supabase
    .from('vehicle_images')
    .select('source, image_url, created_at')
    .eq('vehicle_id', vehicleId)
    .order('created_at', { ascending: false })
    .limit(10);

  console.log('Most recent images:');
  images?.forEach((img, i) => {
    const hash = img.image_url?.match(/\/([a-f0-9]{40})\/photos/)?.[1]?.substring(0, 12) || 'no-hash';
    console.log((i+1) + '.', img.source, hash, new Date(img.created_at).toLocaleString());
  });

  // Count by created_at time buckets
  const { data: allImages } = await supabase
    .from('vehicle_images')
    .select('created_at, image_url')
    .eq('vehicle_id', vehicleId);

  console.log('\nTotal images:', allImages?.length);

  // Group by hour
  const byHour: Record<string, { count: number, hashes: Set<string> }> = {};
  allImages?.forEach(img => {
    const hour = new Date(img.created_at).toISOString().substring(0, 13);
    if (!byHour[hour]) byHour[hour] = { count: 0, hashes: new Set() };
    byHour[hour].count++;
    const hash = img.image_url?.match(/\/([a-f0-9]{40})\/photos/)?.[1];
    if (hash) byHour[hour].hashes.add(hash);
  });

  console.log('\nImages by hour:');
  Object.entries(byHour).sort().forEach(([hour, data]) => {
    console.log(hour + ':', data.count, 'images,', data.hashes.size, 'unique hashes');
  });
}

main();

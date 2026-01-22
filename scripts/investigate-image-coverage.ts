/**
 * Investigate image coverage discrepancy
 * Why do only 125 vehicles appear to have images when BaT sample shows 100%?
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('=== INVESTIGATE IMAGE COVERAGE ===\n');

  // 1. Check total images
  const { count: totalImages } = await supabase.from('vehicle_images').select('*', { count: 'exact', head: true });
  console.log(`Total images in vehicle_images: ${(totalImages || 0).toLocaleString()}`);

  // 2. Check distinct vehicle_ids in vehicle_images
  const { data: vehicleIdsWithImages } = await supabase
    .from('vehicle_images')
    .select('vehicle_id');

  const uniqueVehicleIds = new Set(vehicleIdsWithImages?.map(v => v.vehicle_id) || []);
  console.log(`Unique vehicle_ids in vehicle_images: ${uniqueVehicleIds.size.toLocaleString()}`);

  // 3. Check if these vehicle_ids exist in vehicles table
  const sampleIds = Array.from(uniqueVehicleIds).slice(0, 100);
  const { data: existingVehicles } = await supabase
    .from('vehicles')
    .select('id')
    .in('id', sampleIds);

  console.log(`Sample of 100 vehicle_ids that exist in vehicles: ${existingVehicles?.length || 0}`);

  // 4. Check image sources
  const { data: imageSources } = await supabase
    .from('vehicle_images')
    .select('source')
    .limit(10000);

  const sourceCount: Record<string, number> = {};
  for (const img of imageSources || []) {
    sourceCount[img.source || 'null'] = (sourceCount[img.source || 'null'] || 0) + 1;
  }
  console.log('\nImage sources (sample of 10k):');
  Object.entries(sourceCount).sort((a, b) => b[1] - a[1]).forEach(([src, cnt]) => {
    console.log(`   ${src}: ${cnt.toLocaleString()}`);
  });

  // 5. Check BaT vehicles specifically
  console.log('\n=== BaT SPECIFIC CHECK ===');
  const { data: batVehicles } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url')
    .ilike('discovery_url', '%bringatrailer%')
    .limit(20);

  for (const v of batVehicles || []) {
    const { count: imgCount } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_id', v.id);

    console.log(`${v.year} ${v.make} ${v.model}: ${imgCount || 0} images`);
  }

  // 6. Check if images might be orphaned (vehicle_id doesn't exist in vehicles)
  console.log('\n=== ORPHAN CHECK ===');
  // Get a sample of vehicle_ids from images
  const { data: imgSample } = await supabase
    .from('vehicle_images')
    .select('vehicle_id')
    .limit(1000);

  const sampleVehicleIds = [...new Set(imgSample?.map(i => i.vehicle_id) || [])];

  // Check which exist
  const { data: existingFromSample } = await supabase
    .from('vehicles')
    .select('id')
    .in('id', sampleVehicleIds.slice(0, 100));

  const existingSet = new Set(existingFromSample?.map(v => v.id) || []);
  const orphaned = sampleVehicleIds.slice(0, 100).filter(id => !existingSet.has(id));

  console.log(`Sample: ${sampleVehicleIds.length} unique vehicle_ids from images`);
  console.log(`Existing in vehicles: ${existingSet.size}`);
  console.log(`Orphaned (id in images but not in vehicles): ${orphaned.length}`);

  if (orphaned.length > 0) {
    console.log('Sample orphaned IDs:', orphaned.slice(0, 3));
  }

  // 7. Final summary
  console.log('\n=== SUMMARY ===');
  const { count: totalVehicles } = await supabase.from('vehicles').select('*', { count: 'exact', head: true });
  console.log(`Total vehicles: ${(totalVehicles || 0).toLocaleString()}`);
  console.log(`Total images: ${(totalImages || 0).toLocaleString()}`);
  console.log(`Unique vehicle_ids with images: ${uniqueVehicleIds.size.toLocaleString()}`);
  console.log(`Avg images per vehicle (with images): ${((totalImages || 0) / uniqueVehicleIds.size).toFixed(1)}`);
}

main().catch(console.error);

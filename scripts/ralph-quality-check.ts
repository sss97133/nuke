/**
 * Check extraction quality of recent BaT vehicles
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('=== EXTRACTION QUALITY CHECK ===\n');

  // Get recent BaT vehicles (created in last 24h)
  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, mileage, exterior_color, transmission, created_at')
    .ilike('discovery_url', '%bringatrailer%')
    .gte('created_at', new Date(Date.now() - 24*60*60*1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(50);

  const count = vehicles?.length || 0;
  console.log(`Recent BaT vehicles (last 24h): ${count}`);

  if (count === 0) {
    console.log('No recent vehicles found');
    return;
  }

  let vinCount = 0;
  let valid17Vin = 0;
  let mileageCount = 0;
  let colorCount = 0;
  let transCount = 0;

  for (const v of vehicles || []) {
    if (v.vin && v.vin.trim().length > 0) vinCount++;
    if (v.vin && v.vin.trim().length === 17) valid17Vin++;
    if (v.mileage && v.mileage > 0) mileageCount++;
    if (v.exterior_color && v.exterior_color.trim().length > 0) colorCount++;
    if (v.transmission && v.transmission.trim().length > 0) transCount++;
  }

  const n = count;
  console.log('\n=== FIELD COVERAGE ===');
  console.log(`VIN present: ${((vinCount/n)*100).toFixed(0)}% (${vinCount}/${n})`);
  console.log(`VIN 17-char: ${((valid17Vin/n)*100).toFixed(0)}% (${valid17Vin}/${n})`);
  console.log(`Mileage: ${((mileageCount/n)*100).toFixed(0)}% (${mileageCount}/${n})`);
  console.log(`Color: ${((colorCount/n)*100).toFixed(0)}% (${colorCount}/${n})`);
  console.log(`Transmission: ${((transCount/n)*100).toFixed(0)}% (${transCount}/${n})`);

  // Check images
  const ids = (vehicles || []).map(v => v.id);
  const { data: imgs } = await supabase.from('vehicle_images').select('vehicle_id').in('vehicle_id', ids);
  const withImgs = new Set((imgs || []).map(i => i.vehicle_id));
  console.log(`\nWith images: ${withImgs.size}/${n} (${((withImgs.size/n)*100).toFixed(0)}%)`);

  // Sample
  console.log('\n=== SAMPLE VEHICLES ===');
  for (const v of (vehicles || []).slice(0, 5)) {
    console.log(`\n${v.year} ${v.make} ${v.model}`);
    console.log(`  VIN: ${v.vin || 'MISSING'}`);
    console.log(`  Mileage: ${v.mileage || 'MISSING'}`);
    console.log(`  Color: ${v.exterior_color || 'MISSING'}`);
    console.log(`  Trans: ${v.transmission || 'MISSING'}`);
  }
}

main().catch(console.error);

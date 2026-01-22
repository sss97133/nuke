/**
 * Check extraction quality of latest BaT vehicles
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

  // Get latest BaT vehicles
  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, mileage, exterior_color, transmission, created_at')
    .ilike('discovery_url', '%bringatrailer%')
    .order('created_at', { ascending: false })
    .limit(50);

  const count = vehicles?.length || 0;
  console.log(`Latest BaT vehicles: ${count}`);

  if (count > 0) {
    console.log(`Most recent: ${vehicles[0].created_at}`);
  }

  if (count === 0) {
    console.log('No vehicles found');
    return;
  }

  let vinCount = 0;
  let valid17Vin = 0;
  let mileageCount = 0;
  let colorCount = 0;
  let transCount = 0;

  for (const v of vehicles) {
    const vin = v.vin || '';
    if (vin.trim().length > 0) vinCount++;
    if (vin.trim().length === 17) valid17Vin++;
    if (v.mileage && v.mileage > 0) mileageCount++;
    if (v.exterior_color && v.exterior_color.trim().length > 0) colorCount++;
    if (v.transmission && v.transmission.trim().length > 0) transCount++;
  }

  const n = count;
  console.log('\n=== FIELD COVERAGE ===');
  console.log(`VIN present: ${Math.round((vinCount/n)*100)}% (${vinCount}/${n})`);
  console.log(`VIN 17-char: ${Math.round((valid17Vin/n)*100)}% (${valid17Vin}/${n})`);
  console.log(`Mileage: ${Math.round((mileageCount/n)*100)}% (${mileageCount}/${n})`);
  console.log(`Color: ${Math.round((colorCount/n)*100)}% (${colorCount}/${n})`);
  console.log(`Transmission: ${Math.round((transCount/n)*100)}% (${transCount}/${n})`);

  // Check images
  const ids = vehicles.map(v => v.id);
  const { data: imgs } = await supabase.from('vehicle_images').select('vehicle_id').in('vehicle_id', ids);
  const withImgs = new Set((imgs || []).map(i => i.vehicle_id));
  console.log(`\nWith images: ${withImgs.size}/${n} (${Math.round((withImgs.size/n)*100)}%)`);

  // Sample
  console.log('\n=== SAMPLE VEHICLES ===');
  for (const v of vehicles.slice(0, 5)) {
    const vin = v.vin || 'MISSING';
    const miles = v.mileage || 'MISSING';
    console.log(`${v.year} ${v.make} ${v.model} - VIN: ${vin.substring(0,17)}, Miles: ${miles}`);
  }
}

main().catch(console.error);

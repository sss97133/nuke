#!/usr/bin/env node
/**
 * Backfill vehicle specs from vin_decoded_data → vehicles
 * Fills: displacement, fuel_type, trim, doors, engine_type, transmission, drivetrain, body_style
 */
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const BATCH = 200;

const FIELDS = [
  { src: 'engine_displacement_liters', dst: 'displacement' },
  { src: 'fuel_type', dst: 'fuel_type' },
  { src: 'trim', dst: 'trim' },
  { src: 'doors', dst: 'doors' },
  { src: 'engine_size', dst: 'engine_type' },
  { src: 'transmission', dst: 'transmission' },
  { src: 'drivetrain', dst: 'drivetrain' },
  { src: 'body_type', dst: 'body_style' },
];

for (const { src, dst } of FIELDS) {
  let total = 0, offset = 0, scanned = 0;
  while (true) {
    // Get vehicles missing this field that have a VIN
    const { data: vehicles } = await sb.from('vehicles')
      .select('id, vin')
      .is(dst, null)
      .eq('status', 'active')
      .not('vin', 'is', null)
      .neq('vin', '')
      .range(offset, offset + BATCH - 1);

    if (!vehicles || vehicles.length === 0) break;
    scanned += vehicles.length;

    // Look up VIN decode data for these VINs
    const vinList = vehicles.map(v => v.vin).filter(Boolean);
    const { data: decodes } = await sb.from('vin_decoded_data')
      .select(`vin, ${src}`)
      .in('vin', vinList)
      .not(src, 'is', null);

    if (decodes && decodes.length > 0) {
      const decodeMap = new Map(decodes.map(d => [d.vin, d[src]]));
      for (const v of vehicles) {
        const val = decodeMap.get(v.vin);
        if (val) {
          await sb.from('vehicles').update({ [dst]: val }).eq('id', v.id);
          total++;
        }
      }
    }

    offset += BATCH;
    if (scanned % 5000 === 0) process.stdout.write(`\r  ${dst}: ${scanned} scanned, ${total} filled`);
    if (vehicles.length < BATCH) break;
    if (offset > 350000) break; // safety cap
  }
  if (total > 0) console.log(`\n  ${dst}: ${total} filled`);
  else console.log(`  ${dst}: 0 (none found)`);
}

console.log('\nVIN decode backfill complete.');

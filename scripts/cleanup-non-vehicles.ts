#!/usr/bin/env npx tsx
/**
 * CLEANUP NON-VEHICLES
 *
 * 1. Fix "Watch" suffix bug (real vehicles with "Watch" appended)
 * 2. Delete definite non-vehicles (signs, pedal cars, engines, scale models)
 *
 * Run: dotenvx run -- npx tsx scripts/cleanup-non-vehicles.ts [--execute]
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const dryRun = !process.argv.includes('--execute');

function log(msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

async function fixWatchSuffix() {
  log('=== FIXING "Watch" SUFFIX BUG ===\n');

  const { data: watchItems, count } = await supabase
    .from('vehicles')
    .select('id, model', { count: 'exact' })
    .like('model', '%Watch');

  log(`Found ${count} items with Watch suffix`);

  if (!watchItems || watchItems.length === 0) return 0;

  let fixed = 0;
  for (const v of watchItems) {
    const newModel = v.model.replace(/Watch$/, '').trim();
    log(`  FIX: "${v.model}" → "${newModel}"`);

    if (!dryRun) {
      const { error } = await supabase
        .from('vehicles')
        .update({ model: newModel })
        .eq('id', v.id);
      if (!error) fixed++;
    }
  }

  return fixed;
}

async function deleteNonVehicles() {
  log('\n=== DELETING NON-VEHICLE ITEMS ===\n');

  let totalDeleted = 0;

  // 1. Neon signs
  const { data: neonSigns } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .ilike('model', '%neon sign%')
    .limit(200);

  if (neonSigns && neonSigns.length > 0) {
    log(`Neon signs: ${neonSigns.length} items`);
    for (const v of neonSigns.slice(0, 3)) {
      log(`  - ${v.year || '?'} ${v.make || '[no make]'} ${v.model}`);
    }
    if (!dryRun) {
      for (const v of neonSigns) {
        await deleteVehicle(v.id);
      }
    }
    totalDeleted += neonSigns.length;
  }

  // 2. Porcelain signs
  const { data: porcelainSigns } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .ilike('model', '%porcelain sign%')
    .limit(200);

  if (porcelainSigns && porcelainSigns.length > 0) {
    log(`Porcelain signs: ${porcelainSigns.length} items`);
    for (const v of porcelainSigns.slice(0, 3)) {
      log(`  - ${v.year || '?'} ${v.make || '[no make]'} ${v.model}`);
    }
    if (!dryRun) {
      for (const v of porcelainSigns) {
        await deleteVehicle(v.id);
      }
    }
    totalDeleted += porcelainSigns.length;
  }

  // 3. Pedal cars
  const { data: pedalCars } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .ilike('model', '%pedal car%')
    .limit(200);

  if (pedalCars && pedalCars.length > 0) {
    log(`Pedal cars: ${pedalCars.length} items`);
    for (const v of pedalCars.slice(0, 3)) {
      log(`  - ${v.year || '?'} ${v.make || '[no make]'} ${v.model}`);
    }
    if (!dryRun) {
      for (const v of pedalCars) {
        await deleteVehicle(v.id);
      }
    }
    totalDeleted += pedalCars.length;
  }

  // 4. Scale models
  const { data: scaleModels } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .ilike('model', '%scale model%')
    .limit(200);

  if (scaleModels && scaleModels.length > 0) {
    log(`Scale models: ${scaleModels.length} items`);
    for (const v of scaleModels.slice(0, 3)) {
      log(`  - ${v.year || '?'} ${v.make || '[no make]'} ${v.model}`);
    }
    if (!dryRun) {
      for (const v of scaleModels) {
        await deleteVehicle(v.id);
      }
    }
    totalDeleted += scaleModels.length;
  }

  // 5. GM Engine duplicates
  const { data: gmEngines } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .ilike('model', '%HD L8T 6.6L Gas and L5P Duramax%')
    .limit(200);

  if (gmEngines && gmEngines.length > 0) {
    log(`GM Engine duplicates: ${gmEngines.length} items`);
    log(`  - All same: "HD L8T 6.6L Gas and L5P Duramax 6.6L Diesel Engines"`);
    if (!dryRun) {
      for (const v of gmEngines) {
        await deleteVehicle(v.id);
      }
    }
    totalDeleted += gmEngines.length;
  }

  // 6. Illuminated signs
  const { data: illuminatedSigns } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .ilike('model', '%illuminated sign%')
    .limit(200);

  if (illuminatedSigns && illuminatedSigns.length > 0) {
    log(`Illuminated signs: ${illuminatedSigns.length} items`);
    for (const v of illuminatedSigns.slice(0, 3)) {
      log(`  - ${v.year || '?'} ${v.make || '[no make]'} ${v.model}`);
    }
    if (!dryRun) {
      for (const v of illuminatedSigns) {
        await deleteVehicle(v.id);
      }
    }
    totalDeleted += illuminatedSigns.length;
  }

  // 7. Light up signs
  const { data: lightUpSigns } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .ilike('model', '%light up%sign%')
    .limit(200);

  if (lightUpSigns && lightUpSigns.length > 0) {
    log(`Light-up signs: ${lightUpSigns.length} items`);
    for (const v of lightUpSigns.slice(0, 3)) {
      log(`  - ${v.year || '?'} ${v.make || '[no make]'} ${v.model}`);
    }
    if (!dryRun) {
      for (const v of lightUpSigns) {
        await deleteVehicle(v.id);
      }
    }
    totalDeleted += lightUpSigns.length;
  }

  // 8. Sided signs (double/single sided)
  const { data: sidedSigns } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .ilike('model', '%sided%sign%')
    .limit(200);

  if (sidedSigns && sidedSigns.length > 0) {
    log(`Sided signs: ${sidedSigns.length} items`);
    for (const v of sidedSigns.slice(0, 3)) {
      log(`  - ${v.year || '?'} ${v.make || '[no make]'} ${v.model}`);
    }
    if (!dryRun) {
      for (const v of sidedSigns) {
        await deleteVehicle(v.id);
      }
    }
    totalDeleted += sidedSigns.length;
  }

  // 9. Diecast
  const { data: diecast } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .or('model.ilike.%diecast%,model.ilike.%die-cast%')
    .limit(200);

  if (diecast && diecast.length > 0) {
    log(`Diecast models: ${diecast.length} items`);
    for (const v of diecast.slice(0, 3)) {
      log(`  - ${v.year || '?'} ${v.make || '[no make]'} ${v.model}`);
    }
    if (!dryRun) {
      for (const v of diecast) {
        await deleteVehicle(v.id);
      }
    }
    totalDeleted += diecast.length;
  }

  // 10. Posters (not dealership)
  const { data: posters } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .ilike('model', '%poster%')
    .not('model', 'ilike', '%dealership%')
    .limit(200);

  if (posters && posters.length > 0) {
    log(`Posters: ${posters.length} items`);
    for (const v of posters.slice(0, 3)) {
      log(`  - ${v.year || '?'} ${v.make || '[no make]'} ${v.model}`);
    }
    if (!dryRun) {
      for (const v of posters) {
        await deleteVehicle(v.id);
      }
    }
    totalDeleted += posters.length;
  }

  return totalDeleted;
}

async function deleteVehicle(id: string) {
  await supabase.from('vehicle_images').delete().eq('vehicle_id', id);
  await supabase.from('vehicle_status_metadata').delete().eq('vehicle_id', id);
  await supabase.from('vehicle_mailboxes').delete().eq('vehicle_id', id);
  await supabase.from('vehicles').delete().eq('id', id);
}

async function main() {
  log(`Non-vehicle cleanup - Dry run: ${dryRun}`);
  log('─'.repeat(60));

  const fixed = await fixWatchSuffix();
  const deleted = await deleteNonVehicles();

  log('\n' + '─'.repeat(60));
  log(`SUMMARY: ${fixed} Watch suffixes fixed, ${deleted} non-vehicles ${dryRun ? 'would be' : ''} deleted`);

  if (dryRun) {
    log('\n[DRY RUN] Run with --execute to apply changes');
  }
}

main().catch(console.error);

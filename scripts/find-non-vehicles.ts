#!/usr/bin/env npx tsx
/**
 * Find items in the vehicles table that aren't actually vehicles
 * (memorabilia, parts, signs, artwork, etc.)
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  console.log('=== SCANNING FOR NON-VEHICLE ITEMS ===\n');

  // Pattern 1: Model name contains non-vehicle keywords
  const nonVehiclePatterns = [
    'engine', 'motor', 'transmission', 'gearbox',
    'part', 'parts',
    'lot of', 'collection of', 'set of', 'pair of',
    'sign', 'neon sign', 'porcelain sign',
    'poster', 'print', 'framed', 'artwork', 'painting', 'drawing',
    'memorabilia', 'collectible',
    'display', 'diorama',
    'cap gun', 'toy', 'model car', 'scale model', 'diecast', 'die-cast',
    'pedal car', 'go kart', 'go-kart', 'golf cart',
    'trailer', 'hauler', 'enclosed trailer',
    'book', 'manual', 'brochure', 'literature',
    'wheel', 'wheels', 'rim', 'rims', 'tire', 'tires',
    'badge', 'emblem', 'hood ornament',
    'jacket', 'helmet', 'racing suit',
    'tool', 'tools', 'tool box', 'jack',
  ];

  const orClauses = nonVehiclePatterns.map(p => `model.ilike.%${p}%`).join(',');

  const { data: byModel, count: modelCount } = await supabase
    .from('vehicles')
    .select('id, year, make, model', { count: 'exact' })
    .or(orClauses)
    .limit(200);

  console.log(`Found ${modelCount} items matching non-vehicle patterns in model:\n`);

  // Group by category
  const categories: Record<string, any[]> = {
    'Parts/Engines': [],
    'Signs/Artwork': [],
    'Memorabilia/Collectibles': [],
    'Toys/Models': [],
    'Accessories': [],
    'Other': [],
  };

  for (const v of byModel || []) {
    const m = (v.model || '').toLowerCase();

    if (m.includes('engine') || m.includes('motor') || m.includes('transmission') || m.includes('gearbox') || m.includes('part')) {
      categories['Parts/Engines'].push(v);
    } else if (m.includes('sign') || m.includes('poster') || m.includes('print') || m.includes('artwork') || m.includes('framed') || m.includes('painting') || m.includes('drawing')) {
      categories['Signs/Artwork'].push(v);
    } else if (m.includes('memorabilia') || m.includes('collectible') || m.includes('lot of') || m.includes('collection')) {
      categories['Memorabilia/Collectibles'].push(v);
    } else if (m.includes('toy') || m.includes('model car') || m.includes('scale') || m.includes('diecast') || m.includes('pedal') || m.includes('cap gun')) {
      categories['Toys/Models'].push(v);
    } else if (m.includes('wheel') || m.includes('rim') || m.includes('tire') || m.includes('badge') || m.includes('helmet') || m.includes('jacket') || m.includes('tool')) {
      categories['Accessories'].push(v);
    } else {
      categories['Other'].push(v);
    }
  }

  for (const [category, items] of Object.entries(categories)) {
    if (items.length === 0) continue;

    console.log(`\n### ${category} (${items.length} items)\n`);
    for (const v of items.slice(0, 15)) {
      console.log(`  ${v.year || '?'} ${v.make || '[no make]'} ${v.model}`);
      console.log(`    ID: ${v.id}`);
    }
    if (items.length > 15) {
      console.log(`  ... and ${items.length - 15} more`);
    }
  }

  // Pattern 2: No year AND no make AND short/weird model
  console.log('\n\n=== ITEMS WITH NO YEAR AND NO MAKE ===\n');

  const { data: noYearNoMake, count: noYearNoMakeCount } = await supabase
    .from('vehicles')
    .select('id, year, make, model', { count: 'exact' })
    .is('year', null)
    .or('make.is.null,make.eq.')
    .limit(50);

  console.log(`Found ${noYearNoMakeCount} items with no year AND no make:\n`);
  for (const v of noYearNoMake || []) {
    console.log(`  [no year] [no make] ${v.model}`);
    console.log(`    ID: ${v.id}`);
  }

  // Summary
  console.log('\n\n=== SUMMARY ===\n');
  console.log(`Total non-vehicle items found: ${modelCount}`);
  console.log(`Items with no year AND no make: ${noYearNoMakeCount}`);
  console.log('\nTo delete these, run: dotenvx run -- npx tsx scripts/delete-non-vehicles.ts --execute');
}

main().catch(console.error);

import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const BATCH = 200;

async function batchUpdate(table, filter, updateFn, label) {
  let total = 0, offset = 0;
  while (true) {
    let q = sb.from(table).select('id, *').range(offset, offset + BATCH - 1);
    for (const [col, op, val] of filter) {
      if (op === 'is') q = q.is(col, val);
      else if (op === 'eq') q = q.eq(col, val);
      else if (op === 'like') q = q.like(col, val);
      else if (op === 'not.is') q = q.not(col, 'is', val);
      else if (op === 'ilike') q = q.ilike(col, val);
    }
    const { data, error } = await q;
    if (error) { console.error(`  ${label} query error:`, error.message); break; }
    if (!data || data.length === 0) break;
    
    for (const row of data) {
      const update = updateFn(row);
      if (update) {
        const { error: ue } = await sb.from(table).update(update).eq('id', row.id);
        if (!ue) total++;
      }
    }
    offset += BATCH;
    process.stdout.write(`\r  ${label}: ${offset} scanned, ${total} updated`);
    if (data.length < BATCH) break;
  }
  console.log(`\n  ${label}: DONE — ${total} updated`);
  return total;
}

// ─── 1. Platform source from listing_url ────────────────────────
console.log('\n=== Platform Source Normalization ===');
const platformMap = [
  ['https://bringatrailer.com', 'bringatrailer'],
  ['https://www.mecum.com', 'mecum'],
  ['https://www.barrett-jackson.com', 'barrett-jackson'],
  ['https://rmsothebys.com', 'rm-sothebys'],
  ['https://carsandbids.com', 'cars-and-bids'],
  ['https://collectingcars.com', 'collecting-cars'],
  ['https://www.jamesedition.com', 'jamesedition'],
  ['https://www.hemmings.com', 'hemmings'],
  ['https://www.ebay.com', 'ebay'],
];

for (const [prefix, platform] of platformMap) {
  let total = 0;
  while (true) {
    const { data } = await sb.from('vehicles')
      .select('id')
      .is('platform_source', null)
      .eq('status', 'active')
      .like('listing_url', `${prefix}%`)
      .limit(BATCH);
    if (!data || data.length === 0) break;
    
    const ids = data.map(r => r.id);
    const { error } = await sb.from('vehicles')
      .update({ platform_source: platform })
      .in('id', ids);
    if (error) { console.error(`  ${platform} error:`, error.message); break; }
    total += ids.length;
    process.stdout.write(`\r  ${platform}: ${total}`);
  }
  if (total > 0) console.log(`\n  ${platform}: ${total}`);
}

// ─── 2. Color Family ────────────────────────────────────────────
console.log('\n=== Color Family Normalization ===');
const colorFamilyMap = {
  'Black': ['black%', 'nero', 'schwarz', 'noir', 'onyx', 'obsidian', 'raven', 'jet black', 'phantom black', 'triple black', 'midnight black'],
  'White': ['white%', '%white', 'bianco', 'ivory', 'chalk', 'alabaster'],
  'Red': ['red%', '%red', 'rosso%', 'crimson', 'cherry', 'ruby', 'vermillion'],
  'Blue': ['blue%', '%blue', 'blu %', 'azzurr%', 'cobalt', 'navy', 'indigo', 'sapphire'],
  'Silver/Gray': ['silver%', '%silver%', 'gray%', 'grey%', 'grigio%', 'charcoal', 'graphite', 'gunmetal', 'titanium%', 'pewter', 'anthracite', 'nardo%', 'cement', 'slate', 'steel'],
  'Green': ['green%', '%green', 'verde%', 'emerald', 'olive', 'sage', 'forest%', 'british racing%', 'brg', 'racing green', 'lime', 'mint', 'jade'],
  'Yellow': ['yellow%', '%yellow', 'giallo%', 'sunflower', 'canary', 'lemon', 'dakar'],
  'Orange': ['orange%', '%orange', 'arancio%', 'papaya', 'tangerine', 'copper orange'],
  'Brown/Tan': ['brown%', '%brown', 'tan', 'espresso', 'chocolate', 'coffee', 'mocha', 'cinnamon', 'saddle', 'walnut', 'chestnut', 'cognac', 'caramel'],
  'Burgundy/Maroon': ['burgundy%', 'maroon%', 'bordeaux', 'oxblood', 'garnet', 'claret', 'merlot', 'wine', 'cranberry', 'dark red', 'deep red'],
  'Beige/Cream': ['beige%', 'cream%', 'creme%', 'champagne', 'sand', 'parchment', 'magnolia', 'linen', 'eggshell', 'ivory', 'oyster', 'cashmere'],
  'Gold': ['gold%', '%gold', 'golden'],
  'Purple/Violet': ['purple%', 'violet%', 'plum', 'amethyst', 'aubergine', 'eggplant', 'lavender', 'mauve', 'lilac'],
  'Bronze': ['bronze%', 'copper%'],
};

for (const [family, patterns] of Object.entries(colorFamilyMap)) {
  let total = 0;
  for (const pattern of patterns) {
    while (true) {
      const { data } = await sb.from('vehicles')
        .select('id')
        .is('color_family', null)
        .eq('status', 'active')
        .not('color', 'is', null)
        .ilike('color', pattern)
        .limit(BATCH);
      if (!data || data.length === 0) break;
      
      const ids = data.map(r => r.id);
      await sb.from('vehicles').update({ color_family: family }).in('id', ids);
      total += ids.length;
    }
  }
  if (total > 0) process.stdout.write(`  ${family}: ${total}\n`);
}

// ─── 3. VIN Decode Backfill ─────────────────────────────────────
console.log('\n=== VIN Decode Backfill ===');
const fields = [
  { src: 'engine_displacement_liters', dst: 'displacement', label: 'displacement' },
  { src: 'fuel_type', dst: 'fuel_type', label: 'fuel_type' },
  { src: 'trim', dst: 'trim', label: 'trim' },
  { src: 'doors', dst: 'doors', label: 'doors' },
  { src: 'engine_size', dst: 'engine_type', label: 'engine_type' },
  { src: 'transmission', dst: 'transmission', label: 'transmission' },
  { src: 'drivetrain', dst: 'drivetrain', label: 'drivetrain' },
  { src: 'body_type', dst: 'body_style', label: 'body_style' },
];

for (const { src, dst, label } of fields) {
  let total = 0, offset = 0;
  while (true) {
    // Get vehicles missing this field that have VIN decode data
    const { data: vehicles } = await sb.rpc('execute_sql_readonly', { query: `
      SELECT v.id, d.${src} as val FROM vehicles v
      JOIN vin_decoded_data d ON v.vin = d.vin
      WHERE v.status = 'active' AND v.${dst} IS NULL AND d.${src} IS NOT NULL
      ORDER BY v.id LIMIT ${BATCH} OFFSET ${offset}
    `}).catch(() => ({ data: null }));
    
    // Fallback: use direct queries
    if (!vehicles) {
      // Can't use RPC, use a manual join approach
      const { data: vins } = await sb.from('vehicles')
        .select('id, vin')
        .is(dst, null)
        .eq('status', 'active')
        .not('vin', 'is', null)
        .limit(BATCH);
      if (!vins || vins.length === 0) break;
      
      const vinList = vins.map(v => v.vin).filter(Boolean);
      const { data: decodes } = await sb.from('vin_decoded_data')
        .select(`vin, ${src}`)
        .in('vin', vinList)
        .not(src, 'is', null);
      if (!decodes || decodes.length === 0) { offset += BATCH; if (offset > 300000) break; continue; }
      
      const decodeMap = new Map(decodes.map(d => [d.vin, d[src]]));
      for (const v of vins) {
        const val = decodeMap.get(v.vin);
        if (val) {
          await sb.from('vehicles').update({ [dst]: val }).eq('id', v.id);
          total++;
        }
      }
      offset += BATCH;
      process.stdout.write(`\r  ${label}: ${offset} scanned, ${total} updated`);
      if (vins.length < BATCH) break;
      if (offset > 300000) break;
      continue;
    }
    break;
  }
  if (total > 0) console.log(`\n  ${label}: ${total}`);
}

console.log('\n=== ALL DONE ===');

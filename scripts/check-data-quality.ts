import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  // Check data quality for BaT vehicles
  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, mileage, color, interior_color, transmission, engine_size, bat_comments, listing_url')
    .not('listing_url', 'is', null)
    .ilike('listing_url', '%bringatrailer%')
    .order('updated_at', { ascending: false })
    .limit(15);

  console.log('=== BaT VEHICLES DATA QUALITY ===\n');

  let complete = 0;
  let partial = 0;

  for (const v of vehicles || []) {
    const fields = ['vin', 'mileage', 'color', 'interior_color', 'transmission', 'engine_size'];
    const filledCount = fields.filter(f => (v as any)[f] !== null).length;
    const status = filledCount >= 5 ? 'COMPLETE' : filledCount >= 3 ? 'GOOD' : 'PARTIAL';

    if (filledCount >= 5) complete++;
    else partial++;

    console.log(`${v.year} ${v.make} ${v.model} [${status} ${filledCount}/6]`);
    console.log(`  VIN: ${(v.vin || '—').substring(0, 17)}`);
    console.log(`  Miles: ${v.mileage ? v.mileage.toLocaleString() : '—'} | Ext: ${(v.color || '—').substring(0, 25)} | Int: ${(v.interior_color || '—').substring(0, 20)}`);
    console.log(`  Trans: ${(v.transmission || '—').substring(0, 30)} | Eng: ${(v.engine_size || '—').substring(0, 25)}`);
    console.log(`  Comments: ${v.bat_comments || 0}`);
    console.log('');
  }

  console.log('=== SUMMARY ===');
  console.log(`Complete (5-6 fields): ${complete}`);
  console.log(`Partial (< 5 fields): ${partial}`);

  // Count total images
  const { count: imageCount } = await supabase
    .from('vehicle_images')
    .select('*', { count: 'exact', head: true });
  console.log(`Total images in DB: ${imageCount}`);

  // Count by platform
  const { data: platforms } = await supabase
    .from('external_listings')
    .select('platform')
    .eq('listing_status', 'active');

  const platformCounts: Record<string, number> = {};
  for (const p of platforms || []) {
    platformCounts[p.platform] = (platformCounts[p.platform] || 0) + 1;
  }

  console.log('\n=== ACTIVE LISTINGS BY PLATFORM ===');
  const sorted = Object.entries(platformCounts).sort((a, b) => b[1] - a[1]);
  for (const [platform, count] of sorted) {
    console.log(`  ${platform}: ${count}`);
  }

  // Check Mercedes 500E specifically
  console.log('\n=== MERCEDES 500E DETAIL ===');
  const { data: merc } = await supabase
    .from('vehicles')
    .select('*')
    .ilike('listing_title', '%500E%')
    .limit(1)
    .single();

  if (merc) {
    console.log(`Title: ${merc.listing_title}`);
    console.log(`VIN: ${merc.vin}`);
    console.log(`Mileage: ${merc.mileage}`);
    console.log(`Color: ${merc.color}`);
    console.log(`Interior: ${merc.interior_color}`);
    console.log(`Transmission: ${merc.transmission}`);
    console.log(`Engine: ${merc.engine_size}`);
    console.log(`Comments: ${merc.bat_comments}`);
    console.log(`Description: ${merc.description?.substring(0, 200)}...`);

    // Count images
    const { count } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_id', merc.id);
    console.log(`Images: ${count}`);
  }
}

main().catch(console.error);

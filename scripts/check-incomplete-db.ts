import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function checkIncomplete() {
  // Find BaT vehicles with missing data
  const { data: incomplete } = await supabase
    .from('vehicles')
    .select('id, listing_title, vin, mileage, color, interior_color, transmission, engine_size, listing_url')
    .not('listing_url', 'is', null)
    .ilike('listing_url', '%bringatrailer%')
    .or('vin.is.null,mileage.is.null,color.is.null,transmission.is.null,engine_size.is.null')
    .limit(20);

  console.log('=== INCOMPLETE BAT VEHICLES ===');
  console.log('Found:', incomplete?.length || 0);

  for (const v of incomplete || []) {
    const missing: string[] = [];
    if (!v.vin) missing.push('VIN');
    if (!v.mileage) missing.push('mileage');
    if (!v.color) missing.push('color');
    if (!v.transmission) missing.push('trans');
    if (!v.engine_size) missing.push('engine');
    console.log(`${v.listing_title?.substring(0, 50)}... | Missing: ${missing.join(', ')}`);
  }

  // Check listing_page_snapshots
  const { count: snapshotCount } = await supabase
    .from('listing_page_snapshots')
    .select('*', { count: 'exact', head: true });
  console.log('\n=== LISTING PAGE SNAPSHOTS ===');
  console.log('Total snapshots:', snapshotCount);

  // Check auction_events
  const { count: eventCount } = await supabase
    .from('auction_events')
    .select('*', { count: 'exact', head: true });
  console.log('\n=== AUCTION EVENTS ===');
  console.log('Total events:', eventCount);

  // Check auction_comments
  const { count: commentCount } = await supabase
    .from('auction_comments')
    .select('*', { count: 'exact', head: true });
  console.log('\n=== AUCTION COMMENTS ===');
  console.log('Total comments:', commentCount);

  // Check vehicles with 0 comments that should have some
  const { data: noComments } = await supabase
    .from('vehicles')
    .select('id, listing_title, bat_comments, listing_url')
    .not('listing_url', 'is', null)
    .ilike('listing_url', '%bringatrailer%')
    .or('bat_comments.is.null,bat_comments.eq.0')
    .limit(10);

  console.log('\n=== VEHICLES WITH 0/NULL COMMENTS ===');
  console.log('Found:', noComments?.length || 0);
  for (const v of (noComments || []).slice(0, 5)) {
    console.log(`  ${v.listing_title?.substring(0, 60)}...`);
  }

  // Check total BaT vehicles
  const { count: batTotal } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true })
    .not('listing_url', 'is', null)
    .ilike('listing_url', '%bringatrailer%');
  console.log('\n=== TOTAL BAT VEHICLES ===');
  console.log('Total:', batTotal);

  // Check vehicles with images vs without
  const { data: withImages } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT
        COUNT(DISTINCT v.id) as total_bat,
        COUNT(DISTINCT CASE WHEN vi.vehicle_id IS NOT NULL THEN v.id END) as with_images
      FROM vehicles v
      LEFT JOIN vehicle_images vi ON vi.vehicle_id = v.id
      WHERE v.listing_url ILIKE '%bringatrailer%'
    `
  });
  console.log('\n=== IMAGE COVERAGE ===');
  console.log('Result:', withImages);
}

checkIncomplete().catch(console.error);

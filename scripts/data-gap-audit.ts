#!/usr/bin/env npx tsx
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  BaT DATA GAP AUDIT');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Get lot numbers
  const { data: lots } = await supabase
    .from('vehicles')
    .select('bat_lot_number')
    .not('bat_lot_number', 'is', null)
    .limit(10000);

  const numericLots = (lots || [])
    .map(v => parseInt(String(v.bat_lot_number)))
    .filter(n => !isNaN(n) && n > 0 && n < 300000)
    .sort((a, b) => b - a);

  console.log('LOT NUMBER ANALYSIS:');
  console.log('  Highest numeric lot:', numericLots[0]?.toLocaleString());
  console.log('  Sample recent lots:', numericLots.slice(0, 5).join(', '));

  // Count BaT vehicles
  const { count: batCount } = await supabase
    .from('vehicles')
    .select('id', { count: 'exact', head: true })
    .not('bat_auction_url', 'is', null);

  const { count: batWithLot } = await supabase
    .from('vehicles')
    .select('id', { count: 'exact', head: true })
    .not('bat_lot_number', 'is', null);

  console.log('\nWHAT WE HAVE:');
  console.log('  BaT vehicles (has URL):', batCount?.toLocaleString());
  console.log('  BaT vehicles (has lot #):', batWithLot?.toLocaleString());

  // Calculate gap
  const highestLot = numericLots[0] || 228000;
  const gap = highestLot - (batCount || 0);

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  THE GAP');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log('  BaT total listings (lot # as proxy):', highestLot.toLocaleString());
  console.log('  We have:', batCount?.toLocaleString());
  console.log('  MISSING:', gap.toLocaleString(), `(${(gap / highestLot * 100).toFixed(0)}%)`);

  // Check comment extraction status
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  COMMENT EXTRACTION STATUS');
  console.log('═══════════════════════════════════════════════════════════\n');

  const { count: withCommentCount } = await supabase
    .from('vehicles')
    .select('id', { count: 'exact', head: true })
    .not('bat_comments', 'is', null)
    .gt('bat_comments', 0);

  const { count: actualComments } = await supabase
    .from('auction_comments')
    .select('id', { count: 'exact', head: true });

  const { count: vehiclesWithExtracted } = await supabase
    .from('auction_comments')
    .select('vehicle_id', { count: 'exact', head: true });

  // Get expected vs actual comments
  const { data: commentStats } = await supabase
    .from('vehicles')
    .select('bat_comments')
    .not('bat_comments', 'is', null)
    .gt('bat_comments', 0)
    .limit(10000);

  const expectedComments = (commentStats || []).reduce((sum, v) => sum + (v.bat_comments || 0), 0);

  console.log('  Vehicles with bat_comments > 0:', withCommentCount?.toLocaleString());
  console.log('  Expected comments (sum of bat_comments):', expectedComments.toLocaleString(), '(sample)');
  console.log('  Actual extracted comments:', actualComments?.toLocaleString());

  // Check recent activity
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  FRESHNESS');
  console.log('═══════════════════════════════════════════════════════════\n');

  const today = new Date().toISOString().split('T')[0];
  const { count: todayCount } = await supabase
    .from('vehicles')
    .select('id', { count: 'exact', head: true })
    .gte('auction_end_date', today);

  const { count: thisWeek } = await supabase
    .from('vehicles')
    .select('id', { count: 'exact', head: true })
    .gte('auction_end_date', new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]);

  console.log('  Auctions ending today:', todayCount);
  console.log('  Auctions ending this week:', thisWeek);
  console.log('  (BaT runs ~100-150 auctions/day)');

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  VERDICT');
  console.log('═══════════════════════════════════════════════════════════\n');

  const pctComplete = ((batCount || 0) / highestLot * 100).toFixed(0);
  console.log(`  We have ${pctComplete}% of BaT listings.`);
  console.log(`  Missing ${gap.toLocaleString()} listings.`);
  console.log('');
  if (gap > 100000) {
    console.log('  ⚠️  DATA INCOMPLETE - Analysis would be unreliable');
    console.log('  Need full historical backfill before serious analysis.');
  }
}

main().catch(console.error);

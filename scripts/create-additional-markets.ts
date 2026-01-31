#!/usr/bin/env npx tsx
/**
 * Create additional market types for Kissimmee 2026
 *
 * 1. Will It Sell? - yes/no on whether lot finds buyer
 * 2. Make vs Make - which brand sells more
 * 3. Daily/Weekly totals - over/under on gross
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const AUCTION_START = new Date('2026-01-06T10:00:00-05:00');
const AUCTION_END = new Date('2026-01-18T18:00:00-05:00');

async function createWillSellMarkets() {
  console.log('\n=== Creating "Will It Sell?" Markets ===\n');

  // Get high-value K26 vehicles without will_sell markets
  const { data: vehicles } = await supabase
    .from('vehicles')
    .select(`
      id, year, make, model, sale_price,
      auction_events!inner(lot_number, raw_data)
    `)
    .eq('status', 'active')
    .eq('discovery_source', 'mecum')
    .is('sale_price', null); // Only unsold vehicles

  // Filter to K26 and high-value estimates
  const k26Vehicles = vehicles?.filter((v: any) => {
    const auction = v.auction_events?.[0]?.raw_data?.auction_name;
    return auction?.includes('Kissimmee') && auction?.includes('2026');
  }).slice(0, 100) || []; // Top 100

  let created = 0;

  for (const v of k26Vehicles) {
    const lot = v.auction_events?.[0]?.lot_number || 'TBD';

    // Check if will_sell market exists
    const { data: existing } = await supabase
      .from('betting_markets')
      .select('id')
      .eq('vehicle_id', v.id)
      .eq('market_type', 'auction_will_sell')
      .single();

    if (existing) continue;

    const { error } = await supabase.from('betting_markets').insert({
      market_type: 'auction_will_sell',
      title: `Will ${v.year} ${v.make} ${v.model} sell?`,
      description: `Lot ${lot}: Will this ${v.year} ${v.make} ${v.model} find a buyer at Mecum Kissimmee 2026? No Sale = NO.`,
      vehicle_id: v.id,
      line_value: null,
      line_description: 'Sells vs No Sale',
      status: 'open',
      locks_at: AUCTION_START.toISOString(),
      min_bet: 100,
      max_bet: 25000,
      rake_percent: 5,
    });

    if (!error) {
      created++;
      console.log(`  ✓ ${v.year} ${v.make} ${v.model}`);
    }
  }

  console.log(`\nCreated ${created} "Will It Sell?" markets`);
}

async function createMakeVsMakeMarkets() {
  console.log('\n=== Creating Make vs Make Markets ===\n');

  const matchups = [
    { make1: 'Chevrolet', make2: 'Ford', title: 'Chevy vs Ford' },
    { make1: 'Porsche', make2: 'Ferrari', title: 'Porsche vs Ferrari' },
    { make1: 'Chevrolet', make2: 'Dodge', title: 'Chevy vs Mopar' },
    { make1: 'BMW', make2: 'Mercedes-Benz', title: 'BMW vs Mercedes' },
    { make1: 'Pontiac', make2: 'Oldsmobile', title: 'Pontiac vs Olds' },
  ];

  for (const matchup of matchups) {
    // Check if exists
    const { data: existing } = await supabase
      .from('betting_markets')
      .select('id')
      .eq('market_type', 'make_vs_make')
      .ilike('title', `%${matchup.make1}%${matchup.make2}%`)
      .single();

    if (existing) {
      console.log(`  Skipping ${matchup.title} - already exists`);
      continue;
    }

    const { error } = await supabase.from('betting_markets').insert({
      market_type: 'make_vs_make',
      title: `${matchup.title}: Which sells more at Kissimmee 2026?`,
      description: `Will more ${matchup.make1} vehicles sell than ${matchup.make2} at Mecum Kissimmee 2026? Counts only SOLD lots, not No Sale.`,
      line_value: null,
      line_description: `${matchup.make1} vs ${matchup.make2}`,
      status: 'open',
      locks_at: AUCTION_START.toISOString(),
      min_bet: 100,
      max_bet: 50000,
      rake_percent: 5,
    });

    if (!error) {
      console.log(`  ✓ ${matchup.title}`);
    }
  }
}

async function createDailyGrossMarkets() {
  console.log('\n=== Creating Daily Gross Markets ===\n');

  // Create over/under for each auction day
  const auctionDays = 13; // Jan 6-18

  for (let day = 0; day < auctionDays; day++) {
    const date = new Date(AUCTION_START);
    date.setDate(date.getDate() + day);

    const dayName = date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

    // Estimate daily gross based on day of week (weekends higher)
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    const estimatedGross = isWeekend ? 25000000 : 15000000; // $25M weekend, $15M weekday
    const line = Math.round(estimatedGross / 1000000) * 1000000;

    // Check if exists
    const { data: existing } = await supabase
      .from('betting_markets')
      .select('id')
      .eq('market_type', 'daily_gross')
      .ilike('title', `%${dayName}%`)
      .single();

    if (existing) continue;

    const lockTime = new Date(date);
    lockTime.setHours(9, 0, 0, 0); // Lock at 9am auction day

    const { error } = await supabase.from('betting_markets').insert({
      market_type: 'daily_gross',
      title: `${dayName} Gross Over/Under $${(line / 1000000).toFixed(0)}M`,
      description: `Will total sales at Mecum Kissimmee on ${dayName} exceed $${(line / 1000000).toFixed(0)} million?`,
      line_value: line,
      line_description: `Over $${(line / 1000000).toFixed(0)}M`,
      status: 'open',
      locks_at: lockTime.toISOString(),
      min_bet: 100,
      max_bet: 100000,
      rake_percent: 5,
    });

    if (!error) {
      console.log(`  ✓ ${dayName} - $${(line / 1000000).toFixed(0)}M line`);
    }
  }
}

async function createWeeklyTotalMarket() {
  console.log('\n=== Creating Weekly Total Market ===\n');

  // Kissimmee typically does $200-300M
  const line = 250000000; // $250M

  const { data: existing } = await supabase
    .from('betting_markets')
    .select('id')
    .eq('market_type', 'weekly_gross')
    .single();

  if (existing) {
    console.log('  Weekly total market already exists');
    return;
  }

  const { error } = await supabase.from('betting_markets').insert({
    market_type: 'weekly_gross',
    title: `Kissimmee 2026 Total: Over/Under $${(line / 1000000).toFixed(0)}M`,
    description: `Will Mecum Kissimmee 2026 gross sales exceed $${(line / 1000000).toFixed(0)} million total? Includes all 13 days.`,
    line_value: line,
    line_description: `Over $${(line / 1000000).toFixed(0)}M`,
    status: 'open',
    locks_at: AUCTION_START.toISOString(),
    min_bet: 100,
    max_bet: 100000,
    rake_percent: 5,
  });

  if (!error) {
    console.log(`  ✓ Total Gross - $${(line / 1000000).toFixed(0)}M line`);
  }
}

async function createRecordBreakerMarkets() {
  console.log('\n=== Creating Record Breaker Markets ===\n');

  const thresholds = [
    { amount: 1000000, label: '$1M' },
    { amount: 2000000, label: '$2M' },
    { amount: 5000000, label: '$5M' },
  ];

  for (const { amount, label } of thresholds) {
    const { data: existing } = await supabase
      .from('betting_markets')
      .select('id')
      .eq('market_type', 'record_breaker')
      .eq('line_value', amount)
      .single();

    if (existing) continue;

    const { error } = await supabase.from('betting_markets').insert({
      market_type: 'record_breaker',
      title: `Will any car sell for ${label}+ at Kissimmee 2026?`,
      description: `Will at least one vehicle sell for over ${label} at Mecum Kissimmee 2026?`,
      line_value: amount,
      line_description: `Any sale over ${label}`,
      status: 'open',
      locks_at: AUCTION_START.toISOString(),
      min_bet: 100,
      max_bet: 50000,
      rake_percent: 5,
    });

    if (!error) {
      console.log(`  ✓ ${label}+ sale`);
    }
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Creating Additional Market Types');
  console.log('  Mecum Kissimmee 2026');
  console.log('═══════════════════════════════════════════════');

  await createWillSellMarkets();
  await createMakeVsMakeMarkets();
  await createDailyGrossMarkets();
  await createWeeklyTotalMarket();
  await createRecordBreakerMarkets();

  // Final count
  const { count } = await supabase
    .from('betting_markets')
    .select('*', { count: 'exact', head: true });

  console.log(`\n✅ Total markets: ${count}`);
}

main().catch(console.error);

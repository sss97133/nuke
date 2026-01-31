#!/usr/bin/env npx tsx
/**
 * Auto-create betting markets from extracted Kissimmee 2026 vehicles
 * Runs periodically to create markets for newly extracted lots
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const AUCTION_NAME = 'Kissimmee 2026';
const AUCTION_START = new Date('2026-01-06T10:00:00-05:00'); // Auction starts Jan 6
const AUCTION_END = new Date('2026-01-18T18:00:00-05:00');   // Ends Jan 18

// Estimate values based on make/model patterns
const VALUE_ESTIMATES: Record<string, { low: number; high: number }> = {
  'ferrari': { low: 150000, high: 500000 },
  'lamborghini': { low: 150000, high: 400000 },
  'porsche 911': { low: 60000, high: 200000 },
  'porsche': { low: 40000, high: 150000 },
  'corvette': { low: 30000, high: 120000 },
  'mustang boss': { low: 80000, high: 250000 },
  'mustang shelby': { low: 100000, high: 300000 },
  'mustang': { low: 25000, high: 80000 },
  'camaro z28': { low: 40000, high: 120000 },
  'camaro zl1': { low: 400000, high: 800000 },
  'camaro': { low: 25000, high: 70000 },
  'cuda': { low: 60000, high: 200000 },
  'hemi cuda': { low: 500000, high: 2000000 },
  'challenger': { low: 40000, high: 120000 },
  'charger': { low: 35000, high: 100000 },
  'gto': { low: 40000, high: 100000 },
  'chevelle ss': { low: 45000, high: 120000 },
  'gt40': { low: 2000000, high: 5000000 },
  'ford gt': { low: 300000, high: 600000 },
  'mercedes 300sl': { low: 800000, high: 1500000 },
  'mercedes': { low: 30000, high: 100000 },
  'bmw': { low: 25000, high: 80000 },
  'aston martin': { low: 80000, high: 250000 },
  'jaguar e-type': { low: 80000, high: 200000 },
  'jaguar': { low: 30000, high: 100000 },
  'default': { low: 20000, high: 60000 },
};

function estimateValue(make: string, model: string): { low: number; high: number } {
  const combined = `${make} ${model}`.toLowerCase();

  for (const [pattern, estimate] of Object.entries(VALUE_ESTIMATES)) {
    if (pattern !== 'default' && combined.includes(pattern)) {
      return estimate;
    }
  }

  return VALUE_ESTIMATES['default'];
}

function calculateLine(low: number, high: number): number {
  const mid = (low + high) / 2;
  // Round to nearest $5k for cleaner lines
  return Math.round(mid / 5000) * 5000;
}

async function getVehiclesWithoutMarkets() {
  // Get Kissimmee 2026 vehicles that don't have betting markets yet
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select(`
      id, year, make, model, vin,
      auction_events!inner(id, lot_number, raw_data)
    `)
    .eq('status', 'active')
    .eq('discovery_source', 'mecum')
    .not('year', 'is', null)
    .not('make', 'is', null);

  if (error) {
    console.error('Error fetching vehicles:', error);
    return [];
  }

  // Filter to Kissimmee 2026
  const k26Vehicles = vehicles?.filter((v: any) => {
    const auctionName = v.auction_events?.[0]?.raw_data?.auction_name;
    return auctionName?.includes('Kissimmee') && auctionName?.includes('2026');
  }) || [];

  // Get existing market vehicle IDs
  const { data: existingMarkets } = await supabase
    .from('betting_markets')
    .select('vehicle_id')
    .not('vehicle_id', 'is', null);

  const existingVehicleIds = new Set(existingMarkets?.map(m => m.vehicle_id) || []);

  // Return vehicles without markets
  return k26Vehicles.filter((v: any) => !existingVehicleIds.has(v.id));
}

async function createMarketForVehicle(vehicle: any) {
  const { year, make, model, id: vehicleId } = vehicle;
  const lotNumber = vehicle.auction_events?.[0]?.lot_number || 'TBD';

  const estimate = estimateValue(make, model);
  const line = calculateLine(estimate.low, estimate.high);

  // Lock time: spread across auction days based on lot number
  // Lots run roughly in order, so higher lot numbers = later in auction
  const lotNum = parseInt(lotNumber.replace(/\D/g, '')) || 0;
  const dayOffset = Math.floor((lotNum % 1000) / 80); // ~80 lots per day
  const lockDate = new Date(AUCTION_START);
  lockDate.setDate(lockDate.getDate() + Math.min(dayOffset, 12));
  lockDate.setHours(9 + Math.floor(Math.random() * 8)); // Random hour 9am-5pm

  const title = `${year} ${make} ${model} - Over/Under $${(line / 1000).toFixed(0)}k`;

  const { data: market, error } = await supabase
    .from('betting_markets')
    .insert({
      market_type: 'auction_over_under',
      title: title.slice(0, 100),
      description: `Lot ${lotNumber}: Will this ${year} ${make} ${model} sell for over $${line.toLocaleString()} at Mecum Kissimmee 2026?`,
      vehicle_id: vehicleId,
      line_value: line,
      line_description: `Over $${(line / 1000).toFixed(0)}k`,
      status: 'open',
      locks_at: lockDate.toISOString(),
      min_bet: 100,
      max_bet: 50000,
      rake_percent: 5,
    })
    .select()
    .single();

  if (error) {
    console.error(`Failed to create market for ${title}:`, error.message);
    return null;
  }

  return market;
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Auto-Create Betting Markets');
  console.log('  Kissimmee 2026');
  console.log('═══════════════════════════════════════════════\n');

  const runOnce = process.argv.includes('--once');
  const interval = 60000; // Check every minute

  while (true) {
    const vehicles = await getVehiclesWithoutMarkets();

    if (vehicles.length === 0) {
      console.log(`[${new Date().toISOString().slice(11, 19)}] No new vehicles to create markets for`);
    } else {
      console.log(`[${new Date().toISOString().slice(11, 19)}] Found ${vehicles.length} vehicles without markets`);

      let created = 0;
      for (const vehicle of vehicles.slice(0, 50)) { // Create up to 50 at a time
        const market = await createMarketForVehicle(vehicle);
        if (market) {
          created++;
          console.log(`  ✓ ${market.title.slice(0, 60)}`);
        }
      }

      console.log(`  Created ${created} markets`);
    }

    if (runOnce) break;

    // Get stats
    const { count: totalMarkets } = await supabase
      .from('betting_markets')
      .select('*', { count: 'exact', head: true });

    const { count: openMarkets } = await supabase
      .from('betting_markets')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'open');

    console.log(`  Total markets: ${totalMarkets} | Open: ${openMarkets}`);
    console.log(`  Next check in ${interval / 1000}s...\n`);

    await new Promise(r => setTimeout(r, interval));
  }
}

main().catch(console.error);

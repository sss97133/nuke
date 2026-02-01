#!/usr/bin/env npx tsx
/**
 * Mecum Live Auction Betting
 *
 * Creates betting markets on Mecum auctions as they happen.
 * Users bet on: Will this car sell? Over/under on price?
 *
 * Flow:
 * 1. Scrape/monitor Mecum schedule
 * 2. Create markets for upcoming lots
 * 3. Lock bets when bidding starts
 * 4. Settle when hammer falls
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface MecumLot {
  lot_number: string;
  year: number;
  make: string;
  model: string;
  estimate_low?: number;
  estimate_high?: number;
  scheduled_time?: Date;
  auction_event: string; // e.g., "Kissimmee 2026"
}

// ============ MARKET CREATION ============

async function createAuctionMarket(lot: MecumLot) {
  // Create over/under market based on estimate
  const estimate = lot.estimate_low && lot.estimate_high
    ? (lot.estimate_low + lot.estimate_high) / 2
    : null;

  const line = estimate
    ? Math.round(estimate / 5000) * 5000 // Round to nearest $5k
    : 50000; // Default line

  const title = `${lot.year} ${lot.make} ${lot.model} - Over/Under $${(line / 1000).toFixed(0)}k`;

  // Lock 5 minutes before scheduled (or when bidding starts)
  const locksAt = lot.scheduled_time
    ? new Date(lot.scheduled_time.getTime() - 5 * 60 * 1000)
    : new Date(Date.now() + 60 * 60 * 1000); // Default 1hr

  const { data: market, error } = await supabase
    .from('betting_markets')
    .insert({
      market_type: 'auction_over_under',
      title,
      description: `Will Lot ${lot.lot_number} (${lot.year} ${lot.make} ${lot.model}) sell for over $${line.toLocaleString()} at Mecum ${lot.auction_event}?`,
      line_value: line,
      line_description: `Over $${(line / 1000).toFixed(0)}k`,
      status: 'open',
      locks_at: locksAt.toISOString(),
      min_bet: 100, // $1 min
      max_bet: 5000, // $50 max for now
      rake_percent: 5,
    })
    .select()
    .single();

  if (error) {
    console.error('Failed to create market:', error);
    return null;
  }

  console.log(`Created market: ${title}`);
  console.log(`  Line: $${line.toLocaleString()}`);
  console.log(`  Locks at: ${locksAt.toISOString()}`);

  return market;
}

async function createWillSellMarket(lot: MecumLot) {
  // Simple yes/no: Will this car sell?
  const title = `Will ${lot.year} ${lot.make} ${lot.model} sell at Mecum?`;

  const locksAt = lot.scheduled_time
    ? new Date(lot.scheduled_time.getTime() - 5 * 60 * 1000)
    : new Date(Date.now() + 60 * 60 * 1000);

  const { data: market, error } = await supabase
    .from('betting_markets')
    .insert({
      market_type: 'auction_will_sell',
      title,
      description: `Will Lot ${lot.lot_number} find a buyer and sell at Mecum ${lot.auction_event}? No Sale = NO.`,
      line_value: null,
      line_description: 'Sells vs No Sale',
      status: 'open',
      locks_at: locksAt.toISOString(),
      min_bet: 100,
      max_bet: 5000,
      rake_percent: 5,
    })
    .select()
    .single();

  if (error) {
    console.error('Failed to create market:', error);
    return null;
  }

  console.log(`Created market: ${title}`);
  return market;
}

// ============ SETTLEMENT ============

async function settleAuctionMarket(marketId: string, soldPrice: number | null) {
  // Get market
  const { data: market } = await supabase
    .from('betting_markets')
    .select('*')
    .eq('id', marketId)
    .single();

  if (!market) {
    console.error('Market not found');
    return;
  }

  let outcome: string;
  let resolutionValue: number | null = soldPrice;

  if (market.market_type === 'auction_over_under') {
    if (soldPrice === null) {
      // No sale - typically resolves as NO (under)
      outcome = 'no';
      resolutionValue = 0;
    } else {
      outcome = soldPrice > market.line_value ? 'yes' : 'no';
    }
  } else if (market.market_type === 'auction_will_sell') {
    outcome = soldPrice !== null ? 'yes' : 'no';
  } else {
    console.error('Unknown market type');
    return;
  }

  // Call settle function
  const { data, error } = await supabase.rpc('settle_market', {
    p_market_id: marketId,
    p_outcome: outcome,
    p_resolution_value: resolutionValue,
  });

  if (error) {
    console.error('Settlement failed:', error);
    return;
  }

  console.log(`Settled market ${marketId}:`, data);
}

// ============ DEMO: CREATE SAMPLE MARKETS ============

async function createDemoMarkets() {
  console.log('=== CREATING DEMO MECUM BETTING MARKETS ===\n');

  // Simulated Mecum lots (in production, scrape from mecum.com)
  const sampleLots: MecumLot[] = [
    {
      lot_number: 'S123',
      year: 1967,
      make: 'Chevrolet',
      model: 'Corvette 427',
      estimate_low: 80000,
      estimate_high: 100000,
      auction_event: 'Kissimmee 2026',
      scheduled_time: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours
    },
    {
      lot_number: 'F456',
      year: 1970,
      make: 'Plymouth',
      model: 'Cuda 440',
      estimate_low: 65000,
      estimate_high: 85000,
      auction_event: 'Kissimmee 2026',
      scheduled_time: new Date(Date.now() + 3 * 60 * 60 * 1000),
    },
    {
      lot_number: 'S789',
      year: 1969,
      make: 'Ford',
      model: 'Mustang Boss 429',
      estimate_low: 200000,
      estimate_high: 250000,
      auction_event: 'Kissimmee 2026',
      scheduled_time: new Date(Date.now() + 4 * 60 * 60 * 1000),
    },
    {
      lot_number: 'T101',
      year: 2005,
      make: 'Ford',
      model: 'GT',
      estimate_low: 350000,
      estimate_high: 400000,
      auction_event: 'Kissimmee 2026',
      scheduled_time: new Date(Date.now() + 5 * 60 * 60 * 1000),
    },
  ];

  for (const lot of sampleLots) {
    console.log(`\n--- Lot ${lot.lot_number}: ${lot.year} ${lot.make} ${lot.model} ---`);

    // Create over/under market
    await createAuctionMarket(lot);

    // Create will-sell market
    await createWillSellMarket(lot);
  }

  console.log('\n=== MARKETS CREATED ===');
  console.log('Users can now bet on these auctions!');
}

// ============ VIEW MARKETS ============

async function viewOpenMarkets() {
  const { data: markets } = await supabase
    .from('betting_markets')
    .select('*')
    .eq('status', 'open')
    .order('locks_at', { ascending: true });

  console.log('\n=== OPEN BETTING MARKETS ===\n');

  if (!markets?.length) {
    console.log('No open markets');
    return;
  }

  for (const m of markets) {
    const totalPool = (m.total_yes_amount || 0) + (m.total_no_amount || 0);
    const yesOdds = totalPool > 0
      ? ((m.total_yes_amount || 0) / totalPool * 100).toFixed(0)
      : '50';

    console.log(`${m.title}`);
    console.log(`  Type: ${m.market_type}`);
    console.log(`  Pool: $${(totalPool / 100).toFixed(2)} (${m.total_bettors || 0} bettors)`);
    console.log(`  Implied YES: ${yesOdds}%`);
    console.log(`  Locks: ${new Date(m.locks_at).toLocaleString()}`);
    console.log();
  }
}

// ============ MAIN ============

async function main() {
  const command = process.argv[2] || 'demo';

  switch (command) {
    case 'demo':
      await createDemoMarkets();
      break;
    case 'view':
      await viewOpenMarkets();
      break;
    case 'settle':
      const marketId = process.argv[3];
      const price = process.argv[4] ? parseFloat(process.argv[4]) : null;
      if (!marketId) {
        console.log('Usage: mecum-live-betting.ts settle <market_id> [sold_price]');
        return;
      }
      await settleAuctionMarket(marketId, price);
      break;
    default:
      console.log('Commands: demo, view, settle');
  }
}

main().catch(console.error);

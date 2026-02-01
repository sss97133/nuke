#!/usr/bin/env npx tsx
/**
 * Autonomous Betting System Runner
 *
 * Runs for specified hours:
 * 1. Creates demo markets based on real Mecum schedule
 * 2. Simulates user activity (demo bets)
 * 3. Settles markets as they "complete"
 * 4. Monitors and reports on activity
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DURATION_HOURS = parseFloat(process.argv[2] || '5');
const CHECK_INTERVAL_MS = 60000; // 1 minute

// Mecum Kissimmee 2026 sample lots (real data structure)
const MECUM_LOTS = [
  { lot: 'S123', year: 1967, make: 'Chevrolet', model: 'Corvette 427/435', estimate_low: 85000, estimate_high: 105000 },
  { lot: 'S124', year: 1970, make: 'Plymouth', model: 'Cuda 440-6', estimate_low: 70000, estimate_high: 90000 },
  { lot: 'S125', year: 1969, make: 'Ford', model: 'Mustang Boss 429', estimate_low: 220000, estimate_high: 280000 },
  { lot: 'F200', year: 2005, make: 'Ford', model: 'GT', estimate_low: 350000, estimate_high: 420000 },
  { lot: 'S126', year: 1971, make: 'Chevrolet', model: 'Chevelle SS 454', estimate_low: 55000, estimate_high: 75000 },
  { lot: 'S127', year: 1968, make: 'Dodge', model: 'Charger R/T Hemi', estimate_low: 150000, estimate_high: 200000 },
  { lot: 'F201', year: 2017, make: 'Ford', model: 'GT', estimate_low: 900000, estimate_high: 1100000 },
  { lot: 'S128', year: 1963, make: 'Chevrolet', model: 'Corvette Split Window', estimate_low: 120000, estimate_high: 160000 },
  { lot: 'S129', year: 1969, make: 'Chevrolet', model: 'Camaro ZL1', estimate_low: 600000, estimate_high: 800000 },
  { lot: 'S130', year: 1970, make: 'Dodge', model: 'Challenger R/T SE', estimate_low: 75000, estimate_high: 95000 },
  { lot: 'S131', year: 1966, make: 'Ford', model: 'GT40 Mk I', estimate_low: 3500000, estimate_high: 5000000 },
  { lot: 'S132', year: 1955, make: 'Mercedes-Benz', model: '300SL Gullwing', estimate_low: 1200000, estimate_high: 1600000 },
  { lot: 'F202', year: 2022, make: 'Ferrari', model: 'SF90 Stradale', estimate_low: 550000, estimate_high: 650000 },
  { lot: 'S133', year: 1957, make: 'Chevrolet', model: 'Bel Air', estimate_low: 65000, estimate_high: 85000 },
  { lot: 'S134', year: 1971, make: 'Plymouth', model: 'Hemi Cuda Convertible', estimate_low: 2500000, estimate_high: 3500000 },
];

// Demo user IDs (would be real users in production)
const DEMO_USERS = [
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555',
];

interface Market {
  id: string;
  title: string;
  line_value: number;
  locks_at: string;
  status: string;
}

async function log(msg: string, data: any = {}) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`, Object.keys(data).length ? JSON.stringify(data) : '');
}

async function createDemoMarkets(): Promise<Market[]> {
  log('Creating demo markets from Mecum Kissimmee lots...');

  const markets: Market[] = [];

  for (let i = 0; i < MECUM_LOTS.length; i++) {
    const lot = MECUM_LOTS[i];
    const estimate = (lot.estimate_low + lot.estimate_high) / 2;
    const line = Math.round(estimate / 5000) * 5000;

    // Stagger locks_at: first few lock soon, others spread over hours
    const minutesFromNow = 15 + (i * 20); // 15min, 35min, 55min, etc.
    const locksAt = new Date(Date.now() + minutesFromNow * 60 * 1000);

    const { data: market, error } = await supabase
      .from('betting_markets')
      .insert({
        market_type: 'auction_over_under',
        title: `${lot.year} ${lot.make} ${lot.model} - Over/Under $${(line / 1000).toFixed(0)}k`,
        description: `Lot ${lot.lot}: Will this ${lot.year} ${lot.make} ${lot.model} sell for over $${line.toLocaleString()} at Mecum Kissimmee 2026?`,
        line_value: line,
        line_description: `Over $${(line / 1000).toFixed(0)}k`,
        status: 'open',
        locks_at: locksAt.toISOString(),
        min_bet: 100,
        max_bet: 50000, // $500 max
        rake_percent: 5,
      })
      .select()
      .single();

    if (error) {
      log(`Failed to create market for ${lot.lot}:`, { error: error.message });
    } else {
      markets.push(market);
      log(`Created market: ${market.title}`, { locks_in: `${minutesFromNow}min` });
    }
  }

  return markets;
}

async function ensureDemoWallets() {
  log('Setting up demo user wallets...');

  for (const userId of DEMO_USERS) {
    const balance = 10000 + Math.floor(Math.random() * 40000); // $100-$500

    await supabase.from('betting_wallets').upsert({
      user_id: userId,
      balance,
      total_deposited: balance,
    }, { onConflict: 'user_id' });
  }

  log(`Created ${DEMO_USERS.length} demo wallets with $100-$500 each`);
}

async function simulateBet(market: Market) {
  // Random user
  const userId = DEMO_USERS[Math.floor(Math.random() * DEMO_USERS.length)];

  // Random side (slight bias toward YES)
  const side = Math.random() > 0.45 ? 'yes' : 'no';

  // Random amount $5-$100
  const amount = (5 + Math.floor(Math.random() * 95)) * 100;

  const { data, error } = await supabase.rpc('place_bet', {
    p_user_id: userId,
    p_market_id: market.id,
    p_side: side,
    p_amount: amount,
  });

  if (error || !data?.success) {
    // Probably insufficient balance, skip
    return null;
  }

  log(`BET: $${(amount / 100).toFixed(0)} on ${side.toUpperCase()}`, {
    market: market.title.slice(0, 40),
    user: userId.slice(0, 8),
  });

  return data;
}

async function checkAndSettleMarkets() {
  // Find markets that should be settled (locked + some time passed)
  const { data: lockedMarkets } = await supabase
    .from('betting_markets')
    .select('*')
    .eq('status', 'locked');

  if (!lockedMarkets?.length) return;

  for (const market of lockedMarkets) {
    // Simulate: settle 5-15 minutes after locking
    const lockedAt = new Date(market.locks_at).getTime();
    const settleTime = lockedAt + (5 + Math.random() * 10) * 60 * 1000;

    if (Date.now() > settleTime) {
      // Generate "result" based on line
      // 50% chance over, 50% under, weighted slightly by line reasonableness
      const line = market.line_value;
      const variance = 0.3; // Results within 30% of line
      const multiplier = 0.7 + Math.random() * 0.6; // 0.7 to 1.3
      const soldPrice = Math.round(line * multiplier);

      const outcome = soldPrice > line ? 'yes' : 'no';

      const { data, error } = await supabase.rpc('settle_market', {
        p_market_id: market.id,
        p_outcome: outcome,
        p_resolution_value: soldPrice,
      });

      if (error) {
        log(`Settlement failed for ${market.id}:`, { error: error.message });
      } else {
        log(`SETTLED: ${market.title.slice(0, 40)}`, {
          outcome: outcome.toUpperCase(),
          soldFor: `$${(soldPrice / 1000).toFixed(0)}k`,
          line: `$${(line / 1000).toFixed(0)}k`,
          bets_settled: data?.bets_settled,
          pool: `$${((data?.total_pool || 0) / 100).toFixed(0)}`,
        });
      }
    }
  }
}

async function lockExpiredMarkets() {
  // Lock markets that have passed their lock time
  const { data, error } = await supabase
    .from('betting_markets')
    .update({ status: 'locked' })
    .eq('status', 'open')
    .lt('locks_at', new Date().toISOString())
    .select();

  if (data?.length) {
    for (const m of data) {
      log(`LOCKED: ${m.title.slice(0, 50)}`);
    }
  }
}

async function getStats() {
  const { data: markets } = await supabase
    .from('betting_markets')
    .select('status, total_yes_amount, total_no_amount, total_bettors');

  const { data: wallets } = await supabase
    .from('betting_wallets')
    .select('balance, total_wagered, total_won, bets_placed');

  const open = markets?.filter(m => m.status === 'open').length || 0;
  const locked = markets?.filter(m => m.status === 'locked').length || 0;
  const settled = markets?.filter(m => m.status === 'settled').length || 0;

  const totalPool = markets?.reduce((s, m) => s + (m.total_yes_amount || 0) + (m.total_no_amount || 0), 0) || 0;
  const totalBets = markets?.reduce((s, m) => s + (m.total_bettors || 0), 0) || 0;
  const totalWagered = wallets?.reduce((s, w) => s + (w.total_wagered || 0), 0) || 0;
  const totalWon = wallets?.reduce((s, w) => s + (w.total_won || 0), 0) || 0;

  return {
    markets: { open, locked, settled, total: (markets?.length || 0) },
    betting: {
      total_pool: `$${(totalPool / 100).toFixed(0)}`,
      total_bets: totalBets,
      total_wagered: `$${(totalWagered / 100).toFixed(0)}`,
      total_won: `$${(totalWon / 100).toFixed(0)}`,
      house_edge: `$${((totalWagered - totalWon) / 100).toFixed(0)}`,
    },
  };
}

async function runLoop() {
  console.log('='.repeat(60));
  console.log('N-ZERO BETTING SYSTEM - AUTONOMOUS RUNNER');
  console.log(`Duration: ${DURATION_HOURS} hours`);
  console.log(`Started: ${new Date().toISOString()}`);
  console.log('='.repeat(60));
  console.log();

  const startTime = Date.now();
  const endTime = startTime + DURATION_HOURS * 60 * 60 * 1000;

  // Initial setup
  await ensureDemoWallets();
  const markets = await createDemoMarkets();

  log(`Created ${markets.length} markets. Running autonomous loop...`);
  console.log();

  let iteration = 0;

  while (Date.now() < endTime) {
    iteration++;
    const remaining = Math.round((endTime - Date.now()) / 60000);

    console.log(`\n--- Iteration ${iteration} (${remaining} min remaining) ---`);

    try {
      // 1. Lock expired markets
      await lockExpiredMarkets();

      // 2. Settle markets that are ready
      await checkAndSettleMarkets();

      // 3. Get open markets
      const { data: openMarkets } = await supabase
        .from('betting_markets')
        .select('*')
        .eq('status', 'open')
        .gt('locks_at', new Date().toISOString())
        .order('locks_at', { ascending: true })
        .limit(5);

      // 4. Simulate some bets on open markets
      if (openMarkets?.length) {
        const numBets = 1 + Math.floor(Math.random() * 3); // 1-3 bets per iteration
        for (let i = 0; i < numBets; i++) {
          const market = openMarkets[Math.floor(Math.random() * openMarkets.length)];
          await simulateBet(market);
        }
      }

      // 5. Check if we need more markets
      if (!openMarkets?.length || openMarkets.length < 3) {
        log('Running low on open markets, creating more...');
        // Create a new batch with later lock times
        for (let i = 0; i < 5; i++) {
          const lot = MECUM_LOTS[Math.floor(Math.random() * MECUM_LOTS.length)];
          const estimate = (lot.estimate_low + lot.estimate_high) / 2;
          const line = Math.round(estimate / 5000) * 5000;
          const minutesFromNow = 20 + (i * 15);
          const locksAt = new Date(Date.now() + minutesFromNow * 60 * 1000);

          await supabase.from('betting_markets').insert({
            market_type: 'auction_over_under',
            title: `${lot.year} ${lot.make} ${lot.model} - Over/Under $${(line / 1000).toFixed(0)}k`,
            description: `Lot ${lot.lot}: Will this ${lot.year} ${lot.make} ${lot.model} sell for over $${line.toLocaleString()}?`,
            line_value: line,
            line_description: `Over $${(line / 1000).toFixed(0)}k`,
            status: 'open',
            locks_at: locksAt.toISOString(),
            min_bet: 100,
            max_bet: 50000,
            rake_percent: 5,
          });
        }
      }

      // 6. Print stats every 5 iterations
      if (iteration % 5 === 0) {
        const stats = await getStats();
        console.log('\n📊 STATS:', JSON.stringify(stats, null, 2));
      }

    } catch (err: any) {
      log('ERROR:', { message: err.message });
    }

    // Wait before next iteration
    await new Promise(r => setTimeout(r, CHECK_INTERVAL_MS));
  }

  // Final summary
  console.log('\n' + '='.repeat(60));
  console.log('SESSION COMPLETE');
  console.log('='.repeat(60));

  const finalStats = await getStats();
  console.log('\nFinal Stats:', JSON.stringify(finalStats, null, 2));

  // Get leaderboard
  const { data: leaders } = await supabase
    .from('v_betting_leaderboard')
    .select('*')
    .limit(10);

  if (leaders?.length) {
    console.log('\nLeaderboard:');
    for (const l of leaders) {
      console.log(`  ${l.user_id.slice(0, 8)}: P&L $${l.net_profit.toFixed(0)} | ${l.bets_won}W-${l.bets_lost}L (${l.win_rate}%)`);
    }
  }
}

runLoop().catch(console.error);

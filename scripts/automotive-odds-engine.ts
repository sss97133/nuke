#!/usr/bin/env npx tsx
/**
 * Automotive Odds Engine
 *
 * Uses n-zero's vehicle database to:
 * 1. Calculate fair odds on automotive outcomes
 * 2. Generate prediction markets we can offer
 * 3. Identify mispriced external markets
 *
 * We have the data. We set the lines.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface Market {
  id: string;
  title: string;
  description: string;
  fair_odds_yes: number; // 0-100
  confidence: number;    // How confident in our odds
  closes_at: string;
  source_data: object;
}

// ============ DATA QUERIES ============

async function getBaTWeeklyStats() {
  // Get BaT sales by week for the last 12 weeks
  const { data } = await supabase
    .from('vehicles')
    .select('sale_price, sold_at')
    .ilike('source_url', '%bringatrailer%')
    .not('sale_price', 'is', null)
    .gte('sold_at', new Date(Date.now() - 84 * 24 * 60 * 60 * 1000).toISOString())
    .order('sold_at', { ascending: false });

  if (!data?.length) return null;

  // Group by week
  const byWeek: Record<string, { count: number; gross: number; max: number }> = {};
  for (const v of data) {
    const week = getWeekKey(new Date(v.sold_at));
    if (!byWeek[week]) byWeek[week] = { count: 0, gross: 0, max: 0 };
    byWeek[week].count++;
    byWeek[week].gross += v.sale_price;
    byWeek[week].max = Math.max(byWeek[week].max, v.sale_price);
  }

  return Object.entries(byWeek)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([week, stats]) => ({ week, ...stats }));
}

async function getTodayLiveAuctions() {
  // Get auctions ending today
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data } = await supabase
    .from('vehicles')
    .select('id, year, make, model, current_bid, sale_price, auction_end_time, source_url')
    .gte('auction_end_time', today)
    .lt('auction_end_time', tomorrow)
    .order('auction_end_time', { ascending: true });

  return data || [];
}

async function getHistoricalPriceRange(make: string, model?: string, yearRange?: [number, number]) {
  let query = supabase
    .from('vehicles')
    .select('sale_price, year, make, model')
    .ilike('make', `%${make}%`)
    .not('sale_price', 'is', null);

  if (model) query = query.ilike('model', `%${model}%`);
  if (yearRange) query = query.gte('year', yearRange[0]).lte('year', yearRange[1]);

  const { data } = await query.limit(500);

  if (!data?.length) return null;

  const prices = data.map(v => v.sale_price).sort((a, b) => a - b);
  return {
    count: prices.length,
    min: prices[0],
    max: prices[prices.length - 1],
    median: prices[Math.floor(prices.length / 2)],
    avg: prices.reduce((a, b) => a + b, 0) / prices.length,
    p25: prices[Math.floor(prices.length * 0.25)],
    p75: prices[Math.floor(prices.length * 0.75)],
    p90: prices[Math.floor(prices.length * 0.90)],
  };
}

async function getHighValueAuctionFrequency(threshold: number) {
  // How often do auctions break a certain threshold?
  const { data: total } = await supabase
    .from('vehicles')
    .select('id', { count: 'exact' })
    .not('sale_price', 'is', null)
    .gte('sold_at', new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString());

  const { data: above } = await supabase
    .from('vehicles')
    .select('id', { count: 'exact' })
    .gte('sale_price', threshold)
    .gte('sold_at', new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString());

  const totalCount = (total as any)?.length || 1;
  const aboveCount = (above as any)?.length || 0;

  return {
    threshold,
    total_auctions: totalCount,
    above_threshold: aboveCount,
    probability: aboveCount / totalCount,
  };
}

// ============ MARKET GENERATORS ============

async function generateWeeklyGrossMarket(): Promise<Market | null> {
  const stats = await getBaTWeeklyStats();
  if (!stats?.length) return null;

  // Calculate stats from historical weeks
  const grosses = stats.map(w => w.gross);
  const avgGross = grosses.reduce((a, b) => a + b, 0) / grosses.length;
  const stdDev = Math.sqrt(grosses.reduce((a, b) => a + Math.pow(b - avgGross, 2), 0) / grosses.length);

  // Set line at average + 0.5 std dev (should hit ~31% of time historically)
  const line = Math.round((avgGross + stdDev * 0.5) / 100000) * 100000; // Round to nearest 100k

  // Calculate historical probability of exceeding line
  const timesExceeded = grosses.filter(g => g > line).length;
  const historicalProb = timesExceeded / grosses.length;

  // Fair odds = historical probability (we'll add juice later)
  const fairOddsYes = Math.round(historicalProb * 100);

  // End of current week
  const endOfWeek = getEndOfWeek();

  return {
    id: `bat-weekly-gross-${endOfWeek.toISOString().slice(0, 10)}`,
    title: `Will BaT gross over $${(line / 1000000).toFixed(1)}M this week?`,
    description: `Based on ${stats.length} weeks of data. Avg weekly gross: $${(avgGross / 1000000).toFixed(2)}M`,
    fair_odds_yes: fairOddsYes,
    confidence: stats.length > 8 ? 0.85 : 0.65,
    closes_at: endOfWeek.toISOString(),
    source_data: {
      historical_weeks: stats.length,
      avg_gross: avgGross,
      std_dev: stdDev,
      line,
      times_exceeded: timesExceeded,
    },
  };
}

async function generateDailyHighMarket(): Promise<Market | null> {
  const stats = await getBaTWeeklyStats();
  if (!stats?.length) return null;

  // Look at daily max prices
  const { data: recentMaxes } = await supabase
    .from('vehicles')
    .select('sale_price, sold_at')
    .not('sale_price', 'is', null)
    .gte('sold_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    .order('sale_price', { ascending: false })
    .limit(100);

  if (!recentMaxes?.length) return null;

  // Group by day to find daily maxes
  const byDay: Record<string, number> = {};
  for (const v of recentMaxes) {
    const day = v.sold_at.slice(0, 10);
    byDay[day] = Math.max(byDay[day] || 0, v.sale_price);
  }

  const dailyMaxes = Object.values(byDay);
  const avgDailyMax = dailyMaxes.reduce((a, b) => a + b, 0) / dailyMaxes.length;

  // Set line at a round number above average daily max
  const line = Math.ceil(avgDailyMax / 50000) * 50000;

  const timesExceeded = dailyMaxes.filter(m => m > line).length;
  const historicalProb = timesExceeded / dailyMaxes.length;

  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  return {
    id: `bat-daily-high-${new Date().toISOString().slice(0, 10)}`,
    title: `Will any BaT auction exceed $${(line / 1000).toFixed(0)}k today?`,
    description: `Based on ${dailyMaxes.length} days of data. Avg daily high: $${(avgDailyMax / 1000).toFixed(0)}k`,
    fair_odds_yes: Math.round(historicalProb * 100),
    confidence: dailyMaxes.length > 20 ? 0.8 : 0.6,
    closes_at: endOfDay.toISOString(),
    source_data: {
      days_analyzed: dailyMaxes.length,
      avg_daily_max: avgDailyMax,
      line,
      times_exceeded: timesExceeded,
    },
  };
}

async function generateMakeVolumeMarket(make: string): Promise<Market | null> {
  // Will [MAKE] have more than X sales this week?
  const { data } = await supabase
    .from('vehicles')
    .select('sold_at')
    .ilike('make', `%${make}%`)
    .not('sale_price', 'is', null)
    .gte('sold_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString());

  if (!data?.length) return null;

  // Group by week
  const byWeek: Record<string, number> = {};
  for (const v of data) {
    const week = getWeekKey(new Date(v.sold_at));
    byWeek[week] = (byWeek[week] || 0) + 1;
  }

  const weeklyCounts = Object.values(byWeek);
  const avgWeekly = weeklyCounts.reduce((a, b) => a + b, 0) / weeklyCounts.length;

  const line = Math.round(avgWeekly);
  const timesExceeded = weeklyCounts.filter(c => c > line).length;
  const historicalProb = timesExceeded / weeklyCounts.length;

  const endOfWeek = getEndOfWeek();

  return {
    id: `${make.toLowerCase()}-weekly-volume-${endOfWeek.toISOString().slice(0, 10)}`,
    title: `Will ${make} have more than ${line} sales this week?`,
    description: `Based on ${weeklyCounts.length} weeks. Avg: ${avgWeekly.toFixed(1)}/week`,
    fair_odds_yes: Math.round(historicalProb * 100),
    confidence: weeklyCounts.length > 10 ? 0.8 : 0.6,
    closes_at: endOfWeek.toISOString(),
    source_data: {
      weeks_analyzed: weeklyCounts.length,
      avg_weekly: avgWeekly,
      line,
    },
  };
}

async function generateSpecificAuctionMarket(vehicleId: string): Promise<Market | null> {
  // Get the vehicle
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', vehicleId)
    .single();

  if (!vehicle) return null;

  // Get comparable sales
  const priceStats = await getHistoricalPriceRange(
    vehicle.make,
    vehicle.model,
    [vehicle.year - 3, vehicle.year + 3]
  );

  if (!priceStats) return null;

  // Set line at median
  const line = priceStats.median;

  // Historical probability of exceeding median = 50% by definition, but adjust based on:
  // - Comment count (more comments = more interest = higher price)
  // - Days until close (less time = more certainty)

  let adjustedProb = 0.5;

  // Get comment count for this listing
  const { data: listing } = await supabase
    .from('bat_listings')
    .select('comment_count')
    .eq('vehicle_id', vehicleId)
    .single();

  if (listing?.comment_count) {
    // High comments = higher probability of exceeding median
    if (listing.comment_count > 100) adjustedProb += 0.1;
    if (listing.comment_count > 200) adjustedProb += 0.1;
    if (listing.comment_count > 500) adjustedProb += 0.1;
  }

  return {
    id: `auction-${vehicleId}`,
    title: `Will ${vehicle.year} ${vehicle.make} ${vehicle.model} sell over $${(line / 1000).toFixed(0)}k?`,
    description: `Comparable range: $${(priceStats.p25 / 1000).toFixed(0)}k - $${(priceStats.p75 / 1000).toFixed(0)}k (${priceStats.count} comps)`,
    fair_odds_yes: Math.round(Math.min(0.85, Math.max(0.15, adjustedProb)) * 100),
    confidence: priceStats.count > 20 ? 0.85 : 0.6,
    closes_at: vehicle.auction_end_time || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    source_data: {
      vehicle_id: vehicleId,
      comparables: priceStats.count,
      line,
      price_range: priceStats,
      comment_count: listing?.comment_count,
    },
  };
}

// ============ UTILS ============

function getWeekKey(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay()); // Start of week (Sunday)
  return d.toISOString().slice(0, 10);
}

function getEndOfWeek(): Date {
  const d = new Date();
  d.setDate(d.getDate() + (6 - d.getDay())); // Saturday
  d.setHours(23, 59, 59, 999);
  return d;
}

function oddsToDecimal(prob: number): number {
  // Convert probability to decimal odds
  // prob 0.5 = 2.0 decimal odds
  return 1 / prob;
}

function addJuice(fairOdds: number, juice: number = 0.05): { yes: number; no: number } {
  // Add house edge (juice/vig)
  // If fair odds are 50/50, with 5% juice we'd offer 47.5/47.5 (total 95%)
  const yesWithJuice = Math.round(fairOdds * (1 - juice));
  const noWithJuice = Math.round((100 - fairOdds) * (1 - juice));
  return { yes: yesWithJuice, no: noWithJuice };
}

// ============ MAIN ============

async function main() {
  console.log('=== AUTOMOTIVE ODDS ENGINE ===\n');
  console.log('Generating markets from n-zero data...\n');

  const markets: Market[] = [];

  // Weekly gross market
  console.log('1. Weekly Gross Market...');
  const weeklyGross = await generateWeeklyGrossMarket();
  if (weeklyGross) {
    markets.push(weeklyGross);
    console.log(`   ✓ ${weeklyGross.title}`);
    console.log(`     Fair odds: ${weeklyGross.fair_odds_yes}% YES`);
  }

  // Daily high market
  console.log('\n2. Daily High Market...');
  const dailyHigh = await generateDailyHighMarket();
  if (dailyHigh) {
    markets.push(dailyHigh);
    console.log(`   ✓ ${dailyHigh.title}`);
    console.log(`     Fair odds: ${dailyHigh.fair_odds_yes}% YES`);
  }

  // Make-specific markets
  const makes = ['Porsche', 'Ferrari', 'BMW', 'Mercedes'];
  console.log('\n3. Make Volume Markets...');
  for (const make of makes) {
    const market = await generateMakeVolumeMarket(make);
    if (market) {
      markets.push(market);
      console.log(`   ✓ ${market.title}`);
      console.log(`     Fair odds: ${market.fair_odds_yes}% YES`);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('GENERATED MARKETS WITH HOUSE EDGE (5% juice)\n');

  for (const market of markets) {
    const withJuice = addJuice(market.fair_odds_yes);
    console.log(`${market.title}`);
    console.log(`  Fair: ${market.fair_odds_yes}¢ YES / ${100 - market.fair_odds_yes}¢ NO`);
    console.log(`  Offer: ${withJuice.yes}¢ YES / ${withJuice.no}¢ NO`);
    console.log(`  Confidence: ${(market.confidence * 100).toFixed(0)}%`);
    console.log(`  Closes: ${market.closes_at.slice(0, 10)}`);
    console.log();
  }

  // Store markets
  console.log('Storing markets in database...');
  for (const market of markets) {
    await supabase.from('suggested_markets').upsert({
      id: market.id,
      title: market.title,
      description: market.description,
      category: 'automotive',
      source_type: 'odds_engine',
      source_query: market.source_data,
      confidence: market.confidence,
      expires_at: market.closes_at,
    }, { onConflict: 'id' });
  }

  console.log(`\nStored ${markets.length} markets.`);
  console.log('\n=== READY TO TAKE ACTION ===');
}

main().catch(console.error);

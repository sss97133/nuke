#!/usr/bin/env npx tsx
/**
 * Generate Bet Suggestions from Vehicle Data
 *
 * Analyzes n-zero's vehicle/auction data to propose betting markets.
 * These could be:
 * 1. Matched to existing Kalshi markets
 * 2. Proposed as new Kalshi markets
 * 3. Used for internal n-zero prediction markets
 *
 * Usage:
 *   dotenvx run -- npx tsx scripts/generate-bet-suggestions.ts
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface BetSuggestion {
  title: string;
  description: string;
  source_type: string;
  source_query: object;
  confidence: number;
  category: string;
  expires_at?: string;
}

// ============ Analysis Functions ============

/**
 * Analyze auction price trends to generate market suggestions
 */
async function analyzePriceTrends(): Promise<BetSuggestion[]> {
  const suggestions: BetSuggestion[] = [];

  // Get recent auction results by make
  const { data: recentSales } = await supabase
    .from('vehicles')
    .select('make, model, year, sale_price, sold_at')
    .not('sale_price', 'is', null)
    .gte('sold_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
    .order('sold_at', { ascending: false })
    .limit(1000);

  if (!recentSales?.length) return suggestions;

  // Group by make and calculate trends
  const byMake: Record<string, { prices: number[]; count: number }> = {};
  for (const sale of recentSales) {
    if (!sale.make || !sale.sale_price) continue;
    const make = sale.make.toUpperCase();
    if (!byMake[make]) byMake[make] = { prices: [], count: 0 };
    byMake[make].prices.push(sale.sale_price);
    byMake[make].count++;
  }

  // Find makes with significant volume
  for (const [make, data] of Object.entries(byMake)) {
    if (data.count < 10) continue; // Need sufficient data

    const avgPrice = data.prices.reduce((a, b) => a + b, 0) / data.prices.length;
    const maxPrice = Math.max(...data.prices);

    // Suggestion: Will this make break a price threshold?
    const threshold = Math.ceil(maxPrice / 100000) * 100000; // Round up to nearest 100k
    if (threshold > maxPrice) {
      suggestions.push({
        title: `Will a ${make} sell for over $${(threshold / 1000).toFixed(0)}k on BaT this quarter?`,
        description: `Based on ${data.count} recent ${make} sales with avg price $${(avgPrice / 1000).toFixed(0)}k and max $${(maxPrice / 1000).toFixed(0)}k`,
        source_type: 'price_trend',
        source_query: { make, sample_size: data.count, avg_price: avgPrice, max_price: maxPrice },
        confidence: data.count > 30 ? 0.8 : 0.6,
        category: 'automotive',
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      });
    }
  }

  return suggestions;
}

/**
 * Analyze auction volume trends
 */
async function analyzeVolumeTrends(): Promise<BetSuggestion[]> {
  const suggestions: BetSuggestion[] = [];

  // Get monthly auction counts
  const { data: monthlyData } = await supabase.rpc('get_monthly_auction_counts');

  // If we don't have the RPC, do it manually
  const { data: recentVehicles } = await supabase
    .from('vehicles')
    .select('created_at')
    .gte('created_at', new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString());

  if (recentVehicles?.length) {
    // Group by month
    const byMonth: Record<string, number> = {};
    for (const v of recentVehicles) {
      const month = v.created_at.slice(0, 7); // YYYY-MM
      byMonth[month] = (byMonth[month] || 0) + 1;
    }

    const months = Object.entries(byMonth).sort((a, b) => a[0].localeCompare(b[0]));
    if (months.length >= 3) {
      const lastMonth = months[months.length - 1][1];
      const prevMonth = months[months.length - 2][1];
      const trend = ((lastMonth - prevMonth) / prevMonth) * 100;

      // Project next month
      const projectedNextMonth = Math.round(lastMonth * (1 + trend / 100));

      suggestions.push({
        title: `Will BaT list over ${Math.round(projectedNextMonth * 1.1)} vehicles next month?`,
        description: `Last month had ${lastMonth} listings. Trend: ${trend > 0 ? '+' : ''}${trend.toFixed(1)}%`,
        source_type: 'volume_trend',
        source_query: { months_analyzed: months.length, last_month: lastMonth, trend_pct: trend },
        confidence: 0.65,
        category: 'automotive',
        expires_at: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString(),
      });
    }
  }

  return suggestions;
}

/**
 * Analyze specific vehicle categories (EV vs ICE, etc.)
 */
async function analyzeCategoryTrends(): Promise<BetSuggestion[]> {
  const suggestions: BetSuggestion[] = [];

  // EV vs ICE analysis
  const { data: evVehicles } = await supabase
    .from('vehicles')
    .select('id')
    .or('make.ilike.%tesla%,make.ilike.%rivian%,make.ilike.%lucid%,model.ilike.%electric%')
    .gte('created_at', new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString());

  const { data: totalVehicles } = await supabase
    .from('vehicles')
    .select('id', { count: 'exact' })
    .gte('created_at', new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString());

  if (evVehicles && totalVehicles) {
    const evPct = (evVehicles.length / (totalVehicles as any).length) * 100;

    suggestions.push({
      title: `Will electric vehicles exceed ${Math.ceil(evPct * 1.5)}% of collector auctions by end of year?`,
      description: `Currently at ${evPct.toFixed(1)}% of listings. Growing category.`,
      source_type: 'category_trend',
      source_query: { ev_count: evVehicles.length, total_count: (totalVehicles as any).length, current_pct: evPct },
      confidence: 0.55,
      category: 'automotive',
      expires_at: new Date(new Date().getFullYear(), 11, 31).toISOString(),
    });
  }

  return suggestions;
}

/**
 * Analyze comment sentiment for price prediction
 */
async function analyzeCommentSentiment(): Promise<BetSuggestion[]> {
  const suggestions: BetSuggestion[] = [];

  // Get vehicles with high comment counts and sentiment analysis
  const { data: hotVehicles } = await supabase
    .from('bat_listings')
    .select(`
      vehicle_id,
      comment_count,
      vehicles!inner(make, model, year, sale_price),
      comment_discoveries(overall_sentiment, sentiment_score)
    `)
    .gt('comment_count', 100)
    .is('vehicles.sale_price', null) // Still active
    .order('comment_count', { ascending: false })
    .limit(10);

  if (hotVehicles?.length) {
    for (const listing of hotVehicles) {
      const vehicle = (listing as any).vehicles;
      const discovery = (listing as any).comment_discoveries?.[0];

      if (vehicle && discovery?.sentiment_score) {
        const sentiment = discovery.sentiment_score;
        const threshold = sentiment > 0.7 ? 150000 : sentiment > 0.5 ? 100000 : 75000;

        suggestions.push({
          title: `Will the ${vehicle.year} ${vehicle.make} ${vehicle.model} sell for over $${threshold / 1000}k?`,
          description: `${listing.comment_count} comments, sentiment score: ${(sentiment * 100).toFixed(0)}%`,
          source_type: 'market_sentiment',
          source_query: {
            vehicle_id: listing.vehicle_id,
            comment_count: listing.comment_count,
            sentiment_score: sentiment,
          },
          confidence: Math.min(0.9, 0.5 + listing.comment_count / 500),
          category: 'automotive',
          expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        });
      }
    }
  }

  return suggestions;
}

/**
 * Generate suggestions that might match existing Kalshi markets
 */
async function matchToKalshiMarkets(suggestions: BetSuggestion[]): Promise<void> {
  // Fetch automotive/economic related Kalshi events
  const response = await fetch(
    'https://api.elections.kalshi.com/trade-api/v2/events?status=open&limit=100'
  );
  const { events } = await response.json();

  // Keywords to match
  const autoKeywords = ['car', 'auto', 'vehicle', 'tesla', 'ev', 'electric', 'gas', 'oil', 'fuel'];

  const relevantEvents = events.filter((e: any) =>
    autoKeywords.some(kw =>
      e.title.toLowerCase().includes(kw) ||
      e.category?.toLowerCase().includes(kw)
    )
  );

  if (relevantEvents.length > 0) {
    console.log('\nFound potentially matching Kalshi markets:');
    for (const event of relevantEvents.slice(0, 5)) {
      console.log(`  - [${event.category}] ${event.title}`);
    }
  }
}

// ============ Main ============

async function main() {
  console.log('=== GENERATING BET SUGGESTIONS FROM VEHICLE DATA ===\n');

  const allSuggestions: BetSuggestion[] = [];

  // Run all analyzers
  console.log('1. Analyzing price trends...');
  const priceSuggestions = await analyzePriceTrends();
  console.log(`   Generated ${priceSuggestions.length} suggestions`);
  allSuggestions.push(...priceSuggestions);

  console.log('\n2. Analyzing volume trends...');
  const volumeSuggestions = await analyzeVolumeTrends();
  console.log(`   Generated ${volumeSuggestions.length} suggestions`);
  allSuggestions.push(...volumeSuggestions);

  console.log('\n3. Analyzing category trends...');
  const categorySuggestions = await analyzeCategoryTrends();
  console.log(`   Generated ${categorySuggestions.length} suggestions`);
  allSuggestions.push(...categorySuggestions);

  console.log('\n4. Analyzing comment sentiment...');
  const sentimentSuggestions = await analyzeCommentSentiment();
  console.log(`   Generated ${sentimentSuggestions.length} suggestions`);
  allSuggestions.push(...sentimentSuggestions);

  // Sort by confidence
  allSuggestions.sort((a, b) => b.confidence - a.confidence);

  // Display top suggestions
  console.log('\n=== TOP BET SUGGESTIONS ===\n');
  for (const suggestion of allSuggestions.slice(0, 10)) {
    console.log(`[${(suggestion.confidence * 100).toFixed(0)}%] ${suggestion.title}`);
    console.log(`     ${suggestion.description}`);
    console.log(`     Source: ${suggestion.source_type}\n`);
  }

  // Store in database
  console.log('Storing suggestions in database...');
  for (const suggestion of allSuggestions) {
    await supabase.from('suggested_markets').insert(suggestion);
  }
  console.log(`Stored ${allSuggestions.length} suggestions`);

  // Try to match with existing Kalshi markets
  console.log('\n5. Checking for matching Kalshi markets...');
  await matchToKalshiMarkets(allSuggestions);

  console.log('\n=== COMPLETE ===');
}

main().catch(console.error);

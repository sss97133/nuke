#!/usr/bin/env node
/**
 * Cross-Platform Market Trend Analysis
 * Aggregates sentiment, demand signals, and price trends across BaT and C&B
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function fetchJson(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, ...opts.headers },
    ...opts
  });
  return res.json();
}

async function getMarketTrendsByMake() {
  console.log('=== MARKET TRENDS BY MAKE ===\n');

  // Get comment_discoveries with vehicle joins
  const discoveries = await fetchJson('comment_discoveries?select=vehicle_id,raw_extraction,vehicles(year,make,model,sale_price)&limit=500');

  // Aggregate by make
  const byMake = {};
  discoveries.forEach(d => {
    const make = d.vehicles?.make?.toLowerCase();
    const signals = d.raw_extraction?.market_signals;
    const sentiment = d.raw_extraction?.sentiment;
    if (!make || !signals) return;

    if (!byMake[make]) {
      byMake[make] = {
        count: 0,
        demand: { high: 0, moderate: 0, low: 0 },
        price_trend: { rising: 0, stable: 0, declining: 0 },
        sentiment_total: 0,
        prices: []
      };
    }
    byMake[make].count++;
    if (signals.demand) byMake[make].demand[signals.demand] = (byMake[make].demand[signals.demand] || 0) + 1;
    if (signals.price_trend) byMake[make].price_trend[signals.price_trend] = (byMake[make].price_trend[signals.price_trend] || 0) + 1;
    byMake[make].sentiment_total += sentiment?.score || 0;
    if (d.vehicles?.sale_price) byMake[make].prices.push(d.vehicles.sale_price);
  });

  // Calculate stats and sort
  const sorted = Object.entries(byMake)
    .map(([make, stats]) => ({
      make,
      vehicles_analyzed: stats.count,
      high_demand_pct: Math.round((stats.demand.high || 0) / stats.count * 100),
      rising_price_pct: Math.round((stats.price_trend.rising || 0) / stats.count * 100),
      avg_sentiment: (stats.sentiment_total / stats.count).toFixed(2),
      avg_price: stats.prices.length > 0 ? Math.round(stats.prices.reduce((a,b) => a+b, 0) / stats.prices.length) : null
    }))
    .sort((a, b) => b.vehicles_analyzed - a.vehicles_analyzed);

  console.log('Make             | Analyzed | Demand↑ | Price↑ | Sentiment | Avg Price');
  console.log('-'.repeat(75));
  sorted.slice(0, 20).forEach(m => {
    const price = m.avg_price ? `$${(m.avg_price / 1000).toFixed(0)}k` : 'N/A';
    console.log(
      `${m.make.padEnd(16).slice(0, 16)} | ` +
      `${String(m.vehicles_analyzed).padEnd(8)} | ` +
      `${String(m.high_demand_pct + '%').padEnd(7)} | ` +
      `${String(m.rising_price_pct + '%').padEnd(6)} | ` +
      `${m.avg_sentiment.padEnd(9)} | ` +
      `${price}`
    );
  });

  return sorted;
}

async function getTrendingModels() {
  console.log('\n\n=== TRENDING MODELS (High Demand + Rising Prices) ===\n');

  const discoveries = await fetchJson('comment_discoveries?select=vehicle_id,raw_extraction,vehicles(year,make,model,sale_price)&limit=500');

  // Filter for high demand + rising prices
  const trending = discoveries
    .filter(d => {
      const signals = d.raw_extraction?.market_signals;
      return signals?.demand === 'high' && signals?.price_trend === 'rising';
    })
    .map(d => ({
      year: d.vehicles?.year,
      make: d.vehicles?.make,
      model: d.vehicles?.model,
      price: d.vehicles?.sale_price,
      sentiment: d.raw_extraction?.sentiment?.score,
      rarity: d.raw_extraction?.market_signals?.rarity
    }))
    .filter(v => v.make && v.model);

  // Group by make/model
  const byModel = {};
  trending.forEach(v => {
    const key = `${v.make} ${v.model}`.toLowerCase();
    if (!byModel[key]) byModel[key] = { count: 0, years: [], prices: [], sentiments: [], rarity: null };
    byModel[key].count++;
    if (v.year) byModel[key].years.push(v.year);
    if (v.price) byModel[key].prices.push(v.price);
    if (v.sentiment) byModel[key].sentiments.push(v.sentiment);
    if (v.rarity) byModel[key].rarity = v.rarity;
  });

  const sorted = Object.entries(byModel)
    .map(([model, stats]) => ({
      model,
      occurrences: stats.count,
      years: stats.years.length > 0 ? `${Math.min(...stats.years)}-${Math.max(...stats.years)}` : 'N/A',
      avg_price: stats.prices.length > 0 ? Math.round(stats.prices.reduce((a,b) => a+b, 0) / stats.prices.length) : null,
      avg_sentiment: stats.sentiments.length > 0 ? (stats.sentiments.reduce((a,b) => a+b, 0) / stats.sentiments.length).toFixed(2) : 'N/A',
      rarity: stats.rarity
    }))
    .sort((a, b) => b.occurrences - a.occurrences);

  console.log('Model                          | Count | Years       | Sentiment | Rarity');
  console.log('-'.repeat(75));
  sorted.slice(0, 15).forEach(m => {
    console.log(
      `${m.model.padEnd(30).slice(0, 30)} | ` +
      `${String(m.occurrences).padEnd(5)} | ` +
      `${m.years.padEnd(11)} | ` +
      `${String(m.avg_sentiment).padEnd(9)} | ` +
      `${m.rarity || 'N/A'}`
    );
  });
}

async function getSentimentByDecade() {
  console.log('\n\n=== SENTIMENT BY DECADE ===\n');

  const discoveries = await fetchJson('comment_discoveries?select=vehicle_id,raw_extraction,vehicles(year)&limit=500');

  const byDecade = {};
  discoveries.forEach(d => {
    const year = d.vehicles?.year;
    const sentiment = d.raw_extraction?.sentiment;
    if (!year || !sentiment?.score) return;

    const decade = Math.floor(year / 10) * 10;
    if (!byDecade[decade]) byDecade[decade] = { count: 0, total_sentiment: 0 };
    byDecade[decade].count++;
    byDecade[decade].total_sentiment += sentiment.score;
  });

  console.log('Decade | Vehicles | Avg Sentiment');
  console.log('-'.repeat(40));
  Object.keys(byDecade).sort().forEach(decade => {
    const stats = byDecade[decade];
    const avg = (stats.total_sentiment / stats.count).toFixed(2);
    console.log(`${decade}s  | ${String(stats.count).padEnd(8)} | ${avg}`);
  });
}

async function getPlatformComparison() {
  console.log('\n\n=== PLATFORM DATA COVERAGE ===\n');

  // Get counts from different sources
  const [batListings, cabVehicles, commentsRes, discoveriesRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/bat_listings?select=id`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Prefer': 'count=exact' }
    }),
    fetch(`${SUPABASE_URL}/rest/v1/vehicles?discovery_source=eq.carsandbids&select=id`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Prefer': 'count=exact' }
    }),
    fetch(`${SUPABASE_URL}/rest/v1/auction_comments?select=id`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Prefer': 'count=exact' }
    }),
    fetch(`${SUPABASE_URL}/rest/v1/comment_discoveries?select=id`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Prefer': 'count=exact' }
    })
  ]);

  console.log('Platform           | Listings  | Comments  | AI Analyzed');
  console.log('-'.repeat(55));
  console.log(`Bring a Trailer    | ${(batListings.headers.get('content-range')?.split('/')[1] || '0').padEnd(9)} | TBD       | ${discoveriesRes.headers.get('content-range')?.split('/')[1] || '0'}`);
  console.log(`Cars & Bids        | ${(cabVehicles.headers.get('content-range')?.split('/')[1] || '0').padEnd(9)} | Pending   | Pending`);
  console.log(`Total Comments     | -         | ${(commentsRes.headers.get('content-range')?.split('/')[1] || '0').padEnd(9)} | -`);
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  CROSS-PLATFORM MARKET TREND ANALYSIS                        ║');
  console.log('║  Based on AI-analyzed auction comments (BaT + C&B)           ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  await getPlatformComparison();
  await getMarketTrendsByMake();
  await getTrendingModels();
  await getSentimentByDecade();

  console.log('\n\n✅ Analysis complete');
}

main().catch(console.error);

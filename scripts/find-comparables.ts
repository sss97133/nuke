#!/usr/bin/env npx tsx
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function findComparables() {
  // Get all 911 Carreras with sale data
  const { data } = await supabase
    .from('vehicles')
    .select('year, model, sale_price, auction_end_date, bat_listing_title')
    .eq('make', 'Porsche')
    .ilike('model', '%Carrera%')
    .not('sale_price', 'is', null)
    .not('auction_end_date', 'is', null)
    .gte('year', 1990)
    .lte('year', 2010)
    .gt('sale_price', 20000)
    .lt('sale_price', 200000)
    .limit(2000);

  if (!data) return;

  console.log('COMPARABLE 911 CARRERA ANALYSIS (1990-2010)');
  console.log('Total comparable sales:', data.length);
  console.log('');

  // Group by year-model combo
  const groups: Record<string, any[]> = {};
  data.forEach(v => {
    const key = v.year + ' ' + (v.model || '').split(' ').slice(0, 2).join(' ');
    if (!groups[key]) groups[key] = [];
    groups[key].push({
      ...v,
      month: new Date(v.auction_end_date).getUTCMonth()
    });
  });

  // Find groups with sales in multiple months
  console.log('SAME MODEL, DIFFERENT MONTHS:');
  console.log('(showing price variation within identical year/model)\n');

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const withVariance = Object.entries(groups)
    .filter(([_, sales]) => sales.length >= 4)
    .map(([model, sales]) => {
      const prices = sales.map(s => s.sale_price);
      const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
      const max = Math.max(...prices);
      const min = Math.min(...prices);
      return { model, sales, avg, max, min, spread: max - min, spreadPct: (max - min) / min * 100 };
    })
    .sort((a, b) => b.spreadPct - a.spreadPct)
    .slice(0, 8);

  withVariance.forEach(({ model, sales, avg, max, min, spreadPct }) => {
    console.log(`${model} (${sales.length} sales):`);
    console.log(`  Range: $${min.toLocaleString()} - $${max.toLocaleString()} (${spreadPct.toFixed(0)}% spread)`);

    const sorted = sales.sort((a: any, b: any) => b.sale_price - a.sale_price);
    sorted.slice(0, 5).forEach((s: any) => {
      console.log(`    ${months[s.month].padEnd(3)} $${s.sale_price.toLocaleString().padStart(7)} │ ${(s.bat_listing_title || '').slice(0, 40)}`);
    });
    console.log('');
  });

  // Now test statistical significance
  console.log('─────────────────────────────────────────────────────────────');
  console.log('STATISTICAL TEST: Is timing actually significant?');
  console.log('─────────────────────────────────────────────────────────────\n');

  // Split all data by winter (Nov-Feb) vs summer (Jun-Aug)
  const winter = data.filter(v => {
    const m = new Date(v.auction_end_date).getUTCMonth();
    return m === 0 || m === 1 || m === 10 || m === 11; // Jan, Feb, Nov, Dec
  });
  const summer = data.filter(v => {
    const m = new Date(v.auction_end_date).getUTCMonth();
    return m >= 5 && m <= 7; // Jun, Jul, Aug
  });

  const winterAvg = winter.reduce((a, v) => a + v.sale_price, 0) / winter.length;
  const summerAvg = summer.reduce((a, v) => a + v.sale_price, 0) / summer.length;

  const winterMedian = winter.map(v => v.sale_price).sort((a, b) => a - b)[Math.floor(winter.length / 2)];
  const summerMedian = summer.map(v => v.sale_price).sort((a, b) => a - b)[Math.floor(summer.length / 2)];

  console.log('WINTER (Nov-Feb) vs SUMMER (Jun-Aug):');
  console.log(`  Winter: ${winter.length} sales, avg $${Math.round(winterAvg).toLocaleString()}, median $${winterMedian.toLocaleString()}`);
  console.log(`  Summer: ${summer.length} sales, avg $${Math.round(summerAvg).toLocaleString()}, median $${summerMedian.toLocaleString()}`);
  console.log(`  Difference: $${Math.round(winterAvg - summerAvg).toLocaleString()} (${((winterAvg / summerAvg - 1) * 100).toFixed(1)}%)`);

  // T-test approximation
  const winterVar = winter.reduce((a, v) => a + Math.pow(v.sale_price - winterAvg, 2), 0) / winter.length;
  const summerVar = summer.reduce((a, v) => a + Math.pow(v.sale_price - summerAvg, 2), 0) / summer.length;
  const pooledSE = Math.sqrt(winterVar / winter.length + summerVar / summer.length);
  const tStat = (winterAvg - summerAvg) / pooledSE;

  console.log(`\n  T-statistic: ${tStat.toFixed(2)}`);
  console.log(`  (|t| > 2 suggests statistical significance at p < 0.05)`);

  if (Math.abs(tStat) > 2) {
    console.log('\n  ✓ STATISTICALLY SIGNIFICANT - timing matters');
  } else {
    console.log('\n  ✗ NOT SIGNIFICANT - could be noise');
  }
}

findComparables().catch(console.error);

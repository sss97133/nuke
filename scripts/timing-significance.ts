#!/usr/bin/env npx tsx
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function analyze() {
  // Get ALL vehicles with mileage data across all makes
  const { data } = await supabase
    .from('vehicles')
    .select('year, make, model, sale_price, auction_end_date, mileage')
    .not('sale_price', 'is', null)
    .not('auction_end_date', 'is', null)
    .not('mileage', 'is', null)
    .gt('sale_price', 5000)
    .lt('sale_price', 500000)
    .gt('mileage', 100)
    .lt('mileage', 300000)
    .limit(10000);

  if (!data) return;

  console.log('════════════════════════════════════════════════════════');
  console.log('  TIMING SIGNIFICANCE ANALYSIS (Mileage-Controlled)');
  console.log('════════════════════════════════════════════════════════\n');
  console.log(`Total vehicles with mileage data: ${data.length}\n`);

  // Compute price/mileage ratio for normalization
  const withRatio = data.map(v => ({
    ...v,
    ratio: v.sale_price / Math.max(v.mileage, 1000),
    month: new Date(v.auction_end_date).getUTCMonth(),
    dayOfWeek: new Date(v.auction_end_date).getUTCDay()
  }));

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Monthly analysis
  console.log('PRICE/MILEAGE RATIO BY MONTH:\n');
  const byMonth: Record<number, number[]> = {};
  withRatio.forEach(v => {
    if (!byMonth[v.month]) byMonth[v.month] = [];
    byMonth[v.month].push(v.ratio);
  });

  const monthStats = Object.entries(byMonth)
    .filter(([_, ratios]) => ratios.length > 50)
    .map(([m, ratios]) => {
      const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
      const variance = ratios.reduce((a, r) => a + Math.pow(r - avg, 2), 0) / ratios.length;
      return { month: parseInt(m), avg, stdDev: Math.sqrt(variance), n: ratios.length };
    })
    .sort((a, b) => b.avg - a.avg);

  const maxAvg = monthStats[0].avg;
  monthStats.forEach(({ month, avg, stdDev, n }) => {
    const bar = '█'.repeat(Math.round((avg / maxAvg) * 25));
    console.log(`  ${months[month].padEnd(3)} │${bar.padEnd(25)} ${avg.toFixed(2)} ±${stdDev.toFixed(2)} (n=${n})`);
  });

  // T-test: best month vs worst month
  const best = monthStats[0];
  const worst = monthStats[monthStats.length - 1];
  const bestRatios = byMonth[best.month];
  const worstRatios = byMonth[worst.month];

  const pooledSE = Math.sqrt(
    (best.stdDev ** 2 / best.n) + (worst.stdDev ** 2 / worst.n)
  );
  const tStat = (best.avg - worst.avg) / pooledSE;

  console.log(`\n  Best: ${months[best.month]} (${best.avg.toFixed(2)})`);
  console.log(`  Worst: ${months[worst.month]} (${worst.avg.toFixed(2)})`);
  console.log(`  Difference: ${((best.avg / worst.avg - 1) * 100).toFixed(1)}%`);
  console.log(`  T-statistic: ${tStat.toFixed(2)} ${Math.abs(tStat) > 2 ? '✓ SIGNIFICANT' : '✗ not significant'}`);

  // Day of week analysis
  console.log('\n\nPRICE/MILEAGE RATIO BY DAY OF WEEK:\n');
  const byDay: Record<number, number[]> = {};
  withRatio.forEach(v => {
    if (!byDay[v.dayOfWeek]) byDay[v.dayOfWeek] = [];
    byDay[v.dayOfWeek].push(v.ratio);
  });

  const dayStats = Object.entries(byDay)
    .map(([d, ratios]) => {
      const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
      const variance = ratios.reduce((a, r) => a + Math.pow(r - avg, 2), 0) / ratios.length;
      return { day: parseInt(d), avg, stdDev: Math.sqrt(variance), n: ratios.length };
    })
    .sort((a, b) => b.avg - a.avg);

  const maxDayAvg = dayStats[0].avg;
  dayStats.forEach(({ day, avg, stdDev, n }) => {
    const bar = '█'.repeat(Math.round((avg / maxDayAvg) * 25));
    console.log(`  ${days[day].padEnd(3)} │${bar.padEnd(25)} ${avg.toFixed(2)} ±${stdDev.toFixed(2)} (n=${n})`);
  });

  const bestDay = dayStats[0];
  const worstDay = dayStats[dayStats.length - 1];
  const dayPooledSE = Math.sqrt(
    (bestDay.stdDev ** 2 / bestDay.n) + (worstDay.stdDev ** 2 / worstDay.n)
  );
  const dayTStat = (bestDay.avg - worstDay.avg) / dayPooledSE;

  console.log(`\n  Best: ${days[bestDay.day]} (${bestDay.avg.toFixed(2)})`);
  console.log(`  Worst: ${days[worstDay.day]} (${worstDay.avg.toFixed(2)})`);
  console.log(`  Difference: ${((bestDay.avg / worstDay.avg - 1) * 100).toFixed(1)}%`);
  console.log(`  T-statistic: ${dayTStat.toFixed(2)} ${Math.abs(dayTStat) > 2 ? '✓ SIGNIFICANT' : '✗ not significant'}`);

  // Summary
  console.log('\n════════════════════════════════════════════════════════');
  console.log('  VERDICT');
  console.log('════════════════════════════════════════════════════════\n');

  if (Math.abs(tStat) > 2 || Math.abs(dayTStat) > 2) {
    console.log('  Some timing effects appear statistically significant.');
    console.log('  However, effect sizes are small relative to other factors');
    console.log('  (mileage, condition, variant can cause 400%+ variation).\n');
  } else {
    console.log('  ✗ NO SIGNIFICANT TIMING EFFECTS FOUND');
    console.log('  The monthly/daily patterns are likely noise.');
    console.log('  Other factors dominate: mileage, condition, variant, spec.\n');
  }
}

analyze().catch(console.error);

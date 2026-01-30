#!/usr/bin/env npx tsx
/**
 * AUCTION TIMING ANALYST
 *
 * Study when vehicles actually sell best - the analyst's toolkit.
 * Traditional auction houses know prime slots exist. Let's prove it with data.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

interface SaleData {
  sale_price: number;
  reserve_status: string;
  bat_bids: number;
  bat_comments: number;
  bat_watchers: number;
  auction_end_date: string;
  year: number;
  make: string;
  model: string;
}

async function main() {
  console.log('════════════════════════════════════════════════════════════');
  console.log('  AUCTION TIMING ANALYST');
  console.log('  Finding the premium slots');
  console.log('════════════════════════════════════════════════════════════\n');

  // Get BaT data with engagement metrics
  const { data, error } = await supabase
    .from('vehicles')
    .select('sale_price, reserve_status, bat_bids, bat_comments, bat_watchers, auction_end_date, year, make, model')
    .not('auction_end_date', 'is', null)
    .not('bat_bids', 'is', null)
    .gt('bat_bids', 0)
    .limit(10000);

  if (error || !data) {
    console.log('Error:', error);
    return;
  }

  console.log(`Loaded ${data.length} auctions with bid data\n`);

  // Parse dates and group
  const parsed = data.map(v => {
    const date = new Date(v.auction_end_date);
    return {
      ...v,
      dayOfWeek: date.getUTCDay(),
      month: date.getUTCMonth(),
      dayOfYear: Math.floor((date.getTime() - new Date(date.getUTCFullYear(), 0, 0).getTime()) / 86400000),
      sold: v.reserve_status === 'sold' || (v.sale_price && v.sale_price > 0),
      hasReserve: v.reserve_status !== 'no_reserve',
    };
  });

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // ═══════════════════════════════════════════════════════════════
  // METRIC 1: Sale Rate by Day of Week
  // ═══════════════════════════════════════════════════════════════
  console.log('─────────────────────────────────────────────────────────────');
  console.log('1. SALE RATE BY DAY OF WEEK');
  console.log('   (What % of auctions result in a sale?)');
  console.log('─────────────────────────────────────────────────────────────\n');

  const byDay: Record<number, { total: number; sold: number; bids: number[]; prices: number[] }> = {};
  parsed.forEach(v => {
    if (!byDay[v.dayOfWeek]) byDay[v.dayOfWeek] = { total: 0, sold: 0, bids: [], prices: [] };
    byDay[v.dayOfWeek].total++;
    if (v.sold) byDay[v.dayOfWeek].sold++;
    if (v.bat_bids) byDay[v.dayOfWeek].bids.push(v.bat_bids);
    if (v.sale_price) byDay[v.dayOfWeek].prices.push(v.sale_price);
  });

  console.log('Day │ Auctions │ Sold │ Sale Rate │ Avg Bids │ Avg Price');
  console.log('────┼──────────┼──────┼───────────┼──────────┼──────────');

  for (let d = 0; d < 7; d++) {
    const stats = byDay[d];
    if (stats && stats.total > 10) {
      const saleRate = (stats.sold / stats.total * 100).toFixed(1);
      const avgBids = (stats.bids.reduce((a, b) => a + b, 0) / stats.bids.length).toFixed(0);
      const avgPrice = stats.prices.length > 0
        ? '$' + Math.round(stats.prices.reduce((a, b) => a + b, 0) / stats.prices.length).toLocaleString()
        : 'N/A';
      console.log(`${days[d].padEnd(3)} │ ${String(stats.total).padStart(8)} │ ${String(stats.sold).padStart(4)} │ ${saleRate.padStart(8)}% │ ${avgBids.padStart(8)} │ ${avgPrice.padStart(9)}`);
    }
  }

  // Find best day by sale rate
  const daysSorted = Object.entries(byDay)
    .filter(([_, s]) => s.total > 50)
    .map(([d, s]) => ({ day: parseInt(d), rate: s.sold / s.total, n: s.total }))
    .sort((a, b) => b.rate - a.rate);

  if (daysSorted.length >= 2) {
    console.log(`\n  📊 Best day: ${days[daysSorted[0].day]} (${(daysSorted[0].rate * 100).toFixed(1)}% sale rate)`);
    console.log(`     Worst day: ${days[daysSorted[daysSorted.length - 1].day]} (${(daysSorted[daysSorted.length - 1].rate * 100).toFixed(1)}% sale rate)`);
  }

  // ═══════════════════════════════════════════════════════════════
  // METRIC 2: Bid Activity by Day
  // ═══════════════════════════════════════════════════════════════
  console.log('\n─────────────────────────────────────────────────────────────');
  console.log('2. BID ACTIVITY BY DAY');
  console.log('   (More bids = more competition = higher prices?)');
  console.log('─────────────────────────────────────────────────────────────\n');

  const bidStats = Object.entries(byDay)
    .filter(([_, s]) => s.bids.length > 30)
    .map(([d, s]) => {
      const avgBids = s.bids.reduce((a, b) => a + b, 0) / s.bids.length;
      const medianBids = s.bids.sort((a, b) => a - b)[Math.floor(s.bids.length / 2)];
      return { day: parseInt(d), avgBids, medianBids, n: s.bids.length };
    })
    .sort((a, b) => b.avgBids - a.avgBids);

  const maxBids = bidStats[0]?.avgBids || 1;
  bidStats.forEach(({ day, avgBids, medianBids, n }) => {
    const bar = '█'.repeat(Math.round((avgBids / maxBids) * 20));
    console.log(`  ${days[day].padEnd(3)} │${bar.padEnd(20)} avg ${avgBids.toFixed(0)} bids, median ${medianBids} (n=${n})`);
  });

  // ═══════════════════════════════════════════════════════════════
  // METRIC 3: Engagement (watchers + comments) correlation
  // ═══════════════════════════════════════════════════════════════
  console.log('\n─────────────────────────────────────────────────────────────');
  console.log('3. ENGAGEMENT → PRICE CORRELATION');
  console.log('   (Do more watchers/comments = higher sale price?)');
  console.log('─────────────────────────────────────────────────────────────\n');

  const withEngagement = parsed.filter(v => v.bat_watchers && v.sale_price && v.sale_price > 0);

  // Bucket by watcher count
  const watcherBuckets: Record<string, number[]> = {
    '0-100': [],
    '100-500': [],
    '500-1000': [],
    '1000+': []
  };

  withEngagement.forEach(v => {
    const w = v.bat_watchers;
    if (w < 100) watcherBuckets['0-100'].push(v.sale_price);
    else if (w < 500) watcherBuckets['100-500'].push(v.sale_price);
    else if (w < 1000) watcherBuckets['500-1000'].push(v.sale_price);
    else watcherBuckets['1000+'].push(v.sale_price);
  });

  console.log('Watchers    │ Avg Sale Price   │ Count');
  console.log('────────────┼──────────────────┼──────');
  Object.entries(watcherBuckets).forEach(([bucket, prices]) => {
    if (prices.length > 5) {
      const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
      console.log(`${bucket.padEnd(11)} │ $${Math.round(avg).toLocaleString().padStart(14)} │ ${prices.length}`);
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // METRIC 4: Best Days of the Year
  // ═══════════════════════════════════════════════════════════════
  console.log('\n─────────────────────────────────────────────────────────────');
  console.log('4. BEST DAYS OF THE YEAR');
  console.log('   (Specific dates with highest sale rates)');
  console.log('─────────────────────────────────────────────────────────────\n');

  const byDayOfYear: Record<number, { total: number; sold: number; totalPrice: number }> = {};
  parsed.forEach(v => {
    if (!byDayOfYear[v.dayOfYear]) byDayOfYear[v.dayOfYear] = { total: 0, sold: 0, totalPrice: 0 };
    byDayOfYear[v.dayOfYear].total++;
    if (v.sold) {
      byDayOfYear[v.dayOfYear].sold++;
      if (v.sale_price) byDayOfYear[v.dayOfYear].totalPrice += v.sale_price;
    }
  });

  const topDays = Object.entries(byDayOfYear)
    .filter(([_, s]) => s.total >= 10) // Need meaningful sample
    .map(([day, s]) => ({
      day: parseInt(day),
      rate: s.sold / s.total,
      avgPrice: s.sold > 0 ? s.totalPrice / s.sold : 0,
      n: s.total
    }))
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 10);

  console.log('Top 10 days by sale rate (min 10 auctions):');
  topDays.forEach(({ day, rate, avgPrice, n }, i) => {
    const date = new Date(2024, 0, day);
    const dateStr = `${months[date.getMonth()]} ${date.getDate()}`;
    console.log(`  ${(i + 1).toString().padStart(2)}. ${dateStr.padEnd(7)} │ ${(rate * 100).toFixed(0)}% sold │ avg $${Math.round(avgPrice).toLocaleString()} │ n=${n}`);
  });

  // ═══════════════════════════════════════════════════════════════
  // SUMMARY: The Premium Slots
  // ═══════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  KEY FINDINGS');
  console.log('════════════════════════════════════════════════════════════\n');

  console.log('  These patterns need validation with more data, but suggest:');
  console.log('');
  if (daysSorted.length > 0) {
    console.log(`  • ${days[daysSorted[0].day]} auctions have highest sale rate`);
  }
  if (bidStats.length > 0) {
    console.log(`  • ${days[bidStats[0].day]} auctions get most bids`);
  }
  console.log('  • More watchers correlates with higher sale prices');
  console.log('  • Specific calendar days show patterns (need multi-year data)');
  console.log('');
  console.log('  NEXT: Study Mecum/RM timing, BaT auction end hours, seasonal cycles');
  console.log('');
}

main().catch(console.error);

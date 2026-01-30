#!/usr/bin/env npx tsx
/**
 * ACTIVITY PATTERN ANALYZER
 *
 * Analyzes bidding and comment activity to find:
 * - Best time of day to list/advertise
 * - Best day of week
 * - Seasonal patterns
 * - Vehicle-specific patterns
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface HourlyData {
  [hour: number]: number;
}

interface DailyData {
  [day: number]: number;
}

interface MonthlyData {
  [month: number]: number;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  ACTIVITY PATTERN ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════\n');

  // 1. Get total counts
  const { count: commentCount } = await supabase
    .from('auction_comments')
    .select('id', { count: 'exact', head: true });

  const { count: vehicleCount } = await supabase
    .from('vehicles')
    .select('id', { count: 'exact', head: true });

  const { count: soldCount } = await supabase
    .from('vehicles')
    .select('id', { count: 'exact', head: true })
    .not('sale_price', 'is', null);

  console.log('DATA AVAILABLE:');
  console.log(`  Comments: ${commentCount?.toLocaleString() || 'unknown'}`);
  console.log(`  Vehicles: ${vehicleCount?.toLocaleString() || 'unknown'}`);
  console.log(`  With sale price: ${soldCount?.toLocaleString() || 'unknown'}`);

  // 2. Get date range
  const { data: earliest } = await supabase
    .from('auction_comments')
    .select('posted_at')
    .order('posted_at', { ascending: true })
    .limit(1);

  const { data: latest } = await supabase
    .from('auction_comments')
    .select('posted_at')
    .order('posted_at', { ascending: false })
    .limit(1);

  if (earliest?.[0] && latest?.[0]) {
    console.log(`\nDATE RANGE:`);
    console.log(`  From: ${earliest[0].posted_at}`);
    console.log(`  To: ${latest[0].posted_at}`);
  }

  // 3. Sample activity by hour - pull from different time periods for better distribution
  console.log('\n─────────────────────────────────────────────────────────────');
  console.log('ANALYZING PATTERNS (sampling across full date range)...');
  console.log('─────────────────────────────────────────────────────────────\n');

  // Sample from different years to get seasonal distribution
  const years = ['2020', '2021', '2022', '2023', '2024', '2025'];
  let allComments: any[] = [];

  for (const year of years) {
    const { data } = await supabase
      .from('auction_comments')
      .select('posted_at')
      .gte('posted_at', `${year}-01-01`)
      .lt('posted_at', `${parseInt(year)+1}-01-01`)
      .limit(2000);
    if (data) allComments = allComments.concat(data);
  }

  const comments = allComments;

  if (comments && comments.length > 0) {
    const byHour: HourlyData = {};
    const byDay: DailyData = {};
    const byMonth: MonthlyData = {};

    comments.forEach(c => {
      const date = new Date(c.posted_at);
      const hour = date.getUTCHours();
      const day = date.getUTCDay(); // 0 = Sunday
      const month = date.getUTCMonth(); // 0 = January

      byHour[hour] = (byHour[hour] || 0) + 1;
      byDay[day] = (byDay[day] || 0) + 1;
      byMonth[month] = (byMonth[month] || 0) + 1;
    });

    // Hourly distribution
    console.log('HOURLY DISTRIBUTION (UTC):');
    const maxHourly = Math.max(...Object.values(byHour));
    for (let h = 0; h < 24; h++) {
      const count = byHour[h] || 0;
      const bar = '█'.repeat(Math.round((count / maxHourly) * 30));
      const hourStr = h.toString().padStart(2, '0');
      console.log(`  ${hourStr}:00 │${bar.padEnd(30)} ${count}`);
    }

    // Find peak hours
    const sortedHours = Object.entries(byHour)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    console.log(`\n  PEAK HOURS: ${sortedHours.map(([h]) => h + ':00 UTC').join(', ')}`);

    // Daily distribution
    console.log('\n\nDAILY DISTRIBUTION:');
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const maxDaily = Math.max(...Object.values(byDay));
    for (let d = 0; d < 7; d++) {
      const count = byDay[d] || 0;
      const bar = '█'.repeat(Math.round((count / maxDaily) * 30));
      console.log(`  ${days[d]} │${bar.padEnd(30)} ${count}`);
    }

    // Find peak days
    const sortedDays = Object.entries(byDay)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    console.log(`\n  PEAK DAYS: ${sortedDays.map(([d]) => days[parseInt(d)]).join(', ')}`);

    // Monthly distribution
    console.log('\n\nMONTHLY DISTRIBUTION:');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const maxMonthly = Math.max(...Object.values(byMonth));
    for (let m = 0; m < 12; m++) {
      const count = byMonth[m] || 0;
      const bar = '█'.repeat(Math.round((count / maxMonthly) * 30));
      console.log(`  ${months[m]} │${bar.padEnd(30)} ${count}`);
    }

    // Find peak months
    const sortedMonths = Object.entries(byMonth)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    console.log(`\n  PEAK MONTHS: ${sortedMonths.map(([m]) => months[parseInt(m)]).join(', ')}`);
  }

  // 4. Check for price correlations
  console.log('\n─────────────────────────────────────────────────────────────');
  console.log('CHECKING PRICE DATA...');
  console.log('─────────────────────────────────────────────────────────────\n');

  const { data: soldVehicles } = await supabase
    .from('vehicles')
    .select('year, make, model, sale_price')
    .not('sale_price', 'is', null)
    .lt('sale_price', 10000000) // Filter out likely data errors
    .order('sale_price', { ascending: false })
    .limit(10);

  if (soldVehicles && soldVehicles.length > 0) {
    console.log('TOP SALES (filtered):');
    soldVehicles.forEach((v, i) => {
      console.log(`  ${i + 1}. ${v.year} ${v.make} ${v.model} - $${v.sale_price?.toLocaleString()}`);
    });
  }

  // 5. Analyze sales by day of week using actual auction_end_date
  console.log('\n─────────────────────────────────────────────────────────────');
  console.log('SALES TIMING ANALYSIS (using auction_end_date)...');
  console.log('─────────────────────────────────────────────────────────────\n');

  // Get vehicles with both sale price and auction_end_date
  const { data: salesWithDates } = await supabase
    .from('vehicles')
    .select('sale_price, auction_end_date')
    .not('sale_price', 'is', null)
    .not('auction_end_date', 'is', null)
    .lt('sale_price', 500000) // Focus on typical sales for patterns
    .gt('sale_price', 1000)
    .limit(10000);

  console.log(`  Analyzing ${salesWithDates?.length || 0} sales with auction dates...\n`);

  if (salesWithDates && salesWithDates.length > 0) {
    const dayPrices: { [key: number]: number[] } = {};
    const monthPrices: { [key: number]: number[] } = {};
    const yearPrices: { [key: number]: number[] } = {};

    salesWithDates.forEach(v => {
      if (v.auction_end_date && v.sale_price) {
        const date = new Date(v.auction_end_date);
        const day = date.getUTCDay();
        const month = date.getUTCMonth();
        const year = date.getUTCFullYear();

        if (!dayPrices[day]) dayPrices[day] = [];
        if (!monthPrices[month]) monthPrices[month] = [];
        if (!yearPrices[year]) yearPrices[year] = [];

        dayPrices[day].push(v.sale_price);
        monthPrices[month].push(v.sale_price);
        yearPrices[year].push(v.sale_price);
      }
    });

    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    console.log('AVERAGE SALE PRICE BY DAY OF WEEK:');
    const maxDayAvg = Math.max(...Object.values(dayPrices).map(p => p.reduce((a, b) => a + b, 0) / p.length));
    for (let d = 0; d < 7; d++) {
      const prices = dayPrices[d] || [];
      if (prices.length > 0) {
        const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
        const bar = '█'.repeat(Math.round((avg / maxDayAvg) * 25));
        console.log(`  ${days[d]} │${bar.padEnd(25)} $${Math.round(avg).toLocaleString().padStart(7)} (n=${prices.length})`);
      }
    }

    console.log('\nAVERAGE SALE PRICE BY MONTH:');
    const maxMonthAvg = Math.max(...Object.values(monthPrices).map(p => p.reduce((a, b) => a + b, 0) / p.length));
    for (let m = 0; m < 12; m++) {
      const prices = monthPrices[m] || [];
      if (prices.length > 10) { // Need meaningful sample
        const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
        const bar = '█'.repeat(Math.round((avg / maxMonthAvg) * 25));
        console.log(`  ${months[m]} │${bar.padEnd(25)} $${Math.round(avg).toLocaleString().padStart(7)} (n=${prices.length})`);
      }
    }

    console.log('\nYEARLY TRENDS:');
    const sortedYears = Object.keys(yearPrices).map(Number).sort();
    for (const year of sortedYears) {
      const prices = yearPrices[year];
      if (prices.length > 10) {
        const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
        console.log(`  ${year} │ $${Math.round(avg).toLocaleString().padStart(7)} avg (n=${prices.length})`);
      }
    }

    // Find best times
    const sortedDays = Object.entries(dayPrices)
      .filter(([_, p]) => p.length > 50)
      .map(([d, prices]) => ({ day: days[parseInt(d)], avg: prices.reduce((a, b) => a + b, 0) / prices.length, n: prices.length }))
      .sort((a, b) => b.avg - a.avg);

    const sortedMonths = Object.entries(monthPrices)
      .filter(([_, p]) => p.length > 50)
      .map(([m, prices]) => ({ month: months[parseInt(m)], avg: prices.reduce((a, b) => a + b, 0) / prices.length, n: prices.length }))
      .sort((a, b) => b.avg - a.avg);

    console.log('\n─────────────────────────────────────────────────────────────');
    console.log('KEY INSIGHTS:');
    console.log('─────────────────────────────────────────────────────────────');
    if (sortedDays.length > 0) {
      console.log(`\n  📅 BEST DAY TO SELL: ${sortedDays[0].day}`);
      console.log(`     Average: $${Math.round(sortedDays[0].avg).toLocaleString()} (${sortedDays[0].n} sales)`);
      console.log(`     vs worst day (${sortedDays[sortedDays.length-1].day}): $${Math.round(sortedDays[sortedDays.length-1].avg).toLocaleString()}`);
      const dayDelta = ((sortedDays[0].avg - sortedDays[sortedDays.length-1].avg) / sortedDays[sortedDays.length-1].avg * 100).toFixed(1);
      console.log(`     Difference: +${dayDelta}%`);
    }
    if (sortedMonths.length > 0) {
      console.log(`\n  🗓️  BEST MONTH TO SELL: ${sortedMonths[0].month}`);
      console.log(`     Average: $${Math.round(sortedMonths[0].avg).toLocaleString()} (${sortedMonths[0].n} sales)`);
      console.log(`     vs worst month (${sortedMonths[sortedMonths.length-1].month}): $${Math.round(sortedMonths[sortedMonths.length-1].avg).toLocaleString()}`);
      const monthDelta = ((sortedMonths[0].avg - sortedMonths[sortedMonths.length-1].avg) / sortedMonths[sortedMonths.length-1].avg * 100).toFixed(1);
      console.log(`     Difference: +${monthDelta}%`);
    }
  }

  // 6. Analyze patterns by make
  console.log('\n─────────────────────────────────────────────────────────────');
  console.log('MAKE-SPECIFIC TIMING PATTERNS...');
  console.log('─────────────────────────────────────────────────────────────\n');

  const topMakes = ['Porsche', 'BMW', 'Mercedes-Benz', 'Ferrari', 'Chevrolet', 'Ford'];

  for (const make of topMakes) {
    const { data: makeData } = await supabase
      .from('vehicles')
      .select('sale_price, auction_end_date')
      .eq('make', make)
      .not('sale_price', 'is', null)
      .not('auction_end_date', 'is', null)
      .lt('sale_price', 500000)
      .gt('sale_price', 1000)
      .limit(2000);

    if (makeData && makeData.length > 50) {
      const monthPrices: { [key: number]: number[] } = {};
      makeData.forEach(v => {
        if (v.auction_end_date && v.sale_price) {
          const month = new Date(v.auction_end_date).getUTCMonth();
          if (!monthPrices[month]) monthPrices[month] = [];
          monthPrices[month].push(v.sale_price);
        }
      });

      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const sorted = Object.entries(monthPrices)
        .filter(([_, p]) => p.length > 5)
        .map(([m, p]) => ({ m: parseInt(m), avg: p.reduce((a, b) => a + b, 0) / p.length, n: p.length }))
        .sort((a, b) => b.avg - a.avg);

      if (sorted.length >= 2) {
        const best = sorted[0];
        const worst = sorted[sorted.length - 1];
        const avgAll = makeData.reduce((a, v) => a + (v.sale_price || 0), 0) / makeData.length;
        const delta = ((best.avg - worst.avg) / worst.avg * 100).toFixed(0);

        console.log(`  ${make.padEnd(15)} │ Best: ${months[best.m]} ($${Math.round(best.avg).toLocaleString()}) │ Worst: ${months[worst.m]} │ Δ +${delta}% │ avg $${Math.round(avgAll).toLocaleString()} (n=${makeData.length})`);
      }
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  ANALYSIS COMPLETE');
  console.log('═══════════════════════════════════════════════════════════\n');
}

main().catch(console.error);

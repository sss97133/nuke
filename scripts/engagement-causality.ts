#!/usr/bin/env npx tsx
/**
 * ENGAGEMENT CAUSALITY CHECK
 *
 * Question: Do watchers cause higher prices, or do expensive cars just get more watchers?
 *
 * Method: Look at SAME make/model/year with different engagement levels
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('════════════════════════════════════════════════════════════');
  console.log('  ENGAGEMENT → PRICE CAUSALITY CHECK');
  console.log('  Same car, different engagement - does it matter?');
  console.log('════════════════════════════════════════════════════════════\n');

  // Get data with watchers and sale price (paginated)
  let allData: any[] = [];
  let page = 0;
  const pageSize = 1000;

  while (true) {
    const { data: pageData } = await supabase
      .from('vehicles')
      .select('year, make, model, sale_price, bat_watchers, bat_bids, bat_comments, reserve_status')
      .not('sale_price', 'is', null)
      .not('bat_watchers', 'is', null)
      .gt('sale_price', 5000)
      .lt('sale_price', 500000)
      .gt('bat_watchers', 0)
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (!pageData || pageData.length === 0) break;
    allData = allData.concat(pageData);
    page++;
    if (page > 50) break; // Safety limit
  }

  const data = allData;
  if (!data.length) return;
  console.log(`Loaded ${data.length} sales with watcher data (${page} pages)\n`);

  // Group by make/model/year
  const groups: Record<string, typeof data> = {};
  data.forEach(v => {
    const key = `${v.year} ${v.make} ${v.model}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(v);
  });

  // Find groups with enough variation to study
  console.log('─────────────────────────────────────────────────────────────');
  console.log('SAME MODEL, DIFFERENT ENGAGEMENT:');
  console.log('─────────────────────────────────────────────────────────────\n');

  const comparisons: { model: string; lowWatchPrice: number; highWatchPrice: number; delta: number }[] = [];

  Object.entries(groups)
    .filter(([_, cars]) => cars.length >= 5)
    .forEach(([model, cars]) => {
      // Split into high/low engagement
      const sorted = cars.sort((a, b) => a.bat_watchers - b.bat_watchers);
      const lowEngagement = sorted.slice(0, Math.floor(sorted.length / 2));
      const highEngagement = sorted.slice(Math.ceil(sorted.length / 2));

      if (lowEngagement.length >= 2 && highEngagement.length >= 2) {
        const lowAvgPrice = lowEngagement.reduce((a, v) => a + v.sale_price, 0) / lowEngagement.length;
        const highAvgPrice = highEngagement.reduce((a, v) => a + v.sale_price, 0) / highEngagement.length;
        const lowAvgWatchers = lowEngagement.reduce((a, v) => a + v.bat_watchers, 0) / lowEngagement.length;
        const highAvgWatchers = highEngagement.reduce((a, v) => a + v.bat_watchers, 0) / highEngagement.length;

        if (highAvgWatchers > lowAvgWatchers * 1.5) { // Meaningful engagement difference
          comparisons.push({
            model,
            lowWatchPrice: lowAvgPrice,
            highWatchPrice: highAvgPrice,
            delta: (highAvgPrice - lowAvgPrice) / lowAvgPrice * 100
          });
        }
      }
    });

  // Sort by delta and show top examples
  comparisons.sort((a, b) => b.delta - a.delta);

  console.log('Models where HIGH engagement correlated with HIGHER prices:\n');
  comparisons.filter(c => c.delta > 0).slice(0, 10).forEach(c => {
    console.log(`  ${c.model}`);
    console.log(`    Low watchers: $${Math.round(c.lowWatchPrice).toLocaleString()}`);
    console.log(`    High watchers: $${Math.round(c.highWatchPrice).toLocaleString()} (+${c.delta.toFixed(0)}%)`);
    console.log('');
  });

  console.log('\nModels where HIGH engagement correlated with LOWER prices:\n');
  comparisons.filter(c => c.delta < 0).slice(-5).forEach(c => {
    console.log(`  ${c.model}`);
    console.log(`    Low watchers: $${Math.round(c.lowWatchPrice).toLocaleString()}`);
    console.log(`    High watchers: $${Math.round(c.highWatchPrice).toLocaleString()} (${c.delta.toFixed(0)}%)`);
    console.log('');
  });

  // Statistical summary
  const positive = comparisons.filter(c => c.delta > 0).length;
  const negative = comparisons.filter(c => c.delta < 0).length;
  const avgDelta = comparisons.reduce((a, c) => a + c.delta, 0) / comparisons.length;

  console.log('─────────────────────────────────────────────────────────────');
  console.log('SUMMARY');
  console.log('─────────────────────────────────────────────────────────────\n');
  console.log(`  Models compared: ${comparisons.length}`);
  console.log(`  Higher engagement → higher price: ${positive} (${(positive / comparisons.length * 100).toFixed(0)}%)`);
  console.log(`  Higher engagement → lower price: ${negative} (${(negative / comparisons.length * 100).toFixed(0)}%)`);
  console.log(`  Average price delta: ${avgDelta > 0 ? '+' : ''}${avgDelta.toFixed(1)}%`);
  console.log('');

  if (positive > negative * 1.5) {
    console.log('  ✓ ENGAGEMENT APPEARS CAUSAL');
    console.log('    More watchers → higher prices even for same model');
  } else {
    console.log('  ✗ ENGAGEMENT MAY NOT BE CAUSAL');
    console.log('    Price differences likely driven by other factors');
  }

  // Bid count analysis
  console.log('\n─────────────────────────────────────────────────────────────');
  console.log('BID COUNT → FINAL PRICE (Same Model)');
  console.log('─────────────────────────────────────────────────────────────\n');

  const bidComparisons: { model: string; lowBidPrice: number; highBidPrice: number; delta: number }[] = [];

  Object.entries(groups)
    .filter(([_, cars]) => cars.length >= 4)
    .forEach(([model, cars]) => {
      const withBids = cars.filter(c => c.bat_bids && c.bat_bids > 0);
      if (withBids.length < 4) return;

      const sorted = withBids.sort((a, b) => a.bat_bids - b.bat_bids);
      const lowBids = sorted.slice(0, Math.floor(sorted.length / 2));
      const highBids = sorted.slice(Math.ceil(sorted.length / 2));

      const lowAvgPrice = lowBids.reduce((a, v) => a + v.sale_price, 0) / lowBids.length;
      const highAvgPrice = highBids.reduce((a, v) => a + v.sale_price, 0) / highBids.length;

      bidComparisons.push({
        model,
        lowBidPrice: lowAvgPrice,
        highBidPrice: highAvgPrice,
        delta: (highAvgPrice - lowAvgPrice) / lowAvgPrice * 100
      });
    });

  const bidPositive = bidComparisons.filter(c => c.delta > 0).length;
  const bidNegative = bidComparisons.filter(c => c.delta < 0).length;
  const bidAvgDelta = bidComparisons.reduce((a, c) => a + c.delta, 0) / bidComparisons.length;

  console.log(`  Models compared: ${bidComparisons.length}`);
  console.log(`  More bids → higher price: ${bidPositive} (${(bidPositive / bidComparisons.length * 100).toFixed(0)}%)`);
  console.log(`  More bids → lower price: ${bidNegative} (${(bidNegative / bidComparisons.length * 100).toFixed(0)}%)`);
  console.log(`  Average price delta: ${bidAvgDelta > 0 ? '+' : ''}${bidAvgDelta.toFixed(1)}%`);
  console.log('');

  if (bidPositive > bidNegative * 1.5) {
    console.log('  ✓ BID COUNT IS PREDICTIVE');
    console.log('    More competitive auctions yield higher prices');
  }
}

main().catch(console.error);

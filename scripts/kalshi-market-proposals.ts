#!/usr/bin/env npx tsx
/**
 * Kalshi Market Proposal Generator
 *
 * Generates market proposals from n-zero vehicle data
 * that can be submitted to Kalshi for listing.
 *
 * Kalshi requirements:
 * - CFTC compliant (event contracts on verifiable outcomes)
 * - Manipulation resistant (based on public data)
 * - Clear resolution criteria
 * - User interest
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface MarketProposal {
  title: string;
  description: string;
  category: string;
  resolution_source: string;
  resolution_criteria: string;
  expiration_date: string;
  why_interesting: string;
  data_backing: object;
}

// ============ DATA ANALYSIS ============

async function getBaTStats() {
  // Get BaT auction statistics
  const { data: recent } = await supabase
    .from('vehicles')
    .select('sale_price, sold_at, make, model')
    .ilike('source_url', '%bringatrailer%')
    .not('sale_price', 'is', null)
    .gte('sold_at', new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString())
    .order('sold_at', { ascending: false });

  if (!recent?.length) return null;

  const prices = recent.map(v => v.sale_price);
  const totalGross = prices.reduce((a, b) => a + b, 0);
  const avgPrice = totalGross / prices.length;
  const maxPrice = Math.max(...prices);

  // Group by month
  const byMonth: Record<string, { count: number; gross: number; max: number }> = {};
  for (const v of recent) {
    const month = v.sold_at.slice(0, 7);
    if (!byMonth[month]) byMonth[month] = { count: 0, gross: 0, max: 0 };
    byMonth[month].count++;
    byMonth[month].gross += v.sale_price;
    byMonth[month].max = Math.max(byMonth[month].max, v.sale_price);
  }

  // Group by make
  const byMake: Record<string, { count: number; avgPrice: number; maxPrice: number }> = {};
  for (const v of recent) {
    const make = v.make?.toUpperCase() || 'UNKNOWN';
    if (!byMake[make]) byMake[make] = { count: 0, avgPrice: 0, maxPrice: 0 };
    byMake[make].count++;
    byMake[make].maxPrice = Math.max(byMake[make].maxPrice, v.sale_price);
  }
  for (const make of Object.keys(byMake)) {
    const makeVehicles = recent.filter(v => v.make?.toUpperCase() === make);
    byMake[make].avgPrice = makeVehicles.reduce((a, v) => a + v.sale_price, 0) / makeVehicles.length;
  }

  return {
    totalAuctions: recent.length,
    totalGross,
    avgPrice,
    maxPrice,
    byMonth: Object.entries(byMonth).sort((a, b) => b[0].localeCompare(a[0])),
    topMakes: Object.entries(byMake)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10),
  };
}

// ============ PROPOSAL GENERATORS ============

function generateQuarterlyGrossProposal(stats: any): MarketProposal {
  const monthlyGrosses = stats.byMonth.slice(0, 12).map((m: any) => m[1].gross);
  const avgMonthlyGross = monthlyGrosses.reduce((a: number, b: number) => a + b, 0) / monthlyGrosses.length;
  const quarterlyEstimate = avgMonthlyGross * 3;

  // Set line at a round number
  const line = Math.round(quarterlyEstimate / 10000000) * 10000000; // Round to nearest $10M

  const nextQuarterEnd = getNextQuarterEnd();

  return {
    title: `Will Bring a Trailer gross over $${(line / 1000000).toFixed(0)}M in Q${getQuarter(nextQuarterEnd)} ${nextQuarterEnd.getFullYear()}?`,
    description: `This market resolves YES if the total gross sales on Bring a Trailer (bringatrailer.com) auction platform exceeds $${(line / 1000000).toFixed(0)} million during Q${getQuarter(nextQuarterEnd)} ${nextQuarterEnd.getFullYear()}.`,
    category: 'Economics / Automotive',
    resolution_source: 'Bring a Trailer official quarterly reports or aggregated public auction results',
    resolution_criteria: `Sum of all completed auction sale prices on bringatrailer.com from ${getQuarterStart(nextQuarterEnd).toISOString().slice(0, 10)} to ${nextQuarterEnd.toISOString().slice(0, 10)}. Resolves YES if total exceeds $${(line / 1000000).toFixed(0)}M, NO otherwise.`,
    expiration_date: nextQuarterEnd.toISOString().slice(0, 10),
    why_interesting: `BaT is the largest online collector car auction platform. Their quarterly gross sales reflect broader collector car market health and consumer spending on discretionary luxury goods. Recent quarterly average: ~$${(quarterlyEstimate / 1000000).toFixed(0)}M.`,
    data_backing: {
      recent_monthly_avg: avgMonthlyGross,
      quarterly_estimate: quarterlyEstimate,
      line,
      months_analyzed: monthlyGrosses.length,
    },
  };
}

function generateRecordSaleProposal(stats: any): MarketProposal {
  const currentRecord = stats.maxPrice;
  const threshold = Math.ceil(currentRecord / 100000) * 100000; // Round up to nearest 100k

  const nextQuarterEnd = getNextQuarterEnd();

  return {
    title: `Will any single BaT auction exceed $${(threshold / 1000).toFixed(0)}k in Q${getQuarter(nextQuarterEnd)} ${nextQuarterEnd.getFullYear()}?`,
    description: `This market resolves YES if any single vehicle auction on Bring a Trailer closes above $${(threshold / 1000).toFixed(0)},000 during the quarter.`,
    category: 'Economics / Automotive',
    resolution_source: 'Bring a Trailer public auction results',
    resolution_criteria: `At least one completed auction on bringatrailer.com with final sale price exceeding $${threshold.toLocaleString()} between ${getQuarterStart(nextQuarterEnd).toISOString().slice(0, 10)} and ${nextQuarterEnd.toISOString().slice(0, 10)}.`,
    expiration_date: nextQuarterEnd.toISOString().slice(0, 10),
    why_interesting: `Tracks the high end of the collector car market. Record sales often indicate market confidence and wealth effects. Current trailing 12-month high: $${(currentRecord / 1000).toFixed(0)}k.`,
    data_backing: {
      current_record: currentRecord,
      threshold,
      trailing_12mo_max: stats.maxPrice,
    },
  };
}

function generateMakeComparisonProposal(stats: any): MarketProposal {
  // Find top 2 makes by volume
  const [make1, make2] = stats.topMakes.slice(0, 2);

  const nextQuarterEnd = getNextQuarterEnd();

  return {
    title: `Will ${make1[0]} outsell ${make2[0]} on BaT in Q${getQuarter(nextQuarterEnd)} ${nextQuarterEnd.getFullYear()}?`,
    description: `This market resolves YES if more ${make1[0]} vehicles sell on Bring a Trailer than ${make2[0]} vehicles during the quarter.`,
    category: 'Economics / Automotive',
    resolution_source: 'Bring a Trailer public auction results',
    resolution_criteria: `Count of completed ${make1[0]} auctions vs ${make2[0]} auctions on bringatrailer.com. Ties resolve NO.`,
    expiration_date: nextQuarterEnd.toISOString().slice(0, 10),
    why_interesting: `${make1[0]} and ${make2[0]} are the top-selling makes on BaT. Their relative performance reflects brand sentiment and collector preferences. Trailing 12mo: ${make1[0]} ${make1[1].count} sales, ${make2[0]} ${make2[1].count} sales.`,
    data_backing: {
      make1: { name: make1[0], count: make1[1].count },
      make2: { name: make2[0], count: make2[1].count },
    },
  };
}

function generatePriceThresholdProposal(make: string, stats: any): MarketProposal {
  const makeData = stats.topMakes.find((m: any) => m[0] === make.toUpperCase());
  if (!makeData) return null as any;

  const threshold = Math.ceil(makeData[1].maxPrice / 50000) * 50000;
  const nextQuarterEnd = getNextQuarterEnd();

  return {
    title: `Will any ${make} sell for over $${(threshold / 1000).toFixed(0)}k on BaT in Q${getQuarter(nextQuarterEnd)}?`,
    description: `This market resolves YES if any ${make} vehicle sells above $${(threshold / 1000).toFixed(0)},000 on Bring a Trailer during the quarter.`,
    category: 'Economics / Automotive',
    resolution_source: 'Bring a Trailer public auction results',
    resolution_criteria: `At least one ${make} auction on bringatrailer.com with final sale price exceeding $${threshold.toLocaleString()}.`,
    expiration_date: nextQuarterEnd.toISOString().slice(0, 10),
    why_interesting: `${make} is a top brand on BaT with strong collector interest. Trailing 12mo ${make} high: $${(makeData[1].maxPrice / 1000).toFixed(0)}k, avg: $${(makeData[1].avgPrice / 1000).toFixed(0)}k.`,
    data_backing: {
      make,
      current_max: makeData[1].maxPrice,
      threshold,
      trailing_avg: makeData[1].avgPrice,
    },
  };
}

function generateMonthlyVolumeProposal(stats: any): MarketProposal {
  const monthlyCounts = stats.byMonth.slice(0, 12).map((m: any) => m[1].count);
  const avgMonthly = monthlyCounts.reduce((a: number, b: number) => a + b, 0) / monthlyCounts.length;

  const line = Math.round(avgMonthly / 50) * 50; // Round to nearest 50
  const nextMonthEnd = new Date();
  nextMonthEnd.setMonth(nextMonthEnd.getMonth() + 1);
  nextMonthEnd.setDate(0); // Last day of next month

  return {
    title: `Will BaT complete over ${line} auctions in ${nextMonthEnd.toLocaleString('default', { month: 'long' })} ${nextMonthEnd.getFullYear()}?`,
    description: `This market resolves YES if Bring a Trailer completes more than ${line} vehicle auctions during ${nextMonthEnd.toLocaleString('default', { month: 'long' })} ${nextMonthEnd.getFullYear()}.`,
    category: 'Economics / Automotive',
    resolution_source: 'Bring a Trailer public auction results',
    resolution_criteria: `Count of all completed (sold, not withdrawn) auctions on bringatrailer.com during the calendar month.`,
    expiration_date: nextMonthEnd.toISOString().slice(0, 10),
    why_interesting: `BaT auction volume reflects seller confidence and market liquidity. Trailing 12mo monthly average: ${Math.round(avgMonthly)} auctions.`,
    data_backing: {
      avg_monthly: avgMonthly,
      line,
      months_analyzed: monthlyCounts.length,
    },
  };
}

// ============ UTILS ============

function getNextQuarterEnd(): Date {
  const now = new Date();
  const quarter = Math.floor(now.getMonth() / 3);
  const nextQuarter = (quarter + 1) % 4;
  const year = nextQuarter === 0 ? now.getFullYear() + 1 : now.getFullYear();

  const endMonth = (nextQuarter + 1) * 3;
  return new Date(year, endMonth, 0); // Last day of quarter
}

function getQuarterStart(quarterEnd: Date): Date {
  const d = new Date(quarterEnd);
  d.setMonth(d.getMonth() - 2);
  d.setDate(1);
  return d;
}

function getQuarter(date: Date): number {
  return Math.floor(date.getMonth() / 3) + 1;
}

function formatProposalForSubmission(proposal: MarketProposal): string {
  return `
## ${proposal.title}

**Category:** ${proposal.category}

**Description:**
${proposal.description}

**Resolution Criteria:**
${proposal.resolution_criteria}

**Resolution Source:**
${proposal.resolution_source}

**Expiration:** ${proposal.expiration_date}

**Why This Market:**
${proposal.why_interesting}

---
*Generated from n-zero vehicle data platform (n-zero.dev)*
*Data backing: ${JSON.stringify(proposal.data_backing, null, 2)}*
`;
}

// ============ MAIN ============

async function main() {
  console.log('=== KALSHI MARKET PROPOSAL GENERATOR ===\n');
  console.log('Analyzing n-zero vehicle data...\n');

  const stats = await getBaTStats();
  if (!stats) {
    console.log('No data available');
    return;
  }

  console.log('Data summary:');
  console.log(`  Total auctions (12mo): ${stats.totalAuctions}`);
  console.log(`  Total gross: $${(stats.totalGross / 1000000).toFixed(1)}M`);
  console.log(`  Avg price: $${(stats.avgPrice / 1000).toFixed(0)}k`);
  console.log(`  Max price: $${(stats.maxPrice / 1000).toFixed(0)}k`);
  console.log(`  Top makes: ${stats.topMakes.slice(0, 5).map((m: any) => m[0]).join(', ')}`);

  const proposals: MarketProposal[] = [];

  // Generate proposals
  console.log('\n=== GENERATING PROPOSALS ===\n');

  console.log('1. Quarterly Gross Sales...');
  proposals.push(generateQuarterlyGrossProposal(stats));

  console.log('2. Record Sale Threshold...');
  proposals.push(generateRecordSaleProposal(stats));

  console.log('3. Make vs Make Competition...');
  proposals.push(generateMakeComparisonProposal(stats));

  console.log('4. Monthly Volume...');
  proposals.push(generateMonthlyVolumeProposal(stats));

  console.log('5. Porsche Price Threshold...');
  const porscheProposal = generatePriceThresholdProposal('Porsche', stats);
  if (porscheProposal) proposals.push(porscheProposal);

  console.log('6. Ferrari Price Threshold...');
  const ferrariProposal = generatePriceThresholdProposal('Ferrari', stats);
  if (ferrariProposal) proposals.push(ferrariProposal);

  // Output proposals
  console.log('\n' + '='.repeat(60));
  console.log('KALSHI MARKET PROPOSALS');
  console.log('='.repeat(60));

  for (const proposal of proposals) {
    console.log(formatProposalForSubmission(proposal));
  }

  // Save to file
  const outputPath = `logs/kalshi-proposals-${new Date().toISOString().slice(0, 10)}.md`;
  const output = proposals.map(formatProposalForSubmission).join('\n\n');
  require('fs').writeFileSync(outputPath, output);
  console.log(`\nSaved to: ${outputPath}`);

  console.log('\n=== SUBMISSION ===');
  console.log('Submit these at: https://kalshi.com/ideas/feed');
  console.log('\nNote: Kalshi reviews for CFTC compliance and manipulation resistance.');
  console.log('Markets based on public BaT data should qualify.');
}

main().catch(console.error);

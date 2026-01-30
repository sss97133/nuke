#!/usr/bin/env npx tsx
/**
 * EXPORT COMPARISON RESULTS TO CSV
 *
 * Reads JSON reports from extraction comparison runs and exports to CSV
 * for easy graphing in Excel, Google Sheets, or charting tools.
 *
 * Output files:
 * - summary.csv - High-level comparison (one row per URL)
 * - methods.csv - Detailed method breakdown (one row per extraction attempt)
 * - investor-deck.csv - Aggregate stats for investor presentations
 *
 * Usage:
 *   npx tsx export-comparison-csv.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const RESULTS_DIR = '/Users/skylar/nuke/extraction-comparison-results';
const OUTPUT_DIR = '/Users/skylar/nuke/extraction-comparison-results/csv';

interface ExtractionResult {
  method: 'naive_fetch' | 'playwright';
  tier: 'basic' | 'compute';
  success: boolean;
  timing_ms: number;
  error?: string;
  title?: string;
  content_length: number;
  markdown_length: number;
  image_count: number;
  has_structured_data: boolean;
  vehicle_data?: {
    year?: number;
    make?: string;
    model?: string;
    price?: number;
    vin?: string;
    mileage?: number;
    images?: string[];
  };
  quality_score: number;
}

interface URLComparison {
  url: string;
  domain: string;
  timestamp: string;
  results: ExtractionResult[];
  naive_score: number;
  playwright_score: number;
  score_delta: number;
  naive_success: boolean;
  playwright_success: boolean;
  difficulty: 'easy' | 'medium' | 'hard';
}

interface BatchReport {
  generated_at: string;
  total_urls: number;
  comparisons: URLComparison[];
  summary: {
    naive_success_rate: number;
    playwright_success_rate: number;
    naive_avg_quality: number;
    playwright_avg_quality: number;
    avg_score_delta: number;
    avg_timing_naive: number;
    avg_timing_playwright: number;
    easy_count: number;
    medium_count: number;
    hard_count: number;
    urls_only_playwright_succeeded: number;
    urls_playwright_significantly_better: number;
  };
}

function escapeCSV(value: any): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function loadAllReports(): URLComparison[] {
  const files = fs.readdirSync(RESULTS_DIR).filter(f => f.endsWith('.json'));
  const allComparisons: URLComparison[] = [];

  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, file), 'utf-8')) as BatchReport;
      allComparisons.push(...data.comparisons);
    } catch (err) {
      console.log(`Skipping invalid file: ${file}`);
    }
  }

  // Dedupe by URL, keeping the most recent
  const byUrl = new Map<string, URLComparison>();
  for (const c of allComparisons) {
    const existing = byUrl.get(c.url);
    if (!existing || new Date(c.timestamp) > new Date(existing.timestamp)) {
      byUrl.set(c.url, c);
    }
  }

  return Array.from(byUrl.values());
}

function exportSummaryCSV(comparisons: URLComparison[]): void {
  const headers = [
    'url',
    'domain',
    'timestamp',
    'naive_success',
    'playwright_success',
    'naive_score',
    'playwright_score',
    'score_delta',
    'difficulty',
    'year',
    'make',
    'model',
    'price',
    'images_found',
  ];

  const rows = comparisons.map(c => {
    // Get best vehicle data from any successful extraction
    const successResults = c.results.filter(r => r.success && r.vehicle_data);
    const bestResult = successResults.sort((a, b) => b.quality_score - a.quality_score)[0];
    const v = bestResult?.vehicle_data;

    return [
      c.url,
      c.domain,
      c.timestamp,
      c.naive_success ? 1 : 0,
      c.playwright_success ? 1 : 0,
      c.naive_score,
      c.playwright_score,
      c.score_delta,
      c.difficulty,
      v?.year || '',
      v?.make || '',
      v?.model || '',
      v?.price || '',
      v?.images?.length || 0,
    ].map(escapeCSV).join(',');
  });

  const csv = [headers.join(','), ...rows].join('\n');
  fs.writeFileSync(path.join(OUTPUT_DIR, 'summary.csv'), csv);
  console.log(`✓ Exported summary.csv (${comparisons.length} rows)`);
}

function exportMethodsCSV(comparisons: URLComparison[]): void {
  const headers = [
    'url',
    'domain',
    'method',
    'tier',
    'success',
    'quality_score',
    'timing_ms',
    'content_length',
    'markdown_length',
    'image_count',
    'has_structured_data',
    'error',
  ];

  const rows: string[] = [];
  for (const c of comparisons) {
    for (const r of c.results) {
      rows.push([
        c.url,
        c.domain,
        r.method,
        r.tier,
        r.success ? 1 : 0,
        r.quality_score,
        r.timing_ms,
        r.content_length,
        r.markdown_length,
        r.image_count,
        r.has_structured_data ? 1 : 0,
        r.error || '',
      ].map(escapeCSV).join(','));
    }
  }

  const csv = [headers.join(','), ...rows].join('\n');
  fs.writeFileSync(path.join(OUTPUT_DIR, 'methods.csv'), csv);
  console.log(`✓ Exported methods.csv (${rows.length} rows)`);
}

function exportInvestorDeckCSV(comparisons: URLComparison[]): void {
  // Aggregate stats by category
  const total = comparisons.length;
  const naiveSuccessCount = comparisons.filter(c => c.naive_success).length;
  const playwrightSuccessCount = comparisons.filter(c => c.playwright_success).length;

  const avgNaiveScore = comparisons.reduce((a, c) => a + c.naive_score, 0) / total;
  const avgPlaywrightScore = comparisons.reduce((a, c) => a + c.playwright_score, 0) / total;

  const naiveResults = comparisons.flatMap(c => c.results.filter(r => r.method === 'naive_fetch'));
  const playwrightResults = comparisons.flatMap(c => c.results.filter(r => r.method === 'playwright'));

  const easyCount = comparisons.filter(c => c.difficulty === 'easy').length;
  const mediumCount = comparisons.filter(c => c.difficulty === 'medium').length;
  const hardCount = comparisons.filter(c => c.difficulty === 'hard').length;

  const stats = [
    ['Metric', 'Value', 'Category'],
    ['Total URLs Tested', total, 'Overview'],
    ['', '', ''],
    ['Naive Success Rate', `${(naiveSuccessCount / total * 100).toFixed(1)}%`, 'Success Rates'],
    ['Playwright Success Rate', `${(playwrightSuccessCount / total * 100).toFixed(1)}%`, 'Success Rates'],
    ['Success Rate Delta', `${((playwrightSuccessCount - naiveSuccessCount) / total * 100).toFixed(1)}%`, 'Success Rates'],
    ['', '', ''],
    ['Naive Avg Quality', avgNaiveScore.toFixed(1), 'Quality Scores'],
    ['Playwright Avg Quality', avgPlaywrightScore.toFixed(1), 'Quality Scores'],
    ['Quality Improvement', `+${(avgPlaywrightScore - avgNaiveScore).toFixed(1)}`, 'Quality Scores'],
    ['', '', ''],
    ['Naive Fetch Success', `${(naiveResults.filter(r => r.success).length / naiveResults.length * 100).toFixed(1)}%`, 'Method Breakdown'],
    ['Playwright Success', `${(playwrightResults.filter(r => r.success).length / playwrightResults.length * 100).toFixed(1)}%`, 'Method Breakdown'],
    ['', '', ''],
    ['Avg Time Naive (ms)', Math.round(naiveResults.reduce((a, r) => a + r.timing_ms, 0) / naiveResults.length), 'Timing'],
    ['Avg Time Playwright (ms)', Math.round(playwrightResults.reduce((a, r) => a + r.timing_ms, 0) / playwrightResults.length), 'Timing'],
    ['', '', ''],
    ['Easy Sites (naive works)', easyCount, 'Site Difficulty'],
    ['Medium Sites (need PW)', mediumCount, 'Site Difficulty'],
    ['Hard Sites (neither great)', hardCount, 'Site Difficulty'],
    ['', '', ''],
    ['URLs Only Playwright Succeeded', comparisons.filter(c => !c.naive_success && c.playwright_success).length, 'Value Proposition'],
    ['URLs PW 20+ Points Better', comparisons.filter(c => c.score_delta > 20).length, 'Value Proposition'],
    ['URLs Naive Was Better', comparisons.filter(c => c.score_delta < 0).length, 'Value Proposition'],
  ];

  const csv = stats.map(row => row.map(escapeCSV).join(',')).join('\n');
  fs.writeFileSync(path.join(OUTPUT_DIR, 'investor-deck.csv'), csv);
  console.log(`✓ Exported investor-deck.csv`);
}

function exportDomainBreakdownCSV(comparisons: URLComparison[]): void {
  // Group by domain
  const byDomain = new Map<string, URLComparison[]>();
  for (const c of comparisons) {
    const list = byDomain.get(c.domain) || [];
    list.push(c);
    byDomain.set(c.domain, list);
  }

  const headers = [
    'domain',
    'urls_tested',
    'naive_success_rate',
    'playwright_success_rate',
    'avg_naive_score',
    'avg_playwright_score',
    'avg_score_delta',
    'recommendation',
  ];

  const rows: string[] = [];
  for (const [domain, comps] of byDomain) {
    const count = comps.length;
    const naiveSuccess = comps.filter(c => c.naive_success).length;
    const playwrightSuccess = comps.filter(c => c.playwright_success).length;
    const avgNaive = comps.reduce((a, c) => a + c.naive_score, 0) / count;
    const avgPlaywright = comps.reduce((a, c) => a + c.playwright_score, 0) / count;
    const avgDelta = avgPlaywright - avgNaive;

    let recommendation = 'NAIVE_OK';
    if (naiveSuccess / count < 0.5 && playwrightSuccess / count > 0.8) {
      recommendation = 'PLAYWRIGHT_REQUIRED';
    } else if (avgDelta > 20) {
      recommendation = 'PLAYWRIGHT_RECOMMENDED';
    } else if (avgDelta > 10) {
      recommendation = 'PLAYWRIGHT_HELPFUL';
    }

    rows.push([
      domain,
      count,
      `${(naiveSuccess / count * 100).toFixed(1)}%`,
      `${(playwrightSuccess / count * 100).toFixed(1)}%`,
      avgNaive.toFixed(1),
      avgPlaywright.toFixed(1),
      avgDelta.toFixed(1),
      recommendation,
    ].map(escapeCSV).join(','));
  }

  // Sort by delta descending (playwright most valuable first)
  rows.sort((a, b) => {
    const deltaA = parseFloat(a.split(',')[6]);
    const deltaB = parseFloat(b.split(',')[6]);
    return deltaB - deltaA;
  });

  const csv = [headers.join(','), ...rows].join('\n');
  fs.writeFileSync(path.join(OUTPUT_DIR, 'domain-breakdown.csv'), csv);
  console.log(`✓ Exported domain-breakdown.csv (${byDomain.size} domains)`);
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  EXPORT COMPARISON RESULTS TO CSV                          ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Load all reports
  const comparisons = loadAllReports();

  if (comparisons.length === 0) {
    console.log('No comparison data found. Run comparison first:');
    console.log('  npm run compare:test-sites');
    return;
  }

  console.log(`Loaded ${comparisons.length} unique URL comparisons\n`);

  // Export all formats
  exportSummaryCSV(comparisons);
  exportMethodsCSV(comparisons);
  exportInvestorDeckCSV(comparisons);
  exportDomainBreakdownCSV(comparisons);

  console.log(`\n✅ All exports saved to: ${OUTPUT_DIR}`);
  console.log('\nFiles ready for graphing:');
  console.log('  - summary.csv        → Per-URL comparison');
  console.log('  - methods.csv        → All extraction attempts');
  console.log('  - investor-deck.csv  → Aggregate stats');
  console.log('  - domain-breakdown.csv → Per-domain recommendations');
}

main().catch(console.error);

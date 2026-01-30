#!/usr/bin/env npx tsx
/**
 * PARALLEL EXTRACTION COMPARISON: NAIVE vs PLAYWRIGHT
 *
 * Investor Story Builder: Shows extraction quality at different compute levels.
 *
 * Methods compared:
 * - NAIVE: Direct fetch + DOM parsing (fast, cheap, breaks on JS sites)
 * - PLAYWRIGHT: Headless browser (handles JS, lazy loading, SPAs)
 *
 * The story: "Naive fetch costs nothing but only works on simple sites.
 * Playwright costs more compute but dramatically increases coverage."
 *
 * Output:
 * - Per-URL comparison of both methods
 * - Success rates by method
 * - Extraction quality scores
 * - Timing data
 * - Domain difficulty classification
 *
 * Usage:
 *   npx tsx parallel-free-vs-paid-extractor.ts <url>
 *   npx tsx parallel-free-vs-paid-extractor.ts --batch <file.txt>
 *   npx tsx parallel-free-vs-paid-extractor.ts --test-sites
 *   npx tsx parallel-free-vs-paid-extractor.ts --generate-report
 */

import { chromium, Browser, Page } from 'playwright';
import { JSDOM } from 'jsdom';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

// Try to load Readability, use fallback if not available
let Readability: any;
try {
  Readability = require('@mozilla/readability').Readability;
} catch {
  Readability = null;
}

// ============================================================
// Configuration
// ============================================================

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const TIMEOUT_MS = 30_000;
const RESULTS_DIR = '/Users/skylar/nuke/extraction-comparison-results';

// Test sites representing different extraction difficulty levels
const TEST_SITES = {
  easy: [
    'https://bringatrailer.com/listing/1988-porsche-911-carrera-targa-50/',
    'https://www.carsandbids.com/auctions/rlYwNdkZ/2011-mercedes-benz-e63-amg-wagon',
    'https://www.hemmings.com/classifieds/dealer/chevrolet/c10/2729389.html',
  ],
  medium: [
    'https://www.streetsideclassics.com/vehicles/1234-cha/1969-chevrolet-camaro',
    'https://www.dupontregistry.com/autos/listing/2024/porsche/911/4016155',
    'https://www.classicdriver.com/en/car/porsche/911/1973/1023456',
  ],
  hard: [
    'https://rfrm.com/inventory/',  // Heavy JS, lazy loading
    'https://www.pcarmarket.com/auction/1990-porsche-964-c4-cabriolet/',
    'https://collectingcars.com/for-sale/1989-porsche-911-carrera-3-2-targa-g50',
  ],
  protected: [
    'https://www.facebook.com/marketplace/item/123456789/',
    'https://www.instagram.com/p/ABC123/',
  ],
};

// Ensure results directory exists
try {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
} catch {}

// ============================================================
// Types
// ============================================================

interface ExtractionResult {
  method: 'naive_fetch' | 'playwright';
  tier: 'basic' | 'compute';  // basic = cheap/fast, compute = more resources
  success: boolean;
  timing_ms: number;
  error?: string;

  // Content quality metrics
  title?: string;
  content_length: number;
  markdown_length: number;
  image_count: number;
  has_structured_data: boolean;

  // Vehicle-specific extraction
  vehicle_data?: {
    year?: number;
    make?: string;
    model?: string;
    price?: number;
    vin?: string;
    mileage?: number;
    images?: string[];
  };

  // Quality score (0-100)
  quality_score: number;
}

interface URLComparison {
  url: string;
  domain: string;
  timestamp: string;
  results: ExtractionResult[];

  // Summary
  naive_score: number;
  playwright_score: number;
  score_delta: number;  // playwright - naive (positive = playwright better)
  naive_success: boolean;
  playwright_success: boolean;
  difficulty: 'easy' | 'medium' | 'hard';  // based on what worked
}

interface BatchReport {
  generated_at: string;
  total_urls: number;
  comparisons: URLComparison[];

  // Aggregate stats
  summary: {
    naive_success_rate: number;
    playwright_success_rate: number;
    naive_avg_quality: number;
    playwright_avg_quality: number;
    avg_score_delta: number;

    // Timing
    avg_timing_naive: number;
    avg_timing_playwright: number;

    // Difficulty distribution
    easy_count: number;      // naive worked fine
    medium_count: number;    // playwright needed
    hard_count: number;      // nothing worked well

    // Value proposition
    urls_only_playwright_succeeded: number;
    urls_playwright_significantly_better: number;  // score delta > 20
  };
}

// ============================================================
// Extraction Methods
// ============================================================

/**
 * METHOD 1: Naive Fetch + DOM parsing (BASIC TIER)
 * Fast and cheap but breaks on JS-heavy sites
 */
async function extractNaive(url: string): Promise<ExtractionResult> {
  const start = Date.now();
  const result: ExtractionResult = {
    method: 'naive_fetch',
    tier: 'basic',
    success: false,
    timing_ms: 0,
    content_length: 0,
    markdown_length: 0,
    image_count: 0,
    has_structured_data: false,
    quality_score: 0,
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      result.error = `HTTP ${response.status}`;
      result.timing_ms = Date.now() - start;
      return result;
    }

    const html = await response.text();
    result.content_length = html.length;

    // Parse with JSDOM - simple extraction (Readability often fails on SPAs)
    const dom = new JSDOM(html, { url });
    const doc = dom.window.document;

    const title = doc.title || doc.querySelector('h1')?.textContent?.trim() || '';
    const textContent = doc.body?.textContent || '';

    if (!textContent || textContent.length < 100) {
      result.error = 'Failed to extract content';
      result.timing_ms = Date.now() - start;
      return result;
    }

    result.title = title;
    result.markdown_length = textContent.length;

    // Count images
    const imgMatches = html.match(/<img[^>]+src=["']([^"']+)["']/gi) || [];
    result.image_count = imgMatches.length;

    // Check for JSON-LD
    result.has_structured_data = html.includes('application/ld+json');

    // Extract vehicle data
    result.vehicle_data = extractVehicleData(textContent, html);

    // Calculate quality score
    result.quality_score = calculateQualityScore(result);
    result.success = true;

  } catch (err: any) {
    result.error = err.message || 'Unknown error';
  }

  result.timing_ms = Date.now() - start;
  return result;
}

/**
 * METHOD 2: Playwright Browser (COMPUTE TIER)
 * Handles JS rendering, lazy loading, SPAs - but uses more resources
 */
async function extractPlaywright(url: string, browser: Browser): Promise<ExtractionResult> {
  const start = Date.now();
  const result: ExtractionResult = {
    method: 'playwright',
    tier: 'compute',
    success: false,
    timing_ms: 0,
    content_length: 0,
    markdown_length: 0,
    image_count: 0,
    has_structured_data: false,
    quality_score: 0,
  };

  let page: Page | null = null;

  try {
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1920, height: 1080 },
    });
    page = await context.newPage();

    // Navigate with timeout
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUT_MS
    });

    // Wait for content to load
    await page.waitForTimeout(2000);

    // Scroll to trigger lazy loading
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight / 2);
    });
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(1000);

    // Extract content
    const pageData = await page.evaluate(() => {
      const title = document.title || document.querySelector('h1')?.textContent || '';
      const bodyText = document.body.innerText || '';
      const html = document.documentElement.outerHTML;

      // Get all images
      const images = [...document.querySelectorAll('img')]
        .map(img => img.src || img.getAttribute('data-src'))
        .filter(Boolean);

      // Check for structured data
      const hasStructuredData = !!document.querySelector('script[type="application/ld+json"]');

      return {
        title: title.trim(),
        bodyText,
        html,
        images,
        hasStructuredData,
      };
    });

    result.title = pageData.title;
    result.content_length = pageData.html.length;
    result.markdown_length = pageData.bodyText.length;
    result.image_count = pageData.images.length;
    result.has_structured_data = pageData.hasStructuredData;

    if (pageData.bodyText.length < 100) {
      result.error = 'Insufficient content extracted';
      result.timing_ms = Date.now() - start;
      await page.close();
      return result;
    }

    // Extract vehicle data
    result.vehicle_data = extractVehicleData(pageData.bodyText, pageData.html);
    result.vehicle_data!.images = pageData.images.slice(0, 20);

    // Calculate quality score
    result.quality_score = calculateQualityScore(result);
    result.success = true;

  } catch (err: any) {
    result.error = err.message || 'Unknown error';
  } finally {
    if (page) {
      try { await page.close(); } catch {}
    }
  }

  result.timing_ms = Date.now() - start;
  return result;
}

// ============================================================
// Vehicle Data Extraction
// ============================================================

function extractVehicleData(text: string, html: string): ExtractionResult['vehicle_data'] {
  const combined = text + ' ' + html;

  // Year (1920-2026)
  const yearMatch = combined.match(/\b(19[2-9]\d|20[0-2]\d)\b/);
  const year = yearMatch ? parseInt(yearMatch[1]) : undefined;

  // Price
  const priceMatch = combined.match(/\$\s*([\d,]+)(?:\.\d{2})?/);
  const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : undefined;

  // VIN (17 chars, no I/O/Q)
  const vinMatch = combined.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
  const vin = vinMatch?.[1];

  // Mileage
  const mileageMatch = combined.match(/(\d{1,3}[,.]?\d{3})\s*(miles?|mi\.?|kilometers?|km)/i);
  const mileage = mileageMatch ? parseInt(mileageMatch[1].replace(/[,.]/g, '')) : undefined;

  // Make detection
  const makes = [
    'Porsche', 'Ferrari', 'Lamborghini', 'Mercedes', 'BMW', 'Audi',
    'Chevrolet', 'Chevy', 'Ford', 'Dodge', 'Plymouth', 'Pontiac', 'Buick', 'Cadillac',
    'Jaguar', 'Aston Martin', 'Bentley', 'Rolls-Royce', 'Maserati', 'Alfa Romeo',
    'Toyota', 'Honda', 'Nissan', 'Mazda', 'Datsun', 'Lexus',
    'Jeep', 'Lincoln', 'Chrysler', 'AMC', 'Studebaker', 'Packard',
    'MG', 'Triumph', 'Austin-Healey', 'Lotus', 'McLaren',
  ];

  let make: string | undefined;
  for (const m of makes) {
    const pattern = new RegExp(`\\b${m.replace(/-/g, '[-\\s]?')}\\b`, 'i');
    if (pattern.test(combined)) {
      make = m === 'Chevy' ? 'Chevrolet' : m;
      break;
    }
  }

  // Model (word after make)
  let model: string | undefined;
  if (make) {
    const afterMake = combined.split(new RegExp(make, 'i'))[1];
    if (afterMake) {
      const modelMatch = afterMake.match(/^[\s\-:]*([A-Za-z0-9\-]+(?:\s+[A-Za-z0-9\-]+)?)/);
      model = modelMatch?.[1]?.trim();
      if (model && model.length < 2) model = undefined;
    }
  }

  // Images from HTML
  const imgMatches = html.match(/src=["']([^"']+(?:jpg|jpeg|png|webp)[^"']*)["']/gi) || [];
  const images = imgMatches
    .map(m => m.match(/src=["']([^"']+)["']/)?.[1])
    .filter(Boolean) as string[];

  return { year, make, model, price, vin, mileage, images: images.slice(0, 20) };
}

// ============================================================
// Quality Scoring
// ============================================================

function calculateQualityScore(result: ExtractionResult): number {
  let score = 0;

  // Base content score (0-30)
  if (result.markdown_length > 5000) score += 30;
  else if (result.markdown_length > 2000) score += 25;
  else if (result.markdown_length > 500) score += 15;
  else if (result.markdown_length > 100) score += 5;

  // Image score (0-20)
  if (result.image_count >= 20) score += 20;
  else if (result.image_count >= 10) score += 15;
  else if (result.image_count >= 5) score += 10;
  else if (result.image_count >= 1) score += 5;

  // Structured data bonus (0-10)
  if (result.has_structured_data) score += 10;

  // Vehicle data score (0-40)
  const v = result.vehicle_data;
  if (v) {
    if (v.year) score += 8;
    if (v.make) score += 8;
    if (v.model) score += 6;
    if (v.price) score += 8;
    if (v.vin) score += 5;
    if (v.mileage) score += 5;
  }

  return Math.min(100, score);
}

// ============================================================
// Main Comparison Logic
// ============================================================

async function compareExtractionMethods(url: string, browser: Browser): Promise<URLComparison> {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`URL: ${url}`);
  console.log(`${'─'.repeat(60)}`);

  const domain = new URL(url).hostname;

  // Run both methods in parallel
  console.log('  Running extractions in parallel...');
  const [naiveResult, playwrightResult] = await Promise.all([
    extractNaive(url),
    extractPlaywright(url, browser),
  ]);

  const results = [naiveResult, playwrightResult];

  // Log results
  for (const r of results) {
    const status = r.success ? '✓' : '✗';
    const tier = r.tier === 'basic' ? '⚡' : '🖥️';
    console.log(`  ${status} ${tier} ${r.method.padEnd(15)} score=${r.quality_score.toString().padStart(3)} time=${r.timing_ms}ms ${r.error || ''}`);
  }

  // Determine difficulty based on what worked
  let difficulty: 'easy' | 'medium' | 'hard';
  if (naiveResult.success && naiveResult.quality_score >= 60) {
    difficulty = 'easy';  // Naive fetch works fine
  } else if (playwrightResult.success && playwrightResult.quality_score >= 60) {
    difficulty = 'medium';  // Need Playwright
  } else {
    difficulty = 'hard';  // Neither worked well
  }

  const comparison: URLComparison = {
    url,
    domain,
    timestamp: new Date().toISOString(),
    results,
    naive_score: naiveResult.quality_score,
    playwright_score: playwrightResult.quality_score,
    score_delta: playwrightResult.quality_score - naiveResult.quality_score,
    naive_success: naiveResult.success,
    playwright_success: playwrightResult.success,
    difficulty,
  };

  // Summary line
  const deltaStr = comparison.score_delta > 0
    ? `+${comparison.score_delta} Playwright better`
    : comparison.score_delta < 0
    ? `${Math.abs(comparison.score_delta)} Naive better`
    : '= tied';
  console.log(`  → Naive: ${naiveResult.quality_score}, Playwright: ${playwrightResult.quality_score} (${deltaStr}) [${difficulty}]`);

  return comparison;
}

async function runBatchComparison(urls: string[]): Promise<BatchReport> {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  NAIVE vs PLAYWRIGHT EXTRACTION COMPARISON                 ║');
  console.log('║  Building investor story with real data                    ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`\nProcessing ${urls.length} URLs...`);

  const browser = await chromium.launch({ headless: true });
  const comparisons: URLComparison[] = [];

  try {
    for (const url of urls) {
      try {
        const comparison = await compareExtractionMethods(url, browser);
        comparisons.push(comparison);
      } catch (err: any) {
        console.log(`  ❌ Failed to process ${url}: ${err.message}`);
      }
    }
  } finally {
    await browser.close();
  }

  // Calculate aggregate stats
  const totalUrls = comparisons.length;
  const naiveSuccessCount = comparisons.filter(c => c.naive_success).length;
  const playwrightSuccessCount = comparisons.filter(c => c.playwright_success).length;

  const naiveScores = comparisons.map(c => c.naive_score);
  const playwrightScores = comparisons.map(c => c.playwright_score);

  const avgNaiveScore = naiveScores.reduce((a, b) => a + b, 0) / totalUrls || 0;
  const avgPlaywrightScore = playwrightScores.reduce((a, b) => a + b, 0) / totalUrls || 0;

  // Method-specific stats
  const naiveResults = comparisons.flatMap(c => c.results.filter(r => r.method === 'naive_fetch'));
  const playwrightResults = comparisons.flatMap(c => c.results.filter(r => r.method === 'playwright'));

  const report: BatchReport = {
    generated_at: new Date().toISOString(),
    total_urls: totalUrls,
    comparisons,
    summary: {
      naive_success_rate: naiveSuccessCount / totalUrls * 100,
      playwright_success_rate: playwrightSuccessCount / totalUrls * 100,
      naive_avg_quality: Math.round(avgNaiveScore),
      playwright_avg_quality: Math.round(avgPlaywrightScore),
      avg_score_delta: Math.round(avgPlaywrightScore - avgNaiveScore),

      avg_timing_naive: Math.round(naiveResults.reduce((a, r) => a + r.timing_ms, 0) / naiveResults.length) || 0,
      avg_timing_playwright: Math.round(playwrightResults.reduce((a, r) => a + r.timing_ms, 0) / playwrightResults.length) || 0,

      easy_count: comparisons.filter(c => c.difficulty === 'easy').length,
      medium_count: comparisons.filter(c => c.difficulty === 'medium').length,
      hard_count: comparisons.filter(c => c.difficulty === 'hard').length,

      urls_only_playwright_succeeded: comparisons.filter(c => !c.naive_success && c.playwright_success).length,
      urls_playwright_significantly_better: comparisons.filter(c => c.score_delta > 20).length,
    },
  };

  return report;
}

// ============================================================
// Database Persistence
// ============================================================

async function saveComparisonToDb(comparison: URLComparison): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;

  try {
    // Call edge function to save
    const response = await fetch(`${SUPABASE_URL}/functions/v1/save-extraction-comparison`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify(comparison),
    });

    const result = await response.json();

    if (!response.ok || result.error) {
      console.log(`    ⚠ DB: ${result.error || response.statusText}`);
      return false;
    }

    return true;
  } catch (err: any) {
    console.log(`    ⚠ DB error: ${err.message}`);
    return false;
  }
}

async function saveBatchToDb(comparisons: URLComparison[]): Promise<number> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.log('  (No Supabase credentials - skipping DB save)');
    return 0;
  }

  console.log(`\n  Saving ${comparisons.length} comparisons to database...`);
  let saved = 0;
  let failed = 0;

  for (const c of comparisons) {
    const success = await saveComparisonToDb(c);
    if (success) {
      saved++;
    } else {
      failed++;
    }
  }

  if (saved > 0) {
    console.log(`  ✓ Saved ${saved} to DB${failed > 0 ? `, ${failed} failed` : ''}`);
  } else if (failed > 0) {
    console.log(`  ⚠ All ${failed} DB saves failed - check if table exists`);
  }

  return saved;
}

function printInvestorSummary(report: BatchReport): void {
  const s = report.summary;

  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║              EXTRACTION COMPARISON SUMMARY                 ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log('║                                                            ║');
  console.log(`║  URLs Analyzed: ${report.total_urls.toString().padStart(4)}                                      ║`);
  console.log('║                                                            ║');
  console.log('║  SUCCESS RATES:                                            ║');
  console.log(`║    ⚡ Naive Fetch:   ${s.naive_success_rate.toFixed(1).padStart(5)}%                              ║`);
  console.log(`║    🖥️  Playwright:   ${s.playwright_success_rate.toFixed(1).padStart(5)}%                              ║`);
  console.log('║                                                            ║');
  console.log('║  QUALITY SCORES (0-100):                                   ║');
  console.log(`║    ⚡ Naive Avg:     ${s.naive_avg_quality.toString().padStart(3)}                                  ║`);
  console.log(`║    🖥️  Playwright:   ${s.playwright_avg_quality.toString().padStart(3)}                                  ║`);
  console.log(`║    Δ  Improvement:  ${s.avg_score_delta > 0 ? '+' : ''}${s.avg_score_delta.toString().padStart(2)}                                  ║`);
  console.log('║                                                            ║');
  console.log('║  TIMING:                                                   ║');
  console.log(`║    ⚡ Naive Fetch:   ${s.avg_timing_naive.toString().padStart(5)}ms avg                        ║`);
  console.log(`║    🖥️  Playwright:   ${s.avg_timing_playwright.toString().padStart(5)}ms avg                        ║`);
  console.log('║                                                            ║');
  console.log('║  SITE DIFFICULTY:                                          ║');
  console.log(`║    Easy (naive works):   ${s.easy_count.toString().padStart(3)}                               ║`);
  console.log(`║    Medium (need PW):     ${s.medium_count.toString().padStart(3)}                               ║`);
  console.log(`║    Hard (neither great): ${s.hard_count.toString().padStart(3)}                               ║`);
  console.log('║                                                            ║');
  console.log('║  VALUE OF PLAYWRIGHT:                                      ║');
  console.log(`║    Only PW succeeded: ${s.urls_only_playwright_succeeded.toString().padStart(3)}                            ║`);
  console.log(`║    PW 20+ pts better: ${s.urls_playwright_significantly_better.toString().padStart(3)}                            ║`);
  console.log('║                                                            ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();
}

// ============================================================
// CLI
// ============================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
NAIVE vs PLAYWRIGHT EXTRACTION COMPARISON

Compares cheap/fast naive fetch against compute-heavy Playwright
to show which sites need browser rendering.

Usage:
  npx tsx parallel-free-vs-paid-extractor.ts <url>
  npx tsx parallel-free-vs-paid-extractor.ts --batch <file.txt>
  npx tsx parallel-free-vs-paid-extractor.ts --test-sites
  npx tsx parallel-free-vs-paid-extractor.ts --generate-report

Options:
  <url>             Compare extraction methods on a single URL
  --batch <file>    Process URLs from file (one per line)
  --test-sites      Run against curated test sites (easy/medium/hard)
  --generate-report Generate full investor report from recent results
`);
    return;
  }

  if (args[0] === '--test-sites') {
    // Run full test suite
    const allUrls = [
      ...TEST_SITES.easy,
      ...TEST_SITES.medium,
      ...TEST_SITES.hard,
    ];

    const report = await runBatchComparison(allUrls);
    printInvestorSummary(report);

    // Save to database
    await saveBatchToDb(report.comparisons);

    // Save report
    const filename = `${RESULTS_DIR}/comparison-${Date.now()}.json`;
    fs.writeFileSync(filename, JSON.stringify(report, null, 2));
    console.log(`Report saved: ${filename}`);

  } else if (args[0] === '--batch' && args[1]) {
    // Process URLs from file
    const urls = fs.readFileSync(args[1], 'utf-8')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && l.startsWith('http'));

    if (urls.length === 0) {
      console.log('No valid URLs found in file');
      return;
    }

    const report = await runBatchComparison(urls);
    printInvestorSummary(report);

    // Save to database
    await saveBatchToDb(report.comparisons);

    // Save report
    const filename = `${RESULTS_DIR}/comparison-${Date.now()}.json`;
    fs.writeFileSync(filename, JSON.stringify(report, null, 2));
    console.log(`Report saved: ${filename}`);

  } else if (args[0] === '--generate-report') {
    // Aggregate existing reports
    const files = fs.readdirSync(RESULTS_DIR).filter(f => f.endsWith('.json'));

    if (files.length === 0) {
      console.log('No existing reports found. Run --test-sites first.');
      return;
    }

    const allComparisons: URLComparison[] = [];
    for (const file of files) {
      const data = JSON.parse(fs.readFileSync(`${RESULTS_DIR}/${file}`, 'utf-8')) as BatchReport;
      allComparisons.push(...data.comparisons);
    }

    // Dedupe by URL
    const seen = new Set<string>();
    const unique = allComparisons.filter(c => {
      if (seen.has(c.url)) return false;
      seen.add(c.url);
      return true;
    });

    console.log(`Aggregating ${unique.length} unique URL comparisons from ${files.length} reports`);

    // Rebuild report with aggregate data
    const totalUrls = unique.length;
    const naiveSuccessCount = unique.filter(c => c.naive_success).length;
    const playwrightSuccessCount = unique.filter(c => c.playwright_success).length;

    const avgNaiveScore = unique.reduce((a, c) => a + c.naive_score, 0) / totalUrls;
    const avgPlaywrightScore = unique.reduce((a, c) => a + c.playwright_score, 0) / totalUrls;

    console.log(`\nAGGREGATE COMPARISON:`);
    console.log(`  Total URLs tested: ${totalUrls}`);
    console.log(`  Naive success rate: ${(naiveSuccessCount / totalUrls * 100).toFixed(1)}%`);
    console.log(`  Playwright success rate: ${(playwrightSuccessCount / totalUrls * 100).toFixed(1)}%`);
    console.log(`  Naive avg quality: ${avgNaiveScore.toFixed(1)}`);
    console.log(`  Playwright avg quality: ${avgPlaywrightScore.toFixed(1)}`);
    console.log(`  Quality improvement: +${(avgPlaywrightScore - avgNaiveScore).toFixed(1)} points`);
    console.log(`  URLs where only Playwright succeeded: ${unique.filter(c => !c.naive_success && c.playwright_success).length}`);

  } else if (args[0].startsWith('http')) {
    // Single URL comparison
    const browser = await chromium.launch({ headless: true });
    try {
      const comparison = await compareExtractionMethods(args[0], browser);

      console.log(`\nDifficulty: ${comparison.difficulty.toUpperCase()}`);
      console.log('\nDetailed Results:');
      for (const r of comparison.results) {
        console.log(`\n${r.method.toUpperCase()} [${r.tier}]:`);
        console.log(`  Success: ${r.success}`);
        console.log(`  Quality Score: ${r.quality_score}`);
        console.log(`  Timing: ${r.timing_ms}ms`);
        if (r.vehicle_data) {
          console.log(`  Vehicle Data:`);
          console.log(`    Year: ${r.vehicle_data.year || 'N/A'}`);
          console.log(`    Make: ${r.vehicle_data.make || 'N/A'}`);
          console.log(`    Model: ${r.vehicle_data.model || 'N/A'}`);
          console.log(`    Price: ${r.vehicle_data.price ? '$' + r.vehicle_data.price.toLocaleString() : 'N/A'}`);
          console.log(`    VIN: ${r.vehicle_data.vin || 'N/A'}`);
          console.log(`    Images: ${r.vehicle_data.images?.length || 0}`);
        }
        if (r.error) console.log(`  Error: ${r.error}`);
      }
    } finally {
      await browser.close();
    }
  }
}

main().catch(console.error);

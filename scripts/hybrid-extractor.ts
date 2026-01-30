#!/usr/bin/env npx tsx
/**
 * HYBRID EXTRACTOR
 *
 * Smart extraction: tries naive fetch first, falls back to Playwright if needed.
 * Saves compute on easy sites, still gets the hard ones.
 *
 * Strategy:
 * 1. Try naive fetch (fast, cheap)
 * 2. If success AND quality >= threshold → done
 * 3. If fail OR low quality → try Playwright
 * 4. Return best result with method used
 *
 * Usage:
 *   npx tsx hybrid-extractor.ts <url>
 *   npx tsx hybrid-extractor.ts --batch <file.txt>
 *   npx tsx hybrid-extractor.ts --batch <file.txt> --save-to-db
 */

import { chromium, Browser, Page } from 'playwright';
import { JSDOM } from 'jsdom';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

// ============================================================
// Configuration
// ============================================================

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const NAIVE_TIMEOUT_MS = 15_000;
const PLAYWRIGHT_TIMEOUT_MS = 30_000;

// Quality threshold - if naive gets this or higher, skip Playwright
const QUALITY_THRESHOLD = 50;

// ============================================================
// Types
// ============================================================

interface ExtractedVehicle {
  url: string;
  title?: string;
  year?: number;
  make?: string;
  model?: string;
  price?: number;
  vin?: string;
  mileage?: number;
  images: string[];
  description?: string;
}

interface ExtractionResult {
  success: boolean;
  method: 'naive' | 'playwright' | 'hybrid';
  fallback_used: boolean;
  naive_attempted: boolean;
  playwright_attempted: boolean;
  naive_score: number;
  playwright_score: number;
  final_score: number;
  timing_ms: number;
  naive_timing_ms: number;
  playwright_timing_ms: number;
  vehicle: ExtractedVehicle | null;
  error?: string;
}

// ============================================================
// Naive Extraction (fast, cheap)
// ============================================================

async function extractNaive(url: string): Promise<{ success: boolean; score: number; vehicle: ExtractedVehicle | null; timing: number; error?: string }> {
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), NAIVE_TIMEOUT_MS);

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
      return { success: false, score: 0, vehicle: null, timing: Date.now() - start, error: `HTTP ${response.status}` };
    }

    const html = await response.text();

    if (html.length < 1000) {
      return { success: false, score: 0, vehicle: null, timing: Date.now() - start, error: 'Page too small' };
    }

    // Check for bot blocks - only trigger on actual blocking patterns, not incidental mentions
    const lowerHtml = html.toLowerCase();
    const bodyText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

    // Only block if it's clearly a challenge/block page (short content + block signals)
    const isBlockPage = bodyText.length < 2000 && (
      lowerHtml.includes('captcha') ||
      lowerHtml.includes('access denied') ||
      lowerHtml.includes('please enable javascript') ||
      lowerHtml.includes('challenge-running') ||
      lowerHtml.includes('checking your browser')
    );

    if (isBlockPage) {
      return { success: false, score: 0, vehicle: null, timing: Date.now() - start, error: 'Blocked/JS required' };
    }

    const vehicle = extractFromHtml(html, url);
    const score = calculateScore(vehicle);

    return {
      success: score > 0,
      score,
      vehicle: score > 0 ? vehicle : null,
      timing: Date.now() - start
    };

  } catch (err: any) {
    return { success: false, score: 0, vehicle: null, timing: Date.now() - start, error: err.message };
  }
}

// ============================================================
// Playwright Extraction (handles JS, slower)
// ============================================================

async function extractPlaywright(url: string, browser: Browser): Promise<{ success: boolean; score: number; vehicle: ExtractedVehicle | null; timing: number; error?: string }> {
  const start = Date.now();
  let page: Page | null = null;

  try {
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1920, height: 1080 },
    });
    page = await context.newPage();

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PLAYWRIGHT_TIMEOUT_MS });
    await page.waitForTimeout(2000);

    // Scroll to trigger lazy loading
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await page.waitForTimeout(1000);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);

    const pageData = await page.evaluate(() => {
      const title = document.title || document.querySelector('h1')?.textContent || '';
      const bodyText = document.body.innerText || '';
      const html = document.documentElement.outerHTML;
      const images = [...document.querySelectorAll('img')]
        .map(img => img.src || img.getAttribute('data-src'))
        .filter(Boolean) as string[];

      return { title: title.trim(), bodyText, html, images };
    });

    await page.close();

    if (pageData.bodyText.length < 100) {
      return { success: false, score: 0, vehicle: null, timing: Date.now() - start, error: 'No content' };
    }

    const vehicle = extractFromHtml(pageData.html, url);
    vehicle.images = pageData.images.filter(isVehicleImage).slice(0, 30);
    const score = calculateScore(vehicle);

    return { success: score > 0, score, vehicle: score > 0 ? vehicle : null, timing: Date.now() - start };

  } catch (err: any) {
    if (page) try { await page.close(); } catch {}
    return { success: false, score: 0, vehicle: null, timing: Date.now() - start, error: err.message };
  }
}

// ============================================================
// HTML Parsing
// ============================================================

const KNOWN_MAKES = [
  'Porsche', 'Ferrari', 'Lamborghini', 'Mercedes-Benz', 'Mercedes', 'BMW', 'Audi',
  'Chevrolet', 'Chevy', 'Ford', 'Dodge', 'Plymouth', 'Pontiac', 'Buick', 'Cadillac', 'GMC',
  'Jaguar', 'Aston Martin', 'Bentley', 'Rolls-Royce', 'Maserati', 'Alfa Romeo',
  'Toyota', 'Honda', 'Nissan', 'Mazda', 'Datsun', 'Lexus', 'Subaru', 'Mitsubishi',
  'Jeep', 'Lincoln', 'Chrysler', 'AMC', 'Studebaker', 'Packard', 'Hudson', 'Nash',
  'MG', 'Triumph', 'Austin-Healey', 'Lotus', 'McLaren', 'Land Rover', 'Mini',
  'Volkswagen', 'VW', 'Volvo', 'Saab', 'Fiat', 'Lancia', 'Shelby', 'DeLorean',
  'De Tomaso', 'Iso', 'Bizzarrini', 'AC', 'TVR', 'Morgan', 'Caterham',
];

// Normalize make name
function normalizeMake(make: string): string {
  const normalizations: Record<string, string> = {
    'chevy': 'Chevrolet',
    'mercedes': 'Mercedes-Benz',
    'vw': 'Volkswagen',
  };
  return normalizations[make.toLowerCase()] || make;
}

// Extract year+make+model from a title string like "1988 Porsche 911 Carrera"
function parseYearMakeModel(title: string): { year?: number; make?: string; model?: string } {
  const result: { year?: number; make?: string; model?: string } = {};

  // Try pattern: YEAR MAKE MODEL...
  const yearMatch = title.match(/\b(19[2-9]\d|20[0-2]\d)\b/);
  if (yearMatch) {
    result.year = parseInt(yearMatch[1]);
  }

  // Find make in title
  for (const make of KNOWN_MAKES) {
    const regex = new RegExp(`\\b${make.replace(/-/g, '[-\\s]?')}\\b`, 'i');
    const match = title.match(regex);
    if (match) {
      result.make = normalizeMake(match[0]);

      // Extract model: text after make, before common stop words
      const afterMake = title.slice(title.toLowerCase().indexOf(match[0].toLowerCase()) + match[0].length);
      const modelMatch = afterMake.match(/^[\s\-:]*([A-Za-z0-9\-]+(?:\s+[A-Za-z0-9\-]+){0,3})/);
      if (modelMatch?.[1]) {
        // Clean up model - remove common suffixes that aren't part of model
        let model = modelMatch[1].trim();
        // Stop at common non-model words
        model = model.split(/\s+(for|on|sale|auction|bid|listing|by|at|in)\s+/i)[0];
        // Clean trailing junk
        model = model.replace(/\s+(for|on|sale|auction)$/i, '').trim();
        if (model.length > 1 && !/^(for|on|sale|auction|bid|listing)$/i.test(model)) {
          result.model = model;
        }
      }
      break;
    }
  }

  return result;
}

function extractFromHtml(html: string, url: string): ExtractedVehicle {
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;

  const vehicle: ExtractedVehicle = { url, images: [] };

  // Get title - most reliable source
  const title = doc.title || doc.querySelector('h1')?.textContent?.trim() || '';
  vehicle.title = title || undefined;

  // Get meta description / OG tags as backup
  const ogTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute('content') || '';
  const description = doc.querySelector('meta[name="description"]')?.getAttribute('content') || '';

  // Try JSON-LD structured data first (most reliable)
  const jsonLdScripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const script of jsonLdScripts) {
    try {
      const data = JSON.parse(script.textContent || '');
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@type'] === 'Product' || item['@type'] === 'Vehicle' || item['@type'] === 'Car') {
          if (item.name) {
            const parsed = parseYearMakeModel(item.name);
            if (parsed.year) vehicle.year = parsed.year;
            if (parsed.make) vehicle.make = parsed.make;
            if (parsed.model) vehicle.model = parsed.model;
          }
          if (item.offers?.price) {
            const price = parseFloat(String(item.offers.price).replace(/[^0-9.]/g, ''));
            if (price > 500 && price < 50000000) vehicle.price = price;
          }
          if (item.vehicleIdentificationNumber) {
            vehicle.vin = item.vehicleIdentificationNumber;
          }
        }
      }
    } catch {}
  }

  // If no structured data, parse from title (priority: og:title > title > h1)
  if (!vehicle.make) {
    const titleSources = [ogTitle, title, doc.querySelector('h1')?.textContent || ''];
    for (const src of titleSources) {
      if (src) {
        const parsed = parseYearMakeModel(src);
        if (parsed.make) {
          if (!vehicle.year && parsed.year) vehicle.year = parsed.year;
          vehicle.make = parsed.make;
          if (!vehicle.model && parsed.model) vehicle.model = parsed.model;
          break;
        }
      }
    }
  }

  // Full page text for fallback extraction
  const text = doc.body?.textContent || '';
  const combined = title + ' ' + ogTitle + ' ' + description + ' ' + text;

  // Year - prefer from title parsing, fallback to page scan
  if (!vehicle.year) {
    const yearMatch = combined.match(/\b(19[2-9]\d|20[0-2]\d)\b/);
    if (yearMatch) vehicle.year = parseInt(yearMatch[1]);
  }

  // Price - look for prominent price patterns
  if (!vehicle.price) {
    // Common price patterns
    const pricePatterns = [
      /(?:sold|sold\s+for|final\s+bid|winning\s+bid|sale\s+price)[:\s]*\$\s*([\d,]+)/i,
      /(?:current\s+bid|high\s+bid|bid)[:\s]*\$\s*([\d,]+)/i,
      /(?:asking|price|list)[:\s]*\$\s*([\d,]+)/i,
      /\$\s*([\d,]+)(?:\.\d{2})?/,
    ];
    for (const pattern of pricePatterns) {
      const match = combined.match(pattern);
      if (match) {
        const price = parseInt(match[1].replace(/,/g, ''));
        if (price > 500 && price < 50000000) {
          vehicle.price = price;
          break;
        }
      }
    }
  }

  // VIN - 17 char pattern
  if (!vehicle.vin) {
    const vinMatch = combined.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
    if (vinMatch) vehicle.vin = vinMatch[1];
  }

  // Mileage
  if (!vehicle.mileage) {
    const mileageMatch = combined.match(/(\d{1,3}[,.]?\d{3})\s*(miles?|mi\.?|odometer)/i);
    if (mileageMatch) {
      const mileage = parseInt(mileageMatch[1].replace(/[,.]/g, ''));
      if (mileage > 0 && mileage < 500000) vehicle.mileage = mileage;
    }
  }

  // Make - last resort fallback to page scan (only if title parsing failed)
  if (!vehicle.make) {
    for (const make of KNOWN_MAKES) {
      const regex = new RegExp(`\\b${make.replace(/-/g, '[-\\s]?')}\\b`, 'i');
      if (regex.test(combined)) {
        vehicle.make = normalizeMake(make);
        break;
      }
    }
  }

  // Model - fallback if not from title
  if (vehicle.make && !vehicle.model) {
    // Look for pattern like "MAKE MODEL" in title/description
    const searchIn = title + ' ' + ogTitle + ' ' + description;
    const afterMake = searchIn.split(new RegExp(vehicle.make, 'i'))[1];
    if (afterMake) {
      const modelMatch = afterMake.match(/^[\s\-:]*([A-Za-z0-9\-]+(?:\s+[A-Za-z0-9\-]+){0,2})/);
      if (modelMatch?.[1]) {
        let model = modelMatch[1].trim();
        model = model.split(/\s+(for|on|sale|auction|bid|listing)\s+/i)[0].trim();
        if (model.length > 1 && !/^(for|on|sale|auction|bid|listing)$/i.test(model)) {
          vehicle.model = model;
        }
      }
    }
  }

  // Images - look for common image extensions
  const imgMatches = html.match(/src=["']([^"']+\.(?:jpg|jpeg|png|webp|gif)[^"']*)["']/gi) || [];
  vehicle.images = imgMatches
    .map(m => m.match(/src=["']([^"']+)["']/)?.[1])
    .filter((src): src is string => !!src && isVehicleImage(src))
    .slice(0, 30);

  return vehicle;
}

function isVehicleImage(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  // Skip common non-vehicle images - use patterns that won't match inside words
  const skipPatterns = [
    /[\/\-_]logo[\/\-_\.]/,
    /[\/\-_]icon[\/\-_\.]/,
    /[\/\-_]avatar[\/\-_\.]/,
    /[\/\-_]profile[\/\-_\.]/,
    /[\/\-_]banner[\/\-_\.]/,
    /[\/\-_]ad[\/\-_\.]/,
    /[\/\-_]ads[\/\-_\.]/,
    /facebook\.com/,
    /twitter\.com/,
    /[\/\-_]pixel[\/\-_\.]/,
    /[\/\-_]1x1[\/\-_\.]/,
    /[\/\-_]spacer[\/\-_\.]/,
    /[\/\-_]sprite[\/\-_\.]/,
    /\.svg$/,
  ];
  if (skipPatterns.some(p => p.test(lower))) return false;
  return /\.(jpg|jpeg|png|webp|gif)/i.test(lower);
}

function calculateScore(vehicle: ExtractedVehicle): number {
  let score = 0;
  if (vehicle.year) score += 20;
  if (vehicle.make) score += 20;
  if (vehicle.model) score += 15;
  if (vehicle.price) score += 20;
  if (vehicle.vin) score += 10;
  if (vehicle.mileage) score += 5;
  if (vehicle.images.length >= 10) score += 10;
  else if (vehicle.images.length >= 5) score += 7;
  else if (vehicle.images.length >= 1) score += 3;
  return Math.min(100, score);
}

// ============================================================
// Hybrid Extraction
// ============================================================

async function hybridExtract(url: string, browser: Browser): Promise<ExtractionResult> {
  const totalStart = Date.now();

  const result: ExtractionResult = {
    success: false,
    method: 'hybrid',
    fallback_used: false,
    naive_attempted: true,
    playwright_attempted: false,
    naive_score: 0,
    playwright_score: 0,
    final_score: 0,
    timing_ms: 0,
    naive_timing_ms: 0,
    playwright_timing_ms: 0,
    vehicle: null,
  };

  console.log(`  [naive] trying...`);
  const naive = await extractNaive(url);
  result.naive_score = naive.score;
  result.naive_timing_ms = naive.timing;

  if (naive.success && naive.score >= QUALITY_THRESHOLD) {
    // Naive worked well enough
    console.log(`  [naive] ✓ score=${naive.score} (above threshold ${QUALITY_THRESHOLD})`);
    result.success = true;
    result.method = 'naive';
    result.final_score = naive.score;
    result.vehicle = naive.vehicle;
    result.timing_ms = Date.now() - totalStart;
    return result;
  }

  // Need Playwright fallback
  const reason = naive.error || `score ${naive.score} < ${QUALITY_THRESHOLD}`;
  console.log(`  [naive] ✗ ${reason} → trying playwright...`);

  result.fallback_used = true;
  result.playwright_attempted = true;

  const pw = await extractPlaywright(url, browser);
  result.playwright_score = pw.score;
  result.playwright_timing_ms = pw.timing;

  if (pw.success && pw.score > naive.score) {
    console.log(`  [playwright] ✓ score=${pw.score}`);
    result.success = true;
    result.method = 'playwright';
    result.final_score = pw.score;
    result.vehicle = pw.vehicle;
  } else if (naive.success && naive.score > 0) {
    // Playwright didn't help, use naive result
    console.log(`  [playwright] ✗ score=${pw.score}, using naive result`);
    result.success = true;
    result.method = 'naive';
    result.final_score = naive.score;
    result.vehicle = naive.vehicle;
  } else {
    console.log(`  [playwright] ✗ ${pw.error || 'no improvement'}`);
    result.error = pw.error || naive.error || 'Both methods failed';
  }

  result.timing_ms = Date.now() - totalStart;
  return result;
}

// ============================================================
// Batch Processing
// ============================================================

interface BatchStats {
  total: number;
  success: number;
  naive_only: number;
  needed_playwright: number;
  failed: number;
  total_time_ms: number;
  time_saved_ms: number;  // vs running Playwright on everything
}

async function processBatch(urls: string[], saveToDb: boolean = false): Promise<BatchStats> {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`HYBRID EXTRACTOR - Processing ${urls.length} URLs`);
  console.log(`Strategy: Naive first (threshold=${QUALITY_THRESHOLD}), Playwright fallback`);
  console.log(`${'═'.repeat(60)}\n`);

  const browser = await chromium.launch({ headless: true });
  const stats: BatchStats = {
    total: urls.length,
    success: 0,
    naive_only: 0,
    needed_playwright: 0,
    failed: 0,
    total_time_ms: 0,
    time_saved_ms: 0,
  };

  const results: ExtractionResult[] = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    console.log(`\n[${i + 1}/${urls.length}] ${url}`);

    const result = await hybridExtract(url, browser);
    results.push(result);

    stats.total_time_ms += result.timing_ms;

    if (result.success) {
      stats.success++;
      if (!result.fallback_used) {
        stats.naive_only++;
        // Time saved = typical Playwright time - actual naive time
        stats.time_saved_ms += (7500 - result.naive_timing_ms);
      } else {
        stats.needed_playwright++;
      }
    } else {
      stats.failed++;
    }

    // Log result
    const v = result.vehicle;
    if (v) {
      console.log(`  → ${result.method.toUpperCase()} | ${v.year || '?'} ${v.make || '?'} ${v.model || '?'} | $${v.price?.toLocaleString() || '?'} | ${v.images.length} imgs | ${result.timing_ms}ms`);
    }

    // Save to DB if requested
    if (saveToDb && result.vehicle) {
      await saveToImportQueue(result);
    }
  }

  await browser.close();

  // Print summary
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`RESULTS`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`Total: ${stats.total}`);
  console.log(`Success: ${stats.success} (${(stats.success/stats.total*100).toFixed(1)}%)`);
  console.log(`  - Naive only: ${stats.naive_only} (${(stats.naive_only/stats.total*100).toFixed(1)}%)`);
  console.log(`  - Needed Playwright: ${stats.needed_playwright} (${(stats.needed_playwright/stats.total*100).toFixed(1)}%)`);
  console.log(`Failed: ${stats.failed}`);
  console.log(`Total time: ${(stats.total_time_ms/1000).toFixed(1)}s`);
  console.log(`Time saved vs all-Playwright: ${(stats.time_saved_ms/1000).toFixed(1)}s`);
  console.log(`${'═'.repeat(60)}\n`);

  return stats;
}

// ============================================================
// Database
// ============================================================

async function saveToImportQueue(result: ExtractionResult): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY || !result.vehicle) return;

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const v = result.vehicle;

    const { error } = await supabase.from('import_queue').upsert({
      url: v.url,
      source: 'hybrid_extractor',
      status: 'pending',
      raw_data: {
        ...v,
        extraction_method: result.method,
        extraction_score: result.final_score,
        fallback_used: result.fallback_used,
      },
    }, { onConflict: 'url' });

    if (error) {
      console.log(`    ⚠ DB: ${error.message}`);
    } else {
      console.log(`    ✓ Saved to import_queue`);
    }
  } catch (err: any) {
    console.log(`    ⚠ DB error: ${err.message}`);
  }
}

// ============================================================
// CLI
// ============================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
HYBRID EXTRACTOR
Tries naive fetch first, falls back to Playwright if needed.

Usage:
  npx tsx hybrid-extractor.ts <url>
  npx tsx hybrid-extractor.ts --batch <file.txt>
  npx tsx hybrid-extractor.ts --batch <file.txt> --save-to-db

Options:
  <url>           Extract single URL
  --batch <file>  Process URLs from file (one per line)
  --save-to-db    Save results to import_queue table
`);
    return;
  }

  const saveToDb = args.includes('--save-to-db');

  if (args[0] === '--batch') {
    const file = args[1];
    if (!file) {
      console.error('Missing file argument');
      return;
    }

    const urls = fs.readFileSync(file, 'utf-8')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && l.startsWith('http') && !l.startsWith('#'));

    await processBatch(urls, saveToDb);

  } else if (args[0].startsWith('http')) {
    const browser = await chromium.launch({ headless: true });
    const result = await hybridExtract(args[0], browser);
    await browser.close();

    console.log('\nResult:');
    console.log(JSON.stringify(result, null, 2));

    if (saveToDb && result.vehicle) {
      await saveToImportQueue(result);
    }
  }
}

main().catch(console.error);

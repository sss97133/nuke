/**
 * Parallel Extraction Orchestrator with Free vs Paid Comparison
 *
 * This function extracts vehicle data from a URL using multiple methods in sequence,
 * tracking success rates, quality scores, and costs to build investor-friendly metrics:
 * "Here's what FREE gets you vs PAID."
 *
 * Methods (tried in order):
 * 1. Direct Fetch (FREE) - Simple HTTP request, works for static pages
 * 2. Playwright via stored HTML (FREE) - Accept pre-rendered HTML from client
 * 3. Firecrawl (PAID) - JS rendering with anti-bot measures, only if allow_paid=true
 *
 * Each method tracks:
 * - success: boolean
 * - method: string
 * - cost: number
 * - extraction_quality: number (0-1, based on fields extracted)
 * - fields_extracted: string[]
 * - time_ms: number
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts';
import { firecrawlScrape } from '../_shared/firecrawl.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// Types
// ============================================================================

interface ExtractionRequest {
  url: string;
  allow_paid?: boolean;           // Allow paid methods (Firecrawl)
  playwright_html?: string;       // Pre-rendered HTML from Playwright client
  extraction_schema?: string[];   // Which fields to extract (defaults to vehicle fields)
  log_to_db?: boolean;            // Log comparison to extraction_comparisons table
}

interface MethodResult {
  success: boolean;
  method: 'direct' | 'playwright' | 'firecrawl';
  cost: number;                   // 0 for free, estimated cost for paid
  extraction_quality: number;     // 0-1 score
  fields_extracted: string[];
  time_ms: number;
  extracted_data?: ExtractedVehicle;
  error?: string;
  html_length?: number;
}

interface ExtractedVehicle {
  year?: number | null;
  make?: string | null;
  model?: string | null;
  vin?: string | null;
  price?: number | null;
  mileage?: number | null;
  exterior_color?: string | null;
  interior_color?: string | null;
  transmission?: string | null;
  drivetrain?: string | null;
  engine?: string | null;
  body_style?: string | null;
  location?: string | null;
  description?: string | null;
  images?: string[];
  seller?: string | null;
}

interface ComparisonResult {
  url: string;
  domain: string;
  best_result: ExtractedVehicle | null;
  best_method: string | null;
  comparison: {
    free_methods: {
      attempted: string[];
      success: boolean;
      quality_score: number;
      fields_extracted: string[];
      total_time_ms: number;
    };
    paid_methods: {
      attempted: string[];
      success: boolean;
      quality_score: number;
      fields_extracted: string[];
      estimated_cost: number;
      total_time_ms: number;
    };
    value_delta: {
      additional_fields: string[];
      quality_improvement: number;
      cost_per_field: number;
    };
  };
  recommendation: string;
  method_details: MethodResult[];
  timestamp: string;
}

// ============================================================================
// Constants
// ============================================================================

const FIRECRAWL_COST_PER_SCRAPE = 0.01;  // ~$0.01 per scrape

// Fields we care about for vehicle extraction
const VEHICLE_FIELDS = [
  'year', 'make', 'model', 'vin', 'price', 'mileage',
  'exterior_color', 'interior_color', 'transmission',
  'drivetrain', 'engine', 'body_style', 'location',
  'description', 'images', 'seller'
];

// Field importance weights for quality scoring
const FIELD_WEIGHTS: Record<string, number> = {
  year: 1.0,
  make: 1.0,
  model: 1.0,
  vin: 1.5,         // VIN is very valuable
  price: 1.5,       // Price is very valuable
  mileage: 1.0,
  exterior_color: 0.5,
  interior_color: 0.5,
  transmission: 0.5,
  drivetrain: 0.5,
  engine: 0.5,
  body_style: 0.3,
  location: 0.3,
  description: 0.8,
  images: 1.2,      // Images are valuable
  seller: 0.3,
};

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
};

// ============================================================================
// Extraction Methods
// ============================================================================

/**
 * Method 1: Direct Fetch (FREE)
 * Simple HTTP GET request - works for static pages, fails on JS-heavy sites
 */
async function extractWithDirectFetch(url: string): Promise<MethodResult> {
  const startTime = Date.now();
  const result: MethodResult = {
    success: false,
    method: 'direct',
    cost: 0,
    extraction_quality: 0,
    fields_extracted: [],
    time_ms: 0,
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      result.error = `HTTP ${response.status}`;
      result.time_ms = Date.now() - startTime;
      return result;
    }

    const html = await response.text();
    result.html_length = html.length;

    // Check for bot detection / JS-required pages
    if (isBlockedOrJsRequired(html)) {
      result.error = 'Page requires JavaScript or is blocked';
      result.time_ms = Date.now() - startTime;
      return result;
    }

    // Extract data from HTML
    const extracted = extractVehicleFromHtml(html, url);
    const { quality, fields } = calculateQuality(extracted);

    result.success = quality > 0;
    result.extraction_quality = quality;
    result.fields_extracted = fields;
    result.extracted_data = extracted;
    result.time_ms = Date.now() - startTime;

    return result;
  } catch (err: any) {
    result.error = err.message || 'Direct fetch failed';
    result.time_ms = Date.now() - startTime;
    return result;
  }
}

/**
 * Method 2: Playwright HTML (FREE)
 * Accept pre-rendered HTML from client-side Playwright
 */
async function extractWithPlaywrightHtml(html: string, url: string): Promise<MethodResult> {
  const startTime = Date.now();
  const result: MethodResult = {
    success: false,
    method: 'playwright',
    cost: 0,
    extraction_quality: 0,
    fields_extracted: [],
    time_ms: 0,
  };

  try {
    if (!html || html.length < 100) {
      result.error = 'No valid HTML provided';
      result.time_ms = Date.now() - startTime;
      return result;
    }

    result.html_length = html.length;

    // Extract data from HTML
    const extracted = extractVehicleFromHtml(html, url);
    const { quality, fields } = calculateQuality(extracted);

    result.success = quality > 0;
    result.extraction_quality = quality;
    result.fields_extracted = fields;
    result.extracted_data = extracted;
    result.time_ms = Date.now() - startTime;

    return result;
  } catch (err: any) {
    result.error = err.message || 'Playwright extraction failed';
    result.time_ms = Date.now() - startTime;
    return result;
  }
}

/**
 * Method 3: Firecrawl (PAID)
 * Uses Firecrawl API for JS rendering with anti-bot measures
 */
async function extractWithFirecrawl(url: string): Promise<MethodResult> {
  const startTime = Date.now();
  const result: MethodResult = {
    success: false,
    method: 'firecrawl',
    cost: FIRECRAWL_COST_PER_SCRAPE,
    extraction_quality: 0,
    fields_extracted: [],
    time_ms: 0,
  };

  try {
    const fcResult = await firecrawlScrape({
      url,
      formats: ['html', 'markdown'],
      onlyMainContent: false,
      waitFor: 3000,
      timeout: 30000,
    });

    result.time_ms = Date.now() - startTime;

    if (!fcResult.ok || !fcResult.data.html) {
      result.error = fcResult.error || 'Firecrawl returned no HTML';
      return result;
    }

    if (fcResult.blocked) {
      result.error = `Blocked: ${fcResult.blockedSignals.join(', ')}`;
      return result;
    }

    const html = fcResult.data.html;
    result.html_length = html.length;

    // Extract data from HTML
    const extracted = extractVehicleFromHtml(html, url);

    // Also try to extract from markdown if available (often cleaner)
    if (fcResult.data.markdown) {
      const markdownExtracted = extractVehicleFromMarkdown(fcResult.data.markdown, url);
      // Merge markdown data into extracted (prefer non-null markdown values)
      mergeExtractedData(extracted, markdownExtracted);
    }

    const { quality, fields } = calculateQuality(extracted);

    result.success = quality > 0;
    result.extraction_quality = quality;
    result.fields_extracted = fields;
    result.extracted_data = extracted;

    return result;
  } catch (err: any) {
    result.error = err.message || 'Firecrawl extraction failed';
    result.time_ms = Date.now() - startTime;
    return result;
  }
}

// ============================================================================
// Extraction Helpers
// ============================================================================

/**
 * Check if HTML indicates bot blocking or JS-required page
 */
function isBlockedOrJsRequired(html: string): boolean {
  const lowerHtml = html.toLowerCase();

  const blockedSignals = [
    'captcha',
    'enable javascript',
    'javascript is required',
    'please enable js',
    'browser check',
    'access denied',
    'bot detected',
    'cloudflare',
    'perimeterx',
    '_pxcustomlogo',
    'challenge-running',
    'verify you are human',
  ];

  for (const signal of blockedSignals) {
    if (lowerHtml.includes(signal)) return true;
  }

  // Check if page is mostly empty (JS not executed)
  const textContent = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (textContent.length < 500) return true;

  return false;
}

/**
 * Extract vehicle data from HTML using DOM parsing
 */
function extractVehicleFromHtml(html: string, url: string): ExtractedVehicle {
  const result: ExtractedVehicle = {};

  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (!doc) return result;

    // Get full text for pattern matching
    const fullText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

    // Title extraction
    const title = doc.querySelector('title')?.textContent ||
                  doc.querySelector('h1')?.textContent || '';

    // Extract year from title/text
    const yearMatch = fullText.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) result.year = parseInt(yearMatch[0]);

    // Extract VIN (17-char modern or shorter chassis numbers)
    const vinPatterns = [
      /\b([A-HJ-NPR-Z0-9]{17})\b/i,  // Modern 17-char VIN
      /\bVIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i,
      /\bChassis[:\s]*([A-HJ-NPR-Z0-9]+)/i,
    ];
    for (const pattern of vinPatterns) {
      const match = fullText.match(pattern);
      if (match) {
        result.vin = match[1].toUpperCase();
        break;
      }
    }

    // Extract price
    const pricePatterns = [
      /\$\s*([\d,]+(?:\.\d{2})?)/,
      /USD\s*\$?\s*([\d,]+)/i,
      /(?:price|asking|sold for)[:\s]*\$?\s*([\d,]+)/i,
    ];
    for (const pattern of pricePatterns) {
      const match = fullText.match(pattern);
      if (match) {
        const price = parseInt(match[1].replace(/[,.\s]/g, ''));
        if (price > 100 && price < 100000000) {  // Reasonable price range
          result.price = price;
          break;
        }
      }
    }

    // Extract mileage
    const mileagePatterns = [
      /\b([\d,]+)\s*k?\s*miles?\b/i,
      /odometer[:\s]*([\d,]+)/i,
      /mileage[:\s]*([\d,]+)/i,
    ];
    for (const pattern of mileagePatterns) {
      const match = fullText.match(pattern);
      if (match) {
        let mileage = parseInt(match[1].replace(/,/g, ''));
        if (match[0].toLowerCase().includes('k ') ||
            (match[0].toLowerCase().includes('k') && mileage < 1000)) {
          mileage *= 1000;
        }
        if (mileage > 0 && mileage < 1000000) {
          result.mileage = mileage;
          break;
        }
      }
    }

    // Extract transmission
    if (fullText.match(/manual|stick\s*shift/i)) {
      const speedMatch = fullText.match(/(\d)[- ]speed\s*manual/i);
      result.transmission = speedMatch ? `${speedMatch[1]}-Speed Manual` : 'Manual';
    } else if (fullText.match(/automatic|auto\s*trans/i)) {
      const speedMatch = fullText.match(/(\d)[- ]speed\s*automatic/i);
      result.transmission = speedMatch ? `${speedMatch[1]}-Speed Automatic` : 'Automatic';
    } else if (fullText.match(/PDK|dual.?clutch/i)) {
      result.transmission = 'PDK';
    } else if (fullText.match(/CVT/i)) {
      result.transmission = 'CVT';
    }

    // Extract drivetrain
    if (fullText.match(/4[x×]4|4WD|four.?wheel.?drive/i)) {
      result.drivetrain = '4WD';
    } else if (fullText.match(/AWD|all.?wheel.?drive/i)) {
      result.drivetrain = 'AWD';
    } else if (fullText.match(/RWD|rear.?wheel.?drive/i)) {
      result.drivetrain = 'RWD';
    } else if (fullText.match(/FWD|front.?wheel.?drive/i)) {
      result.drivetrain = 'FWD';
    }

    // Extract colors
    const colorPatterns = [
      /(?:exterior|paint|color)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
      /(?:finished|painted)\s+in\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
    ];
    for (const pattern of colorPatterns) {
      const match = fullText.match(pattern);
      if (match && !result.exterior_color) {
        result.exterior_color = match[1].trim();
      }
    }

    const interiorPatterns = [
      /interior[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
      /([A-Z][a-z]+)\s+leather\s+interior/i,
    ];
    for (const pattern of interiorPatterns) {
      const match = fullText.match(pattern);
      if (match && !result.interior_color) {
        result.interior_color = match[1].trim();
      }
    }

    // Extract body style
    const bodyMatch = fullText.match(/\b(coupe|sedan|wagon|convertible|roadster|hatchback|suv|truck|pickup|van|targa|cabriolet|estate)\b/i);
    if (bodyMatch) {
      result.body_style = bodyMatch[1].charAt(0).toUpperCase() + bodyMatch[1].slice(1).toLowerCase();
    }

    // Extract images
    const images: string[] = [];
    const imgElements = doc.querySelectorAll('img[src]');
    for (const img of imgElements) {
      const src = img.getAttribute('src');
      if (src && isVehicleImage(src)) {
        images.push(src.startsWith('http') ? src : new URL(src, url).href);
      }
    }
    if (images.length > 0) result.images = [...new Set(images)].slice(0, 50);

    // Extract make/model from title if we have year
    if (result.year && title) {
      const afterYear = title.substring(title.indexOf(String(result.year)) + 4).trim();
      const parts = afterYear.split(/\s+/);
      if (parts.length >= 1) result.make = cleanMake(parts[0]);
      if (parts.length >= 2) result.model = parts.slice(1, 4).join(' ');
    }

    // Extract description
    const descElements = doc.querySelectorAll('.description, .post-excerpt, [data-description], .listing-description, article p');
    for (const el of descElements) {
      const text = el.textContent?.trim();
      if (text && text.length > 100) {
        result.description = text.substring(0, 2000);
        break;
      }
    }

    // Extract location
    const locationPatterns = [
      /located?\s+in\s+([A-Z][a-z]+(?:,?\s+[A-Z]{2})?)/i,
      /location[:\s]+([A-Z][a-z]+(?:,?\s+[A-Z]{2})?)/i,
    ];
    for (const pattern of locationPatterns) {
      const match = fullText.match(pattern);
      if (match && !result.location) {
        result.location = match[1].trim();
      }
    }

    // Extract seller
    const sellerPatterns = [
      /seller[:\s]+@?([A-Za-z0-9_-]+)/i,
      /sold\s+by\s+@?([A-Za-z0-9_-]+)/i,
    ];
    for (const pattern of sellerPatterns) {
      const match = fullText.match(pattern);
      if (match && !result.seller) {
        result.seller = match[1];
      }
    }

  } catch (err) {
    console.error('HTML extraction error:', err);
  }

  return result;
}

/**
 * Extract vehicle data from markdown (Firecrawl often returns cleaner markdown)
 */
function extractVehicleFromMarkdown(markdown: string, url: string): ExtractedVehicle {
  const result: ExtractedVehicle = {};

  // Most extraction logic is similar to HTML but operates on cleaner text
  // Reuse the same patterns on markdown text

  const yearMatch = markdown.match(/\b(19|20)\d{2}\b/);
  if (yearMatch) result.year = parseInt(yearMatch[0]);

  const vinMatch = markdown.match(/\bVIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
  if (vinMatch) result.vin = vinMatch[1].toUpperCase();

  const priceMatch = markdown.match(/\$\s*([\d,]+)/);
  if (priceMatch) {
    const price = parseInt(priceMatch[1].replace(/,/g, ''));
    if (price > 100) result.price = price;
  }

  const mileageMatch = markdown.match(/\b([\d,]+)\s*miles?\b/i);
  if (mileageMatch) {
    const mileage = parseInt(mileageMatch[1].replace(/,/g, ''));
    if (mileage > 0 && mileage < 1000000) result.mileage = mileage;
  }

  // Extract images from markdown
  const imageMatches = markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g);
  const images: string[] = [];
  for (const match of imageMatches) {
    if (isVehicleImage(match[1])) {
      images.push(match[1]);
    }
  }
  if (images.length > 0) result.images = images;

  return result;
}

/**
 * Check if URL looks like a vehicle image
 */
function isVehicleImage(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();

  // Skip common non-vehicle images
  const skipPatterns = [
    'logo', 'icon', 'avatar', 'profile', 'banner', 'ad',
    'facebook', 'twitter', 'instagram', 'pixel', 'tracking',
    '1x1', 'transparent', 'spacer', 'button',
  ];
  for (const pattern of skipPatterns) {
    if (lower.includes(pattern)) return false;
  }

  // Must be an image
  if (!lower.match(/\.(jpg|jpeg|png|webp|gif)/)) return false;

  return true;
}

/**
 * Clean up make name
 */
function cleanMake(make: string): string {
  const makeMap: Record<string, string> = {
    'mercedes': 'Mercedes-Benz',
    'mercedes-benz': 'Mercedes-Benz',
    'bmw': 'BMW',
    'vw': 'Volkswagen',
    'volkswagen': 'Volkswagen',
    'chevy': 'Chevrolet',
    'chevrolet': 'Chevrolet',
  };
  return makeMap[make.toLowerCase()] || make.charAt(0).toUpperCase() + make.slice(1);
}

/**
 * Merge extracted data, preferring non-null values from source
 */
function mergeExtractedData(target: ExtractedVehicle, source: ExtractedVehicle): void {
  for (const key of Object.keys(source) as (keyof ExtractedVehicle)[]) {
    if (source[key] !== null && source[key] !== undefined) {
      if (target[key] === null || target[key] === undefined) {
        (target as any)[key] = source[key];
      }
    }
  }
}

/**
 * Calculate extraction quality score (0-1) and list of extracted fields
 */
function calculateQuality(extracted: ExtractedVehicle): { quality: number; fields: string[] } {
  const fields: string[] = [];
  let weightedScore = 0;
  let maxPossible = 0;

  for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
    maxPossible += weight;
    const value = (extracted as any)[field];

    if (value !== null && value !== undefined) {
      if (Array.isArray(value)) {
        if (value.length > 0) {
          fields.push(field);
          weightedScore += weight;
        }
      } else if (typeof value === 'string') {
        if (value.trim().length > 0) {
          fields.push(field);
          weightedScore += weight;
        }
      } else {
        fields.push(field);
        weightedScore += weight;
      }
    }
  }

  return {
    quality: maxPossible > 0 ? weightedScore / maxPossible : 0,
    fields,
  };
}

/**
 * Get domain from URL
 */
function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return 'unknown';
  }
}

// ============================================================================
// Main Orchestrator
// ============================================================================

async function orchestrateExtraction(request: ExtractionRequest): Promise<ComparisonResult> {
  const { url, allow_paid = false, playwright_html } = request;
  const domain = getDomain(url);
  const methodResults: MethodResult[] = [];

  console.log(`[extract-with-comparison] Starting extraction for ${url}`);
  console.log(`[extract-with-comparison] allow_paid=${allow_paid}, has_playwright_html=${!!playwright_html}`);

  // -------------------------------------------------------------------------
  // FREE METHODS
  // -------------------------------------------------------------------------

  // Method 1: Direct Fetch
  console.log('[extract-with-comparison] Trying Method 1: Direct Fetch...');
  const directResult = await extractWithDirectFetch(url);
  methodResults.push(directResult);
  console.log(`[extract-with-comparison] Direct: success=${directResult.success}, quality=${directResult.extraction_quality.toFixed(2)}, fields=${directResult.fields_extracted.length}`);

  // Method 2: Playwright HTML (if provided)
  if (playwright_html) {
    console.log('[extract-with-comparison] Trying Method 2: Playwright HTML...');
    const playwrightResult = await extractWithPlaywrightHtml(playwright_html, url);
    methodResults.push(playwrightResult);
    console.log(`[extract-with-comparison] Playwright: success=${playwrightResult.success}, quality=${playwrightResult.extraction_quality.toFixed(2)}, fields=${playwrightResult.fields_extracted.length}`);
  }

  // -------------------------------------------------------------------------
  // PAID METHODS
  // -------------------------------------------------------------------------

  if (allow_paid) {
    // Method 3: Firecrawl
    console.log('[extract-with-comparison] Trying Method 3: Firecrawl (PAID)...');
    const firecrawlResult = await extractWithFirecrawl(url);
    methodResults.push(firecrawlResult);
    console.log(`[extract-with-comparison] Firecrawl: success=${firecrawlResult.success}, quality=${firecrawlResult.extraction_quality.toFixed(2)}, fields=${firecrawlResult.fields_extracted.length}`);
  }

  // -------------------------------------------------------------------------
  // Analyze Results
  // -------------------------------------------------------------------------

  // Separate free and paid results
  const freeResults = methodResults.filter(r => r.method === 'direct' || r.method === 'playwright');
  const paidResults = methodResults.filter(r => r.method === 'firecrawl');

  // Find best free result
  const bestFree = freeResults
    .filter(r => r.success)
    .sort((a, b) => b.extraction_quality - a.extraction_quality)[0];

  // Find best paid result
  const bestPaid = paidResults
    .filter(r => r.success)
    .sort((a, b) => b.extraction_quality - a.extraction_quality)[0];

  // Determine overall best
  const allSuccessful = methodResults.filter(r => r.success);
  const overallBest = allSuccessful.sort((a, b) => b.extraction_quality - a.extraction_quality)[0];

  // Calculate free methods summary
  const freeSuccess = freeResults.some(r => r.success);
  const freeQuality = bestFree?.extraction_quality || 0;
  const freeFields = bestFree?.fields_extracted || [];
  const freeTotalTime = freeResults.reduce((sum, r) => sum + r.time_ms, 0);

  // Calculate paid methods summary
  const paidSuccess = paidResults.some(r => r.success);
  const paidQuality = bestPaid?.extraction_quality || 0;
  const paidFields = bestPaid?.fields_extracted || [];
  const paidTotalCost = paidResults.reduce((sum, r) => sum + r.cost, 0);
  const paidTotalTime = paidResults.reduce((sum, r) => sum + r.time_ms, 0);

  // Calculate value delta (what did paid add?)
  const additionalFields = paidFields.filter(f => !freeFields.includes(f));
  const qualityImprovement = paidQuality - freeQuality;
  const costPerField = additionalFields.length > 0
    ? paidTotalCost / additionalFields.length
    : 0;

  // Generate recommendation
  let recommendation = '';
  if (freeSuccess && freeQuality >= 0.8) {
    recommendation = `Free methods achieved ${(freeQuality * 100).toFixed(0)}% extraction - sufficient for most use cases.`;
  } else if (freeSuccess && paidSuccess && qualityImprovement > 0) {
    recommendation = `Free methods achieved ${(freeQuality * 100).toFixed(0)}% extraction. Paid adds ${additionalFields.length} fields for $${paidTotalCost.toFixed(2)}.`;
  } else if (!freeSuccess && paidSuccess) {
    recommendation = `Free methods failed. Paid extraction required ($${paidTotalCost.toFixed(2)}) for this source.`;
  } else if (!freeSuccess && !paidSuccess) {
    recommendation = `All methods failed. Site may require specialized extractor or is blocking scrapers.`;
  } else {
    recommendation = `Free extraction successful at ${(freeQuality * 100).toFixed(0)}% quality.`;
  }

  const comparisonResult: ComparisonResult = {
    url,
    domain,
    best_result: overallBest?.extracted_data || null,
    best_method: overallBest?.method || null,
    comparison: {
      free_methods: {
        attempted: freeResults.map(r => r.method),
        success: freeSuccess,
        quality_score: freeQuality,
        fields_extracted: freeFields,
        total_time_ms: freeTotalTime,
      },
      paid_methods: {
        attempted: paidResults.map(r => r.method),
        success: paidSuccess,
        quality_score: paidQuality,
        fields_extracted: paidFields,
        estimated_cost: paidTotalCost,
        total_time_ms: paidTotalTime,
      },
      value_delta: {
        additional_fields: additionalFields,
        quality_improvement: qualityImprovement,
        cost_per_field: costPerField,
      },
    },
    recommendation,
    method_details: methodResults,
    timestamp: new Date().toISOString(),
  };

  return comparisonResult;
}

// ============================================================================
// Database Logging
// ============================================================================

async function logComparisonToDb(
  supabase: any,
  result: ComparisonResult
): Promise<void> {
  try {
    const { error } = await supabase.from('extraction_comparisons').insert({
      url: result.url,
      domain: result.domain,
      timestamp: result.timestamp,
      // Free methods
      free_success: result.comparison.free_methods.success,
      free_quality: result.comparison.free_methods.quality_score,
      free_fields: result.comparison.free_methods.fields_extracted,
      free_time_ms: result.comparison.free_methods.total_time_ms,
      free_methods_attempted: result.comparison.free_methods.attempted,
      // Paid methods
      paid_success: result.comparison.paid_methods.success,
      paid_quality: result.comparison.paid_methods.quality_score,
      paid_fields: result.comparison.paid_methods.fields_extracted,
      paid_cost: result.comparison.paid_methods.estimated_cost,
      paid_time_ms: result.comparison.paid_methods.total_time_ms,
      paid_methods_attempted: result.comparison.paid_methods.attempted,
      // Delta
      quality_delta: result.comparison.value_delta.quality_improvement,
      additional_fields: result.comparison.value_delta.additional_fields,
      cost_per_field: result.comparison.value_delta.cost_per_field,
      // Best result
      best_method: result.best_method,
      best_quality: result.best_result ? result.comparison[
        result.best_method === 'firecrawl' ? 'paid_methods' : 'free_methods'
      ].quality_score : null,
      recommendation: result.recommendation,
      // Full data for debugging
      full_result: result,
    });

    if (error) {
      console.error('[extract-with-comparison] Failed to log to DB:', error.message);
    } else {
      console.log('[extract-with-comparison] Comparison logged to extraction_comparisons table');
    }
  } catch (err: any) {
    // Don't fail the main operation if logging fails
    console.error('[extract-with-comparison] DB logging error:', err.message);
  }
}

// ============================================================================
// Edge Function Handler
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const request: ExtractionRequest = await req.json();

    if (!request.url) {
      return new Response(
        JSON.stringify({ error: 'URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate URL
    try {
      new URL(request.url);
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid URL' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Run extraction orchestrator
    const result = await orchestrateExtraction(request);

    // Log to database if requested
    if (request.log_to_db !== false) {  // Default to logging
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );
      await logComparisonToDb(supabase, result);
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[extract-with-comparison] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Extraction failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

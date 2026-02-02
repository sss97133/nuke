#!/usr/bin/env npx tsx
/**
 * OLLAMA EXTRACTION WORKER
 *
 * Local fallback worker for processing items when OpenAI quota is exhausted.
 * Pulls failed items from import_queue where error_message contains "quota",
 * "rate limit", or similar OpenAI errors, then processes them with local Ollama.
 *
 * Prerequisites:
 * 1. Ollama installed and running: ollama serve
 * 2. Model pulled: ollama pull llama3.1:8b
 * 3. Environment variables: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   dotenvx run -- npx tsx scripts/ollama-extraction-worker.ts
 *   dotenvx run -- npx tsx scripts/ollama-extraction-worker.ts --continuous
 *   dotenvx run -- npx tsx scripts/ollama-extraction-worker.ts --batch-size 5
 *   dotenvx run -- npx tsx scripts/ollama-extraction-worker.ts --model llama3.1:8b
 *
 * This worker can run continuously on your local machine processing items
 * when OpenAI is unavailable due to quota limits.
 */

import { createClient } from '@supabase/supabase-js';

// Configuration
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3.1:8b';
const DEFAULT_BATCH_SIZE = 3;
const POLL_INTERVAL_MS = 10_000; // 10 seconds between polls in continuous mode
const FETCH_TIMEOUT_MS = 30_000; // 30s timeout for page fetches

// Supabase client
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Error patterns that indicate quota/rate limit issues
const QUOTA_ERROR_PATTERNS = [
  'quota',
  'rate limit',
  'rate_limit',
  'ratelimit',
  '429',
  'too many requests',
  'insufficient_quota',
  'billing',
  'exceeded',
  'openai api error',
];

interface QueueItem {
  id: string;
  listing_url: string;
  error_message: string | null;
  attempts: number;
  raw_data: any;
}

interface ExtractedData {
  url: string;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  series: string | null;
  trim: string | null;
  vin: string | null;
  mileage: number | null;
  price: number | null;
  asking_price: number | null;
  sold_price: number | null;
  exterior_color: string | null;
  interior_color: string | null;
  transmission: string | null;
  drivetrain: string | null;
  engine: string | null;
  body_style: string | null;
  description: string | null;
  location: string | null;
  seller: string | null;
  image_urls: string[];
  confidence: number;
}

// Parse command line arguments
function parseArgs(): { continuous: boolean; batchSize: number; model: string; maxItems: number } {
  const args = process.argv.slice(2);
  let continuous = false;
  let batchSize = DEFAULT_BATCH_SIZE;
  let model = DEFAULT_MODEL;
  let maxItems = Infinity;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--continuous' || args[i] === '-c') {
      continuous = true;
    } else if (args[i] === '--batch-size' || args[i] === '-b') {
      batchSize = parseInt(args[i + 1]) || DEFAULT_BATCH_SIZE;
      i++;
    } else if (args[i] === '--model' || args[i] === '-m') {
      model = args[i + 1] || DEFAULT_MODEL;
      i++;
    } else if (args[i] === '--max' || args[i] === '-n') {
      maxItems = parseInt(args[i + 1]) || Infinity;
      i++;
    }
  }

  return { continuous, batchSize, model, maxItems };
}

// Check if Ollama is running
async function checkOllama(): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, { method: 'GET' });
    if (!response.ok) return false;
    const data = await response.json();
    console.log(`Ollama available at ${OLLAMA_URL}`);
    console.log(`Available models: ${data.models?.map((m: any) => m.name).join(', ') || 'none'}`);
    return true;
  } catch (err) {
    return false;
  }
}

// Get quota-failed items from import_queue
async function getQuotaFailedItems(batchSize: number): Promise<QueueItem[]> {
  // Build OR conditions for error patterns
  const orConditions = QUOTA_ERROR_PATTERNS.map(p => `error_message.ilike.%${p}%`).join(',');

  const { data, error } = await supabase
    .from('import_queue')
    .select('id, listing_url, error_message, attempts, raw_data')
    .eq('status', 'failed')
    .or(orConditions)
    .order('created_at', { ascending: true })
    .limit(batchSize);

  if (error) {
    console.error('Error fetching queue:', error.message);
    return [];
  }

  return data || [];
}

// Fetch HTML content from URL
async function fetchHtmlContent(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`  HTTP ${response.status} for ${url}`);
      return null;
    }

    return await response.text();
  } catch (err: any) {
    console.error(`  Fetch error: ${err.message}`);
    return null;
  }
}

// Extract text from HTML
function extractTextFromHTML(html: string): string {
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#(\d+);/g, (_m, code) => {
    try { return String.fromCharCode(parseInt(code, 10)); } catch { return _m; }
  });
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

// Build extraction prompt
function buildExtractionPrompt(url: string, content: string): string {
  return `You are a vehicle data extraction specialist. Extract structured vehicle information from this listing page.

URL: ${url}

Page Content:
${content}

Extract the following fields as JSON. Return ONLY valid JSON, no other text:
{
  "vin": "17-character VIN if found, null otherwise",
  "year": 1974,
  "make": "Chevrolet",
  "model": "C10",
  "series": "C10 or K10 or similar series designation",
  "trim": "Cheyenne or Silverado or similar trim level",
  "engine": "350 V8 or similar engine description",
  "mileage": 123456,
  "price": 25000,
  "asking_price": 25000,
  "sold_price": null,
  "exterior_color": "Red",
  "interior_color": "Black",
  "transmission": "Automatic or Manual",
  "drivetrain": "RWD or 4WD",
  "body_style": "Pickup or Sedan or Coupe etc",
  "description": "Brief description of the vehicle",
  "location": "City, State",
  "seller": "Seller name if available",
  "image_urls": ["url1", "url2"],
  "title": "Full listing title",
  "confidence": 0.85
}

RULES:
1. Return ONLY valid JSON, no explanations or markdown
2. Use null for missing fields, not empty strings
3. Normalize make names: "Chevy" -> "Chevrolet"
4. Extract year as a number
5. Extract price as a number (remove $ and commas)
6. Extract mileage as a number (handle "56k miles" as 56000)
7. Set confidence 0-1 based on how complete the data is
8. VIN must be exactly 17 characters if present

JSON:`;
}

// Call Ollama for extraction
async function callOllama(prompt: string, model: string): Promise<any> {
  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: {
        temperature: 0.1,
        num_predict: 2000,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama API error: ${errorText}`);
  }

  const data = await response.json();
  return data.response || '';
}

// Parse JSON from model response
function parseJsonFromResponse(response: string): any {
  // Try direct parse
  try {
    return JSON.parse(response.trim());
  } catch {
    // Continue
  }

  // Try markdown code block
  const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      // Continue
    }
  }

  // Try to find JSON object
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      // Try fixing trailing commas
      let jsonStr = jsonMatch[0].replace(/,\s*([}\]])/g, '$1');
      try {
        return JSON.parse(jsonStr);
      } catch {
        // Give up
      }
    }
  }

  return null;
}

// Normalize extracted data
function normalizeExtractedData(data: any, url: string): ExtractedData {
  const parseNumber = (val: any): number | null => {
    if (val === null || val === undefined) return null;
    if (typeof val === 'number') return val;
    const str = String(val).replace(/[$,]/g, '').trim();
    const kMatch = str.match(/^(\d+(?:\.\d+)?)\s*k$/i);
    if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000);
    const num = parseFloat(str);
    return isNaN(num) ? null : num;
  };

  const normalizeYear = (val: any): number | null => {
    const num = parseNumber(val);
    if (!num || num < 1885 || num > new Date().getFullYear() + 2) return null;
    return Math.round(num);
  };

  const normalizeVin = (val: any): string | null => {
    if (!val) return null;
    const vin = String(val).toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');
    return vin.length === 17 ? vin : null;
  };

  const normalizeMake = (make: string | null): string | null => {
    if (!make) return null;
    const normalized: Record<string, string> = {
      'chevy': 'Chevrolet',
      'chev': 'Chevrolet',
      'mercedes': 'Mercedes-Benz',
      'merc': 'Mercedes-Benz',
      'vw': 'Volkswagen',
      'alfa': 'Alfa Romeo',
    };
    const lowerMake = make.toLowerCase().trim();
    return normalized[lowerMake] || make.trim();
  };

  const images = data.image_urls || data.images || [];

  return {
    url,
    title: data.title || data.listing_title || null,
    year: normalizeYear(data.year),
    make: normalizeMake(data.make),
    model: data.model?.trim() || null,
    series: data.series?.trim() || null,
    trim: data.trim?.trim() || null,
    vin: normalizeVin(data.vin),
    mileage: parseNumber(data.mileage),
    price: parseNumber(data.price),
    asking_price: parseNumber(data.asking_price || data.price),
    sold_price: parseNumber(data.sold_price),
    exterior_color: data.exterior_color || data.color || null,
    interior_color: data.interior_color || null,
    transmission: data.transmission || null,
    drivetrain: data.drivetrain || null,
    engine: data.engine || null,
    body_style: data.body_style || data.body_type || null,
    description: data.description || null,
    location: data.location || null,
    seller: data.seller || null,
    image_urls: Array.isArray(images) ? images.filter((u: any) => typeof u === 'string' && u.startsWith('http')) : [],
    confidence: typeof data.confidence === 'number' ? Math.min(1, Math.max(0, data.confidence)) : 0.7,
  };
}

// Process a single item
async function processItem(item: QueueItem, model: string): Promise<{ success: boolean; error?: string; data?: ExtractedData }> {
  const url = item.listing_url;
  console.log(`\n  Processing: ${url.length > 60 ? url.substring(0, 60) + '...' : url}`);

  // Step 1: Fetch HTML
  const html = await fetchHtmlContent(url);
  if (!html) {
    return { success: false, error: 'Failed to fetch HTML content' };
  }

  // Step 2: Extract text
  const textContent = extractTextFromHTML(html);
  if (textContent.length < 100) {
    return { success: false, error: 'Page content too short' };
  }

  // Step 3: Build prompt (limit to 15k chars for local model)
  const prompt = buildExtractionPrompt(url, textContent.substring(0, 15000));

  // Step 4: Call Ollama
  let rawResponse: string;
  try {
    rawResponse = await callOllama(prompt, model);
  } catch (err: any) {
    return { success: false, error: `Ollama error: ${err.message}` };
  }

  // Step 5: Parse JSON
  const extractedJson = parseJsonFromResponse(rawResponse);
  if (!extractedJson) {
    return { success: false, error: 'Failed to parse JSON from model response' };
  }

  // Step 6: Normalize
  const normalized = normalizeExtractedData(extractedJson, url);

  // Basic validation - must have at least year or make
  if (!normalized.year && !normalized.make) {
    return { success: false, error: 'No year or make extracted - likely not a vehicle listing' };
  }

  return { success: true, data: normalized };
}

// Update queue item status
async function updateQueueItem(
  item: QueueItem,
  success: boolean,
  data?: ExtractedData,
  error?: string,
  model?: string
): Promise<void> {
  const update: any = {
    attempts: item.attempts + 1,
    processed_at: new Date().toISOString(),
  };

  if (success && data) {
    update.status = 'complete';
    update.error_message = null;
    update.listing_title = data.title;
    update.listing_year = data.year;
    update.listing_make = data.make;
    update.listing_model = data.model;
    update.listing_price = data.price || data.asking_price;
    update.raw_data = {
      ...data,
      extraction_method: 'ollama_local',
      ollama_model: model,
      extracted_at: new Date().toISOString(),
    };
  } else {
    update.status = 'failed';
    update.error_message = `[Ollama] ${error || 'Unknown error'}`;
  }

  const { error: updateError } = await supabase
    .from('import_queue')
    .update(update)
    .eq('id', item.id);

  if (updateError) {
    console.error(`  Failed to update queue: ${updateError.message}`);
  }
}

// Main processing loop
async function main() {
  const { continuous, batchSize, model, maxItems } = parseArgs();

  console.log('');
  console.log('='.repeat(60));
  console.log('  OLLAMA EXTRACTION WORKER');
  console.log('  Local fallback for quota-exhausted OpenAI items');
  console.log('='.repeat(60));
  console.log('');
  console.log(`Mode: ${continuous ? 'continuous' : 'single batch'}`);
  console.log(`Batch size: ${batchSize}`);
  console.log(`Model: ${model}`);
  console.log(`Max items: ${maxItems === Infinity ? 'unlimited' : maxItems}`);
  console.log(`Ollama URL: ${OLLAMA_URL}`);
  console.log('');

  // Check Ollama availability
  const ollamaAvailable = await checkOllama();
  if (!ollamaAvailable) {
    console.error(`\nERROR: Ollama is not available at ${OLLAMA_URL}`);
    console.error('Make sure Ollama is running: ollama serve');
    console.error('And the model is pulled: ollama pull llama3.1:8b');
    process.exit(1);
  }

  let totalProcessed = 0;
  let totalSuccess = 0;
  let totalFailed = 0;

  const processOneBatch = async (): Promise<boolean> => {
    // Check if we've hit the max
    if (totalProcessed >= maxItems) {
      return false;
    }

    // Get quota-failed items
    const adjustedBatchSize = Math.min(batchSize, maxItems - totalProcessed);
    const items = await getQuotaFailedItems(adjustedBatchSize);

    if (items.length === 0) {
      return false;
    }

    console.log(`\n--- Processing batch of ${items.length} items ---`);

    for (const item of items) {
      if (totalProcessed >= maxItems) break;

      const result = await processItem(item, model);
      totalProcessed++;

      if (result.success) {
        totalSuccess++;
        console.log(`  OK: ${result.data?.year || '?'} ${result.data?.make || '?'} ${result.data?.model || '?'} (conf: ${result.data?.confidence?.toFixed(2)})`);
        await updateQueueItem(item, true, result.data, undefined, model);
      } else {
        totalFailed++;
        console.log(`  FAILED: ${result.error}`);
        await updateQueueItem(item, false, undefined, result.error, model);
      }
    }

    return true;
  };

  if (continuous) {
    console.log('\nRunning in continuous mode. Press Ctrl+C to stop.\n');

    while (true) {
      const hadWork = await processOneBatch();

      if (!hadWork) {
        console.log(`\nNo quota-failed items found. Waiting ${POLL_INTERVAL_MS / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
      } else {
        // Small delay between batches to be gentle
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      if (totalProcessed >= maxItems) {
        console.log(`\nReached max items limit (${maxItems}). Stopping.`);
        break;
      }
    }
  } else {
    await processOneBatch();
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('  SUMMARY');
  console.log('='.repeat(60));
  console.log(`  Total processed: ${totalProcessed}`);
  console.log(`  Successful: ${totalSuccess}`);
  console.log(`  Failed: ${totalFailed}`);
  console.log(`  Success rate: ${totalProcessed > 0 ? ((totalSuccess / totalProcessed) * 100).toFixed(1) : 0}%`);
  console.log('');
}

main().catch(console.error);

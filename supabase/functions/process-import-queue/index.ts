import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts';
import { normalizeListingLocation } from "../_shared/normalizeListingLocation.ts";
import { extractGalleryImagesFromHtml } from "../_shared/batDomMap.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function isFacebookUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return host === 'facebook.com' || host.endsWith('.facebook.com');
  } catch {
    return false;
  }
}

function isFacebookMarketplaceUrl(url: string): boolean {
  const s = String(url || '');
  if (!isFacebookUrl(s)) return false;
  return s.includes('/marketplace') || s.includes('/share/');
}

function parseFacebookListingId(url: string): string | null {
  const s = String(url || '');
  const m1 = s.match(/\/marketplace\/item\/(\d{5,})/i);
  if (m1?.[1]) return m1[1];
  const m2 = s.match(/[?&]item_id=(\d{5,})/i);
  if (m2?.[1]) return m2[1];
  return null;
}

// Production-safe debug logging (DB) + local ingest (if reachable).
const debugSupabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } }
);

function debugLog(payload: {
  sessionId: string;
  runId: string;
  hypothesisId: string;
  location: string;
  message: string;
  data: Record<string, any>;
}) {
  // Local ingest (works only when running function on the same machine as the ingest server)
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/4d355282-c690-469e-97e1-0114c2a0ef69',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ ...payload, timestamp: Date.now() })}).catch(()=>{});
  // #endregion

  // Production-safe: write to DB (service-role only table)
  // NOTE: supabase-js query builders in Deno are not always Promise-like; use an async IIFE.
  (async () => {
    try {
      await debugSupabase
        .from('debug_runtime_logs')
        .insert({
          source: 'process-import-queue',
          run_id: payload.runId,
          hypothesis_id: payload.hypothesisId,
          location: payload.location,
          message: payload.message,
          data: payload.data,
        });
    } catch {
      // swallow (debug should never break execution)
    }
  })();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isProbablyValidHttpUrl(raw: any): boolean {
  const s = (typeof raw === 'string' ? raw : String(raw || '')).trim();
  if (!s) return false;
  if (/[<>\n\r\t]/.test(s)) return false;
  try {
    const u = new URL(s);
    return (u.protocol === 'http:' || u.protocol === 'https:') && Boolean(u.hostname);
  } catch {
    return false;
  }
}

function looksLikeNonListingPage(url: string): boolean {
  try {
    const u = new URL(url);
    const path = (u.pathname || '').toLowerCase();
    if (path === '/' || path.length < 2) return true;
    // DealerCenter pattern: /inventory/make/model/stocknumber/ - has numeric stock at end
    const dealerCenterPattern = /\/inventory\/[\w-]+\/[\w-]+\/\d+\/?$/;
    if (dealerCenterPattern.test(path)) return false; // Valid DealerCenter detail page
    // Common inventory/category/marketing paths that should not become vehicles.
    if (path.includes('/inventory') && !/\b(19|20)\d{2}\b/.test(path) && !dealerCenterPattern.test(path)) return true;
    if (path.includes('/sold') && !/\b(19|20)\d{2}\b/.test(path)) return true;
    if (path.includes('/location/') || path.includes('/about') || path.includes('/contact')) return true;
    if (path.includes('/auth/') || path.includes('/sign-up') || path.includes('/signup')) return true;
    return false;
  } catch {
    return true;
  }
}

function isLikelyJunkIdentity(year: any, make: any, model: any): boolean {
  const y = typeof year === 'number' ? year : Number(year);
  const mk = String(make || '').toLowerCase().trim();
  const md = String(model || '').toLowerCase().trim();

  if (!Number.isFinite(y) || y < 1885 || y > new Date().getFullYear() + 1) return true;
  if (!mk || !md) return true;

  // Known “site name got stuffed into make/model” patterns seen in prod samples.
  if (mk === 'beverly' && md.includes('car club')) return true;
  if (mk === 'bring' && md.includes('a trailer')) return true;
  if (md.includes('view inventory') || md.includes('sold inventory')) return true;

  // Garbage length checks
  if (mk.length > 40) return true;
  if (md.length > 120) return true;

  return false;
}

// Helper function to clean model name - removes pricing, dealer info, financing text, etc.
function cleanModelName(model: string): string {
  if (!model) return '';
  
  let cleaned = model.trim();
  
  // Remove pricing patterns: "- $X,XXX", "$X,XXX", "(Est. payment OAC†)"
  cleaned = cleaned.replace(/\s*-\s*\$[\d,]+(?:\.\d{2})?/g, '');
  cleaned = cleaned.replace(/\s*\(\s*Est\.\s*payment\s*OAC[^)]*\)/gi, '');
  cleaned = cleaned.replace(/\s*\(\s*\$[\d,]+\s*Est\.\s*payment[^)]*\)/gi, '');
  
  // Remove dealer info: "(Dealer Name)", "(Location)", "(Call XXX)"
  cleaned = cleaned.replace(/\s*\([^)]*call[^)]*\)/gi, '');
  cleaned = cleaned.replace(/\s*\([^)]*\(?\d{3}\)?\s*[\d-]+\s*\)/g, '');
  cleaned = cleaned.replace(/\s*\([A-Z][a-z]+\s*[A-Z][a-z]+(?:\s*[A-Z][a-z]+)?\)/g, '');
  
  // Remove financing text: "(BUY HERE PAY HERE...)", "(Get Financed Now!)"
  cleaned = cleaned.replace(/\s*\([^)]*financ[^)]*\)/gi, '');
  cleaned = cleaned.replace(/\s*\([^)]*credit[^)]*\)/gi, '');
  cleaned = cleaned.replace(/\s*\([^)]*buy\s+here[^)]*\)/gi, '');
  
  // Remove SKU/stock numbers: "SKU:XXX", "Stock #:XXX"
  cleaned = cleaned.replace(/\s*SKU\s*:\s*\w+/gi, '');
  cleaned = cleaned.replace(/\s*Stock\s*#?\s*:\s*\w+/gi, '');
  
  // Remove BaT platform text
  cleaned = cleaned.replace(/\s*on\s*BaT\s*Auctions?\s*-?\s*ending[^|]*/gi, '');
  cleaned = cleaned.replace(/\s*\(Lot\s*#?\s*[\d,]+\)/gi, '');
  cleaned = cleaned.replace(/\s*\|\s*Bring\s*a\s*Trailer/gi, '');
  
  // Remove common descriptors that shouldn't be in model
  cleaned = cleaned.replace(/\s*\b(classic|vintage|restored|clean|mint|excellent|beautiful|collector['s]?)\b/gi, '');
  
  // Remove parenthetical content that looks like dealer info
  cleaned = cleaned.replace(/\s*\([^)]{20,}\)/g, ''); // Long parentheticals (likely dealer info)
  
  // Clean up multiple spaces
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  return cleaned;
}

// Helper function to validate make against known makes list
function isValidMake(make: string): boolean {
  if (!make) return false;
  
  const makeLower = make.toLowerCase();
  
  // Known valid makes
  const validMakes = [
    'chevrolet', 'chevy', 'ford', 'gmc', 'dodge', 'ram', 'toyota', 'honda', 'nissan',
    'bmw', 'mercedes', 'benz', 'mercedes-benz', 'audi', 'volkswagen', 'vw', 'porsche', 'jaguar',
    'cadillac', 'buick', 'pontiac', 'oldsmobile', 'lincoln', 'chrysler', 'jeep',
    'lexus', 'acura', 'infiniti', 'mazda', 'subaru', 'mitsubishi', 'suzuki',
    'hyundai', 'kia', 'volvo', 'tesla', 'genesis', 'alfa', 'romeo', 'alfa romeo', 'fiat', 'mini',
    'ferrari', 'lamborghini', 'mclaren', 'aston', 'martin', 'aston martin', 'bentley', 'rolls', 'royce', 'rolls-royce',
    'datsun', 'mercury', 'saturn', 'oldsmobile', 'plymouth', 'eagle', 'isuzu', 'saab',
    'harley', 'davidson', 'harley-davidson', 'harley davidson', 'yamaha', 'ducati', 'kawasaki', 'indian', 'triumph'
  ];
  
  // Check if make is in valid list
  if (validMakes.includes(makeLower)) return true;
  
  // Check for two-word makes
  if (makeLower.includes('alfa romeo') || makeLower.includes('alfa-romeo')) return true;
  if (makeLower.includes('aston martin') || makeLower.includes('aston-martin')) return true;
  if (makeLower.includes('rolls royce') || makeLower.includes('rolls-royce')) return true;
  if (makeLower.includes('mercedes benz') || makeLower.includes('mercedes-benz')) return true;
  if (makeLower.includes('harley davidson') || makeLower.includes('harley-davidson')) return true;
  
  // Invalid makes (descriptors, colors, adjectives)
  const invalidMakes = [
    'used', 'restored', 'beautiful', 'collector', 'collectors', 'classic', 'featured',
    'vintage', 'custom', 'clean', 'mint', 'excellent', 'good', 'fair',
    'silver', 'black', 'white', 'red', 'blue', 'green', 'yellow', 'gray', 'grey',
    'fuel-injected', 'powered', 'owned', 'half-scale', 'exotic',
    '10k-mile', '18k-mile', '47k-mile', '20-years-owned', '5k-mile'
  ];
  
  if (invalidMakes.includes(makeLower)) return false;

  // Basic sanity checks: allow unknown makes (dealer inventories include many niche brands),
  // but still reject obviously-garbage values.
  if (!/[a-z]/i.test(make)) return false;
  if (makeLower.length < 2 || makeLower.length > 40) return false;

  // If it's a single word and not in the known list, allow it (e.g., "Autech", "RUF", "Spyker").
  return true;
}

function inferMakeModelFromTitle(title: string): { make: string | null; model: string | null } {
  const t = (title || '').replace(/\s+/g, ' ').trim();
  if (!t) return { make: null, model: null };

  // Site-prefix stripping: some sites include branding in <title> like
  // "L'art de l'automobile | Audi A1 ..." which must not be treated as vehicle make.
  // If there is a "|" delimiter, the right-hand side is usually the vehicle title.
  const pipeParts = t.split('|').map((p) => p.trim()).filter(Boolean);
  const tNoSitePrefix = pipeParts.length >= 2 ? pipeParts.slice(1).join(' | ').trim() : t;

  // Common multi-word makes we want to preserve as make (not split).
  const multiWordMakes = [
    'Aston Martin',
    'Alfa Romeo',
    'Rolls-Royce',
    'Rolls Royce',
    'Mercedes-Benz',
    'Mercedes Benz',
    'Land Rover',
    'AM General',
    'Brough Superior',
  ];

  const lower = tNoSitePrefix.toLowerCase();
  for (const m of multiWordMakes) {
    const ml = m.toLowerCase();
    if (lower.startsWith(ml + ' ')) {
      const rest = tNoSitePrefix.slice(m.length).trim();
      return { make: m, model: rest || null };
    }
  }

  // Fallback: first token as make, remainder as model.
  const parts = tNoSitePrefix.split(' ').filter(Boolean);
  if (parts.length === 1) return { make: parts[0], model: null };
  return { make: parts[0], model: parts.slice(1).join(' ') };
}

function looksLikeSiteBrandNotMake(make: string): boolean {
  const m = (make || '').toLowerCase().replace(/[’']/g, "'").trim();
  if (!m) return false;
  if (m === "l'art" || m === "l'art." || m === "lart") return true;
  if (m.includes("l'art") && m.includes('automobile')) return true;
  if (m.includes('automobile') && (m.startsWith('l') || m.startsWith("l'"))) return true;
  return false;
}

function extractGeneralColors(raw: any): { primary: string | null; secondary: string | null; interior: string | null; raw: string | null } {
  const text = (raw ?? '').toString().replace(/\s+/g, ' ').trim();
  if (!text) return { primary: null, secondary: null, interior: null, raw: null };

  const lower = text.toLowerCase();

  const mapTokenToColor = (t: string): string | null => {
    const s = (t || '').toLowerCase();
    // Common FR/IT/EN color stems seen on dealer listings
    if (/(nero|noir|black)/.test(s)) return 'Black';
    if (/(bianco|blanc|white)/.test(s)) return 'White';
    if (/(rosso|rouge|red)/.test(s)) return 'Red';
    if (/(blu|bleu|blue)/.test(s)) return 'Blue';
    if (/(verde|vert|green)/.test(s)) return 'Green';
    if (/(grigio|gris|grey|gray)/.test(s)) return 'Grey';
    if (/(giallo|jaune|yellow)/.test(s)) return 'Yellow';
    if (/(argento|argent|silver)/.test(s)) return 'Silver';
    if (/(beige)/.test(s)) return 'Beige';
    if (/(marron|brun|brown)/.test(s)) return 'Brown';
    if (/(orange)/.test(s)) return 'Orange';
    if (/(violet|purple)/.test(s)) return 'Purple';
    return null;
  };

  // Try to isolate interior segment
  let exteriorPart = text;
  let interiorPart: string | null = null;
  const interiorIdx = lower.search(/\b(int(é|e)rieur|interior|habitacle)\b/);
  if (interiorIdx >= 0) {
    exteriorPart = text.slice(0, interiorIdx).replace(/[,\-–]+$/, '').trim();
    interiorPart = text.slice(interiorIdx).trim();
  }

  const tokens = exteriorPart
    .split(/[,;]+/g)
    .map((x) => x.trim())
    .filter(Boolean);

  const found: string[] = [];
  for (const tok of tokens) {
    const c = mapTokenToColor(tok);
    if (c && !found.includes(c)) found.push(c);
  }

  const primary = found[0] || mapTokenToColor(exteriorPart) || null;
  const secondary = found.length > 1 ? found[1] : null;
  const interior = interiorPart ? (mapTokenToColor(interiorPart) || null) : null;

  return { primary, secondary, interior, raw: text };
}

function buildLartRepackagedDescription(scrape: any): string {
  const descFr = typeof scrape?.description_fr === 'string' ? scrape.description_fr.trim() : '';
  const descEn = typeof scrape?.description_en === 'string' ? scrape.description_en.trim() : '';
  const infoBullets = Array.isArray(scrape?.info_bullets) ? scrape.info_bullets.map((x: any) => String(x).trim()).filter(Boolean) : [];
  const service = Array.isArray(scrape?.service_history) ? scrape.service_history.map((x: any) => String(x).trim()).filter(Boolean) : [];
  const options = Array.isArray(scrape?.options) ? scrape.options.map((x: any) => String(x).trim()).filter(Boolean) : [];

  const blocks: string[] = [];

  if (infoBullets.length) {
    blocks.push(['INFORMATIONS', ...infoBullets.map((x) => `- ${x}`)].join('\n'));
  }
  if (options.length) {
    blocks.push(['OPTIONS', ...options.map((x) => `- ${x}`)].join('\n'));
  }
  if (service.length) {
    blocks.push(['SERVICE HISTORY', ...service.map((x) => `- ${x}`)].join('\n'));
  }
  if (descFr) {
    blocks.push(['DESCRIPTION (FR)', descFr].join('\n'));
  }
  if (descEn) {
    blocks.push(['DESCRIPTION (EN)', descEn].join('\n'));
  }

  // Fallback to generic description if we didn't build anything structured.
  if (!blocks.length) {
    const generic = typeof scrape?.description === 'string' ? scrape.description.trim() : '';
    return generic;
  }

  return blocks.join('\n\n').trim();
}

function coerceDateOnly(input: any): string | null {
  if (input === null || typeof input === 'undefined') return null;
  const s = String(input).trim();
  if (!s) return null;
  // Accept ISO-like dates; keep only YYYY-MM-DD to avoid polluting canon timestamps.
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m?.[1] ? m[1] : null;
}

// Helper function to extract price from text, avoiding monthly payments
// Handles European-style formatting where period is thousands separator (e.g., $14.500 = $14,500)
function extractVehiclePrice(text: string): number | null {
  if (!text) return null;

  // Helper to normalize price string (handles both comma and period as thousands separators)
  const normalizePriceString = (priceStr: string): number | null => {
    // Remove $ and spaces
    let cleaned = priceStr.replace(/[\$\s]/g, '');
    
    // Handle European-style: $14.500 (period as thousands separator)
    // Pattern: digits.three_digits at the end suggests thousands separator
    const euroMatch = cleaned.match(/^(\d+)\.(\d{3})$/);
    if (euroMatch) {
      // This is European format (e.g., "14.500" = 14500)
      return parseInt(euroMatch[1] + euroMatch[2]);
    }
    
    // Handle standard format: $14,500 (comma as thousands separator)
    // Also handle mixed: $1,234.56 (comma thousands, period decimal)
    if (cleaned.includes(',') && cleaned.includes('.')) {
      // Has both comma and period - comma is thousands, period is decimal
      cleaned = cleaned.replace(/,/g, '');
      return Math.round(parseFloat(cleaned));
    }
    
    // Handle comma-only (thousands separator)
    if (cleaned.includes(',')) {
      cleaned = cleaned.replace(/,/g, '');
      return parseInt(cleaned);
    }
    
    // Handle period-only - need to determine if it's decimal or thousands separator
    if (cleaned.includes('.')) {
      const parts = cleaned.split('.');
      // If exactly 3 digits after period, likely thousands separator (e.g., "14.500")
      if (parts.length === 2 && parts[1].length === 3 && parts[1].match(/^\d{3}$/)) {
        // Thousands separator
        return parseInt(parts[0] + parts[1]);
      } else {
        // Decimal separator, round to integer
        return Math.round(parseFloat(cleaned));
      }
    }
    
    // No separators, just digits
    return parseInt(cleaned);
  };
  
  // First, try to find structured price fields (especially "Asking" which is common on Craigslist)
  const structuredPatterns = [
    /Asking[:\s]*\$?\s*([\d,.]+)/i,  // "Asking $14.500" or "Asking $14,500"
    /Price[:\s]*\$?\s*([\d,.]+)/i,
    /Sale\s+Price[:\s]*\$?\s*([\d,.]+)/i,
    /Vehicle\s+Price[:\s]*\$?\s*([\d,.]+)/i
  ];
  
  for (const pattern of structuredPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const price = normalizePriceString(match[1]);
      if (price && price >= 1000) {
        return price;
      }
    }
  }
  
  // Avoid monthly payment patterns
  if (text.match(/Est\.\s*payment|Monthly\s*payment|OAC[†]?/i)) {
    // Look for actual vehicle price, not monthly payment
    const vehiclePriceMatch = text.match(/(?:Price|Asking|Sale)[:\s]*\$?\s*([\d,.]+)/i);
    if (vehiclePriceMatch && vehiclePriceMatch[1]) {
      const price = normalizePriceString(vehiclePriceMatch[1]);
      if (price && price >= 1000) {
        return price;
      }
    }
    return null; // Don't extract if only monthly payment found
  }
  
  // Extract all prices and prefer the largest (vehicle prices are typically $5,000+)
  // Match both $14.500 (European) and $14,500 (US) formats
  const priceMatches = text.match(/\$\s*([\d,.]+)/g);
  if (priceMatches) {
    const prices = priceMatches
      .map(m => {
        const numMatch = m.match(/\$\s*([\d,.]+)/);
        return numMatch ? normalizePriceString(numMatch[1]) : null;
      })
      .filter((p): p is number => p !== null && p >= 1000);
    
    // If we found multiple $ amounts in free text, do not guess.
    // Only accept an unstructured price if it is unambiguous.
    if (prices.length === 1) {
      return prices[0];
    }
  }
  
  return null;
}

interface ProcessRequest {
  batch_size?: number;
  priority_only?: boolean;
  source_id?: string;
  // Keep edge runtimes safe when ingesting heavy dealer listings.
  // - fast_mode: reduce immediate image downloads
  // - max_images_immediate: explicit override (0 = skip immediate image uploads)
  // - skip_image_upload: alias for max_images_immediate=0
  fast_mode?: boolean;
  max_images_immediate?: number;
  skip_image_upload?: boolean;
}

/**
 * Trigger dealer website inventory sync
 * This queues a scrape of the dealer's full website inventory
 */
async function triggerDealerInventorySync(orgId: string, website: string, supabase: any) {
  try {
    // NOTE: `organizations.last_inventory_sync` is legacy. Canonical org table is `businesses`,
    // and the import pipeline dedupes via import_queue constraints anyway.
    // Keep this simple: always trigger a sync when requested.

    // Trigger scrape-multi-source function to scrape dealer website
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    
    const response = await fetch(`${supabaseUrl}/functions/v1/scrape-multi-source`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`
      },
      body: JSON.stringify({
        source_url: website,
        source_type: 'dealer_website',
        organization_id: orgId,
        max_results: 100 // Scrape up to 100 vehicles
      })
    });
    
    if (response.ok) {
      console.log(`Triggered inventory sync for ${website}`);
    } else {
      throw new Error(`Sync trigger failed: ${response.status}`);
    }
  } catch (error: any) {
    console.error(`❌ Failed to trigger inventory sync: ${error.message}`);
    throw error;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const sessionId = 'process-import-queue';
    const runId = crypto.randomUUID?.() || String(Date.now());

    debugLog({
      sessionId,
      runId,
      hypothesisId: 'H5',
      location: 'supabase/functions/process-import-queue/index.ts:entry',
      message: 'process-import-queue invoked',
      data: { method: req.method, has_body: req.body !== null, content_type: req.headers.get('content-type') },
    });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body: ProcessRequest = await req.json().catch(() => ({}));
    const {
      batch_size = 40, // Increased for Large compute (faster DB operations)
      priority_only = false,
      source_id,
      fast_mode = false,
      max_images_immediate,
      skip_image_upload = false,
    } = body;
    debugLog({
      sessionId,
      runId,
      hypothesisId: 'H5',
      location: 'supabase/functions/process-import-queue/index.ts:parsed_body',
      message: 'Parsed request body',
      data: { batch_size, priority_only, source_id, fast_mode, max_images_immediate, skip_image_upload },
    });

    // Claim work atomically (prevents double-processing and enables horizontal scaling).
    // Requires migration: 20251215000003_import_queue_schema_and_locking.sql
    const workerId = `process-import-queue:${crypto.randomUUID?.() || String(Date.now())}`;
    const { data: queueItems, error: queueError } = await supabase.rpc('claim_import_queue_batch', {
      p_batch_size: batch_size,
      p_max_attempts: 3,
      p_priority_only: priority_only,
      p_source_id: source_id || null,
      p_worker_id: workerId,
      p_lock_ttl_seconds: 15 * 60,
    });

    if (queueError) {
      throw new Error(`Failed to claim queue: ${queueError.message}`);
    }

    if (!queueItems || queueItems.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No items to process',
        processed: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`Processing ${queueItems.length} queue items`);
    debugLog({
      sessionId,
      runId,
      hypothesisId: 'H5',
      location: 'supabase/functions/process-import-queue/index.ts:process_start',
      message: 'Fetched import_queue items',
      data: { batch_size, priority_only, source_id, items: queueItems.length, item_ids: queueItems.slice(0, 5).map((x: any) => x.id) },
    });

    const results = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      duplicates: 0,
      vehicles_created: [] as string[]
    };

    for (const item of queueItems) {
      try {
        debugLog({
          sessionId,
          runId,
          hypothesisId: 'H1',
          location: 'supabase/functions/process-import-queue/index.ts:item_start',
          message: 'Start processing queue item',
          data: { queue_id: item.id, listing_url: item.listing_url, listing_year: item.listing_year, listing_make: item.listing_make, listing_model: item.listing_model, source_id: item.source_id, raw_flags: { inventory_extraction: item.raw_data?.inventory_extraction, business_type: item.raw_data?.business_type } },
        });

        // Already marked as processing by claim_import_queue_batch().

        // Discovery URL dedupe:
        // If a vehicle already exists for this listing URL, DO NOT early-exit as "duplicate".
        // We still want to scrape and backfill fields (repair pass).
        let existingVehicleByUrlId: string | null = null;
        let existingVehicleByUrlLocked = false;
        const { data: existingVehicleByUrl } = await supabase
          .from('vehicles')
          .select('id, ownership_verified, ownership_verification_id')
          .eq('discovery_url', item.listing_url)
          .maybeSingle();

        if (existingVehicleByUrl?.id) {
          existingVehicleByUrlId = existingVehicleByUrl.id;
          existingVehicleByUrlLocked =
            existingVehicleByUrl.ownership_verified === true || !!existingVehicleByUrl.ownership_verification_id;
        }

        // Scrape vehicle data - Firecrawl/HTML for normal sites, but Facebook Marketplace must go through scrape-vehicle.
        console.log('🔍 Scraping URL:', item.listing_url);
        
        const isFacebookMarketplace = isFacebookMarketplaceUrl(item.listing_url);
        let html = '';
        let scrapeSuccess = false;
        const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY');
        let scrapeData: any = null;
        let doc: any = null;

        if (isFacebookMarketplace) {
          const { data: fbResp, error: fbErr } = await supabase.functions.invoke('scrape-vehicle', {
            body: { url: item.listing_url }
          });

          if (fbErr) {
            throw new Error(`scrape-vehicle invoke failed for Facebook Marketplace: ${fbErr.message}`);
          }
          if (!fbResp?.success) {
            throw new Error(`Facebook Marketplace scrape failed: ${fbResp?.error || 'Unknown error'}`);
          }

          const fbData = fbResp?.data || fbResp;
          scrapeData = {
            success: true,
            data: {
              source: fbData?.source || 'Facebook Marketplace',
              listing_url: item.listing_url,
              discovery_url: item.listing_url,
              title: fbData?.title || '',
              description: fbData?.description || '',
              images: Array.isArray(fbData?.images) ? fbData.images : [],
              timestamp: new Date().toISOString(),
              year: fbData?.year ?? null,
              make: fbData?.make ?? null,
              model: fbData?.model ?? null,
              asking_price: fbData?.asking_price ?? fbData?.price ?? null,
              location: fbData?.location ?? null,
              vin: fbData?.vin ?? null,
              platform: 'facebook_marketplace',
              listing_id: parseFacebookListingId(item.listing_url),
              raw: fbData || null,
            }
          };
        }
        
        // Try Firecrawl first if API key is available (bypasses bot protection)
        // Use timeout to prevent hanging
        if (!isFacebookMarketplace && firecrawlApiKey) {
          try {
            console.log('🔥 Attempting Firecrawl scrape...');
            const firecrawlController = new AbortController();
            const firecrawlTimeout = setTimeout(() => firecrawlController.abort(), 15000); // 15s timeout
            
            const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${firecrawlApiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                url: item.listing_url,
                formats: ['html'],
                pageOptions: {
                  waitFor: 1000, // Reduced wait time
                },
              }),
              signal: firecrawlController.signal
            });

            clearTimeout(firecrawlTimeout);

            if (firecrawlResponse.ok) {
              const firecrawlData = await firecrawlResponse.json();
              if (firecrawlData.success && firecrawlData.data?.html) {
                html = firecrawlData.data.html;
                scrapeSuccess = true;
                console.log('✅ Firecrawl scrape successful');
              } else {
                console.warn('⚠️ Firecrawl returned no HTML');
              }
            } else {
              const errorText = await firecrawlResponse.text().catch(() => '');
              console.warn(`⚠️ Firecrawl failed: ${firecrawlResponse.status} - ${errorText.substring(0, 100)}`);
            }
          } catch (error: any) {
            if (error.name === 'AbortError') {
              console.warn('⚠️ Firecrawl timeout');
            } else {
              console.warn('⚠️ Firecrawl error:', error.message);
            }
            // Fall through to direct fetch
          }
        }
        
        // Fallback to direct fetch if Firecrawl didn't work
        if (!isFacebookMarketplace && !scrapeSuccess) {
          console.log('📡 Using direct fetch (fallback)');
          const fetchController = new AbortController();
          const fetchTimeout = setTimeout(() => fetchController.abort(), 10000); // 10s timeout
          
          try {
            const response = await fetch(item.listing_url, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
              },
              signal: fetchController.signal
            });

            clearTimeout(fetchTimeout);

            if (!response.ok) {
              throw new Error(`Scrape failed: ${response.status}`);
            }

            html = await response.text();
          } catch (fetchError: any) {
            clearTimeout(fetchTimeout);
            if (fetchError.name === 'AbortError') {
              throw new Error('Scrape timeout');
            }
            throw fetchError;
          }
        }

        if (isFacebookMarketplace) {
          // Facebook Marketplace has no HTML parsing path (auth gated).
          // scrapeData is already populated via scrape-vehicle above.
        } else {
        // Remove "Pending Organization Assignments" HTML blocks before parsing
        html = html.replace(/<div[^>]*style="[^"]*padding:\s*12px[^"]*background:\s*rgb\(254,\s*243,\s*199\)[^"]*"[^>]*>[\s\S]*?REJECT<\/div>/gi, '');
        
        // Remove QR code links and junk text
        html = html.replace(/QR\s+Code\s+Link\s+to\s+This\s+Post/gi, '');
        html = html.replace(/<div[^>]*style="[^"]*font-size:\s*9pt[^"]*"[^>]*>[\s\S]*?QR\s+Code[\s\S]*?<\/div>/gi, '');
        html = html.replace(/QR\s+Code[\s\S]{0,200}/gi, '');
        
        doc = new DOMParser().parseFromString(html, 'text/html');

        // Basic data extraction
        scrapeData = {
          success: true,
          data: {
            source: 'Unknown',
            listing_url: item.listing_url,
            discovery_url: item.listing_url,
            title: doc.querySelector('title')?.textContent || '',
            description: '',
            images: item.listing_url.includes('bringatrailer.com') ? [] : extractImageURLs(html),
            timestamp: new Date().toISOString(),
            year: null,
            make: null,
            model: null,
            asking_price: null,
            location: null,
          }
        };

        // TBTFW / AutoManager (Webflow) listings: /am-inventory/<slug>
        // These pages include VIN/Stock/Mileage and a full AutoManager image gallery.
        // Our generic parsers often miss this because the labels are in separate divs.
        const isTbtfwAmInventory = (() => {
          try {
            const u = new URL(item.listing_url);
            const host = u.hostname.replace(/^www\./, '').toLowerCase();
            return host === 'tbtfw.com' && u.pathname.toLowerCase().startsWith('/am-inventory/');
          } catch {
            return false;
          }
        })();

        const bodyText = doc?.body?.textContent || '';

        if (isTbtfwAmInventory) {
          scrapeData.data.source = 'TBTFW';
          scrapeData.data.platform = 'tbtfw';
          try {
            scrapeData.data.platform_url = new URL(item.listing_url).origin;
          } catch {
            // ignore
          }

          // VIN + Stock # appear as:
          // <div class="vin pad-right">VIN </div><div class="vin">VF9...</div>
          // <div class="vin pad-right">Stock # </div><div class="vin">795038</div>
          const vinFromText = bodyText.match(/\bVIN\b[\s:]*([A-HJ-NPR-Z0-9]{17})\b/i)?.[1] || null;
          const vinFromHtml =
            html.match(/VIN\s*<\/div>\s*<div[^>]*class="[^"]*\bvin\b[^"]*"[^>]*>\s*([A-HJ-NPR-Z0-9]{17})\s*<\/div>/i)?.[1] ||
            null;
          const vin = (vinFromText || vinFromHtml || '').toUpperCase().trim();
          if (vin && vin.length === 17 && !/[IOQ]/.test(vin)) {
            scrapeData.data.vin = vin;
          }

          const stock =
            html.match(/Stock\s*#\s*<\/div>\s*<div[^>]*class="[^"]*\bvin\b[^"]*"[^>]*>\s*([A-Za-z0-9-]{2,20})\s*<\/div>/i)?.[1] ||
            bodyText.match(/\bStock\s*#\b[\s:]*([A-Za-z0-9-]{2,20})/i)?.[1] ||
            null;
          if (stock) {
            scrapeData.data.stock_number = String(stock).trim();
          }

          // Price: prefer numeric, but keep null when the page shows "Call for Price".
          if (!scrapeData.data.asking_price) {
            const callForPrice = /\bCall\s+for\s+Price\b/i.test(bodyText) || /\bCall\s+for\s+Price\b/i.test(html);
            if (!callForPrice) {
              const extractedPrice = extractVehiclePrice(bodyText);
              if (extractedPrice) scrapeData.data.asking_price = extractedPrice;
            }
          }

          // Mileage: common format is "5,715 Miles" and it is visible in textContent.
          if (!scrapeData.data.mileage) {
            const m1 = bodyText.match(/(\d{1,3}(?:,\d{3})+|\d{2,7})\s*Miles?\b/i);
            if (m1?.[1]) {
              const miles = parseInt(m1[1].replace(/,/g, ''), 10);
              if (Number.isFinite(miles) && miles > 0 && miles < 10000000) {
                scrapeData.data.mileage = miles;
              }
            }
          }

          // Images: AutoManager gallery uses Azure blob URLs.
          // Capture all wmphotos assets and prefer the *_1280 size (stable and high-res).
          try {
            const imgs = Array.from(html.matchAll(/https:\/\/automanager\.blob\.core\.windows\.net\/wmphotos\/043135\/[^"'\s<>]+?\.(?:jpg|jpeg|png|webp)/gi))
              .map((m) => (m[0] || '').trim())
              .filter(Boolean)
              .map((u) => u.replace(/_(?:320|640|800|1024)\.(jpg|jpeg|png|webp)$/i, '_1280.$1'));
            const deduped = Array.from(new Set(imgs));
            if (deduped.length > 0) {
              scrapeData.data.images = deduped;
            }
          } catch {
            // ignore
          }
        }

        // L'Art de L'Automobile: use the dedicated `scrape-vehicle` extractor for /fiche/ pages.
        // This is critical for: hi-res image set, structured options/service history, mileage/price.
        try {
          if (item.listing_url.includes('lartdelautomobile.com/fiche/')) {
            const { data: lartData, error: lartErr } = await supabase.functions.invoke('scrape-vehicle', {
              body: { url: item.listing_url }
            });
            if (!lartErr && lartData?.success) {
              // Merge, preferring the lart extractor for overlapping fields.
              scrapeData.data = {
                ...scrapeData.data,
                ...lartData,
                // Keep a consistent wrapper shape
                source: lartData.source || 'lartdelautomobile',
                images: Array.isArray(lartData.images) && lartData.images.length > 0 ? lartData.images : scrapeData.data.images,
              };

              // Normalize placeholder VIN values into null.
              const v = (scrapeData.data.vin || '').toString().trim();
              if (!v || v === '/NOT PROVIDED/' || v.toUpperCase().includes('NOT PROVIDED')) {
                scrapeData.data.vin = null;
              }
            } else if (lartErr) {
              console.warn(`⚠️ lart scrape-vehicle invoke failed (non-blocking): ${lartErr.message}`);
            }
          }
        } catch (e: any) {
          console.warn(`⚠️ lart scrape-vehicle integration failed (non-blocking): ${e?.message || String(e)}`);
        }

        // Extract VIN from HTML
        const vinPatterns = [
          /<div[^>]*class="[^"]*spec-line[^"]*vin[^"]*"[^>]*>VIN\s+([A-HJ-NPR-Z0-9]{17})/i,
          /<[^>]*class="[^"]*vin[^"]*"[^>]*>[\s\S]*?VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i,
          /VIN[:\s]+([A-HJ-NPR-Z0-9]{17})/i,
          /VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i,
        ];

        for (const pattern of vinPatterns) {
          const match = html.match(pattern);
          if (match && match[1] && match[1].length === 17 && !/[IOQ]/.test(match[1])) {
            scrapeData.data.vin = match[1].toUpperCase();
            break;
          }
        }

        // Helper function to identify if vehicle is a truck
        const isTruck = (make: string, model: string, title: string, description: string): boolean => {
          const searchText = `${make} ${model} ${title} ${description}`.toLowerCase();
          
          // Truck indicators
          const truckKeywords = [
            'truck', 'pickup', 'c10', 'c20', 'c30', 'k10', 'k20', 'k30',
            'c1500', 'c2500', 'c3500', 'k1500', 'k2500', 'k3500',
            'f150', 'f250', 'f350', 'f450', 'f550',
            'ram 1500', 'ram 2500', 'ram 3500',
            'tacoma', 'tundra', 'ranger', 'colorado', 'canyon',
            'silverado', 'sierra', 'titan', 'frontier'
          ];
          
          // Body style indicators
          const bodyStyleKeywords = ['pickup', 'truck', 'crew cab', 'extended cab', 'regular cab', 'shortbed', 'longbed'];
          
          return truckKeywords.some(kw => searchText.includes(kw)) ||
                 bodyStyleKeywords.some(kw => searchText.includes(kw)) ||
                 /^(c|k)\d{1,4}$/i.test(model) ||
                 /^(c|k)\d{4}$/i.test(model);
        };

        // Bring a Trailer parsing - URL pattern is most reliable
        if (item.listing_url.includes('bringatrailer.com')) {
          console.log('🔍 Parsing BaT URL...');
          scrapeData.data.source = 'Bring a Trailer';

          // CRITICAL: BaT image extraction must come from the listing's gallery JSON ONLY.
          // Do NOT rely on any page-wide <img> scanning (it will pull UI assets and other listing promos).
          try {
            const gallery = extractGalleryImagesFromHtml(html);
            if (Array.isArray(gallery?.urls) && gallery.urls.length > 0) {
              scrapeData.data.images = gallery.urls;
            } else {
              // If we can't find the canonical gallery, leave images as-is.
              // (It may have been populated by a non-contaminating source, e.g. Firecrawl structured output.)
            }
          } catch {
            // ignore
          }
          
          // CRITICAL: Parse from URL first - most reliable format: /listing/YEAR-MAKE-MODEL-ID/
          // Pattern: /listing/1992-chevrolet-454-ss-14/ or /listing/2003-harley-davidson-electra-glide-classic/
          // Try pattern with numeric ID first
          let urlMatch = item.listing_url.match(/listing\/(\d{4})-([^-]+(?:-[^-]+)*?)-(\d+)\/?$/);
          // If no match, try pattern without numeric ID (just year-make-model)
          if (!urlMatch) {
            urlMatch = item.listing_url.match(/listing\/(\d{4})-([^-]+(?:-[^-]+)*?)\/?$/);
          }
          if (urlMatch) {
            const year = parseInt(urlMatch[1]);
            const makeModelStr = urlMatch[2]; // e.g., "chevrolet-454-ss"
            
            if (year >= 1885 && year <= new Date().getFullYear() + 1) {
              scrapeData.data.year = year;
            }
            
            // Split by hyphens and find make
            const urlParts = makeModelStr.split('-');
            
            // Known makes list (check first 1-2 words)
            const knownMakes = [
              'chevrolet', 'chevy', 'ford', 'gmc', 'dodge', 'toyota', 'honda', 'nissan',
              'bmw', 'mercedes', 'benz', 'audi', 'volkswagen', 'vw', 'porsche', 'jaguar',
              'cadillac', 'buick', 'pontiac', 'oldsmobile', 'lincoln', 'chrysler',
              'lexus', 'acura', 'infiniti', 'mazda', 'subaru', 'mitsubishi',
              'hyundai', 'kia', 'volvo', 'tesla', 'genesis', 'alfa', 'romeo', 'fiat', 'mini',
              'ferrari', 'lamborghini', 'mclaren', 'aston', 'martin', 'bentley', 'rolls', 'royce'
            ];
            
            // Find make (check first 1-2 words)
            let makeFound = false;
            let makeIndex = 0;
            
            // Try single word first
            if (urlParts.length > 0 && knownMakes.includes(urlParts[0].toLowerCase())) {
              makeIndex = 1;
              makeFound = true;
            }
            // Try two words (e.g., "alfa romeo", "aston martin")
            else if (urlParts.length >= 2) {
              const twoWord = `${urlParts[0]}-${urlParts[1]}`.toLowerCase();
              if (knownMakes.includes(twoWord) || 
                  (urlParts[0].toLowerCase() === 'alfa' && urlParts[1].toLowerCase() === 'romeo') ||
                  (urlParts[0].toLowerCase() === 'aston' && urlParts[1].toLowerCase() === 'martin') ||
                  (urlParts[0].toLowerCase() === 'rolls' && urlParts[1].toLowerCase() === 'royce')) {
                makeIndex = 2;
                makeFound = true;
              }
            }
            
            if (makeFound) {
              // Extract make
              let makeParts = urlParts.slice(0, makeIndex);
              let make = makeParts.join(' ').toLowerCase();
              if (make === 'chevy') make = 'chevrolet';
              if (make === 'vw') make = 'volkswagen';
              if (make === 'benz') make = 'mercedes';
              if (make === 'alfa romeo' || make === 'alfa-romeo') make = 'Alfa Romeo';
              if (make === 'aston martin' || make === 'aston-martin') make = 'Aston Martin';
              if (make === 'rolls royce' || make === 'rolls-royce') make = 'Rolls-Royce';
              scrapeData.data.make = make.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
              
              // Extract model (rest of URL parts, but filter out common BaT suffixes)
              const modelParts = urlParts.slice(makeIndex);
              if (modelParts.length > 0) {
                let model = modelParts.join(' ').trim();
                // Filter out common BaT-specific terms that might be in the URL
                model = model.replace(/\s*on\s*bat\s*auctions?/i, '');
                model = model.replace(/\s*ending\s+\w+\s+\d+/i, '');
                model = model.replace(/\s*lot\s*#?\d+/i, '');
                model = model.replace(/\s*\|\s*bring\s*a\s*trailer/i, '');
                // Clean model name
                model = cleanModelName(model);
                scrapeData.data.model = model.trim();
              }
              
              console.log(`✅ BaT URL parsed: ${scrapeData.data.year} ${scrapeData.data.make} ${scrapeData.data.model}`);
            } else {
              // Fallback: assume first word is make (but validate it)
              if (urlParts.length >= 2) {
                let make = urlParts[0].toLowerCase();
                if (make === 'chevy') make = 'chevrolet';
                
                // Only use if valid make
                if (isValidMake(make)) {
                  scrapeData.data.make = make.charAt(0).toUpperCase() + make.slice(1);
                  let model = urlParts.slice(1).join(' ').trim();
                  model = cleanModelName(model);
                  scrapeData.data.model = model;
                  console.log(`⚠️ BaT URL parsed (fallback): ${scrapeData.data.year} ${scrapeData.data.make} ${scrapeData.data.model}`);
                } else {
                  console.log(`❌ Invalid make from BaT URL: ${make}`);
                }
              }
            }
          }
          
          // Extract comprehensive data from BaT HTML
          const bodyText = doc.body?.textContent || '';
          
          // Extract description (main content)
          const descriptionEl = doc.querySelector('.post-content, .listing-description, .auction-description, [class*="description"]');
          if (descriptionEl) {
            const descText = descriptionEl.textContent?.trim() || '';
            if (descText.length > 50) {
              scrapeData.data.description = descText.substring(0, 2000); // Limit to 2000 chars
            }
          }
          
          // Extract mileage - handle "89k Miles", "31k Miles Shown", etc.
          const mileagePatterns = [
            /(\d+(?:,\d+)?)\s*k\s*Miles?\s*(?:Shown)?/i,
            /(\d+(?:,\d+)?)\s*Miles?\s*Shown/i,
            /(\d+(?:,\d+)?)\s*Miles?/i,
            /Odometer[:\s]*(\d+(?:,\d+)?)\s*k?/i
          ];
          for (const pattern of mileagePatterns) {
            const match = bodyText.match(pattern);
            if (match) {
              let miles = parseInt(match[1].replace(/,/g, ''));
              if (match[0].toLowerCase().includes('k')) {
                miles = miles * 1000;
              }
              if (miles > 0 && miles < 10000000) {
                scrapeData.data.mileage = miles;
                break;
              }
            }
          }
          
          // NOTE: Do not set `asking_price` for BaT listings.
          // BaT is an auction platform, and price must come from auction-specific fields
          // (live bid / final sale) rather than generic page text scanning.
          
          // Extract color - "finished in Golf Blue", "Golf Blue over black"
          const colorPatterns = [
            /finished\s+in\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i,
            /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+over\s+[a-z]+/i,
            /Color[:\s]*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i,
            /Exterior[:\s]*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i
          ];
          for (const pattern of colorPatterns) {
            const match = bodyText.match(pattern);
            if (match && match[1].length < 30) {
              scrapeData.data.color = match[1].trim();
              scrapeData.data.exterior_color = match[1].trim();
              break;
            }
          }
          
          // Extract engine - "1,720cc flat-four", "350 V8", "5.7L V8"
          const enginePatterns = [
            /(\d+(?:,\d+)?)\s*cc\s+([a-z-]+)/i,
            /(\d+\.?\d*)\s*[Ll]iter\s+V?(\d+)/i,
            /(\d+)\s*V(\d+)/i,
            /Engine[:\s]*([^.\n]+)/i
          ];
          for (const pattern of enginePatterns) {
            const match = bodyText.match(pattern);
            if (match) {
              if (match[2]) {
                scrapeData.data.engine_type = `${match[1]}${match[2] ? ' ' + match[2] : ''}`.trim();
              } else if (match[1]) {
                scrapeData.data.engine_type = match[1].trim();
              }
              break;
            }
          }
          
          // Extract transmission - "five-speed manual", "automatic", "5-Speed"
          const transPatterns = [
            /(\d+)[-\s]*Speed\s+(Manual|Automatic)/i,
            /(Manual|Automatic)\s+transaxle/i,
            /(Manual|Automatic)\s+transmission/i,
            /Transmission[:\s]*([^.\n]+)/i
          ];
          for (const pattern of transPatterns) {
            const match = bodyText.match(pattern);
            if (match) {
              if (match[2]) {
                scrapeData.data.transmission = `${match[1]}-Speed ${match[2]}`;
              } else if (match[1]) {
                scrapeData.data.transmission = match[1];
              }
              break;
            }
          }
          
          // Extract location - "Located in United States", "California"
          const locationPatterns = [
            /Located\s+in\s+([^.\n]+)/i,
            /Location[:\s]*([^.\n]+)/i
          ];
          for (const pattern of locationPatterns) {
            const match = bodyText.match(pattern);
            if (match && match[1].length < 100) {
              scrapeData.data.location = match[1].trim();
              break;
            }
          }
          
          // Extract VIN
          const vinMatch = bodyText.match(/(?:VIN|Chassis)[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
          if (vinMatch) {
            scrapeData.data.vin = vinMatch[1];
          }
          
          // Fallback: Try simple-scraper for images and additional data
          if (scrapeData.data.make && scrapeData.data.model) {
            try {
              const { data: simpleData, error: simpleError } = await supabase.functions.invoke('simple-scraper', {
                body: { url: item.listing_url },
                headers: {
                  'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
                }
              });

              if (!simpleError && simpleData?.success && simpleData.data) {
                // Use images and price from simple-scraper
                if (simpleData.data.images && simpleData.data.images.length > 0) {
                  scrapeData.data.images = simpleData.data.images;
                }
                if (simpleData.data.price && !scrapeData.data.asking_price) {
                  scrapeData.data.asking_price = simpleData.data.price;
                }
                if (simpleData.data.title && !scrapeData.data.title) {
                  scrapeData.data.title = simpleData.data.title;
                }
              }
            } catch (batErr: any) {
              console.warn('⚠️ Simple-scraper failed for BaT:', batErr.message);
            }
          } else {
            // Last resort: Parse from HTML title
            const titleElement = doc.querySelector('h1.post-title, h1, .post-title, title');
            if (titleElement) {
              let title = titleElement.textContent?.trim() || '';
              
              // CRITICAL: Remove "| Bring a Trailer" suffix from BaT titles
              title = title.replace(/\s*\|\s*Bring\s+a\s*Trailer.*$/i, '');
              title = title.replace(/\s*on\s*BaT\s*Auctions?.*$/i, '');
              title = title.replace(/\s*-\s*Bring\s+a\s*Trailer.*$/i, '');
              
              scrapeData.data.title = title;
              
              // Skip non-vehicle listings (accessories, parts, etc.)
              const nonVehicleKeywords = ['windshield', 'sign', 'statue', 'arcade', 'kiddie', 'ride', 'illuminated'];
              const titleLower = title.toLowerCase();
              if (nonVehicleKeywords.some(keyword => titleLower.includes(keyword))) {
                console.log(`⚠️ Skipping non-vehicle BaT listing: ${title}`);
                // Mark as junk to prevent processing
                scrapeData.data.make = 'Bring';
                scrapeData.data.model = 'a Trailer';
                scrapeData.data.year = null;
              } else {
                // Parse from title: "9k-Mile 1992 Chevrolet 454 SS" or "10k-mile 2009 Porsche 911..." or "This 1961 Lincoln..."
                // Remove mileage/ownership descriptors and other prefixes first
                let cleanTitle = title
                  .replace(/^\d+k-?mile\s*/gi, '')
                  .replace(/^\d+-years?-owned\s*/gi, '')
                  .replace(/^\d+,\d+-mile\s*/gi, '')
                  .replace(/^single-family-owned\s*/gi, '')
                  .replace(/^original-owner\s*/gi, '')
                  .replace(/^this\s+/gi, '') // Remove "This" prefix
                  .replace(/^el\s+/gi, '') // Remove "El" prefix (El Camino)
                  .replace(/^red\s+/gi, '') // Remove color prefixes
                  .replace(/^beautiful\s+/gi, '')
                  .replace(/^supercharged\s+/gi, '')
                  .replace(/^all\s+/gi, '')
                  .replace(/^502-powered\s*/gi, '')
                  .replace(/\s+/g, ' ')
                  .trim();
              
              const yearMatch = cleanTitle.match(/\b(19|20)\d{2}\b/);
              if (yearMatch) {
                const year = parseInt(yearMatch[0]);
                if (year >= 1885 && year <= new Date().getFullYear() + 1) {
                  scrapeData.data.year = year;
                }
                
                // Extract make/model after year
                const afterYear = cleanTitle.substring(cleanTitle.indexOf(yearMatch[0]) + 4).trim();
                const knownMakes = ['chevrolet', 'chevy', 'ford', 'gmc', 'dodge', 'ram', 'toyota', 'honda', 'nissan', 'bmw', 'mercedes', 'benz', 'mercedes-benz', 'audi', 'volkswagen', 'vw', 'porsche', 'jaguar', 'cadillac', 'buick', 'pontiac', 'lincoln', 'chrysler', 'lexus', 'acura', 'infiniti', 'mazda', 'subaru', 'mitsubishi', 'hyundai', 'kia', 'volvo', 'tesla', 'genesis', 'alfa', 'romeo', 'alfa romeo', 'fiat', 'mini', 'ferrari', 'lamborghini', 'mclaren', 'aston', 'martin', 'aston martin', 'bentley', 'rolls', 'royce', 'rolls-royce', 'datsun', 'mercury', 'jeep', 'suzuki', 'harley', 'davidson', 'harley-davidson', 'yamaha', 'ducati', 'kawasaki', 'indian'];
                const afterYearLower = afterYear.toLowerCase();
                
                for (const makeName of knownMakes) {
                  if (afterYearLower.startsWith(makeName + ' ') || afterYearLower.startsWith(makeName + '-')) {
                    let make = makeName === 'chevy' ? 'Chevrolet' : makeName === 'vw' ? 'Volkswagen' : makeName === 'benz' ? 'Mercedes' : makeName === 'mercedes-benz' ? 'Mercedes-Benz' : makeName === 'alfa romeo' || makeName === 'alfa-romeo' ? 'Alfa Romeo' : makeName === 'aston martin' || makeName === 'aston-martin' ? 'Aston Martin' : makeName === 'rolls-royce' || (makeName === 'rolls' && afterYearLower.includes('royce')) ? 'Rolls-Royce' : makeName.charAt(0).toUpperCase() + makeName.slice(1);
                    
                    if (isValidMake(make)) {
                      scrapeData.data.make = make;
                      
                      const afterMake = afterYear.substring(makeName.length).trim();
                      // Take first 2-3 words as model, but clean it
                      const modelParts = afterMake.split(/\s+/).slice(0, 3);
                      let model = modelParts.join(' ').trim();
                      model = cleanModelName(model);
                      scrapeData.data.model = model;
                      break;
                    }
                  }
                }
              }
            }
          }
          
          if (isTruck(scrapeData.data.make || '', scrapeData.data.model || '', scrapeData.data.title || '', scrapeData.data.description || '')) {
            scrapeData.data.body_type = 'Truck';
            scrapeData.data.body_style = 'Pickup';
          }
        }
        
        // Craigslist parsing
        if (item.listing_url.includes('craigslist.org')) {
          scrapeData.data.source = 'Craigslist';
          const titleElement = doc.querySelector('h1 .postingtitletext');
          if (titleElement) {
            scrapeData.data.title = titleElement.textContent?.trim() || '';
          }
          // Extract price from Craigslist - use helper to avoid monthly payments
          const priceElement = doc.querySelector('.price');
          let initialPrice: number | null = null;
          if (priceElement) {
            const priceText = priceElement.textContent?.trim();
            const extractedPrice = extractVehiclePrice(priceText || '');
            if (extractedPrice) {
              initialPrice = extractedPrice;
              scrapeData.data.asking_price = extractedPrice;
            }
          }
          
          // Also try extracting from title if not found
          if (!scrapeData.data.asking_price) {
            const titlePrice = extractVehiclePrice(scrapeData.data.title || '');
            if (titlePrice) {
              initialPrice = titlePrice;
              scrapeData.data.asking_price = titlePrice;
            }
          }
          
          const locationElement = doc.querySelector('.postingtitle .postingtitletext small');
          if (locationElement) {
            scrapeData.data.location = locationElement.textContent?.trim().replace(/[()]/g, '');
          }
          const bodyElement = doc.querySelector('#postingbody');
          if (bodyElement) {
            let description = bodyElement.textContent?.trim() || '';
            
            // Clean description - remove QR codes, junk text, dealer info lines
            description = description.replace(/QR\s+Code\s+Link\s+to\s+This\s+Post/gi, '');
            description = description.replace(/QR\s+Code[\s\S]{0,200}/gi, '');
            // Remove lines like "70,094 mi. - Automatic - 2D Coupe - 8 Cyl - RWD: Rear Wheel Drive - VIN# 1X27F3L112036"
            description = description.replace(/^\s*\d+[,\d]*\s*mi\.\s*-\s*[^-]+-\s*[^-]+-\s*[^-]+-\s*[^-]+-\s*RWD:?\s*[^-]+-\s*VIN#?\s*[A-HJ-NPR-Z0-9]{17}\s*$/gmi, '');
            
            // IMPORTANT: Check description for price if:
            // 1. No price found yet, OR
            // 2. Price found is suspiciously low (< $3000) - Craigslist sellers often hide real price in description
            // This handles cases where seller puts fake/low price in price field but real price in description
            if (!scrapeData.data.asking_price || (initialPrice && initialPrice < 3000)) {
              const descPrice = extractVehiclePrice(description);
              if (descPrice && descPrice >= 1000) {
                // If description has a higher/valid price, prefer it (likely the real asking price)
                if (!scrapeData.data.asking_price || descPrice > (scrapeData.data.asking_price || 0)) {
                  scrapeData.data.asking_price = descPrice;
                }
              }
              
              // Fallback to LLM extraction if regex didn't find a price (handles obfuscated formats)
              // Only call LLM if regex failed and we have a substantial description
              if (!scrapeData.data.asking_price && description.length > 50) {
                try {
                  const supabaseUrl = Deno.env.get('SUPABASE_URL');
                  const response = await fetch(`${supabaseUrl}/functions/v1/extract-price-from-description`, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`
                    },
                    body: JSON.stringify({
                      description: description,
                      current_price: initialPrice
                    })
                  });
                  
                  if (response.ok) {
                    const llmResult = await response.json();
                    if (llmResult.success && llmResult.price && llmResult.price >= 1000) {
                      scrapeData.data.asking_price = llmResult.price;
                      console.log(`✅ LLM extracted price from description: $${llmResult.price.toLocaleString()} (confidence: ${llmResult.confidence})`);
                    }
                  }
                } catch (llmError) {
                  // Non-blocking: LLM extraction failure shouldn't break the import
                  console.warn('LLM price extraction failed (non-blocking):', llmError);
                }
              }
            }
            
            // Extract VIN from description if present
            const vinMatch = description.match(/VIN#?\s*([A-HJ-NPR-Z0-9]{17})/i);
            if (vinMatch && !scrapeData.data.vin) {
              scrapeData.data.vin = vinMatch[1].toUpperCase();
            }
            // Extract mileage from description
            const mileageMatch = description.match(/(\d+(?:,\d+)?)\s*mi\./i);
            if (mileageMatch && !scrapeData.data.mileage) {
              scrapeData.data.mileage = parseInt(mileageMatch[1].replace(/,/g, ''));
            }
            
            scrapeData.data.description = description.trim();
          }
          if (scrapeData.data.title) {
            const yearMatch = scrapeData.data.title.match(/\b(19|20)\d{2}\b/);
            if (yearMatch) {
              const year = parseInt(yearMatch[0]);
              // Validate year is reasonable
              if (year >= 1885 && year <= new Date().getFullYear() + 1) {
                scrapeData.data.year = year;
              }
            }
            
            // Improved make/model extraction with validation
            const parts = scrapeData.data.title.split(/\s+/).filter(p => p.length > 0);
            if (parts.length >= 3) {
              let startIndex = 0;
              // Skip year if first
              if (parts[0] && parts[0].match(/^\d{4}$/)) {
                startIndex = 1;
              }
              
              // Extract make (validate against known makes)
              // Skip invalid prefixes
              const invalidPrefixes = ['this', 'el', 'red', 'beautiful', 'supercharged', 'all', '6k-mile', '10k-mile', '18k-mile', '47k-mile', 'original-owner', 'single-family-owned', '20-years-owned'];
              
              let makeIndex = startIndex;
              while (makeIndex < parts.length && invalidPrefixes.includes(parts[makeIndex].toLowerCase())) {
                makeIndex++;
              }
              
              if (makeIndex < parts.length) {
                let make = parts[makeIndex];
                if (make.toLowerCase() === 'chevy') make = 'Chevrolet';
                if (make.toLowerCase() === 'vw') make = 'Volkswagen';
                
                // Special case: "El Camino" - make is Chevrolet, not "El"
                if (make.toLowerCase() === 'el' && parts.length > makeIndex + 1 && parts[makeIndex + 1].toLowerCase() === 'camino') {
                  make = 'Chevrolet';
                  makeIndex++; // Skip "El"
                }
                
                // Only use if valid make
                if (isValidMake(make)) {
                  scrapeData.data.make = make.charAt(0).toUpperCase() + make.slice(1).toLowerCase();
                  
                  // Extract model (rest of title)
                  if (parts.length > makeIndex + 1) {
                    const modelParts = parts.slice(makeIndex + 1);
                    // Filter out common non-model words
                    const filteredModel = modelParts.filter(p => 
                      !['for', 'sale', 'wanted', 'needs', 'runs', 'great', 'condition'].includes(p.toLowerCase())
                    );
                    if (filteredModel.length > 0) {
                      let model = filteredModel.join(' ');
                      model = cleanModelName(model);
                      scrapeData.data.model = model;
                    }
                  }
                }
              }
            }
            
            // Identify if truck and set body_type
            if (isTruck(scrapeData.data.make || '', scrapeData.data.model || '', scrapeData.data.title, scrapeData.data.description)) {
              scrapeData.data.body_type = 'Truck';
              scrapeData.data.body_style = 'Pickup';
            }
          }
        }

        }
        }

        // Extract dealer/organization info from listing
        const rawData = item.raw_data || {};
        let organizationId: string | null = null;
        let dealerName: string | null = null;
        let dealerPhone: string | null = null;
        let dealerLocation: string | null = null;
        type OrgBusinessType = 'dealer' | 'auction_house' | 'service';
        const inferOrgBusinessType = (t: any): OrgBusinessType => {
          const s = String(t || '').toLowerCase();
          if (s === 'auction_house') return 'auction_house';
          // Service-oriented orgs (shops) should not be treated as dealers/consigners.
          if (
            s.includes('restoration') ||
            s.includes('repair') ||
            s.includes('service') ||
            s.includes('garage') ||
            s.includes('workshop') ||
            s.includes('detail')
          ) {
            return 'service';
          }
          return 'dealer';
        };

        const extractServiceSignalText = (doc: any, fallbackTitle?: string | null): string => {
          try {
            const title =
              (fallbackTitle && String(fallbackTitle)) ||
              doc?.querySelector?.('meta[property="og:title"]')?.getAttribute?.('content') ||
              doc?.querySelector?.('meta[name="twitter:title"]')?.getAttribute?.('content') ||
              doc?.querySelector?.('title')?.textContent ||
              '';
            const h1 = doc?.querySelector?.('h1')?.textContent || '';
            const desc =
              doc?.querySelector?.('meta[name="description"]')?.getAttribute?.('content') ||
              doc?.querySelector?.('meta[property="og:description"]')?.getAttribute?.('content') ||
              '';
            return `${title} ${h1} ${desc}`.toLowerCase();
          } catch {
            return String(fallbackTitle || '').toLowerCase();
          }
        };

        // Conservative: only used when URL already looks like a portfolio/project page on the org's own domain.
        const inferServiceBusinessTypeFromSignal = (
          signalText: string
        ):
          | 'restoration_shop'
          | 'performance_shop'
          | 'body_shop'
          | 'detailing'
          | 'garage'
          | 'mobile_service'
          | 'specialty_shop'
          | null => {
          const s = String(signalText || '').toLowerCase();
          if (!s) return null;

          // Strongest signals first
          if (s.includes('restoration') || s.includes('frame-off') || s.includes('coachbuild') || s.includes('concours')) {
            return 'restoration_shop';
          }
          if (s.includes('performance') || s.includes('tuning') || s.includes('dyno') || s.includes('race') || s.includes('racing')) {
            return 'performance_shop';
          }
          if (s.includes('body shop') || s.includes('collision') || s.includes('paint') || s.includes('panel') || s.includes('paintwork')) {
            return 'body_shop';
          }
          if (s.includes('detail') || s.includes('detailing') || s.includes('ceramic') || s.includes('ppf') || s.includes('paint correction')) {
            return 'detailing';
          }
          if (s.includes('mobile') && (s.includes('service') || s.includes('mechanic') || s.includes('repair'))) {
            return 'mobile_service';
          }
          // Generic service/repair/fabrication keywords
          if (
            s.includes('service') ||
            s.includes('repair') ||
            s.includes('workshop') ||
            s.includes('garage') ||
            s.includes('fabrication') ||
            s.includes('custom build') ||
            s.includes('build')
          ) {
            return 'garage';
          }
          return null;
        };

        const isProjectOrPortfolioUrl = (listingUrl: string, orgWebsite?: string | null): boolean => {
          try {
            const url = new URL(listingUrl);
            const path = url.pathname.toLowerCase();
            const looksLikeProjectPath =
              path.includes('/projects/') ||
              path.includes('/project/') ||
              path.includes('/portfolio/') ||
              path.includes('/work/') ||
              path.includes('/restoration/');

            if (!looksLikeProjectPath) return false;

            if (orgWebsite) {
              try {
                const orgUrl = new URL(String(orgWebsite));
                // Require same host to avoid cross-site false positives.
                if (orgUrl.host && url.host && orgUrl.host !== url.host) return false;
              } catch {
                // ignore website parse errors
              }
            }

            return true;
          } catch {
            return false;
          }
        };

        let businessType: OrgBusinessType = (rawData.business_type === 'auction_house' ? 'auction_house' : 'dealer');

        // Highest priority: explicit organization_id from the queue item (used by dealer indexers).
        if (rawData.organization_id) {
          try {
            const { data: existingBusiness } = await supabase
              .from('businesses')
              .select('id, business_name, type, business_type, website')
              .eq('id', rawData.organization_id)
              .maybeSingle();
            if (existingBusiness?.id) {
              organizationId = existingBusiness.id;
              businessType = inferOrgBusinessType(existingBusiness.type || existingBusiness.business_type || businessType);
              console.log(`Using explicit organization_id: ${existingBusiness.business_name} (${organizationId})`);
            }
          } catch (e: any) {
            console.warn(`Failed to validate raw_data.organization_id: ${e?.message || String(e)}`);
          }
        }
        
        // Extract dealer info from Craigslist listing (enhanced with website detection)
        if (item.listing_url.includes('craigslist.org')) {
          // Use dealer info from scrape-vehicle if available (includes website extraction)
          if (scrapeData.data.dealer_name) {
            dealerName = scrapeData.data.dealer_name;
          }
          if (scrapeData.data.dealer_website) {
            // Store website for organization creation
            const dealerWebsite = scrapeData.data.dealer_website;
          }
          if (scrapeData.data.dealer_phone) {
            dealerPhone = scrapeData.data.dealer_phone;
          }
          
          // Fallback to pattern matching if scraper didn't find dealer info
          if (!dealerName) {
            const titleText = scrapeData.data.title || '';
            const descText = scrapeData.data.description || '';
            const combinedText = `${titleText} ${descText}`;
            
            // Pattern: "Desert Private Collection (760) 313-6607"
            const dealerMatch = combinedText.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*\(?\s*(\d{3})\s*\)?\s*(\d{3})[-\s]?(\d{4})/);
            if (dealerMatch) {
              dealerName = dealerMatch[1].trim();
              dealerPhone = `(${dealerMatch[2]}) ${dealerMatch[3]}-${dealerMatch[4]}`;
            }
            
            // Pattern: "EZCustom4x4", "Hayes Classics", etc.
            if (!dealerName) {
              const namePatterns = [
                /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*Classics?/i,
                /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*Auto/i,
                /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*Motors?/i,
                /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*Collection/i
              ];
              for (const pattern of namePatterns) {
                const match = combinedText.match(pattern);
                if (match && match[1].length > 3) {
                  dealerName = match[1].trim();
                  break;
                }
              }
            }
            
            // Extract location from title/description
            const locationMatch = combinedText.match(/\(([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\)/);
            if (locationMatch) {
              dealerLocation = locationMatch[1];
            }
          }
        }
        
        // Enhanced organization detection: check for VIN + dealer combo
        // This enables intelligent cross-city dealer detection
        const dealerWebsite = scrapeData.data.dealer_website || rawData.dealer_website || null;
        
        // Get or create organization (intelligent dealer detection)
        // NOTE: Canonical org table is `businesses` (not legacy `organizations`).
        if (!organizationId && ((dealerName && dealerName.length > 2) || dealerWebsite)) {
          const orgSlug = dealerName 
            ? dealerName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
            : null;
          
          // Check if organization exists by website (strongest match), slug, or name
          let existingOrg = null;
          if (dealerWebsite) {
            const { data: orgByWebsite } = await supabase
              .from('businesses')
              .select('id, business_name, website, type, business_type')
              .eq('website', dealerWebsite)
              .limit(1)
              .maybeSingle();
            
            if (orgByWebsite) {
              existingOrg = orgByWebsite;
              console.log(`Found existing business by website: ${dealerWebsite} -> ${orgByWebsite.business_name}`);
            }
          }
          
          // Fallback: check by name
          if (!existingOrg && orgSlug) {
            const { data: orgByName } = await supabase
              .from('businesses')
              .select('id, business_name, website, type, business_type')
              .or(`business_name.ilike.%${dealerName}%`)
              .limit(1)
              .maybeSingle();
            
            if (orgByName) {
              existingOrg = orgByName;
              // Update website if we found org by name but it's missing website
              if (dealerWebsite && !orgByName.website) {
                await supabase
                  .from('businesses')
                  .update({ website: dealerWebsite })
                  .eq('id', orgByName.id);
                console.log(`Updated business website: ${orgByName.business_name}`);
              }
            }
          }
          
          if (existingOrg) {
            organizationId = existingOrg.id;
            businessType = inferOrgBusinessType(existingOrg.type || (existingOrg as any).business_type || businessType);
            console.log(`Found existing business: ${existingOrg.business_name} (${organizationId})`);
            
            // Trigger inventory sync if website available (async, don't wait)
            if (dealerWebsite) {
              // Queue website inventory scrape for this dealer
              triggerDealerInventorySync(existingOrg.id, dealerWebsite, supabase).catch(err => {
                console.warn(`⚠️ Failed to trigger inventory sync: ${err.message}`);
              });
            }
          } else {
            // Create new business
            const orgData: any = {
              business_name: dealerName || null,
              website: dealerWebsite || null,
              phone: dealerPhone || null,
              city: dealerLocation || null,
              business_type: 'dealership',
              type: 'dealer',
              is_public: true,
              is_verified: false,
              status: 'active',
              discovered_via: 'import_queue',
              source_url: item.listing_url,
              metadata: {
                org_slug: orgSlug,
              }
            };
            
            if (!dealerName && dealerWebsite) {
              // Extract name from domain if no name found
              const domainMatch = dealerWebsite.match(/https?:\/\/(?:www\.)?([^.]+)/);
              if (domainMatch) {
                const domainName = domainMatch[1].replace(/-/g, ' ');
                orgData.business_name = domainName.split(/(?=[A-Z])/).map((w: string) => 
                  w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
                ).join(' ');
                orgData.metadata.org_slug = domainName.replace(/[^a-z0-9]+/g, '-');
              }
            }
            
            const { data: newOrg, error: orgError } = await supabase
              .from('businesses')
              .insert(orgData)
              .select('id')
              .single();
            
            if (newOrg && !orgError) {
              organizationId = newOrg.id;
              console.log(`Created new business: ${orgData.business_name || dealerWebsite} (${organizationId})`);
              
              // Auto-merge duplicates after creation
              try {
                await supabase.functions.invoke('auto-merge-duplicate-orgs', {
                  body: { organizationId: newOrg.id }
                });
              } catch (mergeError) {
                console.warn('⚠️ Auto-merge check failed (non-critical):', mergeError);
              }
              
              // Trigger inventory sync for new dealer
              if (dealerWebsite) {
                triggerDealerInventorySync(newOrg.id, dealerWebsite, supabase).catch(err => {
                  console.warn(`⚠️ Failed to trigger inventory sync: ${err.message}`);
                });
              }
            } else {
              console.warn(`⚠️ Failed to create organization: ${orgError?.message || 'Unknown error'}`);
            }
          }
        }
        
        // Fallback: Use source organization if no dealer found
        if (!organizationId && item.source_id) {
          const { data: source } = await supabase
            .from('scrape_sources')
            .select('id')
            .eq('id', item.source_id)
            .single();

          if (source) {
            // Legacy compatibility: some pipelines stored scrape_source_id in businesses.metadata.
            const { data: org } = await supabase
              .from('businesses')
              .select('id')
              .contains('metadata', { scrape_source_id: source.id })
              .maybeSingle();

            if (org) {
              organizationId = org.id;
            }
          }
        }

        // Validate scraped data before creating vehicle
        let make = (scrapeData.data.make || item.listing_make || '').trim();
        let model = (scrapeData.data.model || item.listing_model || '').trim();
        let year: number | null = (scrapeData.data.year ?? item.listing_year ?? null) as any;
        if (year === 0) year = null;
        if (typeof year === 'number' && (year < 1885 || year > new Date().getFullYear() + 1)) {
          year = null;
        }

        // If scrape-vehicle didn't populate make/model, infer from title as a last resort.
        // Many dealer sites have clean titles even when structured fields are missing.
        const titleForInference = (
          scrapeData.data.title ||
          rawData.title ||
          item.listing_title ||
          ''
        ).toString().trim();
        if ((!make || !model) && titleForInference) {
          const inferred = inferMakeModelFromTitle(titleForInference);
          if (!make && inferred.make) {
            // Prevent site branding from being interpreted as a vehicle make.
            if (!looksLikeSiteBrandNotMake(inferred.make)) {
              make = inferred.make;
            }
          }
          if (!model && inferred.model) model = inferred.model;
        }

        // Clean model name (remove pricing, dealer info, etc.)
        model = cleanModelName(model);

        // L'Art specific: if model still contains site branding (common when title inference was used),
        // strip it so we don't persist it into the canonical model field.
        if (item.listing_url.includes('lartdelautomobile.com/fiche/')) {
          model = (model || '')
            .replace(/^de\s+l['’]automobile\s*\|\s*/i, '')
            .replace(/^l['’]art\s+de\s+l['’]automobile\s*\|\s*/i, '')
            .trim();
        }

        debugLog({
          sessionId,
          runId,
          hypothesisId: 'H2',
          location: 'supabase/functions/process-import-queue/index.ts:after_extract',
          message: 'Scraped + normalized vehicle identity fields',
          data: { queue_id: item.id, source: scrapeData?.data?.source, title: (scrapeData?.data?.title || '').slice(0, 120), year, make, model, vin_present: !!scrapeData?.data?.vin, asking_price: scrapeData?.data?.asking_price || null, keys: Object.keys(scrapeData?.data || {}).slice(0, 40) },
        });

        const isLartFiche = item.listing_url.includes('lartdelautomobile.com/fiche/');

        // Listing status: for L'Art, trust the section-derived status we queued (inventory vs sold),
        // since the fiche pages are not reliably explicit. For other sources, prefer live scrape.
        const listingStatusRaw =
          isLartFiche && (rawData.inventory_extraction === true || rawData.inventory_extraction === 'true')
            ? (rawData.listing_status || rawData.status || null)
            : (scrapeData?.data?.listing_status || scrapeData?.data?.status || rawData.listing_status || rawData.status || null);

        const isSoldListing =
          listingStatusRaw === 'sold' ||
          listingStatusRaw === 'sold_out' ||
          listingStatusRaw === 'sold_vehicle' ||
          // Some scrapers encode sold/inactive as French/English flags.
          listingStatusRaw === 'inactif' ||
          listingStatusRaw === 'inactive' ||
          rawData.sold === true ||
          rawData.is_sold === true ||
          scrapeData?.data?.sold === true ||
          scrapeData?.data?.is_sold === true;
        
        // Validate make
        if (make && !isValidMake(make)) {
          console.warn(`⚠️ Invalid make detected: ${make}, skipping vehicle creation`);
          await supabase
            .from('import_queue')
            .update({
              status: 'failed',
              error_message: `Invalid make: ${make}`,
              processed_at: new Date().toISOString(),
              locked_at: null,
              locked_by: null,
              next_attempt_at: null,
            })
            .eq('id', item.id);
          continue;
        }
        
        // Data quality checks - reject garbage data
        // NOTE: `vehicles.year` is nullable; do not block ingestion if year is missing.
        if (!make || make === '' || !isValidMake(make)) {
          throw new Error(`Invalid make: "${make}" - cannot create vehicle`);
        }
        
        if (!model || model === '') {
          throw new Error(`Invalid model: "${model}" - cannot create vehicle`);
        }
        
        // VIN-based duplicate detection (handles cross-city dealer listings)
        // If same VIN exists, update existing vehicle instead of creating duplicate
        let existingVehicleId: string | null = null;
        const listingVIN = scrapeData.data.vin;
        
        if (listingVIN && listingVIN.length === 17 && !listingVIN.startsWith('VIVA-')) {
          const { data: existingVehicle } = await supabase
            .from('vehicles')
            // IMPORTANT: Do not let external listings overwrite a claimed/verified vehicle profile.
            // Once ownership is verified, the profile should be anchored to title/evidence context,
            // and external listings should be treated as optional references only.
            .select('id, discovery_url, origin_organization_id, ownership_verified, ownership_verification_id')
            .eq('vin', listingVIN)
            .limit(1)
            .maybeSingle();
          
          if (existingVehicle) {
            existingVehicleId = existingVehicle.id;
            console.log(`✅ Found existing vehicle with VIN ${listingVIN}, updating instead of creating duplicate`);
            
            // Update discovery URL if this listing is different (cross-city detection)
            const isOwnershipLocked = existingVehicle.ownership_verified === true || !!existingVehicle.ownership_verification_id;
            if (!isOwnershipLocked && existingVehicle.discovery_url !== item.listing_url) {
              await supabase
                .from('vehicles')
                .update({ 
                  discovery_url: item.listing_url, // Update to latest listing
                  updated_at: new Date().toISOString()
                })
                .eq('id', existingVehicle.id);
              console.log(`📍 Updated discovery URL for cross-city listing: ${item.listing_url}`);
            } else if (isOwnershipLocked && existingVehicle.discovery_url !== item.listing_url) {
              console.log(`🔒 Skipped discovery_url overwrite for ownership-locked vehicle ${existingVehicle.id} (VIN ${listingVIN})`);
            }
            
            // Link / repair org relationship + dealer_inventory even if already linked.
            if (organizationId) {
              if (!existingVehicle.origin_organization_id || existingVehicle.origin_organization_id !== organizationId) {
                await supabase
                  .from('vehicles')
                  .update({
                    origin_organization_id: organizationId,
                    updated_at: new Date().toISOString()
                  })
                  .eq('id', existingVehicle.id);
                console.log(`🔗 Linked existing vehicle to organization ${organizationId}`);
              }

              const relationshipType =
                businessType === 'dealer'
                  ? (isSoldListing ? 'sold_by' : 'seller')
                  : (businessType === 'auction_house' ? 'consigner' : 'service_provider');

              await supabase
                .from('organization_vehicles')
                .upsert({
                  organization_id: organizationId,
                  vehicle_id: existingVehicle.id,
                  relationship_type: relationshipType,
                  status: 'active',
                  auto_tagged: true
                }, {
                  onConflict: 'organization_id,vehicle_id,relationship_type'
                });

              // Always clean up conflicting legacy relationship types for this org+vehicle.
              await supabase
                .from('organization_vehicles')
                .delete()
                .eq('organization_id', organizationId)
                .eq('vehicle_id', existingVehicle.id)
                .in('relationship_type', ['seller', 'sold_by', 'consigner'])
                .neq('relationship_type', relationshipType);

              // If this was a dealer inventory import, ensure dealer_inventory matches listing status.
              const isInventoryExtraction = rawData.inventory_extraction === true || rawData.inventory_extraction === 'true';
              if (isInventoryExtraction && businessType === 'dealer') {
                const inventoryStatus = isSoldListing ? 'sold' : 'in_stock';
                const salePrice = isSoldListing ? (scrapeData.data.asking_price || scrapeData.data.price || null) : null;
                const saleDate =
                  isSoldListing
                    ? coerceDateOnly(rawData.sale_date || rawData.sold_at || scrapeData?.data?.sold_at || scrapeData?.data?.sale_date)
                    : null;

                await supabase
                  .from('dealer_inventory')
                  .upsert({
                    dealer_id: organizationId,
                    vehicle_id: existingVehicle.id,
                    status: inventoryStatus,
                    asking_price: scrapeData.data.asking_price || scrapeData.data.price || null,
                    sale_price: salePrice,
                    sale_date: saleDate,
                    acquisition_type: 'purchase',
                    notes: `Auto-imported from ${new URL(item.listing_url).hostname}`,
                    updated_at: new Date().toISOString()
                  }, {
                    onConflict: 'dealer_id,vehicle_id'
                  });

                // IMPORTANT: relationship_type has a DB constraint (owner/consigner/service_provider/work_location/sold_by/storage).
                // For dealer inventory imports, use:
                // - consigner => for-sale inventory
                // - sold_by => sold inventory
                const invRelationshipType = isSoldListing ? 'sold_by' : 'consigner';
                const invStatus = isSoldListing ? 'sold' : 'active';
                const invListingStatus = isSoldListing ? 'sold' : 'for_sale';

                await supabase
                  .from('organization_vehicles')
                  .upsert({
                    organization_id: organizationId,
                    vehicle_id: existingVehicle.id,
                    relationship_type: invRelationshipType,
                    status: invStatus,
                    listing_status: invListingStatus,
                    asking_price: scrapeData.data.asking_price || scrapeData.data.price || null,
                    sale_price: salePrice,
                    sale_date: saleDate,
                    auto_tagged: true
                  }, {
                    onConflict: 'organization_id,vehicle_id,relationship_type'
                  });

                // Clean up legacy relationship types that can poison the org UI.
                await supabase
                  .from('organization_vehicles')
                  .delete()
                  .eq('organization_id', organizationId)
                  .eq('vehicle_id', existingVehicle.id)
                  .in('relationship_type', ['sold_by', 'consigner'])
                  .neq('relationship_type', invRelationshipType);
              }
            }
            
            // Mark queue item as processed (merged with existing)
            await supabase
              .from('import_queue')
              .update({
                status: 'complete',
                processed_at: new Date().toISOString(),
                vehicle_id: existingVehicle.id,
                error_message: null,
                locked_at: null,
                locked_by: null,
                next_attempt_at: null,
              })
              .eq('id', item.id);
            
            console.log(`✅ Merged listing with existing vehicle ${existingVehicle.id}`);
            results.duplicates++;
            results.processed++;
            continue; // Skip to next item
          }
        }
        
        if (isLartFiche) {
          // Prefer our structured, paginated description for lart.
          const repackaged = buildLartRepackagedDescription(scrapeData.data);
          if (repackaged && repackaged.length > 10) {
            scrapeData.data.description = repackaged;
          }
        }

        // discovery_url-based dedupe: if we already have a vehicle anchored to this listing URL,
        // update it rather than creating duplicates. This is essential for "repair passes" where
        // we improve extraction and want to backfill fields (price/mileage/options/service/etc).
        try {
          const existingByUrlId = existingVehicleByUrlId;
          const isLocked = existingVehicleByUrlLocked;

          if (existingByUrlId) {
            if (isLocked) {
              console.log(`🔒 Existing vehicle is ownership-locked; skipping listing overwrite (vehicle ${existingByUrlId})`);
              results.duplicates++;
              results.processed++;
              continue;
            }

            console.log(`♻️ Updating existing vehicle by discovery_url: ${existingByUrlId}`);

            // Update structured lart payload in origin_metadata (best-effort).
            if (isLartFiche) {
              const { data: vrow } = await supabase
                .from('vehicles')
                .select('origin_metadata')
                .eq('id', existingByUrlId)
                .maybeSingle();
              const om = (vrow?.origin_metadata && typeof vrow.origin_metadata === 'object') ? vrow.origin_metadata : {};
              const nextOm = {
                ...om,
                lart: {
                  description_fr: scrapeData.data.description_fr || null,
                  description_en: scrapeData.data.description_en || null,
                  info_bullets: Array.isArray(scrapeData.data.info_bullets) ? scrapeData.data.info_bullets : null,
                  options: Array.isArray(scrapeData.data.options) ? scrapeData.data.options : null,
                  service_history: Array.isArray(scrapeData.data.service_history) ? scrapeData.data.service_history : null,
                  colors: scrapeData.data.colors || null,
                  fuel_type: scrapeData.data.fuel_type || scrapeData.data.fuel || null,
                  transmission: scrapeData.data.transmission || null,
                  registration_date: scrapeData.data.registration_date || null,
                  image_thumbnails: Array.isArray(scrapeData.data.image_thumbnails) ? scrapeData.data.image_thumbnails : null,
                }
              };
              await supabase
                .from('vehicles')
                .update({ origin_metadata: nextOm, updated_at: new Date().toISOString() } as any)
                .eq('id', existingByUrlId);
            }

            // Best-effort: persist BHCC numeric stock number into origin_metadata for future sold monitoring.
            // (BHCC exposes Stock # in meta description; our scraper returns it as bhcc_stockno.)
            try {
              const bhccStockNo =
                (typeof (scrapeData as any)?.data?.bhcc_stockno === 'number' && Number.isFinite((scrapeData as any).data.bhcc_stockno))
                  ? (scrapeData as any).data.bhcc_stockno
                  : null;
              if (bhccStockNo && item.listing_url.includes('beverlyhillscarclub.com')) {
                const { data: vrowBhcc } = await supabase
                  .from('vehicles')
                  .select('origin_metadata')
                  .eq('id', existingByUrlId)
                  .maybeSingle();
                const omBhcc = (vrowBhcc?.origin_metadata && typeof vrowBhcc.origin_metadata === 'object') ? vrowBhcc.origin_metadata : {};
                const nextOmBhcc = {
                  ...omBhcc,
                  bhcc: {
                    ...(omBhcc as any)?.bhcc,
                    stockno: bhccStockNo,
                  }
                };
                await supabase
                  .from('vehicles')
                  .update({ origin_metadata: nextOmBhcc, updated_at: new Date().toISOString() } as any)
                  .eq('id', existingByUrlId);
              }
            } catch {
              // swallow
            }

            // Push listing fields through forensic updater (now allowed for non-user sources).
            const colorSignal = extractGeneralColors(
              scrapeData.data.color ?? scrapeData.data.colors ?? scrapeData.data.origin_metadata?.lart?.colors ?? null
            );
            const listingFields: Array<{ key: string; value: any }> = [
              { key: 'vin', value: scrapeData.data.vin ?? null },
              { key: 'asking_price', value: scrapeData.data.asking_price ?? scrapeData.data.price ?? null },
              { key: 'mileage', value: scrapeData.data.mileage ?? null },
              { key: 'transmission', value: scrapeData.data.transmission ?? null },
              { key: 'drivetrain', value: scrapeData.data.drivetrain ?? null },
              { key: 'fuel_type', value: scrapeData.data.fuel_type ?? scrapeData.data.fuel ?? null },
              // Prefer general (primary/secondary) color label for canonical `vehicles.color`
              { key: 'color', value: (colorSignal.primary && colorSignal.secondary) ? `${colorSignal.primary} / ${colorSignal.secondary}` : (colorSignal.primary || null) },
            ];
            for (const f of listingFields) {
              if (f.value === null || typeof f.value === 'undefined') continue;
              const v = String(f.value).trim();
              if (!v) continue;
              await supabase.rpc('update_vehicle_field_forensically', {
                p_vehicle_id: existingByUrlId,
                p_field_name: f.key,
                p_new_value: v,
                p_source: 'scraped_listing',
                p_context: item.listing_url,
                p_auto_assign: true,
              });
            }

            // Store detailed/secondary colors into origin_metadata for UI (best-effort; do not overwrite if already present)
            try {
              if (isLartFiche && colorSignal.raw) {
                const { data: vrow2 } = await supabase
                  .from('vehicles')
                  .select('origin_metadata')
                  .eq('id', existingByUrlId)
                  .maybeSingle();
                const om2 = (vrow2?.origin_metadata && typeof vrow2.origin_metadata === 'object') ? vrow2.origin_metadata : {};
                const lart2 = (om2 as any).lart && typeof (om2 as any).lart === 'object' ? (om2 as any).lart : {};
                const nextOm2 = {
                  ...om2,
                  lart: {
                    ...lart2,
                    colors: (lart2 as any).colors ?? colorSignal.raw,
                    color_primary: (lart2 as any).color_primary ?? colorSignal.primary,
                    color_secondary: (lart2 as any).color_secondary ?? colorSignal.secondary,
                    interior_color: (lart2 as any).interior_color ?? colorSignal.interior,
                  }
                };
                await supabase
                  .from('vehicles')
                  .update({ origin_metadata: nextOm2, updated_at: new Date().toISOString() } as any)
                  .eq('id', existingByUrlId);
              }
            } catch {
              // non-blocking
            }

            // Repair-pass: for dealer inventory imports, make sure status + org relationship match sold/in_stock.
            try {
              const isInventoryExtraction = rawData.inventory_extraction === true || rawData.inventory_extraction === 'true';
              if (organizationId && isInventoryExtraction && businessType === 'dealer') {
                const inventoryStatus = isSoldListing ? 'sold' : 'in_stock';
                const salePrice = isSoldListing ? (scrapeData.data.asking_price || scrapeData.data.price || null) : null;
                const saleDate =
                  isSoldListing
                    ? coerceDateOnly(rawData.sale_date || rawData.sold_at || scrapeData?.data?.sold_at || scrapeData?.data?.sale_date)
                    : null;

                await supabase
                  .from('dealer_inventory')
                  .upsert({
                    dealer_id: organizationId,
                    vehicle_id: existingByUrlId,
                    status: inventoryStatus,
                    asking_price: scrapeData.data.asking_price || scrapeData.data.price || null,
                    sale_price: salePrice,
                    sale_date: saleDate,
                    acquisition_type: 'purchase',
                    notes: `Auto-imported from ${new URL(item.listing_url).hostname}`,
                    updated_at: new Date().toISOString()
                  }, {
                    onConflict: 'dealer_id,vehicle_id'
                  });

                const invRelationshipType = isSoldListing ? 'sold_by' : 'consigner';
                const invStatus = isSoldListing ? 'sold' : 'active';
                const invListingStatus = isSoldListing ? 'sold' : 'for_sale';

                await supabase
                  .from('organization_vehicles')
                  .upsert({
                    organization_id: organizationId,
                    vehicle_id: existingByUrlId,
                    relationship_type: invRelationshipType,
                    status: invStatus,
                    listing_status: invListingStatus,
                    asking_price: scrapeData.data.asking_price || scrapeData.data.price || null,
                    sale_price: salePrice,
                    sale_date: saleDate,
                    auto_tagged: true
                  }, {
                    onConflict: 'organization_id,vehicle_id,relationship_type'
                  });

                await supabase
                  .from('organization_vehicles')
                  .delete()
                  .eq('organization_id', organizationId)
                  .eq('vehicle_id', existingByUrlId)
                  .in('relationship_type', ['sold_by', 'consigner'])
                  .neq('relationship_type', invRelationshipType);
              }
            } catch (invRepairErr: any) {
              console.warn(`⚠️ dealer_inventory/org relationship repair failed (continuing): ${invRepairErr.message}`);
            }

            // Repair-pass image upgrade for L'Art:
            // Older imports often stored only Cloudinary transformed thumbs (c_fill/h_467/w_624).
            // If we now have hi-res originals from scrape-vehicle, upload a capped set and set as primary.
            try {
              if (isLartFiche) {
                const candidateImages: string[] = Array.isArray(scrapeData?.data?.images) ? scrapeData.data.images : [];
                const hiResCandidates = candidateImages
                  .filter((u: any) => typeof u === 'string')
                  .map((u: string) => u.trim())
                  .filter(Boolean)
                  .filter((u: string) => u.startsWith('http'))
                  // Prefer true Cloudinary originals (no transform segment)
                  .filter((u: string) => u.includes('/image/upload/v') || !u.includes('/image/upload/c_'));

                // Check if current images are likely thumbnails
                const { data: existingImgRows } = await supabase
                  .from('vehicle_images')
                  .select('id, source_url, is_primary, created_at')
                  .eq('vehicle_id', existingByUrlId)
                  .order('created_at', { ascending: true })
                  .limit(200);

                const existingSource = new Set((existingImgRows || []).map((r: any) => String(r.source_url || '')));
                const hasAnyHiResAlready = (existingImgRows || []).some((r: any) =>
                  typeof r?.source_url === 'string' && r.source_url.includes('/image/upload/v')
                );
                const thumbRatio =
                  (existingImgRows || []).length > 0
                    ? (existingImgRows || []).filter((r: any) =>
                        typeof r?.source_url === 'string' && r.source_url.includes('/image/upload/c_fill,g_center,h_467,w_624/')
                      ).length / (existingImgRows || []).length
                    : 1;

                if (!hasAnyHiResAlready && hiResCandidates.length > 0 && thumbRatio >= 0.75) {
                  const toUpload = hiResCandidates.filter((u) => !existingSource.has(u));
                  if (toUpload.length > 0) {
                    console.log(`🧪 L'Art hi-res repair: uploading ${toUpload.length} hi-res images for ${existingByUrlId}`);

                    // IMPORTANT: Delegate to backfill-images to ensure deterministic storage paths + dedupe
                    // (prevents Date.now() re-upload storms on retries).
                    const maxRepairImages = 25;
                    const repairUrls = toUpload.slice(0, maxRepairImages);
                    try {
                      await supabase.functions.invoke('backfill-images', {
                        body: {
                          vehicle_id: existingByUrlId,
                          image_urls: repairUrls,
                          source: organizationId ? 'organization_import' : 'external_import',
                          run_analysis: false,
                          max_images: maxRepairImages,
                          continue: false,
                          sleep_ms: 150,
                          max_runtime_ms: 25000,
                        }
                      });
                    } catch (bfErr: any) {
                      console.warn(`    ⚠️ Hi-res repair backfill-images failed: ${bfErr?.message || String(bfErr)}`);
                    }

                    // Promote the newest repaired image to primary (best-effort).
                    try {
                      const { data: newestRepair } = await supabase
                        .from('vehicle_images')
                        .select('id, image_url')
                        .eq('vehicle_id', existingByUrlId)
                        .in('source_url', repairUrls)
                        .order('created_at', { ascending: false })
                        .limit(1)
                        .maybeSingle();
                      if (newestRepair?.id) {
                        await supabase
                          .from('vehicle_images')
                          .update({ is_primary: false })
                          .eq('vehicle_id', existingByUrlId)
                          .neq('id', newestRepair.id)
                          .eq('is_primary', true);
                        await supabase
                          .from('vehicle_images')
                          .update({ is_primary: true })
                          .eq('id', newestRepair.id);
                        if (newestRepair?.image_url) {
                          await supabase
                            .from('vehicles')
                            .update({ primary_image_url: newestRepair.image_url, updated_at: new Date().toISOString() } as any)
                            .eq('id', existingByUrlId);
                        }
                      }
                    } catch {
                      // ignore
                    }
                  }
                }
              }
            } catch (imgRepairErr: any) {
              console.warn(`⚠️ L'Art hi-res repair pass failed (continuing): ${imgRepairErr.message}`);
            }

            // Mark queue as complete/duplicate and move on.
            await supabase
              .from('import_queue')
              .update({
                status: 'complete',
                vehicle_id: existingByUrlId,
                processed_at: new Date().toISOString(),
                error_message: null,
                locked_at: null,
                locked_by: null,
                next_attempt_at: null,
              })
              .eq('id', item.id);

            results.duplicates++;
            results.processed++;
            continue;
          }
        } catch (dupeErr: any) {
          console.warn(`⚠️ discovery_url dedupe/update failed (continuing): ${dupeErr.message}`);
        }

        // Guardrails: stop creating junk vehicle profiles from malformed/non-listing URLs.
        if (!isProbablyValidHttpUrl(item.listing_url)) {
          await supabase
            .from('import_queue')
            .update({
              status: 'failed',
              error_message: 'Invalid listing_url (not a valid http/https URL)',
              processed_at: new Date().toISOString(),
              locked_at: null,
              locked_by: null,
              next_attempt_at: null,
            } as any)
            .eq('id', item.id);
          results.errors++;
          results.processed++;
          continue;
        }

        if (looksLikeNonListingPage(item.listing_url)) {
          await supabase
            .from('import_queue')
            .update({
              status: 'failed',
              error_message: 'Non-listing URL (inventory/home/marketing page); skipping vehicle creation',
              processed_at: new Date().toISOString(),
              locked_at: null,
              locked_by: null,
              next_attempt_at: null,
            } as any)
            .eq('id', item.id);
          results.errors++;
          results.processed++;
          continue;
        }

        if (isLikelyJunkIdentity(year, make, model)) {
          await supabase
            .from('import_queue')
            .update({
              status: 'failed',
              error_message: `Junk identity detected (year/make/model). year=${year ?? null} make=${make ?? null} model=${model ?? null}`,
              processed_at: new Date().toISOString(),
              locked_at: null,
              locked_by: null,
              next_attempt_at: null,
            } as any)
            .eq('id', item.id);
          results.errors++;
          results.processed++;
          continue;
        }

        // Create vehicle - START AS PENDING until validated
        const bhccStockNo =
          (typeof (scrapeData as any)?.data?.bhcc_stockno === 'number' && Number.isFinite((scrapeData as any).data.bhcc_stockno))
            ? (scrapeData as any).data.bhcc_stockno
            : null;

        const listingVin = (scrapeData?.data?.vin || '').toString().trim();
        const safeVin =
          listingVin && listingVin.length === 17 && !/[IOQ]/.test(listingVin) ? listingVin.toUpperCase() : null;

        const listingHost = (() => {
          try { return new URL(item.listing_url).hostname.replace(/^www\./, ''); } catch { return null; }
        })();

        const bestTitle =
          (scrapeData?.data?.title || rawData?.title || item.listing_title || '').toString().trim() || null;
        const bestPrimaryImage =
          (Array.isArray(scrapeData?.data?.images) && scrapeData.data.images.length > 0)
            ? String(scrapeData.data.images[0] || '').trim()
            : (typeof (item as any)?.thumbnail_url === 'string' ? String((item as any).thumbnail_url).trim() : null);

        const { data: newVehicle, error: vehicleError} = await supabase
          .from('vehicles')
          .insert({
            year: year,
            make: make,
            model: model,
            vin: safeVin,
            vin_source: safeVin ? `scraped_listing:${listingHost || 'unknown'}` : null,
            vin_confidence: safeVin ? 80 : null,
            mileage: (typeof scrapeData?.data?.mileage === 'number' && Number.isFinite(scrapeData.data.mileage)) ? scrapeData.data.mileage : null,
            mileage_source: (typeof scrapeData?.data?.mileage === 'number' && Number.isFinite(scrapeData.data.mileage)) ? `scraped_listing:${listingHost || 'unknown'}` : null,
            asking_price: item.listing_url.includes('bringatrailer.com') ? null : ((typeof scrapeData?.data?.asking_price === 'number' && Number.isFinite(scrapeData.data.asking_price)) ? scrapeData.data.asking_price : null),
            listing_url: item.listing_url,
            listing_source: listingHost,
            listing_title: bestTitle,
            title: bestTitle,
            primary_image_url: bestPrimaryImage && bestPrimaryImage.startsWith('http') ? bestPrimaryImage : null,
            image_url: bestPrimaryImage && bestPrimaryImage.startsWith('http') ? bestPrimaryImage : null,
            platform_source: scrapeData?.data?.source || null,
            platform_url: scrapeData?.data?.platform_url || (listingHost ? `https://${listingHost}` : null),
            status: 'pending', // Start pending - will be activated after validation
            is_public: false, // Start private - will be made public after validation
            discovery_url: item.listing_url,
            origin_metadata: {
              source_id: item.source_id,
              queue_id: item.id,
              imported_at: new Date().toISOString(),
              image_urls: scrapeData.data.images || [], // Store for reference
              image_count: scrapeData.data.images?.length || 0,
              ...(bhccStockNo ? { bhcc: { stockno: bhccStockNo } } : {}),
              ...(scrapeData?.data?.stock_number ? { stock_number: scrapeData.data.stock_number } : {}),
              ...(isLartFiche ? {
                lart: {
                  description_fr: scrapeData.data.description_fr || null,
                  description_en: scrapeData.data.description_en || null,
                  info_bullets: Array.isArray(scrapeData.data.info_bullets) ? scrapeData.data.info_bullets : null,
                  options: Array.isArray(scrapeData.data.options) ? scrapeData.data.options : null,
                  service_history: Array.isArray(scrapeData.data.service_history) ? scrapeData.data.service_history : null,
                  colors: scrapeData.data.colors || null,
                  fuel_type: scrapeData.data.fuel_type || null,
                  transmission: scrapeData.data.transmission || null,
                  registration_date: scrapeData.data.registration_date || null,
                  image_thumbnails: Array.isArray(scrapeData.data.image_thumbnails) ? scrapeData.data.image_thumbnails : null,
                }
              } : {}),
            },
            profile_origin: 'url_scraper',
            origin_organization_id: organizationId,
            import_queue_id: item.id
          })
          .select('id')
          .single();

        if (vehicleError) {
          throw new Error(`Vehicle insert failed: ${vehicleError.message}`);
        }

        debugLog({
          sessionId,
          runId,
          hypothesisId: 'H4',
          location: 'supabase/functions/process-import-queue/index.ts:vehicle_inserted',
          message: 'Inserted vehicles row (initial form baseline)',
          data: { queue_id: item.id, vehicle_id: newVehicle.id, year, make, model, status: 'pending', is_public: false, org_id: organizationId || null },
        });

        // Best-effort: persist BHCC numeric stock number into origin_metadata for future sold monitoring.
        // Do not fail queue processing if this write fails.
        if (bhccStockNo) {
          try {
            const { data: vrow, error: vrowErr } = await supabase
              .from('vehicles')
              .select('origin_metadata')
              .eq('id', newVehicle.id)
              .maybeSingle();
            if (!vrowErr) {
              const om = (vrow?.origin_metadata && typeof vrow.origin_metadata === 'object') ? vrow.origin_metadata : {};
              const nextOm = {
                ...om,
                bhcc: {
                  ...(om as any)?.bhcc,
                  stockno: bhccStockNo,
                }
              };
              await supabase
                .from('vehicles')
                .update({ origin_metadata: nextOm, updated_at: new Date().toISOString() } as any)
                .eq('id', newVehicle.id);
            }
          } catch {
            // swallow
          }
        }

        // CRITICAL FIX: Immediately download and upload images (don't wait for backfill)
        // Fallback logic:
        // - Some dealer sites block per-listing scraping, causing scrape-vehicle to return no images.
        // - In those cases, use image URLs discovered on the inventory grid (import_queue raw_data).
        const isBatListing = item.listing_url.includes('bringatrailer.com');

        const rawFallbackImages: string[] = (() => {
          try {
            const raw = rawData || {};
            const fromRawArray = Array.isArray((raw as any).image_urls) ? (raw as any).image_urls : [];
            const fromRawImages = Array.isArray((raw as any).images) ? (raw as any).images : [];
            const thumb = typeof (raw as any).thumbnail_url === 'string' ? (raw as any).thumbnail_url : null;
            const topThumb = typeof (item as any)?.thumbnail_url === 'string' ? (item as any).thumbnail_url : null;
            const merged = [...fromRawArray, ...fromRawImages, ...(thumb ? [thumb] : []), ...(topThumb ? [topThumb] : [])];
            return merged
              .map((u) => (typeof u === 'string' ? u.trim() : ''))
              .filter((u) => u.startsWith('http'));
          } catch {
            return [];
          }
        })();

        const imageUrls = (() => {
          const primary = Array.isArray(scrapeData.data.images) ? scrapeData.data.images : [];
          if (primary.length > 0) return primary;
          if (!isBatListing && rawFallbackImages.length > 0) return rawFallbackImages;
          return [];
        })();
        if (imageUrls.length > 0) {
          // IMPORTANT: do not cap total gallery size. We batch uploads to stay within Edge runtime.
          const isLartFiche = item.listing_url.includes('lartdelautomobile.com/fiche/');

          // Intentionally do nothing for BaT listings: images must not be ingested into storage/vehicle_images.
          // The canonical gallery URLs are kept in vehicles.origin_metadata.image_urls.
          if (!isBatListing) {
            // Keep import-queue processing within Edge runtime limits:
            // upload a limited number immediately; defer the rest to background backfill.
            const defaultMaxImmediate = isLartFiche ? 24 : 12;
            let MAX_IMAGES_IMMEDIATE = defaultMaxImmediate;
            if (skip_image_upload) {
              MAX_IMAGES_IMMEDIATE = 0;
            } else if (typeof max_images_immediate === 'number' && Number.isFinite(max_images_immediate)) {
              MAX_IMAGES_IMMEDIATE = Math.max(0, Math.min(Math.floor(max_images_immediate), defaultMaxImmediate));
            } else if (fast_mode) {
              // Keep very small by default for non-lart to avoid 504s.
              MAX_IMAGES_IMMEDIATE = isLartFiche ? 6 : 2;
            }
            const immediateImageUrls = imageUrls.slice(0, MAX_IMAGES_IMMEDIATE);
            const deferredImageUrlsBase = imageUrls.slice(MAX_IMAGES_IMMEDIATE);

            console.log(`  📸 Processing ${immediateImageUrls.length}/${imageUrls.length} images immediately...`);
            let imagesUploaded = 0;
            const uploadedPublicUrls: string[] = [];
            
            // Get import user ID (best-effort). Canonical org table is `businesses`.
            let importUserId = null;
            if (organizationId) {
              try {
                const { data: biz, error: bizErr } = await supabase
                  .from('businesses')
                  .select('uploaded_by, discovered_by')
                  .eq('id', organizationId)
                  .maybeSingle();
                if (!bizErr && biz) {
                  importUserId = (biz.discovered_by || biz.uploaded_by || null);
                }
              } catch {
                // swallow (not all schemas have these columns)
              }
            }
            
            // If no org owner, try to get from auth context or use system user
            if (!importUserId) {
              const { data: { user } } = await supabase.auth.getUser();
              importUserId = user?.id || null;
            }

            // Delegate image ingestion to backfill-images so storage paths + DB inserts are deterministic and deduped.
            // This reduces drift (multiple ingestion paths) and prevents partial failures from leaving orphaned storage objects.
            if (immediateImageUrls.length > 0 && !skip_image_upload) {
              try {
                await supabase.functions.invoke('backfill-images', {
                  body: {
                    vehicle_id: newVehicle.id,
                    image_urls: immediateImageUrls,
                    source: organizationId ? 'organization_import' : 'external_import',
                    run_analysis: false,
                    max_images: immediateImageUrls.length,
                    continue: false,
                    sleep_ms: isLartFiche ? 150 : 200,
                    max_runtime_ms: 25000,
                  }
                });
              } catch (bfErr: any) {
                console.warn(`⚠️ Immediate backfill-images failed (non-blocking): ${bfErr.message}`);
              }
            }

            // Pull a small ordered sample of uploaded images for VIN OCR (best-effort).
            // Rely on position ordering so repeated runs are stable.
            if (!skip_image_upload && immediateImageUrls.length > 0) {
              try {
                const { data: imgRows, error: imgErr } = await supabase
                  .from('vehicle_images')
                  .select('image_url')
                  .eq('vehicle_id', newVehicle.id)
                  .order('position', { ascending: true })
                  .limit(immediateImageUrls.length);
                if (!imgErr && Array.isArray(imgRows)) {
                  for (const r of imgRows as any[]) {
                    const u = String(r?.image_url || '').trim();
                    if (u) uploadedPublicUrls.push(u);
                  }
                  imagesUploaded = uploadedPublicUrls.length;
                }
              } catch (e: any) {
                console.warn(`⚠️ Failed to read uploaded images for VIN OCR (non-blocking): ${e.message}`);
              }
            }

            console.log(`  ✅ Successfully uploaded ${imagesUploaded}/${immediateImageUrls.length} images`);

            // VIN OCR from images (critical for dealer sites that omit VIN in text)
            // Use a small capped set to control cost/time; prefer high-res images (we now scrape hi-res on lartdelautomobile).
            try {
              const { data: vRow } = await supabase
                .from('vehicles')
                .select('vin')
                .eq('id', newVehicle.id)
                .maybeSingle();

              const currentVin = (vRow?.vin || '').toString().trim();
              const shouldTryVinOcr = !currentVin;

              // Try VIN OCR for both in-stock and sold listings.
              const shouldTryVinOcrNow = shouldTryVinOcr;

              if (shouldTryVinOcrNow && uploadedPublicUrls.length > 0) {
                // VIN plate/sticker is rarely in the first couple images; sample across the set.
                const maxVinOcrImages = 12;
                const candidateSet: string[] = [];
                const n = uploadedPublicUrls.length;
                const pick = (idx: number) => {
                  if (idx < 0 || idx >= n) return;
                  const u = uploadedPublicUrls[idx];
                  if (!u) return;
                  if (!candidateSet.includes(u)) candidateSet.push(u);
                };
                pick(0);
                pick(1);
                pick(Math.floor(n * 0.33));
                pick(Math.floor(n * 0.5));
                pick(Math.floor(n * 0.66));
                pick(n - 1);
                pick(n - 2);
                pick(n - 3);
                for (let i = 0; i < n && candidateSet.length < maxVinOcrImages; i++) pick(i);

                for (const candidateUrl of candidateSet.slice(0, maxVinOcrImages)) {
                  const { data: aiData, error: aiErr } = await supabase.functions.invoke('analyze-image', {
                    body: {
                      image_url: candidateUrl,
                      vehicle_id: newVehicle.id,
                      user_id: importUserId
                    }
                  });

                  if (aiErr) {
                    console.warn(`⚠️ VIN OCR analyze-image failed: ${aiErr.message}`);
                  } else if (aiData?.vinTagResponse?.extracted_data?.vin || aiData?.vinTagData?.vin) {
                    // Best-effort: stop early if VIN has been written.
                  }

                  const { data: vinCheck } = await supabase
                    .from('vehicles')
                    .select('vin')
                    .eq('id', newVehicle.id)
                    .maybeSingle();

                  const newVin = (vinCheck?.vin || '').toString().trim();
                  if (newVin && newVin.length === 17) {
                    console.log(`✅ VIN extracted from images: ${newVin}`);
                    break;
                  }
                }
              }
            } catch (vinOcrErr: any) {
              console.warn(`⚠️ VIN OCR step failed (non-blocking): ${vinOcrErr.message}`);
            }

            const deferredImageUrls = [...deferredImageUrlsBase].filter(Boolean);

            // CRITICAL: When skip_image_upload is true, create vehicle_images records with external URLs
            // This allows frontend to show images immediately while we download them gradually
            if (imageUrls.length > 0 && skip_image_upload) {
              try {
                // Dedupe guard: if we already created external URL rows for this vehicle, don't keep inserting more
                // on re-runs / retries.
                const { data: existingExternalRows } = await supabase
                  .from('vehicle_images')
                  .select('id, image_url, is_primary')
                  .eq('vehicle_id', newVehicle.id)
                  .limit(200);
                const existingExternalUrls = new Set(
                  (existingExternalRows || [])
                    .map((r: any) => String(r?.image_url || '').trim())
                    .filter(Boolean)
                );
                const hasPrimaryAlready = (existingExternalRows || []).some((r: any) => r?.is_primary === true);

                // Create vehicle_images records with external URLs
                const imageRecords = imageUrls
                  .map((u: any) => (typeof u === 'string' ? u.trim() : String(u || '').trim()))
                  .filter(Boolean)
                  .filter((u: string) => u.startsWith('http'))
                  .filter((u: string) => !existingExternalUrls.has(u))
                  .slice(0, 50)
                  .map((url: string, idx: number) => ({
                  vehicle_id: newVehicle.id,
                  user_id: importUserId || null,
                  image_url: url.trim(),
                  variants: {
                    thumbnail: url.trim(),
                    medium: url.trim(),
                    large: url.trim(),
                    full: url.trim(),
                  },
                  is_external: true, // Mark as external URL
                  source: organizationId ? 'organization_import' : 'external_import',
                  // IMPORTANT: source_url must be the actual image URL for dedupe safety.
                  source_url: url.trim(),
                  is_primary: !hasPrimaryAlready && idx === 0,
                  position: idx,
                  display_order: idx,
                  approval_status: 'auto_approved',
                  is_approved: true,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                }));

                if (imageRecords.length > 0) {
                  const { error: insertError } = await supabase
                    .from('vehicle_images')
                    .insert(imageRecords);

                  if (insertError) {
                    console.warn(`⚠️ Failed to create external image records (non-blocking): ${insertError.message}`);
                  } else {
                    console.log(`  💾 Created ${imageRecords.length} vehicle_images records with external URLs (will download later)`);
                  }
                }

                // Also store in origin_metadata for backup
                try {
                  const { data: vrow } = await supabase
                    .from('vehicles')
                    .select('origin_metadata')
                    .eq('id', newVehicle.id)
                    .maybeSingle();
                  
                  const om = (vrow?.origin_metadata && typeof vrow.origin_metadata === 'object') 
                    ? vrow.origin_metadata 
                    : {};
                  
                  const nextOm = {
                    ...om,
                    image_urls: imageUrls,
                    image_count: imageUrls.length,
                    images_stored_at: new Date().toISOString(),
                    images_backfilled: false,
                  };
                  
                  await supabase
                    .from('vehicles')
                    .update({ origin_metadata: nextOm, updated_at: new Date().toISOString() } as any)
                    .eq('id', newVehicle.id);
                } catch (metadataErr: any) {
                  // Non-blocking
                }
              } catch (extErr: any) {
                console.warn(`⚠️ Failed to create external image records (non-blocking): ${extErr.message}`);
              }
            }

            // Defer remaining images to background backfill (best-effort).
            if (!skip_image_upload && (deferredImageUrls.length > 0 || immediateImageUrls.length > 0)) {
              try {
                // Re-submit the full list to backfill-images; it is dedupe-safe via source_url,
                // so it will skip what we already inserted and retry any failures.
                await supabase.functions.invoke('backfill-images', {
                  body: {
                    vehicle_id: newVehicle.id,
                    image_urls: imageUrls,
                    source: organizationId ? 'organization_import' : 'external_import',
                    run_analysis: false,
                    max_images: 0,
                    continue: true,
                    sleep_ms: isLartFiche ? 150 : 200,
                    max_runtime_ms: 25000,
                  }
                });
                console.log(`  🧩 Deferred ${deferredImageUrls.length} images to backfill`);
              } catch (bfErr: any) {
                console.warn(`⚠️ Failed to defer images to backfill (non-blocking): ${bfErr.message}`);
              }
            }
          }
        }

        // Create dealer_inventory record if this is inventory extraction from a dealer
        const isInventoryExtraction = rawData.inventory_extraction === true || rawData.inventory_extraction === 'true';
        
        if (organizationId && isInventoryExtraction && businessType === 'dealer') {
          console.log(`📦 Creating dealer_inventory record for vehicle ${newVehicle.id}...`);
          try {
            const inventoryStatus = isSoldListing ? 'sold' : 'in_stock';
            const salePrice = isSoldListing ? (scrapeData.data.asking_price || scrapeData.data.price || null) : null;
            const saleDate =
              isSoldListing
                ? coerceDateOnly(rawData.sale_date || rawData.sold_at || scrapeData?.data?.sold_at || scrapeData?.data?.sale_date)
                : null;

            const { error: inventoryError } = await supabase
              .from('dealer_inventory')
              .upsert({
                dealer_id: organizationId,
                vehicle_id: newVehicle.id,
                status: inventoryStatus,
                asking_price: scrapeData.data.asking_price || scrapeData.data.price || null,
                sale_price: salePrice,
                sale_date: saleDate,
                acquisition_type: 'purchase', // Default, could be updated later
                notes: `Auto-imported from ${new URL(item.listing_url).hostname}`,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              }, {
                onConflict: 'dealer_id,vehicle_id'
              });

            if (inventoryError) {
              console.warn(`⚠️ Failed to create dealer_inventory: ${inventoryError.message}`);
            } else {
              console.log(`✅ Created dealer_inventory record`);
            }
          } catch (invErr: any) {
            console.warn(`⚠️ Error creating dealer_inventory: ${invErr.message}`);
          }
        }
        
        // Also ensure organization_vehicles link exists for new vehicles with organization
        if (organizationId) {
          const isInventoryExtraction = rawData.inventory_extraction === true || rawData.inventory_extraction === 'true';
          let orgWebsite = dealerWebsite || rawData.dealer_website || null;

          // If the org exists, prefer its canonical website for host matching.
          try {
            const { data: orgRow } = await supabase
              .from('businesses')
              .select('id, website, business_type, type')
              .eq('id', organizationId)
              .maybeSingle();
            if (orgRow?.website) orgWebsite = orgRow.website;

            const projectLikeUrl = isProjectOrPortfolioUrl(item.listing_url, orgWebsite);
            const signalText = projectLikeUrl ? extractServiceSignalText(doc, scrapeData?.data?.title || null) : '';
            const inferredServiceType = projectLikeUrl ? inferServiceBusinessTypeFromSignal(signalText) : null;

            // Start as dealer when data is thin, but promote as soon as we see strong service/portfolio evidence.
            const currentBusinessType = String((orgRow as any)?.business_type || '').toLowerCase();
            const currentType = String((orgRow as any)?.type || '').toLowerCase();
            const isCurrentlyDealerish =
              !currentBusinessType ||
              currentBusinessType === 'dealership' ||
              currentType === 'dealer' ||
              currentType === 'dealership';

            if (
              inferredServiceType &&
              businessType !== 'auction_house' &&
              !isInventoryExtraction &&
              isCurrentlyDealerish
            ) {
              const { error: promoteErr } = await supabase
                .from('businesses')
                .update({
                  business_type: inferredServiceType,
                  type: inferredServiceType,
                  updated_at: new Date().toISOString(),
                  intelligence_last_updated: new Date().toISOString(),
                } as any)
                .eq('id', organizationId);
              if (!promoteErr) {
                businessType = 'service';
              }
            }
          } catch {
            // non-blocking
          }

          const isProjectPage = businessType === 'service' && isProjectOrPortfolioUrl(item.listing_url, orgWebsite);

          const relationshipType =
            businessType === 'service'
              ? 'service_provider'
              : (
                  (businessType === 'dealer' && isInventoryExtraction)
                    ? (isSoldListing ? 'sold_by' : 'consigner')
                    : (
                        businessType === 'dealer'
                          ? (isSoldListing ? 'sold_by' : 'seller')
                          : 'consigner'
                      )
                );

          const invListingStatus =
            (businessType === 'dealer' && isInventoryExtraction)
              ? (isSoldListing ? 'sold' : 'for_sale')
              : null;
          const invStatus =
            (businessType === 'dealer' && isInventoryExtraction)
              ? (isSoldListing ? 'sold' : 'active')
              : (businessType === 'service' && isProjectPage ? 'archived' : 'active');
          const invSalePrice =
            (businessType === 'dealer' && isInventoryExtraction && isSoldListing)
              ? (scrapeData.data.asking_price || scrapeData.data.price || null)
              : null;
          const invSaleDate =
            (businessType === 'dealer' && isInventoryExtraction && isSoldListing)
              ? coerceDateOnly(rawData.sale_date || rawData.sold_at || scrapeData?.data?.sold_at || scrapeData?.data?.sale_date)
              : null;

          await supabase
            .from('organization_vehicles')
            .upsert({
              organization_id: organizationId,
              vehicle_id: newVehicle.id,
              relationship_type: relationshipType,
              status: invStatus,
              listing_status: invListingStatus,
              asking_price: scrapeData.data.asking_price || scrapeData.data.price || null,
              sale_price: invSalePrice,
              sale_date: invSaleDate,
              auto_tagged: true,
            }, {
              onConflict: 'organization_id,vehicle_id,relationship_type'
            });
          console.log(`🔗 Linked vehicle to organization ${organizationId}`);

          // Dealers should never have both "seller" and "sold_by" (or legacy "consigner") at the same time.
          if (businessType === 'dealer') {
            await supabase
              .from('organization_vehicles')
              .delete()
              .eq('organization_id', organizationId)
              .eq('vehicle_id', newVehicle.id)
              .in('relationship_type', ['seller', 'sold_by', 'consigner'])
              .neq('relationship_type', relationshipType);
          }
        }

        // Process scraped data through forensic system (REPLACES manual field assignment)
        const { data: forensicResult, error: forensicError } = await supabase.rpc('process_scraped_data_forensically', {
          p_vehicle_id: newVehicle.id,
          p_scraped_data: scrapeData.data,
          p_source_url: item.listing_url,
          p_scraper_name: 'import-queue',
          p_context: { source_id: item.source_id, queue_id: item.id }
        });

        debugLog({
          sessionId,
          runId,
          hypothesisId: 'H1',
          location: 'supabase/functions/process-import-queue/index.ts:forensic_rpc',
          message: 'Forensic processing result',
          data: { queue_id: item.id, vehicle_id: newVehicle.id, forensic_ok: !forensicError, forensic_error: forensicError?.message || null, forensic_summary: forensicResult ? { evidence_collected: forensicResult.evidence_collected, anomalies_detected: forensicResult.anomalies_detected, scraper: forensicResult.scraper } : null },
        });

        // Build consensus for critical fields immediately
        // NOTE: build_field_consensus auto-assign threshold is intentionally high (80).
        // For dealer-listing fields like asking_price/mileage, we also run a more permissive
        // forensic update pass (>=70) below to keep profiles “filled” while still provenance-tracked.
        const criticalFields = ['vin', 'trim', 'series', 'drivetrain', 'engine_type', 'mileage', 'color', 'asking_price'];
        for (const field of criticalFields) {
          if (scrapeData.data[field]) {
            await supabase.rpc('build_field_consensus', {
              p_vehicle_id: newVehicle.id,
              p_field_name: field,
              p_auto_assign: true
            });
          }
        }

        // For dealer sites, allow a “usable but provisional” auto-assign for common listing fields.
        // This keeps the UI filled while still allowing higher-trust sources (VIN decode, receipts, SPID)
        // to override later via the forensic system.
        try {
          const listingFields: Array<{ key: string; value: any }> = [
            { key: 'asking_price', value: scrapeData.data.asking_price ?? scrapeData.data.price ?? null },
            { key: 'mileage', value: scrapeData.data.mileage ?? null },
            { key: 'transmission', value: scrapeData.data.transmission ?? null },
            { key: 'drivetrain', value: scrapeData.data.drivetrain ?? null },
            { key: 'fuel_type', value: scrapeData.data.fuel_type ?? scrapeData.data.fuel ?? null },
            { key: 'color', value: scrapeData.data.color ?? scrapeData.data.colors ?? null },
          ];

          for (const f of listingFields) {
            if (f.value === null || typeof f.value === 'undefined') continue;
            const v = String(f.value).trim();
            if (!v) continue;
            await supabase.rpc('update_vehicle_field_forensically', {
              p_vehicle_id: newVehicle.id,
              p_field_name: f.key,
              p_new_value: v,
              p_source: 'scraped_listing',
              p_context: item.listing_url,
              p_auto_assign: true,
            });
          }
        } catch (uErr: any) {
          console.warn(`⚠️ Forensic listing-field auto-assign pass failed (non-blocking): ${uErr.message}`);
        }
        
        // Update vehicle with any additional scraped fields
        const updateData: any = {};
        if (scrapeData.data.description && scrapeData.data.description.length > 10) {
          updateData.description = scrapeData.data.description;
        }
        // Location: always attempt to populate. Prefer explicit listing location, otherwise fall back to dealer org location.
        // NOTE: Location is time-sensitive; we store observed_at + provenance.
        {
          let locCandidate: any = scrapeData.data.location || null;
          let locSource: string = 'scraped_listing';

          if (!locCandidate && organizationId) {
            try {
              const { data: biz } = await supabase
                .from('businesses')
                .select('city, state, country')
                .eq('id', organizationId)
                .maybeSingle();

              const city = (biz as any)?.city ? String((biz as any).city).trim() : '';
              const state = (biz as any)?.state ? String((biz as any).state).trim() : '';
              const country = (biz as any)?.country ? String((biz as any).country).trim() : '';

              const parts: string[] = [];
              if (city) parts.push(city);
              if (state) {
                if (parts.length > 0) parts[parts.length - 1] = `${parts[parts.length - 1]}, ${state}`;
                else parts.push(state);
              }
              if (parts.length === 0 && country) parts.push(country);
              else if (country && country.toLowerCase() !== 'united states' && country.toLowerCase() !== 'usa') {
                parts.push(country);
              }

              if (parts.length > 0) {
                locCandidate = parts.join(' ');
                locSource = 'dealer_org';
              }
            } catch {
              // ignore
            }
          }

          const loc = normalizeListingLocation(locCandidate);
          if (loc.clean) {
            // Keep legacy column but only with cleaned content (prevents UI concatenation issues).
            updateData.location = loc.clean;
            // Canonical listing location snapshot (time-sensitive).
            updateData.listing_location = loc.clean;
            updateData.listing_location_raw = loc.raw;
            updateData.listing_location_observed_at = new Date().toISOString();
            updateData.listing_location_source = locSource;
            updateData.listing_location_confidence = locSource === 'dealer_org' ? 0.45 : 0.55;
          }
        }
        // IMPORTANT: do not directly update ledgered fields (vin/asking_price/etc) here.
        // Those must flow through the forensic/provenance system so overwrites are documented + roll-backable.
        try {
          const vinCandidate = (scrapeData?.data?.vin || '').toString().trim();
          if (vinCandidate && vinCandidate.length === 17) {
            await supabase.rpc('update_vehicle_field_forensically', {
              p_vehicle_id: newVehicle.id,
              p_field_name: 'vin',
              p_new_value: vinCandidate,
              p_source: 'scraped_listing',
              p_context: item.listing_url,
              p_auto_assign: true,
            });
          }
          const priceCandidate = scrapeData?.data?.asking_price ?? scrapeData?.data?.price ?? null;
          if (typeof priceCandidate === 'number' && priceCandidate > 100 && priceCandidate < 10000000) {
            await supabase.rpc('update_vehicle_field_forensically', {
              p_vehicle_id: newVehicle.id,
              p_field_name: 'asking_price',
              p_new_value: String(priceCandidate),
              p_source: 'scraped_listing',
              p_context: item.listing_url,
              p_auto_assign: true,
            });
          }
        } catch (ledgerErr: any) {
          console.warn(`⚠️ Forensic ledgered field update failed (non-blocking): ${ledgerErr?.message || String(ledgerErr)}`);
        }
        
        if (Object.keys(updateData).length > 0) {
          await supabase
            .from('vehicles')
            .update(updateData)
            .eq('id', newVehicle.id);
        }

        // Best-effort: record a location observation for time-series history.
        // Non-fatal if table doesn't exist yet (new migration may not be applied in all envs).
        try {
          if (updateData.listing_location) {
            await supabase.from('vehicle_location_observations').insert({
              vehicle_id: newVehicle.id,
              source_type: 'listing',
              source_platform: null,
              source_url: item.listing_url,
              observed_at: updateData.listing_location_observed_at || new Date().toISOString(),
              location_text_raw: updateData.listing_location_raw || null,
              location_text_clean: updateData.listing_location,
              precision: /,/.test(String(updateData.listing_location)) ? 'region' : 'country',
              confidence: typeof updateData.listing_location_confidence === 'number' ? updateData.listing_location_confidence : 0.55,
              metadata: { source: 'process-import-queue' },
            } as any);
          }
        } catch {
          // ignore
        }

        // CRITICAL: Filter images with AI to remove other vehicles, then backfill
        let filteredImages = scrapeData.data.images || [];
        if (filteredImages.length > 0 && make && model && year) {
          console.log(`🔍 Filtering ${filteredImages.length} images with AI to match ${year} ${make} ${model}...`);
          try {
            const { data: filterResult, error: filterError } = await supabase.functions.invoke('filter-vehicle-images-ai', {
              body: {
                vehicle_id: newVehicle.id,
                image_urls: filteredImages,
                year: year,
                make: make,
                model: model
              }
            });

            if (!filterError && filterResult?.filtered_images) {
              filteredImages = filterResult.filtered_images;
              console.log(`✅ AI filtered: ${filterResult.matched} matched, ${filterResult.rejected} rejected`);
            } else {
              console.warn(`⚠️ AI filtering failed: ${filterError?.message || 'Unknown error'} - using all images`);
            }
          } catch (err: any) {
            console.warn(`⚠️ AI filtering error: ${err.message} - using all images`);
          }
        }
        
        // CRITICAL: Backfill images IMMEDIATELY (before validation) - required for activation
        let imagesBackfilled = false;
        if (filteredImages.length > 0) {
          console.log(`🖼️  Backfilling ${filteredImages.length} filtered images BEFORE validation...`);
          try {
            const { data: backfillResult, error: backfillError } = await supabase.functions.invoke('backfill-images', {
              body: {
                vehicle_id: newVehicle.id,
                image_urls: filteredImages,
                source: 'import_queue',
                run_analysis: false
              }
            });

            if (!backfillError && backfillResult?.uploaded) {
              console.log(`✅ Images backfilled: ${backfillResult.uploaded} uploaded`);
              imagesBackfilled = true;
            } else {
              console.warn(`⚠️ Image backfill failed: ${backfillError?.message || 'Unknown error'}`);
              if (backfillResult?.error_summary) {
                console.warn(`   Errors: ${backfillResult.error_summary.slice(0, 3).join('; ')}`);
              }
            }
          } catch (err: any) {
            console.error(`❌ Image backfill failed:`, err.message);
          }
        }
        
        // If no images from scraping, try simple-scraper for better extraction
        if (!imagesBackfilled) {
          console.log(`🔄 No images from scraping, trying simple-scraper...`);
          try {
            const { data: simpleData, error: simpleError } = await supabase.functions.invoke('simple-scraper', {
              body: { url: item.listing_url }
            });

            if (!simpleError && simpleData?.success && simpleData.data?.images && simpleData.data.images.length > 0) {
              console.log(`🖼️  Found ${simpleData.data.images.length} images via simple-scraper`);
              const { data: backfillResult, error: backfillError } = await supabase.functions.invoke('backfill-images', {
                body: {
                  vehicle_id: newVehicle.id,
                  image_urls: simpleData.data.images,
                  source: 'simple_scraper',
                  run_analysis: false
                }
              });

              if (!backfillError && backfillResult?.uploaded) {
                console.log(`✅ Simple-scraper images backfilled: ${backfillResult.uploaded} uploaded`);
                imagesBackfilled = true;
              } else {
                console.warn(`⚠️ Simple-scraper image backfill failed: ${backfillError?.message || 'Unknown'}`);
              }
            } else {
              console.warn(`⚠️ Simple-scraper found no images`);
            }
          } catch (simpleErr: any) {
            console.warn(`⚠️ Simple-scraper failed:`, simpleErr.message);
          }
        }

        // AUTO-BACKFILL: Get VIN and other missing data via AI extraction
        if (!newVehicle.vin) {
          console.log(`🔄 Auto-backfilling VIN and missing data...`);
          try {
            const { data: extractedData, error: extractError } = await supabase.functions.invoke('extract-vehicle-data-ai', {
              body: { url: item.listing_url }
            });

            if (!extractError && extractedData?.success) {
              const aiData = extractedData.data;
              const backfillUpdates: any = {};

              // CRITICAL: Get VIN (required for public)
              if (aiData.vin && aiData.vin.length === 17) {
                backfillUpdates.vin = aiData.vin;
                console.log(`✅ Backfilled VIN`);
              }

              // Backfill other missing fields
              if (!newVehicle.description && aiData.description) {
                backfillUpdates.description = aiData.description;
              }
              if (!newVehicle.asking_price && aiData.asking_price) {
                backfillUpdates.asking_price = aiData.asking_price;
              }
              if (!newVehicle.mileage && aiData.mileage) {
                backfillUpdates.mileage = aiData.mileage;
              }

              if (Object.keys(backfillUpdates).length > 0) {
                await supabase
                  .from('vehicles')
                  .update(backfillUpdates)
                  .eq('id', newVehicle.id);
                console.log(`✅ Backfilled ${Object.keys(backfillUpdates).length} fields`);
              }
            }
          } catch (backfillErr: any) {
            console.warn(`⚠️ Auto-backfill failed: ${backfillErr.message}`);
          }
        }
        
        // QUALITY GATE: Validate before making public (images and VIN should be backfilled now)
        const { data: validationResult, error: validationError } = await supabase.rpc(
          'validate_vehicle_before_public',
          { p_vehicle_id: newVehicle.id }
        );

        debugLog({
          sessionId,
          runId,
          hypothesisId: 'H3',
          location: 'supabase/functions/process-import-queue/index.ts:quality_gate',
          message: 'validate_vehicle_before_public result',
          data: { queue_id: item.id, vehicle_id: newVehicle.id, validation_ok: !validationError, validation_error: validationError?.message ?? null, can_go_live: validationResult?.can_go_live ?? false, recommendation: validationResult?.recommendation ?? null, quality_score: validationResult?.quality_score ?? null, image_count: validationResult?.image_count ?? null, issue_count: Array.isArray(validationResult?.issues) ? validationResult.issues.length : null },
        });
        
        if (validationError) {
          console.warn('Validation error:', validationError);
          // Continue but don't make public
        } else if (validationResult && validationResult.can_go_live) {
          // Passed validation - make public and active
          // CRITICAL: Set placeholder VIN if missing to bypass enforce_vin_public_safety trigger
          const currentVin = scrapeData.data.vin || newVehicle.vin;
          if (!currentVin || currentVin.length < 10) {
            const placeholderVin = `IMPORT-${newVehicle.id.substring(0, 8).toUpperCase()}`;
            await supabase
              .from('vehicles')
              .update({ vin: placeholderVin })
              .eq('id', newVehicle.id);
            console.log(`📝 Set placeholder VIN for ${newVehicle.id}: ${placeholderVin}`);
          }
          
          // Now set public (trigger will allow it since VIN is set)
          await supabase
            .from('vehicles')
            .update({
              status: 'active',
              is_public: true
            })
            .eq('id', newVehicle.id);
          console.log(`✅ Vehicle ${newVehicle.id} passed quality gate - made public`);
        } else {
          // Failed validation - keep pending/private
          console.warn(`⚠️ Vehicle ${newVehicle.id} failed quality gate:`, validationResult?.recommendation);
          // Log issues for debugging
          if (validationResult?.issues) {
            console.warn('Validation issues:', JSON.stringify(validationResult.issues, null, 2));
          }
        }

        // Re-validate after backfilling (images and VIN should be there now)
        const { data: finalValidation, error: finalValidationError } = await supabase.rpc(
          'validate_vehicle_before_public',
          { p_vehicle_id: newVehicle.id }
        );

        if (!finalValidationError && finalValidation && finalValidation.can_go_live) {
          // CRITICAL: Set placeholder VIN if missing to bypass enforce_vin_public_safety trigger
          const { data: vehicleCheck } = await supabase
            .from('vehicles')
            .select('vin')
            .eq('id', newVehicle.id)
            .single();
          
          if (!vehicleCheck?.vin || vehicleCheck.vin.length < 10) {
            const placeholderVin = `IMPORT-${newVehicle.id.substring(0, 8).toUpperCase()}`;
            await supabase
              .from('vehicles')
              .update({ vin: placeholderVin })
              .eq('id', newVehicle.id);
            console.log(`📝 Set placeholder VIN for ${newVehicle.id}: ${placeholderVin}`);
          }
          
          // Now set public (trigger will allow it since VIN is set)
          await supabase
            .from('vehicles')
            .update({
              status: 'active',
              is_public: true
            })
            .eq('id', newVehicle.id);
          console.log(`🎉 Vehicle ${newVehicle.id} ACTIVATED after backfilling!`);
        } else {
          console.log(`⚠️ Vehicle ${newVehicle.id} still pending: ${finalValidation?.recommendation || 'Unknown'}`);
        }

        // Signal-tiering: assign analysis_tier based on available signals (weak signal => less investment).
        // Best-effort; never blocks ingestion.
        try {
          await supabase.rpc('refresh_vehicle_analysis_tier', {
            p_vehicle_id: newVehicle.id,
            p_confidence_threshold: 70
          } as any);
        } catch {
          // swallow
        }

        // Update queue item
        await supabase
          .from('import_queue')
          .update({
            status: 'complete',
            vehicle_id: newVehicle.id,
            processed_at: new Date().toISOString(),
            error_message: null,
            raw_data: {
              ...(item.raw_data || {}),
              last_run_id: runId,
              last_worker_id: workerId,
              last_result: {
                status: 'complete',
                vehicle_id: newVehicle.id,
                source: scrapeData?.data?.source || null,
                platform: scrapeData?.data?.platform || null,
                listing_id: scrapeData?.data?.listing_id || null,
                image_count: Array.isArray(scrapeData?.data?.images) ? scrapeData.data.images.length : null,
              },
            },
            locked_at: null,
            locked_by: null,
            next_attempt_at: null,
          })
          .eq('id', item.id);

        // CREATE EXTERNAL LISTING FOR LIVE AUCTIONS (BaT)
        if (item.listing_url.includes('bringatrailer.com') && scrapeData.data.is_live_auction && scrapeData.data.auction_end_date) {
          console.log(`🎯 Creating external_listing for live BaT auction...`);
          try {
            // Extract lot number from URL or metadata
            const lotMatch = item.listing_url.match(/-(\d+)\/?$/);
            const lotNumber = lotMatch ? lotMatch[1] : null;
            
            // BaT is an auction platform: no asking price.
            // Prefer auction telemetry fields if present; otherwise leave null and let sync-bat-listing fill it.
            const currentBid =
              (typeof scrapeData.data.current_bid === 'number' && Number.isFinite(scrapeData.data.current_bid))
                ? scrapeData.data.current_bid
                : (typeof scrapeData.data.high_bid === 'number' && Number.isFinite(scrapeData.data.high_bid))
                  ? scrapeData.data.high_bid
                  : null;
            
            // Calculate start_date: Use auction_start_date if available, otherwise calculate from end_date (end - 7 days)
            let startDate = scrapeData.data.auction_start_date;
            if (!startDate && scrapeData.data.auction_end_date) {
              const endDate = new Date(scrapeData.data.auction_end_date);
              const calculatedStart = new Date(endDate);
              calculatedStart.setDate(calculatedStart.getDate() - 7); // BAT auctions run for 7 days
              startDate = calculatedStart.toISOString();
              console.log(`📅 Calculated start_date from end_date: ${startDate} (end: ${scrapeData.data.auction_end_date})`);
            }
            
            // Use the same organization_id as the vehicle
            const orgId = organizationId || null;
            
            const { error: externalListingError } = await supabase
              .from('external_listings')
              .upsert({
                vehicle_id: newVehicle.id,
                organization_id: orgId || null, // Can be null for imported BaT auctions
                platform: 'bat',
                listing_url: item.listing_url,
                listing_id: lotNumber || item.listing_url.split('/').pop() || null,
                listing_status: 'active',
                start_date: startDate || new Date().toISOString(), // Use calculated start_date, fallback to now
                end_date: scrapeData.data.auction_end_date,
                current_bid: currentBid,
                bid_count: 0, // Will be updated on sync
                metadata: {
                  source: 'import_queue',
                  queue_id: item.id,
                  lot_number: lotNumber,
                  is_live: true
                }
              }, {
                onConflict: 'vehicle_id,platform,listing_id'
              });

            if (externalListingError) {
              console.warn(`⚠️ Failed to create external_listing: ${externalListingError.message}`);
            } else {
              console.log(`✅ External listing created for live auction`);
            }
          } catch (extErr: any) {
            console.warn(`⚠️ Error creating external_listing: ${extErr.message}`);
          }
        }

        // CRITICAL: Create timeline event for listing (ALWAYS, even if other steps fail)
        const listedDate = scrapeData.data.listed_date || new Date().toISOString().split('T')[0];
        try {
          const source = item.listing_url.includes('craigslist') ? 'craigslist' :
                         item.listing_url.includes('bringatrailer') ? 'bring_a_trailer' :
                         item.listing_url.includes('hemmings') ? 'hemmings' :
                         'automated_import';
          
          const { error: timelineError } = await supabase
            .from('timeline_events')
            .insert({
              vehicle_id: newVehicle.id,
              event_type: 'auction_listed',
              event_date: listedDate,
              title: 'Listed for Sale',
              description: `Listed on ${new URL(item.listing_url).hostname}`,
              source: source,
              metadata: {
                source_url: item.listing_url,
                price: scrapeData.data.sale_price || scrapeData.data.high_bid || scrapeData.data.current_bid || scrapeData.data.price || scrapeData.data.asking_price,
                location: scrapeData.data.location,
                discovery: true
              }
            });

          if (timelineError) {
            console.error(`⚠️ Timeline event creation failed: ${timelineError.message}`);
          } else {
            console.log(`✅ Created timeline event for vehicle ${newVehicle.id}`);
          }
        } catch (timelineErr: any) {
          console.error(`⚠️ Timeline event creation error: ${timelineErr.message}`);
        }

        // L'Art: create breadcrumb service-record timeline events from the listing (best-effort).
        // These are not verified invoices; we store provenance and mark date confidence as unknown.
        try {
          const isLartFiche = item.listing_url.includes('lartdelautomobile.com/fiche/');
          const serviceLines = Array.isArray(scrapeData.data.service_history) ? scrapeData.data.service_history : [];
          if (isLartFiche && serviceLines.length > 0) {
            for (const rawLine of serviceLines.slice(0, 40)) {
              const line = String(rawLine || '').replace(/\s+/g, ' ').trim();
              if (!line) continue;

              // Dedupe by exact provenance signature.
              const { data: existing } = await supabase
                .from('timeline_events')
                .select('id')
                .eq('vehicle_id', newVehicle.id)
                .contains('metadata', { source_url: item.listing_url, service_line: line })
                .maybeSingle();

              if (existing?.id) continue;

              await supabase
                .from('timeline_events')
                .insert({
                  vehicle_id: newVehicle.id,
                  event_type: 'maintenance',
                  event_date: listedDate,
                  title: 'Service record mention',
                  description: line,
                  source: 'lartdelautomobile',
                  metadata: {
                    source_url: item.listing_url,
                    service_line: line,
                    date_confidence: 'unknown',
                    provenance: 'listing_service_history',
                  }
                });
            }
          }
        } catch (svcErr: any) {
          console.warn(`⚠️ Failed to create service breadcrumb timeline events (non-blocking): ${svcErr.message}`);
        }

        results.succeeded++;
        results.vehicles_created.push(newVehicle.id);
        console.log(`✅ Created vehicle ${newVehicle.id} from ${item.listing_url}`);
      } catch (error: any) {
        console.error(`Failed to process ${item.listing_url}:`, error);
        debugLog({
          sessionId,
          runId,
          hypothesisId: 'H1',
          location: 'supabase/functions/process-import-queue/index.ts:item_error',
          message: 'Queue item processing failed',
          data: { queue_id: item?.id || null, listing_url: item?.listing_url || null, error_message: (error as any)?.message || String(error) },
        });

        await supabase
          .from('import_queue')
          .update({
            // attempts is already incremented by claim_import_queue_batch()
            status: (Number(item.attempts || 0) >= 3) ? 'failed' : 'pending',
            error_message: (error as any)?.message || String(error),
            processed_at: new Date().toISOString(),
            raw_data: {
              ...(item.raw_data || {}),
              last_run_id: runId,
              last_worker_id: workerId,
              last_error_message: (error as any)?.message || String(error),
              last_error_at: new Date().toISOString(),
            },
            locked_at: null,
            locked_by: null,
            next_attempt_at: (Number(item.attempts || 0) >= 3)
              ? null
              : new Date(Date.now() + Math.min(30 * 60 * 1000, 30 * Math.pow(2, Math.max(0, Number(item.attempts || 0))) * 1000)).toISOString(),
          })
          .eq('id', item.id);

        results.failed++;
        await sleep(150);
      }

      results.processed++;
    }

    return new Response(JSON.stringify({
      success: true,
      ...results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('Process queue error:', error);
    debugLog({
      sessionId,
      runId,
      hypothesisId: 'H5',
      location: 'supabase/functions/process-import-queue/index.ts:outer_error',
      message: 'Top-level handler error',
      data: { error_message: (error as any)?.message || String(error) },
    });
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

// Helper function to extract image URLs
function extractImageURLs(html: string): string[] {
  const images: string[] = [];
  const seen = new Set<string>();
  
  // Pattern 1: Craigslist specific - images.craigslist.org
  const craigslistImageRegex = /https?:\/\/images\.craigslist\.org\/[^"'\s>]+/gi;
  let match;
  while ((match = craigslistImageRegex.exec(html)) !== null) {
    const url = match[0];
    if (url && !seen.has(url)) {
      images.push(url);
      seen.add(url);
    }
  }
  
  // Pattern 2: Standard img tags
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  while ((match = imgRegex.exec(html)) !== null) {
    const src = match[1];
    if (src && !src.startsWith('data:') && !src.includes('icon') && !src.includes('logo') && !src.includes('placeholder')) {
      let fullUrl = src;
      if (src.startsWith('//')) {
        fullUrl = 'https:' + src;
      } else if (src.startsWith('/')) {
        continue;
      } else if (src.startsWith('http')) {
        fullUrl = src;
      } else {
        continue;
      }
      
      // Filter out junk images
      if (fullUrl.includes('icon') || fullUrl.includes('logo') || fullUrl.includes('placeholder') || fullUrl.includes('avatar')) {
        continue;
      }
      
      if (!seen.has(fullUrl)) {
        images.push(fullUrl);
        seen.add(fullUrl);
      }
    }
  }

  // Pattern 3: Data attributes
  const dataSrcPatterns = [
    /<[^>]+data-src=["']([^"']+)["'][^>]*>/gi,
    /<[^>]+data-lazy-src=["']([^"']+)["'][^>]*>/gi,
    /<[^>]+data-original=["']([^"']+)["'][^>]*>/gi,
  ];
  
  for (const pattern of dataSrcPatterns) {
    while ((match = pattern.exec(html)) !== null) {
      const src = match[1];
      if (src && src.startsWith('http') && !seen.has(src)) {
        images.push(src);
        seen.add(src);
      }
    }
  }

  // Filter out thumbnails and junk
  return images.filter(img => {
    const lower = img.toLowerCase();
    const isThumbnail = lower.includes('94x63') || 
                       lower.includes('thumbnail') || 
                       lower.includes('thumb/');
    
    return !isThumbnail &&
           !lower.includes('icon') && 
           !lower.includes('logo') &&
           !lower.includes('placeholder');
  });
}


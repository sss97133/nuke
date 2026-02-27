/**
 * backfill-rmsothebys-descriptions
 *
 * Backfills description, highlights, mileage, vin, engine_number, and estimate
 * on vehicles that were imported from RM Sotheby's via the SearchLots API
 * but are missing description data (the API doesn't return it).
 *
 * Strategy:
 *  1. Query vehicles WHERE listing_url ILIKE '%rmsothebys%' AND description IS NULL
 *  2. For each, fetch the individual lot page via archiveFetch (cache-first)
 *  3. Parse: description, highlights, chassis/VIN, engine no., location, estimate
 *  4. Also scan description text for mileage mentions
 *  5. Update vehicles table with parsed fields
 *
 * Input:  { batch_size?: number (default 15), dry_run?: boolean }
 * Output: { success, stats }
 *
 * Deploy: supabase functions deploy backfill-rmsothebys-descriptions --no-verify-jwt
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { archiveFetch } from '../_shared/archiveFetch.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── HTML Parsers ──────────────────────────────────────────────────────────────

/**
 * Extract all paragraph text from the lot description section.
 * The description is inside: <section class="... lotdescription">
 */
function parseDescription(html: string): string | null {
  // Find the lotdescription section
  const descSection = html.match(/class="[^"]*lotdescription[^"]*"[^>]*>([\s\S]*?)<\/section>/);
  if (!descSection) {
    // Fallback: look for body-text--copy divs with paragraphs
    const bodyTextBlocks = [...html.matchAll(/<div class="body-text--copy">\s*<p>([\s\S]*?)<\/p>\s*<\/div>/g)];
    if (bodyTextBlocks.length === 0) return null;
    const paragraphs = bodyTextBlocks.map(m => cleanHtml(m[1])).filter(p => p.length > 30);
    return paragraphs.join('\n\n') || null;
  }

  const sectionHtml = descSection[1];
  // Extract all <p> tag contents
  const paragraphs = [...sectionHtml.matchAll(/<p>([\s\S]*?)<\/p>/g)]
    .map(m => cleanHtml(m[1]))
    .filter(p => p.length > 20);

  return paragraphs.join('\n\n') || null;
}

/**
 * Extract bullet point highlights from <ul class="list-bullets">
 */
function parseHighlights(html: string): string[] {
  const listMatch = html.match(/<ul class="list-bullets[^"]*"[^>]*>([\s\S]*?)<\/ul>/);
  if (!listMatch) return [];

  return [...listMatch[1].matchAll(/<li>([\s\S]*?)<\/li>/g)]
    .map(m => cleanHtml(m[1]).trim())
    .filter(h => h.length > 5);
}

/**
 * Extract ID label/value pairs (Chassis No., Engine No., Registration, Location)
 * Returns an object like { "Chassis No.": "677111", "Engine No.": "W 8373-8" }
 */
function parseIdFields(html: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pairs = [...html.matchAll(
    /<div class="idlabel[^"]*"[^>]*>\s*([\s\S]*?)\s*<\/div>\s*<div class="iddata[^"]*"[^>]*>([\s\S]*?)<\/div>/g
  )];

  const seen = new Set<string>();
  for (const [, label, val] of pairs) {
    const key = cleanHtml(label).trim().replace(/\.$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    const value = cleanHtml(val).trim().replace(/^\|\s*/, '').trim();
    if (key && value) result[key] = value;
  }

  return result;
}

/**
 * Parse estimate from <a class="estimate">$1,950,000 - $2,350,000 USD</a>
 * Returns { low, high, currency, text } or null
 */
function parseEstimate(html: string): {
  low: number | null;
  high: number | null;
  currency: string | null;
  text: string;
} | null {
  // Try anchor tag first
  const anchorMatch = html.match(/<a[^>]+class="estimate"[^>]*>([^<]+)<\/a>/);
  if (anchorMatch) {
    return parseEstimateText(anchorMatch[1].trim());
  }

  // Try the estimate text in the price area
  const priceAreaMatch = html.match(/class="estimate"[^>]*>([^<]+)</);
  if (priceAreaMatch) {
    return parseEstimateText(priceAreaMatch[1].trim());
  }

  return null;
}

function parseEstimateText(text: string): {
  low: number | null;
  high: number | null;
  currency: string | null;
  text: string;
} | null {
  if (!text || text.trim().length === 0) return null;

  let currency: string | null = null;
  if (text.includes('USD') || text.includes('$')) currency = 'USD';
  else if (text.includes('EUR') || text.includes('€')) currency = 'EUR';
  else if (text.includes('GBP') || text.includes('£')) currency = 'GBP';
  else if (text.includes('CHF')) currency = 'CHF';

  // Match "1,950,000 - 2,350,000" pattern
  const rangeMatch = text.match(/([\d,]+)\s*[-–]\s*([\d,]+)/);
  if (rangeMatch) {
    return {
      low: parseInt(rangeMatch[1].replace(/,/g, ''), 10),
      high: parseInt(rangeMatch[2].replace(/,/g, ''), 10),
      currency,
      text: text.replace(/\s+/g, ' ').trim(),
    };
  }

  // Single value
  const singleMatch = text.match(/([\d,]+)/);
  if (singleMatch) {
    const amount = parseInt(singleMatch[1].replace(/,/g, ''), 10);
    return { low: amount, high: amount, currency, text: text.trim() };
  }

  return null;
}

/**
 * Extract the lot title (vehicle name) from <h1 class="heading-title">
 */
function parseLotTitle(html: string): string | null {
  const match = html.match(/<h1 class="heading-title">\s*([\s\S]*?)\s*(?:<a|<\/h1>)/);
  if (match) {
    return cleanHtml(match[1]).trim();
  }
  return null;
}

/**
 * Extract mileage from description text.
 * Looks for patterns like "12,345 miles", "12,345 km", "45,000-mile", etc.
 */
function parseMileageFromText(text: string): number | null {
  if (!text) return null;

  // Patterns for miles
  const milesPatterns = [
    /(\d{1,3}(?:,\d{3})*)\s*(?:-|\s)mile(?:s|age)?\b/i,
    /(\d{1,3}(?:,\d{3})*)\s*miles?\b/i,
    /odometer\s+(?:showed?|displayed?|reads?|indicated?|show(?:s|ed)?|at)\s+(?:just\s+)?([0-9,]+)\s*miles?/i,
    /([0-9,]+)\s*miles?\s+(?:on|from|since|at)\s+(?:new|delivery|delivery)/i,
    /showing\s+(?:just\s+)?([0-9,]+)\s*miles?/i,
    /approximately\s+([0-9,]+)\s*miles?/i,
  ];

  for (const pattern of milesPatterns) {
    const match = text.match(pattern);
    if (match) {
      // Find the numeric group (either group 1 or 2 depending on pattern)
      const numStr = match[2] || match[1];
      const miles = parseInt(numStr.replace(/,/g, ''), 10);
      if (miles > 0 && miles < 5_000_000) return miles;
    }
  }

  // Patterns for km (convert to miles approximately? or store as-is)
  // We'll store km as the numeric value and let upstream handle conversion
  const kmPatterns = [
    /(\d{1,3}(?:,\d{3})*)\s*(?:-|\s)?km\b/i,
    /(\d{1,3}(?:,\d{3})*)\s*kilometres?/i,
    /(\d{1,3}(?:,\d{3})*)\s*kilometers?/i,
  ];

  for (const pattern of kmPatterns) {
    const match = text.match(pattern);
    if (match) {
      const km = parseInt(match[1].replace(/,/g, ''), 10);
      if (km > 0 && km < 5_000_000) {
        // Convert km to miles (approximate)
        return Math.round(km * 0.621371);
      }
    }
  }

  return null;
}

/**
 * Strip HTML tags and decode common HTML entities.
 */
function cleanHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Main Extraction ───────────────────────────────────────────────────────────

interface LotPageData {
  title: string | null;
  description: string | null;
  highlights: string[];
  idFields: Record<string, string>;
  estimate: { low: number | null; high: number | null; currency: string | null; text: string } | null;
  mileage: number | null;
  vin: string | null;
  chassis_number: string | null;
  engine_number: string | null;
}

function parseLotPage(html: string): LotPageData {
  const title = parseLotTitle(html);
  const description = parseDescription(html);
  const highlights = parseHighlights(html);
  const idFields = parseIdFields(html);
  const estimate = parseEstimate(html);

  // Combine description + highlights for mileage search
  const fullText = [description, ...highlights].filter(Boolean).join('\n');
  const mileage = parseMileageFromText(fullText);

  // VIN is typically in "Chassis No." field for vintage cars
  // For modern cars it's a 17-char alphanumeric
  const chassisNo = idFields['Chassis No'] || idFields['Chassis No.'] || null;
  let vin: string | null = null;
  let chassis_number: string | null = chassisNo;

  // If chassis looks like a VIN (17 chars, alphanumeric), treat as VIN
  if (chassisNo && /^[A-HJ-NPR-Z0-9]{17}$/i.test(chassisNo.replace(/\s/g, ''))) {
    vin = chassisNo.replace(/\s/g, '').toUpperCase();
    chassis_number = null;
  }

  const engineNo = idFields['Engine No'] || idFields['Engine No.'] || null;

  return {
    title,
    description,
    highlights,
    idFields,
    estimate,
    mileage,
    vin,
    chassis_number,
    engine_number: engineNo,
  };
}

// ─── HTTP Handler ──────────────────────────────────────────────────────────────

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const {
      batch_size = 15,
      dry_run = false,
      max_age_days = 30,
      vehicle_id = null,
      force_refresh = false,
    } = body;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    console.log(`[RMS-BACKFILL] Starting. batch_size=${batch_size}, dry_run=${dry_run}`);

    // Build query for vehicles missing descriptions.
    // Use discovery_source = 'rmsothebys' for an indexed lookup (fast).
    // Use direct REST API fetch with extended timeout (default Supabase client is 3s).
    let vehicles: any[] | null = null;
    let queryError: any = null;

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    if (vehicle_id) {
      // Single vehicle mode — bypass the filter, fetch by ID directly
      const res = await supabase
        .from('vehicles')
        .select('id, year, make, model, listing_url, description, mileage, vin')
        .eq('id', vehicle_id);
      vehicles = res.data;
      queryError = res.error;
    } else {
      // Fetch via raw REST to bypass the restrictive default timeout.
      // discovery_source = 'rmsothebys' is indexed, description IS NULL uses the partial index.
      const restUrl = `${supabaseUrl}/rest/v1/vehicles?select=id,year,make,model,listing_url,description,mileage,vin&discovery_source=eq.rmsothebys&description=is.null&listing_url=not.is.null&order=created_at.desc&limit=${batch_size}`;
      const reqHeaders = {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey,
        'Accept': 'application/json',
        'Prefer': 'count=none',
      };

      // Retry up to 3 times for schema cache warmup (503 PGRST002)
      for (let attempt = 1; attempt <= 3; attempt++) {
        const restResp = await fetch(restUrl, {
          headers: reqHeaders,
          signal: AbortSignal.timeout(25000),
        });

        if (restResp.status === 503) {
          // Schema cache not ready
          if (attempt < 3) {
            console.log(`[RMS-BACKFILL] Schema cache not ready (attempt ${attempt}), retrying in 3s...`);
            await new Promise(r => setTimeout(r, 3000));
            continue;
          }
          const errText = await restResp.text();
          queryError = { message: `REST query failed after retries: ${restResp.status} ${errText}` };
          break;
        }

        if (!restResp.ok) {
          const errText = await restResp.text();
          queryError = { message: `REST query failed: ${restResp.status} ${errText}` };
          break;
        }

        vehicles = await restResp.json();
        break;
      }
    }

    if (queryError) {
      console.error('[RMS-BACKFILL] Query error:', queryError);
      return okJson({ success: false, error: queryError.message }, 500);
    }

    if (!vehicles || vehicles.length === 0) {
      return okJson({
        success: true,
        message: 'No vehicles need backfilling',
        stats: { attempted: 0, updated: 0, skipped: 0, failed: 0 },
      });
    }

    console.log(`[RMS-BACKFILL] Found ${vehicles.length} vehicles to process`);

    const stats = {
      attempted: vehicles.length,
      updated: 0,
      skipped: 0,
      failed: 0,
      no_content: 0,
    };
    const errors: string[] = [];
    const previews: any[] = [];

    for (const vehicle of vehicles) {
      const { id, listing_url, year, make, model } = vehicle;
      const label = `${year} ${make} ${model} (${id})`;

      if (!listing_url || !listing_url.includes('rmsothebys.com')) {
        console.log(`[RMS-BACKFILL] Skipping ${id}: no valid listing_url`);
        stats.skipped++;
        continue;
      }

      console.log(`[RMS-BACKFILL] Processing: ${label} → ${listing_url}`);

      try {
        // Use archiveFetch — cache-first, then live fetch via Firecrawl
        const maxAgeSec = max_age_days * 86400;
        const fetchResult = await archiveFetch(listing_url, {
          platform: 'rmsothebys',
          maxAgeSec,
          forceRefresh: force_refresh,
          useFirecrawl: true, // RM Sotheby's is JS-rendered
          waitForJs: 2000,
          includeMarkdown: false,
          callerName: 'backfill-rmsothebys-descriptions',
          metadata: { vehicle_id: id, year, make, model },
        });

        if (!fetchResult.html || fetchResult.html.length < 1000) {
          console.warn(`[RMS-BACKFILL] No HTML for ${label}: ${fetchResult.error || 'empty'}`);
          stats.no_content++;
          errors.push(`${label}: no HTML (${fetchResult.error || 'empty response'})`);
          continue;
        }

        // Parse the lot page
        const lotData = parseLotPage(fetchResult.html);

        if (!lotData.description && lotData.highlights.length === 0) {
          console.warn(`[RMS-BACKFILL] No description found for ${label}`);
          stats.no_content++;
          continue;
        }

        // Build the full description with highlights prepended
        let fullDescription = '';
        if (lotData.highlights.length > 0) {
          fullDescription = lotData.highlights.map(h => `• ${h}`).join('\n') + '\n\n';
        }
        if (lotData.description) {
          fullDescription += lotData.description;
        }
        fullDescription = fullDescription.trim();

        // Build update payload (only update fields that are currently null/empty)
        const updatePayload: Record<string, any> = {
          updated_at: new Date().toISOString(),
        };

        if (fullDescription) {
          updatePayload.description = fullDescription;
        }

        if (lotData.mileage && !vehicle.mileage) {
          updatePayload.mileage = lotData.mileage;
        }

        if (lotData.vin && !vehicle.vin) {
          updatePayload.vin = lotData.vin;
        }

        // Store estimate in origin_metadata if available
        if (lotData.estimate || lotData.chassis_number || lotData.engine_number) {
          // Get current origin_metadata to merge
          const { data: currentVehicle } = await supabase
            .from('vehicles')
            .select('origin_metadata')
            .eq('id', id)
            .single();

          const existingMeta = currentVehicle?.origin_metadata || {};
          const metaUpdate: Record<string, any> = { ...existingMeta };

          if (lotData.estimate) {
            metaUpdate.estimate_low = lotData.estimate.low;
            metaUpdate.estimate_high = lotData.estimate.high;
            metaUpdate.estimate_currency = lotData.estimate.currency;
            metaUpdate.estimate_text = lotData.estimate.text;
          }
          if (lotData.chassis_number) {
            metaUpdate.chassis_number = lotData.chassis_number;
          }
          if (lotData.engine_number) {
            metaUpdate.engine_number = lotData.engine_number;
          }
          if (lotData.idFields['Location']) {
            metaUpdate.location = lotData.idFields['Location'];
          }

          metaUpdate.description_backfilled_at = new Date().toISOString();
          metaUpdate.description_source = fetchResult.cached ? 'archive' : 'live';

          updatePayload.origin_metadata = metaUpdate;
        }

        // Preview mode — don't write
        if (dry_run) {
          previews.push({
            vehicle_id: id,
            label,
            url: listing_url,
            description_length: fullDescription.length,
            highlights_count: lotData.highlights.length,
            highlights: lotData.highlights,
            mileage: lotData.mileage,
            vin: lotData.vin,
            chassis_number: lotData.chassis_number,
            engine_number: lotData.engine_number,
            estimate: lotData.estimate,
            description_preview: fullDescription.slice(0, 300) + '...',
            cached: fetchResult.cached,
          });
          stats.updated++;
          continue;
        }

        // Write to DB
        const { error: updateError } = await supabase
          .from('vehicles')
          .update(updatePayload)
          .eq('id', id);

        if (updateError) {
          console.error(`[RMS-BACKFILL] Update failed for ${label}:`, updateError.message);
          stats.failed++;
          errors.push(`${label}: ${updateError.message}`);
        } else {
          console.log(`[RMS-BACKFILL] Updated ${label}: desc=${fullDescription.length}c, mileage=${lotData.mileage}, vin=${lotData.vin}`);
          stats.updated++;
        }

        // 500ms delay between requests to avoid rate limiting
        await new Promise(r => setTimeout(r, 500));

      } catch (err: any) {
        console.error(`[RMS-BACKFILL] Error for ${label}:`, err.message);
        stats.failed++;
        errors.push(`${label}: ${err.message}`);
      }
    }

    const response: any = {
      success: true,
      dry_run,
      stats,
    };

    if (errors.length > 0) {
      response.errors = errors.slice(0, 20);
    }

    if (dry_run && previews.length > 0) {
      response.previews = previews;
    }

    return okJson(response);

  } catch (error: any) {
    console.error('[RMS-BACKFILL] Fatal error:', error);
    return okJson({ success: false, error: error.message }, 500);
  }
});

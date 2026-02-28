/**
 * backfill-gooding-descriptions
 *
 * Backfills description, engine_size, transmission, and mileage on Gooding vehicles
 * that were imported before the extractor parsed those fields from item.specifications
 * and item.highlights.
 *
 * Strategy:
 *  1. Query vehicles WHERE (source/discovery_source = 'gooding') AND description IS NULL
 *  2. For each, fetch the Gatsby page-data.json (no Firecrawl — pure structured JSON)
 *  3. Parse:
 *     - description: item.note (collection credit) + item.highlights (bullet points)
 *     - engine_size: first spec line containing "Engine" or "Cylinder(s)"
 *     - transmission: spec line containing "Transmission" or "Gearbox"
 *     - mileage: regex on highlights + note prose
 *  4. Update vehicles table
 *
 * NOTE: No HTML scraping needed — Gooding's Gatsby site has all data in
 *       /page-data/lot/{slug}/page-data.json as structured Contentful JSON.
 *
 * Input:  { batch_size?: number (default 50), dry_run?: boolean, vehicle_id?: string, force_refresh?: boolean }
 * Output: { success, stats }
 *
 * Deploy: supabase functions deploy backfill-gooding-descriptions --no-verify-jwt
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BACKFILL_VERSION = '2.0.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

// ─── Parsers ───────────────────────────────────────────────────────────────────

function parseEngineFromSpecs(specs: string[]): string | null {
  const engineKeywords = [
    /\bEngine\b/i,
    /\bCylinder(s)?\b/i,
    /\bV-\d+\b/i,
    /\bInline[-\s]\d+\b/i,
    /\bInline[-\s](Four|Six|Eight|Three|Five|Twelve)\b/i,
    /\bFlat[-\s](Four|Six|Eight)\b/i,
    /\bBHP\b/i,
    /\b\d+\s*(?:CC|CID|ci)\b/i,
    /\bV\d+\b/i,
    /\bW\d+\b/i,
  ];
  const excludeKeywords = [
    /Carburetor/i, /Injection/i, /Brakes?/i, /Suspension/i,
    /Wheelbase/i, /Gearbox/i, /Transmission/i, /Axle/i,
    /Spring/i, /Shock/i, /Chassis/i,
  ];
  for (const spec of specs) {
    const trimmed = spec.trim();
    if (!trimmed) continue;
    if (excludeKeywords.some(p => p.test(trimmed))) continue;
    if (engineKeywords.some(p => p.test(trimmed))) {
      return trimmed.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 100);
    }
  }
  return null;
}

function parseTransmissionFromSpecs(specs: string[]): string | null {
  for (const spec of specs) {
    const trimmed = spec.trim();
    if (!trimmed) continue;
    if (/\b(Transmission|Gearbox|Transaxle)\b/i.test(trimmed)) {
      return trimmed.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 100);
    }
  }
  return null;
}

function parseMileageFromText(text: string): number | null {
  if (!text) return null;
  const milesPatterns: RegExp[] = [
    /(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*[-\s]?miles?\b/i,
    /(\d{1,3}(?:,\d{3})*)\s*-mile\b/i,
    /showing\s+(?:less\s+than\s+|approximately\s+|just\s+)?([0-9,]+)\s*miles?/i,
    /driven\s+(?:no\s+more\s+than\s+|only\s+|just\s+)?([0-9,]+)\s*miles?/i,
    /odometer\s+(?:shows?|reads?|indicates?)\s+([0-9,]+)\s*miles?/i,
    /approximately\s+([0-9,]+)\s*miles?/i,
    /only\s+([0-9,]+)\s*miles?/i,
    /([0-9,]+)\s*miles?\s+(?:from\s+new|since\s+new|since\s+(?:restoration|rebuild|new))/i,
    /fewer\s+than\s+([0-9,]+)\s*miles?/i,
    /less\s+than\s+([0-9,]+)\s*miles?/i,
  ];
  for (const pattern of milesPatterns) {
    const match = text.match(pattern);
    if (match) {
      const numStr = match[match.length - 1] || match[1];
      const miles = parseInt(numStr.replace(/,/g, ''), 10);
      if (miles > 0 && miles < 5_000_000) return miles;
    }
  }
  const kmPatterns: RegExp[] = [
    /(\d{1,3}(?:,\d{3})*)\s*[-\s]?km\b/i,
    /(\d{1,3}(?:,\d{3})*)\s*kilometres?/i,
    /(\d{1,3}(?:,\d{3})*)\s*kilometers?/i,
  ];
  for (const pattern of kmPatterns) {
    const match = text.match(pattern);
    if (match) {
      const km = parseInt(match[1].replace(/,/g, ''), 10);
      if (km > 0 && km < 5_000_000) return Math.round(km * 0.621371);
    }
  }
  return null;
}

/**
 * Build a rich description from Gooding's two content sources:
 *   - item.note: collection credit or provenance note (often short or null)
 *   - highlights: array of 3-8 bullet-point facts (the primary content)
 *
 * Returns null only if both are empty.
 */
function buildDescription(note: string | null, highlights: string[]): string | null {
  const parts: string[] = [];
  const cleanNote = (note || '').replace(/<[^>]+>/g, '').trim();
  if (cleanNote.length > 20) {
    parts.push(cleanNote);
  }
  const cleanHighlights = highlights
    .map(h => h.replace(/<[^>]+>/g, '').trim())
    .filter(h => h.length > 5);
  if (cleanHighlights.length > 0) {
    parts.push(cleanHighlights.join('\n'));
  }
  if (parts.length === 0) return null;
  return parts.join('\n\n').slice(0, 5000);
}

// ─── Gooding page-data.json fetch ──────────────────────────────────────────────

interface GoodingLotData {
  specifications: string[];
  highlights: string[];
  note: string | null;
}

async function fetchGoodingLotData(slug: string): Promise<GoodingLotData | null> {
  const url = `https://www.goodingco.com/page-data/lot/${slug}/page-data.json`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, { headers: BROWSER_HEADERS, signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      console.warn(`[GOODING-BACKFILL] HTTP ${res.status} for ${url}`);
      return null;
    }
    const data = await res.json();
    const lot = data?.result?.data?.contentfulLot;
    if (!lot) return null;
    const item = lot.item;
    if (!item) return null;
    return {
      specifications: item.specifications || [],
      highlights: (item.highlights || []).map((h: string) => h.replace(/<[^>]+>/g, '').trim()).filter(Boolean),
      note: item.note || null,
    };
  } catch (err: any) {
    clearTimeout(timeout);
    console.warn(`[GOODING-BACKFILL] Fetch error for ${slug}: ${err.message}`);
    return null;
  }
}

function extractSlugFromUrl(url: string): string | null {
  const match = url.match(/goodingco\.com\/lot\/([^/?#]+)/);
  return match ? match[1] : null;
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
      batch_size = 50,
      dry_run = false,
      vehicle_id = null,
      force_refresh = false,
    } = body;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    console.log(`[GOODING-BACKFILL v${BACKFILL_VERSION}] Starting. batch_size=${batch_size}, dry_run=${dry_run}, force_refresh=${force_refresh}`);

    // Query vehicles needing backfill
    let vehicles: any[] | null = null;
    let queryError: any = null;

    if (vehicle_id) {
      // Single vehicle mode
      const res = await supabase
        .from('vehicles')
        .select('id, year, make, model, discovery_url, listing_url, description, engine_size, transmission, mileage')
        .eq('id', vehicle_id);
      vehicles = res.data;
      queryError = res.error;
    } else if (force_refresh) {
      // Re-process all Gooding vehicles
      const res = await supabase
        .from('vehicles')
        .select('id, year, make, model, discovery_url, listing_url, description, engine_size, transmission, mileage')
        .or('auction_source.eq.Gooding,auction_source.eq.gooding,discovery_source.eq.gooding,source.eq.gooding')
        .not('discovery_url', 'is', null)
        .ilike('discovery_url', '%goodingco.com%')
        .limit(batch_size);
      vehicles = res.data;
      queryError = res.error;
    } else {
      // Only vehicles missing description
      const res = await supabase
        .from('vehicles')
        .select('id, year, make, model, discovery_url, listing_url, description, engine_size, transmission, mileage')
        .or('auction_source.eq.Gooding,auction_source.eq.gooding,discovery_source.eq.gooding,source.eq.gooding')
        .is('description', null)
        .not('discovery_url', 'is', null)
        .ilike('discovery_url', '%goodingco.com%')
        .limit(batch_size);
      vehicles = res.data;
      queryError = res.error;
    }

    if (queryError) {
      console.error('[GOODING-BACKFILL] Query error:', queryError);
      return okJson({ success: false, error: queryError.message }, 500);
    }

    if (!vehicles || vehicles.length === 0) {
      return okJson({
        success: true,
        message: 'No Gooding vehicles need description backfill',
        stats: { attempted: 0, updated: 0, skipped: 0, failed: 0 },
      });
    }

    console.log(`[GOODING-BACKFILL] Found ${vehicles.length} vehicles to process`);

    const stats = {
      attempted: vehicles.length,
      updated: 0,
      skipped: 0,
      failed: 0,
      no_content: 0,
      fields_filled: { description: 0, engine_size: 0, transmission: 0, mileage: 0 },
    };
    const errors: string[] = [];
    const previews: any[] = [];

    for (const vehicle of vehicles) {
      const { id, discovery_url, year, make, model } = vehicle;
      const label = `${year} ${make} ${model} (${id.slice(0, 8)})`;

      // Use discovery_url or listing_url — prefer discovery_url
      const urlToUse = discovery_url || vehicle.listing_url;
      if (!urlToUse || !urlToUse.includes('goodingco.com')) {
        console.log(`[GOODING-BACKFILL] Skipping ${id}: no valid Gooding URL`);
        stats.skipped++;
        continue;
      }

      const slug = extractSlugFromUrl(urlToUse);
      if (!slug) {
        console.log(`[GOODING-BACKFILL] Could not extract slug from: ${urlToUse}`);
        stats.skipped++;
        continue;
      }

      console.log(`[GOODING-BACKFILL] Processing: ${label} → slug=${slug}`);

      try {
        const lotData = await fetchGoodingLotData(slug);

        if (!lotData) {
          console.warn(`[GOODING-BACKFILL] No data returned for ${label}`);
          stats.no_content++;
          errors.push(`${label}: could not fetch page-data.json`);
          continue;
        }

        const allText = [
          ...(lotData.highlights || []),
          lotData.note || '',
        ].join('\n');

        const description = buildDescription(lotData.note, lotData.highlights);
        const engineSize = parseEngineFromSpecs(lotData.specifications);
        const transmission = parseTransmissionFromSpecs(lotData.specifications);
        const mileage = parseMileageFromText(allText);

        // Build update payload — only set fields that are currently null (unless force_refresh)
        const updatePayload: Record<string, any> = {
          updated_at: new Date().toISOString(),
          extractor_version: BACKFILL_VERSION,
        };

        let willUpdate = false;

        if (description && (!vehicle.description || force_refresh)) {
          updatePayload.description = description;
          stats.fields_filled.description++;
          willUpdate = true;
        }
        if (engineSize && (!vehicle.engine_size || force_refresh)) {
          updatePayload.engine_size = engineSize;
          stats.fields_filled.engine_size++;
          willUpdate = true;
        }
        if (transmission && (!vehicle.transmission || force_refresh)) {
          updatePayload.transmission = transmission;
          stats.fields_filled.transmission++;
          willUpdate = true;
        }
        if (mileage && (!vehicle.mileage || force_refresh)) {
          updatePayload.mileage = mileage;
          stats.fields_filled.mileage++;
          willUpdate = true;
        }

        if (!willUpdate) {
          console.log(`[GOODING-BACKFILL] No new fields for ${label} (desc=${description ? 'y' : 'n'}, engine=${engineSize}, mileage=${mileage})`);
          stats.skipped++;
          continue;
        }

        if (dry_run) {
          previews.push({
            vehicle_id: id,
            label,
            slug,
            current: {
              description: vehicle.description ? vehicle.description.slice(0, 80) + '...' : null,
              engine_size: vehicle.engine_size,
              transmission: vehicle.transmission,
              mileage: vehicle.mileage,
            },
            parsed: {
              description: description ? description.slice(0, 200) + '...' : null,
              engine_size: engineSize,
              transmission,
              mileage,
            },
            highlights_count: lotData.highlights.length,
            highlights_sample: lotData.highlights.slice(0, 3),
            note: lotData.note,
            will_update: Object.keys(updatePayload).filter(k => !['updated_at', 'extractor_version'].includes(k)),
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
          console.error(`[GOODING-BACKFILL] Update failed for ${label}:`, updateError.message);
          stats.failed++;
          errors.push(`${label}: ${updateError.message}`);
        } else {
          console.log(`[GOODING-BACKFILL] Updated ${label}: desc=${description ? description.length + 'c' : 'null'}, engine=${engineSize}, mileage=${mileage}`);
          stats.updated++;
        }

        // Be respectful to the server
        await new Promise(r => setTimeout(r, 300));

      } catch (err: any) {
        console.error(`[GOODING-BACKFILL] Error for ${label}:`, err.message);
        stats.failed++;
        errors.push(`${label}: ${err.message}`);
      }
    }

    const response: any = {
      success: true,
      dry_run,
      stats,
      backfill_version: BACKFILL_VERSION,
    };

    if (errors.length > 0) {
      response.errors = errors.slice(0, 20);
    }

    if (dry_run && previews.length > 0) {
      response.previews = previews.slice(0, 10);
    }

    return okJson(response);

  } catch (error: any) {
    console.error('[GOODING-BACKFILL] Fatal error:', error);
    return okJson({ success: false, error: error.message }, 500);
  }
});

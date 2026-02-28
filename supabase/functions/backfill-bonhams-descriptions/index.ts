/**
 * backfill-bonhams-descriptions
 *
 * Backfills description (and other enrichment fields) on Bonhams vehicles that
 * were imported via catalog extraction and have never been individually scraped.
 *
 * Root cause: ~25K Bonhams vehicles were imported from auction catalog JSON-LD
 * (AggregateOffer), which gives name/year/price but NO lot description.
 * Individual lot pages (scraped with Firecrawl) contain the full description.
 *
 * Strategy:
 *  1. Query vehicles WHERE (auction_source/discovery_source = 'bonhams')
 *       AND description IS NULL
 *       AND listing_url LIKE '%bonhams%'
 *  2. Call the extract-bonhams edge function for each lot URL
 *  3. The extractor Firecrawl-renders the lot page, parses description, specs, price
 *  4. Saves back to vehicles table (description, vin/chassis, color, engine, etc.)
 *
 * Input:  { batch_size?: number (default 10), dry_run?: boolean, vehicle_id?: string }
 * Output: { success, stats }
 *
 * NOTE: Each extraction costs ~1 Firecrawl credit. Default batch of 10 is intentionally
 *       conservative — run multiple times to work through the backlog.
 *
 * Deploy: supabase functions deploy backfill-bonhams-descriptions --no-verify-jwt
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BACKFILL_VERSION = '1.0.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
      batch_size = 10,
      dry_run = false,
      vehicle_id = null,
      // Allow caller to pass specific vehicle IDs to process
      vehicle_ids = null as string[] | null,
    } = body;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    console.log(`[BONHAMS-BACKFILL v${BACKFILL_VERSION}] Starting. batch_size=${batch_size}, dry_run=${dry_run}`);

    // Query vehicles needing description backfill
    let vehicles: any[] | null = null;
    let queryError: any = null;

    if (vehicle_id) {
      const res = await supabase
        .from('vehicles')
        .select('id, year, make, model, listing_url, discovery_url, description')
        .eq('id', vehicle_id);
      vehicles = res.data;
      queryError = res.error;
    } else if (vehicle_ids && Array.isArray(vehicle_ids) && vehicle_ids.length > 0) {
      const res = await supabase
        .from('vehicles')
        .select('id, year, make, model, listing_url, discovery_url, description')
        .in('id', vehicle_ids.slice(0, batch_size));
      vehicles = res.data;
      queryError = res.error;
    } else {
      // Default: find Bonhams vehicles missing descriptions that have a valid lot URL
      const res = await supabase
        .from('vehicles')
        .select('id, year, make, model, listing_url, discovery_url, description')
        .or('auction_source.eq.Bonhams,auction_source.eq.bonhams,discovery_source.eq.bonhams')
        .is('description', null)
        .not('listing_url', 'is', null)
        .ilike('listing_url', '%bonhams%')
        .ilike('listing_url', '%/lot/%')
        .not('year', 'is', null)       // Prioritize actual vehicle records
        .limit(batch_size);
      vehicles = res.data;
      queryError = res.error;
    }

    if (queryError) {
      console.error('[BONHAMS-BACKFILL] Query error:', queryError);
      return okJson({ success: false, error: queryError.message }, 500);
    }

    if (!vehicles || vehicles.length === 0) {
      return okJson({
        success: true,
        message: 'No Bonhams vehicles need description backfill',
        stats: { attempted: 0, updated: 0, skipped: 0, failed: 0 },
      });
    }

    console.log(`[BONHAMS-BACKFILL] Found ${vehicles.length} vehicles to process`);

    if (dry_run) {
      return okJson({
        success: true,
        dry_run: true,
        message: `Would process ${vehicles.length} Bonhams vehicles`,
        sample: vehicles.slice(0, 5).map(v => ({
          id: v.id,
          vehicle: `${v.year} ${v.make} ${v.model}`,
          url: v.listing_url || v.discovery_url,
        })),
      });
    }

    const stats = {
      attempted: vehicles.length,
      updated: 0,
      skipped: 0,
      failed: 0,
      description_filled: 0,
    };
    const errors: string[] = [];
    const results: any[] = [];

    for (const vehicle of vehicles) {
      const { id, year, make, model } = vehicle;
      const label = `${year} ${make} ${model} (${id.slice(0, 8)})`;
      const url = vehicle.listing_url || vehicle.discovery_url;

      if (!url || !url.includes('bonhams.com') || !url.includes('/lot/')) {
        console.log(`[BONHAMS-BACKFILL] Skipping ${id}: invalid URL: ${url}`);
        stats.skipped++;
        continue;
      }

      console.log(`[BONHAMS-BACKFILL] Processing: ${label} → ${url}`);

      try {
        // Call the extract-bonhams function to do the heavy lifting (Firecrawl + parse + save)
        const extractRes = await fetch(
          `${supabaseUrl}/functions/v1/extract-bonhams`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${serviceKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              url,
              save_to_db: true,
              vehicle_id: id,  // Pass the vehicle_id so it updates the existing record
            }),
          }
        );

        if (!extractRes.ok) {
          const errText = await extractRes.text();
          throw new Error(`extract-bonhams returned HTTP ${extractRes.status}: ${errText.slice(0, 200)}`);
        }

        const extractData = await extractRes.json();

        if (!extractData.success) {
          throw new Error(`extract-bonhams failed: ${extractData.error || 'unknown error'}`);
        }

        const extracted = extractData.extracted;
        const didSave = extractData._db || extractData.save_result;

        // Check if description was extracted
        const hasDesc = extracted?.description && extracted.description.length > 50;
        if (hasDesc) {
          stats.description_filled++;
        }

        stats.updated++;
        results.push({
          vehicle_id: id,
          label,
          description_length: extracted?.description?.length || 0,
          action: didSave?.action || 'saved',
          quality_score: extractData._db?.quality_score,
        });

        console.log(`[BONHAMS-BACKFILL] Done: ${label} — desc=${extracted?.description?.length || 0}c, action=${didSave?.action || 'saved'}`);

      } catch (err: any) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[BONHAMS-BACKFILL] Error for ${label}:`, msg);
        stats.failed++;
        errors.push(`${label}: ${msg.slice(0, 150)}`);
      }

      // Throttle: 1 request per second to avoid overwhelming Firecrawl
      await new Promise(r => setTimeout(r, 1000));
    }

    const response: any = {
      success: true,
      dry_run: false,
      stats,
      backfill_version: BACKFILL_VERSION,
    };

    if (results.length > 0) {
      response.results = results;
    }

    if (errors.length > 0) {
      response.errors = errors.slice(0, 20);
    }

    return okJson(response);

  } catch (error: any) {
    console.error('[BONHAMS-BACKFILL] Fatal error:', error);
    return okJson({ success: false, error: error.message }, 500);
  }
});

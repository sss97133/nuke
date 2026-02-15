/**
 * ENRICH VEHICLES CRON
 *
 * Server-side cron function that enriches vehicles by calling
 * the dedicated source extractors. Runs autonomously via pg_cron.
 *
 * Each invocation processes a small batch (5 vehicles) from one source,
 * alternating between sources. Designed to run every 2-3 minutes.
 *
 * Tracks progress via vehicles.last_enrichment_attempt and
 * vehicles.enrichment_failures columns.
 *
 * Manual trigger:
 *   curl -X POST $SUPABASE_URL/functions/v1/enrich-vehicles-cron \
 *     -H "Authorization: Bearer $SERVICE_KEY" \
 *     -H "Content-Type: application/json" \
 *     -d '{"source": "mecum", "limit": 5}'
 *
 * Stats:
 *   curl -X POST ... -d '{"action": "stats"}'
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function okJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SOURCES = ["mecum", "barrett-jackson", "bonhams", "collecting_cars"] as const;

const SOURCE_TO_EXTRACTOR: Record<string, string> = {
  mecum: "extract-mecum",
  "barrett-jackson": "extract-barrett-jackson",
  bonhams: "extract-bonhams",
  collecting_cars: "extract-collecting-cars",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body =
      req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body.action || "enrich";

    // Stats action — show enrichment progress
    if (action === "stats") {
      const { data: stats } = await supabase.rpc("execute_sql", {
        query: `
          SELECT
            discovery_source,
            count(*) as total,
            count(*) FILTER (WHERE last_enrichment_attempt IS NOT NULL) as attempted,
            count(*) FILTER (WHERE enrichment_failures >= 3) as permanently_failed,
            count(*) FILTER (WHERE vin IS NOT NULL AND color IS NOT NULL AND description IS NOT NULL AND transmission IS NOT NULL) as fully_enriched
          FROM vehicles
          WHERE deleted_at IS NULL
            AND discovery_source IN ('mecum', 'barrett-jackson', 'bonhams', 'collecting_cars')
          GROUP BY discovery_source
          ORDER BY total DESC
        `,
      });

      return okJson({ success: true, stats });
    }

    // Pick source: explicit or round-robin based on minute
    let source = body.source as string | undefined;
    if (!source) {
      // Alternate based on current minute
      const minute = new Date().getMinutes();
      source = SOURCES[minute % SOURCES.length];
    }

    const extractor = SOURCE_TO_EXTRACTOR[source];
    if (!extractor) {
      return okJson(
        { success: false, error: `Unknown source: ${source}` },
        400
      );
    }

    const limit = Math.min(Number(body.limit) || 5, 20);

    console.log(`[CRON] Enriching ${limit} ${source} vehicles via ${extractor}`);

    // Call the extractor's re_enrich action
    const resp = await fetch(`${supabaseUrl}/functions/v1/${extractor}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "re_enrich",
        limit,
      }),
      signal: AbortSignal.timeout(280000), // 4m40s — leave margin within 5min edge function limit
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error(`[CRON] ${extractor} returned ${resp.status}: ${text.slice(0, 200)}`);
      return okJson({
        success: false,
        source,
        error: `${extractor} returned ${resp.status}`,
        detail: text.slice(0, 200),
        duration_ms: Date.now() - startTime,
      });
    }

    const result = await resp.json();
    const duration = Date.now() - startTime;

    console.log(
      `[CRON] ${source}: ${result.success ? "OK" : "FAIL"} — ` +
        `${result.success_count || result.success || 0} enriched, ` +
        `${result.failed || 0} failed, ` +
        `${result.fields_added || 0} fields added (${duration}ms)`
    );

    return okJson({
      success: true,
      source,
      extractor,
      result,
      duration_ms: duration,
    });
  } catch (e: unknown) {
    const msg =
      e instanceof Error
        ? e.message
        : typeof e === "object" && e !== null
          ? JSON.stringify(e)
          : String(e);
    console.error("[CRON] Error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

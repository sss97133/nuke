/**
 * DATA-NORMALIZE-MAKES
 *
 * Runs normalize_all_makes_batch() to standardize vehicle make casing,
 * then backfills canonical_make_id for all vehicles.
 *
 * POST /functions/v1/data-normalize-makes
 * Body: { "dry_run"?: boolean }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const dryRun = body.dry_run ?? false;

    console.log(`[data-normalize-makes] Starting. dry_run=${dryRun}`);

    // Step 1: Preview what needs normalization
    const { data: preview } = await supabase.rpc("execute_sql", {
      query: `
        SELECT
          cm.canonical_name,
          cm.variants,
          (SELECT count(*) FROM vehicles v WHERE v.make = ANY(cm.variants) AND v.deleted_at IS NULL) as rows_to_update
        FROM canonical_makes cm
        WHERE EXISTS (
          SELECT 1 FROM vehicles v WHERE v.make = ANY(cm.variants) AND v.deleted_at IS NULL LIMIT 1
        )
        ORDER BY canonical_name
      `,
    });

    // Check canonical_make_id gaps
    const { data: idGaps } = await supabase.rpc("execute_sql", {
      query: `
        SELECT count(*) as missing_canonical_id
        FROM vehicles v
        WHERE v.deleted_at IS NULL AND v.make IS NOT NULL AND v.canonical_make_id IS NULL
      `,
    });

    if (dryRun) {
      return new Response(
        JSON.stringify({
          dry_run: true,
          normalization_preview: preview ?? [],
          missing_canonical_make_id: idGaps?.[0]?.missing_canonical_id ?? "unknown",
        }, null, 2),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 2: Run batch normalization via the existing SQL function
    const { data: batchResult, error: batchErr } = await supabase.rpc(
      "normalize_all_makes_batch",
      { batch_limit: 50000 }
    );

    if (batchErr) throw batchErr;

    console.log(`[data-normalize-makes] Batch normalization complete`);

    // Step 3: Backfill canonical_make_id using execute_sql for read, then supabase client for write
    // First find vehicles missing canonical_make_id
    const { data: unmatchedMakes } = await supabase.rpc("execute_sql", {
      query: `
        SELECT DISTINCT v.make
        FROM vehicles v
        LEFT JOIN canonical_makes cm ON v.make = cm.canonical_name
        WHERE v.deleted_at IS NULL
          AND v.make IS NOT NULL
          AND v.canonical_make_id IS NULL
          AND cm.id IS NOT NULL
        LIMIT 100
      `,
    });

    // Do the backfill using canonical_make_id = cm.id via individual updates per make
    let backfillCount = 0;
    const { data: canonicalMakes } = await supabase
      .from("canonical_makes")
      .select("id, canonical_name");

    if (canonicalMakes) {
      for (const cm of canonicalMakes) {
        const { count } = await supabase
          .from("vehicles")
          .update({ canonical_make_id: cm.id, updated_at: new Date().toISOString() })
          .eq("make", cm.canonical_name)
          .is("canonical_make_id", null)
          .is("deleted_at", null);

        if (count && count > 0) backfillCount += count;
      }
    }

    // Step 4: Auto-create canonical entries for unmapped makes (>10 vehicles)
    const { data: unmapped } = await supabase.rpc("execute_sql", {
      query: `
        SELECT v.make, count(*) as cnt
        FROM vehicles v
        LEFT JOIN canonical_makes cm ON v.make = cm.canonical_name
        WHERE v.deleted_at IS NULL AND v.make IS NOT NULL AND cm.id IS NULL
        GROUP BY v.make
        ORDER BY count(*) DESC
        LIMIT 50
      `,
    });

    let autoCreated = 0;
    if (unmapped && Array.isArray(unmapped)) {
      const toCreate = unmapped.filter((m: any) => Number(m.cnt) >= 10);
      for (const m of toCreate) {
        const { error } = await supabase
          .from("canonical_makes")
          .insert({
            canonical_name: m.make,
            variants: [m.make.toLowerCase()],
          })
          .single();

        if (!error) {
          autoCreated++;
          // Also backfill canonical_make_id for this make
          const { data: newCm } = await supabase
            .from("canonical_makes")
            .select("id")
            .eq("canonical_name", m.make)
            .single();

          if (newCm) {
            await supabase
              .from("vehicles")
              .update({ canonical_make_id: newCm.id, updated_at: new Date().toISOString() })
              .eq("make", m.make)
              .is("canonical_make_id", null)
              .is("deleted_at", null);
          }
        }
      }
    }

    // Step 5: Final stats
    const { data: finalStats } = await supabase.rpc("execute_sql", {
      query: `
        SELECT
          count(*) FILTER (WHERE canonical_make_id IS NOT NULL) as has_canonical_id,
          count(*) FILTER (WHERE canonical_make_id IS NULL AND make IS NOT NULL) as missing_canonical_id,
          count(DISTINCT make) as distinct_makes,
          (SELECT count(*) FROM canonical_makes) as canonical_makes_count
        FROM vehicles
        WHERE deleted_at IS NULL
      `,
    });

    return new Response(
      JSON.stringify({
        success: true,
        normalization: batchResult,
        canonical_id_backfill: backfillCount,
        auto_created_canonical_makes: autoCreated,
        unmapped_makes: Array.isArray(unmapped) ? unmapped.slice(0, 20) : [],
        final_stats: finalStats?.[0] ?? {},
      }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("[data-normalize-makes] Error:", e);
    return new Response(
      JSON.stringify({ error: e.message, stack: e.stack }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

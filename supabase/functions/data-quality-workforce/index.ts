/**
 * DATA QUALITY WORKFORCE
 *
 * Always-on enrichment orchestrator. Reads latest data_quality_snapshots and
 * fires enrichment functions in priority order.
 * Called every 5 minutes by pg_cron.
 *
 * Priority:
 * 1. batch-vin-decode   — FREE, fills 12 fields for VINs we have
 * 2. batch-ymm-propagate — FREE, multiplicative leverage
 * 3. enrich-bulk:mine_descriptions — FREE, regex from listing text
 * 4. enrich-bulk:derive_fields — FREE, decade/country/body_style
 * 5. enrich-factory-specs — LLM $$, gated by ENRICHMENT_LLM_ENABLED
 * 6. enrich-vehicle-profile-ai — LLM $$$, gated by ENRICHMENT_LLM_ENABLED
 * 7. compute-vehicle-valuation — FREE, needs data first
 *
 * POST /functions/v1/data-quality-workforce
 * Body: { "dry_run": boolean, "strategy": string (optional, run just one) }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface WorkforceResult {
  strategy: string;
  status: "fired" | "skipped" | "error";
  reason?: string;
  response?: any;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const targetStrategy = body.strategy || null; // run just one strategy if specified

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const llmEnabled = Deno.env.get("ENRICHMENT_LLM_ENABLED") === "true";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Helper to invoke an edge function
    async function invokeFunction(name: string, body: Record<string, any>): Promise<any> {
      if (dryRun) {
        return { dry_run: true, would_invoke: name, body };
      }
      const res = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`${name} returned ${res.status}: ${text.slice(0, 200)}`);
      }
      return res.json().catch(() => ({ ok: true }));
    }

    // Get latest snapshot
    const { data: snapshots } = await supabase
      .from("data_quality_snapshots")
      .select("field_stats, captured_at, total_vehicles")
      .order("captured_at", { ascending: false })
      .limit(1);

    const latestSnapshot = snapshots?.[0];
    const fieldStats = (latestSnapshot?.field_stats || {}) as Record<string, number>;
    const totalVehicles = latestSnapshot?.total_vehicles || 1_200_000;

    // Determine which fields need work
    const vinPct = fieldStats["vin"] ?? 18;
    const hpPct = fieldStats["horsepower"] ?? 8;
    const mileagePct = fieldStats["mileage"] ?? 17;
    const cityPct = fieldStats["city"] ?? 3;
    const dealScorePct = fieldStats["deal_score"] ?? 1;
    const makePct = fieldStats["make"] ?? 98;

    const results: WorkforceResult[] = [];

    // Strategy 1: VIN decode (FREE) — always run if VIN < 95%
    if (!targetStrategy || targetStrategy === "batch-vin-decode") {
      if (vinPct < 95) {
        try {
          const resp = await invokeFunction("batch-vin-decode", {
            batch_size: 500,
            dry_run: dryRun,
          });
          results.push({ strategy: "batch-vin-decode", status: "fired", response: resp });
        } catch (e) {
          results.push({ strategy: "batch-vin-decode", status: "error", reason: String(e) });
        }
      } else {
        results.push({ strategy: "batch-vin-decode", status: "skipped", reason: `VIN already at ${vinPct}%` });
      }
    }

    // Strategy 2: YMM propagate (FREE) — always run
    if (!targetStrategy || targetStrategy === "batch-ymm-propagate") {
      try {
        const resp = await invokeFunction("batch-ymm-propagate", {
          batch_size: 500,
          dry_run: dryRun,
        });
        results.push({ strategy: "batch-ymm-propagate", status: "fired", response: resp });
      } catch (e) {
        results.push({ strategy: "batch-ymm-propagate", status: "error", reason: String(e) });
      }
    }

    // Strategy 3: Mine descriptions (FREE)
    if (!targetStrategy || targetStrategy === "mine_descriptions") {
      try {
        const resp = await invokeFunction("enrich-bulk", {
          strategy: "mine_descriptions",
          batch_size: 200,
          dry_run: dryRun,
        });
        results.push({ strategy: "mine_descriptions", status: "fired", response: resp });
      } catch (e) {
        results.push({ strategy: "mine_descriptions", status: "error", reason: String(e) });
      }
    }

    // Strategy 4: Derive fields (FREE)
    if (!targetStrategy || targetStrategy === "derive_fields") {
      try {
        const resp = await invokeFunction("enrich-bulk", {
          strategy: "derive_fields",
          batch_size: 200,
          dry_run: dryRun,
        });
        results.push({ strategy: "derive_fields", status: "fired", response: resp });
      } catch (e) {
        results.push({ strategy: "derive_fields", status: "error", reason: String(e) });
      }
    }

    // Strategy 5: Factory specs (LLM $$) — gated by ENRICHMENT_LLM_ENABLED
    if (!targetStrategy || targetStrategy === "enrich-factory-specs") {
      if (llmEnabled && hpPct < 70) {
        try {
          const resp = await invokeFunction("enrich-factory-specs", {
            batch_size: 50,
            dry_run: dryRun,
          });
          results.push({ strategy: "enrich-factory-specs", status: "fired", response: resp });
        } catch (e) {
          results.push({ strategy: "enrich-factory-specs", status: "error", reason: String(e) });
        }
      } else {
        const reason = !llmEnabled
          ? "LLM disabled (set ENRICHMENT_LLM_ENABLED=true to enable)"
          : `horsepower already at ${hpPct}%`;
        results.push({ strategy: "enrich-factory-specs", status: "skipped", reason });
      }
    }

    // Strategy 6: Vehicle profile AI (LLM $$$) — gated by ENRICHMENT_LLM_ENABLED
    if (!targetStrategy || targetStrategy === "enrich-vehicle-profile-ai") {
      if (llmEnabled && (mileagePct < 60 || cityPct < 30)) {
        try {
          const resp = await invokeFunction("enrich-vehicle-profile-ai", {
            batch_size: 20,
            dry_run: dryRun,
          });
          results.push({ strategy: "enrich-vehicle-profile-ai", status: "fired", response: resp });
        } catch (e) {
          results.push({ strategy: "enrich-vehicle-profile-ai", status: "error", reason: String(e) });
        }
      } else {
        const reason = !llmEnabled
          ? "LLM disabled (set ENRICHMENT_LLM_ENABLED=true to enable)"
          : "mileage and location already sufficient";
        results.push({ strategy: "enrich-vehicle-profile-ai", status: "skipped", reason });
      }
    }

    // Strategy 7: Vehicle valuation (FREE) — run when we have enough data
    if (!targetStrategy || targetStrategy === "compute-vehicle-valuation") {
      if (makePct > 80 && dealScorePct < 80) {
        try {
          const resp = await invokeFunction("compute-vehicle-valuation", {
            batch_size: 100,
            dry_run: dryRun,
          });
          results.push({ strategy: "compute-vehicle-valuation", status: "fired", response: resp });
        } catch (e) {
          results.push({ strategy: "compute-vehicle-valuation", status: "error", reason: String(e) });
        }
      } else {
        results.push({
          strategy: "compute-vehicle-valuation",
          status: "skipped",
          reason: dealScorePct >= 80
            ? `deal_score already at ${dealScorePct}%`
            : `insufficient base data (make: ${makePct}%)`
        });
      }
    }

    // Summary
    const fired = results.filter(r => r.status === "fired").length;
    const errors = results.filter(r => r.status === "error").length;

    return new Response(
      JSON.stringify({
        results,
        summary: {
          strategies_fired: fired,
          strategies_skipped: results.filter(r => r.status === "skipped").length,
          errors,
          dry_run: dryRun,
          llm_enabled: llmEnabled,
          current_gaps: {
            vin: `${vinPct}%`,
            horsepower: `${hpPct}%`,
            mileage: `${mileagePct}%`,
            city: `${cityPct}%`,
            deal_score: `${dealScorePct}%`,
          },
          snapshot_age_minutes: latestSnapshot
            ? Math.round((Date.now() - new Date(latestSnapshot.captured_at).getTime()) / 60000)
            : null,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("data-quality-workforce error:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

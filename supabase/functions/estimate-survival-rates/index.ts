/**
 * ESTIMATE SURVIVAL RATES
 *
 * Three estimation methods for how many of a given make/model/generation survive:
 * 1. Registry data - direct count from vehicle_production_data
 * 2. Listing frequency proxy - unique VINs seen / estimated annual listing rate
 * 3. Decay model fallback - exponential decay with collector preservation factor
 *
 * Runs weekly via cron (called by compute-feed-scores orchestrator).
 *
 * POST /functions/v1/estimate-survival-rates
 * Body: {
 *   "make"?: string,    // Optional: limit to specific make
 *   "limit"?: number,   // Max groups to process (default 200)
 *   "dry_run"?: boolean
 * }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function getGenerationBucket(year: number): { year_start: number; year_end: number } {
  const bucketStart = Math.floor(year / 5) * 5;
  return { year_start: bucketStart, year_end: bucketStart + 4 };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const filterMake = body.make || null;
    const maxGroups = Math.min(body.limit ?? 200, 1000);
    const dryRun = body.dry_run || false;

    // Get unique make/model/year combos from our vehicle data
    let vehicleQuery = supabase
      .from("vehicles")
      .select("make, model, year, vin")
      .not("make", "is", null)
      .not("model", "is", null)
      .not("year", "is", null)
      .is("deleted_at", null);

    if (filterMake) {
      vehicleQuery = vehicleQuery.ilike("make", filterMake);
    }

    const { data: vehicles, error: vErr } = await vehicleQuery.limit(10000);

    if (vErr) throw new Error(`Query error: ${vErr.message}`);
    if (!vehicles || vehicles.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No vehicles found", estimated: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Group vehicles by make/model/generation
    const groups: Record<string, {
      make: string;
      model: string;
      year_start: number;
      year_end: number;
      uniqueVins: Set<string>;
      vehicleCount: number;
      years: Set<number>;
    }> = {};

    for (const v of vehicles) {
      if (!v.make || !v.model || !v.year) continue;
      const { year_start, year_end } = getGenerationBucket(v.year);
      const key = `${v.make}|${v.model}|${year_start}-${year_end}`;

      if (!groups[key]) {
        groups[key] = {
          make: v.make,
          model: v.model,
          year_start,
          year_end,
          uniqueVins: new Set(),
          vehicleCount: 0,
          years: new Set(),
        };
      }

      groups[key].vehicleCount++;
      groups[key].years.add(v.year);
      if (v.vin) groups[key].uniqueVins.add(v.vin);
    }

    // Fetch production data for matching groups
    const { data: prodData } = await supabase
      .from("vehicle_production_data")
      .select("make, model, year, total_produced, collector_demand_score, rarity_level");

    const prodMap: Record<string, any> = {};
    for (const p of prodData || []) {
      const { year_start, year_end } = getGenerationBucket(p.year);
      const key = `${p.make}|${p.model}|${year_start}-${year_end}`;
      if (!prodMap[key]) {
        prodMap[key] = { total_produced: 0, demand_scores: [], rarity_levels: [] };
      }
      prodMap[key].total_produced += p.total_produced || 0;
      if (p.collector_demand_score) prodMap[key].demand_scores.push(p.collector_demand_score);
      if (p.rarity_level) prodMap[key].rarity_levels.push(p.rarity_level);
    }

    const groupList = Object.values(groups).slice(0, maxGroups);
    const estimates: any[] = [];

    for (const g of groupList) {
      const key = `${g.make}|${g.model}|${g.year_start}-${g.year_end}`;
      const prod = prodMap[key];

      let totalProduced = prod?.total_produced || null;
      let estimatedSurviving: number;
      let survivalRate: number;
      let method: string;
      let confidence = 30;
      const proxySignals: Record<string, any> = {
        unique_vins_seen: g.uniqueVins.size,
        vehicle_count_in_db: g.vehicleCount,
        year_range: `${g.year_start}-${g.year_end}`,
      };

      // Method 1: Registry data (if we have production numbers)
      if (totalProduced && totalProduced > 0) {
        const avgDemandScore = prod.demand_scores.length > 0
          ? prod.demand_scores.reduce((s: number, d: number) => s + d, 0) / prod.demand_scores.length
          : 5;

        // Collector preservation factor
        let preservationFactor = 1.0;
        if (avgDemandScore >= 8) preservationFactor = 3.0;
        else if (avgDemandScore >= 6) preservationFactor = 2.0;
        else if (avgDemandScore >= 4) preservationFactor = 1.5;

        // Age-based decay
        const midYear = (g.year_start + g.year_end) / 2;
        const age = new Date().getFullYear() - midYear;
        const decayRate = 0.035;
        const baseSurvival = Math.exp(-decayRate * age);
        survivalRate = Math.min(baseSurvival * preservationFactor, 1.0);
        estimatedSurviving = Math.round(totalProduced * survivalRate);
        method = "registry_data";
        confidence = 60;
        proxySignals.demand_score = avgDemandScore;
        proxySignals.preservation_factor = preservationFactor;
      }
      // Method 2: Listing frequency proxy
      else if (g.uniqueVins.size >= 3) {
        // Estimate: we see ~5% of surviving vehicles listed per year
        const listingRate = 0.05;
        estimatedSurviving = Math.round(g.uniqueVins.size / listingRate);

        // Try to infer total produced from surviving estimate + decay
        const midYear = (g.year_start + g.year_end) / 2;
        const age = new Date().getFullYear() - midYear;
        const estimatedDecayRate = 0.035;
        survivalRate = Math.exp(-estimatedDecayRate * age);
        totalProduced = Math.round(estimatedSurviving / Math.max(survivalRate, 0.01));
        survivalRate = estimatedSurviving / Math.max(totalProduced, 1);

        method = "listing_frequency";
        confidence = 40;
        proxySignals.listing_rate_assumed = listingRate;
      }
      // Method 3: Decay model fallback
      else {
        const midYear = (g.year_start + g.year_end) / 2;
        const age = new Date().getFullYear() - midYear;
        const decayRate = 0.035;
        survivalRate = Math.exp(-decayRate * age);

        // Without production numbers, estimate loosely from vehicle count
        estimatedSurviving = Math.max(g.vehicleCount * 20, 100);
        totalProduced = Math.round(estimatedSurviving / Math.max(survivalRate, 0.01));

        method = "decay_model";
        confidence = 20;
        proxySignals.age_years = age;
        proxySignals.decay_rate = decayRate;
      }

      estimates.push({
        make: g.make,
        model: g.model,
        year_start: g.year_start,
        year_end: g.year_end,
        total_produced: totalProduced,
        estimated_surviving: estimatedSurviving,
        survival_rate: Math.round(survivalRate * 10000) / 10000,
        estimation_method: method,
        proxy_signals: proxySignals,
        confidence_score: confidence,
      });
    }

    if (dryRun) {
      return new Response(
        JSON.stringify({
          success: true,
          dry_run: true,
          groups_found: estimates.length,
          estimates: estimates.slice(0, 30),
        }, null, 2),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Upsert estimates
    let upserted = 0;
    let errors = 0;
    for (const est of estimates) {
      const { error } = await supabase
        .from("survival_rate_estimates")
        .upsert(est, { onConflict: "make,model,year_start,year_end" });
      if (error) {
        console.error(`[survival-rates] Upsert error for ${est.make} ${est.model}:`, error);
        errors++;
      } else {
        upserted++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        groups_processed: estimates.length,
        upserted,
        errors,
        sample: estimates.slice(0, 10),
      }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("[estimate-survival-rates] Error:", e);
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

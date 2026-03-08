/**
 * WIDGET: COMPLETION DISCOUNT CALCULATOR
 *
 * When a vehicle has known deficiencies (paint, interior, mechanical),
 * calculates the discount buyers will apply vs comparable completed cars.
 *
 * Buyer discount = known repair costs * 1.3 (contingency)
 *                + unknown scope penalty (if few documented issues)
 *                + carrying cost estimate
 *
 * POST /functions/v1/widget-completion-discount
 * { "vehicle_id": "uuid" }
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getSupabase() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

// Common deficiency keywords and estimated costs
const DEFICIENCY_KEYWORDS: Record<string, { area: string; cost_range: [number, number] }> = {
  "needs paint": { area: "paint", cost_range: [3000, 15000] },
  "paint cracks": { area: "paint", cost_range: [2000, 8000] },
  "surface rust": { area: "body", cost_range: [1000, 5000] },
  "rust": { area: "body", cost_range: [2000, 10000] },
  "needs interior": { area: "interior", cost_range: [2000, 8000] },
  "torn seats": { area: "interior", cost_range: [800, 3000] },
  "worn carpet": { area: "interior", cost_range: [400, 1500] },
  "cracked dash": { area: "interior", cost_range: [500, 2000] },
  "needs top": { area: "convertible_top", cost_range: [1500, 5000] },
  "top needs": { area: "convertible_top", cost_range: [1500, 5000] },
  "leaks oil": { area: "mechanical", cost_range: [500, 3000] },
  "needs tune": { area: "mechanical", cost_range: [300, 1000] },
  "transmission issue": { area: "mechanical", cost_range: [1500, 5000] },
  "needs tires": { area: "tires", cost_range: [800, 2400] },
  "needs brakes": { area: "mechanical", cost_range: [500, 2000] },
  "project": { area: "general", cost_range: [5000, 30000] },
  "barn find": { area: "general", cost_range: [5000, 25000] },
  "as-is": { area: "general", cost_range: [2000, 10000] },
  "not running": { area: "mechanical", cost_range: [2000, 8000] },
  "non-running": { area: "mechanical", cost_range: [2000, 8000] },
  "incomplete": { area: "general", cost_range: [3000, 15000] },
};

function detectDeficiencies(
  text: string
): Array<{ area: string; keyword: string; estimated_cost: number }> {
  const lower = text.toLowerCase();
  const found: Array<{ area: string; keyword: string; estimated_cost: number }> = [];
  const seenAreas = new Set<string>();

  for (const [keyword, config] of Object.entries(DEFICIENCY_KEYWORDS)) {
    if (lower.includes(keyword) && !seenAreas.has(config.area)) {
      seenAreas.add(config.area);
      found.push({
        area: config.area,
        keyword,
        estimated_cost: Math.round(
          (config.cost_range[0] + config.cost_range[1]) / 2
        ),
      });
    }
  }

  return found;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { vehicle_id } = await req.json();
    if (!vehicle_id) return json(400, { error: "vehicle_id required" });

    const supabase = getSupabase();

    // Get vehicle with description/highlights
    const { data: vehicle } = await supabase
      .from("vehicles")
      .select("id, year, make, model, era, description, highlights, asking_price, sale_price, nuke_estimate, condition_rating")
      .eq("id", vehicle_id)
      .single();

    if (!vehicle) return json(404, { error: "Vehicle not found" });

    // Check for condition-related observations
    const { data: conditionObs } = await supabase
      .from("vehicle_observations")
      .select("content_text, structured_data, kind")
      .eq("vehicle_id", vehicle_id)
      .in("kind", ["condition_report", "work_record", "inspection"])
      .limit(20);

    // Build text corpus for deficiency detection
    let textCorpus = [
      vehicle.description ?? "",
      vehicle.highlights ?? "",
    ].join(" ");

    for (const obs of conditionObs ?? []) {
      if (obs.content_text) textCorpus += " " + obs.content_text;
      if (obs.structured_data?.notes) textCorpus += " " + obs.structured_data.notes;
    }

    // Check deal_jackets for reconditioning items
    const { data: reconItems } = await supabase
      .from("deal_reconditioning")
      .select("description, amount, vendor_name, status")
      .eq("vehicle_id", vehicle_id);

    // Detect deficiencies from text
    const deficiencies = detectDeficiencies(textCorpus);

    // Add reconditioning items as known deficiencies
    for (const item of reconItems ?? []) {
      if (item.status !== "completed" && item.amount) {
        deficiencies.push({
          area: "reconditioning",
          keyword: item.description ?? "recon item",
          estimated_cost: Number(item.amount),
        });
      }
    }

    // If no deficiencies found, vehicle appears complete
    if (deficiencies.length === 0) {
      return json(200, {
        score: 90,
        severity: "ok",
        headline: "No significant deficiencies detected — vehicle appears complete",
        details: {
          deficiency_count: 0,
          deficiencies: [],
          total_repair_estimate: 0,
          buyer_discount: 0,
          sources_checked: {
            description: !!vehicle.description,
            highlights: !!vehicle.highlights,
            condition_observations: conditionObs?.length ?? 0,
            reconditioning_items: reconItems?.length ?? 0,
          },
          vehicle: { year: vehicle.year, make: vehicle.make, model: vehicle.model },
        },
        reasons: ["No significant deficiencies detected — vehicle appears complete"],
        confidence: textCorpus.length > 200 ? 0.75 : 0.4,
        recommendations: [],
      });
    }

    // Calculate buyer discount
    const totalRepairEstimate = deficiencies.reduce(
      (s, d) => s + d.estimated_cost,
      0
    );

    const contingencyMultiplier = 1.3; // Buyers add 30%
    const buyerContingency = Math.round(totalRepairEstimate * 0.3);

    // Unknown scope penalty: if few documented issues, buyers assume more lurks
    const unknownScopePenalty =
      deficiencies.length < 3
        ? Math.round((vehicle.asking_price || vehicle.nuke_estimate || 50000) * 0.10)
        : 0;

    // Carrying cost estimate (6 months at 8% annual)
    const vehicleValue = vehicle.asking_price || vehicle.nuke_estimate || 50000;
    const carryingCost = Math.round(vehicleValue * 0.08 * 0.5); // 6 months

    const totalBuyerDiscount =
      Math.round(totalRepairEstimate * contingencyMultiplier) +
      unknownScopePenalty +
      carryingCost;

    const fairAskingPrice = Math.round(vehicleValue - totalBuyerDiscount);
    const currentAsk = Number(vehicle.asking_price) || 0;
    const overpricedBy = currentAsk > 0 ? Math.max(0, currentAsk - fairAskingPrice) : 0;
    const overpricedPct = currentAsk > 0 ? Math.round((overpricedBy / currentAsk) * 100) : 0;

    // Score based on overpricing relative to condition
    let score: number;
    if (overpricedPct <= 0 || currentAsk === 0) score = 75;
    else if (overpricedPct <= 5) score = 65;
    else if (overpricedPct <= 10) score = 50;
    else if (overpricedPct <= 20) score = 30;
    else score = 15;

    // Adjust score down for more deficiencies
    score = Math.max(5, score - deficiencies.length * 5);

    const severity =
      score >= 60 ? "ok" : score >= 35 ? "warning" : "critical";

    const headline =
      overpricedBy > 0
        ? `Buyers will discount $${totalBuyerDiscount.toLocaleString()} for ${deficiencies.length} deficienc${deficiencies.length === 1 ? "y" : "ies"} — overpriced by $${overpricedBy.toLocaleString()}`
        : `${deficiencies.length} deficienc${deficiencies.length === 1 ? "y" : "ies"} detected — estimated buyer discount: $${totalBuyerDiscount.toLocaleString()}`;

    // Recommendations: ROI of fixing each deficiency
    const recommendations = deficiencies
      .sort((a, b) => b.estimated_cost - a.estimated_cost)
      .slice(0, 3)
      .map((def, i) => {
        const fixCost = def.estimated_cost;
        const discountRemoved = Math.round(fixCost * contingencyMultiplier);
        const roi = Math.round(((discountRemoved - fixCost) / fixCost) * 100);
        return {
          action: `Fix ${def.area} (${def.keyword})`,
          priority: i + 1,
          rationale: `Costs ~$${fixCost.toLocaleString()} to fix but removes $${discountRemoved.toLocaleString()} of buyer discount (${roi}% ROI including contingency removal).`,
        };
      });

    if (currentAsk > 0 && overpricedBy > 0) {
      recommendations.push({
        action: `Reduce asking to ~$${fairAskingPrice.toLocaleString()} or complete repairs`,
        priority: 1,
        rationale: `Current ask of $${currentAsk.toLocaleString()} is $${overpricedBy.toLocaleString()} above fair value for current condition.`,
      });
    }

    return json(200, {
      score,
      severity,
      headline,
      details: {
        deficiency_count: deficiencies.length,
        deficiencies,
        total_repair_estimate: totalRepairEstimate,
        buyer_contingency: buyerContingency,
        unknown_scope_penalty: unknownScopePenalty,
        carrying_cost_estimate: carryingCost,
        total_buyer_discount: totalBuyerDiscount,
        fair_asking_for_condition: fairAskingPrice,
        current_asking: currentAsk || null,
        overpriced_by: overpricedBy,
        overpriced_pct: overpricedPct,
        sources_checked: {
          description: !!vehicle.description,
          highlights: !!vehicle.highlights,
          condition_observations: conditionObs?.length ?? 0,
          reconditioning_items: reconItems?.length ?? 0,
        },
        vehicle: {
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          condition_rating: vehicle.condition_rating,
          nuke_estimate: vehicle.nuke_estimate,
        },
      },
      reasons: [headline],
      confidence: deficiencies.length > 0 ? 0.65 : 0.4,
      recommendations,
    });
  } catch (err: any) {
    console.error("Widget completion-discount error:", err);
    return json(500, { error: err.message });
  }
});

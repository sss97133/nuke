/**
 * WIDGET: COMMISSION STRUCTURE OPTIMIZER
 *
 * Analyzes deal economics and recommends optimal commission/fee structure.
 * Considers: vehicle price tier, expected DOM, recon costs, historical margins,
 * consignment vs outright purchase.
 *
 * POST /functions/v1/widget-commission-optimizer
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

// Commission benchmarks by price tier
const TIER_BENCHMARKS: Array<{
  min: number;
  max: number;
  label: string;
  typical_commission_pct: number;
  typical_flat_fee: number;
  consignment_rate_range: [number, number];
}> = [
  { min: 0, max: 10000, label: "Under $10K", typical_commission_pct: 15, typical_flat_fee: 1000, consignment_rate_range: [12, 18] },
  { min: 10000, max: 25000, label: "$10K-$25K", typical_commission_pct: 12, typical_flat_fee: 2000, consignment_rate_range: [10, 15] },
  { min: 25000, max: 50000, label: "$25K-$50K", typical_commission_pct: 10, typical_flat_fee: 3500, consignment_rate_range: [8, 12] },
  { min: 50000, max: 100000, label: "$50K-$100K", typical_commission_pct: 8, typical_flat_fee: 5000, consignment_rate_range: [6, 10] },
  { min: 100000, max: 250000, label: "$100K-$250K", typical_commission_pct: 6, typical_flat_fee: 8000, consignment_rate_range: [5, 8] },
  { min: 250000, max: Infinity, label: "$250K+", typical_commission_pct: 5, typical_flat_fee: 12000, consignment_rate_range: [4, 6] },
];

function getTierBenchmark(price: number) {
  return TIER_BENCHMARKS.find((t) => price >= t.min && price < t.max) ?? TIER_BENCHMARKS[2];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { vehicle_id } = await req.json();
    if (!vehicle_id) return json(400, { error: "vehicle_id required" });

    const supabase = getSupabase();

    // Get vehicle
    const { data: vehicle } = await supabase
      .from("vehicles")
      .select("id, year, make, model, era, asking_price, sale_price, nuke_estimate")
      .eq("id", vehicle_id)
      .single();

    if (!vehicle) return json(404, { error: "Vehicle not found" });

    // Get deal jacket
    const { data: deals } = await supabase
      .from("deal_jackets")
      .select("id, deal_type, initial_cost, total_initial_cost, total_selling_price, gross_profit, consignment_rate, listing_fee, feature_ad_fee, reconditioning_total, flooring_cost, shipping_cost_in, document_fee")
      .eq("vehicle_id", vehicle_id)
      .order("created_at", { ascending: false })
      .limit(3);

    // Get reconditioning costs
    const { data: reconItems } = await supabase
      .from("deal_reconditioning")
      .select("description, amount")
      .in("deal_id", (deals ?? []).map((d: any) => d.id));

    const vehiclePrice = Number(vehicle.asking_price || vehicle.sale_price || vehicle.nuke_estimate) || 0;
    const tier = getTierBenchmark(vehiclePrice);
    const deal = deals?.[0];

    // Calculate actual costs
    const initialCost = Number(deal?.initial_cost || deal?.total_initial_cost) || 0;
    const reconTotal = Number(deal?.reconditioning_total) || (reconItems ?? []).reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0);
    const flooringCost = Number(deal?.flooring_cost) || 0;
    const shippingCost = Number(deal?.shipping_cost_in) || 0;
    const totalCostBasis = initialCost + reconTotal + flooringCost + shippingCost;

    const currentConsignmentRate = deal?.consignment_rate ? Number(deal.consignment_rate) : null;
    const currentListingFee = Number(deal?.listing_fee) || 0;
    const currentGrossProfit = Number(deal?.gross_profit) || 0;

    // Carrying cost estimate (monthly)
    const monthlyCarry = Math.round(vehiclePrice * 0.008); // ~8% annual / 12

    // Break-even analysis
    const breakEvenPrice = totalCostBasis > 0
      ? totalCostBasis + monthlyCarry * 2 // 2 months minimum carry
      : 0;

    // Net margin projection
    const projectedSale = vehiclePrice;
    const projectedGross = projectedSale - totalCostBasis;
    const projectedNet = projectedGross - monthlyCarry * 3; // 3 months avg DOM

    // Commission structure analysis
    let score = 50;
    const reasons: string[] = [];
    const recommendations: Array<{ action: string; priority: number; rationale: string }> = [];

    if (deal) {
      // Has deal jacket — analyze actual structure
      if (currentConsignmentRate !== null) {
        const [lowBench, highBench] = tier.consignment_rate_range;
        if (currentConsignmentRate < lowBench) {
          score = 35;
          reasons.push(`Consignment rate ${currentConsignmentRate}% is below market (${lowBench}-${highBench}%)`);
          recommendations.push({
            action: `Negotiate rate up to at least ${lowBench}% for this price tier`,
            priority: 1,
            rationale: `Current ${currentConsignmentRate}% is below the ${tier.label} benchmark of ${lowBench}-${highBench}%.`,
          });
        } else if (currentConsignmentRate > highBench) {
          score = 85;
          reasons.push(`Consignment rate ${currentConsignmentRate}% is above market — strong margin`);
        } else {
          score = 65;
          reasons.push(`Consignment rate ${currentConsignmentRate}% is within market range (${lowBench}-${highBench}%)`);
        }
      }

      if (totalCostBasis > 0 && projectedGross > 0) {
        const marginPct = Math.round((projectedGross / projectedSale) * 100);
        if (marginPct >= 20) {
          score = Math.max(score, 80);
          reasons.push(`Projected gross margin ${marginPct}% — healthy`);
        } else if (marginPct >= 10) {
          reasons.push(`Projected gross margin ${marginPct}% — adequate`);
        } else if (marginPct > 0) {
          score = Math.min(score, 40);
          reasons.push(`Projected gross margin only ${marginPct}% — thin`);
          recommendations.push({
            action: "Review pricing — margin too thin after carrying costs",
            priority: 1,
            rationale: `${marginPct}% gross margin may not cover 3+ months of carrying costs ($${(monthlyCarry * 3).toLocaleString()}).`,
          });
        } else {
          score = 15;
          reasons.push("Projected loss on this deal");
          recommendations.push({
            action: "Re-evaluate deal — projected to lose money",
            priority: 1,
            rationale: `Total cost basis $${totalCostBasis.toLocaleString()} exceeds projected sale price $${projectedSale.toLocaleString()}.`,
          });
        }
      }

      if (reconTotal > 0) {
        const reconPct = Math.round((reconTotal / vehiclePrice) * 100);
        reasons.push(`Reconditioning: $${reconTotal.toLocaleString()} (${reconPct}% of value)`);
        if (reconPct > 20) {
          score = Math.min(score, 40);
          recommendations.push({
            action: "Reconditioning costs are excessive — review scope",
            priority: 2,
            rationale: `${reconPct}% of vehicle value in recon typically signals over-improvement or scope creep.`,
          });
        }
      }
    } else {
      // No deal jacket — provide benchmark guidance
      score = 50;
      reasons.push("No deal jacket — providing benchmark commission guidance");
    }

    // Always provide tier benchmark context
    const benchmarkCommission = Math.round(vehiclePrice * tier.typical_commission_pct / 100);

    if (recommendations.length === 0 && !deal) {
      recommendations.push({
        action: `Create deal jacket with ${tier.typical_commission_pct}% commission target`,
        priority: 1,
        rationale: `${tier.label} tier benchmark: ${tier.typical_commission_pct}% commission or $${tier.typical_flat_fee.toLocaleString()} flat fee.`,
      });
    }

    // Consignment vs outright comparison
    if (vehiclePrice > 0) {
      const consignmentEarning = Math.round(vehiclePrice * (tier.consignment_rate_range[0] + tier.consignment_rate_range[1]) / 200);
      const outrightMargin = projectedGross > 0 ? projectedGross : Math.round(vehiclePrice * 0.15);

      if (totalCostBasis === 0) {
        recommendations.push({
          action: `Consider consignment at ${tier.consignment_rate_range[0]}-${tier.consignment_rate_range[1]}% vs outright purchase`,
          priority: 3,
          rationale: `Consignment: ~$${consignmentEarning.toLocaleString()} with zero capital risk. Outright: ~$${outrightMargin.toLocaleString()} but requires $${vehiclePrice.toLocaleString()} capital.`,
        });
      }
    }

    const severity =
      score >= 60 ? "ok" : score >= 35 ? "warning" : "critical";

    const headline = deal
      ? `Commission analysis: ${score}/100 — ${severity === "ok" ? "structure is sound" : severity === "warning" ? "review recommended" : "margin at risk"}`
      : `No deal jacket — ${tier.label} benchmark: ${tier.typical_commission_pct}% commission`;

    return json(200, {
      score,
      severity,
      headline,
      details: {
        price_tier: tier.label,
        vehicle_price: vehiclePrice,
        has_deal: !!deal,
        cost_analysis: {
          initial_cost: initialCost,
          reconditioning: reconTotal,
          flooring: flooringCost,
          shipping: shippingCost,
          total_cost_basis: totalCostBasis,
          monthly_carrying_cost: monthlyCarry,
        },
        margin_projection: {
          projected_sale: projectedSale,
          projected_gross: projectedGross,
          projected_net_3mo: projectedNet,
          break_even_price: breakEvenPrice,
          gross_margin_pct: projectedSale > 0 ? Math.round((projectedGross / projectedSale) * 100) : null,
        },
        commission_benchmark: {
          typical_pct: tier.typical_commission_pct,
          typical_flat_fee: tier.typical_flat_fee,
          consignment_range: tier.consignment_rate_range,
          benchmark_earning: benchmarkCommission,
        },
        current_structure: deal ? {
          consignment_rate: currentConsignmentRate,
          listing_fee: currentListingFee,
          gross_profit: currentGrossProfit,
          recon_items: (reconItems ?? []).length,
        } : null,
        vehicle: { year: vehicle.year, make: vehicle.make, model: vehicle.model },
      },
      reasons,
      confidence: deal ? 0.7 : 0.4,
      recommendations: recommendations.slice(0, 4),
    });
  } catch (err: any) {
    console.error("Widget commission-optimizer error:", err);
    return json(500, { error: err.message });
  }
});

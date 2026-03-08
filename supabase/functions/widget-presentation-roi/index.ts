/**
 * WIDGET: PRESENTATION ROI
 *
 * Evaluates photo/presentation quality and calculates expected ROI
 * from improvements. Uses vehicle_images count, AI quality scores,
 * and segment benchmarks.
 *
 * Segment lift benchmarks:
 * - European sports: 15-22% with professional photos
 * - American muscle: 8-15%
 * - Trucks/SUVs: 5-10%
 * - Pre-war/concours: 20-30%
 *
 * POST /functions/v1/widget-presentation-roi
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

// Segment-specific lift percentages from professional presentation
const SEGMENT_LIFT: Record<string, { min: number; max: number }> = {
  "pre-war": { min: 0.20, max: 0.30 },
  "post-war": { min: 0.12, max: 0.20 },
  classic: { min: 0.08, max: 0.15 },
  "modern-classic": { min: 0.08, max: 0.15 },
  malaise: { min: 0.05, max: 0.10 },
  modern: { min: 0.05, max: 0.10 },
  contemporary: { min: 0.03, max: 0.08 },
};

const DEFAULT_LIFT = { min: 0.08, max: 0.15 };

// Photo count scoring (0-25)
function photoCountScore(count: number): number {
  if (count >= 60) return 25;
  if (count >= 40) return 22;
  if (count >= 25) return 18;
  if (count >= 15) return 14;
  if (count >= 8) return 8;
  if (count >= 3) return 4;
  return 0;
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
      .select("id, year, make, model, era, body_style, asking_price, sale_price, description, highlights, completion_percentage")
      .eq("id", vehicle_id)
      .single();

    if (!vehicle) return json(404, { error: "Vehicle not found" });

    // Count images
    const { count: imageCount } = await supabase
      .from("vehicle_images")
      .select("*", { count: "exact", head: true })
      .eq("vehicle_id", vehicle_id);

    const photos = imageCount ?? 0;

    // Check for AI-analyzed images (quality scores)
    const { data: analyzedImages } = await supabase
      .from("vehicle_images")
      .select("ai_scan_metadata")
      .eq("vehicle_id", vehicle_id)
      .eq("ai_processing_status", "completed")
      .not("ai_scan_metadata", "is", null)
      .limit(100);

    // Calculate quality score from AI metadata
    let avgQuality = 50; // Default if no AI data
    if (analyzedImages?.length) {
      const qualities = analyzedImages
        .map((img) => img.ai_scan_metadata?.quality_score ?? img.ai_scan_metadata?.photo_quality)
        .filter((q): q is number => q !== null && q !== undefined);

      if (qualities.length > 0) {
        avgQuality = Math.round(
          qualities.reduce((s, q) => s + q, 0) / qualities.length
        );
      }
    }

    // Calculate sub-scores (each 0-25, total 0-100)
    const photoScore = photoCountScore(photos);

    // Quality score (0-25)
    const qualityScore = Math.round((avgQuality / 100) * 25);

    // Description completeness (0-25)
    const descLength = (vehicle.description?.length ?? 0) + (vehicle.highlights?.length ?? 0);
    let descScore = 0;
    if (descLength >= 2000) descScore = 25;
    else if (descLength >= 1000) descScore = 20;
    else if (descLength >= 500) descScore = 15;
    else if (descLength >= 200) descScore = 10;
    else if (descLength >= 50) descScore = 5;

    // Profile completeness (0-25) — use existing completion_percentage if available
    const profilePct = vehicle.completion_percentage ?? 0;
    const profileScore = Math.round((profilePct / 100) * 25);

    const totalScore = photoScore + qualityScore + descScore + profileScore;

    // Calculate expected lift
    const era = vehicle.era ?? "";
    const liftRange = SEGMENT_LIFT[era] ?? DEFAULT_LIFT;
    const vehiclePrice = Number(vehicle.asking_price || vehicle.sale_price) || 0;

    // Lift is proportional to how much improvement is possible
    const improvementPotential = (100 - totalScore) / 100;
    const expectedLiftPct = liftRange.min + (liftRange.max - liftRange.min) * improvementPotential;
    const expectedLiftDollars = Math.round(vehiclePrice * expectedLiftPct);

    // Estimate costs for improvements
    const improvements: Array<{
      action: string;
      cost: number;
      expected_lift: number;
      roi_pct: number;
    }> = [];

    if (photoScore < 18) {
      const photoCost = 400;
      const photoLift = Math.round(vehiclePrice * 0.08);
      improvements.push({
        action: "Professional photography (40+ photos, all angles)",
        cost: photoCost,
        expected_lift: photoLift,
        roi_pct: Math.round((photoLift / photoCost - 1) * 100),
      });
    }

    if (descScore < 15) {
      const descCost = 0; // Free to write better description
      const descLift = Math.round(vehiclePrice * 0.03);
      improvements.push({
        action: "Write detailed description with ownership history and specs",
        cost: descCost,
        expected_lift: descLift,
        roi_pct: descLift > 0 ? 9999 : 0, // Infinite ROI (free)
      });
    }

    if (photos > 0 && photos < 15) {
      improvements.push({
        action: "Add engine bay, undercarriage, and trunk photos",
        cost: 0,
        expected_lift: Math.round(vehiclePrice * 0.02),
        roi_pct: 9999,
      });
    }

    if (totalScore < 50 && vehiclePrice > 10000) {
      const detailCost = 500;
      const detailLift = Math.round(vehiclePrice * 0.04);
      improvements.push({
        action: "Full detail + engine bay clean before photos",
        cost: detailCost,
        expected_lift: detailLift,
        roi_pct: Math.round((detailLift / detailCost - 1) * 100),
      });
    }

    const totalImprovementCost = improvements.reduce((s, i) => s + i.cost, 0);
    const totalExpectedLift = improvements.reduce((s, i) => s + i.expected_lift, 0);

    const severity =
      totalScore >= 60 ? "ok" : totalScore >= 40 ? "warning" : "critical";

    let headline: string;
    if (totalScore >= 70) {
      headline = `Presentation score ${totalScore}/100 — well-presented`;
    } else if (improvements.length > 0) {
      headline = `Presentation score ${totalScore}/100 — improvements could add $${totalExpectedLift.toLocaleString()} (${Math.round(expectedLiftPct * 100)}% lift)`;
    } else {
      headline = `Presentation score ${totalScore}/100 — room for improvement`;
    }

    const recommendations = improvements
      .sort((a, b) => b.roi_pct - a.roi_pct)
      .slice(0, 3)
      .map((imp, i) => ({
        action: imp.action,
        priority: i + 1,
        rationale: imp.cost > 0
          ? `Cost: $${imp.cost}, expected lift: $${imp.expected_lift.toLocaleString()}, ROI: ${imp.roi_pct}%`
          : `Free improvement, expected lift: $${imp.expected_lift.toLocaleString()}`,
      }));

    return json(200, {
      score: totalScore,
      severity,
      headline,
      details: {
        presentation_breakdown: {
          photo_count: { score: photoScore, max: 25, photos },
          photo_quality: { score: qualityScore, max: 25, avg_quality: avgQuality, analyzed_count: analyzedImages?.length ?? 0 },
          description: { score: descScore, max: 25, length: descLength },
          profile_completeness: { score: profileScore, max: 25, pct: profilePct },
        },
        total_score: totalScore,
        segment: era || "unknown",
        segment_lift_range: {
          min_pct: Math.round(liftRange.min * 100),
          max_pct: Math.round(liftRange.max * 100),
        },
        expected_lift_pct: Math.round(expectedLiftPct * 100),
        expected_lift_dollars: expectedLiftDollars,
        improvement_opportunities: improvements,
        total_improvement_cost: totalImprovementCost,
        total_expected_lift: totalExpectedLift,
        aggregate_roi_pct: totalImprovementCost > 0
          ? Math.round((totalExpectedLift / totalImprovementCost - 1) * 100)
          : null,
        vehicle: {
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          asking_price: vehicle.asking_price,
        },
      },
      reasons: [headline],
      confidence: analyzedImages?.length ? 0.8 : 0.6,
      recommendations,
    });
  } catch (err: any) {
    console.error("Widget presentation-roi error:", err);
    return json(500, { error: err.message });
  }
});

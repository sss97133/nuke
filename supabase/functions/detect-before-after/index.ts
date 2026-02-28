/**
 * BEFORE/AFTER DETECTION - The Smoking Gun
 *
 * Core forensic evidence: If we can show:
 * 1. BEFORE: Vehicle in condition X (timestamp T1)
 * 2. AFTER: Vehicle in condition Y (timestamp T2)
 * 3. TIME: T2 - T1 = reasonable work duration
 *
 * Then we have PROOF that work happened.
 *
 * Uses callTierVision from agentTiers.ts (Sonnet by default).
 * Replaces former OpenAI GPT-4O dependency.
 *
 * The system can also CALL BS on claims:
 * - "8 hours of paint work" but before/after only 30 min apart
 * - Materials list doesn't match visible work
 * - Labor hours > reasonable for work type
 * - Cost claims way outside market norms
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { callTierVision, parseJsonResponse } from "../_shared/agentTiers.ts";
import type { AgentTier } from "../_shared/agentTiers.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const {
      vehicleId,
      imageIds,
      claimedLaborHours,
      claimedMaterialsCost,
      claimedTotal,
      organizationId,
      tier = "sonnet" as AgentTier,
    } = await req.json();

    if (!vehicleId || !imageIds || imageIds.length < 2) {
      throw new Error("Need at least 2 images to detect before/after");
    }

    // Get vehicle info
    const { data: vehicle } = await supabase
      .from("vehicles")
      .select("year, make, model")
      .eq("id", vehicleId)
      .single();

    const vehicleName = vehicle
      ? `${vehicle.year} ${vehicle.make} ${vehicle.model}`
      : "Unknown Vehicle";

    // Get images with timestamps
    const { data: images, error: imgError } = await supabase
      .from("vehicle_images")
      .select("id, image_url, taken_at, category, ai_scan_metadata, vehicle_zone, fabrication_stage")
      .in("id", imageIds)
      .order("taken_at", { ascending: true });

    if (imgError || !images || images.length < 2) {
      throw new Error("Could not fetch images");
    }

    // Get organization labor rate if provided
    let laborRate = 125;
    if (organizationId) {
      const { data: org } = await supabase
        .from("businesses")
        .select("labor_rate")
        .eq("id", organizationId)
        .single();
      if (org?.labor_rate) laborRate = org.labor_rate;
    }

    console.log(
      `[Before/After] Analyzing ${images.length} images for ${vehicleName} via ${tier}`,
    );

    // Build analysis prompt
    const systemPrompt = `You are an expert automotive forensic analyst. Analyze these images to detect BEFORE/AFTER work pairs.

VEHICLE: ${vehicleName}

CRITICAL TASKS:

1. **DETECT BEFORE/AFTER PAIRS**
   - Find images showing the SAME component in different states
   - Identify: What changed? What work was done?
   - Note timestamps to calculate work duration

2. **VALIDATE WORK CLAIMS**
   - If claimed labor hours: ${claimedLaborHours || "not provided"}
   - If claimed materials: $${claimedMaterialsCost || "not provided"}
   - If claimed total: $${claimedTotal || "not provided"}

3. **CALL BS IF NEEDED**
   Flag concerns if:
   - Time between before/after is too short for claimed work
   - Materials don't match visible work
   - Labor hours are unreasonable
   - Costs are way outside market rates

4. **ESTIMATE REALISTIC COSTS**
   Labor rate: $${laborRate}/hour
   Consider:
   - Actual work visible in images
   - Materials that would be needed
   - Tool depreciation (~3% of tool cost per job)
   - Shop overhead (typically 10-15% of labor)

Return ONLY valid JSON:
{
  "beforeAfterPairs": [
    {
      "beforeImageIndex": 0,
      "afterImageIndex": 3,
      "component": "driver_seat",
      "beforeCondition": "torn leather, worn foam",
      "afterCondition": "new leather upholstery, fresh foam",
      "workPerformed": "Seat reupholstery",
      "confidence": 0.95
    }
  ],
  "totalWorkDetected": {
    "workTypes": ["upholstery", "interior"],
    "description": "Full interior seat reupholstery with new leather",
    "components": ["driver_seat", "passenger_seat", "rear_bench"]
  },
  "timeAnalysis": {
    "earliestImage": "2024-01-15T09:00:00",
    "latestImage": "2024-01-15T17:30:00",
    "totalHours": 8.5,
    "isReasonableForWork": true,
    "concerns": []
  },
  "costValidation": {
    "estimatedLaborHours": 8,
    "estimatedMaterialsCost": 1200,
    "estimatedToolDepreciation": 45,
    "estimatedShopOverhead": 100,
    "totalEstimate": 2345,
    "claimIsReasonable": true,
    "concerns": [],
    "marketComparison": {
      "lowEstimate": 1800,
      "midEstimate": 2400,
      "highEstimate": 3200,
      "percentile": 48
    }
  },
  "validation": {
    "workVerified": true,
    "confidence": 0.92,
    "concerns": [],
    "recommendations": ["Photos show clear before/after transformation"]
  }
}

BE SKEPTICAL. If something doesn't add up, flag it. The system can call BS.`;

    // Collect image URLs (max 10)
    const imageUrls = images.slice(0, 10).map((img) => img.image_url);

    const userMessage = `Analyze these ${images.length} images for before/after work detection.

Image metadata:
${images.map((img, i) => `${i}: timestamp=${img.taken_at || "unknown"} zone=${img.vehicle_zone || "unknown"} stage=${img.fabrication_stage || "unknown"}`).join("\n")}

${claimedLaborHours ? `CLAIMED LABOR: ${claimedLaborHours} hours` : ""}
${claimedMaterialsCost ? `CLAIMED MATERIALS: $${claimedMaterialsCost}` : ""}
${claimedTotal ? `CLAIMED TOTAL: $${claimedTotal}` : ""}

Detect before/after pairs and validate any claims.`;

    // Call Claude vision via agentTiers
    const result = await callTierVision(
      tier as AgentTier,
      systemPrompt,
      userMessage,
      imageUrls,
      { maxTokens: 2000, temperature: 0.2 },
    );

    const analysis = parseJsonResponse(result.content);

    // Store analysis results
    const { data: forensicRecord } = await supabase
      .from("forensic_before_after")
      .insert({
        vehicle_id: vehicleId,
        organization_id: organizationId,
        image_ids: imageIds,
        before_after_pairs: analysis.beforeAfterPairs || [],
        work_detected: analysis.totalWorkDetected || {},
        time_analysis: analysis.timeAnalysis || {},
        cost_validation: analysis.costValidation || {},
        overall_validation: analysis.validation || {},
        claimed_labor_hours: claimedLaborHours,
        claimed_materials_cost: claimedMaterialsCost,
        claimed_total: claimedTotal,
        is_verified: analysis.validation?.workVerified || false,
        confidence: analysis.validation?.confidence || 0,
        concerns: analysis.validation?.concerns || [],
        analyzed_at: new Date().toISOString(),
        ai_model: result.model,
        ai_cost_cents: result.costCents,
      })
      .select("id")
      .single();

    // If concerns were flagged, create a review item
    const concerns = [
      ...(analysis.validation?.concerns || []),
      ...(analysis.costValidation?.concerns || []),
      ...(analysis.timeAnalysis?.concerns || []),
    ];

    if (concerns.length > 0 && !analysis.validation?.workVerified) {
      await supabase.from("forensic_review_queue").insert({
        vehicle_id: vehicleId,
        forensic_record_id: forensicRecord?.id,
        concern_type: "before_after_mismatch",
        concerns: concerns,
        priority: concerns.length > 2 ? "high" : "medium",
        status: "pending",
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        recordId: forensicRecord?.id,
        ...analysis,
        aiMetrics: {
          model: result.model,
          tier,
          costCents: result.costCents,
          durationMs: result.durationMs,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        },
        computedCosts: {
          laborHours: analysis.costValidation?.estimatedLaborHours || 0,
          laborRate: laborRate,
          laborCost:
            (analysis.costValidation?.estimatedLaborHours || 0) * laborRate,
          materialsCost: analysis.costValidation?.estimatedMaterialsCost || 0,
          toolDepreciation:
            analysis.costValidation?.estimatedToolDepreciation || 0,
          shopOverhead: analysis.costValidation?.estimatedShopOverhead || 0,
          totalEstimate: analysis.costValidation?.totalEstimate || 0,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Before/After] Error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

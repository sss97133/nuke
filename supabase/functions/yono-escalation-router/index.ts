/**
 * YONO ESCALATION ROUTER — Confidence-based tier routing for YONO predictions
 *
 * The flywheel: Opus teaches YONO, YONO gets smarter, fewer Opus calls needed.
 *
 * Confidence Tiers:
 *   > 0.85  → Auto-accept YONO result ($0.00)
 *   0.40-0.85 → Sonnet validates (~$0.003)
 *   < 0.40  → Opus full analysis (~$0.01)
 *
 * All Sonnet/Opus results write to yono_training_queue for retraining.
 *
 * Request:
 *   POST /yono-escalation-router
 *   {
 *     image_id: string,
 *     image_url: string,
 *     yono_result: {
 *       vehicle_zone, zone_confidence, fabrication_stage, stage_confidence,
 *       condition_score, damage_flags, modification_flags, photo_quality
 *     },
 *     prediction_type?: "zone" | "stage" | "condition" | "all"
 *   }
 *
 * Response:
 *   {
 *     action: "auto_accept" | "sonnet_validate" | "opus_analyze",
 *     confidence: number,
 *     result: { ... final result ... },
 *     training_queued: boolean,
 *     cost_cents: number
 *   }
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  callTierVision,
  parseJsonResponse,
} from "../_shared/agentTiers.ts";
import type { AgentTier } from "../_shared/agentTiers.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Confidence thresholds
const AUTO_ACCEPT_THRESHOLD = 0.85;
const SONNET_THRESHOLD = 0.40;

interface YonoResult {
  vehicle_zone?: string;
  zone_confidence?: number;
  fabrication_stage?: string;
  stage_confidence?: number;
  condition_score?: number;
  damage_flags?: string[];
  modification_flags?: string[];
  photo_quality?: number;
}

function getMinConfidence(result: YonoResult, predictionType: string): number {
  const confidences: number[] = [];

  if (predictionType === "zone" || predictionType === "all") {
    if (result.zone_confidence != null) confidences.push(result.zone_confidence);
  }
  if (predictionType === "stage" || predictionType === "all") {
    if (result.stage_confidence != null) confidences.push(result.stage_confidence);
  }

  if (confidences.length === 0) return 0.5;
  return Math.min(...confidences);
}

const VALIDATION_SYSTEM_PROMPT = `You are a vehicle image analysis validator. You will be shown a vehicle photo along with an AI model's predictions. Validate or correct the predictions.

Return ONLY valid JSON with these fields:
{
  "vehicle_zone": "corrected zone or same if correct",
  "zone_correct": true/false,
  "fabrication_stage": "corrected stage or same if correct",
  "stage_correct": true/false,
  "condition_score": 1-5,
  "condition_correct": true/false,
  "corrections_made": ["list of what was wrong"],
  "confidence": 0.0-1.0
}

FABRICATION STAGES (in order):
raw → disassembled → stripped → fabricated → primed → blocked → basecoated → clearcoated → assembled → complete`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      image_id,
      image_url,
      yono_result,
      prediction_type = "all",
    } = body;

    if (!image_url || !yono_result) {
      return new Response(
        JSON.stringify({ error: "image_url and yono_result required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const minConfidence = getMinConfidence(yono_result, prediction_type);

    // Tier 1: Auto-accept (high confidence)
    if (minConfidence >= AUTO_ACCEPT_THRESHOLD) {
      console.log(
        `[escalation-router] Auto-accept: confidence=${minConfidence.toFixed(3)} (threshold=${AUTO_ACCEPT_THRESHOLD})`,
      );
      return new Response(
        JSON.stringify({
          action: "auto_accept",
          confidence: minConfidence,
          result: yono_result,
          training_queued: false,
          cost_cents: 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Tier 2/3: Needs validation
    const tier: AgentTier = minConfidence >= SONNET_THRESHOLD ? "sonnet" : "opus";
    const action = tier === "sonnet" ? "sonnet_validate" : "opus_analyze";

    console.log(
      `[escalation-router] ${action}: confidence=${minConfidence.toFixed(3)} → using ${tier}`,
    );

    const userMessage = `Validate this AI model's predictions for the vehicle photo:

AI Predictions:
- Zone: ${yono_result.vehicle_zone || "unknown"} (confidence: ${yono_result.zone_confidence || "N/A"})
- Fabrication Stage: ${yono_result.fabrication_stage || "unknown"} (confidence: ${yono_result.stage_confidence || "N/A"})
- Condition Score: ${yono_result.condition_score || "N/A"}/5
- Damage Flags: ${(yono_result.damage_flags || []).join(", ") || "none"}
- Photo Quality: ${yono_result.photo_quality || "N/A"}/5

Are these predictions correct? If not, provide the correct values.`;

    const aiResult = await callTierVision(
      tier,
      VALIDATION_SYSTEM_PROMPT,
      userMessage,
      [image_url],
      { maxTokens: 500, temperature: 0.1 },
    );

    const validation = parseJsonResponse(aiResult.content);

    // Build corrected result
    const correctedResult = {
      ...yono_result,
      ...(validation.vehicle_zone && !validation.zone_correct
        ? { vehicle_zone: validation.vehicle_zone }
        : {}),
      ...(validation.fabrication_stage && !validation.stage_correct
        ? { fabrication_stage: validation.fabrication_stage }
        : {}),
      ...(validation.condition_score && !validation.condition_correct
        ? { condition_score: validation.condition_score }
        : {}),
    };

    // Queue for training
    const correctionsMade = validation.corrections_made || [];
    const hasDisagreement = correctionsMade.length > 0 ||
      !validation.zone_correct ||
      !validation.stage_correct;

    if (image_id) {
      await supabase.from("yono_training_queue").insert({
        image_id,
        image_url,
        prediction_type,
        yono_prediction: yono_result,
        ground_truth: correctedResult,
        ground_truth_source: `${tier}_validation`,
        disagreement_type: hasDisagreement
          ? correctionsMade.join("; ") || "prediction_mismatch"
          : null,
        priority: tier === "opus" ? 80 : 50,
        training_status: "pending",
      });
    }

    // Update vehicle_images with corrected values if image_id provided
    if (image_id && hasDisagreement) {
      const updateFields: Record<string, any> = {};
      if (!validation.zone_correct && validation.vehicle_zone) {
        updateFields.vehicle_zone = validation.vehicle_zone;
      }
      if (!validation.stage_correct && validation.fabrication_stage) {
        updateFields.fabrication_stage = validation.fabrication_stage;
      }
      if (Object.keys(updateFields).length > 0) {
        await supabase
          .from("vehicle_images")
          .update(updateFields)
          .eq("id", image_id);
      }
    }

    console.log(
      `[escalation-router] ${tier} validation: ${correctionsMade.length} corrections, cost=$${aiResult.costCents.toFixed(4)}`,
    );

    return new Response(
      JSON.stringify({
        action,
        confidence: validation.confidence || minConfidence,
        result: correctedResult,
        corrections: correctionsMade,
        training_queued: !!image_id,
        cost_cents: aiResult.costCents,
        ai_metrics: {
          model: aiResult.model,
          tier,
          durationMs: aiResult.durationMs,
          inputTokens: aiResult.inputTokens,
          outputTokens: aiResult.outputTokens,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[escalation-router] Error:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

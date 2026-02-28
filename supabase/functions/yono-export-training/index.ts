/**
 * YONO EXPORT TRAINING — Export training queue to JSONL for retraining
 *
 * Exports pending entries from yono_training_queue to JSONL format
 * matching the training scripts' expected input.
 *
 * Request:
 *   POST /yono-export-training
 *   {
 *     prediction_type?: "zone" | "stage" | "condition" | "all",
 *     limit?: number,          // default 1000
 *     min_priority?: number,   // default 0
 *     mark_exported?: boolean  // default true
 *   }
 *
 * Response:
 *   {
 *     jsonl: string,           // newline-delimited JSON
 *     count: number,
 *     by_type: { zone: N, stage: N, condition: N },
 *     by_source: { sonnet_validation: N, opus_validation: N, human: N }
 *   }
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      prediction_type = "all",
      limit = 1000,
      min_priority = 0,
      mark_exported = true,
    } = body;

    // Query pending training entries
    let query = supabase
      .from("yono_training_queue")
      .select("*")
      .eq("training_status", "pending")
      .gte("priority", min_priority)
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(limit);

    if (prediction_type !== "all") {
      query = query.eq("prediction_type", prediction_type);
    }

    const { data: entries, error } = await query;

    if (error) throw new Error(`Query failed: ${error.message}`);
    if (!entries || entries.length === 0) {
      return new Response(
        JSON.stringify({
          jsonl: "",
          count: 0,
          by_type: {},
          by_source: {},
          message: "No pending training entries",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Convert to JSONL format matching training scripts
    const jsonlLines: string[] = [];
    const byType: Record<string, number> = {};
    const bySource: Record<string, number> = {};

    for (const entry of entries) {
      const gt = entry.ground_truth || {};
      const pred = entry.yono_prediction || {};

      // Build training record compatible with existing label format
      const record: Record<string, any> = {
        image_id: entry.image_id,
        image_url: entry.image_url,
        // Ground truth (from Sonnet/Opus validation)
        vehicle_zone: gt.vehicle_zone || pred.vehicle_zone,
        zone_confidence: 1.0, // ground truth = full confidence
        fabrication_stage: gt.fabrication_stage || pred.fabrication_stage,
        stage_confidence: 1.0,
        condition_score: gt.condition_score || pred.condition_score,
        damage_flags: gt.damage_flags || pred.damage_flags || [],
        modification_flags: gt.modification_flags || pred.modification_flags || [],
        photo_quality: gt.photo_quality || pred.photo_quality,
        // Provenance
        ground_truth_source: entry.ground_truth_source,
        yono_prediction: pred,
        disagreement_type: entry.disagreement_type,
      };

      jsonlLines.push(JSON.stringify(record));

      // Stats
      const ptype = entry.prediction_type || "unknown";
      byType[ptype] = (byType[ptype] || 0) + 1;
      const source = entry.ground_truth_source || "unknown";
      bySource[source] = (bySource[source] || 0) + 1;
    }

    // Mark as exported
    if (mark_exported) {
      const ids = entries.map((e) => e.id);
      await supabase
        .from("yono_training_queue")
        .update({
          training_status: "exported",
          exported_at: new Date().toISOString(),
        })
        .in("id", ids);
    }

    console.log(
      `[yono-export-training] Exported ${entries.length} entries (${mark_exported ? "marked" : "not marked"})`,
    );

    return new Response(
      JSON.stringify({
        jsonl: jsonlLines.join("\n"),
        count: entries.length,
        by_type: byType,
        by_source: bySource,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[yono-export-training] Error:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

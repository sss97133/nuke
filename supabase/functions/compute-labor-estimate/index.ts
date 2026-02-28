/**
 * COMPUTE LABOR ESTIMATE — Maps photo deltas to labor codes and hours
 *
 * Takes a vehicle_id, detects work sessions, finds zone+stage deltas,
 * and estimates labor hours + cost for each transition.
 *
 * Flow:
 *   1. Call detect_work_sessions() to find sessions
 *   2. For each session, find zone+stage deltas
 *   3. Call estimate_labor_from_delta() per delta
 *   4. Aggregate into labor_estimates record
 *
 * Request:
 *   POST /compute-labor-estimate
 *   {
 *     vehicle_id: string,
 *     work_session_id?: string,  // specific session, or all sessions
 *     labor_rate?: number,       // $/hr, default 125
 *   }
 *
 * Response:
 *   {
 *     estimates: [{
 *       work_session_id, zone_deltas, labor_line_items,
 *       total_hours, total_cost, yono_confidence
 *     }],
 *     summary: { total_hours, total_cost, sessions_analyzed }
 *   }
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

interface ZoneDelta {
  zone: string;
  from_stage: string;
  to_stage: string;
  from_image_id: string;
  to_image_id: string;
}

interface LaborLineItem {
  zone: string;
  from_stage: string;
  to_stage: string;
  description: string;
  hours_min: number;
  hours_max: number;
  hours_typical: number;
  materials_min: number;
  materials_max: number;
  match_type: string;
  labor_codes: string[];
}

interface LaborEstimate {
  work_session_id: string | null;
  session_start: string;
  session_end: string;
  zone_deltas: ZoneDelta[];
  labor_line_items: LaborLineItem[];
  total_hours: number;
  total_cost: number;
  materials_cost: number;
  yono_confidence: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      vehicle_id,
      work_session_id,
      labor_rate = 125,
    } = body;

    if (!vehicle_id) {
      return new Response(
        JSON.stringify({ error: "vehicle_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`[compute-labor-estimate] Computing for vehicle ${vehicle_id}`);

    // Step 1: Get sessions (either specific or all)
    let sessions: any[];

    if (work_session_id) {
      const { data } = await supabase
        .from("work_sessions")
        .select("*")
        .eq("id", work_session_id)
        .single();
      sessions = data ? [data] : [];
    } else {
      // Detect sessions fresh
      const { data, error } = await supabase.rpc("detect_work_sessions", {
        p_vehicle_id: vehicle_id,
        p_gap_threshold_minutes: 120,
      });
      if (error) throw new Error(`detect_work_sessions: ${error.message}`);
      sessions = data || [];
    }

    if (sessions.length === 0) {
      return new Response(
        JSON.stringify({
          estimates: [],
          summary: { total_hours: 0, total_cost: 0, sessions_analyzed: 0 },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Step 2-3: For each session, find deltas and estimate labor
    const estimates: LaborEstimate[] = [];

    for (const session of sessions) {
      const imageIds = session.image_ids || session.metadata?.image_ids || [];
      if (imageIds.length < 2) continue;

      // Get images with zone + stage
      const { data: images } = await supabase
        .from("vehicle_images")
        .select("id, vehicle_zone, fabrication_stage, stage_confidence, taken_at, created_at")
        .in("id", imageIds)
        .not("vehicle_zone", "is", null)
        .not("fabrication_stage", "is", null)
        .order("taken_at", { ascending: true });

      if (!images || images.length < 2) continue;

      // Find zone deltas (zone where stage changed)
      const zoneImages: Record<string, typeof images> = {};
      for (const img of images) {
        if (!zoneImages[img.vehicle_zone]) zoneImages[img.vehicle_zone] = [];
        zoneImages[img.vehicle_zone].push(img);
      }

      const deltas: ZoneDelta[] = [];
      for (const [zone, zImgs] of Object.entries(zoneImages)) {
        if (zImgs.length < 2) continue;
        const first = zImgs[0];
        const last = zImgs[zImgs.length - 1];
        if (first.fabrication_stage !== last.fabrication_stage) {
          deltas.push({
            zone,
            from_stage: first.fabrication_stage,
            to_stage: last.fabrication_stage,
            from_image_id: first.id,
            to_image_id: last.id,
          });
        }
      }

      if (deltas.length === 0) continue;

      // Estimate labor for each delta
      const lineItems: LaborLineItem[] = [];
      let totalConfidence = 0;

      for (const delta of deltas) {
        const { data: laborData } = await supabase.rpc("estimate_labor_from_delta", {
          p_vehicle_id: vehicle_id,
          p_zone: delta.zone,
          p_from_stage: delta.from_stage,
          p_to_stage: delta.to_stage,
        });

        if (laborData && laborData.length > 0) {
          const match = laborData[0];
          lineItems.push({
            zone: delta.zone,
            from_stage: delta.from_stage,
            to_stage: delta.to_stage,
            description: match.description || `${delta.from_stage} → ${delta.to_stage} on ${delta.zone}`,
            hours_min: match.hours_min,
            hours_max: match.hours_max,
            hours_typical: match.hours_typical,
            materials_min: match.materials_min,
            materials_max: match.materials_max,
            match_type: match.match_type,
            labor_codes: match.labor_operation_codes || [],
          });
        } else {
          // No match in transition map — log it
          lineItems.push({
            zone: delta.zone,
            from_stage: delta.from_stage,
            to_stage: delta.to_stage,
            description: `${delta.from_stage} → ${delta.to_stage} on ${delta.zone} (no labor map entry)`,
            hours_min: 0,
            hours_max: 0,
            hours_typical: 0,
            materials_min: 0,
            materials_max: 0,
            match_type: "unmapped",
            labor_codes: [],
          });
        }
      }

      // Get average YONO confidence from the session images
      const confidences = images
        .map(img => img.stage_confidence)
        .filter((c): c is number => c != null);
      const avgConfidence = confidences.length > 0
        ? confidences.reduce((a, b) => a + b, 0) / confidences.length
        : 0.5;

      const totalHours = lineItems.reduce((sum, li) => sum + li.hours_typical, 0);
      const totalMaterials = lineItems.reduce((sum, li) => sum + (li.materials_min + li.materials_max) / 2, 0);
      const totalCost = totalHours * labor_rate + totalMaterials;

      const estimate: LaborEstimate = {
        work_session_id: session.id || null,
        session_start: session.session_start || session.start_time,
        session_end: session.session_end || session.end_time,
        zone_deltas: deltas,
        labor_line_items: lineItems,
        total_hours: Math.round(totalHours * 10) / 10,
        total_cost: Math.round(totalCost),
        materials_cost: Math.round(totalMaterials),
        yono_confidence: Math.round(avgConfidence * 1000) / 1000,
      };

      estimates.push(estimate);

      // Store in labor_estimates table
      await supabase.from("labor_estimates").insert({
        vehicle_id,
        work_session_id: estimate.work_session_id,
        zone_deltas: estimate.zone_deltas,
        labor_line_items: estimate.labor_line_items,
        total_hours_estimate: estimate.total_hours,
        total_cost_estimate: estimate.total_cost,
        labor_rate,
        yono_confidence: estimate.yono_confidence,
        status: "draft",
      });
    }

    const summary = {
      total_hours: Math.round(estimates.reduce((s, e) => s + e.total_hours, 0) * 10) / 10,
      total_cost: Math.round(estimates.reduce((s, e) => s + e.total_cost, 0)),
      total_materials: Math.round(estimates.reduce((s, e) => s + e.materials_cost, 0)),
      sessions_analyzed: estimates.length,
      labor_rate,
    };

    console.log(`[compute-labor-estimate] ${estimates.length} sessions → ${summary.total_hours}h, $${summary.total_cost}`);

    return new Response(
      JSON.stringify({ estimates, summary }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[compute-labor-estimate] Error:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

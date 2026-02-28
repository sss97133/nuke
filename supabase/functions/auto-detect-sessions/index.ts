/**
 * AUTO-DETECT SESSIONS — Work session detection from photo timestamps
 *
 * Groups vehicle images by timestamp proximity (configurable gap threshold,
 * default 2 hours). Detects zones touched, fabrication stages observed,
 * and stage transitions within each session.
 *
 * Called by:
 *   - photo-pipeline-orchestrator after processing a progress_shot
 *   - sms-work-intake after photo submission
 *   - manually for retroactive session detection
 *
 * Request:
 *   POST /auto-detect-sessions
 *   {
 *     vehicle_id: string,
 *     gap_threshold_minutes?: number,  // default 120
 *     upsert?: boolean                 // default true — upsert into work_sessions
 *   }
 *
 * Response:
 *   {
 *     sessions: [{
 *       session_number, session_start, session_end, duration_minutes,
 *       image_count, zones_touched, stages_observed, stage_transitions
 *     }],
 *     total_sessions: number,
 *     upserted: number
 *   }
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

interface SessionRow {
  session_number: number;
  session_start: string;
  session_end: string;
  duration_minutes: number;
  image_count: number;
  start_image_id: string;
  end_image_id: string;
  zones_touched: string[];
  stages_observed: string[];
  image_ids: string[];
}

interface StageTransition {
  zone: string;
  from_stage: string;
  to_stage: string;
  from_image_id: string;
  to_image_id: string;
}

/**
 * Detect stage transitions within a session by finding zones where the
 * fabrication_stage changed between the earliest and latest image.
 */
async function detectStageTransitions(
  vehicleId: string,
  imageIds: string[],
): Promise<StageTransition[]> {
  if (imageIds.length < 2) return [];

  // Get images with zone and stage info, ordered by timestamp
  const { data: images } = await supabase
    .from("vehicle_images")
    .select("id, vehicle_zone, fabrication_stage, taken_at, created_at")
    .in("id", imageIds)
    .order("taken_at", { ascending: true });

  if (!images || images.length < 2) return [];

  // Group by zone, find stage changes
  const zoneImages: Record<string, typeof images> = {};
  for (const img of images) {
    if (!img.vehicle_zone || !img.fabrication_stage) continue;
    if (!zoneImages[img.vehicle_zone]) zoneImages[img.vehicle_zone] = [];
    zoneImages[img.vehicle_zone].push(img);
  }

  const transitions: StageTransition[] = [];
  for (const [zone, zImages] of Object.entries(zoneImages)) {
    if (zImages.length < 2) continue;
    const first = zImages[0];
    const last = zImages[zImages.length - 1];
    if (first.fabrication_stage !== last.fabrication_stage) {
      transitions.push({
        zone,
        from_stage: first.fabrication_stage,
        to_stage: last.fabrication_stage,
        from_image_id: first.id,
        to_image_id: last.id,
      });
    }
  }

  return transitions;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      vehicle_id,
      gap_threshold_minutes = 120,
      upsert = true,
    } = body;

    if (!vehicle_id) {
      return new Response(
        JSON.stringify({ error: "vehicle_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`[auto-detect-sessions] Detecting sessions for vehicle ${vehicle_id} (gap=${gap_threshold_minutes}min)`);

    // Call the SQL function
    const { data: sessions, error } = await supabase.rpc("detect_work_sessions", {
      p_vehicle_id: vehicle_id,
      p_gap_threshold_minutes: gap_threshold_minutes,
    });

    if (error) {
      throw new Error(`detect_work_sessions failed: ${error.message}`);
    }

    if (!sessions || sessions.length === 0) {
      return new Response(
        JSON.stringify({
          sessions: [],
          total_sessions: 0,
          upserted: 0,
          message: "No images found for this vehicle",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Enrich sessions with stage transitions
    const enrichedSessions = [];
    for (const session of sessions as SessionRow[]) {
      const transitions = await detectStageTransitions(
        vehicle_id,
        session.image_ids || [],
      );
      enrichedSessions.push({
        ...session,
        stage_transitions: transitions,
      });
    }

    // Upsert into work_sessions table
    let upsertedCount = 0;
    if (upsert) {
      for (const session of enrichedSessions) {
        const { error: upsertError } = await supabase
          .from("work_sessions")
          .upsert(
            {
              vehicle_id,
              session_type: "auto_detected",
              start_time: session.session_start,
              end_time: session.session_end,
              image_count: session.image_count,
              start_image_id: session.start_image_id,
              end_image_id: session.end_image_id,
              zones_touched: session.zones_touched || [],
              stages_observed: session.stages_observed || [],
              stage_transitions: session.stage_transitions,
              metadata: {
                gap_threshold_minutes,
                detected_at: new Date().toISOString(),
                image_ids: session.image_ids,
              },
            },
            {
              onConflict: "vehicle_id,start_time",
              ignoreDuplicates: false,
            },
          );

        if (!upsertError) upsertedCount++;
      }
    }

    console.log(`[auto-detect-sessions] Found ${enrichedSessions.length} sessions, upserted ${upsertedCount}`);

    return new Response(
      JSON.stringify({
        sessions: enrichedSessions.map(s => ({
          session_number: s.session_number,
          session_start: s.session_start,
          session_end: s.session_end,
          duration_minutes: s.duration_minutes,
          image_count: s.image_count,
          zones_touched: s.zones_touched,
          stages_observed: s.stages_observed,
          stage_transitions: s.stage_transitions,
        })),
        total_sessions: enrichedSessions.length,
        upserted: upsertedCount,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[auto-detect-sessions] Error:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CreateWorkSessionFromEvidenceRequest {
  vehicle_id: string;
  event_date: string; // YYYY-MM-DD
  image_ids: string[];
  title?: string;
  description?: string;
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function toYmd(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  // If it's a full ISO datetime, slice to date. If already date, keep.
  const ymd = s.length >= 10 ? s.slice(0, 10) : s;
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : "";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
    if (!jwt) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as Partial<CreateWorkSessionFromEvidenceRequest>;
    const vehicleId = String(body.vehicle_id || "").trim();
    const eventDate = toYmd(String(body.event_date || ""));
    const imageIds = Array.isArray(body.image_ids) ? body.image_ids.map(String).map((s) => s.trim()).filter(Boolean) : [];

    if (!isUuid(vehicleId)) {
      return new Response(JSON.stringify({ error: "vehicle_id must be a UUID" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!eventDate) {
      return new Response(JSON.stringify({ error: "event_date must be YYYY-MM-DD" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (imageIds.length === 0) {
      return new Response(JSON.stringify({ error: "image_ids is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
    const userId = userData?.user?.id || null;
    if (userError || !userId) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Reuse an existing image-based pending_analysis event for the same day if it exists.
    let eventId: string | null = null;
    try {
      const { data: existing } = await supabase
        .from("timeline_events")
        .select("id")
        .eq("vehicle_id", vehicleId)
        .eq("event_date", eventDate)
        .eq("event_type", "pending_analysis")
        .eq("source_type", "image")
        .limit(1)
        .maybeSingle();
      if (existing?.id) eventId = String(existing.id);
    } catch {
      // If schema differs, we'll just create a new event below.
      eventId = null;
    }

    let action: "created" | "found_existing" = eventId ? "found_existing" : "created";

    if (!eventId) {
      const title = String(body.title || `${imageIds.length} photos from ${eventDate}`).slice(0, 140);
      const description = String(body.description || "AI analysis pending").slice(0, 2000);

      const insertPayload: Record<string, unknown> = {
        vehicle_id: vehicleId,
        user_id: userId,
        created_by: userId,
        event_type: "pending_analysis",
        event_category: "maintenance",
        source_type: "image",
        title,
        description,
        event_date: eventDate,
        affects_value: true,
        metadata: {
          evidence_set: true,
          image_count: imageIds.length,
          image_ids: imageIds,
          needs_ai_analysis: true,
          created_via: "create-work-session-from-evidence",
        },
      };

      const { data: created, error: createErr } = await supabase
        .from("timeline_events")
        .insert(insertPayload)
        .select("id")
        .single();

      if (createErr || !created?.id) {
        throw createErr || new Error("Failed to create timeline event");
      }
      eventId = String(created.id);
    }

    // Link images that are not already linked to another event.
    const { data: linkedRows, error: linkErr } = await supabase
      .from("vehicle_images")
      .update({ timeline_event_id: eventId })
      .in("id", imageIds)
      .is("timeline_event_id", null)
      .select("id");

    if (linkErr) throw linkErr;

    // Update event metadata with the final linked image IDs (best-effort).
    try {
      const linkedIds = (linkedRows || []).map((r: any) => String(r.id)).filter(Boolean);
      await supabase
        .from("timeline_events")
        .update({
          metadata: {
            evidence_set: true,
            image_count: imageIds.length,
            linked_image_count: linkedIds.length,
            image_ids: imageIds,
            linked_image_ids: linkedIds,
            needs_ai_analysis: true,
            created_via: "create-work-session-from-evidence",
          },
        })
        .eq("id", eventId);
    } catch {
      // ignore metadata update failures
    }

    return new Response(JSON.stringify({
      success: true,
      action,
      event_id: eventId,
      requested_image_count: imageIds.length,
      linked_image_count: (linkedRows || []).length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("[create-work-session-from-evidence] Error:", error);
    return new Response(JSON.stringify({ error: error?.message || "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});


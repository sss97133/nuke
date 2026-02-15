/**
 * Clarification Responder
 *
 * Handles user replies to photo sync clarification messages.
 * Parses natural language responses, applies vehicle assignment decisions,
 * sends confirmations back on the same channel.
 *
 * Called by: SMS webhook, Telegram webhook, or daemon (for iMessage replies)
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      user_id,
      response_text,
      response_channel,
      clarification_id,
    } = await req.json();

    if (!user_id || !response_text) {
      return new Response(
        JSON.stringify({ error: "user_id and response_text required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Find the pending clarification
    let query = supabase
      .from("clarification_requests")
      .select("*")
      .eq("user_id", user_id)
      .in("status", ["sent", "pending"]);

    if (clarification_id) {
      query = query.eq("id", clarification_id);
    }

    const { data: requests } = await query
      .order("created_at", { ascending: false })
      .limit(1);

    if (!requests?.length) {
      return new Response(
        JSON.stringify({ error: "No pending clarification found", resolved: false }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const clarification = requests[0];
    const candidates = clarification.candidate_vehicles || [];
    const text = response_text.trim().toLowerCase();

    // Parse the response
    const resolution = parseResponse(text, candidates);

    if (resolution.action === "unknown") {
      return new Response(
        JSON.stringify({
          resolved: false,
          message: "I didn't understand that. Reply with a vehicle name, number, 'new', or 'skip'.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Apply the resolution
    let resultMessage = "";
    let resolvedVehicleId: string | null = null;

    if (resolution.action === "match_existing") {
      resolvedVehicleId = resolution.vehicle_id!;
      const vehicleTitle = resolution.vehicle_title || "vehicle";

      // Assign all pending photos to this vehicle
      const photoCount = await assignPhotosToVehicle(
        clarification.photo_sync_item_ids || [],
        resolvedVehicleId
      );

      resultMessage = `Done! ${photoCount} photos sorted to ${vehicleTitle}.`;
    }
    else if (resolution.action === "create_new") {
      // Create a new vehicle from the AI hints
      const hints = clarification.ai_analysis || {};
      const { data: newVehicle } = await supabase
        .from("vehicles")
        .insert({
          year: hints.year_range ? parseInt(hints.year_range, 10) || null : null,
          make: hints.make || resolution.make || null,
          model: hints.model || resolution.model || null,
          color: hints.color || null,
          body_style: hints.body_style || null,
          user_id: user_id,
          source: "photo_auto_sync",
          owner_name: resolution.owner_name || null,
        })
        .select()
        .single();

      if (newVehicle) {
        resolvedVehicleId = newVehicle.id;
        const title = `${newVehicle.year || ''} ${newVehicle.make || ''} ${newVehicle.model || ''}`.trim();
        const photoCount = await assignPhotosToVehicle(
          clarification.photo_sync_item_ids || [],
          newVehicle.id
        );
        resultMessage = `Created new vehicle: ${title}. ${photoCount} photos assigned.`;
      } else {
        resultMessage = "Couldn't create vehicle. Please try again.";
      }
    }
    else if (resolution.action === "skip") {
      // Mark photos as ignored
      for (const itemId of clarification.photo_sync_item_ids || []) {
        await supabase
          .from("photo_sync_items")
          .update({ sync_status: "ignored" })
          .eq("id", itemId);
      }
      resultMessage = `Skipped ${(clarification.photo_sync_item_ids || []).length} photos.`;
    }

    // Update clarification request
    await supabase
      .from("clarification_requests")
      .update({
        response_text: response_text,
        response_received_at: new Date().toISOString(),
        response_channel: response_channel,
        resolved_vehicle_id: resolvedVehicleId,
        resolution: resolution.action,
        resolved_at: new Date().toISOString(),
        status: "resolved",
        updated_at: new Date().toISOString(),
      })
      .eq("id", clarification.id);

    return new Response(
      JSON.stringify({
        resolved: true,
        action: resolution.action,
        vehicle_id: resolvedVehicleId,
        message: resultMessage,
        photos_affected: (clarification.photo_sync_item_ids || []).length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("Clarification responder error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ============================================================================
// RESPONSE PARSING
// ============================================================================

interface ParsedResponse {
  action: "match_existing" | "create_new" | "skip" | "unknown";
  vehicle_id?: string;
  vehicle_title?: string;
  owner_name?: string;
  make?: string;
  model?: string;
}

function parseResponse(text: string, candidates: any[]): ParsedResponse {
  const clean = text.trim().toLowerCase();

  // Skip/ignore
  if (/^(skip|ignore|no|nah|pass|none)\b/.test(clean)) {
    return { action: "skip" };
  }

  // Numeric selection (e.g., "1", "2")
  const numMatch = clean.match(/^(\d+)$/);
  if (numMatch) {
    const idx = parseInt(numMatch[1], 10) - 1;
    if (idx >= 0 && idx < candidates.length) {
      return {
        action: "match_existing",
        vehicle_id: candidates[idx].vehicle_id,
        vehicle_title: candidates[idx].vehicle_title,
      };
    }
    // If number is one past candidates, it means "new vehicle"
    if (idx === candidates.length) {
      return { action: "create_new" };
    }
    // And one more means "skip"
    if (idx === candidates.length + 1) {
      return { action: "skip" };
    }
  }

  // "new" or "new vehicle"
  if (/^(new|create|add)\b/.test(clean)) {
    return { action: "create_new" };
  }

  // Match by owner name (e.g., "ernie", "ernies", "ernie's")
  const ownerClean = clean.replace(/[''`]s?\s*$/, "").trim();
  for (const c of candidates) {
    const title = (c.vehicle_title || "").toLowerCase();
    if (title.includes(ownerClean) || ownerClean.includes(title.split(" ")[0])) {
      return {
        action: "match_existing",
        vehicle_id: c.vehicle_id,
        vehicle_title: c.vehicle_title,
      };
    }
  }

  // Match by year/make/model fragments
  for (const c of candidates) {
    const title = (c.vehicle_title || "").toLowerCase();
    const words = clean.split(/\s+/);

    // Check if response contains key parts of vehicle title
    const titleWords = title.split(/\s+/);
    const matchingWords = words.filter(w => titleWords.some(tw => tw.includes(w) || w.includes(tw)));

    if (matchingWords.length >= 2 || (matchingWords.length === 1 && matchingWords[0].length >= 4)) {
      return {
        action: "match_existing",
        vehicle_id: c.vehicle_id,
        vehicle_title: c.vehicle_title,
      };
    }
  }

  // If it looks like a name (short, no numbers), treat as owner name for new vehicle
  if (clean.length <= 20 && !/\d/.test(clean) && clean.split(/\s+/).length <= 3) {
    return {
      action: "create_new",
      owner_name: text.trim(),  // Preserve original casing
    };
  }

  return { action: "unknown" };
}

// ============================================================================
// PHOTO ASSIGNMENT
// ============================================================================

async function assignPhotosToVehicle(syncItemIds: string[], vehicleId: string): Promise<number> {
  let count = 0;

  for (const itemId of syncItemIds) {
    // Get the vehicle_image_id from sync item
    const { data: item } = await supabase
      .from("photo_sync_items")
      .select("vehicle_image_id")
      .eq("id", itemId)
      .single();

    if (item?.vehicle_image_id) {
      await supabase
        .from("vehicle_images")
        .update({
          vehicle_id: vehicleId,
          organization_status: "organized",
        })
        .eq("id", item.vehicle_image_id);

      await supabase
        .from("photo_sync_items")
        .update({
          sync_status: "matched",
          matched_vehicle_id: vehicleId,
          match_method: "user_confirm",
          match_confidence: 1.0,
          matched_at: new Date().toISOString(),
        })
        .eq("id", itemId);

      count++;
    }
  }

  return count;
}

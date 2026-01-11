import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type SplitRequest = {
  vehicleId: string;
  sourceUrl: string;
  reason?: string;
  force?: boolean; // admins only (future) - bypass VIN conflict check
};

function isBaT(url: string) {
  return url.toLowerCase().includes("bringatrailer.com");
}

function safeJsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function requireUser(req: Request) {
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const jwt = req.headers.get("Authorization") ?? "";
  if (!anon || !supabaseUrl) return null;

  const authClient = createClient(supabaseUrl, anon, {
    global: { headers: { Authorization: jwt } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await authClient.auth.getUser();
  if (error || !data?.user?.id) return null;
  return data.user;
}

async function canSplitVehicle(admin: any, vehicleId: string, userId: string): Promise<boolean> {
  // Allow if:
  // - uploader/creator
  // - approved ownership verification
  // - active contributor
  // - explicit owner/co_owner permission record
  const { data: vehicle } = await admin
    .from("vehicles")
    .select("uploaded_by, user_id")
    .eq("id", vehicleId)
    .maybeSingle();

  const uploaderId = vehicle?.uploaded_by || vehicle?.user_id || null;
  if (uploaderId && uploaderId === userId) return true;

  const [{ data: ver }, { data: contrib }, { data: perm }] = await Promise.all([
    admin
      .from("ownership_verifications")
      .select("id")
      .eq("vehicle_id", vehicleId)
      .eq("user_id", userId)
      .eq("status", "approved")
      .limit(1),
    admin
      .from("vehicle_contributors")
      .select("id, role, status")
      .eq("vehicle_id", vehicleId)
      .eq("user_id", userId)
      .eq("status", "active")
      .limit(1),
    admin
      .from("vehicle_user_permissions")
      .select("id, role, is_active")
      .eq("vehicle_id", vehicleId)
      .eq("user_id", userId)
      .eq("is_active", true)
      .in("role", ["owner", "co_owner"])
      .limit(1),
  ]);

  if ((ver || []).length > 0) return true;
  if ((contrib || []).length > 0) return true;
  if ((perm || []).length > 0) return true;
  return false;
}

async function scrapeBasicBaT(batUrl: string): Promise<{
  year?: number;
  make?: string;
  model?: string;
  vin?: string;
  title?: string;
}> {
  const resp = await fetch(batUrl);
  const html = await resp.text();

  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  const title = titleMatch ? titleMatch[1].trim() : undefined;

  let year: number | undefined;
  let make: string | undefined;
  let model: string | undefined;

  if (title) {
    const vehicleMatch = title.match(/^(\d{4})\s+([A-Za-z-]+)\s+(.+)$/);
    if (vehicleMatch) {
      year = parseInt(vehicleMatch[1], 10);
      make = vehicleMatch[2];
      // Don't overfit model parsing; store the raw remainder and let downstream normalization handle it.
      model = vehicleMatch[3];
    }
  }

  const vinMatch =
    html.match(/(?:VIN|Chassis)[:\s]+([A-HJ-NPR-Z0-9]{17})/i) ||
    html.match(/<li>Chassis:\s*<a[^>]*>([A-HJ-NPR-Z0-9]{17})<\/a><\/li>/i);
  const vin = vinMatch ? vinMatch[1].toUpperCase() : undefined;

  return { year, make, model, vin, title };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const user = await requireUser(req);
    if (!user?.id) return safeJsonError("Login required", 401);

    const body: SplitRequest = await req.json();
    const { vehicleId, sourceUrl, reason, force } = body || ({} as any);

    if (!vehicleId || !sourceUrl) return safeJsonError("vehicleId and sourceUrl are required", 400);
    if (!isBaT(sourceUrl)) return safeJsonError("Only Bring a Trailer URLs are supported for split right now", 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceKey) return safeJsonError("Server not configured", 500);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const allowed = await canSplitVehicle(admin, vehicleId, user.id);
    if (!allowed) return safeJsonError("Not authorized to split this vehicle", 403);

    // Load current vehicle VIN (anchor VIN). Treat VIVA-* as unknown placeholder.
    const { data: currentVehicle, error: curErr } = await admin
      .from("vehicles")
      .select("id, vin")
      .eq("id", vehicleId)
      .single();
    if (curErr) throw curErr;

    // Scrape enough to create a decent seed profile.
    const scraped = await scrapeBasicBaT(sourceUrl);

    // SAFETY: Only split when we have a proven VIN conflict.
    // This prevents accidental splits caused by ambiguous URLs or missing VINs.
    if (force !== true) {
      const currentVinRaw = (currentVehicle?.vin || "").toString().trim();
      const currentVin = currentVinRaw.startsWith("VIVA-") ? "" : currentVinRaw.toUpperCase();
      const sourceVin = (scraped.vin || "").toString().trim().toUpperCase();

      if (!currentVin) {
        return safeJsonError(
          "Split blocked: current vehicle VIN is missing/placeholder. Add/verify VIN first (or use Detach).",
          409,
        );
      }
      if (!sourceVin) {
        return safeJsonError(
          "Split blocked: listing VIN could not be extracted from the Source URL.",
          409,
        );
      }
      if (currentVin === sourceVin) {
        return safeJsonError(
          "Split blocked: VINs match (no conflict detected). Detach is the appropriate action if the URL is still wrong.",
          409,
        );
      }
    }

    // Create a new vehicle explicitly (no matching) to prevent cross-contamination.
    const { data: newVehicle, error: createErr } = await admin
      .from("vehicles")
      .insert({
        year: scraped.year ?? null,
        make: scraped.make ?? null,
        model: scraped.model ?? null,
        vin: scraped.vin ?? null,
        listing_url: sourceUrl,
        discovery_url: sourceUrl,
        discovery_source: "split_from_source",
        profile_origin: "bat_import",
        bat_auction_url: sourceUrl,
        origin_metadata: {
          import_source: "split_from_source",
          split_from_vehicle_id: vehicleId,
          split_reason: reason ?? "Source URL conflicts with existing evidence",
          source_url: sourceUrl,
          created_at: new Date().toISOString(),
        },
        // Keep attribution with the user performing the split.
        uploaded_by: user.id,
      } as any)
      .select("id")
      .single();

    if (createErr) throw createErr;

    // Add a timeline note to the original vehicle for auditability (best-effort).
    try {
      const { data: existing } = await admin
        .from("timeline_events")
        .select("id")
        .eq("vehicle_id", vehicleId)
        .eq("source", "split_from_source")
        .eq("event_type", "other")
        .eq("metadata->>action", "split")
        .eq("metadata->>source_url", sourceUrl)
        .eq("metadata->>new_vehicle_id", newVehicle.id)
        .limit(1)
        .maybeSingle();

      if (!existing?.id) {
      await admin.from("timeline_events").insert({
        vehicle_id: vehicleId,
        user_id: user.id,
        event_type: "other",
        source: "split_from_source",
        event_date: new Date().toISOString().split("T")[0],
        title: "Split created from external listing",
        description: `Created a new vehicle profile from Source URL to prevent cross-contamination.\n\nSource: ${sourceUrl}\nNew vehicle: ${newVehicle.id}`,
        metadata: {
          action: "split",
          source_url: sourceUrl,
          new_vehicle_id: newVehicle.id,
          reason: reason ?? null,
        },
      });
      }
    } catch {
      // ignore
    }

    // Kick off deeper extraction (best-effort) using approved two-step workflow.
    // ✅ APPROVED WORKFLOW: extract-bat-core + extract-auction-comments
    // ⚠️ Do NOT use comprehensive-bat-extraction (deprecated)
    // See: docs/BAT_EXTRACTION_SUCCESS_WORKFLOW.md
    try {
      // Step 1: Extract core vehicle data (VIN, specs, images, auction_events)
      const step1Result = await admin.functions.invoke("extract-bat-core", {
        body: { url: sourceUrl, max_vehicles: 1 },
      });
      
      if (step1Result.error) {
        console.log(`extract-bat-core invoke failed (non-fatal): ${step1Result.error.message}`);
      } else {
        const vehicleId = step1Result.data?.created_vehicle_ids?.[0] || 
                         step1Result.data?.updated_vehicle_ids?.[0] || 
                         newVehicle.id;
        
        // Step 2: Extract comments and bids (non-critical, fire-and-forget)
        admin.functions.invoke("extract-auction-comments", {
          body: { auction_url: sourceUrl, vehicle_id: vehicleId },
        }).catch((e: any) => {
          console.log(`extract-auction-comments invoke failed (non-fatal): ${e?.message || String(e)}`);
        });
      }
    } catch (e) {
      console.log("BaT extraction workflow failed (non-fatal):", (e as any)?.message);
    }

    return new Response(
      JSON.stringify({ success: true, newVehicleId: newVehicle.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("split-vehicle-from-source error:", error);
    return new Response(JSON.stringify({ success: false, error: error?.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});



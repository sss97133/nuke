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

function normalizeUrl(url: string) {
  // Normalize trailing slashes so DB joins are consistent (BaT uses both forms).
  return url.replace(/\/+$/, "");
}

function normalizeVin(raw: string) {
  // VINs (esp. pre-1981 chassis numbers) can be non-17-digit; normalize to alnum.
  return (raw || "")
    .toString()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .trim();
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
  // - org-based access (board_member/manager/etc) via organization_vehicles + organization_contributors

  // Prefer the canonical, DB-backed permission check if present (keeps Edge logic aligned with the app).
  try {
    const { data: hasAccess, error } = await admin.rpc("vehicle_user_has_access", {
      p_vehicle_id: vehicleId,
      p_user_id: userId,
    });
    if (!error && hasAccess === true) return true;
  } catch {
    // Fall back to legacy checks below.
  }

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

  // Org-based access (matches frontend OwnershipService behavior)
  try {
    const { data: orgVehicles } = await admin
      .from("organization_vehicles")
      .select("organization_id, start_date, end_date, status")
      .eq("vehicle_id", vehicleId)
      .eq("status", "active");

    const links = Array.isArray(orgVehicles) ? orgVehicles : [];
    if (links.length > 0) {
      const now = new Date();
      for (const link of links) {
        const orgId = link?.organization_id;
        if (!orgId) continue;

        const { data: orgMember } = await admin
          .from("organization_contributors")
          .select("role, status, start_date, end_date")
          .eq("organization_id", orgId)
          .eq("user_id", userId)
          .eq("status", "active")
          .maybeSingle();

        if (!orgMember?.role) continue;

        const vehicleStart = link?.start_date ? new Date(link.start_date) : null;
        const vehicleEnd = link?.end_date ? new Date(link.end_date) : null;
        const memberStart = orgMember?.start_date ? new Date(orgMember.start_date) : null;
        const memberEnd = orgMember?.end_date ? new Date(orgMember.end_date) : null;

        const nowInMemberTenure = (!memberStart || now >= memberStart) && (!memberEnd || now <= memberEnd);
        const vehicleInMemberTenure = (!vehicleStart || !vehicleEnd)
          ? nowInMemberTenure
          : (!memberStart || vehicleEnd >= memberStart) && (!memberEnd || vehicleStart <= memberEnd);

        const role = String(orgMember.role);
        const elevated = ["board_member", "owner", "co_founder", "manager", "moderator"].includes(role);
        const canAccess = nowInMemberTenure || vehicleInMemberTenure || (elevated && !memberEnd);

        if (canAccess) return true;
      }
    }
  } catch {
    // ignore
  }

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

  // VIN extraction: BaT often uses "Chassis:" for classic cars with non‑17‑digit VINs.
  // We do a lightweight HTML->text pass to make this resilient to markup changes.
  const textOnly = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const vinCandidates: string[] = [];
  const structuredMatch =
    html.match(/<li>\s*(?:VIN|Chassis)\s*:\s*(?:<a[^>]*>)?\s*([A-Za-z0-9\-]{5,25})/i) ||
    textOnly.match(/\b(?:VIN|Chassis)(?:\s*(?:Number|No\.|#))?\s*:\s*([A-Za-z0-9\-]{5,25})\b/i);

  if (structuredMatch?.[1]) {
    const normalized = normalizeVin(structuredMatch[1]);
    if (normalized.length >= 5 && normalized.length <= 25) vinCandidates.push(normalized);
  }

  // Back-compat: older logic for 17-digit VINs (still useful).
  const strict17 =
    html.match(/(?:VIN|Chassis)[:\s]+([A-HJ-NPR-Z0-9]{17})/i) ||
    html.match(/<li>Chassis:\s*<a[^>]*>([A-HJ-NPR-Z0-9]{17})<\/a><\/li>/i);
  if (strict17?.[1]) {
    const normalized = normalizeVin(strict17[1]);
    if (normalized.length === 17) vinCandidates.push(normalized);
  }

  // Prefer 17-digit VIN when present, otherwise take the first candidate.
  const vin = vinCandidates.find((v) => v.length === 17) ?? vinCandidates[0];

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
    const canonicalSourceUrl = normalizeUrl(sourceUrl);
    if (!isBaT(canonicalSourceUrl)) return safeJsonError("Only Bring a Trailer URLs are supported for split right now", 400);

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
      .select(
        "id, vin, origin_metadata, listing_url, discovery_url, listing_source, discovery_source, bat_auction_url"
      )
      .eq("id", vehicleId)
      .single();
    if (curErr) throw curErr;

    // Idempotency: if we already created a split vehicle for this source+parent, return it.
    // This avoids duplicate split vehicles when users click multiple times.
    const { data: existingSplit } = await admin
      .from("vehicles")
      .select("id")
      .in("listing_url", [canonicalSourceUrl, `${canonicalSourceUrl}/`])
      .contains("origin_metadata", { split_from_vehicle_id: vehicleId })
      .maybeSingle();

    if (existingSplit?.id) {
      return new Response(JSON.stringify({ success: true, newVehicleId: existingSplit.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Scrape enough to create a decent seed profile.
    const scraped = await scrapeBasicBaT(canonicalSourceUrl);

    // NOTE: This is a manual, editor-triggered decontamination action.
    // We allow the split even when VINs are missing or match; the user is explicitly choosing to unmerge.
    const currentVinRaw = (currentVehicle?.vin || "").toString().trim();
    const currentVinNormalized = currentVinRaw.startsWith("VIVA-") ? "" : normalizeVin(currentVinRaw);
    const sourceVinNormalized = normalizeVin(scraped.vin || "");
    const vinConflictDetected =
      !!currentVinNormalized && !!sourceVinNormalized && currentVinNormalized !== sourceVinNormalized;

    // Create a new vehicle explicitly (no matching) to prevent cross-contamination.
    const { data: newVehicle, error: createErr } = await admin
      .from("vehicles")
      .insert({
        year: scraped.year ?? null,
        make: scraped.make ?? null,
        model: scraped.model ?? null,
        vin: scraped.vin ?? null,
        listing_url: canonicalSourceUrl,
        discovery_url: canonicalSourceUrl,
        discovery_source: "split_from_source",
        profile_origin: "bat_import",
        bat_auction_url: canonicalSourceUrl,
        origin_metadata: {
          import_source: "split_from_source",
          split_from_vehicle_id: vehicleId,
          split_reason: reason ?? "Source URL conflicts with existing evidence",
          source_url: canonicalSourceUrl,
          current_vehicle_vin: currentVinNormalized || null,
          source_vin: sourceVinNormalized || null,
          vin_conflict_detected: vinConflictDetected,
          forced: force === true,
          created_at: new Date().toISOString(),
        },
        // Keep attribution with the user performing the split.
        uploaded_by: user.id,
      } as any)
      .select("id")
      .single();

    if (createErr) throw createErr;

    // Unmerge: detach BaT listing linkage + move BaT auction data to the new vehicle.
    // Best-effort; the split vehicle remains even if unmerge steps partially fail.
    try {
      const nowIso = new Date().toISOString();
      const existingMeta =
        currentVehicle && typeof (currentVehicle as any).origin_metadata === "object" && (currentVehicle as any).origin_metadata
          ? (currentVehicle as any).origin_metadata
          : {};

      const nextMeta = {
        ...existingMeta,
        split_out: {
          at: nowIso,
          source_url: canonicalSourceUrl,
          new_vehicle_id: newVehicle.id,
          forced: force === true,
        },
      };

      // 1) Move auction tables tied to the source URL
      await admin
        .from("auction_events")
        .update({ vehicle_id: newVehicle.id } as any)
        .eq("vehicle_id", vehicleId)
        .in("source_url", [canonicalSourceUrl, `${canonicalSourceUrl}/`]);

      await admin
        .from("auction_comments")
        .update({ vehicle_id: newVehicle.id } as any)
        .eq("vehicle_id", vehicleId)
        .eq("platform", "bat")
        .in("source_url", [canonicalSourceUrl, `${canonicalSourceUrl}/`]);

      // 2) Move timeline auction events (these often lack source_url, so use event_type prefix)
      await admin
        .from("timeline_events")
        .update({ vehicle_id: newVehicle.id } as any)
        .eq("vehicle_id", vehicleId)
        .like("event_type", "auction_%");

      // 3) Detach listing URL + clear BaT-derived summary fields on the original vehicle
      // (Only do this if the current listing/discovery URLs match the split source.)
      const listingMatches =
        normalizeUrl((currentVehicle as any)?.listing_url || "") === canonicalSourceUrl ||
        normalizeUrl((currentVehicle as any)?.discovery_url || "") === canonicalSourceUrl ||
        normalizeUrl((currentVehicle as any)?.bat_auction_url || "") === canonicalSourceUrl;

      if (listingMatches) {
        await admin
          .from("vehicles")
          .update({
            listing_url: null,
            listing_source: null,
            discovery_url: null,
            bat_auction_url: null,
            auction_source: null,
            sale_price: null,
            auction_end_date: null,
            bid_count: null,
            view_count: null,
            sale_status: null,
            sale_date: null,
            auction_outcome: null,
            high_bid: null,
            winning_bid: null,
            // BaT summary fields
            bat_sold_price: null,
            bat_sale_date: null,
            bat_bid_count: null,
            bat_view_count: null,
            bat_listing_title: null,
            bat_bids: null,
            bat_comments: null,
            bat_views: null,
            bat_location: null,
            bat_seller: null,
            bat_buyer: null,
            bat_lot_number: null,
            bat_watchers: null,
            reserve_status: null,
            origin_metadata: nextMeta,
            updated_at: nowIso,
          } as any)
          .eq("id", vehicleId);
      }
    } catch (e: any) {
      console.log("Unmerge steps failed (non-fatal):", e?.message || String(e));
    }

    // Add a timeline note to the original vehicle for auditability (best-effort).
    try {
      const { data: existing } = await admin
        .from("timeline_events")
        .select("id")
        .eq("vehicle_id", vehicleId)
        .eq("source", "split_from_source")
        .eq("event_type", "other")
        .eq("metadata->>action", "split")
        .eq("metadata->>source_url", canonicalSourceUrl)
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
          source_url: canonicalSourceUrl,
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
        body: { url: canonicalSourceUrl, max_vehicles: 1 },
      });
      
      if (step1Result.error) {
        console.log(`extract-bat-core invoke failed (non-fatal): ${step1Result.error.message}`);
      } else {
        const vehicleId = step1Result.data?.created_vehicle_ids?.[0] || 
                         step1Result.data?.updated_vehicle_ids?.[0] || 
                         newVehicle.id;
        
        // Step 2: Extract comments and bids (non-critical, fire-and-forget)
        admin.functions.invoke("extract-auction-comments", {
          body: { auction_url: canonicalSourceUrl, vehicle_id: vehicleId },
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



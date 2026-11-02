import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { authenticateWriter, requireWriteAuth } from "../_shared/writeGuard.ts";
import { projectSecretKey } from "../_shared/supabaseKeys.ts";
import { readVehicleAssessment } from "../_shared/vehicleAssessment.ts";
import { readListingEvidence } from "./listingEvidence.ts";

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});
const storedDraft = (v: Record<string, unknown>) => ({
  qualification: "unassayed_stored_record_not_listing_assertions",
  description: v.description ?? null, highlights: v.highlights ?? null,
  equipment: v.equipment ?? null, modifications: v.modifications ?? null,
  known_flaws: v.known_flaws ?? null, recent_service_history: v.recent_service_history ?? null,
  documents_on_hand: v.documents_on_hand ?? null, paint_body_history: v.paint_body_history ?? null,
  accident_history: v.accident_history ?? null, rust_notes: v.rust_notes ?? null,
});

Deno.serve(async (req: Request) => {
  const denied = await requireWriteAuth(req);
  if (denied) return denied;
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  try {
    const body = await req.json();
    const vehicleId = body.vehicle_id;
    const platform = body.platform || "bat";
    if (typeof vehicleId !== "string" || !UUID.test(vehicleId) || typeof platform !== "string" || platform.length > 40) {
      return json({ error: "valid vehicle_id and platform required" }, 400);
    }
    const auth = await authenticateWriter(req);
    if (!auth.ok || !["user", "service_role"].includes(auth.caller.kind)) return json({ error: "authorized actor required" }, 403);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, projectSecretKey()!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // Check the real caller before fetching a private draft or preparing its
    // evidence. Service reads never retry a refused user as the vehicle owner.
    if (auth.caller.kind === "user") {
      const access = await db.rpc("user_can_edit_vehicle", { p_vehicle_id: vehicleId, p_user_id: auth.caller.userId });
      if (access.error) return json({ error: "vehicle access reader unavailable" }, 503);
      if (access.data !== true) return json({ error: "vehicle editing access required" }, 403);
    }
    const { data: v, error: vehicleError } = await db.from("vehicles").select("*").eq("id", vehicleId).maybeSingle();
    if (vehicleError) return json({ error: "vehicle reader unavailable" }, 503);
    if (!v || v.deleted_at) return json({ error: "vehicle not found" }, 404);
    const actorId = auth.caller.kind === "user" ? auth.caller.userId : v.user_id ?? v.owner_id ?? v.uploaded_by ?? null;
    const [intake, photoRead, readiness, estimate] = await Promise.all([
      readListingEvidence(db, vehicleId, actorId),
      db.from("vehicle_images").select("id,image_url,vehicle_zone,photo_quality_score,display_order,taken_at")
        .eq("vehicle_id", vehicleId).eq("vehicle_image_gallery_eligible", true)
        .not("is_sensitive", "is", true).not("is_document", "is", true).not("doc_flag", "is", true)
        .order("display_order", { ascending: true, nullsFirst: false }).order("id").limit(601),
      db.from("auction_readiness").select("composite_score,tier").eq("vehicle_id", vehicleId).maybeSingle(),
      db.from("nuke_estimates").select("estimated_value,value_low,value_high,confidence_score,calculated_at,model_version")
        .eq("vehicle_id", vehicleId).maybeSingle(),
    ]);
    if (photoRead.error) return json({ error: "qualified photo reader unavailable" }, 503);
    const availablePhotos = photoRead.data ?? [];
    const photos = availablePhotos.slice(0, 600);
    const assessment = await readVehicleAssessment(db, v, {
      photos, photoHasMore: availablePhotos.length > 600, contributorEvidence: intake,
      claimAfter: body.claim_after, commentAfter: body.comment_after,
    });
    const identity = {
      year: assessment.listing.supported.year ?? null, make: assessment.listing.supported.make ?? null,
      model: assessment.listing.supported.model ?? null, vin: null, trim: null, engine_type: null, engine_code: null,
      displacement: null, transmission: null, transmission_type: null, drivetrain: null, body_style: null,
      exterior_color: null, interior_color: null, mileage: null, title_status: null, location: null,
      cowl_tag: null, owned_time: null,
    };
    const titleParts = [identity.year, identity.make, identity.model].filter(x => x !== null);
    const title = titleParts.length === 3 ? titleParts.join(" ") : "Vehicle — identity pending";
    const description = assessment.listing.assertions.map(a => a.statement).join("\n") || null;
    const fieldProvenance = Object.fromEntries(assessment.listing.assertions.map(a => [a.field, a]));
    return json({
      platform, submission_ready: false, ars_score: null, tier: null,
      tier_warning: "Evidence qualification and owner review remain required.",
      identity, listing_content: { title, description, highlights: null, equipment: null, modifications: null,
        known_flaws: null, recent_service_history: null, documents_on_hand: null, video_urls: null },
      listing_assertions: assessment.listing.assertions, field_provenance: fieldProvenance,
      unresolved_fields: assessment.unresolved_fields, assessment,
      // Keep the received draft and attestations, separately qualified, so they
      // cannot silently re-enter asserted copy or platform specifications.
      retained_draft: storedDraft(v), contributor_evidence: intake,
      retained_readiness: readiness.error ? { status: "unavailable" }
        : { status: "unqualified_stored_heuristic", record: readiness.data },
      retained_valuation: estimate.error ? { status: "unavailable" }
        : { status: "unqualified_stored_estimate", record: estimate.data },
      valuation: null, market_context: assessment.market,
      photos: { count: photos.length, has_more: availablePhotos.length > 600, platform_limit: 600,
        hero_image: photos.find(p => p.image_url === v.primary_image_url)?.image_url ?? photos[0]?.image_url ?? null,
        zones_covered: [], zones_missing: [], coverage_status: "unknown",
        ordered: photos.map(p => ({ id: p.id, url: p.image_url, zone: null, quality: null, caption: null })) },
      observed_components: [],
      submission_fields: platform === "bat" ? { title, year: identity.year, make: identity.make, model: identity.model,
        vin: null, mileage: null, transmission: null, drivetrain: null, engine: null, body_style: null,
        exterior_color: null, interior_color: null, title_status: null, location: null, reserve: null,
        _qualification: "Source-reported identity only; unresolved specifications require cited evidence and owner review." } : null,
    });
  } catch {
    return json({ error: "listing package could not be prepared" }, 500);
  }
});

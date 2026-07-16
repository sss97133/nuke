import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// =============================================================================
// generate-listing-package — Produces auction submission bundles from digital twin
// =============================================================================
// Takes a vehicle_id + platform, checks ARS tier, assembles identity, photos,
// structured fields, and valuation into a submission-ready package.
//
// Sprint 1-2 skeleton: data assembly only. AI description generation and
// platform-specific field mapping come in Sprint 3.
// =============================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function getSupabase() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Derive-on-read (vehicle-profile-computation-surface.md doctrine): for attributes
// that have a registry definition + recorded atoms, the canonical value is the
// SYNTHESIZED consensus, not the flat vehicles column (a Phase-1 cache being
// strangled per observation-model.md Phase 3). We reuse mcp-connector's
// synthesize_attribute (the one consensus engine) via an internal call rather than
// duplicate it. Returns null when no atoms exist → caller keeps the flat-column value.
async function deriveAttr(
  vehicleId: string,
  attribute: string,
): Promise<{ value: unknown; confidence: number | null } | null> {
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/mcp-connector`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "synthesize_attribute", arguments: { subject_id: vehicleId, attribute } },
      }),
    });
    if (!resp.ok) return null;
    const j = await resp.json();
    const text = j?.result?.content?.[0]?.text;
    if (!text) return null;
    const syn = JSON.parse(text);
    const c = syn?.consensus;
    const support = c?.observation_count ?? c?.support ?? 0;
    if (!c || c.label == null || support < 1) return null;
    return { value: c.label, confidence: c.weighted_confidence ?? null };
  } catch {
    return null; // synthesis unavailable → flat-column fallback, never block the package
  }
}

// Identity field → registry attribute. Only these prefer consensus; everything
// else stays on the flat column until its attribute is registered.
// Map each identity field to its registry attribute. A `format` coerces a
// structured consensus label to the SCALAR the consumers expect (BaT fill /
// eBay mapper want a string for color, never an object) — without it, a
// structured attribute would corrupt the consumer. `format` returning null
// skips the override (keeps the flat-column value).
const titleCase = (s: string) =>
  s.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/_/g, " ").trim();
function colorToString(v: unknown): string | null {
  if (typeof v === "string") return v ? titleCase(v) : null;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const color = o.color ?? o.name ?? o.value;
    if (!color) return null;
    const finish = o.finish ? `${o.finish} ` : "";
    return titleCase(`${finish}${String(color)}`);
  }
  return null;
}
const DERIVE_MAP: ReadonlyArray<{ key: string; attribute: string; format?: (v: unknown) => unknown }> = [
  { key: "title_status", attribute: "vehicle.title_status" },
  { key: "zip", attribute: "vehicle.zip" },
  { key: "owned_time", attribute: "vehicle.owned_time" },
  { key: "exterior_color", attribute: "vehicle.current_color", format: colorToString },
];

interface ListingPackage {
  platform: string;
  ars_score: number | null;
  tier: string | null;
  tier_warning: string | null;
  identity: Record<string, unknown>;
  listing_content: Record<string, unknown>;
  photos: {
    count: number;
    hero_image: string | null;
    zones_covered: string[];
    zones_missing: string[];
    ordered: Array<{
      url: string;
      zone: string | null;
      quality: number | null;
      caption: string | null;
    }>;
  };
  valuation: Record<string, unknown> | null;
  market_context: Record<string, unknown>;
  submission_fields: Record<string, unknown> | null;
}

// BaT submission field mapping (skeleton — full mapping in Sprint 3)
function mapToBatFields(
  v: Record<string, unknown>,
): Record<string, unknown> {
  return {
    title: `${v.year} ${v.make} ${v.model}${v.trim ? " " + v.trim : ""}`,
    make: v.make,
    model: v.model,
    year: v.year,
    vin: v.vin,
    mileage: v.mileage,
    transmission: v.transmission,
    drivetrain: v.drivetrain,
    engine: v.engine_type,
    body_style: v.body_style,
    exterior_color: v.color || v.color_primary,
    interior_color: v.interior_color,
    title_status: v.title_status,
    location: [v.city, v.state].filter(Boolean).join(", ") || v.location,
    reserve: null, // User must set
    _note:
      "Field mapping is a skeleton. Full BaT form automation comes in Sprint 4.",
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const vehicleId = body.vehicle_id;
    const platform = body.platform || "bat";

    if (!vehicleId) {
      return new Response(
        JSON.stringify({ error: "vehicle_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = getSupabase();

    // 1. Check/compute ARS
    let ars: Record<string, unknown> | null = null;
    {
      const { data } = await supabase
        .from("auction_readiness")
        .select("*")
        .eq("vehicle_id", vehicleId)
        .single();

      if (data) {
        ars = data;
      } else {
        // Compute fresh
        const { error } = await supabase.rpc("persist_auction_readiness", {
          p_vehicle_id: vehicleId,
        });
        if (!error) {
          const res = await supabase
            .from("auction_readiness")
            .select("*")
            .eq("vehicle_id", vehicleId)
            .single();
          ars = res.data;
        }
      }
    }

    // Tier vocabulary is single-sourced from compute_auction_readiness() (SQL) and
    // AuctionReadinessPanel TIER_LABELS: TIER_1_EXCEPTIONAL, TIER_2_COMPETITIVE,
    // TIER_3_VIABLE, TIER_4_INCOMPLETE, DISCOVERY_ONLY. (EARLY_STAGE / NEEDS_WORK are
    // legacy rows from an older scorer — they fall through to not-ready.)
    const tier = (ars?.tier as string) || null;
    const tierWarning =
      tier === "TIER_1_EXCEPTIONAL" || tier === "TIER_2_COMPETITIVE"
        ? null
        : tier === "TIER_3_VIABLE"
          ? "Vehicle is TIER_3_VIABLE — listing-ready with minor gaps. Use get_coaching_plan to strengthen."
          : `Vehicle is ${tier || "UNSCORED"} — not ready for submission. Use get_coaching_plan to close gaps.`;

    // 2. Pull full vehicle data
    const { data: v, error: vErr } = await supabase
      .from("vehicles")
      .select("*")
      .eq("id", vehicleId)
      .single();

    if (vErr || !v) {
      return new Response(
        JSON.stringify({ error: vErr?.message || "Vehicle not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 3. Pull photos ordered by zone priority then quality
    const { data: zoneOrder } = await supabase
      .from("photo_coverage_requirements")
      .select("zone, sort_position")
      .eq("platform", "universal")
      .order("sort_position");

    const zonePriority: Record<string, number> = {};
    for (const z of zoneOrder || []) {
      zonePriority[z.zone] = z.sort_position;
    }

    const { data: photos } = await supabase
      .from("vehicle_images")
      .select(
        "id, image_url, vehicle_zone, photo_quality_score, caption, display_order, taken_at",
      )
      .eq("vehicle_id", vehicleId)
      .or("is_duplicate.is.null,is_duplicate.eq.false")
      .order("display_order", { ascending: true, nullsFirst: false })
      .order("photo_quality_score", { ascending: false, nullsFirst: true })
      .limit(200);

    // Sort photos: hero first, then by zone priority, then by quality
    const sortedPhotos = (photos || []).sort((a, b) => {
      // Primary image first
      if (a.image_url === v.primary_image_url) return -1;
      if (b.image_url === v.primary_image_url) return 1;
      // Then by zone priority
      const za = a.vehicle_zone ? (zonePriority[a.vehicle_zone] ?? 99) : 99;
      const zb = b.vehicle_zone ? (zonePriority[b.vehicle_zone] ?? 99) : 99;
      if (za !== zb) return za - zb;
      // Then by quality
      return (b.photo_quality_score || 0) - (a.photo_quality_score || 0);
    });

    // 4. Pull valuation
    const { data: valuation } = await supabase
      .from("nuke_estimates")
      .select(
        "estimated_value, value_low, value_high, confidence_score, deal_score, heat_score, price_tier",
      )
      .eq("vehicle_id", vehicleId)
      .order("calculated_at", { ascending: false })
      .limit(1)
      .single();

    // 5. Pull comparable sales count
    const { count: compCount } = await supabase
      .from("nuke_estimates")
      .select("id", { count: "exact", head: true })
      .eq("vehicle_id", vehicleId);

    // 6. Assemble package
    const pkg: ListingPackage = {
      platform,
      ars_score: (ars?.composite_score as number) ?? null,
      tier: (ars?.tier as string) ?? null,
      tier_warning: tierWarning,
      identity: {
        year: v.year,
        make: v.make,
        model: v.model,
        trim: v.trim,
        vin: v.vin,
        engine_type: v.engine_type,
        engine_code: v.engine_code,
        displacement: v.displacement || v.engine_displacement,
        transmission: v.transmission,
        transmission_type: v.transmission_type,
        drivetrain: v.drivetrain,
        body_style: v.body_style,
        exterior_color: v.color || v.color_primary,
        interior_color: v.interior_color,
        mileage: v.mileage,
        title_status: v.title_status,
        location: [v.city, v.state].filter(Boolean).join(", ") || v.location,
        zip: v.zip_code ?? null,
        // owned_time = the purchase year (BaT asks "what year did you purchase"). Null-safe; never inferred.
        owned_time: v.purchase_date ? new Date(v.purchase_date).getFullYear() : null,
      },
      listing_content: {
        title: `${v.year} ${v.make} ${v.model}${v.trim ? " " + v.trim : ""}`,
        description: v.description,
        highlights: v.highlights,
        equipment: v.equipment,
        modifications: v.modifications,
        known_flaws: v.known_flaws,
        recent_service_history: v.recent_service_history,
        documents_on_hand: v.documents_on_hand,
        seller_name: v.seller_name,
      },
      photos: {
        count: sortedPhotos.length,
        hero_image: v.primary_image_url,
        zones_covered: (ars?.photo_zones_present as string[]) || [],
        zones_missing: (ars?.photo_zones_missing as string[]) || [],
        ordered: sortedPhotos.map(
          (p: Record<string, unknown>) => ({
            url: p.image_url as string,
            zone: p.vehicle_zone as string | null,
            quality: p.photo_quality_score as number | null,
            caption: p.caption as string | null,
          }),
        ),
      },
      valuation: valuation
        ? {
            nuke_estimate: valuation.estimated_value,
            range_low: valuation.value_low,
            range_high: valuation.value_high,
            confidence: valuation.confidence_score,
            deal_score: valuation.deal_score,
            heat_score: valuation.heat_score,
            price_tier: valuation.price_tier,
          }
        : null,
      market_context: {
        has_valuation: !!valuation,
        comparable_sales_available: (compCount || 0) > 0,
      },
      submission_fields:
        platform === "bat" ? mapToBatFields(v) : null,
    };

    // Derive-on-read pass: override flat-column values with synthesized consensus
    // where atoms exist, and record per-field provenance (powers the frozen,
    // attested listing_exports snapshot — what was submitted and why).
    const fieldProvenance: Record<string, unknown> = {};
    const derived = await Promise.all(
      DERIVE_MAP.map(async ({ key, attribute, format }) => {
        const d = await deriveAttr(vehicleId, attribute);
        if (!d) return null;
        const value = format ? format(d.value) : d.value;
        if (value == null) return null; // formatter rejected the shape → keep flat column
        return { key, attribute, value, confidence: d.confidence } as const;
      }),
    );
    for (const d of derived) {
      if (!d) continue;
      (pkg.identity as Record<string, unknown>)[d.key] = d.value;
      fieldProvenance[d.key] = {
        value: d.value,
        confidence: d.confidence,
        source: "synthesis",
        attribute: d.attribute,
      };
    }
    (pkg as Record<string, unknown>).field_provenance = fieldProvenance;

    return new Response(JSON.stringify(pkg, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

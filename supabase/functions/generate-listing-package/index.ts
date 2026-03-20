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

    const tierWarning =
      ars?.tier === "AUCTION_READY"
        ? null
        : ars?.tier === "NEARLY_READY"
          ? "Vehicle is NEARLY_READY — listing may have minor gaps."
          : `Vehicle is ${ars?.tier || "UNSCORED"} — not ready for submission. Use get_coaching_plan to close gaps.`;

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

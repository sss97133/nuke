/**
 * GET AUCTION BRIEFING — Composite one-call auction intelligence
 *
 * Returns everything needed to evaluate an auction in a single HTTP call:
 * - Vehicle identity + specs
 * - Live auction metrics (bids, views, watchers, bid velocity)
 * - Nuke Estimate valuation
 * - Seller analytics (sell-through, pricing, engagement, reserve behavior)
 * - Comparable sales
 * - Market history
 * - Comment sentiment
 * - Image condition analysis
 * - Description extraction
 *
 * POST /functions/v1/get-auction-briefing
 * Body: { "vehicle_id": "uuid" } OR { "listing_url": "https://..." }
 *
 * Caller: the service key only. The briefing is read with the service role, so it covers vehicles that
 * are not public; anyone else is refused before the body is read. CI deploys this folder.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { isServiceCaller, requireWriteAuth, writeAuthResponse } from "../_shared/writeGuard.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  // The caller is judged before the body is read: only the service key passes.
  const denied = await requireWriteAuth(req, { headers: corsHeaders });
  if (denied) return denied;
  if (!(await isServiceCaller(req))) {
    return writeAuthResponse({ status: 403, reason: "service key required" }, corsHeaders);
  }

  try {
    const body = await req.json().catch(() => ({}));
    let vehicleId = body.vehicle_id as string | undefined;
    const listingUrl = body.listing_url as string | undefined;

    if (!vehicleId && !listingUrl) {
      return json({ error: "Provide vehicle_id or listing_url" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Resolve vehicle_id from listing_url
    if (!vehicleId && listingUrl) {
      const { data: bl } = await supabase
        .from("bat_listings")
        .select("vehicle_id")
        .eq("bat_listing_url", listingUrl)
        .single();

      if (bl?.vehicle_id) {
        vehicleId = bl.vehicle_id;
      } else {
        const { data: ve } = await supabase
          .from("vehicle_events")
          .select("vehicle_id")
          .eq("source_url", listingUrl)
          .limit(1)
          .single();
        vehicleId = ve?.vehicle_id;
      }

      if (!vehicleId) {
        return json({ error: "No vehicle found for this listing URL" }, 404);
      }
    }

    // ── First parallel pass: all independent queries ─────────────────────
    const [
      vehicleRes,
      listingsRes,
      eventsRes,
      imagesRes,
      commentDiscRes,
      descDiscRes,
      obsRes,
      valuationRes,
    ] = await Promise.all([
      supabase.from("vehicles").select("*").eq("id", vehicleId).single(),

      supabase.from("bat_listings")
        .select("bat_listing_url, bat_listing_title, listing_status, sale_price, final_bid, reserve_price, starting_bid, bid_count, view_count, comment_count, seller_username, buyer_username, auction_start_date, auction_end_date")
        .eq("vehicle_id", vehicleId)
        .order("auction_end_date", { ascending: false })
        .limit(5),

      supabase.from("vehicle_events")
        .select("source_platform, event_type, source_url, sale_price, asking_price, auction_end_date, created_at")
        .eq("vehicle_id", vehicleId)
        .order("created_at", { ascending: false })
        .limit(20),

      supabase.from("vehicle_images")
        .select("url, angle, condition_score, photo_quality_score, damage_flags, modification_flags, ai_processing_status")
        .eq("vehicle_id", vehicleId)
        .order("condition_score", { ascending: false, nullsFirst: false })
        .limit(20),

      supabase.from("comment_discoveries")
        .select("overall_sentiment, sentiment_score, total_fields, raw_extraction, comment_count, data_quality_score")
        .eq("vehicle_id", vehicleId)
        .order("discovered_at", { ascending: false })
        .limit(1),

      supabase.from("description_discoveries")
        .select("total_fields, raw_extraction, keys_found, description_length")
        .eq("vehicle_id", vehicleId)
        .order("discovered_at", { ascending: false })
        .limit(1),

      supabase.from("vehicle_observations")
        .select("kind, content_text, structured_data, confidence_score, observed_at, source_id")
        .eq("vehicle_id", vehicleId)
        .order("observed_at", { ascending: false })
        .limit(20),

      supabase.from("vehicle_valuations")
        .select("estimated_value, confidence, value_range_low, value_range_high, deal_score, heat_score, price_tier, methodology")
        .eq("vehicle_id", vehicleId)
        .order("computed_at", { ascending: false })
        .limit(1),
    ]);

    const vehicle = vehicleRes.data;
    if (!vehicle) {
      return json({ error: "Vehicle not found" }, 404);
    }

    const listings = listingsRes.data || [];
    const activeListing = listings.find((l: any) => l.listing_status === "active") || listings[0];
    const sellerUsername = activeListing?.seller_username || vehicle.bat_seller;

    // ── Second parallel pass: comps + seller analytics ───────────────────
    const [compsResult, sellerAnalyticsResult] = await Promise.all([
      vehicle.make
        ? supabase.rpc("find_bat_comps", {
            p_make: vehicle.make,
            p_model: vehicle.model || null,
            p_year: vehicle.year || null,
            p_year_range: 3,
            p_limit: 10,
          }).then((r: any) => r.error ? { data: [] } : r)
        : Promise.resolve({ data: [] }),
      sellerUsername
        ? supabase.rpc("get_seller_analytics", { p_seller_username: sellerUsername })
            .then((r: any) => r.error ? { data: null } : r)
        : Promise.resolve({ data: null }),
    ]);

    const seller = sellerAnalyticsResult.data;
    const comps = compsResult?.data || [];

    // ── Compute derived metrics ──────────────────────────────────────────

    // Bid velocity
    let bidVelocity = null;
    if (activeListing?.listing_status === "active" && activeListing.bid_count && activeListing.auction_start_date) {
      const hoursElapsed = (Date.now() - new Date(activeListing.auction_start_date).getTime()) / 3600000;
      if (hoursElapsed > 0) {
        bidVelocity = Math.round((activeListing.bid_count / hoursElapsed) * 100) / 100;
      }
    }

    // Image condition aggregation
    const imgs = imagesRes.data || [];
    const analyzedImgs = imgs.filter((i: any) => i.ai_processing_status === "completed");
    const avgCondition = analyzedImgs.length > 0
      ? Math.round(analyzedImgs.reduce((s: number, i: any) => s + (i.condition_score || 0), 0) / analyzedImgs.length * 10) / 10
      : null;
    const damageFlags = [...new Set(analyzedImgs.flatMap((i: any) => i.damage_flags || []))];
    const modFlags = [...new Set(analyzedImgs.flatMap((i: any) => i.modification_flags || []))];

    // Price prediction vs comps
    let compMedianPrice = null;
    let priceVsComps = null;
    if (Array.isArray(comps) && comps.length > 0) {
      const compPrices = comps.map((c: any) => c.sale_price).filter(Boolean).sort((a: number, b: number) => a - b);
      if (compPrices.length > 0) {
        compMedianPrice = compPrices[Math.floor(compPrices.length / 2)];
        const currentPrice = activeListing?.final_bid || activeListing?.sale_price || vehicle.nuke_estimate;
        if (currentPrice && compMedianPrice) {
          priceVsComps = Math.round((currentPrice / compMedianPrice - 1) * 1000) / 10; // percentage
        }
      }
    }

    // ── Build briefing ───────────────────────────────────────────────────
    const briefing = {
      identity: {
        id: vehicle.id,
        vin: vehicle.vin,
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        trim: vehicle.trim,
        body_style: vehicle.body_style,
        engine: vehicle.engine_type,
        transmission: vehicle.transmission,
        drivetrain: vehicle.drivetrain,
        mileage: vehicle.mileage,
        exterior_color: vehicle.color,
        interior_color: vehicle.interior_color,
        location: vehicle.location || [vehicle.city, vehicle.state].filter(Boolean).join(", "),
      },

      auction: activeListing ? {
        url: activeListing.bat_listing_url,
        title: activeListing.bat_listing_title,
        status: activeListing.listing_status,
        current_bid: activeListing.final_bid,
        reserve_price: activeListing.reserve_price,
        starting_bid: activeListing.starting_bid,
        bid_count: activeListing.bid_count,
        view_count: activeListing.view_count,
        comment_count: activeListing.comment_count,
        bid_velocity_per_hour: bidVelocity,
        auction_start: activeListing.auction_start_date,
        auction_end: activeListing.auction_end_date,
        sale_price: activeListing.sale_price,
      } : null,

      valuation: {
        nuke_estimate: vehicle.nuke_estimate,
        confidence: vehicle.nuke_estimate_confidence,
        deal_score: vehicle.deal_score,
        heat_score: vehicle.heat_score,
        price_tier: vehicle.price_tier,
        cached_valuation: valuationRes.data?.[0] || null,
        comp_median_price: compMedianPrice,
        price_vs_comps_pct: priceVsComps,
      },

      seller: seller ? {
        username: seller.seller_username,
        total_listings: seller.total_listings,
        total_sold: seller.total_sold,
        sell_through_rate: seller.sell_through_rate,
        avg_sale_price: seller.avg_sale_price,
        median_sale_price: seller.median_sale_price,
        highest_sale: seller.highest_sale,
        total_gross_sales: seller.total_gross_sales,
        avg_sale_to_estimate_ratio: seller.avg_sale_to_estimate_ratio,
        avg_bid_count: seller.avg_bid_count,
        avg_comment_count: seller.avg_comment_count,
        no_reserve_count: seller.no_reserve_count,
        reserve_met_rate: seller.reserve_met_rate,
        primary_makes: seller.primary_makes,
        avg_days_between_listings: seller.avg_days_between_listings,
        recent_sales: seller.recent_sales,
      } : null,

      comps: Array.isArray(comps) ? comps.slice(0, 10).map((c: any) => ({
        year: c.v_year, make: c.v_make, model: c.v_model,
        sale_price: c.sale_price, engine: c.v_engine_size,
        sale_date: c.sale_date, url: c.bat_listing_url,
        bid_count: c.bid_count,
      })) : [],

      market_history: (eventsRes.data || []).map((e: any) => ({
        platform: e.source_platform,
        type: e.event_type,
        url: e.source_url,
        price: e.sale_price || e.asking_price,
        date: e.auction_end_date || e.created_at,
      })),

      sentiment: {
        comment_discovery: commentDiscRes.data?.[0] || null,
        description_discovery: descDiscRes.data?.[0] || null,
        recent_observations: (obsRes.data || []).slice(0, 5).map((o: any) => ({
          kind: o.kind,
          text: o.content_text?.slice(0, 200),
          confidence: o.confidence_score,
          date: o.observed_at,
        })),
      },

      condition: {
        avg_condition_score: avgCondition,
        analyzed_images: analyzedImgs.length,
        total_images: vehicle.image_count,
        damage_flags: damageFlags,
        modification_flags: modFlags,
        image_samples: imgs.slice(0, 5).map((i: any) => ({
          url: i.url, zone: i.angle, condition: i.condition_score, quality: i.photo_quality_score,
        })),
      },

      description: vehicle.description || null,
      highlights: vehicle.highlights || null,
      known_flaws: vehicle.known_flaws || null,
      modifications: vehicle.modifications || null,
    };

    return json({ success: true, briefing });
  } catch (error: any) {
    console.error("[get-auction-briefing] Error:", error);
    return json({ success: false, error: error.message }, 500);
  }
});

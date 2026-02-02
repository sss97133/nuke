/**
 * Report Marketplace Sale Outcome
 *
 * THE VALUABLE DATA ENDPOINT
 *
 * Captures actual transaction prices from:
 * 1. Owner self-reporting (highest confidence)
 * 2. Community reporting (requires consensus)
 *
 * POST /functions/v1/report-marketplace-sale
 * Body: {
 *   listing_id: string,
 *   sold_price: number,
 *   sold_at?: string (date),
 *   sold_to_type?: 'private_party' | 'dealer' | 'unknown',
 *   is_owner?: boolean,
 *   confidence?: 'certain' | 'likely' | 'guess',
 *   notes?: string
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      listing_id,
      sold_price,
      sold_at,
      sold_to_type = "unknown",
      is_owner = false,
      confidence = "likely",
      notes,
    } = await req.json();

    // Get user from auth header
    const authHeader = req.headers.get("Authorization");
    let userId: string | null = null;

    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      const { data: { user } } = await supabase.auth.getUser(token);
      userId = user?.id || null;
    }

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!listing_id) {
      return new Response(
        JSON.stringify({ error: "listing_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get listing
    const { data: listing, error: listingError } = await supabase
      .from("marketplace_listings")
      .select("*")
      .eq("id", listing_id)
      .single();

    if (listingError || !listing) {
      return new Response(
        JSON.stringify({ error: "Listing not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if already sold
    if (listing.status === "sold" && listing.sold_price_source === "owner_reported") {
      return new Response(
        JSON.stringify({
          success: true,
          message: "Sale already reported by owner",
          listing_id,
          sold_price: listing.sold_price,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const saleDate = sold_at ? new Date(sold_at) : new Date();

    // Owner-reported sale (direct update, highest confidence)
    if (is_owner && listing.contributed_by === userId) {
      const { error: updateError } = await supabase
        .from("marketplace_listings")
        .update({
          status: "sold",
          sold_at: saleDate.toISOString(),
          sold_price: sold_price,
          sold_price_source: "owner_reported",
          sold_to_type: sold_to_type,
        })
        .eq("id", listing_id);

      if (updateError) throw updateError;

      // Create timeline event if linked to vehicle
      if (listing.vehicle_id) {
        await supabase.from("timeline_events").insert({
          vehicle_id: listing.vehicle_id,
          event_type: "sale",
          event_date: saleDate.toISOString(),
          title: "Sold via Facebook Marketplace",
          description: `Sold for $${sold_price?.toLocaleString() || "undisclosed"} to ${sold_to_type}`,
          source: "owner_reported",
          confidence: 95,
          metadata: {
            platform: "facebook_marketplace",
            listing_id: listing_id,
            listing_url: listing.url,
            asking_price: listing.first_price,
            sold_price: sold_price,
            days_listed: listing.days_listed,
            price_difference: listing.first_price && sold_price
              ? listing.first_price - sold_price
              : null,
          },
        }).catch(() => {}); // Don't fail if timeline doesn't exist
      }

      // Award points
      await supabase.rpc("award_discovery_points", {
        p_user_id: userId,
        p_action: "sale_reported",
        p_points: 25,
      }).catch(() => {});

      return new Response(
        JSON.stringify({
          success: true,
          message: "Sale recorded",
          listing_id,
          sold_price,
          sold_at: saleDate.toISOString(),
          price_vs_asking: listing.first_price && sold_price
            ? `${((sold_price / listing.first_price) * 100 - 100).toFixed(1)}%`
            : null,
          days_to_sell: listing.days_listed,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Community-reported sale (requires consensus)
    const { error: reportError } = await supabase
      .from("marketplace_sale_reports")
      .insert({
        listing_id,
        reported_by: userId,
        reported_sold_price: sold_price,
        reported_sold_at: saleDate.toISOString(),
        sold_to_type,
        confidence,
        evidence_notes: notes,
      });

    if (reportError) {
      // Duplicate report
      if (reportError.code === "23505") {
        return new Response(
          JSON.stringify({ error: "You already reported this sale" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw reportError;
    }

    // Check for consensus (2+ reports)
    await supabase.rpc("process_marketplace_sale_reports", {
      p_listing_id: listing_id,
    }).catch(() => {});

    // Award points for community report
    await supabase.rpc("award_discovery_points", {
      p_user_id: userId,
      p_action: "community_sale_report",
      p_points: 10,
    }).catch(() => {});

    // Get updated report count
    const { count } = await supabase
      .from("marketplace_sale_reports")
      .select("*", { count: "exact", head: true })
      .eq("listing_id", listing_id);

    return new Response(
      JSON.stringify({
        success: true,
        message: count && count >= 2
          ? "Sale confirmed by community consensus"
          : "Sale report recorded, needs confirmation",
        listing_id,
        report_count: count,
        needs_confirmation: (count || 0) < 2,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Sale report error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

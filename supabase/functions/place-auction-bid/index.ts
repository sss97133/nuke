import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Get authenticated user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: authHeader },
        },
      }
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser();

    if (userError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Parse request body
    const { listing_id, proxy_max_bid_cents } = await req.json();

    if (!listing_id || !proxy_max_bid_cents) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing required fields: listing_id, proxy_max_bid_cents",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Validate bid amount
    if (proxy_max_bid_cents <= 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Bid amount must be greater than 0",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get client IP and user agent for audit
    const clientIP = req.headers.get("x-forwarded-for")?.split(",")[0] ||
      req.headers.get("x-real-ip") || "unknown";
    const userAgent = req.headers.get("user-agent") || "unknown";
    const bidSource = req.headers.get("x-bid-source") || "web";

    // Use service role client for secure function call
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Call the secure database function
    const { data, error } = await supabaseAdmin.rpc("place_auction_bid", {
      p_listing_id: listing_id,
      p_proxy_max_bid_cents: proxy_max_bid_cents,
      p_ip_address: clientIP,
      p_user_agent: userAgent,
      p_bid_source: bidSource,
    });

    if (error) {
      console.error("Bid placement error:", error);
      return new Response(
        JSON.stringify({
          success: false,
          error: error.message || "Failed to place bid",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // If bid was successful, create notifications
    if (data?.success) {
      // Notify seller
      await supabaseAdmin.from("user_notifications").insert({
        user_id: (await supabaseAdmin
          .from("vehicle_listings")
          .select("seller_id")
          .eq("id", listing_id)
          .single()).data?.seller_id,
        event_id: null,
        channel_type: "in_app",
        notification_title: "New Bid Received",
        notification_body: `Your auction received a bid of $${(data.displayed_bid_cents / 100).toFixed(2)}`,
        action_url: `/listings/${listing_id}`,
      });

      // Notify previous high bidder if they were outbid
      if (data.auction_extended) {
        // Broadcast auction extension via real-time
        await supabaseAdmin.channel(`auction:${listing_id}`).send({
          type: "auction_extended",
          listing_id,
          new_end_time: data.new_end_time,
        });
      }

      // Broadcast new bid via real-time
      await supabaseAdmin.channel(`auction:${listing_id}`).send({
        type: "bid_placed",
        listing_id,
        current_high_bid_cents: data.current_high_bid_cents,
        bid_count: data.bid_count,
        auction_extended: data.auction_extended,
        new_end_time: data.new_end_time,
      });
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Unexpected error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Internal server error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});


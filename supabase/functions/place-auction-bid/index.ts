import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-bid-source",
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
    const rawClientIP = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip")?.trim() || "";
    // Only pass through values that Postgres can cast to INET.
    const clientIP =
      rawClientIP && (rawClientIP.includes(":") || /^\d{1,3}(\.\d{1,3}){3}$/.test(rawClientIP))
        ? rawClientIP
        : null;
    const userAgent = req.headers.get("user-agent") || "unknown";
    const bidSource = req.headers.get("x-bid-source") || "web";

    // Call the secure database function with the USER context so auth.uid() is correct.
    const { data, error } = await supabaseClient.rpc("place_auction_bid", {
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


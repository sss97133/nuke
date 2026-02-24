/**
 * Stripe Checkout Session Creator
 *
 * Creates a Stripe Checkout session for upgrading API access tier.
 * Tiers: Free (default), Pro ($99/mo, 10K req/day), Enterprise ($499/mo, 100K req/day).
 *
 * Authentication: Bearer token (Supabase JWT)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const TIERS: Record<string, { name: string; priceId: string; dailyLimit: number }> = {
  pro: {
    name: "Pro",
    priceId: Deno.env.get("STRIPE_PRO_PRICE_ID") || "",
    dailyLimit: 10000,
  },
  enterprise: {
    name: "Enterprise",
    priceId: Deno.env.get("STRIPE_ENTERPRISE_PRICE_ID") || "",
    dailyLimit: 100000,
  },
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      return jsonResponse({ error: "Stripe not configured" }, 503);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Authenticate
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Authentication required" }, 401);
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return jsonResponse({ error: "Invalid token" }, 401);
    }

    const body = await req.json();
    const tier = body.tier as string;

    if (!tier || !TIERS[tier]) {
      return jsonResponse({ error: "Invalid tier. Choose: pro, enterprise" }, 400);
    }

    const tierConfig = TIERS[tier];
    if (!tierConfig.priceId) {
      return jsonResponse({ error: `Stripe price not configured for ${tier} tier` }, 503);
    }

    // Get or create Stripe customer
    let stripeCustomerId: string | null = null;

    const { data: sub } = await supabase
      .from("api_access_subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (sub?.stripe_customer_id) {
      stripeCustomerId = sub.stripe_customer_id;
    } else {
      // Create Stripe customer
      const customerRes = await fetch("https://api.stripe.com/v1/customers", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          email: user.email || "",
          "metadata[user_id]": user.id,
        }),
      });
      const customer = await customerRes.json();
      if (!customer.id) {
        return jsonResponse({ error: "Failed to create Stripe customer" }, 500);
      }
      stripeCustomerId = customer.id;

      // Store customer ID
      await supabase.from("api_access_subscriptions").upsert({
        user_id: user.id,
        stripe_customer_id: stripeCustomerId,
        subscription_type: "free",
        status: "active",
      }, { onConflict: "user_id" });
    }

    // Create Checkout Session
    const origin = req.headers.get("origin") || "https://nuke.ag";
    const sessionRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        customer: stripeCustomerId!,
        "line_items[0][price]": tierConfig.priceId,
        "line_items[0][quantity]": "1",
        mode: "subscription",
        success_url: `${origin}/developers/dashboard?upgraded=${tier}`,
        cancel_url: `${origin}/developers/dashboard`,
        client_reference_id: user.id,
        "metadata[user_id]": user.id,
        "metadata[purchase_type]": "api_access_subscription",
        "metadata[subscription_type]": "monthly",
        "metadata[tier]": tier,
      }),
    });

    const session = await sessionRes.json();
    if (!session.url) {
      console.error("Stripe session error:", session);
      return jsonResponse({ error: "Failed to create checkout session" }, 500);
    }

    return jsonResponse({ url: session.url });
  } catch (err) {
    console.error("Stripe checkout error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});

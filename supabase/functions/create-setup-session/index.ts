// Supabase Edge Function: create-setup-session
// Purpose: Create a Stripe Checkout Session in setup mode to collect and verify a payment method
// Secrets required: STRIPE_SECRET_KEY
// POST body: { success_url: string, cancel_url: string }

import { serve } from "https://deno.land/std@0.177.1/http/server.ts";
import Stripe from "npm:stripe@12.9.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
if (!STRIPE_SECRET_KEY) {
  console.warn("STRIPE_SECRET_KEY not set; create-setup-session will fail until configured");
}
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  try {
    const auth = req.headers.get("authorization");
    if (!auth) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { success_url, cancel_url } = await req.json().catch(() => ({}));
    if (!success_url || !cancel_url) {
      return json({ ok: false, error: "Missing success_url or cancel_url" }, 200);
    }

    const stripe = new Stripe(STRIPE_SECRET_KEY!, { apiVersion: "2024-06-20" });

    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      payment_method_types: ["card"],
      success_url,
      cancel_url,
      client_reference_id: user.id,
      metadata: { user_id: user.id },
    });

    return json({ ok: true, url: session.url });
  } catch (e) {
    const msg = (e as Error)?.message || String(e);
    return json({ ok: false, error: msg }, 200);
  }
});

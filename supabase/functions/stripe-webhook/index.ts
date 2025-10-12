import { serve } from "https://deno.land/std@0.177.1/http/server.ts";
import Stripe from "npm:stripe@12.9.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE);

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const signature = req.headers.get("stripe-signature");
    if (!signature) {
      return new Response("No signature", { status: 400 });
    }

    const body = await req.text();
    const event = stripe.webhooks.constructEvent(
      body,
      signature,
      STRIPE_WEBHOOK_SECRET
    );

    console.log(`Processing webhook event: ${event.type}`);

    switch (event.type) {
      case "setup_intent.succeeded": {
        const setupIntent = event.data.object as Stripe.SetupIntent;
        const userId = setupIntent.metadata?.user_id || setupIntent.client_reference_id;
        
        if (userId) {
          await supabaseAdmin
            .from("profiles")
            .update({ payment_verified: true })
            .eq("id", userId);
          
          console.log(`Marked payment_verified for user ${userId}`);
        }
        break;
      }

      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.user_id || session.client_reference_id;
        
        if (userId && session.mode === "setup") {
          await supabaseAdmin
            .from("profiles")
            .update({ payment_verified: true })
            .eq("id", userId);
          
          console.log(`Marked payment_verified for user ${userId} from checkout session`);
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Webhook error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
});

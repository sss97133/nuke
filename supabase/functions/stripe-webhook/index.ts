/**
 * stripe-webhook — fulfills Stripe checkouts by crediting the AI credit ledger.
 *
 * This is the missing funding-in wire: `create-api-access-checkout` opens a Stripe
 * Checkout with `metadata.user_id` (+ `amount_cents` for wallet top-ups), but until
 * now nothing granted the funds on success. This handler does.
 *
 * Deploy WITHOUT JWT verification (Stripe calls it unauthenticated; we verify the
 * Stripe signature instead):
 *   supabase functions deploy stripe-webhook --no-verify-jwt
 * Then register the endpoint in the Stripe dashboard and set STRIPE_WEBHOOK_SECRET.
 *
 * Idempotent: each Stripe event id is recorded as the ledger row `ref`, and we skip
 * events whose id is already present, so Stripe's at-least-once delivery can't
 * double-credit a user.
 *
 * @owner external-agent-write-api
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@14.11.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { creditCents } from "../_shared/aiCredits.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", { apiVersion: "2023-10-16" });

function svc() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function alreadyProcessed(supabase: any, eventId: string): Promise<boolean> {
  const { data } = await supabase.from("ai_credit_ledger").select("id").eq("ref", eventId).limit(1).maybeSingle();
  return !!data;
}

/** Resolve cents to credit from the checkout session metadata. */
function centsFromSession(s: Stripe.Checkout.Session): number {
  const meta = s.metadata ?? {};
  // Wallet top-up: explicit cents.
  if (meta.amount_cents) return Number(meta.amount_cents);
  // Credit pack: convert "credits" (image-analysis units) at 1 credit = the price/credit.
  // For the AI wallet we credit the amount actually paid (the truest "you funded $X").
  if (s.amount_total != null) return Number(s.amount_total);
  return 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const sig = req.headers.get("stripe-signature");
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const raw = await req.text();

  let event: Stripe.Event;
  try {
    if (!sig || !secret) throw new Error("missing signature or STRIPE_WEBHOOK_SECRET");
    event = await stripe.webhooks.constructEventAsync(raw, sig, secret);
  } catch (e) {
    console.error("[stripe-webhook] signature verify failed:", e instanceof Error ? e.message : e);
    return new Response("invalid signature", { status: 400 });
  }

  const supabase = svc();

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.user_id ?? session.client_reference_id ?? null;
      const cents = centsFromSession(session);

      if (!userId) { console.warn("[stripe-webhook] no user_id on session", session.id); return ok(); }
      if (cents <= 0) { console.warn("[stripe-webhook] zero credit amount", session.id); return ok(); }
      if (await alreadyProcessed(supabase, event.id)) return ok(); // idempotent

      await creditCents(supabase, userId, cents, event.id, {
        stripe_session: session.id,
        purchase_type: session.metadata?.purchase_type ?? null,
        amount_total: session.amount_total,
        currency: session.currency,
      });
      console.log(`[stripe-webhook] credited ${cents}¢ to ${userId} (event ${event.id})`);
    }
    return ok();
  } catch (e) {
    console.error("[stripe-webhook] handler error:", e instanceof Error ? e.message : e);
    return new Response("handler error", { status: 500 });
  }
});

function ok(): Response {
  return new Response(JSON.stringify({ received: true }), { headers: { "content-type": "application/json" } });
}

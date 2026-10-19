/**
 * create-work-order-invoice-checkout — opens a Stripe Checkout for the balance due on a work order's current invoice.
 *
 * POST { work_order_id } with the customer's session. work_order_invoice_checkout decides who may pay and how much
 * (only the work order customer, only the current invoice version, only a balance due, two-decimal currencies).
 * Stripe charges only if the customer completes the hosted page; stripe-webhook then records the payment through
 * record_work_order_processor_payment. Collection only: no transfer, payout or release to the provider.
 * Writes nothing to the database; returns { checkout_url } or { refused } (409).
 *
 * @owner mechanics
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@14.11.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { projectPublishableKey, projectSecretKey } from "../_shared/supabaseKeys.ts";
import { checkoutParams, type CheckoutTerms } from "./checkout.ts";

const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);
  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const url = Deno.env.get("SUPABASE_URL");
    if (!stripeKey || !url) return json({ error: "Payments are not configured" }, 503);
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Sign in to pay" }, 401);
    const asUser = createClient(url, projectPublishableKey()!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json({ error: "Sign in to pay" }, 401);

    const body = await req.json().catch(() => ({}));
    const workOrderId = body?.work_order_id;
    if (typeof workOrderId !== "string" || !UUID.test(workOrderId)) return json({ error: "work_order_id required" }, 400);

    const svc = createClient(url, projectSecretKey()!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: terms, error } = await svc.rpc("work_order_invoice_checkout", { p_user: user.id, p_work_order_id: workOrderId });
    if (error) throw new Error(error.message);
    if (!terms || terms.refused) return json({ refused: terms?.refused ?? "unavailable" }, 409);

    const { params, idempotencyKey } = checkoutParams(terms as CheckoutTerms, user.id, Deno.env.get("FRONTEND_URL") || "https://nuke.ag");
    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });
    const session = await stripe.checkout.sessions.create(params, { idempotencyKey });
    return json({
      checkout_url: session.url, work_order_id: workOrderId, invoice_id: terms.invoice_id, invoice_version: terms.invoice_version,
      amount: terms.balance_due, currency: terms.currency, disbursement: "not_performed",
    });
  } catch (e) {
    console.error("[create-work-order-invoice-checkout]", e instanceof Error ? e.message : e);
    return json({ error: "Checkout unavailable" }, 500);
  }
});

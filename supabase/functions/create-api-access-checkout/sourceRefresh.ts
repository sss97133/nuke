import { intakeThrottle } from "../poll-listing-feeds/ledger.ts";

export const FUNDING_CONTRACT = "source_refresh_funding_v1";
export const FUNDING_SOURCE = "source-refresh-funding";
const slug = /^[a-z0-9_-]{1,64}$/;
export interface RefreshQuote {
  source: string;
  feed_source: string;
  provider: "openai" | "anthropic" | "google";
  amount_cents: number;
  max_ingests: number;
  billing_reference: string;
}

/** No defaults for money or replenishment. An operator must verify the actual
 * provider billing connection before enabling contributions. A Stripe balance
 * or a Nuke wallet balance is not evidence of provider credit. */
export function refreshQuote(source: unknown, raw: any, controls: unknown, alreadyFunded = false): RefreshQuote | null {
  if (typeof source !== "string" || !slug.test(source) || raw?.enabled !== true) return null;
  const c = raw.sources?.[source];
  // No source-bound provider reservation/settlement owner is connected yet.
  // Billing verification and a contribution price cannot cap unknown API spend.
  // Keep public paid checkout closed even if an operator toggles a source policy.
  if (c?.needs_funding === true) return null;
  if (!c || c.enabled !== true || typeof c.needs_funding !== "boolean" || !slug.test(c.feed_source ?? "") ||
      !["openai", "anthropic", "google"].includes(c.provider) ||
      c.replenishment_mode !== "subscription_credit" || c.allow_provider_charges !== false || c.billing_verified !== true ||
      typeof c.billing_reference !== "string" || !c.billing_reference.trim() ||
      !Number.isSafeInteger(c.amount_cents) || c.amount_cents < 0 || c.amount_cents > 10000 || (c.needs_funding && c.amount_cents < 100) ||
      (!c.needs_funding && c.amount_cents !== 0) ||
      !Number.isSafeInteger(c.max_ingests) || c.max_ingests < 1 || c.max_ingests > 5) return null;
  const t = intakeThrottle(controls ?? {});
  if (!t.enabled || t.max_feeds === 0 || t.max_ingests === 0 ||
      t.sources[c.feed_source]?.enabled === false || t.sources[c.feed_source]?.max_ingests === 0) return null;
  return { source, feed_source: c.feed_source, provider: c.provider, amount_cents: c.amount_cents,
    max_ingests: Math.min(c.max_ingests, t.max_ingests, t.sources[c.feed_source]?.max_ingests ?? 5),
    billing_reference: c.billing_reference };
}

export async function readRefreshQuote(db: any, source: unknown, alreadyFunded = false): Promise<RefreshQuote | null> {
  const { data, error } = await db.from("platform_config").select("config_key,config_value")
    .in("config_key", ["source_refresh_funding", "source_intake"]);
  if (error || !Array.isArray(data)) throw new Error("Source funding status unavailable");
  const config = Object.fromEntries(data.map((r: any) => [r.config_key, r.config_value]));
  const quote = refreshQuote(source, config.source_refresh_funding, config.source_intake, alreadyFunded);
  if (!quote) return null;
  // The selected existing collector must still be enabled. Funding never flips it.
  const { data: feeds, error: feedError } = await db.from("listing_feeds").select("id")
    .eq("source_slug", quote.feed_source).eq("enabled", true).limit(1);
  if (feedError) throw new Error("Source collector status unavailable");
  return feeds?.length ? quote : null;
}

export async function sourceRefreshCheckout(req: Request, body: any, db: any, stripe: any): Promise<Record<string, unknown>> {
  const quote = await readRefreshQuote(db, body.source);
  if (body.action === "source_refresh_status") {
    let receipt: Record<string, unknown> | null = null;
    if (body.request_id) {
      const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      const { data: auth } = await db.auth.getUser(token);
      if (auth?.user) {
        const { data, error } = await db.from("extraction_runs").select("id,status,metadata,completed_at")
          .eq("id", body.request_id).eq("source", FUNDING_SOURCE)
          .eq("metadata->>user_id", auth.user.id).eq("metadata->>source", body.source).maybeSingle();
        if (error) throw new Error("Refresh receipt unavailable");
        if (data) receipt = { id: data.id, status: data.status, completed_at: data.completed_at,
          payment_required: data.metadata?.amount_cents > 0,
          run_id: data.metadata?.run_id ?? null, result: data.metadata?.result ?? null };
      }
    }
    return quote ? { available: true, requires_payment: quote.amount_cents > 0, source: quote.source, provider: quote.provider, receipt,
      amount_cents: quote.amount_cents, max_ingests: quote.max_ingests }
      : { available: false, receipt, reason: "Provider funding is not connected for this source yet. No payment can be taken." };
  }
  if (!quote) throw new Error("Provider funding is not connected for this source; no checkout created");
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authError } = await db.auth.getUser(token);
  if (authError || !auth?.user) throw new Error("Sign in to fund a source refresh");
  const user = auth.user.id;
  if (!/^[0-9a-f-]{36}$/i.test(body.request_id ?? "")) throw new Error("Invalid refresh request");
  const free = quote.amount_cents === 0;
  if ((body.action === "source_refresh_request") !== free) throw new Error(free ? "Refresh is available without payment" : "Source funding is required");
  const key = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  if (!free && !/^(sk|rk)_(live|test)_/.test(key)) throw new Error("Payment connection unavailable");
  const live = /^(sk|rk)_live_/.test(key);
  if (!free && !live) throw new Error("Source funding requires a live payment connection");
  const id = body.request_id;
  const metadata = { contract: FUNDING_CONTRACT, user_id: user, ...quote, expected_livemode: free ? null : live };
  const { data: prior, error: priorError } = await db.from("extraction_runs").select("id")
    .eq("id", id).eq("source", FUNDING_SOURCE).maybeSingle();
  if (priorError) throw new Error("Refresh requests unavailable");
  if (!prior) {
    // Reuse the existing atomic rate-limit owner, failing closed for new work.
    const start = Math.floor(Date.now() / 900_000) * 900_000;
    const { data: count, error: limitError } = await db.rpc("rate_limit_increment", {
      p_key: `source-refresh:${user}:${quote.source}:${start}`,
      p_window_start: new Date(start).toISOString(), p_expires_at: new Date(start + 900_000).toISOString(),
    });
    if (limitError || !Number.isSafeInteger(count) || count < 1 || count > (free ? 1 : 5)) throw new Error("A refresh was requested recently; try again later");
    {
      // Paid and existing-capacity requests share one feed allowance, including
      // source aliases. A contribution cannot buy its way around source cadence.
      const { data: sharedCount, error: sharedError } = await db.rpc("rate_limit_increment", {
        p_key: `source-refresh-shared:${quote.feed_source}:${start}`,
        p_window_start: new Date(start).toISOString(), p_expires_at: new Date(start + 900_000).toISOString(),
      });
      if (sharedError || !Number.isSafeInteger(sharedCount) || sharedCount < 1 || sharedCount > 3) throw new Error("This source has refreshes queued; try again later");
    }
  }
  const { error: insertError } = await db.from("extraction_runs").insert({ id, source: FUNDING_SOURCE,
    status: free ? "funded" : "awaiting_payment", started_at: new Date().toISOString(), metadata, vehicles_created: null, vehicles_updated: null });
  if (insertError && insertError.code !== "23505") throw new Error("Refresh request could not be recorded");
  const { data: stored, error: readError } = await db.from("extraction_runs").select("status,metadata,started_at")
    .eq("id", id).eq("source", FUNDING_SOURCE).maybeSingle();
  if (readError || !stored || !free && stored.status !== "awaiting_payment" || stored.metadata?.user_id !== user ||
      Object.keys(metadata).some(k => stored.metadata[k] !== (metadata as any)[k]) ||
      !Number.isFinite(Date.parse(stored.started_at)) || Date.now() - Date.parse(stored.started_at) > 30 * 60_000) {
    throw new Error("Refresh quote expired or changed; open a new request");
  }
  if (free) return { request_id: id, payment_required: false };
  const site = new URL(Deno.env.get("SITE_URL") || "https://nuke.ag");
  if (site.protocol !== "https:") throw new Error("Checkout return site unavailable");
  const back = new URL("/", site);
  back.searchParams.set("tab", "market");
  back.searchParams.set("refresh_source", quote.source);
  back.searchParams.set("refresh", id);
  const session = await stripe.checkout.sessions.create({
    mode: "payment", payment_method_types: ["card"], client_reference_id: user,
    payment_intent_data: { metadata: { purchase_type: "source_refresh", request_id: id, user_id: user } },
    line_items: [{ price_data: { currency: "usd", unit_amount: quote.amount_cents,
      product_data: { name: "Source refresh funding", description:
        `Fund shared ${quote.provider} API costs and one ${quote.source} feed refresh, up to ${quote.max_ingests} listing admissions. This is not a personal credit deposit.` } }, quantity: 1 }],
    success_url: back.toString(), cancel_url: new URL("/?tab=market", site).toString(),
    expires_at: Math.floor(Date.parse(stored.started_at) / 1000) + 61 * 60,
    metadata: { purchase_type: "source_refresh", request_id: id, user_id: user },
  }, { idempotencyKey: `source-refresh:${id}` });
  return { checkout_url: session.url, request_id: id };
}

/**
 * AI credits — prepaid, append-only money for the Claude usage funnel.
 *
 * Backed by `ai_credit_ledger` (created 2026-06-21). Balance is DERIVED from the
 * ledger via the `ai_credit_available_cents()` SQL function — never stored mutable,
 * so it cannot drift. A user can never spend more than they funded.
 *
 * The reserve-then-settle dance for a metered call:
 *   1. holdCredits(estimate)  → returns hold_id, drops available by the estimate
 *   2. run the platform-key call, read Anthropic `usage` tokens
 *   3. settleHold(hold_id, actualCents)  → closes the hold, books real spend
 *      (if actual < estimate the difference is automatically released)
 *
 * Funding-in (Stripe) appends a `topup` row — see the webhook wiring TODO in
 * connect-claude / a future stripe-webhook handler.
 *
 * @owner external-agent-write-api
 */

// ── Claude pricing (USD per 1M tokens) — VERIFY before billing real money ──────
// Platform-key spend is priced here, then marked up by PLATFORM_MARGIN so Nuke
// isn't billing at cost. These are list prices as of the knowledge cutoff; confirm
// against current Anthropic pricing before this charges anyone.
const PRICING_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-opus-4-8":   { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3,  output: 15 },
  "claude-haiku-4-5":  { input: 1,  output: 5  },
  "claude-haiku-5-5":  { input: 0.1, output: 0.5 }, // official short-context price, verified 2026-10-18
};
const DEFAULT_MODEL = "claude-opus-4-8";
function platformMargin(): number {
  const margin = Number(Deno.env.get("AI_CREDIT_MARGIN") ?? "1.2");
  if (!Number.isFinite(margin) || margin < 1 || margin > 10) throw new Error("invalid AI credit margin");
  return margin;
}

export interface ClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
}

/** Convert Anthropic `usage` + model into cents to bill (cost × margin, rounded up). */
export function usageToCents(model: string, usage: ClaudeUsage, margin = platformMargin()): number {
  if (!Number.isFinite(margin) || margin < 1 || margin > 10) throw new Error("invalid AI credit margin");
  const p = PRICING_PER_MTOK[model] ?? PRICING_PER_MTOK[DEFAULT_MODEL];
  const inTok = usage.input_tokens ?? 0;
  const outTok = usage.output_tokens ?? 0;
  const dollars = ((inTok * p.input) + (outTok * p.output)) / 1_000_000;
  return Math.ceil(dollars * margin * 100);
}

/** Rough pre-call estimate for the hold, from expected output budget. */
export function estimateCents(model: string, expectedInputTokens: number, maxOutputTokens: number, margin = platformMargin()): number {
  return usageToCents(model, { input_tokens: expectedInputTokens, output_tokens: maxOutputTokens }, margin);
}

export async function availableCents(supabase: any, userId: string): Promise<number> {
  const { data, error } = await supabase.rpc("ai_credit_available_cents", { p_user_id: userId });
  if (error) throw new Error(`availableCents: ${error.message}`);
  return Number(data ?? 0);
}

/** Append a topup (Stripe funding lands here). */
export async function creditCents(
  supabase: any, userId: string, cents: number, ref: string, metadata: Record<string, unknown> = {},
): Promise<void> {
  if (cents <= 0) throw new Error("creditCents: amount must be > 0");
  const { error } = await supabase.from("ai_credit_ledger").insert({
    user_id: userId, entry_type: "topup", amount_cents: Math.round(cents), status: "closed", ref, metadata,
  });
  if (error) {
    // 23505 = unique_violation on the partial UNIQUE(ref) topup index: a concurrent Stripe
    // re-delivery already credited this event. Idempotent — treat as success, never double-credit.
    if (error.code === "23505" || /duplicate key|unique constraint/i.test(error.message ?? "")) return;
    throw new Error(`creditCents: ${error.message}`);
  }
}

/**
 * Reserve `cents` against a job. Returns the hold id, or null if insufficient funds.
 * The existing ledger's service-only writer serializes reservation and settlement
 * per account. Never check a balance and insert a debit in separate requests.
 */
export async function holdCredits(
  supabase: any, userId: string, cents: number, ref: string, metadata: Record<string, unknown> = {},
): Promise<string | null> {
  const result = await reserveCredits(supabase, userId, cents, ref, metadata);
  return result.status === "reserved" ? result.hold_id : null;
}

export async function reserveCredits(supabase: any, userId: string, cents: number, ref: string,
  metadata: Record<string, unknown> = {}): Promise<{ status: "reserved"; hold_id: string } | { status: "insufficient_funds" | "duplicate" }> {
  if (!Number.isSafeInteger(cents) || cents < 1) throw new Error("invalid credit reservation amount");
  const { data, error } = await supabase.rpc("reserve_ai_credit_hold", {
    p_user_id: userId, p_cents: cents, p_ref: ref, p_metadata: metadata,
  });
  if (error || !data || !["reserved", "insufficient_funds", "duplicate"].includes(data.status) ||
      data.status === "reserved" && typeof data.hold_id !== "string") throw new Error("credit reservation unavailable");
  return data;
}

/**
 * Close a hold and book the actual spend. The hold's reservation is released
 * (status→closed) and a `settle` row records the real cents. If the call never
 * happened (actualCents=0) the hold is simply released — no charge.
 */
export async function settleHold(
  supabase: any, userId: string, holdId: string, actualCents: number, metadata: Record<string, unknown> = {},
): Promise<void> {
  if (!Number.isSafeInteger(actualCents) || actualCents < 0) throw new Error("invalid credit settlement amount");
  const { data, error } = await supabase.rpc("settle_ai_credit_hold", {
    p_user_id: userId, p_hold_id: holdId, p_cents: actualCents, p_metadata: metadata,
  });
  if (error || !data || !["settled", "already_settled"].includes(data.status)) throw new Error("credit settlement unavailable");
}

/** Release a hold without charging (e.g. the call failed before incurring cost). */
export async function releaseHold(supabase: any, userId: string, holdId: string, metadata: Record<string, unknown> = {}): Promise<void> {
  await settleHold(supabase, userId, holdId, 0, metadata);
}

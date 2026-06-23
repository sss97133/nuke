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
};
const DEFAULT_MODEL = "claude-opus-4-8";
const PLATFORM_MARGIN = Number(Deno.env.get("AI_CREDIT_MARGIN") ?? "1.2"); // 20% over cost

export interface ClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
}

/** Convert Anthropic `usage` + model into cents to bill (cost × margin, rounded up). */
export function usageToCents(model: string, usage: ClaudeUsage): number {
  const p = PRICING_PER_MTOK[model] ?? PRICING_PER_MTOK[DEFAULT_MODEL];
  const inTok = usage.input_tokens ?? 0;
  const outTok = usage.output_tokens ?? 0;
  const dollars = ((inTok * p.input) + (outTok * p.output)) / 1_000_000;
  return Math.ceil(dollars * PLATFORM_MARGIN * 100);
}

/** Rough pre-call estimate for the hold, from expected output budget. */
export function estimateCents(model: string, expectedInputTokens: number, maxOutputTokens: number): number {
  return usageToCents(model, { input_tokens: expectedInputTokens, output_tokens: maxOutputTokens });
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
 * Reads available, then inserts the hold — there's a small TOCTOU window; for an
 * MVP that's acceptable (worst case two concurrent jobs both pass with a thin
 * balance). Tighten later with a SECURITY DEFINER RPC that checks+inserts atomically.
 */
export async function holdCredits(
  supabase: any, userId: string, cents: number, ref: string, metadata: Record<string, unknown> = {},
): Promise<string | null> {
  const amount = Math.max(1, Math.round(cents));
  const avail = await availableCents(supabase, userId);
  if (avail < amount) return null;
  const { data, error } = await supabase.from("ai_credit_ledger").insert({
    user_id: userId, entry_type: "hold", amount_cents: -amount, status: "open", ref, metadata,
  }).select("id").single();
  if (error) throw new Error(`holdCredits: ${error.message}`);
  return data.id as string;
}

/**
 * Close a hold and book the actual spend. The hold's reservation is released
 * (status→closed) and a `settle` row records the real cents. If the call never
 * happened (actualCents=0) the hold is simply released — no charge.
 */
export async function settleHold(
  supabase: any, userId: string, holdId: string, actualCents: number, metadata: Record<string, unknown> = {},
): Promise<void> {
  const charge = Math.max(0, Math.round(actualCents));
  // Release the reservation. Capture which rows actually flipped open->closed: if none
  // (a duplicate/replayed settle), the hold was already settled — return without inserting
  // a second `settle` debit row (idempotent against double-debit).
  const { data: released, error: relErr } = await supabase.from("ai_credit_ledger")
    .update({ status: "closed" }).eq("id", holdId).eq("user_id", userId).eq("status", "open")
    .select("id");
  if (relErr) throw new Error(`settleHold release: ${relErr.message}`);
  if (!released || released.length === 0) return; // already settled/released — idempotent no-op
  if (charge > 0) {
    const { error } = await supabase.from("ai_credit_ledger").insert({
      user_id: userId, entry_type: "settle", amount_cents: -charge, hold_id: holdId, status: "closed",
      ref: "settle", metadata,
    });
    if (error) throw new Error(`settleHold charge: ${error.message}`);
  }
}

/** Release a hold without charging (e.g. the call failed before incurring cost). */
export async function releaseHold(supabase: any, userId: string, holdId: string): Promise<void> {
  await settleHold(supabase, userId, holdId, 0);
}

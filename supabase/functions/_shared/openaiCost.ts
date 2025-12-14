/**
 * Minimal OpenAI usage + cost estimator for Supabase Edge Functions.
 *
 * We treat cost as an *estimate* derived from `response.usage`.
 * If you want perfect accuracy, store usage + model (we do), and compute cost
 * offline with a pricing table at report time.
 */
export type OpenAiUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

type ModelPricing = { input_per_1m: number; output_per_1m: number };

// Default pricing map (USD per 1M tokens). Keep this conservative and easy to update.
// If you need to override without redeploying, set OPENAI_PRICING_JSON env var to:
// { "gpt-4o": { "input_per_1m": 5, "output_per_1m": 15 }, ... }
const DEFAULT_PRICING_USD_PER_1M: Record<string, ModelPricing> = {
  // NOTE: Update as needed; used for *estimates* only.
  "gpt-4o": { input_per_1m: 5, output_per_1m: 15 },
  "gpt-4o-mini": { input_per_1m: 0.15, output_per_1m: 0.6 },
};

function getPricingTable(): Record<string, ModelPricing> {
  try {
    const raw = Deno.env.get("OPENAI_PRICING_JSON");
    if (!raw) return DEFAULT_PRICING_USD_PER_1M;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return DEFAULT_PRICING_USD_PER_1M;
    return { ...DEFAULT_PRICING_USD_PER_1M, ...parsed };
  } catch {
    return DEFAULT_PRICING_USD_PER_1M;
  }
}

export function estimateOpenAiCostUsd(model: string, usage: OpenAiUsage | null | undefined): number | null {
  if (!model || !usage) return null;
  const table = getPricingTable();
  const pricing = table[model];
  if (!pricing) return null;

  const inTok = Number(usage.prompt_tokens || 0);
  const outTok = Number(usage.completion_tokens || 0);
  if (!Number.isFinite(inTok) || !Number.isFinite(outTok)) return null;

  const cost = (inTok * pricing.input_per_1m) / 1_000_000 + (outTok * pricing.output_per_1m) / 1_000_000;
  // Guard against weird negatives.
  if (!Number.isFinite(cost) || cost < 0) return null;
  return cost;
}



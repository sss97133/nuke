// DRAFT — not deployed. Lives under supabase/drafts/ so no function deploy picks it up.
// Target location once approved: supabase/functions/_shared/resolveModel.ts
//
// One resolver for every edge function:
//   const plan = await resolveModel("photo_classify", { fallback: HARDCODED_TODAY });
//   for (const m of plan.chain) { try { return await callWith(m); } catch (e) { if (!retryable(e)) throw e; } }
//   if (plan.shadow) queueMicrotask(() => runShadow(plan.shadow!, input));   // never blocks or changes the answer
//
// Guarantees
// * Never throws because of the registry: if the RPC fails or returns nothing, the caller's
//   hardcoded model (what main runs today) is used, so adopting this is behaviour-neutral.
// * 60s in-isolate cache (same TTL as classifierProvider.ts's platform_config read).
// * Shadow is sampled locally (sample_pct) and only offered while the DB says the task's
//   monthly cap is not spent. Shadow output is logged, never returned to the user.

export type ResolvedModel = {
  role: "active" | "fallback" | "shadow";
  provider: string;
  model: string;
  version: string | null;
  params: Record<string, unknown>;
  price_input_per_mtok: number | null;
  price_output_per_mtok: number | null;
  price_per_page: number | null;
  shadow_sample_pct: number | null;
};

export type ModelPlan = {
  task: string;
  chain: ResolvedModel[];          // active first, then fallbacks in rank order
  shadow: ResolvedModel | null;    // set only when this request won the sample roll
  source: "registry" | "hardcoded";
};

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; rows: ResolvedModel[] }>();

export function hardcoded(provider: string, model: string, version: string | null = null,
  params: Record<string, unknown> = {}): ResolvedModel {
  return { role: "active", provider, model, version, params, price_input_per_mtok: null,
    price_output_per_mtok: null, price_per_page: null, shadow_sample_pct: null };
}

export async function resolveModel(task: string, opts: {
  rpc: Rpc;                                  // supabase.rpc bound to a service-role client
  fallback: ResolvedModel | ResolvedModel[]; // what the function hardcodes today
  random?: () => number;
  now?: () => number;
}): Promise<ModelPlan> {
  const now = opts.now ?? Date.now, rnd = opts.random ?? Math.random;
  const fb = Array.isArray(opts.fallback) ? opts.fallback : [opts.fallback];
  let rows: ResolvedModel[] | null = null;
  const hit = cache.get(task);
  if (hit && now() - hit.at < TTL_MS) rows = hit.rows;
  else {
    try {
      const { data, error } = await opts.rpc("resolve_model", { p_task: task });
      if (!error && Array.isArray(data)) { rows = data as ResolvedModel[]; cache.set(task, { at: now(), rows }); }
    } catch { /* registry unreachable: hardcoded path below */ }
  }
  const chain = (rows ?? []).filter((r) => r.role === "active" || r.role === "fallback");
  if (!chain.length) return { task, chain: fb, shadow: null, source: "hardcoded" };
  const s = (rows ?? []).find((r) => r.role === "shadow") ?? null;
  const shadow = s && s.shadow_sample_pct && rnd() * 100 < Math.min(5, s.shadow_sample_pct) ? s : null;
  return { task, chain, shadow, source: "registry" };
}

/** Cost of one call from measured usage and registry prices (USD). */
export function callCostUsd(m: ResolvedModel, usage: { input_tokens?: number; output_tokens?: number; pages?: number }): number | null {
  if (m.price_per_page != null && usage.pages != null) return m.price_per_page * usage.pages;
  if (m.price_input_per_mtok == null || m.price_output_per_mtok == null) return null;
  return ((usage.input_tokens ?? 0) * m.price_input_per_mtok + (usage.output_tokens ?? 0) * m.price_output_per_mtok) / 1e6;
}

/** Ledger row for llm_cost_tracking. Shadow calls use caller "shadow:<task>" so the cap query sums them. */
export function costRow(task: string, caller: string, m: ResolvedModel, usage: { input_tokens?: number; output_tokens?: number; pages?: number },
  _status: number | string, durationMs: number) {
  const usd = callCostUsd(m, usage);
  return {
    date: new Date().toISOString().slice(0, 10), provider: m.provider, model: m.version ?? m.model,
    // NOTE: today callers write the HTTP status into `task` (e.g. "200", "402"); the registry path writes the real task
    // and keeps the status in caller-side logs. See README gap G4.
    task, caller: m.role === "shadow" ? `shadow:${task}` : caller,
    input_tokens: usage.input_tokens ?? null, output_tokens: usage.output_tokens ?? null,
    cost_cents: usd == null ? null : usd * 100, duration_ms: durationMs,
    // `status` stays in function logs: llm_cost_tracking has no status column.
  };
}

export function _clearResolverCache() { cache.clear(); }

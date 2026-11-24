import { _clearResolverCache, callCostUsd, hardcoded, resolveModel } from "./resolveModel.ts";
const eq = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
const row = (role: string, model: string, pct: number | null = null) => ({ role, provider: "openai", model, version: null, params: {},
  price_input_per_mtok: 0.1, price_output_per_mtok: 0.5, price_per_page: null, shadow_sample_pct: pct });
const today = hardcoded("openai", "gpt-4.1-mini", "gpt-4.1-mini-2025-04-14");

Deno.test("registry down -> hardcoded model, never throws", async () => {
  _clearResolverCache();
  const p = await resolveModel("photo_classify", { rpc: () => Promise.reject(new Error("down")), fallback: today });
  eq(p.source, "hardcoded"); eq(p.chain[0].model, "gpt-4.1-mini");
});
Deno.test("empty registry -> hardcoded", async () => {
  _clearResolverCache();
  const p = await resolveModel("t2", { rpc: async () => ({ data: [], error: null }), fallback: today });
  eq(p.source, "hardcoded");
});
Deno.test("active + fallback order, shadow only when sampled", async () => {
  _clearResolverCache();
  const rpc = async () => ({ data: [row("active", "gpt-6-luna"), row("fallback", "claude-haiku-5-5"), row("shadow", "gemini-3.5-flash-lite", 2)], error: null });
  const won = await resolveModel("t3", { rpc, fallback: today, random: () => 0.01 });
  eq(won.chain.map((m) => m.model), ["gpt-6-luna", "claude-haiku-5-5"]); eq(won.shadow?.model, "gemini-3.5-flash-lite");
  const lost = await resolveModel("t3", { rpc, fallback: today, random: () => 0.5 });
  eq(lost.shadow, null);
});
Deno.test("shadow pct is hard-capped at 5%", async () => {
  _clearResolverCache();
  const rpc = async () => ({ data: [row("active", "a"), row("shadow", "s", 90)], error: null });
  eq((await resolveModel("t4", { rpc, fallback: today, random: () => 0.06 })).shadow, null);
});
Deno.test("cost", () => {
  eq(Math.round(callCostUsd(row("active", "gpt-6-luna") as never, { input_tokens: 5311, output_tokens: 327 })! * 1e6), 695);
});

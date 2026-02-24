// Sweep post-blend comp weights (applied AFTER bid blend, catches 2m/30m comp signal)
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = { "Authorization": `Bearer ${key}`, "Content-Type": "application/json", "apikey": key };

const weights = [null, 0.02, 0.05, 0.08, 0.10, 0.12, 0.15, 0.20];

console.log("=== POST-BLEND COMP WEIGHT SWEEP ===\n");
console.log("This applies comp blend AFTER bid blend, recovering comp signal at 2m/30m where alpha=0/0.85\n");

// First run warms the Deno instance
const warmup = await fetch(`${url}/functions/v1/backtest-hammer-simulator`, {
  method: "POST", headers: h,
  body: JSON.stringify({ mode: "full_backtest", limit: 50, lookback_days: 60 })
});
await warmup.json();

for (const w of weights) {
  const body = {
    mode: "full_backtest",
    limit: 300,
    lookback_days: 60,
  };
  if (w != null) body.post_blend_comp_weight = w;

  const r = await fetch(`${url}/functions/v1/backtest-hammer-simulator`, {
    method: "POST", headers: h,
    body: JSON.stringify(body),
  });
  const result = await r.json();
  const mape = result.accuracy?.mape ?? "?";
  const bias = result.accuracy?.bias_pct ?? "?";
  const w5 = result.accuracy?.within_5pct ?? "?";
  const w10 = result.accuracy?.within_10pct ?? "?";
  console.log(`post_blend_comp=${String(w ?? "none").padEnd(5)} MAPE=${mape}% bias=${bias}% w5=${w5} w10=${w10}`);
}

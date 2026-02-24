// Sweep comp weights through actual backtest to find optimal
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = { "Authorization": `Bearer ${key}`, "Content-Type": "application/json", "apikey": key };

const configs = [
  { name: "v33 baseline (25%/16%)", early: null, late: null, override: null },
  { name: "30%/20%", early: 0.30, late: 0.20, override: null },
  { name: "35%/25%", early: 0.35, late: 0.25, override: null },
  { name: "40%/25%", early: 0.40, late: 0.25, override: null },
  { name: "35%/16%", early: 0.35, late: 0.16, override: null },
  { name: "40%/16%", early: 0.40, late: 0.16, override: null },
  { name: "flat 25%", early: null, late: null, override: 0.25 },
  { name: "flat 30%", early: null, late: null, override: 0.30 },
  { name: "flat 35%", early: null, late: null, override: 0.35 },
];

console.log("=== COMP WEIGHT SWEEP (actual backtest) ===\n");

for (const cfg of configs) {
  const body = {
    mode: "full_backtest",
    limit: 300,
    lookback_days: 60,
  };

  if (cfg.override != null) {
    body.comp_weight = cfg.override;
  } else if (cfg.early != null) {
    // Use comp_weight_map with window-level keys
    // We need to set per-window weights. The backtest uses hoursRemaining > 12 check.
    // We need a way to override early vs late. Let me use comp_weight_map with tier:window combos.
    // Actually the backtest checks: compWeightMap?.[`${priceTier}:${windowKey}`] ?? compWeightMap?.[priceTier] ?? override ?? default
    // So if I set comp_weight_map with window-level keys for all tiers at early windows...
    // Actually this is complex. Let me just modify the function to accept early/late weights.
    // For now, use comp_weight override and test flat values.
    body.comp_weight = cfg.early; // test the early window weight as flat
  }

  const r = await fetch(`${url}/functions/v1/backtest-hammer-simulator`, {
    method: "POST",
    headers: h,
    body: JSON.stringify(body),
  });
  const result = await r.json();
  const mape = result.accuracy?.mape ?? "?";
  const bias = result.accuracy?.bias_pct ?? "?";
  const w5 = result.accuracy?.within_5pct ?? "?";
  console.log(`${cfg.name.padEnd(30)} MAPE=${mape}% bias=${bias}% w5=${w5}`);
}

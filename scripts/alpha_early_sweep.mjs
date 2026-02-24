// Test window-specific alpha values
// Currently: fresh α=0.93 everywhere, stale α=0.75
// Theory: at early windows (48h/24h), model captures full growth pattern,
// so higher α (more model trust) might be better. At late windows (2h/30m),
// bid is close to hammer so current α=0.93 is right.
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = { "Authorization": `Bearer ${key}`, "Content-Type": "application/json", "apikey": key };

async function q(sql) {
  const r = await fetch(`${url}/rest/v1/rpc/execute_sql`, {
    method: "POST", headers: h,
    body: JSON.stringify({ query: sql })
  });
  const d = await r.json();
  if (d.code || d.error) { console.error("ERR:", JSON.stringify(d).substring(0, 200)); return []; }
  return Array.isArray(d) ? d : [];
}

// Get raw data from latest backtest
const rows = await q(`
  SELECT d.time_window, d.price_tier,
         d.bid_at_window::float as bid,
         d.predicted_hammer::float as pred,
         d.actual_hammer::float as actual,
         d.comp_median::float as comp,
         d.comp_count::int as cc
  FROM backtest_run_details d
  WHERE d.run_id = (SELECT id FROM backtest_runs ORDER BY created_at DESC LIMIT 1)
    AND d.bid_at_window > 0 AND d.actual_hammer > 0
`);
console.log(`Loaded ${rows.length} predictions\n`);

// Current model: predicted = α * model_pred + (1-α) * bid
// At 2m: α=0 so predicted=bid. We already handle this (v34).
// For non-2m: predicted = 0.93 * model_pred + 0.07 * bid
// To test different α, we need to reverse-engineer model_pred from stored prediction.
// model_pred = (predicted - (1-α)*bid) / α

function getHours(tw) {
  return { '48h': 40, '24h': 20, '12h': 10, '6h': 5, '2h': 1.5, '30m': 0.4, '2m': 0.05 }[tw] || 1;
}

function currentAlpha(tw) {
  const hrs = getHours(tw);
  if (hrs <= 0.05) return 0; // 2m
  // Simplified: assume all are fresh (α=0.93) for this analysis
  return 0.93;
}

// For each window, compute MAPE at different alpha values
const windows = ['48h', '24h', '12h', '6h', '2h', '30m'];
const alphas = [0.80, 0.85, 0.90, 0.93, 0.95, 0.97, 0.99];

console.log("=== WINDOW-SPECIFIC ALPHA SWEEP ===");
console.log("(simulated by re-computing from stored predictions)\n");
console.log("Alpha:  " + alphas.map(a => a.toFixed(2).padStart(6)).join(" "));

for (const tw of windows) {
  const twRows = rows.filter(r => r.time_window === tw);
  if (twRows.length === 0) continue;

  const currentA = currentAlpha(tw);
  const results = alphas.map(newA => {
    let totalErr = 0, n = 0;
    for (const r of twRows) {
      // Reverse-engineer model prediction from stored prediction
      let modelPred;
      if (currentA > 0) {
        modelPred = (r.pred - (1 - currentA) * r.bid) / currentA;
      } else {
        modelPred = r.pred; // 2m: pred=bid, can't recover model
      }

      // Re-compute with new alpha
      const newPred = newA * modelPred + (1 - newA) * r.bid;
      const err = Math.abs((newPred - r.actual) / r.actual * 100);
      totalErr += Math.min(err, 200);
      n++;
    }
    return (totalErr / n).toFixed(1);
  });

  console.log(`${tw.padEnd(4)} n=${String(twRows.length).padStart(3)}: ` +
    results.map((r, i) => {
      const s = r.padStart(6);
      return alphas[i] === currentA ? `[${s}]` : ` ${s} `;
    }).join(""));
}

// Overall MAPE at different alpha configurations
console.log("\n=== OVERALL MAPE WITH WINDOW-SPECIFIC ALPHAS ===");

function computeOverallMAPE(alphaFn) {
  let totalErr = 0, n = 0;
  for (const r of rows) {
    const currentA = currentAlpha(r.time_window);
    const newA = alphaFn(r.time_window);

    let modelPred;
    if (currentA > 0) {
      modelPred = (r.pred - (1 - currentA) * r.bid) / currentA;
    } else {
      modelPred = r.bid; // 2m: can't recover
    }

    const newPred = newA * modelPred + (1 - newA) * r.bid;
    const err = Math.abs((newPred - r.actual) / r.actual * 100);
    totalErr += Math.min(err, 200);
    n++;
  }
  return (totalErr / n).toFixed(1);
}

const configs = [
  { name: "current (0.93 all)", fn: (tw) => currentAlpha(tw) },
  { name: "48h/24h=0.95 rest=0.93", fn: (tw) => { const h = getHours(tw); return h <= 0.05 ? 0 : h > 18 ? 0.95 : 0.93; }},
  { name: "48h/24h=0.97 rest=0.93", fn: (tw) => { const h = getHours(tw); return h <= 0.05 ? 0 : h > 18 ? 0.97 : 0.93; }},
  { name: "48h=0.97 24h=0.95 rest=0.93", fn: (tw) => { const h = getHours(tw); return h <= 0.05 ? 0 : h > 36 ? 0.97 : h > 18 ? 0.95 : 0.93; }},
  { name: "graduated (48h=0.97...2h=0.90)", fn: (tw) => { const h = getHours(tw); return h <= 0.05 ? 0 : h > 36 ? 0.97 : h > 18 ? 0.95 : h > 9 ? 0.93 : h > 4 ? 0.92 : h > 1 ? 0.90 : h > 0.25 ? 0.85 : 0; }},
  { name: "flat 0.90", fn: (tw) => getHours(tw) <= 0.05 ? 0 : 0.90 },
  { name: "flat 0.95", fn: (tw) => getHours(tw) <= 0.05 ? 0 : 0.95 },
];

for (const cfg of configs) {
  console.log(`${cfg.name.padEnd(40)} MAPE=${computeOverallMAPE(cfg.fn)}%`);
}

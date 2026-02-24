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

const rows = await q(`
  SELECT d.time_window, d.price_tier,
         d.bid_at_window::float as bid,
         d.predicted_hammer::float as pred,
         d.actual_hammer::float as actual,
         d.comp_median::float as comp,
         d.comp_count::int as cc,
         d.multiplier_used::float as mult
  FROM backtest_run_details d
  WHERE d.run_id = (SELECT id FROM backtest_runs ORDER BY created_at DESC LIMIT 1)
    AND d.actual_hammer > 0 AND d.bid_at_window > 0
`);
console.log(`Loaded ${rows.length} predictions\n`);

function getAlpha(tw) {
  return { '2m': 0, '30m': 0.93, '2h': 0.93, '6h': 0.93, '12h': 0.93, '24h': 0.93, '48h': 0.93 }[tw] ?? 0.93;
}

function getBaseCompWeight(tw) {
  const hrs = { '48h': 40, '24h': 20, '12h': 10, '6h': 5, '2h': 1.5, '30m': 0.4, '2m': 0.05 }[tw] || 1;
  return hrs > 18 ? 0.25 : 0.16;
}

function computeMAPE(rows, compWeightFn) {
  let totalErr = 0, n = 0, totalBias = 0;
  for (const r of rows) {
    const alpha = getAlpha(r.time_window);
    const currentCompW = (r.comp && r.comp > 0 && r.cc >= 1) ? getBaseCompWeight(r.time_window) : 0;

    if (!r.comp || r.comp <= 0 || r.cc < 1 || currentCompW === 0) {
      const err = Math.abs((r.pred - r.actual) / r.actual * 100);
      totalErr += Math.min(err, 200);
      totalBias += (r.pred - r.actual) / r.actual * 100;
      n++;
      continue;
    }

    if (alpha === 0) {
      // 2m: use v34 post-blend (5% comp), recompute with new weight
      const newCompW = compWeightFn(r.cc, r.time_window, 0.05);
      const newPred = r.bid * (1 - newCompW) + r.comp * newCompW;
      const err = Math.abs((newPred - r.actual) / r.actual * 100);
      totalErr += Math.min(err, 200);
      totalBias += (newPred - r.actual) / r.actual * 100;
      n++;
      continue;
    }

    // Reverse-engineer base prediction
    const blended = (r.pred - (1 - alpha) * r.bid) / alpha;
    const base = (blended - r.comp * currentCompW) / (1 - currentCompW);

    // Recompute with new comp weight
    const newCompW = compWeightFn(r.cc, r.time_window, currentCompW);
    const newBlended = base * (1 - newCompW) + r.comp * newCompW;
    const newPred = alpha * newBlended + (1 - alpha) * r.bid;

    const err = Math.abs((newPred - r.actual) / r.actual * 100);
    totalErr += Math.min(err, 200);
    totalBias += (newPred - r.actual) / r.actual * 100;
    n++;
  }
  return { mape: (totalErr / n).toFixed(1), bias: (totalBias / n).toFixed(1), n };
}

// Baseline
const baseline = computeMAPE(rows, (cc, tw, cw) => cw);
console.log(`Baseline: MAPE=${baseline.mape}% bias=${baseline.bias}%\n`);

const configs = [
  // Increase weight for cc=1
  { name: "cc=1: +5%", fn: (cc, tw, cw) => cc === 1 ? cw + 0.05 : cw },
  { name: "cc=1: +10%", fn: (cc, tw, cw) => cc === 1 ? cw + 0.10 : cw },
  { name: "cc=1: +15%", fn: (cc, tw, cw) => cc === 1 ? cw + 0.15 : cw },
  { name: "cc=1: +20%", fn: (cc, tw, cw) => cc === 1 ? cw + 0.20 : cw },
  { name: "cc=1: 40%", fn: (cc, tw, cw) => cc === 1 ? 0.40 : cw },
  { name: "cc=1: 50%", fn: (cc, tw, cw) => cc === 1 ? 0.50 : cw },

  // Decrease weight for high cc
  { name: "cc>10: -8%", fn: (cc, tw, cw) => cc > 10 ? Math.max(cw - 0.08, 0.05) : cw },
  { name: "cc>10: 8%", fn: (cc, tw, cw) => cc > 10 ? 0.08 : cw },

  // Combined: increase cc=1, decrease high cc
  { name: "cc=1:+10%, cc>10:8%", fn: (cc, tw, cw) => cc === 1 ? cw + 0.10 : cc > 10 ? 0.08 : cw },
  { name: "cc=1:+15%, cc>3:-5%", fn: (cc, tw, cw) => cc === 1 ? cw + 0.15 : cc > 3 ? Math.max(cw - 0.05, 0.05) : cw },

  // Graduated by cc
  { name: "cc=1:30%, cc=2-3:16%, cc>3:10%", fn: (cc, tw, cw) => cc === 1 ? 0.30 : cc <= 3 ? 0.16 : 0.10 },
  { name: "cc=1:25%, cc=2-3:16%, cc>3:12%", fn: (cc, tw, cw) => cc === 1 ? 0.25 : cc <= 3 ? 0.16 : 0.12 },
  { name: "cc=1:35%, cc=2-3:20%, cc>3:10%", fn: (cc, tw, cw) => cc === 1 ? 0.35 : cc <= 3 ? 0.20 : 0.10 },
];

console.log("=== COMP-COUNT-ADAPTIVE WEIGHT SWEEP ===");
for (const cfg of configs) {
  const result = computeMAPE(rows, cfg.fn);
  const delta = (parseFloat(result.mape) - parseFloat(baseline.mape)).toFixed(1);
  const sign = parseFloat(delta) <= 0 ? '' : '+';
  console.log(`${cfg.name.padEnd(45)} MAPE=${result.mape}% (${sign}${delta}) bias=${result.bias}%`);
}

// Per-window breakdown for best configs
console.log("\n=== PER-WINDOW DETAIL ===");
const windows = ['48h', '24h', '12h', '6h', '2h', '30m', '2m'];
const best = [
  { name: "baseline", fn: (cc, tw, cw) => cw },
  { name: "cc=1:+10%", fn: (cc, tw, cw) => cc === 1 ? cw + 0.10 : cw },
  { name: "cc=1:30%,cc>3:10%", fn: (cc, tw, cw) => cc === 1 ? 0.30 : cc <= 3 ? 0.16 : 0.10 },
];

for (const cfg of best) {
  console.log(`\n${cfg.name}:`);
  for (const tw of windows) {
    const twRows = rows.filter(r => r.time_window === tw);
    const result = computeMAPE(twRows, cfg.fn);
    // Count cc=1 in this window
    const cc1 = twRows.filter(r => r.cc === 1 && r.comp > 0).length;
    process.stdout.write(`  ${tw}: ${result.mape}% (cc1=${cc1}/${twRows.length})  `);
  }
  console.log();
}

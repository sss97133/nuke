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

// Get predictions from latest backtest run along with comp data
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

// Current model behavior:
// predicted = alpha * (base * (1-compW) + comp * compW) + (1-alpha) * bid
// where base = bid * multiplier * corrections
// To simulate a different comp weight, I need to reverse-engineer the base from stored prediction.

function getAlpha(tw) {
  // Simplified: assume fresh (alpha=0.93) except 2m (alpha=0)
  return { '2m': 0, '30m': 0.93, '2h': 0.93, '6h': 0.93, '12h': 0.93, '24h': 0.93, '48h': 0.93 }[tw] ?? 0.93;
}

function getCompWeight(tw) {
  const hrs = { '48h': 40, '24h': 20, '12h': 10, '6h': 5, '2h': 1.5, '30m': 0.4, '2m': 0.05 }[tw] || 1;
  return hrs > 18 ? 0.25 : 0.16;
}

function getHours(tw) {
  return { '48h': 40, '24h': 20, '12h': 10, '6h': 5, '2h': 1.5, '30m': 0.4, '2m': 0.05 }[tw] || 1;
}

function computeMAPE(rows, compWeightFn) {
  let totalErr = 0, n = 0;
  for (const r of rows) {
    const alpha = getAlpha(r.time_window);
    const currentCompW = getCompWeight(r.time_window);

    // Reverse-engineer base prediction (before comp blend)
    // stored pred = alpha * (base * (1-currentCompW) + comp * currentCompW) + (1-alpha) * bid
    // But some rows have no comp
    if (!r.comp || r.comp <= 0 || r.cc < 1) {
      // No comp: base = stored pred (comp blend was not applied)
      const err = Math.abs((r.pred - r.actual) / r.actual * 100);
      totalErr += Math.min(err, 200);
      n++;
      continue;
    }

    // With comp: stored pred = alpha * (base * (1-cw) + comp * cw) + (1-alpha) * bid
    // If alpha = 0 (2m): stored pred = bid, base doesn't matter
    // If alpha > 0: blended = (stored_pred - (1-alpha)*bid) / alpha
    //              base = (blended - comp * cw) / (1 - cw)

    if (alpha === 0) {
      // 2m: pred = bid * 0.95 + comp * 0.05 (v34 post-blend)
      // Can't decompose further, just recompute with new comp weight
      const newCompW = compWeightFn(r.comp / r.bid, r.time_window, currentCompW);
      const newPred = r.bid * (1 - newCompW) + r.comp * newCompW;
      const err = Math.abs((newPred - r.actual) / r.actual * 100);
      totalErr += Math.min(err, 200);
      n++;
      continue;
    }

    const blended = (r.pred - (1 - alpha) * r.bid) / alpha;
    const base = (blended - r.comp * currentCompW) / (1 - currentCompW);

    // Recompute with new comp weight
    const compRatio = r.comp / r.bid;
    const newCompW = compWeightFn(compRatio, r.time_window, currentCompW);
    const newBlended = base * (1 - newCompW) + r.comp * newCompW;
    const newPred = alpha * newBlended + (1 - alpha) * r.bid;

    const err = Math.abs((newPred - r.actual) / r.actual * 100);
    totalErr += Math.min(err, 200);
    n++;
  }
  return { mape: (totalErr / n).toFixed(1), n };
}

// Baseline: current weights
const baseline = computeMAPE(rows, (ratio, tw, currentW) => currentW);
console.log(`Baseline (current): MAPE=${baseline.mape}% n=${baseline.n}`);

// Test configs
const configs = [
  // Flat comp weight changes
  { name: "flat 20%", fn: (r, tw, cw) => getHours(tw) > 18 ? 0.25 : 0.20 },
  { name: "flat 12%", fn: (r, tw, cw) => getHours(tw) > 18 ? 0.25 : 0.12 },

  // Adaptive: increase comp weight when comp/bid is high
  { name: "ratio>2: +5%", fn: (r, tw, cw) => r > 2 ? Math.min(cw + 0.05, 0.35) : cw },
  { name: "ratio>2: +10%", fn: (r, tw, cw) => r > 2 ? Math.min(cw + 0.10, 0.35) : cw },
  { name: "ratio>2: +15%", fn: (r, tw, cw) => r > 2 ? Math.min(cw + 0.15, 0.35) : cw },
  { name: "ratio>3: +10%", fn: (r, tw, cw) => r > 3 ? Math.min(cw + 0.10, 0.35) : cw },
  { name: "ratio>3: +15%", fn: (r, tw, cw) => r > 3 ? Math.min(cw + 0.15, 0.35) : cw },

  // Reduce comp weight when comp/bid is close (over-predicting)
  { name: "ratio<1.2: -8%", fn: (r, tw, cw) => r < 1.2 && r > 0 ? Math.max(cw - 0.08, 0.05) : cw },
  { name: "ratio<1.5: -5%", fn: (r, tw, cw) => r < 1.5 && r > 0 ? Math.max(cw - 0.05, 0.05) : cw },

  // Combined: reduce for close, increase for far
  { name: "adaptive: <1.2→-5%, >2→+10%", fn: (r, tw, cw) => {
    if (r > 2) return Math.min(cw + 0.10, 0.35);
    if (r > 0 && r < 1.2) return Math.max(cw - 0.05, 0.05);
    return cw;
  }},
  { name: "graduated: <1→8%, 1-1.5→12%, 1.5-2.5→16%, 2.5+→25%", fn: (r, tw, cw) => {
    if (r <= 0) return cw;
    if (r < 1.0) return 0.08;
    if (r < 1.5) return 0.12;
    if (r < 2.5) return cw; // keep current
    return 0.25;
  }},
  { name: "grad2: <1→10%, 1-2→16%, 2-3→22%, 3+→30%", fn: (r, tw, cw) => {
    if (r <= 0) return cw;
    if (r < 1.0) return 0.10;
    if (r < 2.0) return 0.16;
    if (r < 3.0) return 0.22;
    return 0.30;
  }},
];

console.log("\n=== ADAPTIVE COMP WEIGHT SWEEP ===");
for (const cfg of configs) {
  const result = computeMAPE(rows, cfg.fn);
  const delta = (parseFloat(result.mape) - parseFloat(baseline.mape)).toFixed(1);
  const sign = parseFloat(delta) <= 0 ? '' : '+';
  console.log(`${cfg.name.padEnd(50)} MAPE=${result.mape}% (${sign}${delta})`);
}

// Detailed breakdown for best configs
console.log("\n=== PER-WINDOW DETAIL FOR BEST CONFIGS ===");
const windows = ['48h', '24h', '12h', '6h', '2h', '30m', '2m'];
const bestConfigs = [
  { name: "baseline", fn: (r, tw, cw) => cw },
  { name: "ratio>2: +10%", fn: (r, tw, cw) => r > 2 ? Math.min(cw + 0.10, 0.35) : cw },
  { name: "grad2", fn: (r, tw, cw) => { if (r <= 0) return cw; if (r < 1.0) return 0.10; if (r < 2.0) return 0.16; if (r < 3.0) return 0.22; return 0.30; }},
];

for (const cfg of bestConfigs) {
  console.log(`\n${cfg.name}:`);
  for (const tw of windows) {
    const twRows = rows.filter(r => r.time_window === tw);
    const result = computeMAPE(twRows, cfg.fn);
    process.stdout.write(`  ${tw}: ${result.mape}% (n=${result.n})  `);
  }
  console.log();
}

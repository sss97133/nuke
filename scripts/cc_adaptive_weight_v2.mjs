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
      const newCompW = compWeightFn(r.cc, r.time_window, 0.05);
      const newPred = r.bid * (1 - newCompW) + r.comp * newCompW;
      const err = Math.abs((newPred - r.actual) / r.actual * 100);
      totalErr += Math.min(err, 200);
      totalBias += (newPred - r.actual) / r.actual * 100;
      n++;
      continue;
    }

    const blended = (r.pred - (1 - alpha) * r.bid) / alpha;
    const base = (blended - r.comp * currentCompW) / (1 - currentCompW);
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

// ========== PHASE 1: Find optimal cc=1 weight ==========
console.log("=== PHASE 1: OPTIMAL CC=1 WEIGHT ===");
for (const w of [0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80]) {
  const result = computeMAPE(rows, (cc, tw, cw) => cc === 1 ? w : cw);
  const delta = (parseFloat(result.mape) - parseFloat(baseline.mape)).toFixed(1);
  const sign = parseFloat(delta) <= 0 ? '' : '+';
  console.log(`cc=1: ${(w*100).toFixed(0)}%`.padEnd(20) + `MAPE=${result.mape}% (${sign}${delta}) bias=${result.bias}%`);
}

// ========== PHASE 2: Optimal cc=1 weight per time window ==========
console.log("\n=== PHASE 2: OPTIMAL CC=1 WEIGHT PER TIME WINDOW ===");
const windows = ['48h', '24h', '12h', '6h', '2h', '30m', '2m'];
for (const tw of windows) {
  const twRows = rows.filter(r => r.time_window === tw);
  const cc1Rows = twRows.filter(r => r.cc === 1 && r.comp > 0);
  console.log(`\n${tw} (n=${twRows.length}, cc1=${cc1Rows.length}):`);

  for (const w of [0.16, 0.25, 0.35, 0.50, 0.65, 0.80]) {
    const result = computeMAPE(twRows, (cc, tww, cw) => cc === 1 ? w : cw);
    const base = computeMAPE(twRows, (cc, tww, cw) => cw);
    const delta = (parseFloat(result.mape) - parseFloat(base.mape)).toFixed(1);
    const sign = parseFloat(delta) <= 0 ? '' : '+';
    process.stdout.write(`  ${(w*100).toFixed(0)}%: ${result.mape}% (${sign}${delta})  `);
  }
  console.log();
}

// ========== PHASE 3: Combined cc=1 high + cc>=2 adjustments ==========
console.log("\n=== PHASE 3: COMBINED CC=1 HIGH + CC>=2 ADJUSTMENTS ===");
const combinedConfigs = [
  // Best cc=1 + reduce cc>=2
  { name: "cc=1:60%, cc>=2: base", fn: (cc, tw, cw) => cc === 1 ? 0.60 : cw },
  { name: "cc=1:60%, cc>=2: 12%", fn: (cc, tw, cw) => cc === 1 ? 0.60 : 0.12 },
  { name: "cc=1:60%, cc>=2: 8%", fn: (cc, tw, cw) => cc === 1 ? 0.60 : 0.08 },
  { name: "cc=1:60%, cc>=2: 5%", fn: (cc, tw, cw) => cc === 1 ? 0.60 : 0.05 },
  { name: "cc=1:60%, cc=2-3: 12%, cc>3: 5%", fn: (cc, tw, cw) => cc === 1 ? 0.60 : cc <= 3 ? 0.12 : 0.05 },
  { name: "cc=1:65%, cc=2-3: 12%, cc>3: 5%", fn: (cc, tw, cw) => cc === 1 ? 0.65 : cc <= 3 ? 0.12 : 0.05 },
  { name: "cc=1:70%, cc=2-3: 10%, cc>3: 5%", fn: (cc, tw, cw) => cc === 1 ? 0.70 : cc <= 3 ? 0.10 : 0.05 },

  // Graduated by cc with window-awareness
  { name: "cc=1:60%, cc=2:25%, cc=3-5:12%, cc>5:5%", fn: (cc, tw, cw) =>
    cc === 1 ? 0.60 : cc === 2 ? 0.25 : cc <= 5 ? 0.12 : 0.05 },
  { name: "cc=1:65%, cc=2:20%, cc=3-5:10%, cc>5:5%", fn: (cc, tw, cw) =>
    cc === 1 ? 0.65 : cc === 2 ? 0.20 : cc <= 5 ? 0.10 : 0.05 },

  // Window-aware cc=1 (higher weight at longer windows where comp has more time to predict)
  { name: "cc=1: 60% early/50% late, rest base", fn: (cc, tw, cw) => {
    if (cc !== 1) return cw;
    const hrs = { '48h': 40, '24h': 20, '12h': 10, '6h': 5, '2h': 1.5, '30m': 0.4, '2m': 0.05 }[tw] || 1;
    return hrs > 6 ? 0.60 : 0.50;
  }},
  { name: "cc=1: 70% early/55% late, rest base", fn: (cc, tw, cw) => {
    if (cc !== 1) return cw;
    const hrs = { '48h': 40, '24h': 20, '12h': 10, '6h': 5, '2h': 1.5, '30m': 0.4, '2m': 0.05 }[tw] || 1;
    return hrs > 6 ? 0.70 : 0.55;
  }},
];

for (const cfg of combinedConfigs) {
  const result = computeMAPE(rows, cfg.fn);
  const delta = (parseFloat(result.mape) - parseFloat(baseline.mape)).toFixed(1);
  const sign = parseFloat(delta) <= 0 ? '' : '+';
  console.log(`${cfg.name.padEnd(50)} MAPE=${result.mape}% (${sign}${delta}) bias=${result.bias}%`);
}

// ========== PHASE 4: Per-window detail for top configs ==========
console.log("\n=== PHASE 4: PER-WINDOW DETAIL FOR TOP CONFIGS ===");
const topConfigs = [
  { name: "baseline", fn: (cc, tw, cw) => cw },
  { name: "cc=1:50%", fn: (cc, tw, cw) => cc === 1 ? 0.50 : cw },
  { name: "cc=1:60%", fn: (cc, tw, cw) => cc === 1 ? 0.60 : cw },
  { name: "cc=1:65%", fn: (cc, tw, cw) => cc === 1 ? 0.65 : cw },
  { name: "cc=1:70%", fn: (cc, tw, cw) => cc === 1 ? 0.70 : cw },
  { name: "cc=1:65%, cc=2:20%, cc>5:5%", fn: (cc, tw, cw) =>
    cc === 1 ? 0.65 : cc === 2 ? 0.20 : cc <= 5 ? 0.10 : 0.05 },
];

for (const cfg of topConfigs) {
  console.log(`\n${cfg.name}:`);
  for (const tw of windows) {
    const twRows = rows.filter(r => r.time_window === tw);
    const result = computeMAPE(twRows, cfg.fn);
    process.stdout.write(`  ${tw}: ${result.mape}%  `);
  }
  console.log();
}

// ========== PHASE 5: Distribution of cc values ==========
console.log("\n=== PHASE 5: CC VALUE DISTRIBUTION ===");
const ccDist = {};
for (const r of rows) {
  if (!r.comp || r.comp <= 0 || r.cc < 1) continue;
  const k = r.cc === 1 ? "1" : r.cc === 2 ? "2" : r.cc <= 5 ? "3-5" : r.cc <= 10 ? "6-10" : r.cc <= 20 ? "11-20" : "21+";
  ccDist[k] = (ccDist[k] || 0) + 1;
}
const totalWithComp = Object.values(ccDist).reduce((a, b) => a + b, 0);
console.log(`Total predictions with comps: ${totalWithComp} / ${rows.length}`);
for (const [k, v] of Object.entries(ccDist)) {
  console.log(`  cc=${k.padEnd(5)}: ${String(v).padStart(4)} (${(v/totalWithComp*100).toFixed(1)}%)`);
}

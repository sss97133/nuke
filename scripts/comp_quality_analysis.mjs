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

// Analyze: how often is comp_median close to actual hammer?
// This tells us about comp QUALITY, not just availability
const rows = await q(`
  SELECT d.vehicle_id, d.time_window,
         d.bid_at_window::float as bid,
         d.actual_hammer::float as actual,
         d.predicted_hammer::float as pred,
         d.comp_median::float as comp,
         d.comp_count::int as cc,
         d.abs_error_pct::float as abs_error
  FROM backtest_run_details d
  WHERE d.run_id = (SELECT id FROM backtest_runs ORDER BY created_at DESC LIMIT 1)
    AND d.actual_hammer > 0 AND d.bid_at_window > 0
    AND d.time_window = '2h'
    AND d.comp_median > 0 AND d.comp_count >= 1
`);
console.log(`Loaded ${rows.length} 2h predictions with comps\n`);

// Comp quality: how close is comp_median to actual_hammer?
const compErrors = rows.map(r => Math.abs((r.comp - r.actual) / r.actual * 100));
const compBiases = rows.map(r => (r.comp - r.actual) / r.actual * 100);
const avgCompErr = compErrors.reduce((s, v) => s + v, 0) / compErrors.length;
const avgCompBias = compBiases.reduce((s, v) => s + v, 0) / compBiases.length;
const medCompErr = compErrors.sort((a, b) => a - b)[Math.floor(compErrors.length / 2)];

console.log("=== COMP QUALITY: How close is comp_median to actual_hammer? ===");
console.log(`Comp-to-actual MAPE: ${avgCompErr.toFixed(1)}%`);
console.log(`Comp-to-actual bias: ${avgCompBias.toFixed(1)}%`);
console.log(`Comp-to-actual median error: ${medCompErr.toFixed(1)}%`);
console.log(`(Compare to model MAPE: ~17.8% at 2h)\n`);

// If we just used comp_median as the prediction, what would MAPE be?
const compPredErrors = rows.map(r => Math.abs((r.comp - r.actual) / r.actual * 100));
const compOnlyMAPE = compPredErrors.reduce((s, v) => s + Math.min(v, 200), 0) / compPredErrors.length;
console.log(`If comp_median were the prediction: MAPE=${compOnlyMAPE.toFixed(1)}%`);

// What about for different comp_count levels?
console.log("\n=== COMP QUALITY BY COMP COUNT ===");
const ccBuckets = { "1": [], "2-3": [], "4-10": [], "11-20": [], "20+": [] };
for (const r of rows) {
  const k = r.cc === 1 ? "1" : r.cc <= 3 ? "2-3" : r.cc <= 10 ? "4-10" : r.cc <= 20 ? "11-20" : "20+";
  ccBuckets[k].push(r);
}
for (const [name, group] of Object.entries(ccBuckets)) {
  if (group.length === 0) continue;
  const compErrs = group.map(g => Math.abs((g.comp - g.actual) / g.actual * 100));
  const avgCE = compErrs.reduce((s, v) => s + v, 0) / compErrs.length;
  const modelErrs = group.map(g => g.abs_error);
  const avgME = modelErrs.reduce((s, v) => s + v, 0) / modelErrs.length;
  console.log(`cc=${name.padEnd(5)} n=${String(group.length).padStart(3)} comp_err=${avgCE.toFixed(1)}% model_err=${avgME.toFixed(1)}% (comp ${avgCE < avgME ? 'BETTER' : 'WORSE'})`);
}

// === What is the relationship between comp error and model error? ===
console.log("\n=== COMP ERROR BUCKETS vs MODEL ERROR (at 2h) ===");
const compErrBuckets = { "good (<15%)": [], "ok (15-30%)": [], "bad (30-60%)": [], "terrible (60%+)": [] };
for (const r of rows) {
  const ce = Math.abs((r.comp - r.actual) / r.actual * 100);
  const k = ce < 15 ? "good (<15%)" : ce < 30 ? "ok (15-30%)" : ce < 60 ? "bad (30-60%)" : "terrible (60%+)";
  compErrBuckets[k].push(r);
}
for (const [name, group] of Object.entries(compErrBuckets)) {
  if (group.length === 0) continue;
  const avgME = group.reduce((s, g) => s + g.abs_error, 0) / group.length;
  const pctOfTotal = (group.length / rows.length * 100).toFixed(0);
  console.log(`${name.padEnd(22)} n=${String(group.length).padStart(3)} (${pctOfTotal}%) model_MAPE=${avgME.toFixed(1)}%`);
}

// === What if we increased comp weight ONLY for good-comp auctions? ===
console.log("\n=== SIMULATED: COMP-QUALITY-ADAPTIVE WEIGHT ===");
// For each auction, evaluate comp quality (which we know ex-post) and give more weight
// In practice we wouldn't know comp quality beforehand, but comp_count might proxy for it
// Let's check: does comp_count predict comp quality?
console.log("\nComp count vs comp quality:");
for (const [name, group] of Object.entries(ccBuckets)) {
  if (group.length === 0) continue;
  const good = group.filter(g => Math.abs((g.comp - g.actual) / g.actual * 100) < 30).length;
  console.log(`cc=${name.padEnd(5)} n=${String(group.length).padStart(3)} good_comp_pct=${(good/group.length*100).toFixed(0)}%`);
}

// What about comp/bid ratio as a proxy? (we DO know this)
console.log("\nComp/bid ratio vs comp quality:");
const ratioBuckets = { "<1.0": [], "1.0-1.5": [], "1.5-2.5": [], "2.5+": [] };
for (const r of rows) {
  const ratio = r.comp / r.bid;
  const k = ratio < 1.0 ? "<1.0" : ratio < 1.5 ? "1.0-1.5" : ratio < 2.5 ? "1.5-2.5" : "2.5+";
  ratioBuckets[k].push(r);
}
for (const [name, group] of Object.entries(ratioBuckets)) {
  if (group.length === 0) continue;
  const avgCE = group.reduce((s, g) => s + Math.abs((g.comp - g.actual) / g.actual * 100), 0) / group.length;
  const avgME = group.reduce((s, g) => s + g.abs_error, 0) / group.length;
  console.log(`ratio ${name.padEnd(8)} n=${String(group.length).padStart(3)} comp_err=${avgCE.toFixed(1)}% model_err=${avgME.toFixed(1)}%`);
}

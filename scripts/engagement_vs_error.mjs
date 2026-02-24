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

// Get backtest data joined with engagement metrics
const rows = await q(`
  SELECT d.vehicle_id, d.time_window, d.price_tier,
         d.bid_at_window::float as bid,
         d.predicted_hammer::float as pred,
         d.actual_hammer::float as actual,
         d.error_pct::float as error_pct,
         d.abs_error_pct::float as abs_error,
         d.comp_median::float as comp,
         d.comp_count::int as cc,
         d.multiplier_used::float as mult,
         el.watcher_count::int as watchers,
         el.view_count::int as views,
         el.final_price::float as final_price
  FROM backtest_run_details d
  JOIN external_listings el ON el.vehicle_id = d.vehicle_id
  WHERE d.run_id = (SELECT id FROM backtest_runs ORDER BY created_at DESC LIMIT 1)
    AND d.actual_hammer > 0 AND d.bid_at_window > 0
    AND el.watcher_count > 0
`);
console.log(`Loaded ${rows.length} predictions with engagement data\n`);

// === 1. Watcher count vs absolute error ===
console.log("=== WATCHER COUNT vs PREDICTION ERROR (at 2h window) ===");
const tw2h = rows.filter(r => r.time_window === '2h');
const watchBuckets = { "low (<300)": [], "mid (300-600)": [], "high (600-1200)": [], "very_high (>1200)": [] };
for (const r of tw2h) {
  const w = r.watchers;
  const k = w < 300 ? "low (<300)" : w < 600 ? "mid (300-600)" : w < 1200 ? "high (600-1200)" : "very_high (>1200)";
  watchBuckets[k].push(r);
}
for (const [name, group] of Object.entries(watchBuckets)) {
  if (group.length === 0) continue;
  const errs = group.map(g => g.abs_error);
  const avg = errs.reduce((s, v) => s + v, 0) / errs.length;
  const bias = group.map(g => g.error_pct).reduce((s, v) => s + v, 0) / group.length;
  const med = errs.sort((a, b) => a - b)[Math.floor(errs.length / 2)];
  console.log(`${name.padEnd(20)} n=${String(group.length).padStart(3)} MAPE=${avg.toFixed(1)}% median=${med.toFixed(1)}% bias=${bias.toFixed(1)}%`);
}

// === 2. View/Watcher ratio vs error ===
console.log("\n=== VIEW/WATCHER RATIO vs ERROR (at 2h) ===");
const vwBuckets = { "engaged (<4)": [], "moderate (4-7)": [], "passive (7-12)": [], "v_passive (>12)": [] };
for (const r of tw2h) {
  if (!r.views || !r.watchers) continue;
  const ratio = r.views / r.watchers;
  const k = ratio < 4 ? "engaged (<4)" : ratio < 7 ? "moderate (4-7)" : ratio < 12 ? "passive (7-12)" : "v_passive (>12)";
  vwBuckets[k].push(r);
}
for (const [name, group] of Object.entries(vwBuckets)) {
  if (group.length === 0) continue;
  const avg = group.map(g => g.abs_error).reduce((s, v) => s + v, 0) / group.length;
  const bias = group.map(g => g.error_pct).reduce((s, v) => s + v, 0) / group.length;
  console.log(`${name.padEnd(20)} n=${String(group.length).padStart(3)} MAPE=${avg.toFixed(1)}% bias=${bias.toFixed(1)}%`);
}

// === 3. Comp count vs error ===
console.log("\n=== COMP COUNT vs ERROR (at 2h) ===");
const ccBuckets = { "0 comps": [], "1-3": [], "4-10": [], "11-20": [], "20+": [] };
for (const r of tw2h) {
  const c = r.cc ?? 0;
  const k = c === 0 ? "0 comps" : c <= 3 ? "1-3" : c <= 10 ? "4-10" : c <= 20 ? "11-20" : "20+";
  ccBuckets[k].push(r);
}
for (const [name, group] of Object.entries(ccBuckets)) {
  if (group.length === 0) continue;
  const avg = group.map(g => g.abs_error).reduce((s, v) => s + v, 0) / group.length;
  const bias = group.map(g => g.error_pct).reduce((s, v) => s + v, 0) / group.length;
  console.log(`${name.padEnd(12)} n=${String(group.length).padStart(3)} MAPE=${avg.toFixed(1)}% bias=${bias.toFixed(1)}%`);
}

// === 4. Comp/bid ratio vs error ===
console.log("\n=== COMP/BID RATIO vs ERROR (at 2h) ===");
const crBuckets = { "no_comp": [], "<0.8": [], "0.8-1.2": [], "1.2-1.5": [], "1.5-2": [], "2-3": [], "3+": [] };
for (const r of tw2h) {
  if (!r.comp || !r.bid || r.comp <= 0) { crBuckets["no_comp"].push(r); continue; }
  const ratio = r.comp / r.bid;
  const k = ratio < 0.8 ? "<0.8" : ratio < 1.2 ? "0.8-1.2" : ratio < 1.5 ? "1.2-1.5" : ratio < 2 ? "1.5-2" : ratio < 3 ? "2-3" : "3+";
  crBuckets[k].push(r);
}
for (const [name, group] of Object.entries(crBuckets)) {
  if (group.length === 0) continue;
  const avg = group.map(g => g.abs_error).reduce((s, v) => s + v, 0) / group.length;
  const bias = group.map(g => g.error_pct).reduce((s, v) => s + v, 0) / group.length;
  console.log(`${name.padEnd(12)} n=${String(group.length).padStart(3)} MAPE=${avg.toFixed(1)}% bias=${bias.toFixed(1)}%`);
}

// === 5. H/B ratio distribution by watcher count ===
console.log("\n=== H/B RATIO DISTRIBUTION BY WATCHERS (at 2h) ===");
for (const [name, group] of Object.entries(watchBuckets)) {
  if (group.length === 0) continue;
  const hbs = group.map(g => g.actual / g.bid).sort((a, b) => a - b);
  const p10 = hbs[Math.floor(hbs.length * 0.1)];
  const p25 = hbs[Math.floor(hbs.length * 0.25)];
  const med = hbs[Math.floor(hbs.length * 0.5)];
  const p75 = hbs[Math.floor(hbs.length * 0.75)];
  const p90 = hbs[Math.floor(hbs.length * 0.9)];
  console.log(`${name.padEnd(20)} p10=${p10.toFixed(2)} p25=${p25.toFixed(2)} med=${med.toFixed(2)} p75=${p75.toFixed(2)} p90=${p90.toFixed(2)}`);
}

// === 6. Cross-window: which auction characteristics predict high error? ===
console.log("\n=== TOP 20 WORST PREDICTIONS AT 2h (abs error) ===");
const worst = tw2h.sort((a, b) => b.abs_error - a.abs_error).slice(0, 20);
for (const w of worst) {
  const hb = (w.actual / w.bid).toFixed(2);
  const cr = w.comp && w.bid ? (w.comp / w.bid).toFixed(2) : 'n/a';
  console.log(`  err=${w.error_pct.toFixed(0).padStart(4)}% bid=$${Math.round(w.bid).toLocaleString().padStart(8)} actual=$${Math.round(w.actual).toLocaleString().padStart(8)} H/B=${hb} comp/bid=${cr} cc=${w.cc ?? 0} watchers=${w.watchers}`);
}

// === 7. Stall vs growth auctions by engagement ===
console.log("\n=== STALL (H/B<=1.05) vs GROWTH BY ENGAGEMENT (at 2m) ===");
const tw2m = rows.filter(r => r.time_window === '2m');
for (const threshold of [300, 600, 1000]) {
  const low = tw2m.filter(r => r.watchers < threshold);
  const high = tw2m.filter(r => r.watchers >= threshold);
  const lowStall = low.filter(r => r.actual / r.bid <= 1.05).length;
  const highStall = high.filter(r => r.actual / r.bid <= 1.05).length;
  console.log(`  watchers<${threshold}: ${lowStall}/${low.length} stall (${(lowStall/low.length*100).toFixed(0)}%) | watchers>=${threshold}: ${highStall}/${high.length} stall (${(highStall/high.length*100).toFixed(0)}%)`);
}

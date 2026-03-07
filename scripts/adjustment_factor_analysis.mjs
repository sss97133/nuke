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

// Get prediction details that include the adjustment factor breakdown
// The backtest doesn't store this, but hammer_predictions does for live preds
// Instead, let me recompute the adjustment factor from raw data

// First, get the bid, comment_count, unique_bidders for backtest auctions
const rows = await q(`
  SELECT d.vehicle_id, d.time_window, d.price_tier,
         d.bid_at_window::float as bid,
         d.predicted_hammer::float as pred,
         d.actual_hammer::float as actual,
         d.abs_error_pct::float as abs_error,
         d.error_pct::float as error_pct,
         d.multiplier_used::float as mult,
         ve.watcher_count::int as watchers,
         ve.view_count::int as views,
         ve.bid_count::int as bids
  FROM backtest_run_details d
  JOIN vehicle_events ve ON ve.vehicle_id = d.vehicle_id
  WHERE d.run_id = (SELECT id FROM backtest_runs ORDER BY created_at DESC LIMIT 1)
    AND d.actual_hammer > 0 AND d.bid_at_window > 0
    AND d.time_window = '6h'
`);

console.log(`Loaded ${rows.length} 6h predictions\n`);

// Get comment counts for these auctions
const commentCounts = await q(`
  SELECT ve.vehicle_id, COUNT(*) as comment_count
  FROM vehicle_events ve
  JOIN auction_comments ac ON ac.vehicle_id = ve.vehicle_id
  WHERE ve.vehicle_id IN (
    SELECT DISTINCT vehicle_id FROM backtest_run_details
    WHERE run_id = (SELECT id FROM backtest_runs ORDER BY created_at DESC LIMIT 1)
  )
  GROUP BY ve.vehicle_id
`);
const ccMap = {};
for (const c of commentCounts) ccMap[c.vehicle_id] = parseInt(c.comment_count);

// Get unique bidder counts from bat_bids (use final counts from vehicle_events instead)
// Actually, vehicle_events has bid_count but not unique_bidders
// And we can't easily get unique_bidders from bat_bids for all auctions (too slow)
// Let's use what we have: bid_count as a proxy

console.log(`Comment counts available for ${commentCounts.length} vehicles\n`);

// Engagement level distribution
function getEngLevel(cc) {
  if (cc < 30) return "quiet";
  if (cc < 100) return "normal";
  if (cc < 200) return "active";
  return "viral";
}

// Analyze engagement level vs error
const engBuckets = { quiet: [], normal: [], active: [], viral: [] };
for (const r of rows) {
  const cc = ccMap[r.vehicle_id] ?? 0;
  engBuckets[getEngLevel(cc)].push({ ...r, cc });
}

console.log("=== ENGAGEMENT LEVEL vs ERROR (at 6h) ===");
for (const [level, group] of Object.entries(engBuckets)) {
  if (group.length === 0) continue;
  const avgErr = group.reduce((s, g) => s + g.abs_error, 0) / group.length;
  const avgBias = group.reduce((s, g) => s + g.error_pct, 0) / group.length;
  const avgCC = group.reduce((s, g) => s + g.cc, 0) / group.length;
  console.log(`${level.padEnd(8)} n=${String(group.length).padStart(3)} MAPE=${avgErr.toFixed(1)}% bias=${avgBias.toFixed(1)}% avg_comments=${Math.round(avgCC)}`);
}

// The actual multiplier_used includes the adjustment factor. Let me check what the
// multiplier distribution looks like across engagement levels
console.log("\n=== MULTIPLIER USED BY ENGAGEMENT (at 6h) ===");
for (const [level, group] of Object.entries(engBuckets)) {
  if (group.length === 0) continue;
  const mults = group.map(g => g.mult).sort((a, b) => a - b);
  const avg = mults.reduce((s, v) => s + v, 0) / mults.length;
  const med = mults[Math.floor(mults.length / 2)];
  // Optimal multiplier (actual/bid)
  const optMults = group.map(g => g.actual / g.bid).sort((a, b) => a - b);
  const optAvg = optMults.reduce((s, v) => s + v, 0) / optMults.length;
  const optMed = optMults[Math.floor(optMults.length / 2)];
  console.log(`${level.padEnd(8)} n=${String(group.length).padStart(3)} mult_used: avg=${avg.toFixed(3)} med=${med.toFixed(3)} | optimal: avg=${optAvg.toFixed(3)} med=${optMed.toFixed(3)} | gap=${((optMed - med)/med*100).toFixed(1)}%`);
}

// What about bid count vs error at 6h?
console.log("\n=== BID COUNT vs ERROR (at 6h) ===");
const bidBuckets = { "low (<10)": [], "mid (10-25)": [], "high (25-50)": [], "very_high (50+)": [] };
for (const r of rows) {
  const b = r.bids ?? 0;
  const k = b < 10 ? "low (<10)" : b < 25 ? "mid (10-25)" : b < 50 ? "high (25-50)" : "very_high (50+)";
  bidBuckets[k].push(r);
}
for (const [name, group] of Object.entries(bidBuckets)) {
  if (group.length === 0) continue;
  const avgErr = group.reduce((s, g) => s + g.abs_error, 0) / group.length;
  const avgBias = group.reduce((s, g) => s + g.error_pct, 0) / group.length;
  const avgBids = group.reduce((s, g) => s + (g.bids || 0), 0) / group.length;
  console.log(`${name.padEnd(20)} n=${String(group.length).padStart(3)} MAPE=${avgErr.toFixed(1)}% bias=${avgBias.toFixed(1)}% avg_bids=${Math.round(avgBids)}`);
}

// Disable engagement correction simulation
console.log("\n=== SIMULATED: WHAT IF WE DISABLED ENGAGEMENT/COMPETITION CORRECTIONS? ===");
// The adjustment factor modifies the multiplier: adjusted = base * adjFactor
// To simulate disabling, we need: predicted_no_adj = predicted / adjFactor
// But we don't store adjFactor separately. However, the 6h dampening is 0.85,
// and the correction is applied as: factor = 1 + blendedDev * dampening
// We can't easily undo this. Let me just look at the multiplier_used range.

const mults = rows.map(r => r.mult).sort((a, b) => a - b);
console.log(`Multiplier range: ${mults[0].toFixed(3)} - ${mults[mults.length-1].toFixed(3)}`);
console.log(`p10=${mults[Math.floor(mults.length*0.1)].toFixed(3)} p25=${mults[Math.floor(mults.length*0.25)].toFixed(3)} med=${mults[Math.floor(mults.length*0.5)].toFixed(3)} p75=${mults[Math.floor(mults.length*0.75)].toFixed(3)} p90=${mults[Math.floor(mults.length*0.9)].toFixed(3)}`);

// Check the spread: how much do engagement corrections move the multiplier?
// The base coefficient for 6h is around 1.1-1.7 depending on tier
// If multiplier_used ranges from 0.3 to 3.0, the engagement correction is adding huge variance
const outlierMults = rows.filter(r => r.mult < 0.5 || r.mult > 3.0);
console.log(`\nMultiplier outliers (<0.5 or >3.0): ${outlierMults.length} of ${rows.length}`);
for (const o of outlierMults.slice(0, 10)) {
  console.log(`  mult=${o.mult.toFixed(3)} bid=$${Math.round(o.bid)} actual=$${Math.round(o.actual)} err=${o.error_pct.toFixed(0)}% tier=${o.price_tier}`);
}

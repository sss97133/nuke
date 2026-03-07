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

// Join backtest data with engagement AND bid progression data
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
         ve.watcher_count::int as watchers,
         ve.view_count::int as views,
         ve.bid_count::int as bid_count
  FROM backtest_run_details d
  JOIN vehicle_events ve ON ve.vehicle_id = d.vehicle_id
  WHERE d.run_id = (SELECT id FROM backtest_runs ORDER BY created_at DESC LIMIT 1)
    AND d.actual_hammer > 0 AND d.bid_at_window > 0
    AND d.comp_median > 0 AND d.comp_count >= 1
`);
console.log(`Loaded ${rows.length} predictions with comps and engagement\n`);

const tw2h = rows.filter(r => r.time_window === '2h');
const highComp = tw2h.filter(r => r.comp / r.bid >= 2.0);

console.log(`=== HIGH COMP/BID (>=2x) AUCTIONS AT 2h: n=${highComp.length} ===`);

// Split by outcome: did the auction actually grow significantly?
const grew = highComp.filter(r => r.actual / r.bid > 1.3);
const stalled = highComp.filter(r => r.actual / r.bid <= 1.3);
console.log(`  Grew (H/B>1.3): ${grew.length} (${(grew.length/highComp.length*100).toFixed(0)}%)`);
console.log(`  Stalled (H/B<=1.3): ${stalled.length} (${(stalled.length/highComp.length*100).toFixed(0)}%)`);

// What distinguishes growers from stallers?
function stats(group, label) {
  if (group.length === 0) return;
  const avgBid = group.reduce((s, g) => s + g.bid, 0) / group.length;
  const avgActual = group.reduce((s, g) => s + g.actual, 0) / group.length;
  const avgComp = group.reduce((s, g) => s + g.comp, 0) / group.length;
  const avgCompRatio = group.reduce((s, g) => s + g.comp / g.bid, 0) / group.length;
  const avgWatchers = group.reduce((s, g) => s + (g.watchers || 0), 0) / group.length;
  const avgViews = group.reduce((s, g) => s + (g.views || 0), 0) / group.length;
  const avgBidCount = group.reduce((s, g) => s + (g.bid_count || 0), 0) / group.length;
  const avgHB = group.reduce((s, g) => s + g.actual / g.bid, 0) / group.length;
  const avgError = group.reduce((s, g) => s + g.abs_error, 0) / group.length;
  const avgBias = group.reduce((s, g) => s + g.error_pct, 0) / group.length;

  // Price tier distribution
  const tiers = {};
  for (const g of group) {
    tiers[g.price_tier] = (tiers[g.price_tier] || 0) + 1;
  }

  console.log(`\n  ${label} (n=${group.length}):`);
  console.log(`    avg_bid=$${Math.round(avgBid).toLocaleString()} avg_actual=$${Math.round(avgActual).toLocaleString()} avg_H/B=${avgHB.toFixed(2)}`);
  console.log(`    avg_comp=$${Math.round(avgComp).toLocaleString()} avg_comp/bid=${avgCompRatio.toFixed(2)}`);
  console.log(`    avg_watchers=${Math.round(avgWatchers)} avg_views=${Math.round(avgViews)} avg_bid_count=${Math.round(avgBidCount)}`);
  console.log(`    MAPE=${avgError.toFixed(1)}% bias=${avgBias.toFixed(1)}%`);
  console.log(`    tiers: ${Object.entries(tiers).sort((a,b) => b[1]-a[1]).map(([t,n]) => `${t}:${n}`).join(', ')}`);
}

stats(grew, "GREW (H/B>1.3)");
stats(stalled, "STALLED (H/B<=1.3)");

// === Can we predict which high-comp auctions will grow? ===
console.log("\n=== POTENTIAL DISTINGUISHING FEATURES ===");

// Watcher count
console.log("\nBy watcher count (high comp/bid only):");
for (const threshold of [400, 600, 800]) {
  const lowW = highComp.filter(r => (r.watchers || 0) < threshold);
  const highW = highComp.filter(r => (r.watchers || 0) >= threshold);
  const lowGrew = lowW.filter(r => r.actual / r.bid > 1.3).length;
  const highGrew = highW.filter(r => r.actual / r.bid > 1.3).length;
  console.log(`  watchers<${threshold}: ${lowGrew}/${lowW.length} grew (${lowW.length ? (lowGrew/lowW.length*100).toFixed(0) : 0}%) | >=${threshold}: ${highGrew}/${highW.length} grew (${highW.length ? (highGrew/highW.length*100).toFixed(0) : 0}%)`);
}

// Bid count
console.log("\nBy bid count:");
for (const threshold of [10, 20, 30]) {
  const lowB = highComp.filter(r => (r.bid_count || 0) < threshold);
  const highB = highComp.filter(r => (r.bid_count || 0) >= threshold);
  const lowGrew = lowB.filter(r => r.actual / r.bid > 1.3).length;
  const highGrew = highB.filter(r => r.actual / r.bid > 1.3).length;
  console.log(`  bids<${threshold}: ${lowGrew}/${lowB.length} grew (${lowB.length ? (lowGrew/lowB.length*100).toFixed(0) : 0}%) | >=${threshold}: ${highGrew}/${highB.length} grew (${highB.length ? (highGrew/highB.length*100).toFixed(0) : 0}%)`);
}

// Comp/bid magnitude
console.log("\nBy comp/bid magnitude:");
for (const [lo, hi, label] of [[2, 3, "2-3x"], [3, 5, "3-5x"], [5, 100, "5x+"]]) {
  const bucket = highComp.filter(r => r.comp / r.bid >= lo && r.comp / r.bid < hi);
  const grew = bucket.filter(r => r.actual / r.bid > 1.3).length;
  const avgError = bucket.reduce((s, g) => s + g.abs_error, 0) / (bucket.length || 1);
  console.log(`  comp/bid ${label}: ${grew}/${bucket.length} grew (${bucket.length ? (grew/bucket.length*100).toFixed(0) : 0}%) MAPE=${avgError.toFixed(1)}%`);
}

// Price tier
console.log("\nBy price tier:");
const tierMap = {};
for (const r of highComp) {
  if (!tierMap[r.price_tier]) tierMap[r.price_tier] = { grew: 0, total: 0, errs: [] };
  tierMap[r.price_tier].total++;
  tierMap[r.price_tier].errs.push(r.abs_error);
  if (r.actual / r.bid > 1.3) tierMap[r.price_tier].grew++;
}
for (const [tier, data] of Object.entries(tierMap).sort((a,b) => b[1].total - a[1].total)) {
  const avgErr = data.errs.reduce((s, v) => s + v, 0) / data.errs.length;
  console.log(`  ${tier.padEnd(12)}: ${data.grew}/${data.total} grew (${(data.grew/data.total*100).toFixed(0)}%) MAPE=${avgErr.toFixed(1)}%`);
}

// === Look at across ALL windows - does bid progression help? ===
console.log("\n=== BID PROGRESSION: EARLY → LATE WINDOW GROWTH ===");
// For each vehicle, compute bid growth from 48h to 2h
const vehicleWindows = {};
for (const r of rows) {
  if (!vehicleWindows[r.vehicle_id]) vehicleWindows[r.vehicle_id] = {};
  vehicleWindows[r.vehicle_id][r.time_window] = r;
}

const progressions = [];
for (const [vid, wins] of Object.entries(vehicleWindows)) {
  if (!wins['48h'] || !wins['2h'] || !wins['2m']) continue;
  const bidGrowth48to2h = wins['2h'].bid / wins['48h'].bid;
  const finalHB = wins['2m'].actual / wins['2m'].bid; // H/B at 2m = actual final ratio
  const err2h = wins['2h'].abs_error;
  progressions.push({ bidGrowth48to2h, finalHB, err2h, comp: wins['2h'].comp, bid2h: wins['2h'].bid });
}

console.log(`Vehicles with 48h+2h+2m data: ${progressions.length}`);

const growthBuckets = { "slow (<1.5x)": [], "moderate (1.5-3x)": [], "fast (3-6x)": [], "explosive (6x+)": [] };
for (const p of progressions) {
  const k = p.bidGrowth48to2h < 1.5 ? "slow (<1.5x)" : p.bidGrowth48to2h < 3 ? "moderate (1.5-3x)" : p.bidGrowth48to2h < 6 ? "fast (3-6x)" : "explosive (6x+)";
  growthBuckets[k].push(p);
}

console.log("\nBid growth 48h→2h vs 2h prediction error:");
for (const [name, group] of Object.entries(growthBuckets)) {
  if (group.length === 0) continue;
  const avgErr = group.reduce((s, g) => s + g.err2h, 0) / group.length;
  const avgHB = group.reduce((s, g) => s + g.finalHB, 0) / group.length;
  const stalls = group.filter(g => g.finalHB <= 1.05).length;
  console.log(`  ${name.padEnd(22)} n=${String(group.length).padStart(3)} MAPE_2h=${avgErr.toFixed(1)}% avg_final_H/B=${avgHB.toFixed(2)} stalls=${stalls} (${(stalls/group.length*100).toFixed(0)}%)`);
}

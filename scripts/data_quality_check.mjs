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

// Get worst predictions at 2h window with listing details
const worst = await q(`
  SELECT d.vehicle_id, d.time_window, d.price_tier,
         d.bid_at_window::float as bid,
         d.predicted_hammer::float as pred,
         d.actual_hammer::float as actual,
         d.error_pct::float as error_pct,
         d.abs_error_pct::float as abs_error,
         d.comp_median::float as comp,
         d.comp_count::int as cc,
         d.multiplier_used::float as mult,
         el.listing_url,
         el.make, el.model, el.year,
         el.final_price::float as el_final_price,
         el.bid_count::int as bid_count,
         el.watcher_count::int as watchers,
         el.listing_status
  FROM backtest_run_details d
  JOIN external_listings el ON el.vehicle_id = d.vehicle_id
  WHERE d.run_id = (SELECT id FROM backtest_runs ORDER BY created_at DESC LIMIT 1)
    AND d.time_window = '2h'
    AND d.actual_hammer > 0 AND d.bid_at_window > 0
  ORDER BY d.abs_error_pct DESC
  LIMIT 30
`);

console.log("=== TOP 30 WORST 2h PREDICTIONS - DATA QUALITY CHECK ===\n");
for (const w of worst) {
  const hb = (w.actual / w.bid).toFixed(2);
  const cr = w.comp ? (w.comp / w.bid).toFixed(2) : 'n/a';
  // Flag potential issues
  const flags = [];
  if (w.actual / w.bid > 3) flags.push("EXTREME_HB");
  if (w.actual / w.bid < 0.95) flags.push("HAMMER_BELOW_BID");
  if (w.comp && w.comp / w.bid > 5) flags.push("EXTREME_COMP_RATIO");
  if (w.el_final_price && Math.abs(w.el_final_price - w.actual) / w.actual > 0.1) flags.push("PRICE_MISMATCH");
  if (!w.listing_url) flags.push("NO_URL");
  if (w.bid < 1000) flags.push("MICRO_BID");
  if (w.bid_count < 3) flags.push("LOW_BIDS");

  console.log(`${w.error_pct > 0 ? '+' : ''}${w.error_pct.toFixed(0)}% err | ${w.year || '?'} ${w.make} ${w.model}`);
  console.log(`  bid=$${Math.round(w.bid).toLocaleString()} actual=$${Math.round(w.actual).toLocaleString()} H/B=${hb} comp=$${w.comp ? Math.round(w.comp).toLocaleString() : 'n/a'} comp/bid=${cr} cc=${w.cc ?? 0}`);
  console.log(`  bids=${w.bid_count ?? '?'} watchers=${w.watchers ?? '?'} tier=${w.price_tier} status=${w.listing_status}`);
  if (flags.length) console.log(`  FLAGS: ${flags.join(', ')}`);
  console.log();
}

// Count and categorize data quality issues
console.log("\n=== DATA QUALITY SUMMARY ===");
const all2h = await q(`
  SELECT d.vehicle_id, d.bid_at_window::float as bid, d.actual_hammer::float as actual,
         d.abs_error_pct::float as abs_error, d.comp_median::float as comp,
         d.comp_count::int as cc,
         el.final_price::float as el_final_price
  FROM backtest_run_details d
  JOIN external_listings el ON el.vehicle_id = d.vehicle_id
  WHERE d.run_id = (SELECT id FROM backtest_runs ORDER BY created_at DESC LIMIT 1)
    AND d.time_window = '2h'
    AND d.actual_hammer > 0 AND d.bid_at_window > 0
`);

const extremeHB = all2h.filter(r => r.actual / r.bid > 3);
const microBid = all2h.filter(r => r.bid < 1000);
const priceMismatch = all2h.filter(r => r.el_final_price && Math.abs(r.el_final_price - r.actual) / r.actual > 0.1);
const extremeComp = all2h.filter(r => r.comp && r.comp / r.bid > 5);

console.log(`Total 2h predictions: ${all2h.length}`);
console.log(`Extreme H/B (>3x): ${extremeHB.length} (${(extremeHB.length/all2h.length*100).toFixed(1)}%)`);
console.log(`Micro bid (<$1k): ${microBid.length}`);
console.log(`Price mismatch (>10%): ${priceMismatch.length}`);
console.log(`Extreme comp ratio (>5x): ${extremeComp.length}`);

// What would MAPE be if we excluded extreme H/B auctions?
const avgAll = all2h.reduce((s, r) => s + r.abs_error, 0) / all2h.length;
const clean = all2h.filter(r => r.actual / r.bid <= 3 && r.bid >= 1000);
const avgClean = clean.reduce((s, r) => s + r.abs_error, 0) / clean.length;
console.log(`\n2h MAPE (all): ${avgAll.toFixed(1)}%`);
console.log(`2h MAPE (excluding H/B>3 and bid<1k): ${avgClean.toFixed(1)}% (n=${clean.length})`);

// Check if these extreme H/B auctions are genuine or data errors
console.log("\n=== EXTREME H/B AUCTION DETAILS ===");
const extremeDetails = await q(`
  SELECT d.vehicle_id,
         d.bid_at_window::float as bid, d.actual_hammer::float as actual,
         el.final_price::float as el_price, el.listing_url, el.make, el.model, el.year,
         el.bid_count, el.listing_status
  FROM backtest_run_details d
  JOIN external_listings el ON el.vehicle_id = d.vehicle_id
  WHERE d.run_id = (SELECT id FROM backtest_runs ORDER BY created_at DESC LIMIT 1)
    AND d.time_window = '2h'
    AND d.actual_hammer > 0 AND d.bid_at_window > 0
    AND d.actual_hammer::float / d.bid_at_window::float > 3
  ORDER BY d.actual_hammer::float / d.bid_at_window::float DESC
`);
for (const e of extremeDetails) {
  const hb = (e.actual / e.bid).toFixed(2);
  console.log(`  ${e.year || '?'} ${e.make} ${e.model}: bid=$${Math.round(e.bid).toLocaleString()} actual=$${Math.round(e.actual).toLocaleString()} H/B=${hb} el_price=$${e.el_price ? Math.round(e.el_price).toLocaleString() : '?'} bids=${e.bid_count ?? '?'} status=${e.listing_status}`);
}

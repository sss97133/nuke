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

// Build materialized data with LIMIT to avoid timeout
const rows = await q(`
  WITH base AS (
    SELECT el.vehicle_id, el.final_price, el.watcher_count, el.view_count,
      (SELECT MAX(bb.bid_amount) FROM bat_bids bb WHERE bb.vehicle_id = el.vehicle_id AND bb.bid_amount > 0) as max_bid,
      (SELECT COUNT(DISTINCT bb.bidder_username) FROM bat_bids bb WHERE bb.vehicle_id = el.vehicle_id AND bb.bid_amount > 0) as unique_bidders
    FROM external_listings el
    WHERE el.platform = 'bat' AND el.listing_status = 'sold'
      AND el.final_price > 0 AND el.end_date >= NOW() - INTERVAL '90 days'
      AND el.watcher_count > 0
    LIMIT 500
  )
  SELECT *, final_price::float / NULLIF(max_bid::float, 0) as hb_ratio
  FROM base
  WHERE max_bid >= 2000
`);
console.log(`Loaded ${rows.length} auctions\n`);

// Watcher count buckets
const buckets = { "low (<300)": [], "mid (300-600)": [], "high (600-1200)": [], "very_high (1200+)": [] };
for (const r of rows) {
  const w = r.watcher_count;
  const key = w < 300 ? "low (<300)" : w < 600 ? "mid (300-600)" : w < 1200 ? "high (600-1200)" : "very_high (1200+)";
  buckets[key].push(r);
}

console.log("=== WATCHER COUNT vs H/B RATIO ===");
for (const [name, group] of Object.entries(buckets)) {
  if (group.length === 0) continue;
  const hbs = group.map(g => g.hb_ratio).sort((a, b) => a - b);
  const avg = hbs.reduce((s, v) => s + v, 0) / hbs.length;
  const med = hbs[Math.floor(hbs.length / 2)];
  const avgPrice = group.reduce((s, g) => s + g.final_price, 0) / group.length;
  console.log(`${name.padEnd(20)} n=${String(group.length).padStart(4)} avg_H/B=${avg.toFixed(3)} med_H/B=${med.toFixed(3)} avg_price=$${Math.round(avgPrice).toLocaleString()}`);
}

// Watcher/bidder conversion
console.log("\n=== WATCHER/BIDDER CONVERSION vs H/B ===");
const convBuckets = { "high_conv (<30)": [], "mid_conv (30-80)": [], "low_conv (80-200)": [], "very_low_conv (200+)": [] };
for (const r of rows) {
  if (!r.unique_bidders || r.unique_bidders === 0) continue;
  const ratio = r.watcher_count / r.unique_bidders;
  const key = ratio < 30 ? "high_conv (<30)" : ratio < 80 ? "mid_conv (30-80)" : ratio < 200 ? "low_conv (80-200)" : "very_low_conv (200+)";
  convBuckets[key].push(r);
}
for (const [name, group] of Object.entries(convBuckets)) {
  if (group.length === 0) continue;
  const hbs = group.map(g => g.hb_ratio);
  const avg = hbs.reduce((s, v) => s + v, 0) / hbs.length;
  const avgBidders = group.reduce((s, g) => s + g.unique_bidders, 0) / group.length;
  console.log(`${name.padEnd(22)} n=${String(group.length).padStart(4)} avg_H/B=${avg.toFixed(3)} avg_bidders=${avgBidders.toFixed(1)}`);
}

// View/watcher ratio (engagement quality)
console.log("\n=== VIEW/WATCHER RATIO vs H/B ===");
const engBuckets = { "engaged (<4)": [], "moderate (4-6)": [], "passive (6-10)": [], "very_passive (10+)": [] };
for (const r of rows) {
  if (!r.view_count || !r.watcher_count) continue;
  const ratio = r.view_count / r.watcher_count;
  const key = ratio < 4 ? "engaged (<4)" : ratio < 6 ? "moderate (4-6)" : ratio < 10 ? "passive (6-10)" : "very_passive (10+)";
  engBuckets[key].push(r);
}
for (const [name, group] of Object.entries(engBuckets)) {
  if (group.length === 0) continue;
  const hbs = group.map(g => g.hb_ratio);
  const avg = hbs.reduce((s, v) => s + v, 0) / hbs.length;
  console.log(`${name.padEnd(20)} n=${String(group.length).padStart(4)} avg_H/B=${avg.toFixed(3)}`);
}

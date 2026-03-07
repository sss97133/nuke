// Analyze engagement metrics (view_count) vs prediction accuracy
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = { "Authorization": `Bearer ${key}`, "Content-Type": "application/json", "apikey": key };

async function query(sql) {
  const r = await fetch(`${url}/rest/v1/rpc/execute_sql`, {
    method: "POST", headers: h,
    body: JSON.stringify({ query: sql })
  });
  const d = await r.json();
  if (d.error || d.code) { console.error("SQL error:", JSON.stringify(d)); return []; }
  return Array.isArray(d) ? d : [];
}

// Watcher count vs H/B ratio
const w = await query(`
  WITH with_bids AS (
    SELECT ve.vehicle_id, ve.final_price, ve.view_count,
           (SELECT MAX(bb.bid_amount) FROM bat_bids bb WHERE bb.vehicle_id = ve.vehicle_id AND bb.bid_amount > 0) as final_bid
    FROM vehicle_events ve
    WHERE ve.source_platform = 'bat'
      AND ve.event_status = 'sold'
      AND ve.final_price > 0
      AND ve.ended_at >= NOW() - INTERVAL '90 days'
  )
  SELECT
    CASE
      WHEN view_count IS NULL OR view_count = 0 THEN 'a_no_data'
      WHEN view_count < 200 THEN 'b_low'
      WHEN view_count < 500 THEN 'c_mid'
      WHEN view_count < 1000 THEN 'd_high'
      ELSE 'e_very_high'
    END as bucket,
    COUNT(*) as n,
    ROUND(AVG(final_price::float / NULLIF(final_bid::float, 0))::numeric, 3) as avg_hb,
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY final_price::float / NULLIF(final_bid::float, 0))::numeric, 3) as med_hb,
    ROUND(AVG(final_price)::numeric, 0) as avg_price
  FROM with_bids
  WHERE final_bid >= 2000
  GROUP BY 1
  ORDER BY 1
`);
console.log("=== WATCHER COUNT vs H/B RATIO ===");
for (const d of w) {
  const name = d.bucket.replace(/^[a-e]_/, '');
  console.log(`${name.padEnd(12)} n=${String(d.n).padStart(4)} avg_H/B=${d.avg_hb} med_H/B=${d.med_hb} avg_price=$${d.avg_price}`);
}

// Watcher-to-bidder conversion vs H/B
const c = await query(`
  WITH with_bids AS (
    SELECT ve.vehicle_id, ve.final_price, ve.view_count,
           (SELECT MAX(bb.bid_amount) FROM bat_bids bb WHERE bb.vehicle_id = ve.vehicle_id AND bb.bid_amount > 0) as final_bid,
           (SELECT COUNT(DISTINCT bb.bidder_username) FROM bat_bids bb WHERE bb.vehicle_id = ve.vehicle_id AND bb.bid_amount > 0) as unique_bidders
    FROM vehicle_events ve
    WHERE ve.source_platform = 'bat'
      AND ve.event_status = 'sold'
      AND ve.final_price > 0
      AND ve.ended_at >= NOW() - INTERVAL '90 days'
      AND ve.view_count > 0
  )
  SELECT
    CASE
      WHEN unique_bidders = 0 THEN 'a_no_bidders'
      WHEN view_count::float / unique_bidders < 50 THEN 'b_high_convert'
      WHEN view_count::float / unique_bidders < 100 THEN 'c_mid_convert'
      WHEN view_count::float / unique_bidders < 200 THEN 'd_low_convert'
      ELSE 'e_very_low_convert'
    END as bucket,
    COUNT(*) as n,
    ROUND(AVG(final_price::float / NULLIF(final_bid::float, 0))::numeric, 3) as avg_hb,
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY final_price::float / NULLIF(final_bid::float, 0))::numeric, 3) as med_hb,
    ROUND(AVG(unique_bidders)::numeric, 1) as avg_bidders,
    ROUND(AVG(view_count)::numeric, 0) as avg_views
  FROM with_bids
  WHERE final_bid >= 2000
  GROUP BY 1
  ORDER BY 1
`);
console.log("\n=== WATCHER/BIDDER CONVERSION vs H/B RATIO ===");
for (const d of c) {
  const name = d.bucket.replace(/^[a-e]_/, '');
  console.log(`${name.padEnd(18)} n=${String(d.n).padStart(4)} avg_H/B=${d.avg_hb} med_H/B=${d.med_hb} bidders=${d.avg_bidders} views=${d.avg_views}`);
}

// Views per watcher (engagement quality)
const v = await query(`
  WITH with_bids AS (
    SELECT ve.vehicle_id, ve.final_price, ve.view_count,
           (SELECT MAX(bb.bid_amount) FROM bat_bids bb WHERE bb.vehicle_id = ve.vehicle_id AND bb.bid_amount > 0) as final_bid
    FROM vehicle_events ve
    WHERE ve.source_platform = 'bat'
      AND ve.event_status = 'sold'
      AND ve.final_price > 0
      AND ve.ended_at >= NOW() - INTERVAL '90 days'
      AND ve.view_count > 0
  )
  SELECT
    CASE
      WHEN view_count < 3 THEN 'a_very_engaged'
      WHEN view_count < 5 THEN 'b_engaged'
      WHEN view_count < 8 THEN 'c_moderate'
      ELSE 'd_passive'
    END as bucket,
    COUNT(*) as n,
    ROUND(AVG(final_price::float / NULLIF(final_bid::float, 0))::numeric, 3) as avg_hb,
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY final_price::float / NULLIF(final_bid::float, 0))::numeric, 3) as med_hb
  FROM with_bids
  WHERE final_bid >= 2000
  GROUP BY 1
  ORDER BY 1
`);
console.log("\n=== VIEW/WATCHER RATIO (engagement quality) vs H/B RATIO ===");
for (const d of v) {
  const name = d.bucket.replace(/^[a-d]_/, '');
  console.log(`${name.padEnd(15)} n=${String(d.n).padStart(4)} avg_H/B=${d.avg_hb} med_H/B=${d.med_hb}`);
}

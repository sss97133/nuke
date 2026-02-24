const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = { "Authorization": `Bearer ${key}`, "Content-Type": "application/json", "apikey": key };

async function q(sql) {
  const r = await fetch(`${url}/rest/v1/rpc/execute_sql`, {
    method: "POST", headers: h,
    body: JSON.stringify({ query: sql })
  });
  return await r.json();
}

// Step 1: Basic count
const r1 = await q("SELECT COUNT(*) FROM external_listings WHERE platform = 'bat' AND listing_status = 'sold' AND final_price > 0 AND end_date >= NOW() - INTERVAL '90 days' AND watcher_count > 0");
console.log("Step 1 (base count):", JSON.stringify(r1));

// Step 2: One sample with subquery
const r2 = await q(`
  SELECT el.vehicle_id, el.final_price, el.watcher_count,
    (SELECT MAX(bb.bid_amount) FROM bat_bids bb WHERE bb.vehicle_id = el.vehicle_id AND bb.bid_amount > 0) as max_bid
  FROM external_listings el
  WHERE el.platform = 'bat' AND el.listing_status = 'sold'
    AND el.final_price > 0 AND el.end_date >= NOW() - INTERVAL '90 days'
    AND el.watcher_count > 0
  LIMIT 3
`);
console.log("Step 2 (sample):", JSON.stringify(r2));

// Step 3: Filter max_bid >= 2000
const r3 = await q(`
  WITH base AS (
    SELECT el.vehicle_id, el.final_price, el.watcher_count,
      (SELECT MAX(bb.bid_amount) FROM bat_bids bb WHERE bb.vehicle_id = el.vehicle_id AND bb.bid_amount > 0) as max_bid
    FROM external_listings el
    WHERE el.platform = 'bat' AND el.listing_status = 'sold'
      AND el.final_price > 0 AND el.end_date >= NOW() - INTERVAL '90 days'
      AND el.watcher_count > 0
    LIMIT 10
  )
  SELECT * FROM base WHERE max_bid >= 2000
`);
console.log("Step 3 (filtered):", JSON.stringify(r3));

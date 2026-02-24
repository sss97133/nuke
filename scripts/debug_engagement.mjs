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

// Check data availability step by step
const r1 = await q("SELECT COUNT(*) as n FROM external_listings WHERE platform = 'bat' AND listing_status = 'sold' AND final_price > 0 AND end_date >= NOW() - INTERVAL '90 days'");
console.log("Sold BaT 90d:", JSON.stringify(r1));

const r2 = await q("SELECT COUNT(DISTINCT vehicle_id) as n FROM bat_bids WHERE bid_amount > 0");
console.log("Vehicles with bids:", JSON.stringify(r2));

// Check overlap
const r3 = await q(`
  SELECT COUNT(*) as n FROM external_listings el
  WHERE el.platform = 'bat' AND el.listing_status = 'sold' AND el.final_price > 0
    AND el.end_date >= NOW() - INTERVAL '90 days'
    AND EXISTS (SELECT 1 FROM bat_bids bb WHERE bb.vehicle_id = el.vehicle_id AND bb.bid_amount > 0)
`);
console.log("Sold with bids:", JSON.stringify(r3));

// Sample a few
const r4 = await q(`
  SELECT el.vehicle_id, el.final_price, el.watcher_count, el.view_count,
    (SELECT MAX(bb.bid_amount) FROM bat_bids bb WHERE bb.vehicle_id = el.vehicle_id) as max_bid
  FROM external_listings el
  WHERE el.platform = 'bat' AND el.listing_status = 'sold' AND el.final_price > 0
    AND el.end_date >= NOW() - INTERVAL '90 days'
  LIMIT 5
`);
console.log("Samples:", JSON.stringify(r4, null, 2));

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = { "Authorization": `Bearer ${key}`, "Content-Type": "application/json", "apikey": key };

const r = await fetch(`${url}/rest/v1/rpc/execute_sql`, {
  method: "POST", headers: h,
  body: JSON.stringify({
    query: "SELECT COUNT(*) as total, SUM(CASE WHEN view_count > 0 THEN 1 ELSE 0 END) as with_views FROM vehicle_events WHERE source_platform = 'bat' AND event_status = 'sold' AND final_price > 0 AND ended_at >= NOW() - INTERVAL '90 days'"
  })
});
console.log(JSON.stringify(await r.json(), null, 2));

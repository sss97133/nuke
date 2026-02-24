// Alpha sweep for 2m window predictions
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = { "Authorization": `Bearer ${key}`, "Content-Type": "application/json", "apikey": key };

const resp = await fetch(`${url}/rest/v1/rpc/execute_sql`, {
  method: "POST",
  headers: h,
  body: JSON.stringify({
    query: `SELECT price_tier, bid_at_window::float, actual_hammer::float
            FROM backtest_run_details
            WHERE run_id = (SELECT id FROM backtest_runs ORDER BY created_at DESC LIMIT 1)
            AND time_window = '2m' AND bid_at_window > 0 AND actual_hammer > 0`
  })
});
const rows = await resp.json();
console.log(`Rows: ${rows.length}`);

const coeffs = {
  under_5k: 1.188, "5k_10k": 1.221, "10k_15k": 1, "15k_30k": 1,
  "30k_60k": 1, "60k_100k": 1.086, "100k_200k": 1.054, over_200k: 1.016
};

const alphas = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
for (const a of alphas) {
  let tot = 0, n = 0;
  const byT = {};
  for (const r of rows) {
    const c = coeffs[r.price_tier] || 1;
    const pred = a * r.bid_at_window * c + (1 - a) * r.bid_at_window;
    const e = Math.abs((pred - r.actual_hammer) / r.actual_hammer * 100);
    tot += Math.min(e, 200);
    n++;
    if (!byT[r.price_tier]) byT[r.price_tier] = { s: 0, n: 0 };
    byT[r.price_tier].s += Math.min(e, 200);
    byT[r.price_tier].n++;
  }
  const tierParts = Object.entries(byT).sort().map(([t, v]) => `${t}:${(v.s / v.n).toFixed(1)}`);
  console.log(`a=${a.toFixed(1)} ALL=${(tot / n).toFixed(1)}% | ${tierParts.join(" ")}`);
}

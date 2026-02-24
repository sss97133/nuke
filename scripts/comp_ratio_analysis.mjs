// Analyze comp/bid ratio distribution vs prediction error
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = { "Authorization": `Bearer ${key}`, "Content-Type": "application/json", "apikey": key };

const resp = await fetch(`${url}/rest/v1/rpc/execute_sql`, {
  method: "POST",
  headers: h,
  body: JSON.stringify({
    query: `
      WITH ratios AS (
        SELECT d.price_tier, d.time_window,
               d.comp_median::float / NULLIF(d.bid_at_window::float, 0) as comp_bid_ratio,
               ABS((d.predicted_hammer - d.actual_hammer) / NULLIF(d.actual_hammer, 0) * 100) as abs_error,
               d.actual_hammer::float / NULLIF(d.bid_at_window::float, 0) as hb_ratio
        FROM backtest_run_details d
        WHERE d.run_id = (SELECT id FROM backtest_runs ORDER BY created_at DESC LIMIT 1)
          AND d.bid_at_window > 0 AND d.actual_hammer > 0
          AND d.comp_median > 0 AND d.comp_count >= 1
      )
      SELECT
        CASE
          WHEN comp_bid_ratio < 0.5 THEN 'a_lt_0.5x'
          WHEN comp_bid_ratio < 1.0 THEN 'b_0.5-1x'
          WHEN comp_bid_ratio < 1.5 THEN 'c_1-1.5x'
          WHEN comp_bid_ratio < 2.0 THEN 'd_1.5-2x'
          WHEN comp_bid_ratio < 3.0 THEN 'e_2-3x'
          WHEN comp_bid_ratio < 5.0 THEN 'f_3-5x'
          ELSE 'g_5x_plus'
        END as ratio_bucket,
        COUNT(*) as n,
        ROUND(AVG(abs_error)::numeric, 1) as avg_error,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY abs_error)::numeric, 1) as median_error,
        ROUND(AVG(hb_ratio)::numeric, 2) as avg_hb
      FROM ratios
      GROUP BY 1
      ORDER BY 1
    `
  })
});
const dist = await resp.json();
console.log("=== COMP/BID RATIO vs ERROR ===");
for (const d of dist) {
  const name = d.ratio_bucket.replace(/^[a-g]_/, '');
  console.log(`${name.padEnd(10)} n=${String(d.n).padStart(4)} avg_err=${String(d.avg_error).padStart(5)}% med_err=${String(d.median_error).padStart(5)}% avg_H/B=${d.avg_hb}`);
}

// Also test: what MAPE would be if we capped comp ratio at various levels
console.log("\n=== BACKTEST: COMP RATIO CAP ===");
for (const cap of [null, 5.0, 3.0, 2.5, 2.0, 1.5]) {
  const r = await fetch(`${url}/functions/v1/backtest-hammer-simulator`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({
      mode: "full_backtest",
      limit: 300,
      lookback_days: 60,
      comp_ratio_max: cap
    })
  });
  const result = await r.json();
  const mape = result.accuracy?.mape ?? "?";
  const bias = result.accuracy?.bias_pct ?? "?";
  console.log(`comp_ratio_max=${String(cap ?? "none").padEnd(5)} MAPE=${mape}% bias=${bias}%`);
}

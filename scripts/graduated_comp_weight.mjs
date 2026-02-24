// Test graduated comp weight that attenuates based on comp/bid ratio
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = { "Authorization": `Bearer ${key}`, "Content-Type": "application/json", "apikey": key };

// Get raw prediction data from latest backtest
const resp = await fetch(`${url}/rest/v1/rpc/execute_sql`, {
  method: "POST",
  headers: h,
  body: JSON.stringify({
    query: `
      SELECT d.price_tier, d.time_window,
             d.bid_at_window::float as bid,
             d.predicted_hammer::float as pred,
             d.actual_hammer::float as actual,
             d.comp_median::float as comp,
             d.comp_count::int as comp_count,
             d.multiplier_used::float as multiplier
      FROM backtest_run_details d
      WHERE d.run_id = (SELECT id FROM backtest_runs ORDER BY created_at DESC LIMIT 1)
        AND d.bid_at_window > 0 AND d.actual_hammer > 0
    `
  })
});
const rows = await resp.json();
console.log(`Loaded ${rows.length} predictions\n`);

// Reverse-engineer the base prediction (without comp blend) and comp weight used
// Current model: predicted = basePred * (1 - compWeight) + comp * compWeight
// where compWeight is 0.25 at 48h/24h, 0.16 elsewhere (when comp_count >= 1)
// basePred = (pred - comp * compWeight) / (1 - compWeight) when comp blend was applied

function getHoursRemaining(tw) {
  const map = { '48h': 40, '24h': 20, '12h': 10, '6h': 5, '2h': 1.5, '30m': 0.4, '2m': 0.05 };
  return map[tw] || 1;
}

function computeMAPE(rows, compWeightFn) {
  let totalError = 0;
  let n = 0;
  const byTier = {};

  for (const r of rows) {
    const hrs = getHoursRemaining(r.time_window);
    const currentCompWeight = hrs > 12 ? 0.25 : 0.16;

    // Reverse-engineer basePrediction
    let basePred;
    if (r.comp && r.comp > 0 && r.comp_count >= 1) {
      basePred = (r.pred - r.comp * currentCompWeight) / (1 - currentCompWeight);
    } else {
      basePred = r.pred;
    }

    // Apply new comp weight
    let newPred;
    if (r.comp && r.comp > 0 && r.comp_count >= 1) {
      const ratio = r.comp / r.bid;
      const newWeight = compWeightFn(hrs, ratio, r.comp_count, r.price_tier);
      newPred = Math.round(basePred * (1 - newWeight) + r.comp * newWeight);
    } else {
      newPred = Math.round(basePred);
    }

    const error = Math.abs((newPred - r.actual) / r.actual * 100);
    const cappedError = Math.min(error, 200);
    totalError += cappedError;
    n++;

    const key = r.price_tier;
    if (!byTier[key]) byTier[key] = { total: 0, n: 0 };
    byTier[key].total += cappedError;
    byTier[key].n++;
  }

  return { mape: (totalError / n).toFixed(1), byTier };
}

// Test configurations
const configs = [
  {
    name: "v33 baseline (no change)",
    fn: (hrs) => hrs > 12 ? 0.25 : 0.16
  },
  {
    name: "softcap=3x",
    fn: (hrs, ratio) => {
      const base = hrs > 12 ? 0.25 : 0.16;
      return ratio > 3 ? base * (3 / ratio) : base;
    }
  },
  {
    name: "softcap=2x",
    fn: (hrs, ratio) => {
      const base = hrs > 12 ? 0.25 : 0.16;
      return ratio > 2 ? base * (2 / ratio) : base;
    }
  },
  {
    name: "softcap=1.5x",
    fn: (hrs, ratio) => {
      const base = hrs > 12 ? 0.25 : 0.16;
      return ratio > 1.5 ? base * (1.5 / ratio) : base;
    }
  },
  {
    name: "log-decay from 2x",
    fn: (hrs, ratio) => {
      const base = hrs > 12 ? 0.25 : 0.16;
      if (ratio <= 2) return base;
      return base / Math.log2(ratio);
    }
  },
  {
    name: "sqrt-decay from 2x",
    fn: (hrs, ratio) => {
      const base = hrs > 12 ? 0.25 : 0.16;
      if (ratio <= 2) return base;
      return base * Math.sqrt(2 / ratio);
    }
  },
  {
    name: "comp_count weighted",
    fn: (hrs, ratio, cc) => {
      const base = hrs > 12 ? 0.25 : 0.16;
      // More comps = more trust; 1 comp = 50% weight, 10+ = 100%
      const ccFactor = Math.min(1, 0.5 + cc / 20);
      return base * ccFactor;
    }
  },
  {
    name: "comp_count + softcap=2x",
    fn: (hrs, ratio, cc) => {
      const base = hrs > 12 ? 0.25 : 0.16;
      const ccFactor = Math.min(1, 0.5 + cc / 20);
      const ratioFactor = ratio > 2 ? (2 / ratio) : 1;
      return base * ccFactor * ratioFactor;
    }
  },
  {
    name: "higher base 30%/20% no cap",
    fn: (hrs) => hrs > 12 ? 0.30 : 0.20
  },
  {
    name: "higher base 35%/25% no cap",
    fn: (hrs) => hrs > 12 ? 0.35 : 0.25
  },
  {
    name: "lower base 20%/12% no cap",
    fn: (hrs) => hrs > 12 ? 0.20 : 0.12
  },
];

console.log("=== GRADUATED COMP WEIGHT SWEEP ===\n");
for (const config of configs) {
  const result = computeMAPE(rows, config.fn);
  const tierStr = Object.entries(result.byTier)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([t, v]) => `${t.substring(0, 6)}:${(v.total / v.n).toFixed(1)}`)
    .join(" ");
  console.log(`${config.name.padEnd(35)} MAPE=${result.mape}%  | ${tierStr}`);
}

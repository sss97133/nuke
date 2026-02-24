/**
 * Run 1983 GMC K2500 final result + Nuke estimates + comps.
 * Usage from repo root: node scripts/run-gmc-k2500-result.mjs
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const VEHICLE_ID = 'a90c008a-3379-41d8-9eb2-b4eda365d74c';

async function run() {
  console.log('--- 1983 GMC K2500 (BaT 1983-gmc-k2500-2) — Final $31,000 ---\n');

  // 1) Hammer predictions
  const { data: predictions, error: e1 } = await supabase
    .from('hammer_predictions')
    .select('predicted_at, current_bid, hours_remaining, time_window, comp_median, comp_count, predicted_hammer, predicted_low, predicted_high, confidence_score, bid_velocity, buy_recommendation, actual_hammer, prediction_error_pct, prediction_error_usd')
    .eq('vehicle_id', VEHICLE_ID)
    .order('predicted_at', { ascending: false })
    .limit(10);

  if (e1) {
    console.log('1) Hammer predictions error:', e1.message);
  } else if (!predictions?.length) {
    console.log('1) Hammer predictions: none found for this vehicle.\n');
  } else {
    console.log('1) Hammer predictions (latest first):');
    predictions.forEach((p, i) => {
      console.log(`   [${i + 1}] ${p.predicted_at} | bid $${p.current_bid} | ${p.hours_remaining?.toFixed(1)}h left | window ${p.time_window} | comp_median $${p.comp_median} (n=${p.comp_count}) | predicted $${p.predicted_hammer} (${p.predicted_low}-${p.predicted_high}) | conf ${p.confidence_score} | ${p.buy_recommendation || '-'}`);
      if (p.actual_hammer != null) console.log(`       actual $${p.actual_hammer} | error ${p.prediction_error_pct}% ($${p.prediction_error_usd})`);
    });
    console.log('');
  }

  // 2) Vehicle row
  const { data: vehicle, error: e2 } = await supabase
    .from('vehicles')
    .select('id, year, make, model, sale_price, winning_bid, high_bid, asking_price, current_value, nuke_estimate, nuke_estimate_confidence, deal_score')
    .eq('id', VEHICLE_ID)
    .single();

  if (e2) {
    console.log('2) Vehicle error:', e2.message);
  } else if (!vehicle) {
    console.log('2) Vehicle: not found.\n');
  } else {
    console.log('2) Vehicle:');
    console.log('   sale_price:', vehicle.sale_price, '| winning_bid:', vehicle.winning_bid, '| high_bid:', vehicle.high_bid);
    console.log('   asking_price:', vehicle.asking_price, '| current_value:', vehicle.current_value);
    console.log('   nuke_estimate:', vehicle.nuke_estimate, '| nuke_estimate_confidence:', vehicle.nuke_estimate_confidence, '| deal_score:', vehicle.deal_score);
    console.log('');
  }

  // 3) Comps summary via RPC
  const compSummaryQuery = `
    SELECT
      COUNT(*) AS comp_count,
      ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY el.final_price)::numeric, 0) AS comp_median,
      ROUND(AVG(el.final_price)::numeric, 0) AS comp_avg,
      ROUND(MIN(el.final_price)::numeric, 0) AS comp_min,
      ROUND(MAX(el.final_price)::numeric, 0) AS comp_max
    FROM external_listings el
    JOIN vehicles v ON v.id = el.vehicle_id
    WHERE UPPER(v.make) = 'GMC'
      AND (v.model ILIKE '%C2500%' OR v.model ILIKE '%C/K%' OR v.model ILIKE '%K2500%' OR v.model ILIKE '%Sierra%' OR v.model ILIKE '%K10%' OR v.model ILIKE '%K20%')
      AND v.year BETWEEN 1978 AND 1988
      AND v.is_public = true
      AND el.platform = 'bat'
      AND el.listing_status = 'sold'
      AND el.final_price > 0
      AND el.end_date >= NOW() - INTERVAL '12 months'
      AND LOWER(COALESCE(v.model, '')) NOT SIMILAR TO '%(parts|engine|seats|wheels|door|hood|trunk|bumper|fender|transmission)%'
  `;
  const { data: compSummary, error: e3 } = await supabase.rpc('execute_sql', { query: compSummaryQuery });
  const compRows = Array.isArray(compSummary) ? compSummary : compSummary?.error ? null : [compSummary];

  if (e3 || compSummary?.error) {
    console.log('3) Comps summary error:', e3?.message || compSummary?.error);
  } else if (compRows?.[0]) {
    const c = compRows[0];
    console.log('3) GMC C/K comps (1978–1988, BaT sold last 12 months):');
    console.log('   count:', c.comp_count, '| median $' + c.comp_median, '| avg $' + c.comp_avg, '| min $' + c.comp_min, '| max $' + c.comp_max);
    console.log('   → $31,000 vs median:', c.comp_median ? (31000 - Number(c.comp_median)) : 'N/A', '(', c.comp_median ? ((31000 / Number(c.comp_median) - 1) * 100).toFixed(1) + '% vs median)' : '', ')');
    console.log('');
  } else {
    console.log('3) Comps summary: no rows.\n');
  }

  // 4) List recent comp sales
  const compListQuery = `
    SELECT v.year, v.make, v.model, el.final_price, el.end_date::date
    FROM external_listings el
    JOIN vehicles v ON v.id = el.vehicle_id
    WHERE UPPER(v.make) = 'GMC'
      AND (v.model ILIKE '%C2500%' OR v.model ILIKE '%C/K%' OR v.model ILIKE '%K2500%' OR v.model ILIKE '%Sierra%' OR v.model ILIKE '%K10%' OR v.model ILIKE '%K20%')
      AND v.year BETWEEN 1978 AND 1988
      AND v.is_public = true
      AND el.platform = 'bat'
      AND el.listing_status = 'sold'
      AND el.final_price > 0
      AND el.end_date >= NOW() - INTERVAL '12 months'
    ORDER BY el.end_date DESC
    LIMIT 20
  `;
  const { data: compList, error: e4 } = await supabase.rpc('execute_sql', { query: compListQuery });
  const list = Array.isArray(compList) ? compList : compList?.error ? null : [compList];

  if (e4 || compList?.error) {
    console.log('4) Comps list error:', e4?.message || compList?.error);
  } else if (list?.length) {
    console.log('4) Recent GMC truck comp sales:');
    list.forEach((row, i) => {
      console.log(`   ${row.year} ${row.make} ${row.model} — $${row.final_price} (${row.end_date})`);
    });
  } else {
    console.log('4) No comp sales in range.');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

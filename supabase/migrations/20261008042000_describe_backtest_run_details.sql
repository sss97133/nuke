-- Describe backtest_run_details: all 17 columns (0 of 17 had a COMMENT ON COLUMN before; catalog count on prod, 2026-10-07)
-- and the first table comment (there was none). Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Read-only table in the atlas: 1,139,191 rows on 2026-10-07 15:49Z by exact count (the
-- atlas estimate of 1,141,106 is a stale pg_class.reltuples); no write since 2026-02-19 19:49Z and no scan since the
-- statistics counters began.
--
-- METHOD (read 2026-10-07 15:47-16:20Z UTC):
--   Columns, types, defaults, constraints (with convalidated), indexes, triggers, policies, RLS, grants
--   (has_table_privilege for anon and authenticated) and existing comments from pg_attribute, pg_attrdef, pg_constraint,
--   pg_indexes, pg_trigger, pg_policy, pg_class and pg_description; views and foreign keys in from pg_depend and
--   pg_constraint (none). Exact over the whole table (180 MB heap, 223 MB in all, read only): the row count, the fill
--   (count) and min and max of every column, the counts by day, run, mode, model version, time_window and price_tier,
--   the distinct runs and vehicles, the vehicles missing from vehicles, the uniqueness of (run_id, vehicle_id,
--   time_window), the comp_count zeros and the rows with error_pct above 1,000. From a 1% block sample (TABLESAMPLE SYSTEM
--   (1) REPEATABLE (20261007), 9,691 rows): medians and percentiles, the formula checks of error_pct, abs_error_pct and
--   optimal_multiplier, the bids under 2,000, the zero sniper premiums, the rows on missing vehicles and the lag behind
--   backtest_runs.created_at. backtest_runs (457 rows) read in full. What anon and authenticated can read comes from
--   counts under SET LOCAL ROLE in read-only transactions. "Filled" means non-NULL.
--   Writers and readers from code at origin/main 3df579ef7 (supabase/functions, supabase/migrations, scripts,
--   nuke_frontend/src, mcp-server, apps; git history for the deleted writer): the creating migration
--   supabase/migrations/20260219000001_backtest_simulator_schema.sql (also prod migration 20260219000001
--   backtest_simulator_schema); the writer supabase/functions/backtest-hammer-simulator (deleted by 5741560ae,
--   2026-03-10; read at 5741560ae^: fetchBacktestData, predictAtWindow, insertDetails, fullBacktest, suggestCoefficients)
--   and supabase/functions/_shared/predictionEngine.ts; the 12 reader scripts named in the table comment;
--   20261007170000_grade_hammer_predictions_by_lot.sql (names the table in a note); pg_proc bodies (no live function
--   names the table); execute_sql (SECURITY DEFINER, not executable by anon or authenticated); cron.job and
--   cron.job_run_details (no job names the writer); write_receipts (no rows); pg_stat_user_tables; pipeline_registry (no
--   row; none is added here); supabase_migrations.schema_migrations (no statement adds comp_median or comp_count or drops
--   the two indexes); the deployed function list read through the management API (328 functions, 2026-10-07).
-- LIMITS:
--   Medians, percentiles and formula checks come from a 1% block sample. The comparable set of comp_median is read from
--   the writer source, not recomputed. Who added comp_median and comp_count and who dropped the two indexes is not
--   recorded. How 602 vehicle ids left vehicles is not recorded. pg_stat_user_tables counters began at the last server
--   start (2026-09-29 09:20Z). Quoted values are window, tier, mode and version codes, code thresholds, column, function
--   and script names and counts only; no vehicle id, hammer price or bid.
-- CHANGED EXISTING COMMENTS:
--   None: the table had no comment and no column had one.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.backtest_run_details IS
'Per-auction, per-time-window predictions of the 2026-02 hammer-price backtest simulator: one row per run x auction x time window (grain; (run_id, vehicle_id, time_window) is unique except for 14 rows), holding the BaT hammer price, the highest bid at the window, the predicted hammer and its error. 1,139,191 rows on 2026-10-07 (the atlas estimate of 1,141,106 is a stale reltuples), all inserted 2026-02-18 22:03Z .. 2026-02-19 19:49Z by 347 runs of the edge function backtest-hammer-simulator: full_backtest 315 runs (943,363 rows) and suggest_coefficients 32 runs (195,828 rows). The other 110 rows of backtest_runs (compare_models, tune_sniper, cross_validate, auto_retrain and health_check runs and failed runs, the last on 2026-03-09 06:00Z) wrote no details. The runs replay 2,867 BaT auctions that closed 2025-12-22 .. 2026-02-18 under model versions 1 .. 23 of the prediction engine; version 13 alone accounts for 266 full_backtest runs and 667,065 rows (58.6%), so the same auctions recur across many runs. The writer was deleted by commit 5741560ae on 2026-03-10 and is not deployed (2026-10-07); no cron job names it. Liveness: no write since 2026-02-19 19:49Z; pg_stat_user_tables counts 0 inserts, updates, deletes and scans since the server last started (2026-09-29 09:20Z; read 15:47Z). Readers: 12 analysis scripts (scripts/adaptive_comp_weight.mjs, adjustment_factor_analysis.mjs, alpha_early_sweep.mjs, alpha_sweep_2m.mjs, cc_adaptive_weight.mjs, cc_adaptive_weight_v2.mjs, comp_bid_split_analysis.mjs, comp_quality_analysis.mjs, comp_ratio_analysis.mjs, data_quality_check.mjs, engagement_vs_error.mjs and graduated_comp_weight.mjs) read the details of the newest backtest_runs row through execute_sql; that row is a health_check run of 2026-03-09 with no details, so they read nothing. No SQL function, view, edge function or frontend page reads the table. Not point-in-time: comp_median and comp_count were computed at run time over BaT sales of the 12 months before the run, without excluding the auction under test or sales after its close (by the writer source). Orphans: vehicle_id has no foreign key, and 602 of the 2,867 vehicle ids (21.0%) are no longer in vehicles. Access: RLS is on with no policy; anon and authenticated hold SELECT, INSERT, UPDATE, DELETE and TRUNCATE, read 0 rows (counted under SET LOCAL ROLE, 2026-10-07) and cannot write rows through the API. No triggers, no write receipts, no pipeline_registry row. Schema drift: the creating migration supabase/migrations/20260219000001_backtest_simulator_schema.sql (also in prod history) creates idx_backtest_details_run and idx_backtest_details_window; prod has only the primary key, so a lookup by run_id or a delete of a backtest_runs row (run_id is ON DELETE CASCADE) reads the whole 180 MB heap. comp_median and comp_count were added outside the recorded migrations. Clocks: close_time is the auction close (event time); created_at is the insert time of the run; the bid of each window is taken at close_time minus time_window.';

-- ── Identity ───────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.backtest_run_details.id IS
'Surrogate key of the detail row, uuid NOT NULL, gen_random_uuid() default, the PRIMARY KEY (its 42 MB index is the only index of the table). 1,139,191 values (2026-10-07). No foreign key points at it. Unit: none (uuid). Source: column default. Grain: one run x auction x time window. Clock: n/a.';
COMMENT ON COLUMN public.backtest_run_details.run_id IS
'Run that produced the row: a backtest_runs.id, uuid NOT NULL, foreign key ON DELETE CASCADE (validated), not indexed (the creating migration declared idx_backtest_details_run; prod lacks it). 347 distinct runs (2026-10-07), created 2026-02-18 22:03Z .. 2026-02-19 19:48Z: full_backtest 315 runs (943,363 rows), suggest_coefficients 32 runs (195,828 rows). backtest_runs.mode and model_version tell how a row was predicted; model version 13 has 266 full_backtest and 14 suggest_coefficients runs here. In a 1% block sample every row was inserted within 43 s of its run row. Unit: none (uuid). Source: the writer. Grain: one run x auction x time window. Clock: n/a.';
COMMENT ON COLUMN public.backtest_run_details.vehicle_id IS
'Vehicle whose BaT auction was replayed: the vehicle_events.vehicle_id of the sold event at run time, uuid NOT NULL, no foreign key, no index. 2,867 distinct ids (2026-10-07); 602 of them (21.0%) are no longer in vehicles (how is not recorded), and 4,383 of the 9,691 rows of a 1% block sample (45.2%) point at such an id. The reader scripts join it to vehicle_events. Unit: none (uuid). Source: vehicle_events at run time. Grain: one run x auction x time window. Clock: n/a.';

-- ── Auction facts ──────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.backtest_run_details.actual_hammer IS
'Hammer price the auction reached: vehicle_events.final_price of the BaT event with event_status sold, as read when the run started, numeric NOT NULL. Filled on every row (2026-10-07). The writer took sales with final_price > 0 that closed within the lookback of the run and skipped lots it took for non-vehicles; 602 rows on 13 vehicles carry a value under 1,000. No amount is quoted here. It is the denominator of error_pct and the numerator of optimal_multiplier. Unit: the amount of vehicle_events.final_price (currency not recorded here). Source: vehicle_events at run time. Grain: one run x auction x time window (repeated across the windows and runs of one auction). Clock: as of close_time.';
COMMENT ON COLUMN public.backtest_run_details.close_time IS
'When the auction closed: vehicle_events.ended_at at run time, timestamptz, nullable, filled on every row, 2025-12-22 18:58Z .. 2026-02-18 18:54Z (2026-10-07). The bid of each window is read at close_time minus time_window. Unit: timestamptz. Source: vehicle_events.ended_at. Grain: one run x auction x time window. Clock: event time (auction close).';

-- ── Prediction input ───────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.backtest_run_details.time_window IS
'How long before the close the prediction is made, text NOT NULL, no CHECK, not indexed (idx_backtest_details_window of the creating migration is absent on prod). 7 codes (2026-10-07): 2m 167,866, 30m 164,890, 2h 163,855, 6h 162,501, 12h 162,313, 24h 160,226, 48h 157,540. A window is skipped when the auction had no bid by then or the bid fails the filters of the writer version (the last version skipped bids under 2,000 and hammer-to-bid ratios outside 0.5 .. 15). In a 1% block sample the median abs_error_pct is 0 at 2m and 19.4 at 48h. Unit: none (text code: duration before the close). Source: the writer. Grain: one run x auction x time window. Clock: n/a.';
COMMENT ON COLUMN public.backtest_run_details.bid_at_window IS
'Highest bat_bids.bid_amount of the auction at or before close_time minus time_window, numeric, nullable, filled on every row (2026-10-07). The input of the prediction; price_tier is derived from it. 53 of the 9,691 rows of a 1% block sample are under 2,000, the floor of the last writer version. No amount is quoted here. Unit: the amount of bat_bids.bid_amount (currency not recorded here). Source: bat_bids at run time. Grain: one run x auction x time window. Clock: as of close_time minus time_window.';
COMMENT ON COLUMN public.backtest_run_details.price_tier IS
'Price band of bid_at_window (getPriceTier of supabase/functions/_shared/predictionEngine.ts as deployed for the run), text, nullable, filled on every row, no CHECK. The bands changed with the model version; 10 codes occur (2026-10-07): 5k_10k 253,405, 15k_30k 252,946, 30k_60k 181,585, 10k_15k 150,377, under_5k 141,531, 60k_100k 66,351, 100k_200k 42,028, under_15k 32,260 (model versions 1, 3 and 4 only), over_200k 17,885, 2k_5k 823 (version 13 only). With time_window it names the coefficient cell of the prediction and of backtest_runs.tier_window_matrix. Unit: none (text code: price band). Source: the writer. Grain: one run x auction x time window. Clock: n/a.';

-- ── Prediction ─────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.backtest_run_details.predicted_hammer IS
'Hammer price the model predicted from the bid at the window, numeric, nullable. Filled on 1,105,486 rows (97.0%, 2026-10-07): on every full_backtest row; NULL on 33,705 suggest_coefficients rows (model versions 1, 7, 9 and 11) whose price-tier and window cell had no coefficient. Unit: the amount of actual_hammer. Source: predictAtWindow of the writer with the coefficients of the run. Grain: one run x auction x time window. Clock: as of close_time minus time_window.';
COMMENT ON COLUMN public.backtest_run_details.multiplier_used IS
'Multiplier the prediction engine returned for the cell of the bid, numeric, nullable. Filled with predicted_hammer (1,105,486 rows, 2026-10-07); 0.71 .. 2.86, median 1.36 in a 1% block sample. Unit: ratio. Source: predictAtWindow of the writer. Grain: one run x auction x time window. Clock: n/a.';
COMMENT ON COLUMN public.backtest_run_details.sniper_pct_used IS
'Last-minute (sniper) premium the prediction assumed, percent, rounded to 0.1, numeric, nullable. Filled with predicted_hammer (1,105,486 rows, 2026-10-07); 0 .. 10.7, and 0 on 9,013 of the 9,263 filled rows of a 1% block sample. Unit: percent. Source: estimateSniperPremiumPct of the prediction engine. Grain: one run x auction x time window. Clock: n/a.';

-- ── Error ──────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.backtest_run_details.error_pct IS
'Signed error of the prediction: (predicted_hammer - actual_hammer) / actual_hammer x 100, rounded to 0.1, numeric, nullable; positive means an overestimate. Filled with predicted_hammer (1,105,486 rows, 2026-10-07), -99.9 .. 1,762,000; all 329 rows above 1,000 have an actual_hammer under 1,000. Within 0.1 of the formula on every row of a 1% block sample (rounding); median -0.2 there. The writer capped errors at 500 only inside its run aggregates (backtest_runs.mape and bias_pct), not here. Unit: percent. Source: the writer. Grain: one run x auction x time window. Clock: n/a.';
COMMENT ON COLUMN public.backtest_run_details.abs_error_pct IS
'Absolute error of the prediction, |error_pct|, rounded to 0.1, numeric, nullable. Filled with predicted_hammer (1,105,486 rows, 2026-10-07), 0 .. 1,762,000; in a 1% block sample (all windows, versions and runs pooled) median 13.5, 90th percentile 40.7, above 500 on 3 rows. Pooled figures repeat the same auctions across runs and mix model versions; read them per run. Unit: percent. Source: the writer. Grain: one run x auction x time window. Clock: n/a.';
COMMENT ON COLUMN public.backtest_run_details.optimal_multiplier IS
'Multiplier that would have hit the hammer exactly: actual_hammer / (bid_at_window x (1 + sniper premium / 100)), rounded to 0.001, numeric, nullable. Filled on every row (2026-10-07), the suggest_coefficients rows without a prediction included; 0 .. 1,544, median 1.391 in a 1% block sample, where 9,521 of 9,691 rows are within 0.01 of the formula with sniper_pct_used. suggest_coefficients derived its suggested coefficient per cell as a median of it. Unit: ratio. Source: the writer. Grain: one run x auction x time window. Clock: n/a.';

-- ── Comparable sales (not point-in-time) ───────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.backtest_run_details.comp_median IS
'Median final_price of comparable BaT sales: public vehicles of the same make, a model text match and a year within 5, sold with final_price > 0 in the 12 months before the run, numeric, nullable. Written only by the full_backtest runs of model versions 13 and 23: filled on 266,426 rows (23.4%, 2026-10-07), NULL where comp_count is 0 and on every other row. Not point-in-time: the comparables were read at run time without excluding the auction under test or sales after its close, so the hammer being predicted can be among them (by the writer source). Added to the table outside the recorded migrations. Unit: the amount of vehicle_events.final_price. Source: the writer, from vehicles and vehicle_events at run time. Grain: one run x auction x time window (constant within a run and auction). Clock: as of the run, not of the auction.';
COMMENT ON COLUMN public.backtest_run_details.comp_count IS
'Number of comparable sales behind comp_median, integer, nullable. Written only by the full_backtest runs of model versions 13 and 23: filled on 280,985 rows (24.7%, 2026-10-07), 0 .. 106, 0 on 14,559, median 4 among the filled rows of a 1% block sample. Same comparable set and look-ahead as comp_median; added outside the recorded migrations. Unit: count of sales. Source: the writer. Grain: one run x auction x time window. Clock: as of the run, not of the auction.';

-- ── Clock ──────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.backtest_run_details.created_at IS
'When the row was inserted: default now(), the transaction clock of the insert (the writer does not send it), timestamptz NOT NULL. 2026-02-18 22:03Z .. 2026-02-19 19:49Z (2026-10-07): 40,681 rows on 2026-02-18 and 1,098,510 on 2026-02-19; within 43 s of backtest_runs.created_at of the run in a 1% block sample. Unit: timestamptz. Source: column default. Grain: one run x auction x time window. Clock: ingest time of the run, not of the auction.';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.backtest_run_details'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'backtest_run_details: every column has a comment';
  ELSE
    RAISE NOTICE 'backtest_run_details columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;

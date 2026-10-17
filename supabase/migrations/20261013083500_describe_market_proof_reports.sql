-- Describe market_proof_reports: the 31 columns with no COMMENT ON COLUMN (0 of 31 described before, catalog count on
-- prod, 2026-10-13) and the table. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself").
--
-- METHOD (read 2026-10-13 08:31-08:40 UTC):
--   Columns, types, defaults, constraints and existing comments from pg_attribute, pg_attrdef, pg_constraint and
--   pg_description; fill and value shape from pg_stats and whole-table counts (1,563 rows). Writers from git history
--   at origin/main bf8830617: the edge function market-proof, v1 added in 1e8a9911a (2026-02-19) and rewritten as v2 in
--   d3dddb12f (2026-02-19), deleted in 276a6e9cc (2026-03-29), called per pipeline row by batch-market-proof (also
--   deleted). The table was created by supabase/migrations/20260219220000_acquisition_pipeline.sql.
--   The only remaining code reader is supabase/functions/pipeline-dashboard (id, pipeline_id, comp_count, comp_median,
--   recommendation, created_at). No SQL function or view names the table, pipeline_registry has no row for it, it
--   has no trigger and no policy.
--   The two writer versions are told apart by segment_analysis: v2 rows carry the key condition_tier. v1: 578 rows,
--   2026-02-19 18:01-18:59 UTC. v2: 985 rows, 2026-02-19 19:06 UTC to 2026-02-27 05:09 UTC.
-- LIMITS:
--   No run log survives; rows are dated by created_at. Comparable sales came from the SQL function find_bat_comps
--   (BaT sold lots, year +/-2, model filter, limit 200) as it was in February 2026. The comp arrays are not
--   re-checked here against today's sale records. Quoted values are categorical codes: no names, ids or amounts.
-- DRIFT FOUND:
--   The creating migration declared vehicle_id REFERENCES vehicles(id); production has no such foreign key
--   (pg_constraint has only the primary key and the pipeline_id foreign key). Recorded here, not repaired.

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.market_proof_reports IS
'One comparable-sales report per run of the retired edge function market-proof on one acquisition_pipeline candidate (grain: one run on one pipeline row; 1,563 rows over 863 pipeline rows, 2026-10-13). Written 2026-02-19 to 2026-02-27 by two versions of the function: v1 (578 rows, 2026-02-19 18:01-18:59 UTC) and v2 (985 rows from 2026-02-19 19:06 UTC; v2 rows carry segment_analysis.condition_tier). The function was deleted on 2026-03-29, so nothing writes the table now; supabase/functions/pipeline-dashboard reads it. Comps are BaT sold lots returned by the SQL function find_bat_comps at run time. Values are derived estimates for a buy decision, not observations of the candidate. Clock: created_at (= insert time of the run); there is no event time for the candidate.';

-- ── Identity and keys ───────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.market_proof_reports.id IS
'Surrogate key of the report. Unit: none (uuid). Source: gen_random_uuid() default. No foreign key points at it. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.pipeline_id IS
'The acquisition_pipeline candidate the report is about, foreign key to acquisition_pipeline.id (ON DELETE CASCADE). Set by market-proof from its pipeline_id input. Not unique: 863 pipeline rows carry 1,563 reports, because a re-run inserted a new row rather than replacing the old one (2026-10-13). Unit: none. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.vehicle_id IS
'The candidate''s vehicles.id when the pipeline row had one (copied from acquisition_pipeline.vehicle_id; NULL otherwise). Filled on 99 of 1,563 rows, all from v2 (2026-10-13). The creating migration declared a foreign key to vehicles; production has none, so the reference is not enforced. Unit: none. Grain: one run. Clock: n/a.';

-- ── Comparable sales ────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.market_proof_reports.comp_vehicle_ids IS
'vehicles.id of each comparable sale used, from find_bat_comps rows after the function''s engine-tier and model-match filters. Same length as comp_prices on every row (2026-10-13) but not aligned with it: both versions sort the prices ascending and keep the ids in query order, so position i of one array does not pair with position i of the other. Not a foreign key; ids are not re-checked. Unit: none (uuid[]). Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.comp_count IS
'Number of comparable sales used: the length of the sorted price list. Equals the length of comp_prices on 1,560 of 1,563 rows; the 3 that differ are v1 rows (cause Unknown). 3 v2 rows have comp_count 0 (2026-10-13). find_bat_comps was called with a limit of 200, so 200 is a ceiling, not a market size. Unit: count. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.comp_prices IS
'Sale price of each comparable, sorted ascending, as returned by find_bat_comps (sale_price of the BaT lot). Unit: USD as recorded on the lot. Some arrays contain two-digit values that cannot be vehicle sale prices; they were kept as returned and are evidence of source errors, not prices. Grain: one run. Clock: the comps'' own sale dates are not stored here.';
COMMENT ON COLUMN public.market_proof_reports.comp_median IS
'Median of comp_prices, computed by the function. Unit: USD. Grain: one run. Clock: n/a (derived at created_at).';
COMMENT ON COLUMN public.market_proof_reports.comp_avg IS
'Mean of comp_prices, rounded to whole dollars. Unit: USD. Grain: one run. Clock: n/a (derived at created_at).';
COMMENT ON COLUMN public.market_proof_reports.comp_min IS
'Smallest value in comp_prices. Inherits the source errors noted on comp_prices. Unit: USD. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.comp_max IS
'Largest value in comp_prices. Unit: USD. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.segment_analysis IS
'How the comp set was chosen, as a JSON object. Both versions: target {year, make, model, engine} (copied from the pipeline row) and match_strategy. v1 adds model_keywords, year_range, raw_pool_size and filtered_pool_size. v2 adds base_model, condition_tier, cost_to_ready, target_sale_price, net_profit and roi_pct (its deal economics). Filled on every row (2026-10-13). Unit: mixed (USD for money keys, percent for roi_pct). Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.total_bids_analyzed IS
'Sum of bid_count over the comparable sales used (NULL counts as 0). Unit: count of bids. Grain: one run. Clock: n/a.';

-- ── Never written ───────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.market_proof_reports.avg_bid_velocity IS
'Never written: NULL on every row (pg_stats null_frac 1, 2026-10-13); neither version of market-proof sets it. Intended meaning (from the creating migration''s grouping under bid analysis): Unknown. Unit: Unknown. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.snipe_ratio_avg IS
'Never written: NULL on every row (pg_stats null_frac 1, 2026-10-13); neither version of market-proof sets it. Meaning and unit: Unknown. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.whale_bidder_count IS
'Never written: NULL on every row (pg_stats null_frac 1, 2026-10-13); neither version of market-proof sets it. Meaning: Unknown. Unit: count. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.total_comments_analyzed IS
'Never written: NULL on every row (pg_stats null_frac 1, 2026-10-13); neither version of market-proof reads auction comments. Unit: count. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.sentiment_distribution IS
'Never written: NULL on every row (pg_stats null_frac 1, 2026-10-13); neither version of market-proof sets it. Shape: Unknown. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.expert_comment_count IS
'Never written: NULL on every row (pg_stats null_frac 1, 2026-10-13); neither version of market-proof sets it. Unit: count. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.key_technical_concerns IS
'Never written: NULL on every row (pg_stats null_frac 1, 2026-10-13); neither version of market-proof sets it. Unit: none (text[]). Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.market_sentiment_keywords IS
'Never written: NULL on every row (pg_stats null_frac 1, 2026-10-13); neither version of market-proof sets it. Shape: Unknown. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.hagerty_value IS
'Never written: NULL on every row (pg_stats null_frac 1, 2026-10-13); neither version of market-proof fetches a Hagerty value. Unit: USD (by name). Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.verification_checklist IS
'Never written: NULL on every row (pg_stats null_frac 1, 2026-10-13); neither version of market-proof sets it. Unit: none (text[]). Grain: one run. Clock: n/a.';

-- ── Estimate and decision ───────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.market_proof_reports.estimated_value IS
'The function''s value estimate for the candidate. Meaning differs by version: v1 = comp_median (578 rows, all filled); v2 = target sale price from an inferred condition tier (between the 25th percentile and the median for project or driver tiers, the median for nice, midway from the median to the 75th percentile for excellent), NULL when there was no asking price to infer a tier from (731 of 985 v2 rows filled, 2026-10-13). A derived estimate, not an appraisal. Unit: USD. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.estimated_value_low IS
'Low end of the value range. Meaning differs by version: v1 = comp_min; v2 = 25th percentile of comp_prices. Unit: USD. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.estimated_value_high IS
'High end of the value range. Meaning differs by version: v1 = comp_max; v2 = 75th percentile of comp_prices. Unit: USD. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.asking_price IS
'The candidate''s asking price as the pipeline row held it at run time (acquisition_pipeline.asking_price; NULL when absent). Filled on 1,227 of 1,563 rows (2026-10-13). A copy, not the source: the listing that stated it is on the pipeline row. Unit: USD. Grain: one run. Clock: value at created_at.';
COMMENT ON COLUMN public.market_proof_reports.discount_to_market IS
'(comp_median - asking_price) / comp_median, as a percent rounded to two decimals; positive means asking below the comp median. NULL when there is no asking price or no median; filled exactly where asking_price is (2026-10-13). Unit: percent. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.recommendation IS
'The function''s buy call: STRONG_BUY, BUY, FAIR or PASS (all four occur in both versions, 2026-10-13). v1 scored the discount to the comp median; v2 scored net profit and ROI after its cost-to-ready model (segment_analysis). An agent''s heuristic output, not an observation. Unit: categorical code. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.market_proof_reports.risk_factors IS
'Free-text warnings the function attached (for example a missing asking price, a wide price spread, few comps). Non-empty on 1,556 of 1,563 rows (2026-10-13). Generated text, not seller or inspector testimony. Unit: none (text[]). Grain: one run. Clock: n/a.';

-- ── Clocks ──────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.market_proof_reports.report_generated_at IS
'When the function built the report: the v2 code sends new Date() from the function (differs from created_at on all 985 v2 rows). The v1 code in the repo does not set it, so it would fall to the now() default and equal created_at, yet 575 of 578 v1 rows differ; the deployed v1 evidently set it, and how is Unknown (2026-10-13). Unit: timestamptz. Grain: one run. Clock: compute time (function clock).';
COMMENT ON COLUMN public.market_proof_reports.created_at IS
'Insert time of the row: now() default, never passed by the writer. 2026-02-19 18:01 UTC to 2026-02-27 05:09 UTC (2026-10-13). Unit: timestamptz. Grain: one run. Clock: ingest time.';

COMMIT;

-- Describe market_trends: all 28 columns (0 of 28 had a COMMENT ON COLUMN before; catalog count on prod, 2026-10-07) and a
-- corrected table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Read-only table in the atlas: 8,046 rows on 2026-10-07 15:28Z by exact count (equal to
-- the atlas estimate), no write since the statistics counters began; the newest row was calculated 2026-02-22 06:00Z.
--
-- METHOD (read 2026-10-07 15:28-15:55Z UTC):
--   Columns, types, defaults, constraints (with convalidated), indexes, triggers, policies (with their role lists), RLS,
--   grants (has_table_privilege for anon and authenticated) and existing comments from pg_attribute, pg_attrdef,
--   pg_constraint, pg_indexes, pg_trigger, pg_policy, pg_class and pg_description; views and foreign keys in from pg_depend
--   and pg_constraint (none). The row count, the counts by run (calculated_at), day, make, platform and period_start, the
--   fills and ranges of every column, the per-run shapes used to attribute rows to writers, the rows per make and month,
--   the case variants of make and the jsonb array shapes are exact counts over the whole table (1.6 MB heap, read only).
--   What anon and authenticated can read comes from counts under SET LOCAL ROLE in read-only transactions. "Filled" means
--   non-NULL.
--   Writers and readers from code at origin/main e23754de1 (supabase/functions, supabase/migrations, scripts,
--   nuke_frontend/src, mcp-server, apps; git history for the deleted writer): the creating migration
--   supabase/migrations/20260124_market_trends.sql (not in supabase_migrations.schema_migrations on prod);
--   20260206_analytics_cron_jobs.sql (the cron jobs analytics-market-trends and analytics-sentiment-trends);
--   20261006073000_table_purpose_live_tables.sql (the former table comment); prod migration 20260314031423
--   rls_frontend_tables_read_only (the policy and the revoked writes; read from schema_migrations, not in the repo); the
--   writer supabase/functions/calculate-market-trends in three versions, read at 1d5e56cd9 (2026-01-25), 0ac0ecd5f
--   (2026-02-07) and origin/main (869b9863b, 2026-02-14, which calls compute_market_trend_aggregates; write guard added by
--   accef6be3, 2026-09-27); the deleted writer supabase/functions/aggregate-sentiment (mode market_trends; deleted by
--   9871ee4fb, 2026-04-01; read at 9871ee4fb^); scripts/run-orchestrator.sh (its caller) and scripts/check-progress.sh; the
--   bodies, read with pg_get_functiondef, of the 3 live functions whose body names the table (get_make_market_stats,
--   get_model_market_stats, get_platform_vehicle_stats) and of compute_market_trend_aggregates, with their EXECUTE grants;
--   cron.job (no job names either writer) and cron.job_run_details (kept since 2026-04-14; no run of either); write_receipts
--   (no rows); pg_stat_user_tables; pipeline_registry (no row; none is added here); the deployed function list read through
--   the management API (328 functions, 2026-10-07). Reader code: nuke_frontend/src/hooks/usePlatformPerformance.ts (used by
--   components/vehicles/micro-portals/SourcePortal.tsx), and through the two market stats functions
--   nuke_frontend/src/hooks/useMarketStats.ts and pages/vehicle-profile/hooks/useVehicleHeaderData.ts.
-- LIMITS:
--   No row records its writer. The split by writer is inferred from the columns each code version fills: period_start is
--   NULL only in the first version; median_sale_price and the theme arrays come only from calculate-market-trends before
--   869b9863b; the percent shares are NULL only in the current version; sentiment_samples equals vehicle_count in every
--   aggregate-sentiment run. When the cron jobs of 20260206_analytics_cron_jobs.sql were removed is not recorded.
--   pg_stat_user_tables counters began at the last server start (2026-09-29 09:20Z). The table holds make-level
--   aggregates, no personal data: quoted values are make names, platform and period codes, column and function names and
--   counts only; no theme text, no price, no vehicle id.
-- CHANGED EXISTING COMMENTS:
--   Table: it said "Aggregated market sentiment and demand by make, model, year range and platform (grain: segment x
--   platform x run). Writer: calculate-market-trends. No row writes since the statistics reset." Corrected: model, the year
--   range and period_end are never filled and platform is all on every row, so the grain is make x run; 5,240 of the 8,046
--   rows (65.1%) came from the deleted aggregate-sentiment, not from calculate-market-trends; the unique key never
--   deduplicates. Added: the writer versions, the liveness, the readers, the access and the clocks. There were no column
--   comments.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.market_trends IS
'Make-level aggregates of AI-analyzed auction comments (sentiment, demand, price-trend and rarity shares, sale-price statistics, top themes): meant as one row per make, model, year range and platform per period (UNIQUE make, model, platform, period_start), in practice one row per make per writer run (grain: make x run), because model, year_start, year_end and period_end are never filled and platform is all on every row. 8,046 rows on 2026-10-07 (equal to the atlas estimate) from 59 runs calculated 2026-01-25 02:07Z .. 2026-02-22 06:00Z, over 932 make strings (730 ignoring case). The UNIQUE key never deduplicates: model is NULL and NULLs never collide, so every upsert inserts; 760 of the 809 makes of the month 2026-02-01 hold more than one row (up to 43, median 4). Writers, attributed by the columns each code version fills: (1) the edge function calculate-market-trends wrote 2,806 rows: 124 from its first version in one run on 2026-01-25 (period_start NULL, at most 2,000 comment_discoveries rows), 556 from its second version in 5 runs 2026-02-06 .. 02-10 (shares from comment_discoveries.raw_extraction.market_signals, median and themes), and 2,126 from the current version (commit 869b9863b) in 18 runs on 2026-02-14 and 2026-02-22 06:00Z, which aggregates comment_discoveries through compute_market_trend_aggregates and writes NULL for the shares, the median and the themes; (2) the edge function aggregate-sentiment (mode market_trends; deleted by commit 9871ee4fb on 2026-04-01, not deployed now) wrote 5,240 rows (65.1%) in 35 runs 2026-02-06 15:51Z .. 2026-02-08 08:00Z from vehicle_sentiment; by their timing, the runs about 15 minutes apart match scripts/run-orchestrator.sh (every third 5-minute cycle) and the run of 2026-02-08 08:00Z the cron job analytics-sentiment-trends. Liveness: no row since 2026-02-22 06:00Z. The cron jobs analytics-market-trends (calculate-market-trends, Sundays 06:00) and analytics-sentiment-trends (Sundays 08:00) of 20260206_analytics_cron_jobs.sql are gone from cron.job, and cron.job_run_details (kept since 2026-04-14) holds no run of either. pg_stat_user_tables counts 0 inserts, updates and deletes, 1 sequential and 0 index scans since the server last started (2026-09-29 09:20Z; read 15:28Z). calculate-market-trends is still deployed (version 97, 2026-09-27 15:56Z): its write guard admits the service key or any signed-in account, by POST or by GET (a GET runs the all-makes default), and a full run appends a row per make (703 on 2026-02-22). Readers: get_make_market_stats(text) (SECURITY INVOKER) adds sentiment_score and demand_high_pct from the newest row of the make by calculated_at, make matched ignoring case; it is called by nuke_frontend/src/hooks/useMarketStats.ts and the vehicle header (useVehicleHeaderData.ts), and returns nothing from this table to a logged-out visitor, whom RLS gives no row. get_model_market_stats(text,text) (SECURITY DEFINER, EXECUTE granted to anon) matches on model and so never finds a row. get_platform_vehicle_stats(uuid,text) (no caller in the repo) and nuke_frontend/src/hooks/usePlatformPerformance.ts (the source micro-portal) match platform against a source name and so find no row unless the name is part of the text all; both present demand_high_pct as a platform sell-through percent, which it is not. scripts/check-progress.sh reads it directly. get_market_trends and the edge function api-v1-market-trends do not read this table despite the name. Access: RLS is on with one policy, allow_authenticated_read_market_trends (SELECT, authenticated, USING true; prod migration 20260314031423 rls_frontend_tables_read_only, which also revoked INSERT, UPDATE, DELETE and TRUNCATE from anon and authenticated). anon holds SELECT and reads 0 rows; authenticated reads all 8,046 (counted under SET LOCAL ROLE, 2026-10-07); neither can write. No triggers, no foreign keys, no write receipts, no pipeline_registry row. The creating migration supabase/migrations/20260124_market_trends.sql is not in prod migration history; its indexes on make, demand_high_pct, avg_sentiment_score and calculated_at, its views hot_makes and rising_models and its table market_themes do not exist on prod. Clocks: calculated_at is the writer clock of the run; period_start is the first day of the UTC month of the run (2026-02-01 on every filled row); period_end is never set.';

-- ── Identity and segment ───────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.market_trends.id IS
'Surrogate key of the aggregate row, uuid NOT NULL, gen_random_uuid() default, the PRIMARY KEY. 8,046 values (2026-10-07). No foreign key points at it. Unit: none (uuid). Source: column default. Grain: one make x run. Clock: n/a.';
COMMENT ON COLUMN public.market_trends.make IS
'Make the row aggregates, text NOT NULL, the first column of the UNIQUE key (make, model, platform, period_start); no index of its own (the creating migration declared idx_market_trends_make; prod lacks it). The first writer version used vehicles.make lower-cased; the later versions and aggregate-sentiment group by COALESCE(canonical_makes.canonical_name, vehicles.make), so canonical makes are upper case (PORSCHE, CHEVROLET and FORD lead the run of 2026-02-22 by vehicle_count) and vehicles without a canonical make keep their raw spelling. 932 distinct strings on 8,046 rows, 730 ignoring case; 157 makes occur in 2 or more spellings (359 strings) (2026-10-07). get_make_market_stats and get_model_market_stats match it ignoring case. Unit: none (text). Source: the writer (canonical_makes or vehicles.make). Grain: one make x run. Clock: n/a.';
COMMENT ON COLUMN public.market_trends.model IS
'Model the row aggregates; NULL was meant as a make-level aggregate (creating migration), text, nullable, the second column of the UNIQUE key. NULL on all 8,046 rows (2026-10-07): every writer version writes NULL, so the table holds make-level rows only. Because NULLs never collide in the UNIQUE key, the upserts of the writers (on conflict make, model, platform, period_start) never match an existing row and every run inserts new rows. get_model_market_stats matches lower(model) to its argument and so never finds a row; get_make_market_stats, get_platform_vehicle_stats and usePlatformPerformance.ts filter model IS NULL. Unit: none (text). Source: the writers (always NULL). Grain: one make x run. Clock: n/a.';
COMMENT ON COLUMN public.market_trends.year_start IS
'Intended first model year of the segment (creating migration: grouping), integer, nullable. NULL on all 8,046 rows (2026-10-07); no writer version sets it. Unit: model year. Source: none (never written). Grain: one make x run. Clock: n/a.';
COMMENT ON COLUMN public.market_trends.year_end IS
'Intended last model year of the segment (creating migration: grouping), integer, nullable. NULL on all 8,046 rows (2026-10-07); no writer version sets it. Unit: model year. Source: none (never written). Grain: one make x run. Clock: n/a.';
COMMENT ON COLUMN public.market_trends.platform IS
'Platform the aggregate covers (creating migration: bringatrailer, carsandbids or all), text NOT NULL, default all, no CHECK, the third column of the UNIQUE key, indexed (idx_market_trends_platform). all on every row (2026-10-07): calculate-market-trends writes the platform of its request body, default all; aggregate-sentiment wrote all. The rows are not split by platform. get_platform_vehicle_stats (LIKE) and usePlatformPerformance.ts (ilike) match it against a source name and so find no row unless that name is part of the text all. Unit: none (text code). Source: the writer (request body or constant). Grain: one make x run. Clock: n/a.';

-- ── Counts ─────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.market_trends.vehicle_count IS
'Meant as the number of vehicles of the make, integer NOT NULL, default 0. Every writer version stores the number of analyzed vehicles instead, equal to analysis_count on all 8,046 rows (2026-10-07): comment_discoveries rows of non-deleted vehicles of the make (calculate-market-trends; the first version over at most 2,000 rows, the second over rows with a raw_extraction) or vehicle_sentiment rows with a sentiment score (aggregate-sentiment); both tables hold one row per vehicle (UNIQUE vehicle_id). Vehicles without an analysis are not counted. 1 .. 13,207, median 4; the current version and aggregate-sentiment keep makes with 2 or more (HAVING count >= 2), the earlier versions also kept makes with 1. get_platform_vehicle_stats returns it as platform_vehicle_count. Unit: count of vehicles. Source: the writer. Grain: one make x run. Clock: as of calculated_at.';
COMMENT ON COLUMN public.market_trends.analysis_count IS
'Number of analyzed vehicles behind the row (creating migration: vehicles with AI analysis), integer NOT NULL, default 0; equal to vehicle_count on all 8,046 rows (2026-10-07), see there. The views of the creating migration that filtered on it (hot_makes, rising_models) do not exist on prod; calculate-market-trends returns it in its response. Unit: count of vehicles. Source: the writer. Grain: one make x run. Clock: as of calculated_at.';

-- ── Demand, price-trend and rarity shares ──────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.market_trends.demand_high_pct IS
'Share of the analyzed vehicles of the make whose demand signal is high, percent 0 to 100, numeric(5,2), nullable, no index (the creating migration declared idx_market_trends_demand; prod lacks it). Filled on 5,920 rows (73.6%, 2026-10-07): the first two versions of calculate-market-trends counted comment_discoveries.raw_extraction.market_signals.demand, aggregate-sentiment counted vehicle_sentiment.market_demand; NULL on the 2,126 rows of the current version (2026-02-14 and 2026-02-22), which skips the shares, so for the 703 makes of the last run the newest row has none. The denominator is every analyzed vehicle, signal or not, and other labels (medium, free text) are not counted, so high, moderate and low sum to 0 .. 100.01. get_make_market_stats returns it as demand_high_pct; get_platform_vehicle_stats and usePlatformPerformance.ts present it as platform_sell_through_pct, which it is not (both find no row, see platform). Unit: percent (0 to 100). Source: the writer, from AI comment extraction. Grain: one make x run. Clock: as of calculated_at.';
COMMENT ON COLUMN public.market_trends.demand_moderate_pct IS
'Share of the analyzed vehicles of the make whose demand signal is moderate, percent 0 to 100, numeric(5,2), nullable. Same writers, fill (5,920 rows, 73.6%, 2026-10-07; NULL on the 2,126 current-version rows) and denominator as demand_high_pct. No reader. Unit: percent (0 to 100). Source: the writer, from AI comment extraction. Grain: one make x run. Clock: as of calculated_at.';
COMMENT ON COLUMN public.market_trends.demand_low_pct IS
'Share of the analyzed vehicles of the make whose demand signal is low, percent 0 to 100, numeric(5,2), nullable. Same writers, fill (5,920 rows, 73.6%, 2026-10-07; NULL on the 2,126 current-version rows) and denominator as demand_high_pct. No reader. Unit: percent (0 to 100). Source: the writer, from AI comment extraction. Grain: one make x run. Clock: as of calculated_at.';
COMMENT ON COLUMN public.market_trends.price_rising_pct IS
'Share of the analyzed vehicles of the make whose price-trend signal is rising, percent 0 to 100, numeric(5,2), nullable. Filled on 5,920 rows (73.6%, 2026-10-07): market_signals.price_trend of comment_discoveries.raw_extraction (calculate-market-trends, first two versions) or vehicle_sentiment.price_trend (aggregate-sentiment); NULL on the 2,126 current-version rows. Other labels (unknown, increasing, free text) are not counted, so rising, stable and declining sum to 0 .. 100. get_model_market_stats would derive trend_direction from it (up above 50) but never finds a row; get_make_market_stats reads it and does not return it. Unit: percent (0 to 100). Source: the writer, from AI comment extraction. Grain: one make x run. Clock: as of calculated_at.';
COMMENT ON COLUMN public.market_trends.price_stable_pct IS
'Share of the analyzed vehicles of the make whose price-trend signal is stable, percent 0 to 100, numeric(5,2), nullable. Same writers, fill (5,920 rows, 73.6%, 2026-10-07; NULL on the 2,126 current-version rows) and denominator as price_rising_pct. No reader. Unit: percent (0 to 100). Source: the writer, from AI comment extraction. Grain: one make x run. Clock: as of calculated_at.';
COMMENT ON COLUMN public.market_trends.price_declining_pct IS
'Share of the analyzed vehicles of the make whose price-trend signal is declining, percent 0 to 100, numeric(5,2), nullable. Same writers, fill (5,920 rows, 73.6%, 2026-10-07; NULL on the 2,126 current-version rows) and denominator as price_rising_pct. get_model_market_stats would derive trend_direction down above 50 but never finds a row. Unit: percent (0 to 100). Source: the writer, from AI comment extraction. Grain: one make x run. Clock: as of calculated_at.';
COMMENT ON COLUMN public.market_trends.rarity_rare_pct IS
'Share of the analyzed vehicles of the make whose rarity signal is rare, percent 0 to 100, numeric(5,2), nullable. Filled on 5,920 rows (73.6%, 2026-10-07): market_signals.rarity of comment_discoveries.raw_extraction (calculate-market-trends, first two versions) or vehicle_sentiment.market_rarity (aggregate-sentiment); NULL on the 2,126 current-version rows. Other labels (uncommon, free text) are not counted, so rare, moderate and common sum to 0 .. 100. No reader. Unit: percent (0 to 100). Source: the writer, from AI comment extraction. Grain: one make x run. Clock: as of calculated_at.';
COMMENT ON COLUMN public.market_trends.rarity_moderate_pct IS
'Share of the analyzed vehicles of the make whose rarity signal is moderate, percent 0 to 100, numeric(5,2), nullable. Same writers, fill (5,920 rows, 73.6%, 2026-10-07; NULL on the 2,126 current-version rows) and denominator as rarity_rare_pct. No reader. Unit: percent (0 to 100). Source: the writer, from AI comment extraction. Grain: one make x run. Clock: as of calculated_at.';
COMMENT ON COLUMN public.market_trends.rarity_common_pct IS
'Share of the analyzed vehicles of the make whose rarity signal is common, percent 0 to 100, numeric(5,2), nullable. Same writers, fill (5,920 rows, 73.6%, 2026-10-07; NULL on the 2,126 current-version rows) and denominator as rarity_rare_pct. No reader. Unit: percent (0 to 100). Source: the writer, from AI comment extraction. Grain: one make x run. Clock: as of calculated_at.';

-- ── Sentiment ──────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.market_trends.avg_sentiment_score IS
'Mean comment sentiment of the analyzed vehicles of the make, on the -1 to 1 scale of the source scores, numeric(4,2), nullable, no index (the creating migration declared idx_market_trends_sentiment; prod lacks it). Source by writer version: raw_extraction.sentiment.score (first), comment_discoveries.sentiment_score with that as fallback (second), comment_discoveries.sentiment_score through compute_market_trend_aggregates (current), vehicle_sentiment.sentiment_score (aggregate-sentiment). Filled on 8,031 rows (99.8%, 2026-10-07), -0.22 .. 1.00, median 0.79; NULL on the 15 rows whose sentiment_samples is 0. get_make_market_stats returns it as sentiment_score when it is set. Unit: score (-1 to 1). Source: the writer, from AI comment extraction. Grain: one make x run. Clock: as of calculated_at.';
COMMENT ON COLUMN public.market_trends.sentiment_samples IS
'Number of analyzed vehicles with a sentiment score behind avg_sentiment_score, integer, nullable. Filled on every row, 0 .. 13,203; 0 on 15 rows (2026-10-07). Equal to vehicle_count in every aggregate-sentiment run, which counted only scored rows. Unit: count of vehicles. Source: the writer. Grain: one make x run. Clock: as of calculated_at.';

-- ── Sale-price statistics ──────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.market_trends.avg_sale_price IS
'Mean vehicles.sale_price over the analyzed vehicles of the make with a positive price (the first version took any non-zero price), numeric(12,2), nullable. No outlier or currency filter: it averages every stored price of those vehicles at the time of the run. Filled on 7,926 rows (98.5%, 2026-10-07); min_sale_price <= avg_sale_price <= max_sale_price on all of them. get_platform_vehicle_stats returns it as platform_avg_price and usePlatformPerformance.ts shows it (both find no row, see platform). Unit: the amount of vehicles.sale_price (currency not recorded). Source: the writer, from vehicles.sale_price. Grain: one make x run. Clock: as of calculated_at.';
COMMENT ON COLUMN public.market_trends.min_sale_price IS
'Lowest positive vehicles.sale_price among the analyzed vehicles of the make, numeric(12,2), nullable. Filled on 7,926 rows (98.5%, 2026-10-07), with avg_sale_price. No outlier filter. No reader. Unit: the amount of vehicles.sale_price (currency not recorded). Source: the writer, from vehicles.sale_price. Grain: one make x run. Clock: as of calculated_at.';
COMMENT ON COLUMN public.market_trends.max_sale_price IS
'Highest vehicles.sale_price among the analyzed vehicles of the make, numeric(12,2), nullable. Filled on 7,926 rows (98.5%, 2026-10-07), with avg_sale_price. No outlier filter. No reader. Unit: the amount of vehicles.sale_price (currency not recorded). Source: the writer, from vehicles.sale_price. Grain: one make x run. Clock: as of calculated_at.';
COMMENT ON COLUMN public.market_trends.median_sale_price IS
'Median sale price of the analyzed vehicles of the make: the element at position floor(n/2) of the sorted prices (the upper median when n is even), numeric(12,2), nullable. Written only by the first two versions of calculate-market-trends: filled on 647 rows (8.0%, 2026-10-07; 115 of 2026-01-25, 531 of 2026-02-06, 1 of 2026-02-10), within min .. max on all of them. aggregate-sentiment never wrote it and the current version writes NULL (its code: percentile_cont too expensive). No reader. Unit: the amount of vehicles.sale_price (currency not recorded). Source: the writer, from vehicles.sale_price. Grain: one make x run. Clock: as of calculated_at.';

-- ── Themes ─────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.market_trends.top_discussion_themes IS
'The 5 most frequent discussion themes among the analyzed vehicles of the make (comment_discoveries.raw_extraction.discussion_themes, counted by exact string), jsonb array, nullable. Written only by the first two versions of calculate-market-trends: filled on 665 rows (8.3%, 2026-10-07), 3 to 5 elements, 2,925 in all. The elements are free sentences written by the AI extraction about single listings, not codes, so near-identical sentences do not merge; none is quoted here. NULL on every aggregate-sentiment and current-version row. No reader. Unit: none (jsonb array of text). Source: the writer, from AI comment extraction. Grain: one make x run. Clock: as of calculated_at.';
COMMENT ON COLUMN public.market_trends.top_community_concerns IS
'The 5 most frequent community concerns among the analyzed vehicles of the make (comment_discoveries.raw_extraction.community_concerns, counted by exact string), jsonb array, nullable. Written only by the first two versions of calculate-market-trends: filled on 665 rows (8.3%, 2026-10-07), 3 to 5 elements, 2,522 in all; 30 elements are the literal text [object Object], an extracted object that the writer turned into a string, not a concern. The others are free sentences about single listings, not codes; none is quoted here. NULL on every aggregate-sentiment and current-version row. No reader. Unit: none (jsonb array of text). Source: the writer, from AI comment extraction. Grain: one make x run. Clock: as of calculated_at.';

-- ── Clocks ─────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.market_trends.period_start IS
'Start of the period the row belongs to: the first day of the UTC month of the run (new Date(year, month, 1) on the UTC clock of the edge function), timestamptz, nullable, the fourth column of the UNIQUE key. 2026-02-01 00:00Z on 7,922 rows; NULL on the 124 rows of the first version (2026-01-25), which did not set it (2026-10-07). Meant to make each run replace the rows of its month (code comment: for proper upsert deduplication), which fails because model is NULL: the month holds 7,922 rows for 809 makes from 58 runs. calculate-market-trends filters on it for its response. Unit: timestamptz (month start). Source: the writer clock. Grain: one make x run. Clock: derived (month of the run).';
COMMENT ON COLUMN public.market_trends.period_end IS
'Intended end of the period, timestamptz, nullable. NULL on all 8,046 rows (2026-10-07); no writer version sets it. get_platform_vehicle_stats and usePlatformPerformance.ts order by it to take the newest row, so their pick would be arbitrary. Unit: timestamptz. Source: none (never written). Grain: one make x run. Clock: n/a.';
COMMENT ON COLUMN public.market_trends.calculated_at IS
'When the run computed the row: the clock of the writing edge function (new Date(), sent with the row; the default now() is not used), timestamptz, nullable, default now(), no index (the creating migration declared idx_market_trends_calculated; prod lacks it). Filled on every row, 2026-01-25 02:07Z .. 2026-02-22 06:00Z (2026-10-07); by day 2026-01-25 124, 02-06 2,297, 02-07 2,769, 02-08 729, 02-10 1, 02-14 1,423, 02-22 703. 62 distinct values from 59 runs: the first version stamped each row (4 values within 3 ms of one run); every later run used one value, so it identifies the run. get_make_market_stats and get_model_market_stats take the newest row of the make by it. Unit: timestamptz. Source: the writer clock. Grain: one make x run. Clock: derived (when computed).';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.market_trends'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'market_trends: every column has a comment';
  ELSE
    RAISE NOTICE 'market_trends columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;

-- Isolated PostgreSQL 17 contract for 20261013160000_v_graded_lot_vision_backlog.sql (the graded lots' vision backlog as
-- a view). Synthetic rows only; never production. Run from the repo root in an empty disposable dm_graded_lot_vision_*
-- database:
--   createdb dm_graded_lot_vision_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_graded_lot_vision_ci -f supabase/sql/test_graded_lot_vision_backlog.sql
-- Fixtures: v_prediction_lot_grades is a plain table with the live view's column names and types (read from its creating
-- migration 20261007170000 on 2026-10-13); vehicle_images keeps only the columns the migration reads. Supabase default
-- privileges are reproduced so the REVOKE is exercised.
-- Covered: the migration applies and applies again; the column list, order and types; every comment; one row per lot
-- with the newest model winning; horizon and hammer scope; the photo filters (video, superseded, duplicate, NULL flags);
-- the cost arithmetic and its constants; a lot with no photos; no ORDER BY or LIMIT; the ACL (service_role only) and real
-- reads as service_role, anon and authenticated.
-- Not covered: the real grade view and image table; the measured cost of the live query.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_graded_lot_vision_%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.v_prediction_lot_grades') IS NOT NULL
     OR to_regclass('public.vehicle_images') IS NOT NULL
     OR to_regclass('public.v_graded_lot_vision_backlog') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_graded_lot_vision_* PostgreSQL 17 database';
  END IF;
END $$;
SET statement_timeout = '30s';
SET lock_timeout = '3s';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

-- Supabase's default privileges: every object postgres creates in public starts with all table privileges for the three
-- API roles. The migration's REVOKE has to undo this.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

-- The grade view's stub, with the live view's columns and types.
CREATE TABLE public.v_prediction_lot_grades (
  model_version integer,
  lot text,
  auction_event_id uuid,
  horizon text,
  prediction_id uuid DEFAULT gen_random_uuid(),
  vehicle_id uuid,
  predicted_at timestamptz,
  hours_before_close numeric,
  close_at timestamptz,
  close_basis text,
  outcome text,
  predicted_low numeric,
  predicted_hammer numeric,
  predicted_high numeric,
  actual_hammer numeric,
  error_pct numeric,
  abs_error_pct numeric,
  band_held boolean
);

-- The image table's stub: only what the migration reads.
CREATE TABLE public.vehicle_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid,
  vision_analyzed_at timestamptz,
  is_video boolean,
  is_superseded boolean,
  is_duplicate boolean
);

\ir ../migrations/20261013160000_v_graded_lot_vision_backlog.sql

-- Columns, order and types.
SELECT pg_temp.ok('columns in the documented order with the documented types',
  (SELECT string_agg(column_name || ':' || data_type, ',' ORDER BY ordinal_position)
   FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'v_graded_lot_vision_backlog')
  = 'lot:text,vehicle_id:uuid,auction_event_id:uuid,model_version:integer,prediction_id:uuid,predicted_at:timestamp with time zone,'
    'close_at:timestamp with time zone,outcome:text,predicted_hammer:numeric,actual_hammer:numeric,error_pct:numeric,'
    'abs_error_pct:numeric,band_held:boolean,photos:integer,photos_vision_analyzed:integer,photos_to_analyze:integer,'
    'est_input_tokens:bigint,est_cost_usd:numeric,est_cost_batch_usd:numeric');

SELECT pg_temp.ok('the view and every column carry a comment',
  obj_description('public.v_graded_lot_vision_backlog'::regclass, 'pg_class') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM pg_attribute a
    WHERE a.attrelid = 'public.v_graded_lot_vision_backlog'::regclass AND a.attnum > 0 AND NOT a.attisdropped
      AND col_description(a.attrelid, a.attnum) IS NULL));

SELECT pg_temp.ok('the view comment names the constants and their sources',
  obj_description('public.v_graded_lot_vision_backlog'::regclass, 'pg_class') LIKE '%1,568 input tokens%'
  AND obj_description('public.v_graded_lot_vision_backlog'::regclass, 'pg_class') LIKE '%150 output tokens%'
  AND obj_description('public.v_graded_lot_vision_backlog'::regclass, 'pg_class') LIKE '%$0.002318%'
  AND obj_description('public.v_graded_lot_vision_backlog'::regclass, 'pg_class') LIKE '%$0.001159%'
  AND obj_description('public.v_graded_lot_vision_backlog'::regclass, 'pg_class') LIKE '%platform.claude.com%'
  AND obj_description('public.v_graded_lot_vision_backlog'::regclass, 'pg_class') LIKE '%claude.com/pricing%');

SELECT pg_temp.ok('no ORDER BY and no LIMIT in the view (readers order and limit)',
  pg_get_viewdef('public.v_graded_lot_vision_backlog'::regclass) NOT ILIKE '%limit %'
  AND (SELECT count(*) FROM regexp_matches(pg_get_viewdef('public.v_graded_lot_vision_backlog'::regclass), 'ORDER BY', 'g')) = 1);
-- (the one ORDER BY is the DISTINCT ON tie-break inside the grade CTE)

-- Grain and scope. Lot A: graded by models 13 and 31 at 'last', plus a 24h grade and an unsold prediction that must not
-- count. Lot B: one grade, no photos. Lot C: a grade with no hammer only, so it is out.
CREATE TEMP TABLE ids AS SELECT gen_random_uuid() AS va, gen_random_uuid() AS vb, gen_random_uuid() AS vc,
                                 gen_random_uuid() AS ea, gen_random_uuid() AS eb, gen_random_uuid() AS ec;
INSERT INTO public.v_prediction_lot_grades
  (model_version, lot, auction_event_id, horizon, vehicle_id, predicted_at, close_at, outcome,
   predicted_hammer, actual_hammer, error_pct, abs_error_pct, band_held)
SELECT 13, 'lot-a', ea, 'last', va, '2026-10-01 10:00Z'::timestamptz, '2026-10-02 18:00Z'::timestamptz, 'sold', 20000::numeric, 10000::numeric, 100.00, 100.00, false FROM ids
UNION ALL
SELECT 31, 'lot-a', ea, 'last', va, '2026-10-02 17:00Z'::timestamptz, '2026-10-02 18:00Z'::timestamptz, 'sold', 15000::numeric, 10000::numeric, 50.00, 50.00, true FROM ids
UNION ALL
SELECT 31, 'lot-a', ea, '24h', va, '2026-10-01 17:00Z'::timestamptz, '2026-10-02 18:00Z'::timestamptz, 'sold', 30000::numeric, 10000::numeric, 200.00, 200.00, false FROM ids
UNION ALL
SELECT 31, 'lot-b', eb, 'last', vb, '2026-10-03 17:00Z'::timestamptz, '2026-10-03 18:00Z'::timestamptz, 'sold', 9000::numeric, 12000::numeric, -25.00, 25.00, true FROM ids
UNION ALL
SELECT 31, 'lot-c', ec, 'last', vc, '2026-10-04 17:00Z'::timestamptz, '2026-10-04 18:00Z'::timestamptz, 'reserve_not_met', 9000::numeric, NULL::numeric, NULL::numeric, NULL::numeric, NULL::boolean FROM ids;

-- Lot A's photos: 2 plain (1 analyzed), 1 with NULL flags (counts), 1 video, 1 superseded, 1 duplicate (the last three
-- do not count even when analyzed). Lot C has a photo but no row in the view.
INSERT INTO public.vehicle_images (vehicle_id, vision_analyzed_at, is_video, is_superseded, is_duplicate)
SELECT va, NULL::timestamptz, false, false, false FROM ids
UNION ALL SELECT va, '2026-10-05 00:00Z'::timestamptz, false, false, false FROM ids
UNION ALL SELECT va, NULL::timestamptz, NULL::boolean, NULL::boolean, NULL::boolean FROM ids
UNION ALL SELECT va, '2026-10-05 00:00Z'::timestamptz, true, false, false FROM ids
UNION ALL SELECT va, '2026-10-05 00:00Z'::timestamptz, false, true, false FROM ids
UNION ALL SELECT va, '2026-10-05 00:00Z'::timestamptz, false, false, true FROM ids
UNION ALL SELECT vc, NULL::timestamptz, false, false, false FROM ids;

SELECT pg_temp.ok('one row per lot: lot-a once, lot-b once, lot-c (no hammer) absent',
  (SELECT count(*) FROM public.v_graded_lot_vision_backlog) = 2
  AND (SELECT count(*) FROM public.v_graded_lot_vision_backlog WHERE lot = 'lot-a') = 1
  AND NOT EXISTS (SELECT 1 FROM public.v_graded_lot_vision_backlog WHERE lot = 'lot-c'));

SELECT pg_temp.ok('the newest model''s last-horizon grade wins (31 over 13; the 24h grade ignored)',
  (SELECT (model_version, abs_error_pct, band_held, predicted_hammer) = (31, 50.00, true, 15000)
   FROM public.v_graded_lot_vision_backlog WHERE lot = 'lot-a'));

SELECT pg_temp.ok('photos exclude video, superseded and duplicate rows and count NULL flags as photos',
  (SELECT (photos, photos_vision_analyzed, photos_to_analyze) = (3, 1, 2)
   FROM public.v_graded_lot_vision_backlog WHERE lot = 'lot-a'));

SELECT pg_temp.ok('cost arithmetic: 2 photos to analyze = 3,136 input tokens, $0.004636 at list, $0.002318 through Batch',
  (SELECT (est_input_tokens, est_cost_usd, est_cost_batch_usd) = (3136, 0.004636, 0.002318)
   FROM public.v_graded_lot_vision_backlog WHERE lot = 'lot-a'));

SELECT pg_temp.ok('a lot with no photos stays in the view with zeros, not NULLs',
  (SELECT (photos, photos_vision_analyzed, photos_to_analyze, est_input_tokens, est_cost_usd, est_cost_batch_usd)
          = (0, 0, 0, 0, 0, 0)
   FROM public.v_graded_lot_vision_backlog WHERE lot = 'lot-b'));

SELECT pg_temp.ok('grade columns pass through unchanged for lot-b',
  (SELECT (vehicle_id, auction_event_id, outcome, actual_hammer, error_pct)
          = ((SELECT vb FROM ids), (SELECT eb FROM ids), 'sold', 12000, -25.00)
   FROM public.v_graded_lot_vision_backlog WHERE lot = 'lot-b'));

-- A newer model grading lot-b later replaces its row (the row changes, the lot count does not).
INSERT INTO public.v_prediction_lot_grades
  (model_version, lot, auction_event_id, horizon, vehicle_id, predicted_at, close_at, outcome,
   predicted_hammer, actual_hammer, error_pct, abs_error_pct, band_held)
SELECT 32, 'lot-b', eb, 'last', vb, '2026-10-03 17:30Z'::timestamptz, '2026-10-03 18:00Z'::timestamptz, 'sold', 11000::numeric, 12000::numeric, -8.33, 8.33, true FROM ids;
SELECT pg_temp.ok('a newer model''s grade replaces the lot''s row',
  (SELECT count(*) FROM public.v_graded_lot_vision_backlog) = 2
  AND (SELECT (model_version, abs_error_pct) = (32, 8.33) FROM public.v_graded_lot_vision_backlog WHERE lot = 'lot-b'));

-- ACL: service_role only, as for v_schema_atlas, v_job_health and v_residual.
SELECT pg_temp.ok('anon and authenticated hold no privilege on the view; service_role reads it',
  NOT has_table_privilege('anon', 'public.v_graded_lot_vision_backlog', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.v_graded_lot_vision_backlog', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.v_graded_lot_vision_backlog', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  AND has_table_privilege('service_role', 'public.v_graded_lot_vision_backlog', 'SELECT')
  AND NOT has_table_privilege('service_role', 'public.v_graded_lot_vision_backlog', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'));

DO $$
DECLARE n integer; BEGIN
  SET LOCAL ROLE service_role;
  SELECT count(*) INTO n FROM public.v_graded_lot_vision_backlog;
  RESET ROLE;
  PERFORM pg_temp.ok('a real read as service_role returns the two lots', n = 2);
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM count(*) FROM public.v_graded_lot_vision_backlog;
    RESET ROLE;
    RAISE EXCEPTION 'Contract failed: anon could read the view';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    PERFORM pg_temp.ok('a real read as anon is refused', true);
  END;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM count(*) FROM public.v_graded_lot_vision_backlog;
    RESET ROLE;
    RAISE EXCEPTION 'Contract failed: authenticated could read the view';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    PERFORM pg_temp.ok('a real read as authenticated is refused', true);
  END;
END $$;

-- Re-runnable: the same file applies again over the view it created.
\ir ../migrations/20261013160000_v_graded_lot_vision_backlog.sql
SELECT pg_temp.ok('the migration applies a second time and the view still has 19 columns',
  (SELECT count(*) FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'v_graded_lot_vision_backlog') = 19);

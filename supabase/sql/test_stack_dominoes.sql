-- Isolated PostgreSQL 17 contract for 20261015034500_stack_dominoes.sql. Synthetic rows only; never production.
-- Run in an empty, disposable dm_refinement_* database:
--   createdb dm_refinement_stack_dominoes_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_stack_dominoes_ci -f supabase/sql/test_stack_dominoes.sql
-- Fixtures: the live shapes the migration reads (vehicle_events, auction_events, vehicles, bat_bids, auction_comments,
-- stacks, stack_coverage_snapshots, source_target_coverage, vein_ledger, write_receipts, pipeline_registry, cron.schedule).
-- Covered: both tables' keys, order check, trigger, RLS and grants; one reading counts sources exactly, estimates the two big
-- tables from pg_stats, writes cohort depth per pair and threshold (measured zeros included), receipts both tables and hands
-- app.writer back; a source under the 500-lot floor is not read; the domino view (verdicts from the snapshot, feeding
-- sources, moves_with, verdict_can_change_with_lots); the source view; the hypotheses registered with their support and the
-- support view (met, unmet, unknown); UPDATE and DELETE refused; EXECUTE for service_role only; the cron job; a re-apply
-- that changes nothing.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.stack_input_support') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '30s';
SET lock_timeout = '3s';
SET TimeZone = 'UTC';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;
CREATE FUNCTION pg_temp.fails(label text, stmt text, want_state text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE got text;
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    got := SQLSTATE;
    IF got <> want_state THEN RAISE EXCEPTION 'Contract failed: % raised % (%), wanted %', label, got, SQLERRM, want_state; END IF;
    RAISE NOTICE 'PASS % (refused %)', label, got;
    RETURN;
  END;
  RAISE EXCEPTION 'Contract failed: % was admitted', label;
END $$;

-- Live shapes ---------------------------------------------------------------------------------------------------------
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobname text PRIMARY KEY, schedule text, command text);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job VALUES (n, s, c) ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command RETURNING 1::bigint $$;
CREATE FUNCTION public.vein_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$;
CREATE TABLE public.write_receipts (id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), tbl text NOT NULL, op text NOT NULL,
  rows integer, writer text, db_role text, app_name text, txid bigint);
CREATE TABLE public.pipeline_registry (table_name text, column_name text, owned_by text, description text,
  do_not_write_directly boolean, write_via text);
CREATE TABLE public.vein_ledger (vein_id text, version integer NOT NULL DEFAULT 1, family text, hypothesis text NOT NULL, intent text NOT NULL,
  population text NOT NULL, outcome text NOT NULL, test text NOT NULL, pass_rule text NOT NULL, baseline text NOT NULL, parameters jsonb,
  case_ref text, status text NOT NULL DEFAULT 'active', supersedes_version integer, registered_at timestamptz DEFAULT now(),
  registered_by text, PRIMARY KEY (vein_id, version));
CREATE TABLE public.stacks (stack_id text NOT NULL, version integer NOT NULL, name text NOT NULL, PRIMARY KEY (stack_id, version));
INSERT INTO public.stacks VALUES ('S10', 1, 'Liquidity surface'), ('S05', 1, 'Crowd disclosure gap');
CREATE TABLE public.stack_coverage_snapshots (stack_id text NOT NULL, version integer NOT NULL, measured_at timestamptz NOT NULL,
  coverage numeric(5,4), needs jsonb NOT NULL, PRIMARY KEY (stack_id, version, measured_at));
INSERT INTO public.stack_coverage_snapshots VALUES
  ('S10', 1, '2026-10-15 00:00Z', 0.0, '[{"layer":"log","kind":"column","object":"vehicle_events.ended_at","verdict":"partial","evidence":"fill 0.3"},{"layer":"key","kind":"abstract","object":"place entity","verdict":"missing","evidence":"no table"}]'),
  ('S05', 1, '2026-10-15 00:00Z', 0.0, '[{"layer":"fold","kind":"abstract","object":"text fold","verdict":"missing","evidence":"no table"}]');
CREATE TABLE public.source_target_coverage (source_slug text, total_targets bigint, landed bigint, gap bigint, landed_pct numeric, landed_measured_at timestamptz);
INSERT INTO public.source_target_coverage VALUES ('mecum', 1000, 400, 600, 40.00, '2026-10-15 00:00Z'), ('barrett-jackson', 500, 490, 10, 98.00, '2026-10-15 00:00Z');
CREATE TABLE public.vehicles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), year integer, make text, model text, deleted_at timestamptz);
CREATE TABLE public.vehicle_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, source_platform text, event_type text,
  event_status text, started_at timestamptz, ended_at timestamptz, final_price numeric);
CREATE TABLE public.auction_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source text, outcome text, auction_start_date timestamptz, auction_end_date timestamptz);
CREATE TABLE public.bat_bids (id bigserial PRIMARY KEY, source text);
CREATE TABLE public.auction_comments (id bigserial PRIMARY KEY, platform text);

-- Synthetic lots. Porsche cohort: 12 BaT, 11 Mecum. Ford: 600 BaT, 2 Mecum. Pontiac: 500 Barrett-Jackson, 490 Mecum, 5 'tiny'.
INSERT INTO public.vehicles (year, make, model) VALUES (1990, 'Porsche', '911'), (1991, 'Ford', 'F150'), (1992, 'Pontiac', 'Firebird');
INSERT INTO public.vehicle_events (vehicle_id, source_platform, event_type, event_status, started_at, ended_at, final_price)
SELECT v.id, s.p, 'auction', 'sold', '2026-01-01', '2026-01-08', 1000 + g
FROM public.vehicles v
JOIN (VALUES ('Porsche', 'bat', 12), ('Porsche', 'mecum', 11), ('Ford', 'bat', 600), ('Ford', 'mecum', 2),
             ('Pontiac', 'barrett-jackson', 500), ('Pontiac', 'mecum', 490), ('Pontiac', 'tiny', 5)) s(mk, p, n) ON s.mk = v.make
CROSS JOIN LATERAL generate_series(1, s.n) g;
INSERT INTO public.vehicle_events (vehicle_id, source_platform, event_type, event_status)
SELECT id, 'mecum', 'listing', 'ended' FROM public.vehicles LIMIT 1;
INSERT INTO public.vehicle_events (vehicle_id, source_platform, event_type, event_status)
SELECT id, NULL, 'listing', 'ended' FROM public.vehicles LIMIT 1;
INSERT INTO public.auction_events (source, outcome, auction_start_date, auction_end_date) VALUES
  ('bat', 'sold', '2026-01-01', '2026-01-08'), ('bat', 'live', '2026-01-01', '2026-02-08'), ('mecum', 'sold', NULL, '2026-01-09');
INSERT INTO public.bat_bids (source) SELECT 'bat' FROM generate_series(1, 2000);
INSERT INTO public.auction_comments (platform) SELECT 'bat' FROM generate_series(1, 2000);
ANALYZE;

\i supabase/migrations/20261015034500_stack_dominoes.sql
\i supabase/migrations/20261015050000_stack_dominoes_staged.sql

-- Shape ---------------------------------------------------------------------------------------------------------------
SELECT pg_temp.ok('both tables have RLS on and no anon or authenticated grant',
  (SELECT bool_and(relrowsecurity) FROM pg_class WHERE relname IN ('stack_input_support', 'stack_cohort_depth'))
  AND NOT has_table_privilege('anon', 'public.stack_input_support', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.stack_cohort_depth', 'SELECT')
  AND has_table_privilege('service_role', 'public.stack_cohort_depth', 'SELECT') AND NOT has_table_privilege('service_role', 'public.stack_cohort_depth', 'INSERT'));
SELECT pg_temp.ok('EXECUTE for service_role only',
  has_function_privilege('service_role', 'public.snapshot_stack_dominoes(text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.snapshot_stack_dominoes(text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.snapshot_stack_dominoes(text)', 'EXECUTE'));
SELECT pg_temp.fails('an empty caller name is refused', $$SELECT public.snapshot_stack_dominoes(' ')$$, '22023');
SELECT pg_temp.fails('source_a after source_b is refused', $$INSERT INTO public.stack_cohort_depth VALUES (now(), 'z', 'a', 1, 0, 0, 0, 'x', 'x')$$, '23514');

-- One reading ---------------------------------------------------------------------------------------------------------
SELECT public.snapshot_stack_dominoes('contract') AS r \gset
SELECT pg_temp.ok('the one-call reading wrote rows to both tables',
  (:'r'::jsonb ->> 'input_rows')::int > 0 AND (:'r'::jsonb ->> 'depth_rows')::int > 0);
SELECT pg_temp.ok('vehicle_events counted exactly per normalized source',
  (SELECT jsonb_object_agg(source_key, rows) FROM public.stack_input_support WHERE input_table = 'vehicle_events')
  = '{"bat":612,"mecum":504,"barrettjackson":500,"tiny":5,"unknown":1}'::jsonb);
SELECT pg_temp.ok('sold rows and end clocks counted per source',
  (SELECT rows_sold = 612 AND rows_with_start = 612 AND rows_with_end = 612 FROM public.stack_input_support WHERE input_table = 'vehicle_events' AND source_key = 'bat')
  AND (SELECT rows = 504 AND rows_sold = 503 AND rows_with_end = 503 FROM public.stack_input_support WHERE input_table = 'vehicle_events' AND source_key = 'mecum'));
SELECT pg_temp.ok('auction_events counted per source with sold and clocks',
  (SELECT rows = 2 AND rows_sold = 1 AND rows_with_start = 2 AND rows_with_end = 2 AND clock_max = '2026-02-08' FROM public.stack_input_support WHERE input_table = 'auction_events' AND source_key = 'bat'));
SELECT pg_temp.ok('bat_bids and auction_comments are estimates by source from pg_stats',
  (SELECT count(*) = 2 AND bool_and(basis = 'estimate' AND rows = 2000 AND rows_sold IS NULL AND source_key = 'bat')
   FROM public.stack_input_support WHERE input_table IN ('bat_bids', 'auction_comments')));
SELECT pg_temp.ok('cohort depth: bat x mecum has 1 cohort at 10 lots and 0 at 20 (a measured zero)',
  (SELECT cohorts FROM public.stack_cohort_depth WHERE source_a = 'bat' AND source_b = 'mecum' AND min_lots = 10) = 1
  AND (SELECT cohorts FROM public.stack_cohort_depth WHERE source_a = 'bat' AND source_b = 'mecum' AND min_lots = 20) = 0);
SELECT pg_temp.ok('cohort depth: lots on both sides are summed inside qualifying cohorts',
  (SELECT lots_a = 12 AND lots_b = 11 FROM public.stack_cohort_depth WHERE source_a = 'bat' AND source_b = 'mecum' AND min_lots = 10));
SELECT pg_temp.ok('cohort depth: bat alone has 2 cohorts at 10 lots and 1 at 60',
  (SELECT cohorts FROM public.stack_cohort_depth WHERE source_a = 'bat' AND source_b = 'bat' AND min_lots = 10) = 2
  AND (SELECT cohorts FROM public.stack_cohort_depth WHERE source_a = 'bat' AND source_b = 'bat' AND min_lots = 60) = 1);
SELECT pg_temp.ok('a source under the 500-lot floor is not read',
  NOT EXISTS (SELECT 1 FROM public.stack_cohort_depth WHERE source_a = 'tiny' OR source_b = 'tiny'));
SELECT pg_temp.ok('one receipt per table written, writer named, app.writer handed back',
  (SELECT count(*) FROM public.write_receipts WHERE writer = 'snapshot_stack_dominoes' AND tbl IN ('stack_input_support', 'stack_cohort_depth')) = 2
  AND coalesce(current_setting('app.writer', true), '') = '');
SELECT pg_temp.fails('UPDATE is refused', $$UPDATE public.stack_input_support SET rows = 0$$, 'P0001');
SELECT pg_temp.fails('DELETE is refused', $$DELETE FROM public.stack_cohort_depth$$, 'P0001');

-- Views ---------------------------------------------------------------------------------------------------------------
SELECT pg_temp.ok('v_stack_dominoes: ended_at need is partial, measured, fed by five sources, can change with lots',
  (SELECT verdict = 'partial' AND feed_basis = 'measured' AND verdict_can_change_with_lots AND 'mecum' = ANY (moves_with)
          AND jsonb_array_length(feeding_sources) = 5 AND coverage_measured_at = '2026-10-15 00:00Z'
   FROM public.v_stack_dominoes WHERE stack_id = 'S10' AND object = 'vehicle_events.ended_at'));
SELECT pg_temp.ok('v_stack_dominoes: an abstract layer has no feed and cannot change with lots',
  (SELECT feed_basis = 'none' AND moves_with = ARRAY[]::text[] AND NOT verdict_can_change_with_lots
   FROM public.v_stack_dominoes WHERE object = 'place entity'));
SELECT pg_temp.ok('v_source_dominoes: mecum and barrett-jackson reach the ended_at input with their rows there (slug joined by key)',
  (SELECT source_rows_in_input = 504 FROM public.v_source_dominoes WHERE source_slug = 'mecum' AND object = 'vehicle_events.ended_at')
  AND (SELECT source_rows_in_input = 500 FROM public.v_source_dominoes WHERE source_slug = 'barrett-jackson' AND object = 'vehicle_events.ended_at'));

-- Hypotheses ----------------------------------------------------------------------------------------------------------
SELECT pg_temp.ok('six hypotheses registered V014..V019, each with a support rule, active, version 1',
  (SELECT count(*) = 6 AND bool_and(parameters ? 'support' AND status = 'active' AND version = 1) FROM public.vein_ledger WHERE vein_id BETWEEN 'V014' AND 'V019'));
SELECT pg_temp.ok('V014 is unmet (1 of 30 cohorts) and so not testable',
  (SELECT current_value = 1 AND needed_value = 30 AND met IS FALSE AND hypothesis_testable IS FALSE FROM public.v_hypothesis_support WHERE vein_id = 'V014'));
SELECT pg_temp.ok('V016 (bat x bonhams) has no reading: unknown, not false',
  (SELECT current_value IS NULL AND met IS NULL AND hypothesis_testable IS NULL FROM public.v_hypothesis_support WHERE vein_id = 'V016'));
SELECT pg_temp.ok('V019 reads stack S05 coverage 0 against 1.0: unmet',
  (SELECT current_value = 0 AND needed_value = 1.0 AND met IS FALSE FROM public.v_hypothesis_support WHERE vein_id = 'V019'));
SELECT pg_temp.ok('V017 lists three requirements',
  (SELECT count(*) = 3 FROM public.v_hypothesis_support WHERE vein_id = 'V017'));

-- Staged form, as the job runs it: separate statements in one session, a missing source simply absent.
SELECT public.snapshot_stack_dominoes_begin('staged') \gset
SELECT public.snapshot_stack_dominoes_read('bat');
SELECT public.snapshot_stack_dominoes_read('mecum');
SELECT public.snapshot_stack_dominoes_read('nosuchsource');
SELECT public.snapshot_stack_dominoes_finish() AS f \gset
SELECT pg_temp.ok('staged reading: depth only for the sources read (bat, mecum), bat x mecum 1 cohort at 10 lots',
  :'f'::jsonb ->> 'sources_read' = 'bat, mecum'
  AND (SELECT count(DISTINCT source_a) = 2 FROM public.stack_cohort_depth WHERE registered_by = 'staged')
  AND (SELECT cohorts FROM public.stack_cohort_depth WHERE registered_by = 'staged' AND source_a = 'bat' AND source_b = 'mecum' AND min_lots = 10) = 1);
SELECT pg_temp.fails('read without begin is refused', $$SELECT public.snapshot_stack_dominoes_read('bat')$$, '55000');

-- Registry, schedule, re-apply ----------------------------------------------------------------------------------------
SELECT pg_temp.ok('registry rows for both tables', (SELECT count(*) = 2 FROM public.pipeline_registry WHERE owned_by = 'snapshot_stack_dominoes' AND do_not_write_directly));
SELECT pg_temp.ok('cron job runs the coverage snapshot then the dominoes, daily, with the 300s timeout',
  (SELECT schedule = '25 4 * * *' AND command LIKE '%statement_timeout = ''300s''%' AND command LIKE '%snapshot_stack_coverage%' AND command LIKE '%snapshot_stack_dominoes_begin%' AND command LIKE '%snapshot_stack_dominoes_finish%' FROM cron.job WHERE jobname = 'snapshot-stack-dominoes'));
SELECT pg_temp.ok('every column of both tables is described',
  (SELECT count(*) = 0 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
   WHERE c.relname IN ('stack_input_support', 'stack_cohort_depth') AND a.attnum > 0 AND NOT a.attisdropped AND col_description(c.oid, a.attnum) IS NULL));
\i supabase/migrations/20261015034500_stack_dominoes.sql
\i supabase/migrations/20261015050000_stack_dominoes_staged.sql
SELECT pg_temp.ok('re-apply registered nothing twice',
  (SELECT count(*) = 6 FROM public.vein_ledger WHERE vein_id BETWEEN 'V014' AND 'V019')
  AND (SELECT count(*) = 2 FROM public.pipeline_registry WHERE owned_by = 'snapshot_stack_dominoes'));

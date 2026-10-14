-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_treemap -f supabase/sql/test_treemap_refresh_all.sql
-- Proves treemap_refresh_all refreshes a view with a unique index concurrently and one without plainly, instead of
-- failing on the first view that lacks one, and records its clock. Stub rows in a disposable database: -- ALLOW_RAW_TESTIMONY_WRITE
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
-- pg_cron is not in a stock PG17: a stand-in schema with the two calls the migration makes.
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS
$$ INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule, p_command) ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(p_name text) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobname = p_name RETURNING true $$;
CREATE TABLE public.treemap_refreshes (refreshed_at timestamptz PRIMARY KEY DEFAULT now(), seconds numeric, note text);
CREATE TABLE public.vehicles (id int PRIMARY KEY, make text, model text, source text);
-- ALLOW_RAW_TESTIMONY_WRITE (stub rows)
INSERT INTO public.vehicles VALUES (1, 'Porsche', '911', 'bat'), (2, 'Ford', 'Mustang', 'bat');
-- Two of the ten views: one with a unique index (concurrent), one without (plain), as in production.
CREATE MATERIALIZED VIEW public.mv_treemap_by_brand AS SELECT make AS name, count(*) AS n FROM public.vehicles GROUP BY make;
CREATE UNIQUE INDEX idx_mv_treemap_brand_name ON public.mv_treemap_by_brand (name);
CREATE MATERIALIZED VIEW public.mv_treemap_makes_by_source AS SELECT source, make, count(*) AS n FROM public.vehicles GROUP BY 1, 2;

\ir ../migrations/20261014041500_treemap_refresh_concurrently_only_when_possible.sql

DO $$
DECLARE r record; v_n int;
BEGIN
  -- The one-shot exists and removes itself before it refreshes.
  SELECT * INTO r FROM cron.job WHERE jobname = 'treemap-refresh-once-20261014b';
  IF r.command NOT LIKE 'SELECT cron.unschedule(''treemap-refresh-once-20261014b'');%' THEN RAISE EXCEPTION 'one-shot does not unschedule first: %', r.command; END IF;
  -- New rows appear only after a refresh; the views missing from this stub are skipped.
  INSERT INTO public.vehicles VALUES (3, 'Porsche', '356', 'bat');
  PERFORM public.treemap_refresh_all();
  SELECT m.n INTO v_n FROM public.mv_treemap_by_brand m WHERE m.name = 'Porsche';
  IF v_n <> 2 THEN RAISE EXCEPTION 'brand view not refreshed: %', v_n; END IF;
  SELECT m.n INTO v_n FROM public.mv_treemap_makes_by_source m WHERE m.make = 'Porsche';
  IF v_n <> 2 THEN RAISE EXCEPTION 'makes_by_source (no unique index) not refreshed: %', v_n; END IF;
  SELECT * INTO r FROM public.treemap_refreshes ORDER BY refreshed_at DESC LIMIT 1;
  IF r.note <> 'treemap_refresh_all: 1 concurrently, 1 plainly' OR r.seconds IS NULL THEN RAISE EXCEPTION 'clock row: %', r; END IF;
  RAISE NOTICE 'treemap_refresh_all: concurrent where possible, plain otherwise, clock recorded';
END $$;

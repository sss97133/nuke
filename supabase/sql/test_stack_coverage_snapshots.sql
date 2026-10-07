-- Isolated PostgreSQL 17 contract for 20261007234000_stack_coverage_snapshots.sql. Synthetic rows only; never production.
-- Run in an empty, disposable dm_refinement_* database:
--   createdb dm_refinement_stack_coverage_snapshots_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_stack_coverage_snapshots_ci -f supabase/sql/test_stack_coverage_snapshots.sql
-- Fixtures: stacks with its (stack_id, version) key, the registry's vein_append_only() trigger function, write_receipts,
-- pipeline_registry, and a stand-in stack_coverage(text) that returns fixed readings for two stacks (the live function needs
-- the whole registry and the atlas; the writer's contract is about what it does with the rows it is given). Supabase's
-- default privileges are set first so the migration's revokes are exercised.
-- Covered: the table's keys, checks, trigger, RLS and grants; a reading writes one row per stack at one clock with one
-- receipt and hands app.writer back; a replay inside the same transaction writes nothing; a later reading adds a second
-- clock; the series view; UPDATE and DELETE refused; a row breaking the counts or naming an unknown stack version refused;
-- EXECUTE for service_role only; registry row and comments; a re-apply that changes nothing.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR to_regclass('public.stack_coverage_snapshots') IS NOT NULL
     OR to_regclass('public.stacks') IS NOT NULL THEN
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
    RAISE NOTICE 'PASS % (refused %: %)', label, got, left(SQLERRM, 80);
    RETURN;
  END;
  RAISE EXCEPTION 'Contract failed: % was admitted', label;
END $$;

-- Live shapes ------------------------------------------------------------------------------------------------------------
CREATE TABLE public.stacks (stack_id text NOT NULL, version integer NOT NULL, name text NOT NULL, status text NOT NULL,
  PRIMARY KEY (stack_id, version));
INSERT INTO public.stacks VALUES ('S01', 1, 'County performance surface per model', 'measured'), ('SX', 2, 'fixture half', 'measured');
CREATE FUNCTION public.vein_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only: register a new version or append a new run', TG_TABLE_NAME; END $$;
CREATE TABLE public.write_receipts (
  id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), tbl text NOT NULL, op text NOT NULL, rows integer,
  writer text, db_role text, app_name text, txid bigint);
CREATE TABLE public.pipeline_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name text NOT NULL, column_name text,
  owned_by text NOT NULL, description text NOT NULL, valid_values text[],
  do_not_write_directly boolean NOT NULL DEFAULT false, write_via text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (table_name, column_name));
-- Stand-in for the live reader: the latest version of each stack with a fixed verdict set.
CREATE FUNCTION public.stack_coverage(p_stack_id text DEFAULT NULL)
RETURNS TABLE(stack_id text, version integer, coverage numeric, n_needs integer, n_present integer, n_partial integer,
              n_missing integer, needs jsonb, measured_at timestamptz)
LANGUAGE sql STABLE AS $$
  SELECT * FROM (VALUES
    ('S01', 1, 1.0000::numeric, 1, 1, 0, 0, '[{"layer":"key","kind":"abstract","object":"place entity","verdict":"present"}]'::jsonb, now()),
    ('SX',  2, 0.5000::numeric, 4, 2, 1, 1, '[{"layer":"log","verdict":"present"},{"layer":"key","verdict":"present"},{"layer":"fold","verdict":"partial"},{"layer":"feature","verdict":"missing"}]'::jsonb, now())
  ) AS v(stack_id, version, coverage, n_needs, n_present, n_partial, n_missing, needs, measured_at)
  WHERE p_stack_id IS NULL OR v.stack_id = p_stack_id
$$;

\ir ../migrations/20261007234000_stack_coverage_snapshots.sql

-- Shape ------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.ok('the table carries its key, its stack foreign key, three checks, the append-only trigger and RLS',
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stack_coverage_snapshots_pkey' AND contype = 'p')
  AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stack_coverage_snapshots_stack_fkey' AND confrelid = 'public.stacks'::regclass)
  AND (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.stack_coverage_snapshots'::regclass AND contype = 'c') = 3
  AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'stack_coverage_snapshots_append_only' AND tgrelid = 'public.stack_coverage_snapshots'::regclass)
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.stack_coverage_snapshots'::regclass));
SELECT pg_temp.ok('service_role reads the table and the view; anon and authenticated read neither; nobody but the owner writes the table',
  has_table_privilege('service_role', 'public.stack_coverage_snapshots', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.stack_coverage_snapshots', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.stack_coverage_snapshots', 'SELECT')
  AND NOT has_table_privilege('service_role', 'public.stack_coverage_snapshots', 'INSERT')
  AND has_table_privilege('service_role', 'public.v_stack_coverage_series', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.v_stack_coverage_series', 'SELECT'));
SELECT pg_temp.ok('the writer is callable by service_role only and is a definer with a fixed search_path',
  has_function_privilege('service_role', 'public.snapshot_stack_coverage(text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.snapshot_stack_coverage(text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.snapshot_stack_coverage(text)', 'EXECUTE')
  AND (SELECT prosecdef AND 'search_path=public, pg_temp' = ANY (proconfig) FROM pg_proc WHERE oid = 'public.snapshot_stack_coverage(text)'::regprocedure));

-- A reading --------------------------------------------------------------------------------------------------------------
SELECT pg_temp.fails('a caller must be named', $q$SELECT public.snapshot_stack_coverage('')$q$, '22023');
SELECT set_config('app.writer', 'contract-caller', false);
BEGIN;
CREATE TEMP TABLE r1 AS SELECT public.snapshot_stack_coverage('contract first reading') AS r;
CREATE TEMP TABLE r1b AS SELECT public.snapshot_stack_coverage('contract replay same clock') AS r;
COMMIT;
SELECT pg_temp.ok('the first reading wrote one row per stack at one clock, with one receipt under its writer',
  (SELECT (r ->> 'rows')::int = 2 AND (r ->> 'measured_at') IS NOT NULL AND (r ->> 'ms') IS NOT NULL FROM r1)
  AND (SELECT count(*) FROM public.stack_coverage_snapshots) = 2
  AND (SELECT count(DISTINCT measured_at) FROM public.stack_coverage_snapshots) = 1
  AND (SELECT count(*) FROM public.write_receipts) = 1
  AND (SELECT tbl = 'stack_coverage_snapshots' AND op = 'INSERT' AND rows = 2 AND writer = 'snapshot_stack_coverage' AND txid IS NOT NULL FROM public.write_receipts));
SELECT pg_temp.ok('a replay inside the same transaction (same clock) wrote nothing and left no receipt',
  (SELECT (r ->> 'rows')::int = 0 FROM r1b) AND (SELECT count(*) FROM public.write_receipts) = 1);
SELECT pg_temp.ok('the rows carry the reading: S01 1 of 1 coverage 1, SX 2 of 4 coverage 0.5, verdicts kept, caller recorded',
  (SELECT coverage = 1.0000 AND n_needs = 1 AND n_present = 1 AND jsonb_array_length(needs) = 1 AND registered_by = 'contract first reading' AND source = 'stack_coverage()'
   FROM public.stack_coverage_snapshots WHERE stack_id = 'S01')
  AND (SELECT coverage = 0.5000 AND n_needs = 4 AND n_present = 2 AND n_partial = 1 AND n_missing = 1 AND jsonb_array_length(needs) = 4
       FROM public.stack_coverage_snapshots WHERE stack_id = 'SX'));
SELECT pg_temp.ok('app.writer is handed back to the caller after the call', current_setting('app.writer', true) = 'contract-caller');
SELECT pg_sleep(0.01);
CREATE TEMP TABLE r2 AS SELECT public.snapshot_stack_coverage('contract second reading') AS r;
SELECT pg_temp.ok('a later reading adds a second clock: 4 rows, 2 readings in the series view, 2 receipts',
  (SELECT (r ->> 'rows')::int = 2 FROM r2)
  AND (SELECT count(*) FROM public.stack_coverage_snapshots) = 4
  AND (SELECT count(*) FROM public.v_stack_coverage_series) = 2
  AND (SELECT bool_and(stacks = 2 AND showable = 1 AND nonzero = 2 AND mean_coverage = 0.7500 AND needs_present = 3 AND needs = 5) FROM public.v_stack_coverage_series)
  AND (SELECT count(*) FROM public.write_receipts) = 2);

-- Attacks ----------------------------------------------------------------------------------------------------------------
SELECT pg_temp.fails('UPDATE is refused (append-only)',
  $q$UPDATE public.stack_coverage_snapshots SET coverage = 0 WHERE stack_id = 'S01'$q$, 'P0001');
SELECT pg_temp.fails('DELETE is refused (append-only)',
  $q$DELETE FROM public.stack_coverage_snapshots WHERE stack_id = 'S01'$q$, 'P0001');
SELECT pg_temp.fails('a row whose counts do not add up is refused',
  $q$INSERT INTO public.stack_coverage_snapshots (stack_id, version, measured_at, coverage, n_needs, n_present, n_partial, n_missing, needs, registered_by)
     VALUES ('S01', 1, now() + interval '1 hour', 0.5, 2, 2, 1, 0, '[]', 'attack')$q$, '23514');
SELECT pg_temp.fails('a row with coverage above 1 is refused',
  $q$INSERT INTO public.stack_coverage_snapshots (stack_id, version, measured_at, coverage, n_needs, n_present, n_partial, n_missing, needs, registered_by)
     VALUES ('S01', 1, now() + interval '1 hour', 1.5, 1, 1, 0, 0, '[]', 'attack')$q$, '23514');
SELECT pg_temp.fails('a row for a stack version that does not exist is refused',
  $q$INSERT INTO public.stack_coverage_snapshots (stack_id, version, measured_at, coverage, n_needs, n_present, n_partial, n_missing, needs, registered_by)
     VALUES ('S99', 1, now() + interval '1 hour', 0, 1, 0, 0, 1, '[]', 'attack')$q$, '23503');
SELECT pg_temp.fails('needs must be a jsonb array',
  $q$INSERT INTO public.stack_coverage_snapshots (stack_id, version, measured_at, coverage, n_needs, n_present, n_partial, n_missing, needs, registered_by)
     VALUES ('S01', 1, now() + interval '1 hour', 1, 1, 1, 0, 0, '{}', 'attack')$q$, '23514');

-- Registry and comments ------------------------------------------------------------------------------------------------------
SELECT pg_temp.ok('registry row owned by the writer, do_not_write_directly; the table, its 11 columns, the writer and the view are described',
  (SELECT owned_by = 'snapshot_stack_coverage' AND do_not_write_directly FROM public.pipeline_registry WHERE table_name = 'stack_coverage_snapshots' AND column_name IS NULL)
  AND obj_description('public.stack_coverage_snapshots'::regclass, 'pg_class') LIKE 'Time series of stack coverage%'
  AND (SELECT count(*) FROM pg_attribute a WHERE a.attrelid = 'public.stack_coverage_snapshots'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND col_description(a.attrelid, a.attnum) IS NOT NULL) = 11
  AND obj_description('public.snapshot_stack_coverage(text)'::regprocedure, 'pg_proc') IS NOT NULL
  AND obj_description('public.v_stack_coverage_series'::regclass, 'pg_class') IS NOT NULL);

-- Re-apply ----------------------------------------------------------------------------------------------------------------------
\ir ../migrations/20261007234000_stack_coverage_snapshots.sql
SELECT pg_temp.ok('re-applying the migration keeps the 4 rows, the 2 receipts, one registry row and one trigger',
  (SELECT count(*) FROM public.stack_coverage_snapshots) = 4
  AND (SELECT count(*) FROM public.write_receipts) = 2
  AND (SELECT count(*) FROM public.pipeline_registry WHERE table_name = 'stack_coverage_snapshots') = 1
  AND (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.stack_coverage_snapshots'::regclass AND NOT tgisinternal) = 1);

\echo 'stack coverage snapshots contract: all checks passed'

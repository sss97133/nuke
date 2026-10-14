-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_pipeline_pulse_memo -f this-file.sql
-- Proves get_pipeline_pulse(integer) after 20261014040200_pipeline_pulse_remembers_counted_days.sql:
--   * the same answer, value for value, as the 2026-10-14 production function on the same rows (exact, capped,
--     unavailable images, backlogs, shape), with only coverage.memo added;
--   * days it has counted and that cannot change are read from public.pipeline_pulse_day_counts, not recounted:
--     with the base tables made to fail, past days still answer;
--   * only trusted facts are kept (the cap, an exact day that ended an hour before the count), an untrusted row is
--     ignored and replaced, a stored cap is not recounted;
--   * anon and authenticated still execute the function and read nothing in the memory table directly;
--   * no memory table, or a failing one, means counting live: the same answer;
--   * a drifted source stops the migration.
-- The rows below are a disposable test database's rows, never production testimony.
-- ALLOW_RAW_TESTIMONY_WRITE: a disposable test database; the stub tables below carry production's names and none of its rows.
\set ON_ERROR_STOP on
SET timezone = 'UTC';
SET statement_timeout = '60s';
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL OR to_regnamespace('auth') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable dm_refinement_* PG17 database';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- The shapes the reader touches, with the live index shapes (images has no full leading-time index).
CREATE TABLE public.vehicles (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, created_at timestamptz);
CREATE TABLE public.vehicle_images (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, vehicle_id bigint,
  created_at timestamptz, updated_at timestamptz, ai_processing_status text);
CREATE TABLE public.vehicle_observations (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, ingested_at timestamptz);
CREATE TABLE public.auction_comments (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, created_at timestamptz);
CREATE TABLE public.import_queue (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, status text);
CREATE INDEX fixture_vehicles_time ON public.vehicles (created_at);
CREATE INDEX fixture_observations_time ON public.vehicle_observations (ingested_at);
CREATE INDEX fixture_comments_time ON public.auction_comments (created_at DESC);
CREATE INDEX idx_vehicle_images_created_at ON public.vehicle_images (vehicle_id, created_at DESC);
CREATE INDEX fixture_images_pending ON public.vehicle_images (ai_processing_status, created_at) WHERE ai_processing_status = 'pending';
CREATE INDEX fixture_images_failed ON public.vehicle_images (ai_processing_status, updated_at) WHERE ai_processing_status IN ('processing', 'failed');
CREATE INDEX fixture_import_status ON public.import_queue (status);

-- The function as production has it on 2026-10-14, with production's grants (PUBLIC, anon, authenticated, service_role).
\ir helpers/get_pipeline_pulse_live_20261014.sql
GRANT EXECUTE ON FUNCTION public.get_pipeline_pulse(integer) TO anon, authenticated, service_role;
CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
SELECT public.t_assert(md5(pg_get_functiondef('public.get_pipeline_pulse(integer)'::regprocedure)) = '767821a759e394071cbf35ab56a0fff9',
  'the fixture is the live source');
-- A copy of the live function under another name, to compare against after the replacement.
SELECT replace(pg_get_functiondef('public.get_pipeline_pulse(integer)'::regprocedure),
               'public.get_pipeline_pulse(', 'public.pulse_before(') AS ddl \gexec
CREATE TEMP TABLE original_contract AS
  SELECT proowner, proacl, prosecdef, proargdefaults::text AS defaults, proconfig FROM pg_proc
  WHERE oid = 'public.get_pipeline_pulse(integer)'::regprocedure;

-- Rows, relative to now in UTC. today-1 and today-3 are exact, today-2 is capped (10,001), today is exact and open.
-- Observations: today-2 capped. Comments: one on today-1. A row stamped two days ahead must not count.
CREATE FUNCTION public.t_day(p_offset integer, p_hour integer DEFAULT 12) RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT (((statement_timestamp() AT TIME ZONE 'UTC')::date + p_offset)::timestamp + make_interval(hours => p_hour)) AT TIME ZONE 'UTC' $$;
INSERT INTO public.vehicles (created_at) SELECT public.t_day(-1) FROM generate_series(1, 12);
INSERT INTO public.vehicles (created_at) SELECT public.t_day(-2) FROM generate_series(1, 10001);
INSERT INTO public.vehicles (created_at) SELECT public.t_day(-3) FROM generate_series(1, 4);
INSERT INTO public.vehicles (created_at) SELECT statement_timestamp() - interval '1 second' FROM generate_series(1, 3);
INSERT INTO public.vehicles (created_at) VALUES (statement_timestamp() + interval '2 days');
INSERT INTO public.vehicle_observations (ingested_at) SELECT public.t_day(-1) FROM generate_series(1, 5);
INSERT INTO public.vehicle_observations (ingested_at) SELECT public.t_day(-2) FROM generate_series(1, 10001);
INSERT INTO public.vehicle_observations (ingested_at) SELECT statement_timestamp() - interval '1 second' FROM generate_series(1, 2);
INSERT INTO public.auction_comments (created_at) VALUES (public.t_day(-1));
INSERT INTO public.import_queue (status) SELECT 'pending' FROM generate_series(1, 3);
INSERT INTO public.vehicle_images (ai_processing_status, created_at) SELECT 'pending', statement_timestamp() FROM generate_series(1, 2);
INSERT INTO public.vehicle_images (ai_processing_status, updated_at) VALUES ('failed', statement_timestamp());
ANALYZE;

-- Remove what differs between two readings of the same rows: the clocks and the new memo block.
CREATE FUNCTION public.t_core(j jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT j #- '{generated_at}' #- '{as_of}' #- '{coverage,memo}' $$;

-- 1. Before the migration: the live function's answer for five days.
CREATE TABLE public.t_readings (label text PRIMARY KEY, j jsonb);
INSERT INTO public.t_readings SELECT 'before', public.pulse_before(5);
SELECT public.t_assert((SELECT j -> 'organs' -> 'vehicles' -> 2 ->> 'status' FROM public.t_readings WHERE label = 'before') = 'capped',
  'the fixture has a capped vehicles day');

-- 2. The migration.
\ir ../migrations/20261014040200_pipeline_pulse_remembers_counted_days.sql

SELECT public.t_assert((SELECT ROW(p.proowner, p.proacl, p.prosecdef, p.proargdefaults::text)
    IS NOT DISTINCT FROM ROW(o.proowner, o.proacl, o.prosecdef, o.defaults)
  FROM pg_proc p CROSS JOIN original_contract o WHERE p.oid = 'public.get_pipeline_pulse(integer)'::regprocedure),
  'signature, default, owner, security definer and grants are preserved');
SELECT public.t_assert((SELECT p.proconfig @> ARRAY['search_path=public', 'statement_timeout=8s', 'lock_timeout=500ms'] AND p.provolatile = 'v'
  FROM pg_proc p WHERE p.oid = 'public.get_pipeline_pulse(integer)'::regprocedure),
  'the finite settings are kept and the reader is volatile now that it stores');
SELECT public.t_assert(has_table_privilege('anon', 'public.pipeline_pulse_day_counts', 'SELECT') IS FALSE
  AND has_table_privilege('authenticated', 'public.pipeline_pulse_day_counts', 'SELECT') IS FALSE
  AND has_table_privilege('anon', 'public.pipeline_pulse_day_counts', 'INSERT') IS FALSE
  AND has_table_privilege('authenticated', 'public.pipeline_pulse_day_counts', 'INSERT') IS FALSE
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.pipeline_pulse_day_counts'::regclass),
  'the memory table is closed to the API roles and has row security on');
SELECT public.t_assert((SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.pipeline_pulse_day_counts'::regclass
    AND attnum > 0 AND NOT attisdropped AND col_description(attrelid, attnum) IS NOT NULL) = 4
  AND obj_description('public.pipeline_pulse_day_counts'::regclass, 'pg_class') IS NOT NULL, 'the table and its four columns are described');

-- 3. The first reading counts, stores and answers exactly as before.
INSERT INTO public.t_readings SELECT 'first', public.get_pipeline_pulse(5);
SELECT public.t_assert((SELECT public.t_core(a.j) = public.t_core(b.j) FROM public.t_readings a, public.t_readings b
  WHERE a.label = 'before' AND b.label = 'first'), 'first reading: the same answer as the live function, value for value');
SELECT public.t_assert((SELECT (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(b.j) k)
        = (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(a.j) k)
    AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(b.j -> 'coverage') k)
        = (SELECT array_agg(k ORDER BY k) FROM (SELECT jsonb_object_keys(a.j -> 'coverage') UNION SELECT 'memo') s(k))
  FROM public.t_readings a, public.t_readings b WHERE a.label = 'before' AND b.label = 'first'),
  'first reading: the same top-level keys, and coverage gains only memo');

-- What should have been stored. today-1 and older are exact only if the reading came at least an hour after they ended;
-- the cap is stored whatever the hour. Images are never stored: no usable index.
SELECT (statement_timestamp() >= ((statement_timestamp() AT TIME ZONE 'UTC')::date)::timestamp AT TIME ZONE 'UTC' + interval '1 hour') AS past_day_is_frozen \gset
SELECT public.t_assert((SELECT count(*) FROM public.pipeline_pulse_day_counts WHERE n = 10001) = 2
  AND EXISTS (SELECT FROM public.pipeline_pulse_day_counts WHERE organ = 'vehicles' AND day = (statement_timestamp() AT TIME ZONE 'UTC')::date - 2 AND n = 10001)
  AND EXISTS (SELECT FROM public.pipeline_pulse_day_counts WHERE organ = 'observations' AND day = (statement_timestamp() AT TIME ZONE 'UTC')::date - 2 AND n = 10001),
  'the two capped days are stored');
SELECT public.t_assert(NOT EXISTS (SELECT FROM public.pipeline_pulse_day_counts WHERE organ = 'images'), 'unavailable images are never stored');
SELECT public.t_assert(NOT EXISTS (SELECT FROM public.pipeline_pulse_day_counts WHERE day = (statement_timestamp() AT TIME ZONE 'UTC')::date AND n <> 10001),
  'an open day is never stored below the cap');
SELECT public.t_assert(EXISTS (SELECT FROM public.pipeline_pulse_day_counts WHERE organ = 'vehicles' AND day = (statement_timestamp() AT TIME ZONE 'UTC')::date - 3 AND n = 4)
  AND EXISTS (SELECT FROM public.pipeline_pulse_day_counts WHERE organ = 'auction_comments' AND day = (statement_timestamp() AT TIME ZONE 'UTC')::date - 3 AND n = 0),
  'an exact day that ended long ago is stored');
SELECT public.t_assert(EXISTS (SELECT FROM public.pipeline_pulse_day_counts WHERE organ = 'vehicles' AND day = (statement_timestamp() AT TIME ZONE 'UTC')::date - 1 AND n = 12) = :'past_day_is_frozen'::boolean,
  'yesterday is stored only once it ended an hour ago');
SELECT public.t_assert((SELECT (j -> 'coverage' -> 'memo' ->> 'days_stored_this_reading')::int = (SELECT count(*)::int FROM public.pipeline_pulse_day_counts)
  AND (j -> 'coverage' -> 'memo' ->> 'days_served_from_memory')::int = 0 FROM public.t_readings WHERE label = 'first'),
  'the first reading served nothing from memory and stored what the table now holds');

-- 4. The second reading is the same answer from memory.
INSERT INTO public.t_readings SELECT 'second', public.get_pipeline_pulse(5);
SELECT public.t_assert((SELECT public.t_core(a.j) = public.t_core(b.j) FROM public.t_readings a, public.t_readings b
  WHERE a.label = 'first' AND b.label = 'second'), 'second reading: the same answer as the first');
SELECT public.t_assert((SELECT (j -> 'coverage' -> 'memo' ->> 'days_served_from_memory')::int = (SELECT count(*)::int FROM public.pipeline_pulse_day_counts)
  AND (j -> 'coverage' -> 'memo' ->> 'days_stored_this_reading')::int = 0 FROM public.t_readings WHERE label = 'second'),
  'the second reading served every stored day from memory and stored nothing');

-- 5. With the base tables failing, the remembered days still answer; only the open day is lost. The reader runs
--    under a role that obeys row security, as production's does not for its owner only because the owner is a superuser role.
DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dm_pulse_reader') THEN CREATE ROLE dm_pulse_reader NOLOGIN; END IF; END $$;
GRANT USAGE ON SCHEMA public TO dm_pulse_reader;
GRANT SELECT ON public.vehicles, public.vehicle_images, public.vehicle_observations, public.auction_comments, public.import_queue TO dm_pulse_reader;
GRANT SELECT, INSERT, UPDATE ON public.pipeline_pulse_day_counts TO dm_pulse_reader;
CREATE FUNCTION public.t_cancel() RETURNS boolean LANGUAGE plpgsql STABLE AS $$
BEGIN RAISE EXCEPTION 'PRIVATE_ERROR_MARKER' USING ERRCODE = '57014'; END $$;
CREATE POLICY t_reader_memory ON public.pipeline_pulse_day_counts TO dm_pulse_reader USING (true) WITH CHECK (true);
ALTER TABLE public.vehicle_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY t_cancel_all ON public.vehicle_observations USING (public.t_cancel());
ALTER FUNCTION public.get_pipeline_pulse(integer) OWNER TO dm_pulse_reader;
INSERT INTO public.t_readings SELECT 'shielded', public.get_pipeline_pulse(5);
SELECT public.t_assert((SELECT jsonb_path_query_array(sh.j, '$.organs.observations[0 to 2]') = jsonb_path_query_array(f.j, '$.organs.observations[0 to 2]')
    FROM public.t_readings sh, public.t_readings f WHERE sh.label = 'shielded' AND f.label = 'first'),
  'shielded: the older observation days still answer from memory');
SELECT public.t_assert((SELECT j -> 'organs' -> 'observations' -> 4 ->> 'status' = 'unavailable'
    AND j -> 'organs' -> 'observations' -> 4 ->> 'reason' = 'query_unavailable_57014' FROM public.t_readings WHERE label = 'shielded'),
  'shielded: the open day, counted live, reports the cancellation');
SELECT public.t_assert((SELECT j::text NOT LIKE '%PRIVATE_ERROR_MARKER%' FROM public.t_readings WHERE label = 'shielded'), 'shielded: no server error text leaks');
ALTER TABLE public.vehicle_observations DISABLE ROW LEVEL SECURITY;
DROP POLICY t_cancel_all ON public.vehicle_observations;
ALTER FUNCTION public.get_pipeline_pulse(integer) OWNER TO CURRENT_USER;
DROP POLICY t_reader_memory ON public.pipeline_pulse_day_counts;

-- 6. An untrusted row (an exact count stored before its day had ended an hour) is ignored and replaced.
DELETE FROM public.pipeline_pulse_day_counts WHERE organ = 'vehicles' AND day = (statement_timestamp() AT TIME ZONE 'UTC')::date - 3;
INSERT INTO public.pipeline_pulse_day_counts (organ, day, n, counted_at)
  VALUES ('vehicles', (statement_timestamp() AT TIME ZONE 'UTC')::date - 3, 99, public.t_day(-3, 12));
INSERT INTO public.t_readings SELECT 'stale', public.get_pipeline_pulse(5);
SELECT public.t_assert((SELECT (j -> 'organs' -> 'vehicles' -> 1 ->> 'n')::int = 4 FROM public.t_readings WHERE label = 'stale'),
  'an untrusted stored count is ignored and the day counted again');
SELECT public.t_assert((SELECT n = 4 AND counted_at > public.t_day(-3, 13) FROM public.pipeline_pulse_day_counts
  WHERE organ = 'vehicles' AND day = (statement_timestamp() AT TIME ZONE 'UTC')::date - 3), 'and the untrusted row is replaced by the trusted count');

-- 7. A stored cap is a fact: it is not recounted, even if the rows later go away.
INSERT INTO public.vehicles (created_at) SELECT public.t_day(0, 0) + interval '1 second' FROM generate_series(1, 10001);
INSERT INTO public.t_readings SELECT 'today_capped', public.get_pipeline_pulse(1);
SELECT public.t_assert((SELECT j -> 'organs' -> 'vehicles' -> 0 ->> 'status' = 'capped' AND (j -> 'organs' -> 'vehicles' -> 0 ->> 'lower_bound')::int = 10001
  FROM public.t_readings WHERE label = 'today_capped'), 'today reaches the cap and says so');
SELECT public.t_assert(EXISTS (SELECT FROM public.pipeline_pulse_day_counts WHERE organ = 'vehicles' AND day = (statement_timestamp() AT TIME ZONE 'UTC')::date AND n = 10001),
  'and the cap is stored for the open day');
DELETE FROM public.vehicles WHERE created_at = public.t_day(0, 0) + interval '1 second';
INSERT INTO public.t_readings SELECT 'today_after_delete', public.get_pipeline_pulse(1);
SELECT public.t_assert((SELECT j -> 'organs' -> 'vehicles' -> 0 ->> 'status' = 'capped' FROM public.t_readings WHERE label = 'today_after_delete'),
  'a stored cap is not recounted');

-- 8. The API roles still execute it, write nothing directly, and a call by anon is what stores.
TRUNCATE public.pipeline_pulse_day_counts;
SET ROLE anon;
DO $$ BEGIN
  ASSERT public.get_pipeline_pulse(5) -> 'coverage' ->> 'contract' = 'pipeline_pulse_capped_v1', 'anon executes the pulse';
  BEGIN PERFORM 1 FROM public.pipeline_pulse_day_counts; RAISE EXCEPTION 'anon read the memory table';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO public.pipeline_pulse_day_counts VALUES ('vehicles', current_date, 1, now()); RAISE EXCEPTION 'anon wrote the memory table';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT public.t_assert((SELECT count(*) FROM public.pipeline_pulse_day_counts) > 0, 'a call by anon stores through the definer');
SET ROLE authenticated;
DO $$ BEGIN
  ASSERT public.get_pipeline_pulse(5) -> 'coverage' -> 'memo' ->> 'days_served_from_memory' <> '0', 'authenticated is served from what anon stored';
  BEGIN PERFORM 1 FROM public.pipeline_pulse_day_counts; RAISE EXCEPTION 'authenticated read the memory table';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ DECLARE days integer; BEGIN
  FOREACH days IN ARRAY ARRAY[NULL, 0, -1, 32, 2147483647] LOOP
    BEGIN PERFORM public.get_pipeline_pulse(days); RAISE EXCEPTION 'invalid scope admitted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  END LOOP;
END $$;

-- 9. Without the memory table, or with it unwritable, the answer is the live count, the same one.
INSERT INTO public.t_readings SELECT 'with_table', public.get_pipeline_pulse(5);
ALTER TABLE public.pipeline_pulse_day_counts RENAME TO pipeline_pulse_day_counts_away;
INSERT INTO public.t_readings SELECT 'no_table', public.get_pipeline_pulse(5);
ALTER TABLE public.pipeline_pulse_day_counts_away RENAME TO pipeline_pulse_day_counts;
SELECT public.t_assert((SELECT public.t_core(a.j) = public.t_core(b.j) FROM public.t_readings a, public.t_readings b
  WHERE a.label = 'with_table' AND b.label = 'no_table'), 'no memory table: the same answer, counted live');
SELECT public.t_assert((SELECT (j -> 'coverage' -> 'memo' ->> 'days_served_from_memory')::int = 0
  AND (j -> 'coverage' -> 'memo' ->> 'days_stored_this_reading')::int = 0 FROM public.t_readings WHERE label = 'no_table'),
  'and it says nothing came from memory');

-- 10. A second run of the migration passes its guard; a drifted source stops it and is left as found.
\ir ../migrations/20261014040200_pipeline_pulse_remembers_counted_days.sql
CREATE OR REPLACE FUNCTION public.get_pipeline_pulse(p_days integer DEFAULT 14) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
  AS $f$ SELECT '{"drifted":true}'::jsonb $f$;
\echo 'Expected: the source guard ERROR below, then the aborted transaction ignoring the rest of the file.'
\set ON_ERROR_STOP off
\ir ../migrations/20261014040200_pipeline_pulse_remembers_counted_days.sql
\set ON_ERROR_STOP on
SELECT public.t_assert(public.get_pipeline_pulse(1) = '{"drifted":true}'::jsonb, 'a drifted function is not replaced');
SELECT 'pipeline pulse memory contract: PASS' AS result;

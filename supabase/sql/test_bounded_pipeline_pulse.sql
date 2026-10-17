-- Empty disposable PG17 database only; never run this fixture in production.
\set ON_ERROR_STOP on
SET timezone='UTC';
SET statement_timeout='15s';
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_pulse_bounded_%'
   OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
   OR to_regclass('public.vehicles') IS NOT NULL OR to_regnamespace('auth') IS NOT NULL THEN
  RAISE EXCEPTION 'Requires empty disposable dm_pulse_bounded_* PG17 database';
 END IF;
END $$;
CREATE TABLE public.vehicles(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,created_at timestamptz);
CREATE TABLE public.vehicle_images(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,vehicle_id bigint,
 created_at timestamptz,updated_at timestamptz,ai_processing_status text);
CREATE TABLE public.vehicle_observations(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,ingested_at timestamptz);
CREATE TABLE public.auction_comments(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,created_at timestamptz);
CREATE TABLE public.import_queue(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,status text);
CREATE INDEX fixture_vehicles_time ON public.vehicles(created_at);
CREATE INDEX fixture_observations_time ON public.vehicle_observations(ingested_at);
CREATE INDEX fixture_comments_time ON public.auction_comments(created_at DESC);
-- Match the measured misleading live name: timestamp is the SECOND key.
CREATE INDEX idx_vehicle_images_created_at ON public.vehicle_images(vehicle_id,created_at DESC);
CREATE INDEX fixture_images_pending ON public.vehicle_images(ai_processing_status,created_at)
 WHERE ai_processing_status='pending';
CREATE INDEX fixture_images_failed ON public.vehicle_images(ai_processing_status,updated_at)
 WHERE ai_processing_status IN ('processing','failed');
CREATE INDEX fixture_import_status ON public.import_queue(status);
\ir ../migrations/20260702003000_pulse_timeout_fix_and_heartbeat_hardening.sql
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon;
GRANT EXECUTE ON FUNCTION public.get_pipeline_pulse(integer) TO anon;
CREATE TEMP TABLE original_contract AS
SELECT proowner,proacl,prosecdef,proargdefaults::text FROM pg_proc
WHERE oid='public.get_pipeline_pulse(integer)'::regprocedure;
\ir ../migrations/20261005015418_bound_pipeline_pulse_daily_counts.sql
\ir ../migrations/20261005015418_bound_pipeline_pulse_daily_counts.sql
-- Set pulse_fairness_control only to prove the deployed reader fails the new
-- admission-order regression. Normal CI tests the new migration twice.
\if :{?pulse_fairness_control}
\else
\ir ../migrations/20261005072000_prioritize_recent_pipeline_readings.sql
\ir ../migrations/20261005072000_prioritize_recent_pipeline_readings.sql
\endif
BEGIN;
CREATE TEMP TABLE checks(label text);
CREATE FUNCTION pg_temp.check(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN ASSERT ok IS TRUE,label; INSERT INTO checks VALUES(label); END $$;
CREATE TEMP TABLE readings AS SELECT public.get_pipeline_pulse(2) value;
CREATE FUNCTION pg_temp.point(organ text,offset_days integer) RETURNS jsonb LANGUAGE sql AS $$
 SELECT point FROM readings r CROSS JOIN LATERAL jsonb_array_elements(r.value->'organs'->organ) point
 WHERE point->>'d'=((statement_timestamp() AT TIME ZONE 'UTC')::date-offset_days)::text
$$;
SELECT pg_temp.check((SELECT ROW(p.proowner,p.proacl,p.prosecdef,p.proargdefaults::text)
 IS NOT DISTINCT FROM ROW(o.proowner,o.proacl,o.prosecdef,o.proargdefaults)
 FROM pg_proc p CROSS JOIN original_contract o WHERE p.oid='public.get_pipeline_pulse(integer)'::regprocedure),
 'signature default owner security and existing grants preserved');
SELECT pg_temp.check((SELECT p.provolatile='s' AND p.proconfig @> ARRAY['search_path=public','statement_timeout=8s','lock_timeout=500ms']
 FROM pg_proc p WHERE p.oid='public.get_pipeline_pulse(integer)'::regprocedure),
 'same-statement snapshot and finite timeout settings');
SELECT pg_temp.check(pg_temp.point('vehicles',1)->>'n'='0'
 AND pg_temp.point('vehicles',1)->>'status'='exact','measured zero is exact zero');
SELECT pg_temp.check((SELECT bool_and(
 series.value->0->>'d'=((statement_timestamp() AT TIME ZONE 'UTC')::date-1)::text
 AND series.value->1->>'d'=((statement_timestamp() AT TIME ZONE 'UTC')::date)::text)
 FROM readings r CROSS JOIN LATERAL jsonb_each(r.value->'organs') series),
 'newest-first admission retains ascending UTC day output for every organ');
CREATE TEMP TABLE pg_index AS SELECT * FROM pg_catalog.pg_index WITH NO DATA;
UPDATE readings SET value=public.get_pipeline_pulse(2);
SELECT pg_temp.check(pg_temp.point('vehicles',1)->>'status'='exact',
 'caller temporary relations cannot shadow the catalog index gate');
DROP TABLE pg_temp.pg_index;
SELECT pg_temp.check(pg_temp.point('images',1)->'n'='null'::jsonb
 AND pg_temp.point('images',1)->>'status'='unavailable'
 AND pg_temp.point('images',1)->>'reason'='missing_supported_time_index',
 'composite second-key timestamp cannot authorize an unbounded image scan');
SELECT pg_temp.check((SELECT value->'backlogs'->>'images_analysis_pending_capped'='0'
 AND value->'backlogs'->>'images_analysis_failed_capped'='0' FROM readings),
 'measured supported partial status indexes retain image backlogs');
CREATE INDEX fixture_images_partial_time ON public.vehicle_images(created_at) WHERE ai_processing_status='pending';
UPDATE readings SET value=public.get_pipeline_pulse(2);
SELECT pg_temp.check(pg_temp.point('images',1)->>'status'='unavailable',
 'a partial time index cannot support the all-images daily scope');
CREATE INDEX fixture_images_full_time ON public.vehicle_images(created_at);
UPDATE readings SET value=public.get_pipeline_pulse(2);
SELECT pg_temp.check(pg_temp.point('images',1)->>'status'='exact' AND pg_temp.point('images',1)->>'n'='0',
 'existing valid full leading-time index enables exact image scope');
DROP INDEX fixture_images_full_time;

INSERT INTO public.vehicles(created_at)
SELECT (date_trunc('day',statement_timestamp() AT TIME ZONE 'UTC')-interval '12 hours') AT TIME ZONE 'UTC'
FROM generate_series(1,10001);
INSERT INTO public.vehicles(created_at) VALUES(statement_timestamp()+interval '2 days');
INSERT INTO public.vehicle_observations(ingested_at)
VALUES((date_trunc('day',statement_timestamp() AT TIME ZONE 'UTC')-interval '12 hours') AT TIME ZONE 'UTC');
INSERT INTO public.auction_comments(created_at)
VALUES((date_trunc('day',statement_timestamp() AT TIME ZONE 'UTC')-interval '12 hours') AT TIME ZONE 'UTC');
UPDATE readings SET value=public.get_pipeline_pulse(2);
SELECT pg_temp.check(pg_temp.point('vehicles',1)->>'status'='capped'
 AND pg_temp.point('vehicles',1)->'n'='null'::jsonb
 AND pg_temp.point('vehicles',1)->>'lower_bound'='10001',
 '10001 matching rows is an explicit lower bound never an exact count');
SELECT pg_temp.check(pg_temp.point('vehicles',0)->>'n'='0',
 'future arrival timestamps are excluded by the as-of boundary');
DELETE FROM public.vehicles WHERE id=(SELECT min(id) FROM public.vehicles);
UPDATE readings SET value=public.get_pipeline_pulse(2);
SELECT pg_temp.check(pg_temp.point('vehicles',1)->>'n'='10000'
 AND pg_temp.point('vehicles',1)->>'status'='exact'
 AND pg_temp.point('vehicles',1)->'lower_bound'='null'::jsonb,
 'exactly 10000 matches remain exact');
INSERT INTO public.import_queue(status) SELECT 'pending' FROM generate_series(1,10001);
INSERT INTO public.vehicle_images(ai_processing_status) SELECT 'pending' FROM generate_series(1,10001);
UPDATE readings SET value=public.get_pipeline_pulse(2);
SELECT pg_temp.check((SELECT value->'backlogs'->'import_queue_pending'='null'::jsonb
 AND value->'coverage'->'backlogs'->'import_queue_pending'->>'lower_bound'='10001'
 AND value->'coverage'->'backlogs'->'import_queue_pending'->>'status'='capped' FROM readings),
 'formerly unbounded import backlog is not mislabeled exact at the cap');
SELECT pg_temp.check((SELECT value->'backlogs'->>'images_analysis_pending_capped'='10001'
 AND value->'coverage'->'backlogs'->'images_analysis_pending_capped'->'n'='null'::jsonb
 AND value->'coverage'->'backlogs'->'images_analysis_pending_capped'->>'status'='capped' FROM readings),
 'explicit legacy capped image key remains compatible with new exactness metadata');
SET LOCAL timezone='America/Los_Angeles';
UPDATE readings SET value=public.get_pipeline_pulse(2);
SELECT pg_temp.check((SELECT value->'coverage'->>'timezone'='UTC'
 AND (value->>'since')::timestamptz=(date_trunc('day',statement_timestamp() AT TIME ZONE 'UTC')-interval '1 day') AT TIME ZONE 'UTC'
 FROM readings),'UTC day scope independent of session timezone');
SELECT pg_temp.check(jsonb_array_length(public.get_pipeline_pulse(31)->'organs'->'vehicles')=31
 AND jsonb_array_length(public.get_pipeline_pulse()->'organs'->'vehicles')=14,
 'maximum and default requested scopes have explicit dense day coverage');
DO $$ DECLARE days integer; BEGIN
 FOREACH days IN ARRAY ARRAY[NULL,0,-1,32,2147483647] LOOP
  BEGIN
   PERFORM public.get_pipeline_pulse(days);
   RAISE EXCEPTION 'invalid scope admitted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 END LOOP;
END $$;
SELECT pg_temp.check(true,'invalid scope rejected before a data query');
SET LOCAL ROLE anon;
DO $$ BEGIN
 ASSERT public.get_pipeline_pulse(1)->'coverage'->>'contract'='pipeline_pulse_capped_v1';
END $$;
RESET ROLE;

-- Deterministically raise QUERY_CANCELED from an actual data read via RLS.
-- This exception is not caught by WHEN OTHERS alone. The other organ's output
-- must survive and raw server error text must not enter the public receipt.
CREATE ROLE dm_pulse_fixture_reader NOLOGIN;
GRANT USAGE ON SCHEMA public TO dm_pulse_fixture_reader;
GRANT SELECT ON public.vehicles,public.vehicle_images,public.vehicle_observations,
 public.auction_comments,public.import_queue TO dm_pulse_fixture_reader;
CREATE FUNCTION public.fixture_pulse_cancel() RETURNS boolean LANGUAGE plpgsql STABLE AS $$
BEGIN RAISE EXCEPTION 'PRIVATE_ERROR_MARKER' USING ERRCODE='57014'; END $$;
ALTER TABLE public.vehicle_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_cancel ON public.vehicle_observations USING(public.fixture_pulse_cancel());
ALTER FUNCTION public.get_pipeline_pulse(integer) OWNER TO dm_pulse_fixture_reader;
UPDATE readings SET value=public.get_pipeline_pulse(2);
SELECT pg_temp.check(pg_temp.point('observations',1)->'n'='null'::jsonb
 AND pg_temp.point('observations',1)->>'status'='unavailable'
 AND pg_temp.point('observations',1)->>'reason'='query_unavailable_57014',
 'query cancellation becomes explicit unavailable rather than abort or fabricated zero');
SELECT pg_temp.check(pg_temp.point('auction_comments',1)->>'n'='1'
 AND pg_temp.point('auction_comments',1)->>'status'='exact',
 'a failed organ retains independently measured other-organ evidence');
SELECT pg_temp.check((SELECT value::text NOT LIKE '%PRIVATE_ERROR_MARKER%' FROM readings),
 'public degradation includes safe SQLSTATE only');

-- One old vehicle row consumes the real six-second admission budget. Force
-- indexed access in this tiny fixture so RLS delays only a matching day, not
-- rows a sequential plan would inspect and later filter. No fake clock/body.
TRUNCATE public.vehicles,public.vehicle_observations,public.auction_comments;
DROP POLICY fixture_cancel ON public.vehicle_observations;
CREATE POLICY fixture_read ON public.vehicle_observations USING(true);
INSERT INTO public.vehicles(created_at)
VALUES((date_trunc('day',statement_timestamp() AT TIME ZONE 'UTC')-interval '12 hours') AT TIME ZONE 'UTC');
INSERT INTO public.vehicle_observations(ingested_at) VALUES(statement_timestamp());
INSERT INTO public.auction_comments(created_at) VALUES(statement_timestamp());
CREATE FUNCTION public.fixture_old_day_delay(at_time timestamptz) RETURNS boolean LANGUAGE plpgsql VOLATILE AS $$
BEGIN
 IF at_time < date_trunc('day',statement_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' THEN
  PERFORM pg_sleep(6.1);
 END IF;
 RETURN true;
END $$;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_old_day_delay ON public.vehicles USING(public.fixture_old_day_delay(created_at));
SET LOCAL enable_seqscan=off;
UPDATE readings SET value=public.get_pipeline_pulse(3);
SELECT pg_temp.check(pg_temp.point('observations',0)->>'n'='1'
 AND pg_temp.point('auction_comments',0)->>'n'='1'
 AND pg_temp.point('vehicles',0)->>'n'='0',
 'newest readings across streams survive slow historical vehicle work');
SELECT pg_temp.check((SELECT value->'coverage'->'backlogs'->'import_queue_pending'->>'status'='capped'
 AND value->'coverage'->'backlogs'->'images_analysis_pending_capped'->>'status'='capped'
 AND value->'coverage'->'backlogs'->'images_analysis_failed_capped'->>'status'='exact' FROM readings),
 'all supported current backlogs are admitted before historical work');
SELECT pg_temp.check(pg_temp.point('observations',1)->>'reason'='reading_budget_exhausted'
 AND pg_temp.point('observations',1)->'n'='null'::jsonb
 AND pg_temp.point('vehicles',2)->>'reason'='reading_budget_exhausted',
 'skipped history remains explicitly unavailable after admission budget exhaustion');
SELECT pg_temp.check((SELECT value->'coverage'->'organs'->'observations'->>'status'='unavailable'
 AND jsonb_array_length(value->'organs'->'observations')=3
 AND value->'organs'->'observations'->0->>'d'=((statement_timestamp() AT TIME ZONE 'UTC')::date-2)::text
 AND value->'organs'->'observations'->2->>'d'=((statement_timestamp() AT TIME ZONE 'UTC')::date)::text FROM readings),
 'mixed recent success and unavailable history retain dense ascending dates and aggregate coverage');
SELECT count(*) AS bounded_pulse_checks_passed FROM checks;
ROLLBACK;

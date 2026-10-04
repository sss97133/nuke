-- Actual old and replacement functions in an empty disposable PG17 database.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_market_delta%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_market_delta* PG17 database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.vehicles(id uuid PRIMARY KEY);
\ir ../migrations/20260523080300_vehicle_market_estimates_timeseries.sql
-- Match current production RLS: no client policy admits stored estimates.
ALTER TABLE public.vehicle_market_estimates ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.vehicle_market_estimates TO service_role;
CREATE POLICY service_estimate_fixture ON public.vehicle_market_estimates
  FOR SELECT TO service_role USING(true);
CREATE TEMP TABLE previous_function AS
 SELECT proacl::text acl,prosecdef definer,proconfig config
 FROM pg_proc WHERE oid='public.market_value_delta(uuid,date,date)'::regprocedure;
\ir ../migrations/20261004103000_market_value_delta_unknown.sql

CREATE FUNCTION pg_temp.assert_true(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; END $$;
SELECT pg_temp.assert_true((SELECT p.proacl::text IS NOT DISTINCT FROM b.acl
  AND p.prosecdef IS NOT DISTINCT FROM b.definer AND p.proconfig IS NOT DISTINCT FROM b.config
  FROM pg_proc p CROSS JOIN previous_function b
  WHERE p.oid='public.market_value_delta(uuid,date,date)'::regprocedure),
  'Existing invoker, configuration and function grants preserved');
INSERT INTO public.vehicles VALUES('00000000-0000-4000-8000-000000000001');
INSERT INTO public.vehicle_market_estimates(vehicle_id,estimated_at,value_mid,currency) VALUES
 ('00000000-0000-4000-8000-000000000001','2026-01-01T12:00Z',100,'USD'),
 ('00000000-0000-4000-8000-000000000001','2026-02-01T12:00Z',150,'USD'),
 ('00000000-0000-4000-8000-000000000001','2026-03-01T12:00Z',0,'USD');
SET TIME ZONE 'UTC';
SET ROLE service_role;
SELECT pg_temp.assert_true(public.market_value_delta('00000000-0000-4000-8000-000000000002','2026-01-01','2026-02-01')
 @> '{"value_before":null,"value_after":null,"delta":null,"has_data":false}',
 'No estimates remains unknown');
SELECT pg_temp.assert_true(public.market_value_delta('00000000-0000-4000-8000-000000000001','2025-12-31','2026-02-01')
 @> '{"value_before":null,"value_after":150,"delta":null,"has_data":false}',
 'Missing baseline does not invent appreciation');
SELECT pg_temp.assert_true(public.market_value_delta('00000000-0000-4000-8000-000000000001','2026-02-01',NULL)
 @> '{"value_before":150,"value_after":null,"delta":null,"has_data":false}',
 'Missing end date does not invent depreciation');
SELECT pg_temp.assert_true(public.market_value_delta('00000000-0000-4000-8000-000000000001','2026-01-01','2026-02-01')
 @> '{"value_before":100,"value_after":150,"delta":50,"has_data":true}',
 'Known dated estimates retain genuine change');
SELECT pg_temp.assert_true(public.market_value_delta('00000000-0000-4000-8000-000000000001','2026-03-01','2026-03-02')
 @> '{"value_before":0,"value_after":0,"delta":0,"has_data":true}',
 'An explicitly recorded zero stays known');
SET ROLE anon;
SELECT pg_temp.assert_true(public.market_value_delta('00000000-0000-4000-8000-000000000001','2026-01-01','2026-02-01')
 @> '{"value_before":null,"value_after":null,"delta":null,"has_data":false}',
 'Anonymous unavailable estimates remain unknown under existing RLS');
SET ROLE authenticated;
SELECT pg_temp.assert_true(public.market_value_delta('00000000-0000-4000-8000-000000000001','2026-01-01','2026-02-01')
 @> '{"value_before":null,"value_after":null,"delta":null,"has_data":false}',
 'Authenticated unavailable estimates remain unknown under existing RLS');
RESET ROLE;
SELECT 'PASS: 8 actual PostgreSQL unknown/known value-delta and access contracts' result;

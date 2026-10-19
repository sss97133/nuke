-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_testimony_summary -f this-file.sql
-- Contract for 20261016141000_vehicle_testimony_summary.sql. Synthetic rows only; never production.
-- A public vehicle holds 1,500 current observations of three kinds (more than the API's 1,000-row cut), 40 superseded
-- ones dated outside them, and 20 valuation rows that only its owner may read; a private vehicle holds 30. Requires:
-- a visitor counts the public vehicle's 1,500 readable rows by kind, with their first and last observed times, and
-- nothing of the private vehicle; a signed-in stranger counts the same as a visitor; the owner also counts the
-- valuation rows and their dates; superseded rows never count; by_kind sums to total; an unknown vehicle reads zeros;
-- the reader runs as its caller (no definer rights); PUBLIC cannot execute it and anon can; a second apply is a no-op.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_observations') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

-- The shapes the reader and production's visitor read policy touch (pg_policies, 2026-10-15).
CREATE TYPE public.observation_kind AS ENUM ('listing', 'sale_result', 'comment', 'bid', 'sighting', 'work_record',
  'ownership', 'specification', 'provenance', 'valuation', 'condition', 'media', 'social_mention', 'expert_opinion',
  'splice', 'activity', 'offer');
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, is_public boolean, user_id uuid, owner_id uuid, uploaded_by uuid);
CREATE TABLE public.vehicle_observations (id bigserial PRIMARY KEY, vehicle_id uuid, kind public.observation_kind NOT NULL,
  observed_at timestamptz NOT NULL, is_superseded boolean, structured_data jsonb);
-- Stand-in for production's observation_is_public: here valuation rows are owner-only.
CREATE FUNCTION public.observation_is_public(p_kind public.observation_kind, p_data jsonb) RETURNS boolean
  LANGUAGE sql IMMUTABLE AS $$ SELECT p_kind <> 'valuation' $$;
ALTER TABLE public.vehicle_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY vo_authenticated_read ON public.vehicle_observations FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vehicle_observations.vehicle_id
    AND (v.user_id = (SELECT auth.uid()) OR v.owner_id = (SELECT auth.uid()) OR v.uploaded_by = (SELECT auth.uid())
         OR (v.is_public = true AND public.observation_is_public(vehicle_observations.kind, vehicle_observations.structured_data)))));
GRANT SELECT ON public.vehicles, public.vehicle_observations TO anon, authenticated;

INSERT INTO public.vehicles (id, is_public, user_id) VALUES
  ('00000000-0000-4000-8000-0000000000a1', true, '00000000-0000-4000-9000-000000000001'),
  ('00000000-0000-4000-8000-0000000000b2', false, '00000000-0000-4000-9000-000000000002');
INSERT INTO public.vehicle_observations (vehicle_id, kind, observed_at, is_superseded)
  SELECT '00000000-0000-4000-8000-0000000000a1'::uuid, 'specification'::public.observation_kind, '2016-04-23 17:44:41+00'::timestamptz + i * interval '1 hour', false
  FROM generate_series(0, 699) i
  UNION ALL
  SELECT '00000000-0000-4000-8000-0000000000a1'::uuid, 'condition'::public.observation_kind, '2020-01-01 00:00:00+00'::timestamptz + i * interval '1 hour', false
  FROM generate_series(0, 499) i
  UNION ALL
  SELECT '00000000-0000-4000-8000-0000000000a1'::uuid, 'media'::public.observation_kind, '2026-10-14 07:25:40+00'::timestamptz - i * interval '1 hour', false
  FROM generate_series(0, 299) i
  UNION ALL
  SELECT '00000000-0000-4000-8000-0000000000a1'::uuid, 'media'::public.observation_kind,
         CASE WHEN i % 2 = 0 THEN '2010-01-01 00:00:00+00'::timestamptz ELSE '2030-01-01 00:00:00+00'::timestamptz END, true
  FROM generate_series(1, 40) i
  UNION ALL
  SELECT '00000000-0000-4000-8000-0000000000a1'::uuid, 'valuation'::public.observation_kind,
         CASE WHEN i % 2 = 0 THEN '2009-06-01 00:00:00+00'::timestamptz ELSE '2031-01-01 00:00:00+00'::timestamptz END, false
  FROM generate_series(1, 20) i
  UNION ALL
  SELECT '00000000-0000-4000-8000-0000000000b2'::uuid, 'condition'::public.observation_kind, '2024-01-01 00:00:00+00'::timestamptz + i * interval '1 day', false
  FROM generate_series(1, 30) i;

\ir ../migrations/20261016141000_vehicle_testimony_summary.sql
\ir ../migrations/20261016141000_vehicle_testimony_summary.sql

SET ROLE anon;
SET test.auth_uid = '';
SELECT public.vehicle_testimony_summary('00000000-0000-4000-8000-0000000000a1')::text AS anon_public,
       public.vehicle_testimony_summary('00000000-0000-4000-8000-0000000000b2')::text AS anon_private,
       public.vehicle_testimony_summary('00000000-0000-4000-8000-0000000000ff')::text AS anon_unknown \gset
RESET ROLE;
SET ROLE authenticated;
SET test.auth_uid = '00000000-0000-4000-9000-000000000002';
SELECT public.vehicle_testimony_summary('00000000-0000-4000-8000-0000000000a1')::text AS stranger_public \gset
RESET ROLE;
SET ROLE authenticated;
SET test.auth_uid = '00000000-0000-4000-9000-000000000001';
SELECT public.vehicle_testimony_summary('00000000-0000-4000-8000-0000000000a1')::text AS owner_public \gset
RESET ROLE;
SET test.auth_uid = '';

SELECT pg_temp.ok('a visitor counts all 1,500 readable current rows by kind, past the API''s 1,000-row cut',
  (:'anon_public')::jsonb->'total' = '1500'::jsonb
  AND (:'anon_public')::jsonb->'by_kind' = '{"specification": 700, "condition": 500, "media": 300}'::jsonb);
SELECT pg_temp.ok('a visitor''s first and last observed come from those rows, not the superseded or owner-only ones',
  ((:'anon_public')::jsonb->>'first_observed')::timestamptz = '2016-04-23 17:44:41+00'
  AND ((:'anon_public')::jsonb->>'last_observed')::timestamptz = '2026-10-14 07:25:40+00');
SELECT pg_temp.ok('a visitor reads nothing of a private vehicle, and an unknown vehicle reads zeros',
  (:'anon_private')::jsonb = '{"total": 0, "by_kind": {}, "first_observed": null, "last_observed": null}'::jsonb
  AND (:'anon_unknown')::jsonb = '{"total": 0, "by_kind": {}, "first_observed": null, "last_observed": null}'::jsonb);
SELECT pg_temp.ok('a signed-in stranger counts what a visitor counts',
  (:'stranger_public')::jsonb = (:'anon_public')::jsonb);
SELECT pg_temp.ok('the owner also counts their owner-only rows and their dates; superseded rows still never count',
  (:'owner_public')::jsonb->'total' = '1520'::jsonb
  AND (:'owner_public')::jsonb->'by_kind' = '{"specification": 700, "condition": 500, "media": 300, "valuation": 20}'::jsonb
  AND ((:'owner_public')::jsonb->>'first_observed')::timestamptz = '2009-06-01 00:00:00+00'
  AND ((:'owner_public')::jsonb->>'last_observed')::timestamptz = '2031-01-01 00:00:00+00');
SELECT pg_temp.ok('by_kind sums to total for every reader',
  NOT EXISTS (SELECT 1 FROM (VALUES (:'anon_public'), (:'stranger_public'), (:'owner_public'), (:'anon_private')) r(s)
              WHERE (s::jsonb->>'total')::bigint
                    <> coalesce((SELECT sum(value::bigint) FROM jsonb_each_text(s::jsonb->'by_kind')), 0)));
SELECT pg_temp.ok('the reader runs as its caller, so row security decides what it counts',
  (SELECT NOT prosecdef FROM pg_proc WHERE oid = 'public.vehicle_testimony_summary(uuid)'::regprocedure));
SELECT pg_temp.ok('PUBLIC cannot execute the reader; anon and authenticated can',
  NOT has_function_privilege('public', 'public.vehicle_testimony_summary(uuid)', 'execute')
  AND has_function_privilege('anon', 'public.vehicle_testimony_summary(uuid)', 'execute')
  AND has_function_privilege('authenticated', 'public.vehicle_testimony_summary(uuid)', 'execute'));

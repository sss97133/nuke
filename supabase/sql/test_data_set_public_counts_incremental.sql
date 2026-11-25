-- Contract for 20261124193500_data_set_public_counts_incremental (empty disposable PG17; fixtures synthetic).
-- Asserts: one set's count is distinct public undeleted vehicles among active vehicle / auction_comment members; a run
-- counts sets with memberships landed since the watermark, then sets never counted, then a bounded rotation; the
-- watermark advances; a vehicle turning private is reflected when its set rotates; only the service role runs it.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regclass('public.vehicles') IS NOT NULL THEN RAISE EXCEPTION 'Requires an empty disposable database'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, is_public boolean, deleted_at timestamptz);
CREATE TABLE public.data_sets (id uuid PRIMARY KEY, set_kind text);
CREATE TABLE public.data_set_members (id bigserial PRIMARY KEY, set_id uuid REFERENCES public.data_sets(id), member_type text,
  member_id uuid, vehicle_id uuid, state text);
CREATE TABLE public.data_set_public_counts (set_id uuid PRIMARY KEY REFERENCES public.data_sets(id), public_vehicles integer, counted_at timestamptz);
CREATE TABLE public.platform_config (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), config_key text UNIQUE NOT NULL,
  config_value jsonb NOT NULL, description text, updated_at timestamptz DEFAULT now(), updated_by text);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

INSERT INTO public.vehicles VALUES
 ('10000000-0000-0000-0000-000000000001', true, NULL), ('10000000-0000-0000-0000-000000000002', true, NULL),
 ('10000000-0000-0000-0000-000000000003', false, NULL), ('10000000-0000-0000-0000-000000000004', true, now());
INSERT INTO public.data_sets VALUES ('d0000000-0000-0000-0000-000000000001', 'trans_type'),
 ('d0000000-0000-0000-0000-000000000002', 'trans_type'), ('d0000000-0000-0000-0000-000000000003', 'paint_code');
INSERT INTO public.data_set_members (set_id, member_type, member_id, vehicle_id, state) VALUES
 -- set 1: vehicle 1 twice (two spans), vehicle 2 once by a comment, a private car, a deleted car, a superseded row
 ('d0000000-0000-0000-0000-000000000001', 'vehicle', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'active'),
 ('d0000000-0000-0000-0000-000000000001', 'vehicle', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'active'),
 ('d0000000-0000-0000-0000-000000000001', 'auction_comment', gen_random_uuid(), '10000000-0000-0000-0000-000000000002', 'active'),
 ('d0000000-0000-0000-0000-000000000001', 'vehicle', '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 'active'),
 ('d0000000-0000-0000-0000-000000000001', 'vehicle', '10000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000004', 'active'),
 ('d0000000-0000-0000-0000-000000000002', 'vehicle', '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'superseded'),
 ('d0000000-0000-0000-0000-000000000002', 'image', gen_random_uuid(), '10000000-0000-0000-0000-000000000001', 'active');

\ir ../migrations/20261124193500_data_set_public_counts_incremental.sql
\ir ../migrations/20261124193500_data_set_public_counts_incremental.sql

DO $$
DECLARE r jsonb; c jsonb;
BEGIN
  ASSERT public.data_set_public_count_one('d0000000-0000-0000-0000-000000000001') = 2, 'two public undeleted vehicles';
  ASSERT public.data_set_public_count_one('d0000000-0000-0000-0000-000000000002') = 0, 'superseded and image members do not count';
  DELETE FROM public.data_set_public_counts;

  r := public.data_set_public_counts_refresh_v2(60000, 0);
  ASSERT (r->>'dirty_sets')::int = 0 AND (r->>'missing_sets')::int = 3 AND (r->>'rotated_sets')::int = 0,
    'first run: starts at the current top; all three sets never counted; got ' || r::text;
  ASSERT (SELECT count(*) FROM public.data_set_public_counts) = 3, 'every set has a row';
  SELECT config_value INTO c FROM public.platform_config WHERE config_key = 'data_set_public_counts';
  ASSERT (c->>'member_id_watermark')::bigint = (SELECT max(id) FROM public.data_set_members), 'watermark advanced';

  r := public.data_set_public_counts_refresh_v2(60000, 0);
  ASSERT (r->>'dirty_sets')::int = 0 AND (r->>'missing_sets')::int = 0, 'nothing new: nothing counted; got ' || r::text;

  INSERT INTO public.data_set_members (set_id, member_type, member_id, vehicle_id, state)
  VALUES ('d0000000-0000-0000-0000-000000000003', 'vehicle', '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'active');
  r := public.data_set_public_counts_refresh_v2(60000, 0);
  ASSERT (r->>'dirty_sets')::int = 1 AND (SELECT public_vehicles FROM public.data_set_public_counts WHERE set_id = 'd0000000-0000-0000-0000-000000000003') = 1,
    'a new membership recounts its set; got ' || r::text;

  -- a car turning private is caught by the rotation, two sets per run
  UPDATE public.vehicles SET is_public = false WHERE id = '10000000-0000-0000-0000-000000000001';
  r := public.data_set_public_counts_refresh_v2(60000, 2);
  ASSERT (r->>'rotated_sets')::int = 2, 'rotation bounded at two; got ' || r::text;
  ASSERT (SELECT public_vehicles FROM public.data_set_public_counts WHERE set_id = 'd0000000-0000-0000-0000-000000000001') = 1,
    'rotation reflects the private car';
  r := public.data_set_public_counts_refresh_v2(60000, 5);
  ASSERT (r->>'rotated_sets')::int = 4, 'the rotation wraps once per run (set 3, then 1, 2, 3); got ' || r::text;
END $$;

SET ROLE anon;
DO $$ BEGIN
  PERFORM public.data_set_public_counts_refresh_v2(1000, 0);
  RAISE EXCEPTION 'FAIL: anon ran the refresh';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;
\echo data_set_public_counts_incremental: ok

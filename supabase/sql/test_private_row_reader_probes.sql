-- Contract: 20261125124500. The exposure watch probes SECURITY DEFINER readers: a keyed reader is called with sampled
-- private keys as anon; a feed reader is called once and the private ids it returns are counted. Synthetic rows.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_%private_row_reader%' OR to_regclass('public.private_row_probes') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_*private_row_reader* database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub', '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE cron.job (jobname text PRIMARY KEY, schedule text, command text);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS
$$ INSERT INTO cron.job VALUES (n, s, c) ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command RETURNING 1 $$;

-- live shapes, reduced to the columns the probes read
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, is_public boolean NOT NULL, deleted_at timestamptz);
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY, vehicle_id uuid REFERENCES public.vehicles (id), analysis jsonb);
CREATE FUNCTION public.vehicle_image_gallery_eligible(vehicle_images) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE TABLE public.image_observations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), image_id uuid REFERENCES public.vehicle_images (id),
                                        observed_by text, is_active boolean);
INSERT INTO public.vehicles VALUES ('10000000-0000-0000-0000-000000000001', true, NULL), ('10000000-0000-0000-0000-000000000002', false, NULL);
INSERT INTO public.vehicle_images VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '{"line": "shown"}'),     -- public car
  ('20000000-0000-0000-0000-000000000002', NULL, '{"line": "unfiled"}'),                                      -- unfiled
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '{"line": "private car"}'); -- private car
INSERT INTO public.image_observations (image_id, observed_by, is_active) VALUES
  ('20000000-0000-0000-0000-000000000001', 'caller-byok', true), ('20000000-0000-0000-0000-000000000002', 'caller-byok', true),
  ('20000000-0000-0000-0000-000000000003', 'caller-byok', true), ('20000000-0000-0000-0000-000000000003', 'other', true);

-- the live defect: a definer reader that tests nothing about the caller
CREATE FUNCTION public.get_image_deep_analysis(p_image_id uuid) RETURNS TABLE (image_id uuid, line text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$ SELECT vi.id, vi.analysis->>'line' FROM public.vehicle_images vi WHERE vi.id = p_image_id $$;
CREATE FUNCTION public.intake_live_state(p_feed_limit integer, p_sessions_limit integer) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$ SELECT jsonb_build_object('feed', coalesce((SELECT jsonb_agg(jsonb_build_object('id', vi.id, 'vehicle_id', vi.vehicle_id))
                                                FROM (SELECT * FROM public.vehicle_images ORDER BY id LIMIT p_feed_limit) vi), '[]'),
                            'fleet', jsonb_build_array(jsonb_build_object('vehicle_id', '10000000-0000-0000-0000-000000000002'))) $$;
GRANT EXECUTE ON FUNCTION public.get_image_deep_analysis(uuid), public.intake_live_state(integer, integer) TO anon, authenticated;

\ir ../migrations/20261125100000_private_row_exposure_watch.sql
\ir ../migrations/20261125124500_private_row_reader_probes.sql
\ir ../migrations/20261125124500_private_row_reader_probes.sql

DO $$
DECLARE r jsonb; x jsonb; me text := current_user; bad boolean;
BEGIN
  IF (SELECT count(*) FROM public.private_row_probes WHERE reader <> '') <> 3
     OR (SELECT count(*) FROM public.private_row_probes WHERE reader = 'intake_live_state' AND active) <> 0 THEN
    RAISE EXCEPTION 'reader rows: % (intake active %)', (SELECT count(*) FROM public.private_row_probes WHERE reader <> ''),
      (SELECT count(*) FROM public.private_row_probes WHERE reader = 'intake_live_state' AND active); END IF;

  -- keyed reader: 2 private photos sampled (unfiled, private car; the public one is not private), each answered to anon
  r := public.assay_private_row_exposure();
  IF current_user <> me OR coalesce(current_setting('request.jwt.claims', true), '') <> '' THEN
    RAISE EXCEPTION 'role or claims leaked past the assay'; END IF;
  SELECT e INTO x FROM jsonb_array_elements(r->'relations') e WHERE e->>'relation' = 'get_image_deep_analysis()';
  IF x IS NULL OR (x->>'private_sampled')::int <> 2 OR (x#>>'{visible,anon}')::int <> 2 OR NOT (x->>'exposed')::boolean
     OR x->'visible' ? 'authenticated' THEN
    RAISE EXCEPTION 'keyed reader not seen exposed: %', x; END IF;
  IF NOT r->'exposed' ? 'get_image_deep_analysis()' THEN RAISE EXCEPTION 'exposed list: %', r->'exposed'; END IF;

  -- feed readers (switched on here): 2 of 3 feed photos are private; the fleet names 1 private car
  UPDATE public.private_row_probes SET active = true WHERE reader = 'intake_live_state';
  r := public.assay_private_row_exposure();
  SELECT e INTO x FROM jsonb_array_elements(r->'relations') e WHERE e->>'relation' = 'intake_live_state()' AND e->>'kind' = 'image';
  IF (x->>'private_sampled')::int <> 3 OR (x#>>'{visible,anon}')::int <> 2 THEN RAISE EXCEPTION 'feed image probe: %', x; END IF;
  SELECT e INTO x FROM jsonb_array_elements(r->'relations') e WHERE e->>'relation' = 'intake_live_state()' AND e->>'kind' = 'vehicle';
  IF (x->>'private_sampled')::int <> 1 OR (x#>>'{visible,anon}')::int <> 1 THEN RAISE EXCEPTION 'feed vehicle probe: %', x; END IF;

  -- the fix shapes clear them: a caller test in the keyed reader, anon EXECUTE revoked on the feed
  CREATE OR REPLACE FUNCTION public.get_image_deep_analysis(p_image_id uuid) RETURNS TABLE (image_id uuid, line text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
  $f$ SELECT vi.id, vi.analysis->>'line' FROM public.vehicle_images vi JOIN public.vehicles v ON v.id = vi.vehicle_id
       WHERE vi.id = p_image_id AND v.is_public AND v.deleted_at IS NULL $f$;
  REVOKE EXECUTE ON FUNCTION public.intake_live_state(integer, integer) FROM PUBLIC, anon, authenticated;
  r := public.assay_private_row_exposure();
  IF current_user <> me THEN RAISE EXCEPTION 'role leaked after a denied reader: %', current_user; END IF;
  SELECT bool_or((e->>'exposed')::boolean) INTO bad FROM jsonb_array_elements(r->'relations') e WHERE e->>'relation' LIKE '%()';
  IF bad THEN RAISE EXCEPTION 'fixed readers still exposed: %', r->'relations'; END IF;

  -- a missing reader is reported missing, not exposed
  DROP FUNCTION public.get_image_deep_analysis(uuid);
  r := public.assay_private_row_exposure();
  SELECT e INTO x FROM jsonb_array_elements(r->'relations') e WHERE e->>'relation' = 'get_image_deep_analysis()';
  IF NOT coalesce((x->>'missing')::boolean, false) THEN RAISE EXCEPTION 'dropped reader not missing: %', x; END IF;

  -- shape CHECKs
  BEGIN
    INSERT INTO public.private_row_probes (rank, relation, row_key, subject_kind, subject_column, reader, reader_args, reader_ids, owner_lane, note)
    VALUES (99, 'vehicles', 'id', 'vehicle', 'id', 'x', '1); select 1 --', '$[*]', 'test', 'injected argument list');
    RAISE EXCEPTION 'reader_args CHECK admitted SQL';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.private_row_probes (rank, relation, row_key, subject_kind, subject_column, reader, reader_args, owner_lane, note)
    VALUES (99, 'vehicles', 'id', 'vehicle', 'id', 'x', '1', 'test', 'args without an id path');
    RAISE EXCEPTION 'reader_args without reader_ids admitted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

SELECT 'private_row_reader_probes: ok';

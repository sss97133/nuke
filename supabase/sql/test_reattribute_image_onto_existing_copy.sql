-- Isolated PostgreSQL 17 regression: synthetic rows and placeholder links only, never production data.
-- Contract for 20261016164500_reattribute_image_onto_existing_copy.sql: when the target vehicle already holds a live
-- image with the same image_url, reattribute_observation supersedes the moved row onto that copy and inserts nothing;
-- otherwise the live body is unchanged (copy on the target, original superseded, merged_from_vehicle_id kept);
-- observations keep the live path; a superseded or same-vehicle request is refused as before; every move is in
-- reattribution_audit; the drift guard sees the live fingerprint, refuses a drifted body and the migration applies twice.
-- The live function (helpers/reattribute_observation_live_20261015.sql) is a dependency fixture.
-- ALLOW_RAW_TESTIMONY_WRITE: synthetic fixture rows in a disposable database.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%'
   OR current_setting('server_version_num')::int / 10000 <> 17
   OR EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p','v','m')) THEN
 RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database'; END IF;
END $$;
SET statement_timeout='30s';
SET lock_timeout='3s';

-- Every column the function reads or writes, nothing else.
CREATE TABLE public.vehicles(id uuid PRIMARY KEY);
CREATE TABLE public.vehicle_images(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid, image_url text, image_type text,
  image_category text, category text, position int, caption text, is_primary boolean, created_at timestamptz DEFAULT now(),
  updated_at timestamptz, file_name text, source text, exif_data jsonb, file_hash text, file_size bigint, taken_at timestamptz,
  latitude numeric, longitude numeric, location_name text, apple_ml_labels jsonb, photographer_attribution text,
  documented_by_device text, documented_by_user_id uuid, storage_path text, thumbnail_url text, medium_url text,
  large_url text, merged_from_vehicle_id uuid, is_superseded boolean DEFAULT false, superseded_by uuid,
  superseded_at timestamptz, vision_gate_status text);
CREATE TABLE public.vehicle_observations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, kind text, source_id uuid, source_identifier text,
  source_url text, content_text text, content_hash text, structured_data jsonb, confidence numeric, observed_at timestamptz,
  ingested_at timestamptz, observer_id uuid, observer_raw jsonb, submitted_by_user_id uuid, agent_tier text, agent_model text,
  extraction_method text, rank int, merged_from_vehicle_id uuid, is_superseded boolean DEFAULT false, superseded_by uuid,
  superseded_at timestamptz);
CREATE TABLE public.reattribution_audit(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), observation_type text, old_observation_id uuid, old_vehicle_id uuid,
  new_observation_id uuid, new_vehicle_id uuid, reason text, actor_user_id uuid, created_at timestamptz DEFAULT now());
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label;
END $$;

\ir helpers/reattribute_observation_live_20261015.sql
DO $$ BEGIN
  PERFORM pg_temp.ok('fixture reproduces the live fingerprint',
    md5(pg_get_functiondef('public.reattribute_observation(text,uuid,uuid,text,uuid)'::regprocedure))
      = '5b39ee293216ed647d7f09f8a53beb58'); -- gitleaks:allow (fingerprint)
END $$;
\ir ../migrations/20261016164500_reattribute_image_onto_existing_copy.sql
DO $$ BEGIN
  PERFORM pg_temp.ok('migration installs the expected body',
    md5(pg_get_functiondef('public.reattribute_observation(text,uuid,uuid,text,uuid)'::regprocedure))
      = '8f251feebd5ab696392f47a6c6522220'); -- gitleaks:allow (fingerprint)
END $$;
-- A second application is a no-op that passes its own guard.
\ir ../migrations/20261016164500_reattribute_image_onto_existing_copy.sql

-- The hybrid truck (a1) carries two Barrett-Jackson photos; the docket Corvette's own row (b1) already holds the first.
INSERT INTO public.vehicles VALUES ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000b1');
INSERT INTO public.vehicle_images (id, vehicle_id, image_url, source, created_at) VALUES
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-0000000000a1', 'https://example.invalid/bj/1.jpg', 'external_import', now()),
  ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-0000000000a1', 'https://example.invalid/bj/2.jpg', 'external_import', now()),
  ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-0000000000b1', 'https://example.invalid/bj/1.jpg', 'external_import', now() - interval '1 day'),
  -- a superseded copy on the target does not count as a copy
  ('00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-0000000000b1', 'https://example.invalid/bj/2.jpg', 'external_import', now() - interval '1 day');
UPDATE public.vehicle_images SET is_superseded = true WHERE id = '00000000-0000-0000-0000-000000000022';
INSERT INTO public.vehicle_observations (id, vehicle_id, kind, source_url) VALUES
  ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000a1', 'listing', 'https://example.invalid/bj/docket/200665');

-- 1. The target already holds the image: superseded onto its copy, nothing inserted.
DO $$ DECLARE r jsonb; n int := (SELECT count(*) FROM public.vehicle_images); BEGIN
  r := public.reattribute_observation('image', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-0000000000b1',
                                      'the docket car holds this photo');
  PERFORM pg_temp.ok('answers success onto the existing copy', r ->> 'success' = 'true' AND r ->> 'onto_existing_copy' = 'true'
    AND r ->> 'new_observation_id' = '00000000-0000-0000-0000-000000000021');
  PERFORM pg_temp.ok('no image row inserted', (SELECT count(*) FROM public.vehicle_images) = n);
  PERFORM pg_temp.ok('the moved row is superseded onto the copy',
    (SELECT is_superseded AND superseded_by = '00000000-0000-0000-0000-000000000021' AND superseded_at IS NOT NULL
            AND vehicle_id = '00000000-0000-0000-0000-0000000000a1'
       FROM public.vehicle_images WHERE id = '00000000-0000-0000-0000-000000000011'));
  PERFORM pg_temp.ok('the audit row names both rows',
    (SELECT old_vehicle_id = '00000000-0000-0000-0000-0000000000a1' AND new_vehicle_id = '00000000-0000-0000-0000-0000000000b1'
            AND new_observation_id = '00000000-0000-0000-0000-000000000021' AND reason LIKE '%superseded onto its copy%'
       FROM public.reattribution_audit WHERE old_observation_id = '00000000-0000-0000-0000-000000000011'));
END $$;

-- 2. Only a superseded copy on the target: the live path (copy, supersede, lineage).
DO $$ DECLARE r jsonb; v uuid; BEGIN
  r := public.reattribute_observation('image', '00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-0000000000b1',
                                      'the docket car photo');
  v := (r ->> 'new_observation_id')::uuid;
  PERFORM pg_temp.ok('a superseded copy is not reused', r ->> 'onto_existing_copy' IS NULL AND v <> '00000000-0000-0000-0000-000000000022');
  PERFORM pg_temp.ok('the copy is on the target with its lineage',
    (SELECT vehicle_id = '00000000-0000-0000-0000-0000000000b1' AND merged_from_vehicle_id = '00000000-0000-0000-0000-0000000000a1'
            AND image_url = 'https://example.invalid/bj/2.jpg' AND NOT is_superseded AND vision_gate_status = 'pending'
       FROM public.vehicle_images WHERE id = v));
  PERFORM pg_temp.ok('the original is superseded by the copy',
    (SELECT is_superseded AND superseded_by = v FROM public.vehicle_images WHERE id = '00000000-0000-0000-0000-000000000012'));
END $$;

-- 3. Observations keep the live path.
DO $$ DECLARE r jsonb; BEGIN
  r := public.reattribute_observation('observation', '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000b1',
                                      'the docket car listing');
  PERFORM pg_temp.ok('an observation is copied and superseded',
    r ->> 'success' = 'true' AND (SELECT count(*) FROM public.vehicle_observations WHERE vehicle_id = '00000000-0000-0000-0000-0000000000b1'
      AND merged_from_vehicle_id = '00000000-0000-0000-0000-0000000000a1') = 1
    AND (SELECT is_superseded FROM public.vehicle_observations WHERE id = '00000000-0000-0000-0000-000000000031'));
END $$;

-- 4. Refusals as before.
DO $$ DECLARE r jsonb; BEGIN
  r := public.reattribute_observation('image', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-0000000000b1', 'again');
  PERFORM pg_temp.ok('an already superseded image is refused', r ->> 'error' = 'already_superseded');
  r := public.reattribute_observation('image', '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-0000000000b1', 'same');
  PERFORM pg_temp.ok('a move to its own vehicle is refused', r ->> 'error' = 'target_same_as_current');
  PERFORM pg_temp.ok('three moves audited', (SELECT count(*) FROM public.reattribution_audit) = 3);
END $$;

-- 5. A drifted live body is refused by the guard.
CREATE OR REPLACE FUNCTION public.reattribute_observation(p_observation_type text, p_observation_id uuid,
  p_target_vehicle_id uuid, p_reason text, p_actor_user_id uuid DEFAULT NULL::uuid) RETURNS jsonb LANGUAGE sql AS $f$ SELECT '{}'::jsonb $f$;
\set ON_ERROR_STOP off
\ir ../migrations/20261016164500_reattribute_image_onto_existing_copy.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok('a drifted body is not replaced',
  (SELECT prosrc FROM pg_proc WHERE proname = 'reattribute_observation') LIKE '%SELECT ''{}''::jsonb%');

SELECT 'reattribute image onto existing copy contract: all passed' AS result;

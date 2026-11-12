-- capture_typ_from_local_observation_v1: map high-confidence CLIP views to typ
-- only when exact agreement vs existing typ is >= 90%. CAS on empty typ,
-- provenance source=local_clip, revert-by-run, dry-default, cap 50.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_typ_from_local_observation%' OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_capture_typ_from_local_observation* database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.vehicle_images(
  id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, taken_at timestamptz, created_at timestamptz DEFAULT now(),
  source text, is_sensitive boolean DEFAULT false, image_url text, file_name text, ai_scan_metadata jsonb);
CREATE TABLE public.image_observations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), image_id uuid NOT NULL, observed_by text NOT NULL,
  is_active boolean NOT NULL DEFAULT true, observed_at timestamptz NOT NULL DEFAULT now(),
  confidence numeric, confidence_basis jsonb);
CREATE TABLE public.capture_privacy_promote_exclude(image_id uuid PRIMARY KEY, reason text, granted_by uuid);

CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;

CREATE FUNCTION pg_temp.obs(p_image uuid, p_view text, p_conf numeric) RETURNS void LANGUAGE sql AS $$
  INSERT INTO image_observations(image_id, observed_by, confidence_basis)
  VALUES (p_image, 'local_image_analysis_v1',
          jsonb_build_object('local_image_analysis_v1', jsonb_build_object(
            'reading', jsonb_build_object('view', p_view, 'view_confidence', p_conf))));
$$;

\i supabase/migrations/20261115232000_capture_typ_from_local_observation.sql

SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.capture_typ_from_local_observation_v1(uuid,uuid,uuid,boolean,integer)', 'EXECUTE'), 'anon cannot typ');
SELECT pg_temp.assert_true(has_function_privilege('service_role', 'public.capture_typ_from_local_observation_v1(uuid,uuid,uuid,boolean,integer)', 'EXECUTE'), 'service_role can typ');

-- User A: 9/9 high-conf typed frames agree (100%). Typ-empty candidates:
--   e1 exterior_side 0.91, e2 interior 0.88, e3 engine 0.95  -> writable
--   e4 view_conf 0.79 -> too low
--   e5 already typ vehicle_exterior -> no overwrite
--   e6 empty_url, e7 sensitive, e8 exclude, e9 unmapped undercarriage
-- User B: 2/4 agree (50%) plus typ-empty; apply must refuse.
INSERT INTO vehicle_images(id, user_id, image_url, is_sensitive, ai_scan_metadata) VALUES
 ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000aa', 'https://example.invalid/a1', false, '{"classification":{"image_type":"vehicle_exterior"}}'),
 ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000aa', 'https://example.invalid/a2', false, '{"classification":{"image_type":"vehicle_exterior"}}'),
 ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000aa', 'https://example.invalid/a3', false, '{"classification":{"image_type":"vehicle_interior"}}'),
 ('00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000aa', 'https://example.invalid/a4', false, '{"classification":{"image_type":"engine_bay"}}'),
 ('00000000-0000-4000-8000-0000000000a5', '00000000-0000-4000-8000-0000000000aa', 'https://example.invalid/a5', false, '{"classification":{"image_type":"receipt_document"}}'),
 ('00000000-0000-4000-8000-0000000000a6', '00000000-0000-4000-8000-0000000000aa', 'https://example.invalid/a6', false, '{"classification":{"image_type":"other"}}'),
 ('00000000-0000-4000-8000-0000000000a7', '00000000-0000-4000-8000-0000000000aa', 'https://example.invalid/a7', false, '{"classification":{"image_type":"vehicle_exterior"}}'),
 ('00000000-0000-4000-8000-0000000000a8', '00000000-0000-4000-8000-0000000000aa', 'https://example.invalid/a8', false, '{"classification":{"image_type":"vehicle_interior"}}'),
 ('00000000-0000-4000-8000-0000000000a9', '00000000-0000-4000-8000-0000000000aa', 'https://example.invalid/a9', false, '{"classification":{"image_type":"engine_bay"}}'),
 ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000aa', 'https://example.invalid/e1', false, '{}'),
 ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000aa', 'https://example.invalid/e2', false, '{"classification":{}}'),
 ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000aa', 'https://example.invalid/e3', false, NULL),
 ('00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000aa', 'https://example.invalid/e4', false, '{}'),
 ('00000000-0000-4000-8000-0000000000e5', '00000000-0000-4000-8000-0000000000aa', 'https://example.invalid/e5', false, '{"classification":{"image_type":"vehicle_exterior"}}'),
 ('00000000-0000-4000-8000-0000000000e6', '00000000-0000-4000-8000-0000000000aa', NULL, false, '{}'),
 ('00000000-0000-4000-8000-0000000000e7', '00000000-0000-4000-8000-0000000000aa', 'https://example.invalid/e7', true, '{}'),
 ('00000000-0000-4000-8000-0000000000e8', '00000000-0000-4000-8000-0000000000aa', 'https://example.invalid/e8', false, '{}'),
 ('00000000-0000-4000-8000-0000000000e9', '00000000-0000-4000-8000-0000000000aa', 'https://example.invalid/e9', false, '{}'),
 -- user B: 2 agree, 2 disagree (50%)
 ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000bb', 'https://example.invalid/b1', false, '{"classification":{"image_type":"vehicle_exterior"}}'),
 ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000bb', 'https://example.invalid/b2', false, '{"classification":{"image_type":"vehicle_interior"}}'),
 ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000bb', 'https://example.invalid/b3', false, '{"classification":{"image_type":"other"}}'),
 ('00000000-0000-4000-8000-0000000000b4', '00000000-0000-4000-8000-0000000000bb', 'https://example.invalid/b4', false, '{"classification":{"image_type":"vehicle_exterior"}}'),
 ('00000000-0000-4000-8000-0000000000b5', '00000000-0000-4000-8000-0000000000bb', 'https://example.invalid/b5', false, '{}');

INSERT INTO capture_privacy_promote_exclude(image_id, reason, granted_by)
VALUES ('00000000-0000-4000-8000-0000000000e8', 'privacy_backup_union', '00000000-0000-4000-8000-0000000000cc');

SELECT pg_temp.obs('00000000-0000-4000-8000-0000000000a1', 'exterior_side', 0.92);
SELECT pg_temp.obs('00000000-0000-4000-8000-0000000000a2', 'exterior_front', 0.88);
SELECT pg_temp.obs('00000000-0000-4000-8000-0000000000a3', 'interior', 0.91);
SELECT pg_temp.obs('00000000-0000-4000-8000-0000000000a4', 'engine', 0.94);
SELECT pg_temp.obs('00000000-0000-4000-8000-0000000000a5', 'document', 0.90);
SELECT pg_temp.obs('00000000-0000-4000-8000-0000000000a6', 'screenshot', 0.93);
SELECT pg_temp.obs('00000000-0000-4000-8000-0000000000a7', 'exterior_rear', 0.85);
SELECT pg_temp.obs('00000000-0000-4000-8000-0000000000a8', 'interior', 0.81);
SELECT pg_temp.obs('00000000-0000-4000-8000-0000000000a9', 'engine', 0.99);
SELECT pg_temp.obs('00000000-0000-4000-8000-0000000000e1', 'exterior_side', 0.91);
SELECT pg_temp.obs('00000000-0000-4000-8000-0000000000e2', 'interior', 0.88);
SELECT pg_temp.obs('00000000-0000-4000-8000-0000000000e3', 'engine', 0.95);
SELECT pg_temp.obs('00000000-0000-4000-8000-0000000000e4', 'exterior_side', 0.79);
SELECT pg_temp.obs('00000000-0000-4000-8000-0000000000e5', 'interior', 0.97);
SELECT pg_temp.obs('00000000-0000-4000-8000-0000000000e6', 'exterior_side', 0.96);
SELECT pg_temp.obs('00000000-0000-4000-8000-0000000000e7', 'exterior_side', 0.96);
SELECT pg_temp.obs('00000000-0000-4000-8000-0000000000e8', 'exterior_side', 0.96);
SELECT pg_temp.obs('00000000-0000-4000-8000-0000000000e9', 'undercarriage', 0.96);
SELECT pg_temp.obs('00000000-0000-4000-8000-0000000000b1', 'exterior_side', 0.92);
SELECT pg_temp.obs('00000000-0000-4000-8000-0000000000b2', 'interior', 0.91);
SELECT pg_temp.obs('00000000-0000-4000-8000-0000000000b3', 'exterior_side', 0.90);
SELECT pg_temp.obs('00000000-0000-4000-8000-0000000000b4', 'engine', 0.89);
SELECT pg_temp.obs('00000000-0000-4000-8000-0000000000b5', 'exterior_side', 0.95);

-- granted_by required
DO $$
BEGIN
  BEGIN
    PERFORM public.capture_typ_from_local_observation_v1('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f1', NULL, true, 50);
    RAISE EXCEPTION 'expected granted_by required';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%granted_by required%' THEN RAISE; END IF;
  END;
END $$;

-- dry user A: 100% agreement, would_write 3
SELECT public.capture_typ_from_local_observation_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f0',
  '00000000-0000-4000-8000-0000000000cc', true, 50) AS dry_a \gset
SELECT pg_temp.assert_true((:'dry_a'::jsonb->>'dry_run')::boolean, 'dry flag');
SELECT pg_temp.assert_true((:'dry_a'::jsonb->>'comparable')::int = 10, 'user A comparable 10 (9 agree + e5 typ/CLIP mismatch)');
SELECT pg_temp.assert_true((:'dry_a'::jsonb->>'agree')::int = 9, 'user A agree 9');
SELECT pg_temp.assert_true((:'dry_a'::jsonb->>'agree_pct')::numeric = 90.0, 'user A 90% at the gate');
SELECT pg_temp.assert_true((:'dry_a'::jsonb->>'agreement_ok')::boolean, 'user A agreement ok');
SELECT pg_temp.assert_true((:'dry_a'::jsonb->>'eligible')::int = 3, 'user A eligible 3 typ-empty');
SELECT pg_temp.assert_true((:'dry_a'::jsonb->>'would_write')::int = 3, 'user A would_write 3');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_typ_from_local_observation_log) = 0, 'dry wrote no log');
SELECT pg_temp.assert_true((
  SELECT ai_scan_metadata#>>'{classification,image_type}' IS NULL
  FROM vehicle_images WHERE id = '00000000-0000-4000-8000-0000000000e1'
), 'dry did not typ e1');

-- apply user B: 50% agreement, refuse
SELECT public.capture_typ_from_local_observation_v1(
  '00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000000f1',
  '00000000-0000-4000-8000-0000000000cc', false, 50) AS apply_b \gset
SELECT pg_temp.assert_true((:'apply_b'::jsonb->>'comparable')::int = 4, 'user B comparable 4');
SELECT pg_temp.assert_true((:'apply_b'::jsonb->>'agree')::int = 2, 'user B agree 2');
SELECT pg_temp.assert_true((:'apply_b'::jsonb->>'agree_pct')::numeric = 50.0, 'user B 50%');
SELECT pg_temp.assert_true((:'apply_b'::jsonb->>'refused_low_agreement')::boolean, 'user B refused');
SELECT pg_temp.assert_true((:'apply_b'::jsonb->>'written')::int = 0, 'user B wrote 0');
SELECT pg_temp.assert_true((
  SELECT ai_scan_metadata#>>'{classification,image_type}' IS NULL
  FROM vehicle_images WHERE id = '00000000-0000-4000-8000-0000000000b5'
), 'low agreement did not typ b5');

-- apply user A
SELECT public.capture_typ_from_local_observation_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f2',
  '00000000-0000-4000-8000-0000000000cc', false, 50) AS apply_a \gset
SELECT pg_temp.assert_true((:'apply_a'::jsonb->>'written')::int = 3, 'user A wrote 3');
SELECT pg_temp.assert_true((
  SELECT ai_scan_metadata#>>'{classification,image_type}'
  FROM vehicle_images WHERE id = '00000000-0000-4000-8000-0000000000e1'
) = 'vehicle_exterior', 'e1 typ exterior');
SELECT pg_temp.assert_true((
  SELECT ai_scan_metadata#>>'{classification,image_type}'
  FROM vehicle_images WHERE id = '00000000-0000-4000-8000-0000000000e2'
) = 'vehicle_interior', 'e2 typ interior');
SELECT pg_temp.assert_true((
  SELECT ai_scan_metadata#>>'{classification,image_type}'
  FROM vehicle_images WHERE id = '00000000-0000-4000-8000-0000000000e3'
) = 'engine_bay', 'e3 typ engine_bay');
SELECT pg_temp.assert_true((
  SELECT ai_scan_metadata#>>'{classification,image_type_provenance,source}'
  FROM vehicle_images WHERE id = '00000000-0000-4000-8000-0000000000e1'
) = 'local_clip', 'provenance source');
SELECT pg_temp.assert_true((
  SELECT ai_scan_metadata#>>'{classification,image_type_provenance,run_id}'
  FROM vehicle_images WHERE id = '00000000-0000-4000-8000-0000000000e1'
) = '00000000-0000-4000-8000-0000000000f2', 'provenance run');
-- no overwrite of existing typ even when CLIP disagrees
SELECT pg_temp.assert_true((
  SELECT ai_scan_metadata#>>'{classification,image_type}'
  FROM vehicle_images WHERE id = '00000000-0000-4000-8000-0000000000e5'
) = 'vehicle_exterior', 'e5 typ left alone');
-- low conf / empty_url / sensitive / exclude / unmapped stay empty
SELECT pg_temp.assert_true((
  SELECT bool_and(nullif(ai_scan_metadata#>>'{classification,image_type}','') IS NULL)
  FROM vehicle_images WHERE id IN (
    '00000000-0000-4000-8000-0000000000e4',
    '00000000-0000-4000-8000-0000000000e6',
    '00000000-0000-4000-8000-0000000000e7',
    '00000000-0000-4000-8000-0000000000e8',
    '00000000-0000-4000-8000-0000000000e9')
), 'excluded typ-empty stay empty');

-- idempotent
SELECT public.capture_typ_from_local_observation_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f3',
  '00000000-0000-4000-8000-0000000000cc', false, 50) AS again \gset
SELECT pg_temp.assert_true((:'again'::jsonb->>'written')::int = 0, 'second apply writes 0');
SELECT pg_temp.assert_true((:'again'::jsonb->>'eligible')::int = 0, 'second apply eligible 0');

-- revert restores typ-empty
SELECT public.capture_typ_from_local_observation_revert_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f2') AS rev \gset
SELECT pg_temp.assert_true((:'rev'::jsonb->>'restored')::int = 3, 'restored 3');
SELECT pg_temp.assert_true((
  SELECT bool_and(nullif(ai_scan_metadata#>>'{classification,image_type}','') IS NULL)
  FROM vehicle_images WHERE id IN (
    '00000000-0000-4000-8000-0000000000e1',
    '00000000-0000-4000-8000-0000000000e2',
    '00000000-0000-4000-8000-0000000000e3')
), 'typ cleared on revert');
SELECT pg_temp.assert_true((
  SELECT ai_scan_metadata#>>'{classification,image_type}'
  FROM vehicle_images WHERE id = '00000000-0000-4000-8000-0000000000a1'
) = 'vehicle_exterior', 'typed frames untouched by revert');

-- eligible again after revert
SELECT public.capture_typ_from_local_observation_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f4',
  '00000000-0000-4000-8000-0000000000cc', true, 50) AS redry \gset
SELECT pg_temp.assert_true((:'redry'::jsonb->>'eligible')::int = 3, 'eligible again after revert');

-- migration revert refuses while unreverted: apply then refuse, then revert run and drop
SELECT public.capture_typ_from_local_observation_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f4',
  '00000000-0000-4000-8000-0000000000cc', false, 50);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.capture_typ_from_local_observation_log WHERE reverted_at IS NULL) THEN
    RAISE EXCEPTION 'expected unreverted rows';
  END IF;
END $$;
SELECT public.capture_typ_from_local_observation_revert_v1(
  '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000f4');
\i supabase/sql/revert_20261115232000_capture_typ_from_local_observation.sql
SELECT pg_temp.assert_true(to_regprocedure('public.capture_typ_from_local_observation_v1(uuid,uuid,uuid,boolean,integer)') IS NULL, 'function dropped');
SELECT pg_temp.assert_true(to_regclass('public.capture_typ_from_local_observation_log') IS NULL, 'log table dropped');

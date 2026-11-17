-- Contract: capture_archive_owner_attribution_v1. Stamps user_id only with producer-recorded owner evidence, skips
-- every unsafe class, refuses apply for disabled rules, CAS-updates, logs, and reverts by run.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_archive_owner%' OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_capture_archive_owner* database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, user_id uuid, owner_id uuid, uploaded_by uuid);
CREATE TABLE public.vehicle_images(
  id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, source text, image_url text, is_sensitive boolean DEFAULT false,
  is_superseded boolean DEFAULT false, is_primary boolean DEFAULT false, documented_by_user_id uuid, imported_by uuid,
  submitted_by uuid, ghost_user_id uuid, vision_gate_status text, taken_at timestamptz);
CREATE TABLE public.capture_privacy_promote_exclude(image_id uuid PRIMARY KEY, reason text, granted_by uuid);
CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;

\i supabase/migrations/20261117141000_capture_archive_owner_attribution_v1.sql

SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.capture_archive_owner_attribution_v1(uuid,uuid,uuid,text,boolean,integer)', 'EXECUTE'), 'anon cannot stamp');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated', 'public.capture_archive_owner_attribution_v1(uuid,uuid,uuid,text,boolean,integer)', 'EXECUTE'), 'authenticated cannot stamp');
SELECT pg_temp.assert_true(has_function_privilege('service_role', 'public.capture_archive_owner_attribution_v1(uuid,uuid,uuid,text,boolean,integer)', 'EXECUTE'), 'service_role stamps');

INSERT INTO vehicles VALUES ('00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-0000000000aa', NULL, NULL),
                            ('00000000-0000-4000-8000-00000000f002', '00000000-0000-4000-8000-0000000000bb', NULL, NULL);
INSERT INTO vehicle_images(id, user_id, vehicle_id, source, image_url, documented_by_user_id, imported_by, ghost_user_id,
  is_sensitive, is_superseded, is_primary) VALUES
 ('00000000-0000-4000-8000-000000000001', NULL, '00000000-0000-4000-8000-00000000f001', 'hd_archive', 'https://x/1.jpg', '00000000-0000-4000-8000-0000000000aa', NULL, NULL, false, false, false),
 ('00000000-0000-4000-8000-000000000002', NULL, '00000000-0000-4000-8000-00000000f001', 'hd_archive', 'https://x/2.jpg', '00000000-0000-4000-8000-0000000000aa', NULL, NULL, false, false, false),
 ('00000000-0000-4000-8000-000000000003', NULL, NULL,                                   'hd_archive', 'https://x/3.jpg', '00000000-0000-4000-8000-0000000000aa', NULL, NULL, false, false, false),
 -- skips
 ('00000000-0000-4000-8000-000000000011', NULL, '00000000-0000-4000-8000-00000000f002', 'hd_archive', 'https://x/11.jpg', '00000000-0000-4000-8000-0000000000aa', NULL, NULL, false, false, false),
 ('00000000-0000-4000-8000-000000000012', NULL, '00000000-0000-4000-8000-00000000f001', 'hd_archive', 'https://x/12.jpg', '00000000-0000-4000-8000-0000000000aa', NULL, NULL, false, false, true),
 ('00000000-0000-4000-8000-000000000013', NULL, '00000000-0000-4000-8000-00000000f001', 'hd_archive', 'https://x/13.jpg', '00000000-0000-4000-8000-0000000000aa', NULL, NULL, false, true, false),
 ('00000000-0000-4000-8000-000000000014', NULL, '00000000-0000-4000-8000-00000000f001', 'hd_archive', 'https://x/14.jpg', '00000000-0000-4000-8000-0000000000aa', NULL, NULL, true, false, false),
 ('00000000-0000-4000-8000-000000000015', NULL, '00000000-0000-4000-8000-00000000f001', 'hd_archive', '',                '00000000-0000-4000-8000-0000000000aa', NULL, NULL, false, false, false),
 ('00000000-0000-4000-8000-000000000016', NULL, '00000000-0000-4000-8000-00000000f001', 'hd_archive', 'https://x/16.jpg', '00000000-0000-4000-8000-0000000000aa', NULL, NULL, false, false, false),
 ('00000000-0000-4000-8000-000000000017', NULL, '00000000-0000-4000-8000-00000000f001', 'hd_archive', 'https://x/17.jpg', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000bb', NULL, false, false, false),
 ('00000000-0000-4000-8000-000000000018', NULL, '00000000-0000-4000-8000-00000000f001', 'hd_archive', 'https://x/18.jpg', NULL, NULL, NULL, false, false, false),
 ('00000000-0000-4000-8000-000000000019', '00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-00000000f001', 'hd_archive', 'https://x/19.jpg', '00000000-0000-4000-8000-0000000000aa', NULL, NULL, false, false, false),
 ('00000000-0000-4000-8000-000000000021', NULL, '00000000-0000-4000-8000-00000000f001', 'ssd_blast', 'https://x/21.jpg', NULL, NULL, NULL, false, false, false);
INSERT INTO capture_privacy_promote_exclude VALUES ('00000000-0000-4000-8000-000000000016', 'privacy_backup_union', '00000000-0000-4000-8000-0000000000cc');

-- granted_by required, cap bound
DO $$ BEGIN
  PERFORM capture_archive_owner_attribution_v1('00000000-0000-4000-8000-0000000000aa', gen_random_uuid(), NULL, 'hd_archive', true, 50);
  RAISE EXCEPTION 'expected granted_by failure';
EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%granted_by and source required%' THEN RAISE; END IF; END $$;
DO $$ BEGIN
  PERFORM capture_archive_owner_attribution_v1('00000000-0000-4000-8000-0000000000aa', gen_random_uuid(), '00000000-0000-4000-8000-0000000000aa', 'hd_archive', true, 51);
  RAISE EXCEPTION 'expected cap failure';
EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%cap must be%' THEN RAISE; END IF; END $$;

-- dry run: reasons, no writes
DO $$
DECLARE r jsonb;
BEGIN
  r := capture_archive_owner_attribution_v1('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-0000000000aa', 'hd_archive', true, 50);
  PERFORM pg_temp.assert_true((r->>'would_stamp')::int = 3, 'would stamp 3, got ' || r::text);
  PERFORM pg_temp.assert_true((r->'by_reason'->>'other_vehicle')::int = 1 AND (r->'by_reason'->>'is_primary')::int = 1
    AND (r->'by_reason'->>'superseded')::int = 1 AND (r->'by_reason'->>'sensitive')::int = 1
    AND (r->'by_reason'->>'empty_url')::int = 1 AND (r->'by_reason'->>'privacy_exclude')::int = 1
    AND (r->'by_reason'->>'conflicting_attribution')::int = 1 AND (r->'by_reason'->>'no_owner_evidence')::int = 1, 'skip reasons ' || r::text);
  PERFORM pg_temp.assert_true((r->>'scanned')::int = 11, 'owned row 19 not scanned');
END $$;
SELECT pg_temp.assert_true((SELECT count(*) FROM vehicle_images WHERE user_id IS NOT NULL) = 1, 'dry wrote nothing');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_archive_owner_log) = 0, 'dry logged nothing');

-- disabled rule refuses apply, dry still reports
DO $$ BEGIN
  PERFORM capture_archive_owner_attribution_v1('00000000-0000-4000-8000-0000000000aa', gen_random_uuid(), '00000000-0000-4000-8000-0000000000aa', 'ssd_blast', false, 50);
  RAISE EXCEPTION 'expected disabled';
EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%apply is disabled%' THEN RAISE; END IF; END $$;
SELECT pg_temp.assert_true((capture_archive_owner_attribution_v1('00000000-0000-4000-8000-0000000000aa', gen_random_uuid(), '00000000-0000-4000-8000-0000000000aa', 'ssd_blast', true, 50)->'by_reason'->>'no_owner_evidence')::int = 1, 'ssd dry reports no evidence');
DO $$ BEGIN
  UPDATE capture_archive_owner_rules SET apply_enabled = true WHERE source = 'ssd_blast';
  RAISE EXCEPTION 'expected check';
EXCEPTION WHEN check_violation THEN NULL; END $$;

-- apply cap 2, then rest; run reuse refused
SELECT pg_temp.assert_true((capture_archive_owner_attribution_v1('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000000aa', 'hd_archive', false, 2)->>'stamped')::int = 2, 'stamp 2');
DO $$ BEGIN
  PERFORM capture_archive_owner_attribution_v1('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000000aa', 'hd_archive', false, 2);
  RAISE EXCEPTION 'expected run reuse refusal';
EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%already used%' THEN RAISE; END IF; END $$;
SELECT pg_temp.assert_true((capture_archive_owner_attribution_v1('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000a002', '00000000-0000-4000-8000-0000000000aa', 'hd_archive', false, 50)->>'stamped')::int = 1, 'stamp last 1');
SELECT pg_temp.assert_true((capture_archive_owner_attribution_v1('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000a003', '00000000-0000-4000-8000-0000000000aa', 'hd_archive', false, 50)->>'stamped')::int = 0, 'nothing left');
SELECT pg_temp.assert_true((SELECT count(*) FROM vehicle_images WHERE user_id = '00000000-0000-4000-8000-0000000000aa') = 3, 'three stamped');
SELECT pg_temp.assert_true((SELECT bool_and(user_id IS NULL) FROM vehicle_images WHERE id IN (
  '00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000013',
  '00000000-0000-4000-8000-000000000014','00000000-0000-4000-8000-000000000015','00000000-0000-4000-8000-000000000016',
  '00000000-0000-4000-8000-000000000017','00000000-0000-4000-8000-000000000018','00000000-0000-4000-8000-000000000021')), 'skips untouched');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_archive_owner_log WHERE granted_by IS NOT NULL AND signature LIKE 'capture_archive_owner_attribution_v1 run=%') = 3, 'signed log');

-- revert refuses while live, revert by run, then migration revert
DO $$ BEGIN
  EXECUTE 'DO $x$ BEGIN IF (SELECT count(*) FROM public.capture_archive_owner_log WHERE reverted_at IS NULL) > 0 THEN RAISE EXCEPTION ''unreverted log rows''; END IF; END $x$';
  RAISE EXCEPTION 'expected refusal';
EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%unreverted log rows%' THEN RAISE; END IF; END $$;
SELECT pg_temp.assert_true((capture_archive_owner_revert_v1('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000a001')->>'restored_images')::int = 2, 'revert run 1');
SELECT pg_temp.assert_true((capture_archive_owner_revert_v1('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000a002')->>'restored_images')::int = 1, 'revert run 2');
SELECT pg_temp.assert_true((SELECT count(*) FROM vehicle_images WHERE user_id = '00000000-0000-4000-8000-0000000000aa') = 0, 'all restored');
SELECT pg_temp.assert_true((capture_archive_owner_attribution_v1('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000d002', '00000000-0000-4000-8000-0000000000aa', 'hd_archive', true, 50)->>'would_stamp')::int = 3, 'reverted rows eligible again');
\i supabase/sql/revert_20261117141000_capture_archive_owner_attribution_v1.sql
SELECT pg_temp.assert_true(to_regprocedure('public.capture_archive_owner_attribution_v1(uuid,uuid,uuid,text,boolean,integer)') IS NULL, 'migration reverted');
\echo TEST_EXIT:0

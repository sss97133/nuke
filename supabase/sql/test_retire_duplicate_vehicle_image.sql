-- retire_duplicate_vehicle_image (20261122000500): a second copy of a photo row is marked is_duplicate of the kept row
-- only when a hard key proves the same picture (file_hash, image_url, asset id); a capture second alone is refused; every
-- refusal writes nothing; each retirement writes one capture_exact_copy_log row with the before-image, kept id, matched
-- key, reason, run and actor; vehicle activity is recomputed only when the copy could have counted; the per-run revert
-- restores the marker (and the cover flag when nobody took it), leaves changed rows alone, resumes by p_limit, and never
-- touches the exact-copy writer's rows; service role only; re-applying the migration is a no-op.
\set ON_ERROR_STOP on
SET client_min_messages = warning;
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_retire_duplicate_image%' OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_retire_duplicate_image* database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;

-- the live shapes this writer reads (2026-11-21), cut to the columns it touches
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, vehicle_id uuid, user_id uuid, image_url text, file_hash text,
  exif_data jsonb, taken_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  is_primary boolean DEFAULT false, is_duplicate boolean DEFAULT false, duplicate_of uuid, is_superseded boolean DEFAULT false);
CREATE TABLE public.vehicle_image_byte_mismatches(image_id uuid PRIMARY KEY);
CREATE FUNCTION public.vehicle_image_holds_wrong_bytes(p_image_id uuid) RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT EXISTS (SELECT 1 FROM public.vehicle_image_byte_mismatches WHERE image_id = p_image_id) $$;
CREATE TABLE public.activity_calls(vehicle_id uuid, at timestamptz DEFAULT clock_timestamp());
CREATE FUNCTION public.compute_vehicle_activity(p_vehicle uuid) RETURNS timestamptz LANGUAGE plpgsql AS
$$ BEGIN INSERT INTO public.activity_calls(vehicle_id) VALUES (p_vehicle); RETURN now(); END $$;
-- capture_exact_copy_log exactly as 20261113120500 created it
CREATE TABLE public.capture_exact_copy_log (run_id uuid NOT NULL, image_id uuid NOT NULL, original_id uuid NOT NULL,
  user_id uuid NOT NULL, file_hash text NOT NULL, prior jsonb NOT NULL, signature text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), reverted_at timestamptz, PRIMARY KEY (run_id, image_id));
ALTER TABLE public.capture_exact_copy_log ENABLE ROW LEVEL SECURITY;
INSERT INTO public.capture_exact_copy_log(run_id, image_id, original_id, user_id, file_hash, prior, signature)
VALUES ('00000000-0000-4000-8000-00000000e0e0', '00000000-0000-4000-8000-000000000f01', '00000000-0000-4000-8000-000000000f02',
  '00000000-0000-4000-8000-0000000000aa', 'HX', '{"is_duplicate": false, "duplicate_of": null}', repeat('a', 64));

CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;
CREATE FUNCTION pg_temp.i(n int) RETURNS uuid LANGUAGE sql AS $$ SELECT ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;

-- vehicles v1 (listing car), v2 (wrong car), v3 (right car). user aa.
--  1 kept listing row, 2 its same-URL copy (no user, no hash, no capture time) on v1
--  3 kept frame on v3 (hash H1), 4 copy on v2 with hash H1, a user and a capture time, primary on v2
--  5 kept frame on v3 (asset id A5 lower-case with suffix), 6 copy on v2 carrying A5 upper-case
--  7 kept frame on v3, 8 copy on v2 taken the same second at +3 h, nothing else shared (capture second only)
--  9 copy already marked duplicate; 10 kept row already superseded, 11 its would-be copy (same URL)
-- 12 kept unfiled row, 13 its same-hash copy; 14 kept on v3 with hash H4 listed as wrong bytes, 15 copy with H4
-- 16 another photo on v2 that later takes the cover
INSERT INTO public.vehicle_images(id, vehicle_id, user_id, image_url, file_hash, exif_data, taken_at, is_primary, is_duplicate, is_superseded) VALUES
 (pg_temp.i(1),  pg_temp.i(901), NULL, 'https://listing.example/a.jpg', NULL, NULL, NULL, false, false, false),
 (pg_temp.i(2),  pg_temp.i(901), NULL, 'https://listing.example/a.jpg', NULL, NULL, NULL, false, false, false),
 (pg_temp.i(3),  pg_temp.i(903), pg_temp.i(170), 'https://store.example/k3.jpg', 'H1', NULL, '2025-04-05 20:27+00', false, false, false),
 (pg_temp.i(4),  pg_temp.i(902), pg_temp.i(170), 'https://store.example/c4.jpg', 'H1', NULL, '2025-04-05 20:27+00', true, false, false),
 (pg_temp.i(5),  pg_temp.i(903), NULL, 'https://store.example/k5.jpg', NULL, '{"photos_uuid": "abcdef12-3456-4789-8abc-def012345678/L0/001"}', NULL, false, false, false),
 (pg_temp.i(6),  pg_temp.i(902), NULL, 'https://store.example/c6.jpg', 'H6', '{"ssd_uuid": "ABCDEF12-3456-4789-8ABC-DEF012345678"}', NULL, false, false, false),
 (pg_temp.i(7),  pg_temp.i(903), NULL, 'https://store.example/k7.jpg', NULL, '{"uuid": "11111111-2222-4333-8444-555555555555"}', '2025-09-15 10:47:55+00', false, false, false),
 (pg_temp.i(8),  pg_temp.i(902), NULL, 'https://store.example/c8.jpg', 'H8', '{"ssd_uuid": "99999999-2222-4333-8444-555555555555"}', '2025-09-15 13:47:55+00', false, false, false),
 (pg_temp.i(9),  pg_temp.i(902), NULL, 'https://store.example/k3.jpg', NULL, NULL, NULL, false, true, false),
 (pg_temp.i(10), pg_temp.i(903), NULL, 'https://store.example/s.jpg', NULL, NULL, NULL, false, false, true),
 (pg_temp.i(11), pg_temp.i(902), NULL, 'https://store.example/s.jpg', NULL, NULL, NULL, false, false, false),
 (pg_temp.i(12), NULL,           NULL, 'https://store.example/u12.jpg', 'H3', NULL, NULL, false, false, false),
 (pg_temp.i(13), pg_temp.i(902), NULL, 'https://store.example/c13.jpg', 'H3', NULL, NULL, false, false, false),
 (pg_temp.i(14), pg_temp.i(903), NULL, 'https://store.example/k14.jpg', 'H4', NULL, NULL, false, false, false),
 (pg_temp.i(15), pg_temp.i(902), NULL, 'https://store.example/c15.jpg', 'H4', NULL, NULL, false, false, false),
 (pg_temp.i(16), pg_temp.i(902), NULL, 'https://store.example/o16.jpg', NULL, NULL, NULL, false, false, false);
INSERT INTO public.vehicle_image_byte_mismatches VALUES (pg_temp.i(14));

\i supabase/migrations/20261122000500_retire_duplicate_vehicle_image.sql
\i supabase/migrations/20261122000500_retire_duplicate_vehicle_image.sql
SELECT pg_temp.assert_true((SELECT count(*) = 1 AND bool_and(writer = 'capture_exact_copy_v1') FROM capture_exact_copy_log), 'the exact-copy row survives, read as its own writer; re-apply is a no-op');

-- service role only
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.retire_duplicate_vehicle_image(uuid, uuid, text, uuid, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.retire_duplicate_vehicle_image(uuid, uuid, text, uuid, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.revert_duplicate_image_run(uuid, uuid, integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.revert_duplicate_image_run(uuid, uuid, integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.retire_duplicate_vehicle_image(uuid, uuid, text, uuid, uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.revert_duplicate_image_run(uuid, uuid, integer)', 'EXECUTE'),
  'executable by service_role only');
SELECT pg_temp.assert_true((SELECT prosecdef AND proconfig::text LIKE '%search_path%' FROM pg_proc WHERE oid = 'public.retire_duplicate_vehicle_image(uuid, uuid, text, uuid, uuid)'::regprocedure),
  'SECURITY DEFINER with a fixed search_path');

CREATE FUNCTION pg_temp.r(c int, k int) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.retire_duplicate_vehicle_image(pg_temp.i(c), pg_temp.i(k), 'contract test pair', '00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000000ac') $$;

-- missing arguments raise
DO $$ BEGIN
  PERFORM public.retire_duplicate_vehicle_image(pg_temp.i(2), pg_temp.i(1), ' ', '00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000000ac');
  RAISE EXCEPTION 'contract failed: a blank reason was accepted';
EXCEPTION WHEN null_value_not_allowed THEN NULL; END $$;

-- refusals write nothing
SELECT pg_temp.assert_true(pg_temp.r(2, 2)->>'reason' = 'same_row', 'same row refused');
SELECT pg_temp.assert_true(pg_temp.r(99, 1)->>'reason' = 'copy_not_found', 'missing copy refused');
SELECT pg_temp.assert_true(pg_temp.r(2, 98)->>'reason' = 'kept_not_found', 'missing kept row refused');
SELECT pg_temp.assert_true(pg_temp.r(9, 3)->>'reason' = 'copy_already_retired', 'a copy already marked is refused');
SELECT pg_temp.assert_true(pg_temp.r(11, 10)->>'reason' = 'kept_is_retired', 'a superseded kept row is refused');
SELECT pg_temp.assert_true(pg_temp.r(13, 12)->>'reason' = 'kept_not_filed', 'an unfiled kept row is refused');
SELECT pg_temp.assert_true(pg_temp.r(15, 14)->>'reason' = 'holds_wrong_bytes', 'a row on the byte-mismatch list is refused');
SELECT pg_temp.assert_true(pg_temp.r(8, 7)->>'reason' = 'no_hard_key', 'the same capture second alone is refused');
SELECT pg_temp.assert_true(pg_temp.r(16, 4)->>'reason' = 'no_hard_key', 'two different photos are refused');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_exact_copy_log) = 1 AND NOT EXISTS (SELECT 1 FROM activity_calls)
  AND (SELECT count(*) FROM vehicle_images WHERE is_duplicate) = 1, 'refusals wrote nothing');

-- same image_url on the same vehicle (the listing import shape): no user, no hash, no capture time
SELECT pg_temp.r(2, 1) AS r \gset
SELECT pg_temp.assert_true((:'r')::jsonb->>'status' = 'retired' AND (:'r')::jsonb->>'matched_on' = 'image_url'
  AND (:'r')::jsonb->>'activity_recomputed' = 'false', 'same image_url retired; activity untouched');
-- same file_hash across vehicles: the copy has a user and a capture time, and held the cover
SELECT pg_temp.r(4, 3) AS r \gset
SELECT pg_temp.assert_true((:'r')::jsonb->>'matched_on' = 'file_hash' AND (:'r')::jsonb->>'was_primary' = 'true'
  AND (:'r')::jsonb->>'activity_recomputed' = 'true', 'same file_hash retired; cover flag noted; activity recomputed');
-- shared asset id, case and suffix normalized
SELECT pg_temp.r(6, 5) AS r \gset
SELECT pg_temp.assert_true((:'r')::jsonb->>'matched_on' = 'asset_uuid', 'shared asset id retired');

SELECT pg_temp.assert_true((SELECT is_duplicate AND duplicate_of = pg_temp.i(1) AND vehicle_id = pg_temp.i(901) FROM vehicle_images WHERE id = pg_temp.i(2))
  AND (SELECT is_duplicate AND duplicate_of = pg_temp.i(3) AND vehicle_id = pg_temp.i(902) AND NOT is_primary FROM vehicle_images WHERE id = pg_temp.i(4))
  AND (SELECT is_duplicate AND duplicate_of = pg_temp.i(5) FROM vehicle_images WHERE id = pg_temp.i(6))
  AND (SELECT NOT is_duplicate FROM vehicle_images WHERE id = pg_temp.i(1))
  AND (SELECT NOT is_duplicate FROM vehicle_images WHERE id = pg_temp.i(8)),
  'copies marked in place (vehicle kept, cover flag cleared); kept rows and the refused pair untouched');
SELECT pg_temp.assert_true((SELECT count(*) = 3
    AND bool_and(writer = 'retire_duplicate_vehicle_image' AND reason = 'contract test pair' AND actor = '00000000-0000-4000-8000-0000000000ac'
                 AND length(signature) = 64 AND before_image->>'id' = image_id::text AND (before_image->>'is_duplicate')::boolean = false)
  FROM capture_exact_copy_log WHERE run_id = '00000000-0000-4000-8000-00000000a001'),
  'one audit row per copy: writer, reason, actor, signature, before-image');
SELECT pg_temp.assert_true((SELECT original_id = pg_temp.i(3) AND vehicle_id = pg_temp.i(902) AND kept_vehicle_id = pg_temp.i(903)
    AND match_value = 'H1' AND (prior->>'is_primary')::boolean FROM capture_exact_copy_log WHERE image_id = pg_temp.i(4))
  AND (SELECT match_value = 'ABCDEF12-3456-4789-8ABC-DEF012345678' FROM capture_exact_copy_log WHERE image_id = pg_temp.i(6))
  AND (SELECT user_id IS NULL AND file_hash IS NULL FROM capture_exact_copy_log WHERE image_id = pg_temp.i(2)),
  'kept id, both vehicles, matched value and prior cover flag recorded; rows without user or hash fit');
SELECT pg_temp.assert_true((SELECT count(*) = 1 AND bool_and(vehicle_id = pg_temp.i(902)) FROM activity_calls), 'activity recomputed once, for the copy''s vehicle');
SELECT pg_temp.assert_true(pg_temp.r(2, 1)->>'status' = 'already_in_run', 'repeat in the same run: already_in_run, no second row');
SELECT pg_temp.assert_true(public.retire_duplicate_vehicle_image(pg_temp.i(2), pg_temp.i(1), 'again', '00000000-0000-4000-8000-00000000a002', '00000000-0000-4000-8000-0000000000ac')->>'reason' = 'copy_already_retired',
  'a later run refuses the already retired copy');

-- the check holds this writer's rows to their fields
DO $$ BEGIN
  INSERT INTO capture_exact_copy_log(run_id, image_id, original_id, prior, signature, writer)
  VALUES ('00000000-0000-4000-8000-00000000a003', pg_temp.i(16), pg_temp.i(1), '{}', 'x', 'retire_duplicate_vehicle_image');
  RAISE EXCEPTION 'contract failed: a retire row without reason, actor or before-image was accepted';
EXCEPTION WHEN check_violation THEN NULL; END $$;
DO $$ BEGIN
  INSERT INTO capture_exact_copy_log(run_id, image_id, original_id, prior, signature, writer, match_value, reason, actor, before_image)
  VALUES ('00000000-0000-4000-8000-00000000a003', pg_temp.i(16), pg_temp.i(1), '{}', 'x', 'retire_duplicate_vehicle_image',
    'v', 'r', '00000000-0000-4000-8000-0000000000ac', '{}');
  RAISE EXCEPTION 'contract failed: a retire row without matched_on was accepted';
EXCEPTION WHEN check_violation THEN NULL; END $$;

-- revert: someone re-points copy 6 meanwhile (left as it is); photo 16 takes v2's cover (4's flag is not restored)
UPDATE vehicle_images SET duplicate_of = pg_temp.i(7) WHERE id = pg_temp.i(6);
UPDATE vehicle_images SET is_primary = true WHERE id = pg_temp.i(16);
DELETE FROM activity_calls;
SELECT public.revert_duplicate_image_run('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000000ad', 1) AS r \gset
SELECT pg_temp.assert_true((:'r')::jsonb->>'remaining' = '2' AND ((:'r')::jsonb->>'restored')::int + ((:'r')::jsonb->>'left_as_changed')::int = 1,
  'p_limit bounds one call; remaining says how many are left');
SELECT public.revert_duplicate_image_run('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000000ad') AS r \gset
SELECT pg_temp.assert_true((:'r')::jsonb->>'remaining' = '0', 'second call finishes the run');
SELECT pg_temp.assert_true((SELECT NOT is_duplicate AND duplicate_of IS NULL FROM vehicle_images WHERE id = pg_temp.i(2))
  AND (SELECT NOT is_duplicate AND duplicate_of IS NULL AND NOT is_primary FROM vehicle_images WHERE id = pg_temp.i(4))
  AND (SELECT is_primary FROM vehicle_images WHERE id = pg_temp.i(16))
  AND (SELECT is_duplicate AND duplicate_of = pg_temp.i(7) FROM vehicle_images WHERE id = pg_temp.i(6)),
  'marker restored; cover flag stays with the photo that took it; the re-pointed row is left as it is');
SELECT pg_temp.assert_true((SELECT count(*) = 3 AND bool_and(reverted_at IS NOT NULL AND reverted_by = '00000000-0000-4000-8000-0000000000ad')
    AND count(revert_note) = 1 FROM capture_exact_copy_log WHERE run_id = '00000000-0000-4000-8000-00000000a001')
  AND (SELECT reverted_at IS NULL FROM capture_exact_copy_log WHERE writer = 'capture_exact_copy_v1'),
  'every run row stamped with the reverting actor; the changed one carries a note; the exact-copy row untouched');
SELECT pg_temp.assert_true((SELECT count(*) = 1 AND bool_and(vehicle_id = pg_temp.i(902)) FROM activity_calls), 'revert recomputes activity for the vehicle that could count');
-- revert restores the cover flag when no other photo holds it
UPDATE vehicle_images SET is_primary = false WHERE id = pg_temp.i(16);
UPDATE vehicle_images SET is_primary = true WHERE id = pg_temp.i(4);
SELECT public.retire_duplicate_vehicle_image(pg_temp.i(4), pg_temp.i(3), 'cover case', '00000000-0000-4000-8000-00000000a004', '00000000-0000-4000-8000-0000000000ac') AS r \gset
SELECT public.revert_duplicate_image_run('00000000-0000-4000-8000-00000000a004', '00000000-0000-4000-8000-0000000000ad') AS r \gset
SELECT pg_temp.assert_true((SELECT is_primary AND NOT is_duplicate FROM vehicle_images WHERE id = pg_temp.i(4)), 'cover flag restored when free');
-- reverting a finished run is a no-op
SELECT public.revert_duplicate_image_run('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000000ad') AS r \gset
SELECT pg_temp.assert_true((:'r')::jsonb->>'restored' = '0' AND (:'r')::jsonb->>'remaining' = '0', 'a finished run reverts nothing');

\echo 'retire_duplicate_vehicle_image contract: ok'

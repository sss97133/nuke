-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_wrong_byte_image_holds -f this-file.sql
-- Contract for 20261016203000_hold_wrong_byte_images.sql. Synthetic rows only; never production.
-- The phone stored photos at users/<uid>/capture-relay/<camera filename>; a later photo with the same name got a row
-- pointing at the earlier photo's object. Starting from flag_duplicate_image and recompute_vehicle_primary_image as
-- production held them on 2026-10-15, this proves the holes (anon reads the wrong rows; a correct re-upload under a
-- content path is made a duplicate of the wrong row), then that hold_wrong_byte_images hides each wrong row with its
-- cause, records the old image_url, makes the right-bytes row canonical (a content-path row, or a hashed copy the item
-- names) and the wrong row its duplicate, recomputes the cover, refuses rows whose bytes match or whose path moved,
-- changes nothing in a dry run or a rerun, and runs for service_role only. After the migration the phone's
-- authenticated insert never picks a held row as the original. A second apply is a no-op and a drifted
-- flag_duplicate_image stops the migration unchanged.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;
-- raises(sql) is true when the statement fails.
CREATE FUNCTION pg_temp.raises(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN
  EXECUTE p_sql; RETURN false;
EXCEPTION WHEN others THEN RETURN true;
END $$;

-- The shapes the functions touch, the public read policy as production holds it, and a stand-in for the phone's
-- authenticated insert (it reads and writes its own rows in production).
CREATE TYPE public.vision_gate_status AS ENUM ('pending', 'approved', 'rejected_personal', 'rejected_misattributed', 'review_needed');
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, is_public boolean, primary_image_url text);
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid,
  image_url text, storage_path text, file_hash text, source text,
  taken_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), is_primary boolean DEFAULT false,
  is_superseded boolean, is_duplicate boolean, duplicate_of uuid, is_sensitive boolean,
  vision_gate_status public.vision_gate_status, vision_gate_agent_reasoning text, vision_gate_processed_at timestamptz,
  apple_ml_labels text[], image_vehicle_match_status text, ai_scan_metadata jsonb, file_size bigint, vehicle_zone text);
CREATE FUNCTION public.image_hero_score(meta jsonb, fsize bigint) RETURNS numeric LANGUAGE sql IMMUTABLE AS
$$ SELECT coalesce((meta->>'score')::numeric, 0) $$;
\ir helpers/recompute_vehicle_primary_image_live_20261015.sql
\ir ../migrations/20261016151000_device_triage_holds_and_public_cover.sql
\ir helpers/flag_duplicate_image_live_20261015.sql
CREATE TRIGGER trg_flag_duplicate_image BEFORE INSERT ON public.vehicle_images FOR EACH ROW EXECUTE FUNCTION public.flag_duplicate_image();
ALTER TABLE public.vehicle_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view images for public vehicles" ON public.vehicle_images FOR SELECT USING (
  COALESCE(is_sensitive, false) = false AND COALESCE(is_superseded, false) = false
  AND (vision_gate_status IS NULL OR vision_gate_status NOT IN ('rejected_personal', 'rejected_misattributed', 'review_needed'))
  AND EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vehicle_images.vehicle_id AND v.is_public = true));
CREATE POLICY phone_own_rows ON public.vehicle_images FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON public.vehicles TO anon, authenticated;
GRANT SELECT ON public.vehicle_images TO anon, authenticated;
GRANT INSERT ON public.vehicle_images TO authenticated;
SELECT pg_temp.ok('the fixtures are the live definitions (flag_duplicate_image md5, recompute_vehicle_primary_image sha256)',
  md5(pg_get_functiondef('public.flag_duplicate_image()'::regprocedure)) = '1646b35a2afde74919d53cc2d3041535' -- gitleaks:allow (function fingerprint, not a secret)
  AND (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') FROM pg_proc
        WHERE oid = 'public.recompute_vehicle_primary_image(uuid)'::regprocedure) = 'MgDQZsXwEQqIhsQx1W56iOxz05iAecjtdJ41YS/c58A=');

-- One owner. Photo hashes stand in for SHA-256 of the bytes.
SELECT encode(sha256('a'::bytea), 'hex') AS ha, encode(sha256('w1'::bytea), 'hex') AS hw1,
       encode(sha256('b'::bytea), 'hex') AS hb, encode(sha256('w2'::bytea), 'hex') AS hw2,
       encode(sha256('r'::bytea), 'hex') AS hr, encode(sha256('w3'::bytea), 'hex') AS hw3,
       encode(sha256('w5'::bytea), 'hex') AS hw5, encode(sha256('e'::bytea), 'hex') AS he \gset
\set u '00000000-0000-4000-9000-000000000001'
\set pfx 'users/00000000-0000-4000-9000-000000000001/capture-relay/'
\set url 'https://x.supabase.co/storage/v1/object/public/vehicle-photos/'
-- Vehicle P is public; its cover is W2. IMG_0001 holds photo A's bytes and rows of photos A, W1 and W1b (W1 again);
-- the iphoto copy I1 has photo W1's right bytes and was made a duplicate of W1. IMG_0002 holds photo B (whose row
-- never landed) and photo W2's row. IMG_0003 holds R's own bytes. IMG_0004 and IMG_0005 hold E's bytes.
INSERT INTO public.vehicles VALUES ('00000000-0000-4000-8000-00000000000a', true, :'url' || :'pfx' || 'IMG_0002.JPG');
INSERT INTO public.vehicle_images (id, vehicle_id, user_id, image_url, storage_path, file_hash, source, taken_at, created_at,
  is_primary, is_duplicate, duplicate_of, vision_gate_status, vision_gate_agent_reasoning, image_vehicle_match_status) VALUES
  ('00000000-0000-4000-a000-0000000000a0', NULL, :'u', :'url' || :'pfx' || 'IMG_0001.JPG', :'pfx' || 'IMG_0001.JPG', :'ha',
   'capture_relay_ios', '2016-05-01', '2026-06-12', false, false, NULL, 'pending', NULL, NULL),
  ('00000000-0000-4000-a000-0000000000a1', '00000000-0000-4000-8000-00000000000a', :'u', :'url' || :'pfx' || 'IMG_0001.JPG',
   NULL, :'hw1', 'capture_relay_ios', '2024-03-01', '2026-06-14', false, false, NULL, 'approved', 'engine bay', 'confirmed'),
  ('00000000-0000-4000-a000-0000000000a2', NULL, :'u', :'url' || :'pfx' || 'IMG_0001.JPG', :'pfx' || 'IMG_0001.JPG', :'hw1',
   'capture_relay_ios', '2024-03-01', '2026-06-15', false, true, '00000000-0000-4000-a000-0000000000a1', 'pending', NULL, NULL),
  ('00000000-0000-4000-a000-0000000000c1', NULL, :'u', :'url' || 'users/' || :'u' || '/photo-sync/ABC.jpg',
   'users/' || :'u' || '/photo-sync/ABC.jpg', :'hw1', 'iphoto', '2024-03-01', '2026-09-28', false, true,
   '00000000-0000-4000-a000-0000000000a1', 'pending', NULL, NULL),
  ('00000000-0000-4000-a000-0000000000b1', '00000000-0000-4000-8000-00000000000a', :'u', :'url' || :'pfx' || 'IMG_0002.JPG',
   :'pfx' || 'IMG_0002.JPG', :'hw2', 'capture_relay_ios', '2025-01-01', '2026-06-16', true, false, NULL, 'pending', NULL, 'confirmed'),
  ('00000000-0000-4000-a000-0000000000b9', '00000000-0000-4000-8000-00000000000a', :'u', :'url' || 'other/G.jpg',
   'other/G.jpg', :'he', 'iphoto', '2023-01-01', '2026-06-01', false, false, NULL, 'approved', NULL, 'confirmed'),
  ('00000000-0000-4000-a000-0000000000d1', NULL, :'u', :'url' || :'pfx' || 'IMG_0003.JPG', :'pfx' || 'IMG_0003.JPG', :'hr',
   'capture_relay_ios', '2025-02-01', '2026-06-17', false, false, NULL, 'pending', NULL, NULL),
  ('00000000-0000-4000-a000-0000000000e3', NULL, :'u', :'url' || :'pfx' || 'IMG_0004.JPG', :'pfx' || 'IMG_0004.JPG', :'hw3',
   'capture_relay_ios', '2025-03-01', '2026-06-18', false, false, NULL, NULL, NULL, NULL),
  ('00000000-0000-4000-a000-0000000000e5', NULL, :'u', :'url' || :'pfx' || 'IMG_0005.JPG', :'pfx' || 'IMG_0005.JPG', :'hw5',
   'capture_relay_ios', '2025-04-01', '2026-06-19', false, false, NULL, 'pending', NULL, NULL);

-- The holes, on the live definitions.
SET ROLE anon;
SELECT count(*) AS anon_before FROM public.vehicle_images WHERE id IN ('00000000-0000-4000-a000-0000000000a1', '00000000-0000-4000-a000-0000000000b1') \gset
RESET ROLE;
SELECT pg_temp.ok('before: anon reads both wrong rows filed on the public vehicle', :anon_before = 2);
SET ROLE authenticated;
INSERT INTO public.vehicle_images (id, user_id, image_url, storage_path, file_hash, source, created_at)
VALUES ('00000000-0000-4000-a000-0000000000c2', :'u', :'url' || :'pfx' || :'hw2' || '/IMG_0002.JPG',
        :'pfx' || :'hw2' || '/IMG_0002.JPG', :'hw2', 'capture_relay_ios', '2026-10-16');
RESET ROLE;
SELECT pg_temp.ok('before: the phone''s correct re-upload under a content path is made a duplicate of the wrong row',
  (SELECT is_duplicate AND duplicate_of = '00000000-0000-4000-a000-0000000000b1'
     FROM public.vehicle_images WHERE id = '00000000-0000-4000-a000-0000000000c2'));

\ir ../migrations/20261016203000_hold_wrong_byte_images.sql
\ir ../migrations/20261016203000_hold_wrong_byte_images.sql

CREATE FUNCTION pg_temp.snapshot() RETURNS text LANGUAGE sql AS $$
  SELECT md5(coalesce((SELECT string_agg(t::text, '|' ORDER BY t.id) FROM public.vehicle_images t), '')
          || coalesce((SELECT string_agg(m::text, '|' ORDER BY m.image_id) FROM public.vehicle_image_byte_mismatches m), '')
          || coalesce((SELECT string_agg(v::text, '|' ORDER BY v.id) FROM public.vehicles v), '')) $$;
SELECT jsonb_build_array(
  jsonb_build_object('image_id', '00000000-0000-4000-a000-0000000000a1', 'storage_path', :'pfx' || 'IMG_0001.JPG', 'object_sha256', :'ha',
                     'canonical_id', '00000000-0000-4000-a000-0000000000c1', 'canonical_storage_path', 'users/' || :'u' || '/photo-sync/ABC.jpg',
                     'canonical_sha256', :'hw1'),
  jsonb_build_object('image_id', '00000000-0000-4000-a000-0000000000a2', 'storage_path', :'pfx' || 'IMG_0001.JPG', 'object_sha256', :'ha',
                     'canonical_id', '00000000-0000-4000-a000-0000000000c1', 'canonical_storage_path', 'users/' || :'u' || '/photo-sync/ABC.jpg',
                     'canonical_sha256', :'hw1'),
  jsonb_build_object('image_id', '00000000-0000-4000-a000-0000000000b1', 'storage_path', :'pfx' || 'IMG_0002.JPG', 'object_sha256', :'hb'),
  jsonb_build_object('image_id', '00000000-0000-4000-a000-0000000000d1', 'storage_path', :'pfx' || 'IMG_0003.JPG', 'object_sha256', :'hr'),
  jsonb_build_object('image_id', '00000000-0000-4000-a000-0000000000a0', 'storage_path', :'pfx' || 'IMG_9999.JPG', 'object_sha256', :'hb'),
  jsonb_build_object('image_id', '00000000-0000-4000-a000-0000000000c2', 'storage_path', :'pfx' || :'hw2' || '/IMG_0002.JPG', 'object_sha256', :'hb'),
  jsonb_build_object('image_id', '00000000-0000-4000-a000-0000000000e5', 'storage_path', :'pfx' || 'IMG_0005.JPG', 'object_sha256', :'he',
                     'canonical_id', '00000000-0000-4000-a000-0000000000a0', 'canonical_storage_path', :'pfx' || 'IMG_0001.JPG',
                     'canonical_sha256', :'ha'),
  jsonb_build_object('image_id', '00000000-0000-4000-a000-0000000000ff', 'storage_path', :'pfx' || 'IMG_0009.JPG', 'object_sha256', :'he')
)::text AS items \gset

SELECT pg_temp.snapshot() AS snap0 \gset
SELECT public.hold_wrong_byte_images(:'items'::jsonb)::text AS dry \gset
SELECT pg_temp.ok('a dry run (the default) changes nothing and reports what it would do',
  pg_temp.snapshot() = :'snap0'
  AND (:'dry')::jsonb->'apply' = 'false'::jsonb
  AND (:'dry')::jsonb->'tally' = '{"held": 4, "linked": 3, "bytes_match": 1, "path_changed": 1, "unknown_image": 1,
                                  "not_filename_path": 1, "canonical_refused": 1}'::jsonb);

SELECT public.hold_wrong_byte_images(:'items'::jsonb, true, 'contract')::text AS applied \gset
SELECT pg_temp.ok('apply holds the four wrong rows, links three to a canonical row and refuses the rest',
  (:'applied')::jsonb->'tally' = '{"held": 4, "linked": 3, "bytes_match": 1, "path_changed": 1, "unknown_image": 1,
                                   "not_filename_path": 1, "canonical_refused": 1}'::jsonb
  AND (:'applied')::jsonb->'vehicles' = '1'::jsonb);
SELECT pg_temp.ok('a held row is rejected_misattributed with the cause, its old status and its prior reasoning',
  (SELECT vision_gate_status = 'rejected_misattributed'
          AND vision_gate_agent_reasoning LIKE 'Held: wrong bytes. Storage path ' || :'pfx' || 'IMG_0001.JPG is shared with a different photo (camera filename collision:%'
          AND vision_gate_agent_reasoning LIKE '%image_url shows sha256 ' || :'ha' || ', not the photo this row records (file_hash ' || :'hw1' || '). Was approved. Prior reasoning: engine bay'
          AND vision_gate_processed_at IS NOT NULL AND file_hash = :'hw1' AND image_url = :'url' || :'pfx' || 'IMG_0001.JPG'
     FROM public.vehicle_images WHERE id = '00000000-0000-4000-a000-0000000000a1'));
SELECT pg_temp.ok('the audit keeps the old image_url, both hashes, the prior gate and duplicate link, and the canonical link',
  (SELECT image_url = :'url' || :'pfx' || 'IMG_0001.JPG' AND storage_path = :'pfx' || 'IMG_0001.JPG'
          AND row_file_hash = :'hw1' AND object_sha256 = :'ha' AND prior_vision_gate_status = 'approved'
          AND prior_vision_gate_agent_reasoning = 'engine bay' AND prior_is_duplicate = false
          AND canonical_image_id = '00000000-0000-4000-a000-0000000000c1' AND canonical_via = 'hashed_copy'
          AND run_label = 'contract' AND vehicle_id = '00000000-0000-4000-8000-00000000000a'
     FROM public.vehicle_image_byte_mismatches WHERE image_id = '00000000-0000-4000-a000-0000000000a1')
  AND (SELECT count(*) FROM public.vehicle_image_byte_mismatches) = 4
  AND (SELECT prior_vision_gate_status = 'pending' AND canonical_image_id IS NULL
         FROM public.vehicle_image_byte_mismatches WHERE image_id = '00000000-0000-4000-a000-0000000000e5'));
SELECT pg_temp.ok('the hashed copy becomes canonical and every row of that photo, wrong or not, points at it',
  (SELECT is_duplicate = false AND duplicate_of IS NULL FROM public.vehicle_images WHERE id = '00000000-0000-4000-a000-0000000000c1')
  AND (SELECT bool_and(is_duplicate AND duplicate_of = '00000000-0000-4000-a000-0000000000c1')
         FROM public.vehicle_images WHERE id IN ('00000000-0000-4000-a000-0000000000a1', '00000000-0000-4000-a000-0000000000a2')));
SELECT pg_temp.ok('the correct re-upload under a content path becomes canonical, the wrong row its duplicate',
  (SELECT is_duplicate = false AND duplicate_of IS NULL FROM public.vehicle_images WHERE id = '00000000-0000-4000-a000-0000000000c2')
  AND (SELECT is_duplicate AND duplicate_of = '00000000-0000-4000-a000-0000000000c2' FROM public.vehicle_images WHERE id = '00000000-0000-4000-a000-0000000000b1')
  AND (SELECT canonical_via = 'content_path' AND canonical_changes @> '[{"change": "made_canonical"}, {"change": "wrong_row_points_at_canonical"}]'::jsonb
         FROM public.vehicle_image_byte_mismatches WHERE image_id = '00000000-0000-4000-a000-0000000000b1'));
SET ROLE anon;
SELECT count(*) FILTER (WHERE id IN ('00000000-0000-4000-a000-0000000000a1', '00000000-0000-4000-a000-0000000000b1')) AS anon_wrong,
       count(*) FILTER (WHERE id = '00000000-0000-4000-a000-0000000000b9') AS anon_good FROM public.vehicle_images \gset
RESET ROLE;
SELECT pg_temp.ok('after: anon reads neither wrong row, and still reads the vehicle''s good frame', :anon_wrong = 0 AND :anon_good = 1);
SELECT pg_temp.ok('the held cover is replaced by a frame the public may read',
  (SELECT primary_image_url = :'url' || 'other/G.jpg' FROM public.vehicles WHERE id = '00000000-0000-4000-8000-00000000000a')
  AND (SELECT is_primary FROM public.vehicle_images WHERE id = '00000000-0000-4000-a000-0000000000b9')
  AND NOT (SELECT is_primary FROM public.vehicle_images WHERE id = '00000000-0000-4000-a000-0000000000b1'));
SELECT pg_temp.ok('refused rows are untouched: bytes that match, a moved path, a content path',
  (SELECT vision_gate_status = 'pending' FROM public.vehicle_images WHERE id = '00000000-0000-4000-a000-0000000000d1')
  AND (SELECT vision_gate_status = 'pending' AND NOT is_duplicate FROM public.vehicle_images WHERE id = '00000000-0000-4000-a000-0000000000a0')
  AND NOT EXISTS (SELECT 1 FROM public.vehicle_image_byte_mismatches
                   WHERE image_id IN ('00000000-0000-4000-a000-0000000000d1', '00000000-0000-4000-a000-0000000000a0', '00000000-0000-4000-a000-0000000000c2')));

SELECT pg_temp.snapshot() AS snap1 \gset
SELECT public.hold_wrong_byte_images(:'items'::jsonb, true, 'contract rerun')::text AS rerun \gset
SELECT pg_temp.ok('a rerun is a no-op',
  pg_temp.snapshot() = :'snap1'
  AND (:'rerun')::jsonb->'tally' = '{"already_held": 4, "linked_already": 3, "bytes_match": 1, "path_changed": 1,
                                     "unknown_image": 1, "not_filename_path": 1, "canonical_refused": 1}'::jsonb
  AND (:'rerun')::jsonb->'vehicles' = '0'::jsonb);

-- After the migration: W3 is held with no right-bytes row yet. The phone's re-upload of W3 is not marked a duplicate
-- of it, and the next run links W3 to the re-upload. A re-upload of W1 picks W1's canonical copy, never the held rows.
SELECT public.hold_wrong_byte_images(jsonb_build_array(jsonb_build_object('image_id', '00000000-0000-4000-a000-0000000000e3',
  'storage_path', :'pfx' || 'IMG_0004.JPG', 'object_sha256', :'he')), true)->'tally' = '{"held": 1}'::jsonb AS w3_held \gset
SET ROLE authenticated;
INSERT INTO public.vehicle_images (id, user_id, image_url, storage_path, file_hash, source) VALUES
  ('00000000-0000-4000-a000-0000000000c3', :'u', :'url' || :'pfx' || :'hw3' || '/IMG_0004.JPG', :'pfx' || :'hw3' || '/IMG_0004.JPG', :'hw3', 'capture_relay_ios'),
  ('00000000-0000-4000-a000-0000000000c4', :'u', :'url' || :'pfx' || :'hw1' || '/IMG_0001.JPG', :'pfx' || :'hw1' || '/IMG_0001.JPG', :'hw1', 'capture_relay_ios');
RESET ROLE;
SELECT pg_temp.ok('the authenticated insert never takes a held row as the original',
  :'w3_held'::boolean
  AND (SELECT is_duplicate IS NOT TRUE AND duplicate_of IS NULL FROM public.vehicle_images WHERE id = '00000000-0000-4000-a000-0000000000c3')
  AND (SELECT is_duplicate AND duplicate_of = '00000000-0000-4000-a000-0000000000c1' FROM public.vehicle_images WHERE id = '00000000-0000-4000-a000-0000000000c4'));
SELECT public.hold_wrong_byte_images(jsonb_build_array((:'items'::jsonb)->0), true)::text AS w1_again \gset
SELECT pg_temp.ok('a content-path re-upload arriving later does not move a link already made',
  (:'w1_again')::jsonb->'tally' = '{"already_held": 1, "linked_already": 1}'::jsonb
  AND (SELECT duplicate_of = '00000000-0000-4000-a000-0000000000c1' FROM public.vehicle_images WHERE id = '00000000-0000-4000-a000-0000000000a1'));
SELECT public.hold_wrong_byte_images(jsonb_build_array(jsonb_build_object('image_id', '00000000-0000-4000-a000-0000000000e3',
  'storage_path', :'pfx' || 'IMG_0004.JPG', 'object_sha256', :'he')), true)::text AS w3_link \gset
SELECT pg_temp.ok('a later run links the held row to the re-upload that arrived',
  (:'w3_link')::jsonb->'tally' = '{"already_held": 1, "linked": 1}'::jsonb
  AND (SELECT is_duplicate AND duplicate_of = '00000000-0000-4000-a000-0000000000c3' FROM public.vehicle_images WHERE id = '00000000-0000-4000-a000-0000000000e3')
  AND (SELECT is_duplicate IS NOT TRUE FROM public.vehicle_images WHERE id = '00000000-0000-4000-a000-0000000000c3'));

SELECT pg_temp.ok('malformed items are refused whole',
  pg_temp.raises($q$SELECT public.hold_wrong_byte_images('{"image_id": "x"}'::jsonb, true)$q$)
  AND pg_temp.raises(format($q$SELECT public.hold_wrong_byte_images('[{"image_id": "00000000-0000-4000-a000-0000000000d1", "storage_path": "p", "object_sha256": "ABC"}]'::jsonb, true)$q$))
  AND pg_temp.raises(format($q$SELECT public.hold_wrong_byte_images('[{"image_id": "00000000-0000-4000-a000-0000000000d1", "object_sha256": "%s"}]'::jsonb, true)$q$, :'he'))
  AND pg_temp.raises(format($q$SELECT public.hold_wrong_byte_images('[{"image_id": "00000000-0000-4000-a000-0000000000d1", "storage_path": "p", "object_sha256": "%s", "canonical_id": "00000000-0000-4000-a000-0000000000a0"}]'::jsonb, true)$q$, :'he'))
  AND pg_temp.raises(format($q$SELECT public.hold_wrong_byte_images((SELECT jsonb_agg(jsonb_build_object('image_id', '00000000-0000-4000-a000-0000000000d1', 'storage_path', 'p', 'object_sha256', '%s')) FROM generate_series(1, 501)), true)$q$, :'he'))
  AND (SELECT vision_gate_status = 'pending' FROM public.vehicle_images WHERE id = '00000000-0000-4000-a000-0000000000d1'));
SELECT pg_temp.ok('only service_role may run the writer or read the audit; it runs with definer rights',
  NOT has_function_privilege('public', 'public.hold_wrong_byte_images(jsonb,boolean,text)', 'execute')
  AND NOT has_function_privilege('anon', 'public.hold_wrong_byte_images(jsonb,boolean,text)', 'execute')
  AND NOT has_function_privilege('authenticated', 'public.hold_wrong_byte_images(jsonb,boolean,text)', 'execute')
  AND has_function_privilege('service_role', 'public.hold_wrong_byte_images(jsonb,boolean,text)', 'execute')
  AND (SELECT prosecdef FROM pg_proc WHERE oid = 'public.hold_wrong_byte_images(jsonb,boolean,text)'::regprocedure)
  AND NOT has_table_privilege('anon', 'public.vehicle_image_byte_mismatches', 'select')
  AND NOT has_table_privilege('authenticated', 'public.vehicle_image_byte_mismatches', 'select')
  AND NOT has_table_privilege('service_role', 'public.vehicle_image_byte_mismatches', 'insert')
  AND has_table_privilege('service_role', 'public.vehicle_image_byte_mismatches', 'select'));
SET ROLE authenticated;
SELECT pg_temp.raises($q$SELECT public.hold_wrong_byte_images('[]'::jsonb)$q$) AS auth_refused,
       pg_temp.raises($q$SELECT count(*) FROM public.vehicle_image_byte_mismatches$q$) AS audit_refused \gset
RESET ROLE;
SELECT pg_temp.ok('as authenticated, calling the writer or reading the audit fails', :'auth_refused'::boolean AND :'audit_refused'::boolean);

-- A drifted flag_duplicate_image stops the migration and leaves it as it was.
CREATE OR REPLACE FUNCTION public.flag_duplicate_image() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
\set ON_ERROR_STOP off
\ir ../migrations/20261016203000_hold_wrong_byte_images.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok('a drifted flag_duplicate_image stops the migration unchanged',
  pg_get_functiondef('public.flag_duplicate_image()'::regprocedure) NOT LIKE '%vehicle_image_holds_wrong_bytes%');

-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_<name> -f supabase/sql/test_cover_class_no_view_scan.sql
-- Proves 20261126054500_cover_class_no_view_scan.sql:
--   * Before, with the live get_first_image_batch body: over the live view shape (ai_scan_metadata a plain column) anon's
--     cover for car A is the front three-quarter frame. Over the #3935 view shape (the column is a per-row lateral call
--     to vehicle_image_scan_metadata, here a stub that withholds the narrative from a stranger), the reader runs once
--     for every candidate photo of the car (42 here) and the cover moves to another frame.
--   * After: over both view shapes anon's cover is the front three-quarter frame, and over the #3935 shape the reader
--     runs only for the row the admission step reads (1), not for every candidate.
--   * vehicle_image_cover_class: the class from the photo's stored reading for a shown photo on a public car; NULL to
--     anon for a photo on a private car and for a sensitive photo; the owner (tied) reads the private car's class.
--   * Definer, search_path, grants; a second apply is a no-op; the revert restores the live body (md5) and drops the
--     helper.
-- Which assertion fails if the fix is removed: "after, #3935 view: anon's cover reads the reader once, not per
-- candidate" (and "after, #3935 view: the cover is the front three-quarter frame").
-- Fixture rows only, in a disposable database. -- ALLOW_RAW_TESTIMONY_WRITE
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Empty disposable PG17 database required';
  END IF;
END $$;
SET TimeZone = 'UTC';
CREATE SCHEMA auth;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claims', true)::jsonb->>'role' $$;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated, service_role;

CREATE TABLE public.vehicles (id uuid PRIMARY KEY, is_public boolean, deleted_at timestamptz, user_id uuid, owner_id uuid,
  uploaded_by uuid, created_by_user_id uuid);
GRANT SELECT (id, is_public, deleted_at) ON public.vehicles TO anon, authenticated;
-- The columns get_first_image_batch and the helper read; ai_scan_metadata last so the #3935 view shape keeps the order.
-- guardrail-allow(center-key-fk): vehicle_images.user_id: auth.users is not part of this fixture
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY, vehicle_id uuid REFERENCES public.vehicles(id), user_id uuid,
  image_url text, is_document boolean, is_duplicate boolean, is_superseded boolean, is_video boolean, source text,
  is_sensitive boolean, is_primary boolean, image_vehicle_match_status text, image_medium text, image_category text,
  vision_gate_status text, vehicle_zone text, ai_detected_angle text, angle text, photo_quality_score numeric,
  taken_at timestamptz, created_at timestamptz DEFAULT now(), ai_scan_metadata jsonb);
ALTER TABLE public.vehicle_images ENABLE ROW LEVEL SECURITY;
-- Fixture policy: a photo on a public non-deleted car, or the caller's own upload.
CREATE POLICY fixture_read ON public.vehicle_images FOR SELECT USING (
  COALESCE((SELECT v.is_public AND v.deleted_at IS NULL FROM public.vehicles v WHERE v.id = vehicle_id), false)
  OR user_id = auth.uid());
GRANT SELECT ON public.vehicle_images TO anon, authenticated, service_role;
-- The live view shape (2026-11-25): every column of the table, security_invoker.
CREATE VIEW public.vehicle_images_public WITH (security_invoker = true) AS SELECT * FROM public.vehicle_images;
GRANT SELECT ON public.vehicle_images_public TO anon, authenticated, service_role;
-- Gallery admission stub over the view's row type (whole-row, like the live overload).
CREATE FUNCTION public.vehicle_image_gallery_eligible(r public.vehicle_images_public) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE(r.is_sensitive, false) = false AND r.image_url IS NOT NULL $$;
-- Tied stub: the owner fields, or service_role (the live body also reads access rows).
CREATE FUNCTION public.vehicle_viewer_tied(p_vehicle_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT CASE WHEN auth.role() = 'service_role' THEN true WHEN auth.uid() IS NULL THEN false
    ELSE COALESCE((SELECT auth.uid() IN (v.owner_id, v.user_id, v.created_by_user_id, v.uploaded_by) FROM public.vehicles v
                   WHERE v.id = p_vehicle_id), false) END $$;
GRANT EXECUTE ON FUNCTION public.vehicle_viewer_tied(uuid) TO anon, authenticated, service_role;
-- #3935's id-keyed reader, stubbed: the stored document, without the narrative for a caller who did not upload it.
CREATE FUNCTION public.vehicle_image_scan_metadata(p_image_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  RETURN (SELECT CASE WHEN i.user_id = auth.uid() THEN i.ai_scan_metadata
                      ELSE i.ai_scan_metadata #- '{byok_deep_analysis,narrative_one_line}' END
            FROM public.vehicle_images i WHERE i.id = p_image_id);
END $$;
GRANT EXECUTE ON FUNCTION public.vehicle_image_scan_metadata(uuid) TO anon, authenticated, service_role;

\ir fixtures/cover_class_live_20261125.sql

CREATE FUNCTION public.t_assert(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', label; END IF;
  RAISE NOTICE 'PASS: %', label;
END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text) TO anon, authenticated, service_role;
-- The view in its live shape or in #3935's shape (the column read through the per-row lateral reader).
CREATE FUNCTION public.t_view(p_shape text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_shape = '3935' THEN
    CREATE OR REPLACE VIEW public.vehicle_images_public WITH (security_invoker = true) AS
      SELECT vi.id, vi.vehicle_id, vi.user_id, vi.image_url, vi.is_document, vi.is_duplicate, vi.is_superseded, vi.is_video,
             vi.source, vi.is_sensitive, vi.is_primary, vi.image_vehicle_match_status, vi.image_medium, vi.image_category,
             vi.vision_gate_status, vi.vehicle_zone, vi.ai_detected_angle, vi.angle, vi.photo_quality_score, vi.taken_at,
             vi.created_at, s.ai_scan_metadata
        FROM public.vehicle_images vi
        CROSS JOIN LATERAL (SELECT public.vehicle_image_scan_metadata(vi.id) AS ai_scan_metadata OFFSET 0) s;
  ELSE
    CREATE OR REPLACE VIEW public.vehicle_images_public WITH (security_invoker = true) AS SELECT * FROM public.vehicle_images;
  END IF;
END $$;
-- Anon's cover for car A, and how many times the reader ran in that statement.
CREATE TABLE public.t_out (k text PRIMARY KEY, v text);
GRANT ALL ON public.t_out TO anon, authenticated;

SELECT public.t_assert((SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.garage_cover_class(text, text, text, jsonb)'::regprocedure)
    = 'd3be3995a8332d517727f9ae6a157c4c'
  AND (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.get_first_image_batch(uuid[])'::regprocedure) = '85270c6febe8ba121a7e4f3d5dac4298',
  'fixture bodies hash to production''s 2026-11-25 text');

-- Rows. Car A (public, owner u1): two approved whole-car frames with stored readings, the same zone, angle and category.
-- Frame "front" is read as a front three-quarter view (class 0 view rank), frame "rear" as a rear view but with the better
-- quality score, so it wins whenever the narrative is not read. 40 interior photos make the candidate list long.
-- Car B (private, owner u1): one approved frame with a reading, uploaded by u2 (so the owner reads it as tied, not as uploader). Car A also holds a sensitive approved frame.
INSERT INTO public.vehicles VALUES
  ('a0000000-0000-0000-0000-00000000000a', true, NULL, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', NULL, NULL),
  ('b0000000-0000-0000-0000-00000000000b', false, NULL, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', NULL, NULL);
INSERT INTO public.vehicle_images (id, vehicle_id, user_id, image_url, source, vision_gate_status, angle, image_category,
  photo_quality_score, taken_at, ai_scan_metadata) VALUES
  ('10000000-0000-0000-0000-00000000000f', 'a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001',
   'https://x.invalid/front.jpg', 'user_upload', 'approved', 'exterior', 'exterior_body', 0.5, '2026-11-20',
   '{"byok_deep_analysis": {"scene_type": "body_exterior", "camera_pose": {"distance_est": "5 m"},
     "narrative_one_line": "front three-quarter view of the truck in the driveway"}}'),
  ('10000000-0000-0000-0000-00000000000e', 'a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001',
   'https://x.invalid/rear.jpg', 'user_upload', 'approved', 'exterior', 'exterior_body', 0.9, '2026-11-20',
   '{"byok_deep_analysis": {"scene_type": "body_exterior", "camera_pose": {"distance_est": "5 m"},
     "narrative_one_line": "rear view of the truck in the driveway"}}'),
  ('10000000-0000-0000-0000-00000000005e', 'a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001',
   'https://x.invalid/sensitive.jpg', 'user_upload', 'approved', 'exterior', 'exterior_body', 0.1, '2026-11-20',
   '{"byok_deep_analysis": {"scene_type": "body_exterior", "camera_pose": {"distance_est": "5 m"}}}'),
  ('20000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000002',
   'https://x.invalid/private.jpg', 'user_upload', 'approved', 'exterior', 'exterior_body', 0.9, '2026-11-20',
   '{"byok_deep_analysis": {"scene_type": "body_exterior", "camera_pose": {"distance_est": "5 m"},
     "narrative_one_line": "front three-quarter view"}}');
UPDATE public.vehicle_images SET is_sensitive = true WHERE id = '10000000-0000-0000-0000-00000000005e';
INSERT INTO public.vehicle_images (id, vehicle_id, user_id, image_url, source, image_category, photo_quality_score, taken_at, ai_scan_metadata)
SELECT ('30000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'a0000000-0000-0000-0000-00000000000a',
       '00000000-0000-0000-0000-000000000001', 'https://x.invalid/in' || n || '.jpg', 'user_upload', 'interior', 0.1, '2026-11-19',
       '{"byok_deep_analysis": {"scene_type": "interior", "narrative_one_line": "dash and seats"}}'
FROM generate_series(1, 40) n;
ANALYZE public.vehicle_images;

-- t_cover(key): as anon, car A's cover url and the reader's call count in that transaction, into t_out.
CREATE FUNCTION public.t_cover(p_key text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE u text; c bigint; c0 bigint;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SET LOCAL track_functions = 'all';
  -- the session's pending function counts survive transaction ends until they are flushed, so count the difference
  SELECT coalesce((SELECT calls FROM pg_stat_xact_user_functions WHERE funcname = 'vehicle_image_scan_metadata'), 0) INTO c0;
  SET LOCAL ROLE anon;
  SELECT b.image_url INTO u FROM public.get_first_image_batch(ARRAY['a0000000-0000-0000-0000-00000000000a'::uuid]) b;
  RESET ROLE;
  SELECT coalesce((SELECT calls FROM pg_stat_xact_user_functions WHERE funcname = 'vehicle_image_scan_metadata'), 0) - c0 INTO c;
  INSERT INTO public.t_out VALUES (p_key || '_url', u), (p_key || '_calls', c::text)
    ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v;
END $$;
CREATE FUNCTION public.t_get(p_key text) RETURNS text LANGUAGE sql AS $$ SELECT coalesce((SELECT v FROM public.t_out WHERE k = p_key), 'none') $$;

-- Before: the live body over both view shapes.
BEGIN; SELECT public.t_view('live'); SELECT public.t_cover('b_live'); COMMIT;
BEGIN; SELECT public.t_view('3935'); SELECT public.t_cover('b_3935'); COMMIT;
SELECT public.t_assert(public.t_get('b_live_url') = 'https://x.invalid/front.jpg' AND public.t_get('b_live_calls') = '0',
  'before, live view: anon''s cover is the front three-quarter frame (' || public.t_get('b_live_url') || ')');
SELECT public.t_assert(public.t_get('b_3935_calls')::int = 42 AND public.t_get('b_3935_url') = 'https://x.invalid/rear.jpg',
  'before, #3935 view: the reader runs for every candidate (' || public.t_get('b_3935_calls') || ' calls) and the cover moves ('
  || public.t_get('b_3935_url') || ')');

-- The migration, applied over the live view shape, then again (a no-op).
SELECT public.t_view('live');
\ir ../migrations/20261126054500_cover_class_no_view_scan.sql
\ir ../migrations/20261126054500_cover_class_no_view_scan.sql
SELECT public.t_assert(
  (SELECT prosecdef AND proconfig = '{"search_path=pg_catalog, public"}' FROM pg_proc WHERE oid = 'public.vehicle_image_cover_class(uuid)'::regprocedure)
  AND has_function_privilege('anon', 'public.vehicle_image_cover_class(uuid)', 'EXECUTE')
  AND has_function_privilege('anon', 'public.get_first_image_batch(uuid[])', 'EXECUTE')
  AND (SELECT count(*) FROM pg_proc WHERE proname = 'get_first_image_batch') = 1
  AND (SELECT prosrc FROM pg_proc WHERE proname = 'get_first_image_batch') !~ 'ai_scan_metadata',
  'helper is definer with a fixed search_path; grants kept; the batch body no longer names ai_scan_metadata; second apply a no-op');

BEGIN; SELECT public.t_view('live'); SELECT public.t_cover('a_live'); COMMIT;
BEGIN; SELECT public.t_view('3935'); SELECT public.t_cover('a_3935'); COMMIT;
SELECT public.t_assert(public.t_get('a_live_url') = 'https://x.invalid/front.jpg',
  'after, live view: the cover is unchanged (' || public.t_get('a_live_url') || ')');
SELECT public.t_assert(public.t_get('a_3935_url') = 'https://x.invalid/front.jpg',
  'after, #3935 view: the cover is the front three-quarter frame (' || public.t_get('a_3935_url') || ')');
SELECT public.t_assert(public.t_get('a_3935_calls')::int <= 1,
  'after, #3935 view: anon''s cover reads the reader once, not per candidate (' || public.t_get('a_3935_calls') || ' calls)');

-- The helper's gate.
BEGIN;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true); SET LOCAL ROLE anon;
SELECT public.vehicle_image_cover_class('10000000-0000-0000-0000-00000000000f')::text AS h_front,
       coalesce(public.vehicle_image_cover_class('20000000-0000-0000-0000-00000000000b')::text, 'null') AS h_private,
       coalesce(public.vehicle_image_cover_class('10000000-0000-0000-0000-00000000005e')::text, 'null') AS h_sens,
       coalesce(public.vehicle_image_cover_class('99999999-0000-0000-0000-000000000000')::text, 'null') AS h_none \gset
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001"}', true);
SET LOCAL ROLE authenticated;
SELECT coalesce(public.vehicle_image_cover_class('20000000-0000-0000-0000-00000000000b')::text, 'null') AS h_owner_private \gset
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000009"}', true);
SET LOCAL ROLE authenticated;
SELECT coalesce(public.vehicle_image_cover_class('20000000-0000-0000-0000-00000000000b')::text, 'null') AS h_stranger_private \gset
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000002"}', true);
SET LOCAL ROLE authenticated;
SELECT coalesce(public.vehicle_image_cover_class('20000000-0000-0000-0000-00000000000b')::text, 'null') AS h_uploader_private \gset
RESET ROLE;
UPDATE public.vehicles SET deleted_at = now() WHERE id = 'a0000000-0000-0000-0000-00000000000a';
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true); SET LOCAL ROLE anon;
SELECT coalesce(public.vehicle_image_cover_class('10000000-0000-0000-0000-00000000000f')::text, 'null') AS h_deleted \gset
ROLLBACK;
SELECT public.t_assert(:'h_front' = (SELECT public.garage_cover_class(vehicle_zone, coalesce(ai_detected_angle, angle), image_category,
    ai_scan_metadata -> 'byok_deep_analysis')::text FROM public.vehicle_images WHERE id = '10000000-0000-0000-0000-00000000000f'),
  'helper: anon gets the class of the stored reading for a shown photo on a public car (' || :'h_front' || ')');
SELECT public.t_assert(:'h_private' = 'null' AND :'h_stranger_private' = 'null' AND :'h_owner_private' <> 'null'
  AND :'h_uploader_private' <> 'null',
  'helper: a private car''s photo has no class for anon or a signed-in stranger; the owner (tied) and the uploader read it');
SELECT public.t_assert(:'h_deleted' = 'null', 'helper: a photo on a deleted public car gives NULL');
SELECT public.t_assert(:'h_sens' = 'null' AND :'h_none' = 'null', 'helper: a sensitive photo and an unknown id give NULL');

-- The revert restores the live body (its own md5 check) and drops the helper; the defect is back.
\ir revert_20261126054500_cover_class_no_view_scan.sql
BEGIN; SELECT public.t_view('3935'); SELECT public.t_cover('r_3935'); COMMIT;
SELECT public.t_assert(to_regprocedure('public.vehicle_image_cover_class(uuid)') IS NULL
  AND public.t_get('r_3935_calls')::int = 42,
  'revert: the helper is gone and the reader runs per candidate again (' || public.t_get('r_3935_calls') || ' calls)');

SELECT 'cover_class_no_view_scan contract: PASS' AS result;

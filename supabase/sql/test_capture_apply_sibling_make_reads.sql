-- Sibling make reads (20261113120300): capture_sets_apply's make veto counts the reads of segment siblings already filed on
-- the target; siblings on other vehicles never count; a set whose reads mostly contradict the target is still refused.
-- Requires empty disposable dm_refinement_capture_apply_sibling_make_reads* database.
\set ON_ERROR_STOP on
SET client_min_messages = warning;
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_apply_sibling_make_reads%' THEN RAISE EXCEPTION 'refusing: not a disposable contract database'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;
CREATE TYPE public.vision_gate_status AS ENUM ('pending', 'approved', 'rejected_personal', 'rejected_misattributed');
CREATE TYPE public.content_approval_status AS ENUM ('pending', 'approved');
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, owner_id uuid, user_id uuid, vin text, make text, deleted_at timestamptz, merged_into_vehicle_id uuid);
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, is_duplicate boolean, is_sensitive boolean,
  vision_gate_status public.vision_gate_status DEFAULT 'pending', is_approved boolean, approval_status public.content_approval_status, is_primary boolean,
  is_document boolean, vehicle_vin text, vehicle_vin_confidence numeric, ai_scan_metadata jsonb);
CREATE TABLE public.capture_set_candidates (run_id uuid, set_key text, vehicle_id uuid, user_id uuid, method text, rank int, band text,
  revoked_at timestamptz, image_ids uuid[], signals jsonb);
CREATE TABLE public.capture_set_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid, set_key text, image_id uuid, vehicle_id uuid,
  confidence numeric, evidence jsonb, before_image jsonb, result jsonb, created_at timestamptz DEFAULT now(), reverted_at timestamptz);
CREATE TABLE public.image_text_reads (image_id uuid, revoked_at timestamptz, vin_candidates jsonb);
CREATE TABLE public.vehicle_identifier_observations (image_id uuid, user_id uuid, kind text, status text, confidence numeric, value_norm text);
CREATE FUNCTION public.vin_match_key(text) RETURNS text LANGUAGE sql AS $$ SELECT upper($1) $$;
CREATE FUNCTION public.capture_vin_plausible(text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.record_vin_upload_exposures(uuid, uuid, uuid[]) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.capture_sets_score(p_user uuid, p_from timestamptz, p_to timestamptz, p_mode text, p_only uuid[], p_prov jsonb DEFAULT NULL)
  RETURNS TABLE(vehicle_id uuid, rank int, signals jsonb) LANGUAGE sql AS $$
  SELECT '00000000-0000-4000-8000-0000000000f1'::uuid, 1, '{"score": 6.4, "margin_raw": 6.3}'::jsonb $$;
CREATE FUNCTION public.attribute_testimony(p_type text, p_img uuid, p_veh uuid, p_reason text, p_user uuid, p_conf numeric, p_signal text)
  RETURNS jsonb LANGUAGE sql AS $$
  UPDATE vehicle_images SET vehicle_id = p_veh WHERE id = p_img AND vehicle_id IS NULL;
  SELECT jsonb_build_object('success', true, 'new_vehicle_id', p_veh) $$;

\i supabase/sql/revert_20261113120300_capture_apply_sibling_make_reads.sql
SELECT pg_temp.assert_true(md5(pg_get_functiondef('public.capture_sets_apply(uuid, uuid, jsonb, numeric)'::regprocedure)) = 'a91e17f5078d5890a46f0a8e5ab39439',
  'the stand-in is the live body the migration pins');

CREATE FUNCTION pg_temp.u() RETURNS uuid LANGUAGE sql AS $$ SELECT '00000000-0000-4000-8000-0000000000aa'::uuid $$;
CREATE FUNCTION pg_temp.i(n int) RETURNS uuid LANGUAGE sql AS $$ SELECT ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.make(m text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('classification', jsonb_build_object('v2', jsonb_build_object('vehicle_fields',
         jsonb_build_array(jsonb_build_object('field_name', 'make', 'value', m, 'confidence', 0.9))))) $$;
-- target F1 Pontiac; other vehicle F2 Chevrolet. Set: new photo 1 (misread "Corvette"); siblings 2-9 filed on F1 (Pontiac);
-- siblings 10-13 filed on F2 ("Corvette"): they must not count.
CREATE FUNCTION pg_temp.fixtures(sibling_make text) RETURNS jsonb LANGUAGE sql AS $$
  TRUNCATE vehicles, vehicle_images, capture_set_candidates, capture_set_links;
  INSERT INTO vehicles(id, owner_id, make) VALUES ('00000000-0000-4000-8000-0000000000f1', pg_temp.u(), 'Pontiac'), ('00000000-0000-4000-8000-0000000000f2', pg_temp.u(), 'Chevrolet');
  INSERT INTO vehicle_images(id, user_id, vehicle_id, ai_scan_metadata) VALUES (pg_temp.i(1), pg_temp.u(), NULL, pg_temp.make('Corvette'));
  INSERT INTO vehicle_images(id, user_id, vehicle_id, ai_scan_metadata) SELECT pg_temp.i(n), pg_temp.u(), '00000000-0000-4000-8000-0000000000f1', pg_temp.make(sibling_make) FROM generate_series(2, 9) n;
  INSERT INTO vehicle_images(id, user_id, vehicle_id, ai_scan_metadata) SELECT pg_temp.i(n), pg_temp.u(), '00000000-0000-4000-8000-0000000000f2', pg_temp.make('Corvette') FROM generate_series(10, 13) n;
  INSERT INTO capture_set_candidates VALUES ('00000000-0000-4000-8000-00000000e001', 's1', '00000000-0000-4000-8000-0000000000f1', pg_temp.u(), 'scored_session_v1', 1, 'clear', NULL,
    ARRAY[pg_temp.i(1)], '{"score": 6.4, "margin_raw": 6.3}');
  SELECT jsonb_build_array(jsonb_build_object('set_key', 's1', 'vehicle_id', '00000000-0000-4000-8000-0000000000f1', 'image_ids', jsonb_build_array(pg_temp.i(1)),
    'segment_ids', (SELECT jsonb_agg(pg_temp.i(n)) FROM generate_series(1, 13) n), 'confidence', 0.99, 'basis', 'scored_session'))
$$;
CREATE FUNCTION pg_temp.apply(items jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.capture_sets_apply('00000000-0000-4000-8000-00000000e001', pg_temp.u(), items, 0.6) $$;

-- before: the lone new photo's misread vetoes the set although 8 filed siblings read Pontiac
SELECT pg_temp.apply(pg_temp.fixtures('Pontiac')) AS r \gset
SELECT pg_temp.assert_true(((:'r')::jsonb->>'photos_filed')::int = 0 AND (:'r')::jsonb->'sets_refused' ? 's1', 'before: a 1-photo set with one misread is refused');

\i supabase/migrations/20261113120300_capture_apply_sibling_make_reads.sql
-- after: 1 contra of 9 reads (siblings on F1 count, the 4 on F2 do not) -> filed
SELECT pg_temp.apply(pg_temp.fixtures('Pontiac')) AS r \gset
SELECT pg_temp.assert_true(((:'r')::jsonb->>'photos_filed')::int = 1 AND (SELECT vehicle_id FROM vehicle_images WHERE id = pg_temp.i(1)) = '00000000-0000-4000-8000-0000000000f1',
  'after: the photo is judged with its filed siblings and files');
-- siblings on another vehicle never count: if they did, 5 contras of 13 reads would veto
SELECT pg_temp.assert_true((SELECT count(*) FROM vehicle_images WHERE vehicle_id = '00000000-0000-4000-8000-0000000000f2') = 4, 'other-vehicle siblings untouched');
-- the veto still works: siblings on the target that also read a different make keep the set refused
SELECT pg_temp.apply(pg_temp.fixtures('Corvette')) AS r \gset
SELECT pg_temp.assert_true(((:'r')::jsonb->>'photos_filed')::int = 0 AND (SELECT vehicle_id FROM vehicle_images WHERE id = pg_temp.i(1)) IS NULL,
  'after: a set whose reads (own + filed siblings) contradict the target is still refused');

\i supabase/sql/revert_20261113120300_capture_apply_sibling_make_reads.sql
SELECT pg_temp.assert_true(md5(pg_get_functiondef('public.capture_sets_apply(uuid, uuid, jsonb, numeric)'::regprocedure)) = 'a91e17f5078d5890a46f0a8e5ab39439', 'revert restores the live body');
SELECT 'capture apply sibling make reads contract: ok' AS result;

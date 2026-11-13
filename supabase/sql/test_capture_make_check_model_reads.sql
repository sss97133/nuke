-- Model-name make reads (20261113120400): a classifier make read naming the target's model ("Mustang" on a Ford Mustang)
-- does not count against the target; reads of another make or another model still veto.
-- Requires empty disposable dm_refinement_capture_make_check_model_reads* database.
\set ON_ERROR_STOP on
SET client_min_messages = warning;
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_make_check_model_reads%' THEN RAISE EXCEPTION 'refusing: not a disposable contract database'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;
CREATE TYPE public.vision_gate_status AS ENUM ('pending', 'approved', 'rejected_personal', 'rejected_misattributed');
CREATE TYPE public.content_approval_status AS ENUM ('pending', 'approved');
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, owner_id uuid, user_id uuid, vin text, make text, model text, deleted_at timestamptz, merged_into_vehicle_id uuid);
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

\i supabase/sql/revert_20261113120400_capture_make_check_model_reads.sql
SELECT pg_temp.assert_true(md5(pg_get_functiondef('public.capture_sets_apply(uuid, uuid, jsonb, numeric)'::regprocedure)) = 'e0c9dbcf6d510669640b1f3e47b9c2f7',
  'the stand-in is the live body the migration pins');

CREATE FUNCTION pg_temp.u() RETURNS uuid LANGUAGE sql AS $$ SELECT '00000000-0000-4000-8000-0000000000aa'::uuid $$;
CREATE FUNCTION pg_temp.i(n int) RETURNS uuid LANGUAGE sql AS $$ SELECT ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.make(m text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('classification', jsonb_build_object('v2', jsonb_build_object('vehicle_fields',
         jsonb_build_array(jsonb_build_object('field_name', 'make', 'value', m, 'confidence', 0.9))))) $$;
-- target F1 Ford Mustang. Set s1: 4 new photos whose make reads are given.
CREATE FUNCTION pg_temp.fixtures(reads text[]) RETURNS jsonb LANGUAGE sql AS $$
  TRUNCATE vehicles, vehicle_images, capture_set_candidates, capture_set_links;
  INSERT INTO vehicles(id, owner_id, make, model) VALUES ('00000000-0000-4000-8000-0000000000f1', pg_temp.u(), 'Ford', 'Mustang');
  INSERT INTO vehicle_images(id, user_id, vehicle_id, ai_scan_metadata) SELECT pg_temp.i(n), pg_temp.u(), NULL, pg_temp.make(reads[n]) FROM generate_series(1, 4) n;
  INSERT INTO capture_set_candidates VALUES ('00000000-0000-4000-8000-00000000e001', 's1', '00000000-0000-4000-8000-0000000000f1', pg_temp.u(), 'scored_session_v1', 1, 'clear', NULL,
    (SELECT array_agg(pg_temp.i(n)) FROM generate_series(1, 4) n), '{"score": 6.4, "margin_raw": 6.3}');
  SELECT jsonb_build_array(jsonb_build_object('set_key', 's1', 'vehicle_id', '00000000-0000-4000-8000-0000000000f1',
    'image_ids', (SELECT jsonb_agg(pg_temp.i(n)) FROM generate_series(1, 4) n),
    'segment_ids', (SELECT jsonb_agg(pg_temp.i(n)) FROM generate_series(1, 4) n), 'confidence', 0.99, 'basis', 'scored_session'))
$$;
CREATE FUNCTION pg_temp.apply(items jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.capture_sets_apply('00000000-0000-4000-8000-00000000e001', pg_temp.u(), items, 0.6) $$;

-- before: "Mustang"/"MUSTANG " reads count as contradictions of make Ford: 2 of 4 -> refused
SELECT pg_temp.apply(pg_temp.fixtures(ARRAY['Ford', 'Ford', 'Mustang', 'MUSTANG '])) AS r \gset
SELECT pg_temp.assert_true(((:'r')::jsonb->>'photos_filed')::int = 0 AND (:'r')::jsonb->'sets_refused' ? 's1', 'before: model-name reads veto the set');

\i supabase/migrations/20261113120400_capture_make_check_model_reads.sql
-- after: model-name reads agree -> filed
SELECT pg_temp.apply(pg_temp.fixtures(ARRAY['Ford', 'Ford', 'Mustang', 'MUSTANG '])) AS r \gset
SELECT pg_temp.assert_true(((:'r')::jsonb->>'photos_filed')::int = 4 AND (SELECT count(*) FROM vehicle_images WHERE vehicle_id = '00000000-0000-4000-8000-0000000000f1') = 4,
  'after: a set reading Ford and Mustang files onto the Ford Mustang');
-- another make still vetoes
SELECT pg_temp.apply(pg_temp.fixtures(ARRAY['Ford', 'Ford', 'Chevrolet', 'Chevrolet'])) AS r \gset
SELECT pg_temp.assert_true(((:'r')::jsonb->>'photos_filed')::int = 0, 'after: reads of another make still veto');
-- another model still vetoes
SELECT pg_temp.apply(pg_temp.fixtures(ARRAY['Ford', 'Ford', 'Camaro', 'Mustang'])) AS r \gset
SELECT pg_temp.assert_true(((:'r')::jsonb->>'photos_filed')::int = 0 AND (:'r')::jsonb->'sets_refused' ? 's1', 'after: a different model name (1 of 4 = 25%) still vetoes');

\i supabase/sql/revert_20261113120400_capture_make_check_model_reads.sql
SELECT pg_temp.assert_true(md5(pg_get_functiondef('public.capture_sets_apply(uuid, uuid, jsonb, numeric)'::regprocedure)) = 'e0c9dbcf6d510669640b1f3e47b9c2f7', 'revert restores the live body');
SELECT 'capture make check model reads contract: ok' AS result;

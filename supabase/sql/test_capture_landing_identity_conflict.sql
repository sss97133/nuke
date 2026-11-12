-- Contract: 20261115135000 — frames that contradict the candidate identity cannot clear.
-- Reproduces 2026-02-27 (3 Chevrolet-make frames + year 1988 vs 1983 GMC K2500).
-- Disposable DB only (dm_refinement_capture_landing_identity_conflict%).
\set ON_ERROR_STOP on
SET client_min_messages = warning;
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_landing_identity_conflict%' OR to_regclass('public.capture_landing_sets') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_capture_landing_identity_conflict* database';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;

CREATE TABLE public.vehicles(id uuid PRIMARY KEY, make text, year integer, model text);
CREATE TABLE public.canonical_makes(canonical_name text, short_name text, aliases text[]);
CREATE TABLE public.make_alias_ref(alias_text text, canonical_make text, relation_type text, retired_at timestamptz);
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, user_id uuid, latitude double precision, longitude double precision, ai_scan_metadata jsonb);
CREATE TABLE public.capture_landing_config(id integer PRIMARY KEY DEFAULT 1, user_id uuid, min_score numeric DEFAULT 2.5, min_margin numeric DEFAULT 1.0,
  protected_vehicle_ids uuid[] DEFAULT '{}', updated_at timestamptz DEFAULT now());
CREATE TABLE public.capture_landing_chunks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, t_from timestamptz, t_to timestamptz,
  state text DEFAULT 'planning', run_id uuid DEFAULT gen_random_uuid(), plan_cursor timestamptz, stats jsonb DEFAULT '{}', note text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.capture_landing_sets(chunk_id uuid, set_key text, t0 timestamptz, t1 timestamptz, vehicle_id uuid, image_ids uuid[],
  filed_ids uuid[] DEFAULT '{}', cells text[] DEFAULT '{}', score numeric, margin numeric,
  decision text NOT NULL CHECK (decision IN ('clear','review')), reason text, top3 jsonb, applied_at timestamptz, apply_result text,
  PRIMARY KEY (chunk_id, set_key));

INSERT INTO public.canonical_makes VALUES
  ('CHEVROLET', 'Chevy', ARRAY['chevrolet','chevy','chev']),
  ('GMC', 'GMC', ARRAY['gmc']),
  ('FORD', 'Ford', ARRAY['ford']);
INSERT INTO public.vehicles (id, make, year, model) VALUES
  ('00000000-0000-4000-8000-0000000000b1', 'GMC', 1983, 'K2500');

-- S_dually: three Chevrolet-make frames + year 1988 (the 2026-02-27 bug). S_one: a single Chevrolet frame, no year (gold class).
-- S_visual / S_vin / S_priors have no conflicting fields.
CREATE FUNCTION public.capture_sets_score(p_user uuid, p_from timestamptz, p_to timestamptz, p_mode text DEFAULT 'live', p_only_imgs uuid[] DEFAULT NULL, p_prov jsonb DEFAULT NULL)
RETURNS TABLE (set_key text, t0 timestamptz, t1 timestamptz, image_ids uuid[], filed_ids uuid[], vehicle_id uuid, rank integer, signals jsonb)
LANGUAGE sql STABLE AS $$
  SELECT * FROM (VALUES
    ('S_dually', '2026-02-27 12:27+00'::timestamptz, '2026-02-27 12:40+00'::timestamptz,
      ARRAY['00000000-0000-4000-8000-0000000000d1'::uuid,'00000000-0000-4000-8000-0000000000d5'::uuid,'00000000-0000-4000-8000-0000000000d6'::uuid],
      '{}'::uuid[], '00000000-0000-4000-8000-0000000000b1'::uuid, 1,
      '{"score": 3.924, "margin_raw": 3.924, "visual": 0.347, "visual_margin": 0.011, "vin": 0, "plate": 0, "badge": 0, "model": 0, "make": 0.6, "session": 2.5}'::jsonb),
    ('S_one', '2026-02-27 12:50+00', '2026-02-27 12:55+00',
      ARRAY['00000000-0000-4000-8000-0000000000d7'::uuid], '{}'::uuid[],
      '00000000-0000-4000-8000-0000000000b1'::uuid, 1,
      '{"score": 5.765, "margin_raw": 4.0, "visual": 2.0, "vin": 0, "plate": 0, "badge": 0, "model": 0, "session": 2.5}'::jsonb),
    ('S_visual', '2026-02-27 13:00+00', '2026-02-27 13:05+00', ARRAY['00000000-0000-4000-8000-0000000000d2'::uuid], '{}'::uuid[],
      '00000000-0000-4000-8000-0000000000b1'::uuid, 1,
      '{"score": 3.0, "margin_raw": 2.0, "visual": 2.0, "vin": 0, "plate": 0, "badge": 0, "model": 0, "session": 1.0}'::jsonb),
    ('S_vin', '2026-02-27 14:00+00', '2026-02-27 14:05+00', ARRAY['00000000-0000-4000-8000-0000000000d3'::uuid], '{}'::uuid[],
      '00000000-0000-4000-8000-0000000000b1'::uuid, 1,
      '{"score": 3.5, "margin_raw": 3.0, "visual": 0, "vin": 3.0, "plate": 0, "badge": 0, "model": 0, "session": 0.5}'::jsonb),
    ('S_priors', '2026-02-27 15:00+00', '2026-02-27 15:05+00', ARRAY['00000000-0000-4000-8000-0000000000d4'::uuid], '{}'::uuid[],
      '00000000-0000-4000-8000-0000000000b1'::uuid, 1,
      '{"score": 3.5, "margin_raw": 3.5, "visual": 0, "vin": 0, "plate": 0, "badge": 0, "model": 0, "session": 2.5, "cell": 1.0}'::jsonb)
  ) AS v(set_key, t0, t1, image_ids, filed_ids, vehicle_id, rank, signals)
  WHERE p_user = '00000000-0000-4000-8000-0000000000aa'::uuid AND v.t0 >= p_from AND v.t0 < p_to
$$;

INSERT INTO public.vehicle_images (id, user_id, ai_scan_metadata) VALUES
 ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000aa',
  '{"classification":{"image_type":"vehicle_exterior","v2":{"vehicle_fields":[{"value":"Chevrolet","evidence":"bowtie on grille","confidence":0.9,"field_name":"make"},{"value":"1988","evidence":"windshield 88","confidence":0.8,"field_name":"year"}]}}}'),
 ('00000000-0000-4000-8000-0000000000d5', '00000000-0000-4000-8000-0000000000aa',
  '{"classification":{"image_type":"vehicle_exterior","v2":{"vehicle_fields":[{"value":"CHEVROLET","evidence":"tailgate badge","confidence":0.9,"field_name":"make"}]}}}'),
 ('00000000-0000-4000-8000-0000000000d6', '00000000-0000-4000-8000-0000000000aa',
  '{"classification":{"image_type":"vehicle_exterior","v2":{"vehicle_fields":[{"value":"chevy","evidence":"badge","confidence":0.9,"field_name":"make"}]}}}'),
 ('00000000-0000-4000-8000-0000000000d7', '00000000-0000-4000-8000-0000000000aa',
  '{"classification":{"image_type":"vehicle_exterior","v2":{"vehicle_fields":[{"value":"Chevrolet","evidence":"one badge in a 53-photo set","confidence":0.95,"field_name":"make"}]}}}'),
 ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000aa', '{"classification":{"image_type":"vehicle_exterior","v2":{"vehicle_fields":[]}}}'),
 ('00000000-0000-4000-8000-0000000000d3', '00000000-0000-4000-8000-0000000000aa', '{"classification":{"image_type":"vehicle_exterior","v2":{"vehicle_fields":[]}}}'),
 ('00000000-0000-4000-8000-0000000000d4', '00000000-0000-4000-8000-0000000000aa', '{"classification":{"image_type":"vehicle_exterior","v2":{"vehicle_fields":[]}}}');

\i supabase/migrations/20261111200000_capture_landing_priors_only.sql

INSERT INTO public.capture_landing_config (id, user_id) VALUES (1, '00000000-0000-4000-8000-0000000000aa');
INSERT INTO public.capture_landing_chunks (id, user_id, t_from, t_to) VALUES
 ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000aa', '2026-02-27 00:00+00', '2026-02-28 00:00+00');

SELECT public.capture_landing_plan_step('00000000-0000-4000-8000-0000000000c1', 40);
SELECT pg_temp.assert_true((SELECT decision FROM public.capture_landing_sets WHERE chunk_id = '00000000-0000-4000-8000-0000000000c1' AND set_key = 'S_dually') = 'clear',
  'before the patch, the 2026-02-27 dually still clears onto the K2500');
SELECT pg_temp.assert_true((SELECT decision FROM public.capture_landing_sets WHERE set_key = 'S_one') = 'clear', 'a single conflicting-make frame already clears');
SELECT pg_temp.assert_true((SELECT decision || ':' || reason FROM public.capture_landing_sets WHERE set_key = 'S_priors') = 'review:priors_only',
  'visual 0 stays priors_only');

\i supabase/migrations/20261115135000_capture_landing_identity_conflict.sql
SELECT pg_temp.assert_true(position('(20261115135000)' IN pg_get_functiondef('public.capture_landing_plan_step(uuid, integer)'::regprocedure)) > 0, 'marker landed');
SELECT pg_temp.assert_true(public.capture_landing_norm_make('ford mustang') = 'ford' AND public.capture_landing_norm_make('chevy') = 'chevrolet' AND public.capture_landing_norm_make('mustang') IS NULL,
  'make normalization: ford mustang → ford, chevy → chevrolet, mustang alone is not a make');
SELECT pg_temp.assert_true(public.capture_landing_set_identity_conflict('00000000-0000-4000-8000-0000000000b1', ARRAY['00000000-0000-4000-8000-0000000000d1'::uuid,'00000000-0000-4000-8000-0000000000d5'::uuid,'00000000-0000-4000-8000-0000000000d6'::uuid]),
  'helper flags the 3-frame Chevrolet dually vs GMC 1983');
SELECT pg_temp.assert_true(NOT public.capture_landing_set_identity_conflict('00000000-0000-4000-8000-0000000000b1', ARRAY['00000000-0000-4000-8000-0000000000d7'::uuid]),
  'helper keeps a single Chevrolet frame on the GMC');

INSERT INTO public.capture_landing_chunks (id, user_id, t_from, t_to) VALUES
 ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000aa', '2026-02-27 00:00+00', '2026-02-28 00:00+00');
SELECT public.capture_landing_plan_step('00000000-0000-4000-8000-0000000000c2', 40);
SELECT pg_temp.assert_true((SELECT decision || ':' || coalesce(reason,'') FROM public.capture_landing_sets WHERE chunk_id = '00000000-0000-4000-8000-0000000000c2' AND set_key = 'S_dually') = 'review:identity_conflict',
  'after the patch, the dually is review/identity_conflict');
SELECT pg_temp.assert_true((SELECT decision FROM public.capture_landing_sets WHERE chunk_id = '00000000-0000-4000-8000-0000000000c2' AND set_key = 'S_one') = 'clear',
  'a single conflicting-make frame still clears (the gold 53-photo / one-badge class)');
SELECT pg_temp.assert_true((SELECT decision FROM public.capture_landing_sets WHERE chunk_id = '00000000-0000-4000-8000-0000000000c2' AND set_key = 'S_visual') = 'clear',
  'visual 2.0 with no identity conflict still clears');
SELECT pg_temp.assert_true((SELECT decision FROM public.capture_landing_sets WHERE chunk_id = '00000000-0000-4000-8000-0000000000c2' AND set_key = 'S_vin') = 'clear',
  'a vin leg still clears');
SELECT pg_temp.assert_true((SELECT decision || ':' || reason FROM public.capture_landing_sets WHERE chunk_id = '00000000-0000-4000-8000-0000000000c2' AND set_key = 'S_priors') = 'review:priors_only',
  'visual 0 is still priors_only');

\i supabase/sql/revert_20261115135000_capture_landing_identity_conflict.sql
SELECT pg_temp.assert_true(position('(20261115135000)' IN pg_get_functiondef('public.capture_landing_plan_step(uuid, integer)'::regprocedure)) = 0, 'revert removes the marker');
INSERT INTO public.capture_landing_chunks (id, user_id, t_from, t_to) VALUES
 ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000aa', '2026-02-27 00:00+00', '2026-02-28 00:00+00');
SELECT public.capture_landing_plan_step('00000000-0000-4000-8000-0000000000c3', 40);
SELECT pg_temp.assert_true((SELECT decision FROM public.capture_landing_sets WHERE chunk_id = '00000000-0000-4000-8000-0000000000c3' AND set_key = 'S_dually') = 'clear',
  'after revert, the dually clears again');
SELECT 'capture landing identity conflict contract: ok' AS result;

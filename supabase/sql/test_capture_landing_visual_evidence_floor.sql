-- Contract: 20261115130000 — a trace visual score is not evidence; session priors stay priors_only.
-- Reproduces 2026-02-27 (visual 0.347 + session 2.5 cleared a Chevrolet dually onto a GMC K2500).
-- Disposable DB only (dm_refinement_capture_landing_visual_evidence_floor%).
\set ON_ERROR_STOP on
SET client_min_messages = warning;
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_landing_visual_evidence_floor%' OR to_regclass('public.capture_landing_sets') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_capture_landing_visual_evidence_floor* database';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;

CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, user_id uuid, latitude double precision, longitude double precision);
CREATE TABLE public.capture_landing_config(id integer PRIMARY KEY DEFAULT 1, user_id uuid, min_score numeric DEFAULT 2.5, min_margin numeric DEFAULT 1.0,
  protected_vehicle_ids uuid[] DEFAULT '{}', updated_at timestamptz DEFAULT now());
CREATE TABLE public.capture_landing_chunks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, t_from timestamptz, t_to timestamptz,
  state text DEFAULT 'planning', run_id uuid DEFAULT gen_random_uuid(), plan_cursor timestamptz, stats jsonb DEFAULT '{}', note text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.capture_landing_sets(chunk_id uuid, set_key text, t0 timestamptz, t1 timestamptz, vehicle_id uuid, image_ids uuid[],
  filed_ids uuid[] DEFAULT '{}', cells text[] DEFAULT '{}', score numeric, margin numeric,
  decision text NOT NULL CHECK (decision IN ('clear','review')), reason text, top3 jsonb, applied_at timestamptz, apply_result text,
  PRIMARY KEY (chunk_id, set_key));

-- S_dually: the 2026-02-27 numbers (visual 0.347 + session 2.5 + make 0.6 = 3.924) — must not clear after the floor.
-- S_visual: visual 2.0 still clears. S_vin: vin evidence still clears. S_priors: visual 0 stays priors_only.
CREATE FUNCTION public.capture_sets_score(p_user uuid, p_from timestamptz, p_to timestamptz, p_mode text DEFAULT 'live', p_only_imgs uuid[] DEFAULT NULL, p_prov jsonb DEFAULT NULL)
RETURNS TABLE (set_key text, t0 timestamptz, t1 timestamptz, image_ids uuid[], filed_ids uuid[], vehicle_id uuid, rank integer, signals jsonb)
LANGUAGE sql STABLE AS $$
  SELECT * FROM (VALUES
    ('S_dually', '2026-02-27 12:27+00'::timestamptz, '2026-02-27 12:40+00'::timestamptz, ARRAY['00000000-0000-4000-8000-0000000000d1'::uuid], '{}'::uuid[],
      '00000000-0000-4000-8000-0000000000b1'::uuid, 1,
      '{"score": 3.924, "margin_raw": 3.924, "visual": 0.347, "visual_margin": 0.011, "vin": 0, "plate": 0, "badge": 0, "model": 0, "make": 0.6, "session": 2.5, "work_session": 0.36, "prev_day": 0.117}'::jsonb),
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

\i supabase/migrations/20261111200000_capture_landing_priors_only.sql

INSERT INTO public.capture_landing_config (id, user_id) VALUES (1, '00000000-0000-4000-8000-0000000000aa');
INSERT INTO public.vehicle_images (id, user_id) VALUES
 ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000aa'),
 ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000aa'),
 ('00000000-0000-4000-8000-0000000000d3', '00000000-0000-4000-8000-0000000000aa'),
 ('00000000-0000-4000-8000-0000000000d4', '00000000-0000-4000-8000-0000000000aa');
INSERT INTO public.capture_landing_chunks (id, user_id, t_from, t_to) VALUES
 ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000aa', '2026-02-27 00:00+00', '2026-02-28 00:00+00');

SELECT public.capture_landing_plan_step('00000000-0000-4000-8000-0000000000c1', 40);
SELECT pg_temp.assert_true((SELECT decision FROM public.capture_landing_sets WHERE chunk_id = '00000000-0000-4000-8000-0000000000c1' AND set_key = 'S_dually') = 'clear',
  'before the floor, visual 0.347 launders session 2.5 into clear (the 2026-02-27 bug)');
SELECT pg_temp.assert_true((SELECT decision FROM public.capture_landing_sets WHERE set_key = 'S_visual') = 'clear', 'visual 2.0 already clears');
SELECT pg_temp.assert_true((SELECT decision || ':' || reason FROM public.capture_landing_sets WHERE set_key = 'S_priors') = 'review:priors_only',
  'visual 0 stays priors_only');

\i supabase/migrations/20261115130000_capture_landing_visual_evidence_floor.sql
SELECT pg_temp.assert_true(position('(20261115130000)' IN pg_get_functiondef('public.capture_landing_plan_step(uuid, integer)'::regprocedure)) > 0, 'marker landed');

INSERT INTO public.capture_landing_chunks (id, user_id, t_from, t_to) VALUES
 ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000aa', '2026-02-27 00:00+00', '2026-02-28 00:00+00');
SELECT public.capture_landing_plan_step('00000000-0000-4000-8000-0000000000c2', 40);
SELECT pg_temp.assert_true((SELECT decision || ':' || coalesce(reason,'') FROM public.capture_landing_sets WHERE chunk_id = '00000000-0000-4000-8000-0000000000c2' AND set_key = 'S_dually') = 'review:priors_only',
  'after the floor, visual 0.347 + session priors is review/priors_only');
SELECT pg_temp.assert_true((SELECT decision FROM public.capture_landing_sets WHERE chunk_id = '00000000-0000-4000-8000-0000000000c2' AND set_key = 'S_visual') = 'clear',
  'visual 2.0 still clears');
SELECT pg_temp.assert_true((SELECT decision FROM public.capture_landing_sets WHERE chunk_id = '00000000-0000-4000-8000-0000000000c2' AND set_key = 'S_vin') = 'clear',
  'a vin leg still clears');
SELECT pg_temp.assert_true((SELECT decision || ':' || reason FROM public.capture_landing_sets WHERE chunk_id = '00000000-0000-4000-8000-0000000000c2' AND set_key = 'S_priors') = 'review:priors_only',
  'visual 0 is still priors_only');

\i supabase/sql/revert_20261115130000_capture_landing_visual_evidence_floor.sql
SELECT pg_temp.assert_true(position('(20261115130000)' IN pg_get_functiondef('public.capture_landing_plan_step(uuid, integer)'::regprocedure)) = 0, 'revert removes the marker');
INSERT INTO public.capture_landing_chunks (id, user_id, t_from, t_to) VALUES
 ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000aa', '2026-02-27 00:00+00', '2026-02-28 00:00+00');
SELECT public.capture_landing_plan_step('00000000-0000-4000-8000-0000000000c3', 40);
SELECT pg_temp.assert_true((SELECT decision FROM public.capture_landing_sets WHERE chunk_id = '00000000-0000-4000-8000-0000000000c3' AND set_key = 'S_dually') = 'clear',
  'after revert, visual 0.347 clears again');
SELECT 'capture landing visual evidence floor contract: ok' AS result;

-- Capture landing (20261111200000): a set clears only when the winner's frames carry an evidence leg (visual, vin, plate,
-- badge or model); one that passes score and margin on priors alone is held for review as 'priors_only'; thresholds,
-- the other reasons and the chunk statistics are unchanged; the revert restores the score-and-margin rule.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_landing_priors_only%' OR to_regclass('public.capture_landing_sets') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_capture_landing_priors_only* database';
  END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Stand-ins for the live shapes the plan step reads and writes (columns as live on 2026-11-08).
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

-- The scorer, stubbed: four sets on one day, each with a rank-1 and a rank-2 candidate.
--   S1 priors only: session 2.5 + cell 1.0 = 3.5, margin 3.5, visual 0, model 0     -> review, priors_only
--   S2 visual:      visual 2.0 + session 1.0 = 3.0, margin 2.0                      -> clear
--   S3 model:       model 1.0 + session 2.5 = 3.5, margin 3.0, visual 0             -> clear (a classifier-named model is evidence)
--   S4 thin margin: session 2.5 + plate 3.0 = 5.5 but the runner-up at 5.0           -> review, no_clear_lead (unchanged rule, checked first)
CREATE FUNCTION public.capture_sets_score(p_user uuid, p_from timestamptz, p_to timestamptz, p_mode text DEFAULT 'live', p_only_imgs uuid[] DEFAULT NULL, p_prov jsonb DEFAULT NULL)
RETURNS TABLE (set_key text, t0 timestamptz, t1 timestamptz, image_ids uuid[], filed_ids uuid[], vehicle_id uuid, rank integer, signals jsonb)
LANGUAGE sql STABLE AS $$
  SELECT * FROM (VALUES
    ('S1', '2026-03-01 10:00+00'::timestamptz, '2026-03-01 10:05+00'::timestamptz, ARRAY['00000000-0000-4000-8000-000000000011'::uuid, '00000000-0000-4000-8000-000000000012'::uuid], '{}'::uuid[],
      '00000000-0000-4000-8000-0000000000b1'::uuid, 1, '{"score": 3.5, "margin_raw": 3.5, "visual": 0, "vin": 0, "plate": 0, "badge": 0, "model": 0, "make": 0, "session": 2.5, "cell": 1.0}'::jsonb),
    ('S1', '2026-03-01 10:00+00', '2026-03-01 10:05+00', ARRAY['00000000-0000-4000-8000-000000000011'::uuid, '00000000-0000-4000-8000-000000000012'::uuid], '{}'::uuid[],
      '00000000-0000-4000-8000-0000000000b2'::uuid, 2, '{"score": 0, "margin_raw": -3.5, "visual": 0, "vin": 0, "plate": 0, "badge": 0, "model": 0}'::jsonb),
    ('S2', '2026-03-01 11:00+00', '2026-03-01 11:05+00', ARRAY['00000000-0000-4000-8000-000000000021'::uuid], '{}'::uuid[],
      '00000000-0000-4000-8000-0000000000b1'::uuid, 1, '{"score": 3.0, "margin_raw": 2.0, "visual": 2.0, "vin": 0, "plate": 0, "badge": 0, "model": 0, "session": 1.0}'::jsonb),
    ('S2', '2026-03-01 11:00+00', '2026-03-01 11:05+00', ARRAY['00000000-0000-4000-8000-000000000021'::uuid], '{}'::uuid[],
      '00000000-0000-4000-8000-0000000000b2'::uuid, 2, '{"score": 1.0, "margin_raw": -2.0, "visual": 0.5}'::jsonb),
    ('S3', '2026-03-01 12:00+00', '2026-03-01 12:05+00', ARRAY['00000000-0000-4000-8000-000000000031'::uuid], '{}'::uuid[],
      '00000000-0000-4000-8000-0000000000b2'::uuid, 1, '{"score": 3.5, "margin_raw": 3.0, "visual": 0, "vin": 0, "plate": 0, "badge": 0, "model": 1.0, "session": 2.5}'::jsonb),
    ('S3', '2026-03-01 12:00+00', '2026-03-01 12:05+00', ARRAY['00000000-0000-4000-8000-000000000031'::uuid], '{}'::uuid[],
      '00000000-0000-4000-8000-0000000000b1'::uuid, 2, '{"score": 0.5, "margin_raw": -3.0, "model": -0.8}'::jsonb),
    ('S4', '2026-03-01 13:00+00', '2026-03-01 13:05+00', ARRAY['00000000-0000-4000-8000-000000000041'::uuid], '{}'::uuid[],
      '00000000-0000-4000-8000-0000000000b1'::uuid, 1, '{"score": 5.5, "margin_raw": 0.5, "visual": 0, "vin": 0, "plate": 3.0, "badge": 0, "model": 0, "session": 2.5}'::jsonb),
    ('S4', '2026-03-01 13:00+00', '2026-03-01 13:05+00', ARRAY['00000000-0000-4000-8000-000000000041'::uuid], '{}'::uuid[],
      '00000000-0000-4000-8000-0000000000b2'::uuid, 2, '{"score": 5.0, "margin_raw": -0.5, "plate": 3.0, "session": 2.0}'::jsonb)
  ) AS v(set_key, t0, t1, image_ids, filed_ids, vehicle_id, rank, signals)
  WHERE p_user = '00000000-0000-4000-8000-0000000000aa'::uuid AND v.t0 >= p_from AND v.t0 < p_to
$$;

CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;

\i supabase/migrations/20261111200000_capture_landing_priors_only.sql

-- Fixture (synthetic, a disposable database).
-- ALLOW_RAW_TESTIMONY_WRITE
INSERT INTO public.capture_landing_config (id, user_id) VALUES (1, '00000000-0000-4000-8000-0000000000aa');
INSERT INTO public.vehicle_images (id, user_id, latitude, longitude) VALUES
 ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-0000000000aa', 36.0001, -115.0001),
 ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-0000000000aa', 36.0002, -115.0002),
 ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-0000000000aa', NULL, NULL),
 ('00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-0000000000aa', NULL, NULL),
 ('00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-0000000000aa', NULL, NULL);
INSERT INTO public.capture_landing_chunks (id, user_id, t_from, t_to) VALUES
 ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000aa', '2026-03-01 00:00+00', '2026-03-02 00:00+00');

-- the plan step, one day
SELECT public.capture_landing_plan_step('00000000-0000-4000-8000-0000000000c1', 40) AS r \gset
SELECT pg_temp.assert_true((:'r')::jsonb->>'done' = 'true', 'the chunk is planned in one step');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.capture_landing_sets WHERE chunk_id = '00000000-0000-4000-8000-0000000000c1') = 4, 'one row per set');

SELECT pg_temp.assert_true((SELECT decision || ':' || reason FROM public.capture_landing_sets WHERE set_key = 'S1') = 'review:priors_only',
  'score 3.5 and margin 3.5 from session and cell alone is held as priors_only');
SELECT pg_temp.assert_true((SELECT decision FROM public.capture_landing_sets WHERE set_key = 'S2') = 'clear'
  AND (SELECT reason FROM public.capture_landing_sets WHERE set_key = 'S2') IS NULL, 'a visual leg clears');
SELECT pg_temp.assert_true((SELECT decision FROM public.capture_landing_sets WHERE set_key = 'S3') = 'clear', 'a classifier-named model clears');
SELECT pg_temp.assert_true((SELECT decision || ':' || reason FROM public.capture_landing_sets WHERE set_key = 'S4') = 'review:no_clear_lead',
  'the margin rule still speaks first, in its own words');
SELECT pg_temp.assert_true((SELECT score = 3.5 AND margin = 3.5 AND vehicle_id = '00000000-0000-4000-8000-0000000000b1' AND cardinality(image_ids) = 2
                            AND cells = ARRAY['36.000,-115.000'] AND jsonb_array_length(top3) = 2
                            FROM public.capture_landing_sets WHERE set_key = 'S1'), 'a held set keeps its score, margin, winner, frames, cells and candidates');
SELECT pg_temp.assert_true((SELECT state = 'planned' AND stats->>'clear_sets' = '2' AND stats->>'review_sets' = '2'
                            AND stats->'review_reasons' = '{"priors_only": 1, "no_clear_lead": 1}'::jsonb
                            FROM public.capture_landing_chunks WHERE id = '00000000-0000-4000-8000-0000000000c1'), 'the chunk statistics count the new reason');

-- the revert: the score-and-margin rule again
\i supabase/sql/revert_20261111200000_capture_landing_priors_only.sql
SELECT pg_temp.assert_true(position('priors_only' IN pg_get_functiondef('public.capture_landing_plan_step(uuid, integer)'::regprocedure)) = 0, 'revert removes the rule');
INSERT INTO public.capture_landing_chunks (id, user_id, t_from, t_to) VALUES
 ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000aa', '2026-03-01 00:00+00', '2026-03-02 00:00+00');
SELECT public.capture_landing_plan_step('00000000-0000-4000-8000-0000000000c2', 40);
SELECT pg_temp.assert_true((SELECT decision FROM public.capture_landing_sets WHERE chunk_id = '00000000-0000-4000-8000-0000000000c2' AND set_key = 'S1') = 'clear',
  'after the revert the priors-only set clears again');
SELECT 'capture landing priors_only contract: ok' AS result;

-- Disposable PG17: a paint step is witnessed by a keyed photo reading named on its rule edge (labor_photo_key_v1).
-- Builds on the return-rule contract. Checks: with no keyed readings every read keeps its hours and grades; a primer
-- reading on vehicle 3 (no reviewed paint frames) prices fabricated -> primed at the map's hours with grade
-- photo_key_reading; a clear reading prices nothing; superseded, ineligible or other-vehicle readings price nothing;
-- reviewed frames still win on vehicle 1; the edge is an FK and the value list is required with it. Synthetic rows only.
\set ON_ERROR_STOP on
\ir test_vehicle_labor_appraisal_return_rule.sql
RESET ROLE;
INSERT INTO public._fixture_kind_rules VALUES ('line_kind.100.return', '^(?!.*\mcore\M).*\mreturn');

CREATE TABLE public.observation_properties (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), property_key text UNIQUE NOT NULL);
INSERT INTO public.observation_properties (id, property_key) VALUES
  ('f0000000-0000-0000-0000-000000000001', 'image_visible_paint_stage'),
  ('f0000000-0000-0000-0000-000000000002', 'image_visible_assembly_state');
-- guardrail-allow(center-key-fk): vehicle_observations.vehicle_id: synthetic fixture table in a disposable test database
CREATE TABLE IF NOT EXISTS public.vehicle_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, property_id uuid, structured_data jsonb,
  is_superseded boolean DEFAULT false);

CREATE FUNCTION public._seg_hours() RETURNS TABLE (v uuid, segment text, h jsonb, grade text)
LANGUAGE sql AS $$
  SELECT x.v, s->>'segment', jsonb_build_array(s->'hours_min', s->'hours_typical', s->'hours_max'), s->>'evidence_grade'
    FROM unnest(ARRAY['10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003',
                      '10000000-0000-0000-0000-000000000004']::uuid[]) x(v),
         jsonb_array_elements(public.vehicle_labor_appraisal(x.v)->'segments') s
$$;
SET test.auth_role = 'anon';
CREATE TEMP TABLE _pk_before AS SELECT * FROM public._seg_hours();
CREATE TEMP TABLE _pk_tot AS
  SELECT v, public.vehicle_labor_appraisal(v)->'totals' AS t
    FROM unnest(ARRAY['10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003',
                      '10000000-0000-0000-0000-000000000004']::uuid[]) v;
RESET ROLE;
\ir ../migrations/20261124223000_labor_photo_key_edge.sql
\ir ../migrations/20261124223000_labor_photo_key_edge.sql

DO $$
BEGIN
  PERFORM public.assert((SELECT count(*) FROM labor_stage_rule_transitions WHERE photo_property_id IS NOT NULL) = 2, 'two seeded edges');
  PERFORM public.assert((SELECT string_agg(m.to_stage || '=' || array_to_string(t.photo_values, '|'), ',' ORDER BY t.step_no)
                           FROM labor_stage_rule_transitions t JOIN stage_transition_labor_map m ON m.id = t.transition_id
                          WHERE t.photo_property_id IS NOT NULL) = 'primed=primer,basecoated=base', 'in-progress values only');
  PERFORM public.assert((SELECT counts_in FROM labor_evidence_grade_policy WHERE grade = 'photo_key_reading') = 'unwitnessed_purchase'
                        AND (SELECT rank FROM labor_evidence_grade_policy WHERE grade = 'photo_key_reading')
                            > (SELECT rank FROM labor_evidence_grade_policy WHERE grade = 'photographed_stage'), 'policy row below hand frames');
  PERFORM public.assert((length(d) - length(replace(d, 'labor_photo_key_v1', ''))) / 18 >= 1, 'patched')
    FROM (SELECT pg_get_functiondef('public.vehicle_labor_appraisal(uuid)'::regprocedure) d) x;
  BEGIN
    UPDATE labor_stage_rule_transitions SET photo_values = NULL WHERE photo_property_id IS NOT NULL;
    RAISE EXCEPTION 'FAIL: edge without values accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE labor_stage_rule_transitions SET photo_property_id = gen_random_uuid() WHERE photo_property_id IS NOT NULL;
    RAISE EXCEPTION 'FAIL: edge to an unknown property accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END $$;

-- No keyed readings: every segment keeps its hours and grade; totals unchanged.
SET test.auth_role = 'anon';
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad FROM _pk_before b FULL JOIN public._seg_hours() a USING (v, segment)
   WHERE a.h IS DISTINCT FROM b.h OR a.grade IS DISTINCT FROM b.grade;
  PERFORM public.assert(bad = 0, 'segments changed with no keyed readings: ' || bad);
  PERFORM public.assert((SELECT bool_and(public.vehicle_labor_appraisal(p.v)->'totals' = p.t) FROM _pk_tot p), 'totals changed');
  PERFORM public.assert(public.vehicle_labor_appraisal('10000000-0000-0000-0000-000000000003')->>'logic_version'
                        = 'vehicle_labor_appraisal/20261124223000.1', 'version');
END $$;
RESET ROLE;

-- Readings on vehicle 3: one eligible primer image (prices), a clear image (finished state, prices nothing), a
-- superseded base reading, a base reading on an ineligible image, and a base reading whose image is another car's.
INSERT INTO public.vehicle_images (id, vehicle_id) VALUES
  ('a3000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003'),
  ('a3000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003'),
  ('a3000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003'),
  ('a3000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000004');
INSERT INTO public.vehicle_images (id, vehicle_id, is_duplicate) VALUES
  ('a3000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000003', true);
INSERT INTO public.vehicle_observations (id, vehicle_id, property_id, structured_data, is_superseded) VALUES
  ('b3000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000001',
   '{"image_id": "a3000000-0000-0000-0000-000000000001", "image_visible_paint_stage": "primer"}', false),
  ('b3000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000001',
   '{"image_id": "a3000000-0000-0000-0000-000000000002", "image_visible_paint_stage": "clear"}', false),
  ('b3000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000001',
   '{"image_id": "a3000000-0000-0000-0000-000000000003", "image_visible_paint_stage": "base"}', true),
  ('b3000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000001',
   '{"image_id": "a3000000-0000-0000-0000-000000000004", "image_visible_paint_stage": "base"}', false),
  ('b3000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000001',
   '{"image_id": "a3000000-0000-0000-0000-000000000005", "image_visible_paint_stage": "base"}', false),
  ('b3000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000001',
   '{"image_id": "not-a-uuid", "image_visible_paint_stage": "base"}', false),
  -- vehicle 1 already has reviewed frames for blocked and basecoated; a base reading must not change that step, and a
  -- primer reading must not add the primed step to hand-witnessed hours
  ('b1000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001',
   '{"image_id": "a1000000-0000-0000-0000-000000000001", "image_visible_paint_stage": "base"}', false),
  ('b1000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001',
   '{"image_id": "a1000000-0000-0000-0000-000000000001", "image_visible_paint_stage": "primer"}', false);
INSERT INTO public.vehicle_images (id, vehicle_id) VALUES ('a1000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');

SET test.auth_role = 'anon';
DO $$
DECLARE s jsonb; st jsonb; t jsonb; b jsonb;
BEGIN
  s := public._seg('10000000-0000-0000-0000-000000000003', 'paint');
  PERFORM public.assert(s->>'evidence_grade' = 'photo_key_reading', 'grade: ' || s::text);
  PERFORM public.assert((s->>'hours_min')::numeric = 4 AND (s->>'hours_typical')::numeric = 6 AND (s->>'hours_max')::numeric = 8,
                        'primed step at map hours: ' || s::text);
  SELECT x INTO st FROM jsonb_array_elements(s->'stage_steps') x WHERE x->>'to_stage' = 'primed';
  PERFORM public.assert(st->>'status' = 'supported' AND st->>'witness' = 'photo_key_reading' AND (st->>'images')::int = 1
                        AND st->'observation_ids' = '["b3000000-0000-0000-0000-000000000001"]', 'primed step: ' || st::text);
  SELECT x INTO st FROM jsonb_array_elements(s->'stage_steps') x WHERE x->>'to_stage' = 'basecoated';
  PERFORM public.assert(st->>'status' = 'unsupported', 'superseded / ineligible / other-car base readings price nothing: ' || st::text);
  SELECT x INTO st FROM jsonb_array_elements(s->'stage_steps') x WHERE x->>'to_stage' = 'clearcoated';
  PERFORM public.assert(st->>'status' = 'unsupported', 'a clear reading prices nothing');
  PERFORM public.assert(s->'evidence_ids' ? 'a3000000-0000-0000-0000-000000000001'
                        AND jsonb_array_length(s->'evidence_ids') = 1, 'evidence is the witnessing image: ' || (s->'evidence_ids')::text);
  t := public.vehicle_labor_appraisal('10000000-0000-0000-0000-000000000003')->'totals';
  SELECT p.t INTO b FROM _pk_tot p WHERE p.v = '10000000-0000-0000-0000-000000000003';
  PERFORM public.assert(s->>'counts_in' = 'unwitnessed_purchase' AND s->>'witnessed_hours_min' IS NULL
                        AND (s->>'witnessed_hours_max')::numeric = 8, 'one model reading is not witnessed: ' || s::text);
  PERFORM public.assert((t->'with_unwitnessed_purchases'->>'hours_typical')::numeric
                        = coalesce((b->'with_unwitnessed_purchases'->>'hours_typical')::numeric, 0) + 6, 'with purchases gains the step: ' || t::text);
  PERFORM public.assert((t->'witnessed'->>'hours_typical') IS NOT DISTINCT FROM (b->'witnessed'->>'hours_typical'),
                        'witnessed typical unchanged: ' || t::text);
  -- Vehicle 1: reviewed frames win; its paint keeps 11/21/32 and photographed_stage.
  s := public._seg('10000000-0000-0000-0000-000000000001', 'paint');
  PERFORM public.assert(s->>'evidence_grade' = 'photographed_stage' AND (s->>'hours_typical')::numeric = 21, 'vehicle 1 paint: ' || s::text);
  SELECT x INTO st FROM jsonb_array_elements(s->'stage_steps') x WHERE x->>'to_stage' = 'basecoated';
  PERFORM public.assert(st->>'witness' = 'photographed_stage' AND st->'observation_ids' = 'null', 'reviewed frame wins: ' || st::text);
  SELECT x INTO st FROM jsonb_array_elements(s->'stage_steps') x WHERE x->>'to_stage' = 'primed';
  PERFORM public.assert(st->>'status' = 'not_counted' AND st->>'witness' = 'photo_key_reading', 'mixed: reading listed, not counted: ' || st::text);
  PERFORM public.assert(NOT (s->'evidence_ids' ? 'a1000000-0000-0000-0000-000000000001'), 'mixed: reading image not evidence');
  PERFORM public.assert(s->>'counts_in' = 'witnessed', 'mixed: segment stays witnessed');
END $$;
RESET ROLE;

-- The edge row decides: with the primer edge removed, vehicle 3's paint is unpriced again.
UPDATE labor_stage_rule_transitions SET photo_property_id = NULL, photo_values = NULL
 WHERE photo_values = ARRAY['primer'];
SET test.auth_role = 'anon';
DO $$ BEGIN
  PERFORM public.assert(public._seg('10000000-0000-0000-0000-000000000003', 'paint')->>'status' = 'no evidence', 'edge removed');
END $$;
RESET ROLE;
\echo labor_photo_key: ok

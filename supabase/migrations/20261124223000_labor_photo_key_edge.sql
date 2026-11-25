-- labor_photo_key_v1: a paint step can be witnessed by a keyed photo reading (observation_properties) named on its
-- rule edge, as a grade below the hand-reviewed phase frames.
--
-- WHY. The paint chain of vehicle_labor_appraisal priced a step only from vehicle_reviewed_phase_frames (hand-reviewed
-- readings, by build phase). The automatic stage writes keyed rows (vehicle_observations.property_id ->
-- observation_properties) such as image_visible_paint_stage with no agent step, and the reader never read them.
-- Measured live 2026-11-24 (non-superseded rows, gallery-eligible images): K1500 5a1deb95 has 8 images read primer,
-- Mustang 83f6f033 has 1; neither car has a reviewed phase frame for any paint step, so their paint stays unpriced.
--
-- WHAT CHANGES.
--   labor_stage_rule_transitions gains photo_property_id (FK observation_properties) and photo_values text[]: the
--   property whose keyed reading witnesses the step, and the values that witness it. Seeded only with in-progress
--   values (a state is not a transition; the registry text says primer does not establish a respray):
--     paint fabricated -> primed      image_visible_paint_stage {primer}
--     paint blocked    -> basecoated  image_visible_paint_stage {base}
--   clear / aged witness nothing (a finished coat shows a car is painted, not that this step was done).
--   labor_evidence_grade_policy gains photo_key_reading (counts_in witnessed, rank 5, below photographed_stage 4).
--   Reader: a step with no reviewed phase frame is supported when >= 1 gallery-eligible, non-sensitive, non-duplicate
--   image of this vehicle has a non-superseded reading of photo_property_id holding one of photo_values. The step
--   carries witness (photographed_stage | photo_key_reading), images and observation_ids; the image ids join the
--   segment's evidence_ids; a paint segment with any key-witnessed step is graded photo_key_reading (the weaker grade).
--   Reviewed phase frames still win per step.
-- Grain: step (labor_stage_rule_transitions) -> property (observation_properties) by FK; reading -> image by
-- structured_data.image_id (a jsonb link: debt, the keyed column is vehicle_observations.source_observation_id /
-- vehicle_images, not set by the projection). Recompute: per read; a keyed reading landing prices the step on the next
-- read, no agent. Enum values are checked only against observation_properties.description text (no values table).
-- Dry run against live 2026-11-24: proof 20d21fb0 and Blazer e08bf694 unchanged (no primer/base keyed reading);
-- K1500 5a1deb95 paint 4/6/8 (was unpriced); Mustang 83f6f033 + paint 4/6/8.
-- Test: supabase/sql/test_vehicle_labor_appraisal_photo_key.sql (PG17).
--
-- REVERT. Restore the anchors below in the function; drop the two columns; delete the photo_key_reading policy row.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE public.labor_stage_rule_transitions
  ADD COLUMN IF NOT EXISTS photo_property_id uuid REFERENCES public.observation_properties(id),
  ADD COLUMN IF NOT EXISTS photo_values text[];
DO $c$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_constraint WHERE conname = 'labor_stage_rule_transitions_photo_key') THEN
    ALTER TABLE public.labor_stage_rule_transitions ADD CONSTRAINT labor_stage_rule_transitions_photo_key
      CHECK ((photo_property_id IS NULL) = (photo_values IS NULL) AND (photo_values IS NULL OR cardinality(photo_values) > 0));
  END IF;
END $c$;
COMMENT ON COLUMN public.labor_stage_rule_transitions.photo_property_id IS
  'Keyed photo property whose reading witnesses this step (a grade below the hand-reviewed phase frames). NULL = no keyed witness.';
COMMENT ON COLUMN public.labor_stage_rule_transitions.photo_values IS
  'Values of photo_property_id that witness this step: in-progress stage values only, never a finished state.';

UPDATE public.labor_stage_rule_transitions t
   SET photo_property_id = p.id, photo_values = v.vals
  FROM public.labor_stage_rules r, public.stage_transition_labor_map m, public.observation_properties p,
       (VALUES ('fabricated', 'primed', ARRAY['primer']), ('blocked', 'basecoated', ARRAY['base'])) v(from_stage, to_stage, vals)
 WHERE r.id = t.rule_id AND r.segment_key = 'paint' AND m.id = t.transition_id
   AND m.from_stage = v.from_stage AND m.to_stage = v.to_stage
   AND p.property_key = 'image_visible_paint_stage'
   AND t.photo_property_id IS NULL;

INSERT INTO public.labor_evidence_grade_policy (grade, counts_in, rank, meaning)
VALUES ('photo_key_reading', 'witnessed', 5,
        'an in-progress stage value is read in a keyed photo reading (observation_properties) of this vehicle; model-read, not hand-reviewed')
ON CONFLICT (grade) DO NOTHING;

DO $patch$
DECLARE
  d text;
  n integer;
  i integer;
  a_ver text := $a$  version text := 'vehicle_labor_appraisal/20261124222000.1';
$a$;
  r_ver text := $r$  version text := 'vehicle_labor_appraisal/20261124223000.1';
$r$;
  a_decl text := $a$  phase_imgs int;
$a$;
  r_decl text := $r$  phase_imgs int;
  key_imgs uuid[];  -- labor_photo_key_v1
  key_obs uuid[];
  paint_key_steps int := 0;
$r$;
  a_start text := $a$    IF rule.evidence_requirements ? 'paint_chain' THEN
$a$;
  r_start text := $r$    IF rule.evidence_requirements ? 'paint_chain' THEN
      paint_key_steps := 0;  -- labor_photo_key_v1
$r$;
  a_sel text := $a$                                         'photo_phase', t.photo_phase, 'transition_id', m.id) /* labor_edges_v1 */
                      FROM labor_stage_rule_transitions t
                      JOIN stage_transition_labor_map m ON m.id = t.transition_id
$a$;
  r_sel text := $r$                                         'photo_phase', t.photo_phase, 'transition_id', m.id, /* labor_edges_v1 */
                                         'photo_property_id', t.photo_property_id, 'photo_property_key', op.property_key,
                                         'photo_values', to_jsonb(t.photo_values)) /* labor_photo_key_v1 */
                      FROM labor_stage_rule_transitions t
                      JOIN stage_transition_labor_map m ON m.id = t.transition_id
                      LEFT JOIN public.observation_properties op ON op.id = t.photo_property_id
$r$;
  a_cond text := $a$        IF nullif(step_j->>'photo_phase', '') IS NOT NULL AND coalesce(phase_imgs, 0) > 0 THEN
$a$;
  r_cond text := $r$        -- labor_photo_key_v1: no reviewed frame for this step -> its keyed photo property, if the rule edge names one
        key_imgs := NULL; key_obs := NULL;
        IF coalesce(phase_imgs, 0) = 0 AND nullif(step_j->>'photo_property_id', '') IS NOT NULL THEN
          SELECT array_agg(DISTINCT vi.id), array_agg(DISTINCT o.id) INTO key_imgs, key_obs
            FROM public.vehicle_observations o
            JOIN public.vehicle_images vi
              ON vi.id = CASE WHEN o.structured_data->>'image_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                              THEN (o.structured_data->>'image_id')::uuid END
             AND vi.vehicle_id = p_vehicle_id
           WHERE o.vehicle_id = p_vehicle_id
             AND o.property_id = (step_j->>'photo_property_id')::uuid
             AND o.is_superseded = false
             AND o.structured_data->>(step_j->>'photo_property_key') IN (SELECT jsonb_array_elements_text(step_j->'photo_values'))
             AND public.vehicle_image_gallery_eligible(vi) AND coalesce(vi.is_sensitive, false) = false
             AND coalesce(vi.is_duplicate, false) = false AND coalesce(vi.is_superseded, false) = false;
        END IF;

        IF (nullif(step_j->>'photo_phase', '') IS NOT NULL AND coalesce(phase_imgs, 0) > 0)
           OR coalesce(cardinality(key_imgs), 0) > 0 THEN
$r$;
  a_img text := $a$            'images', phase_imgs,
$a$;
  r_img text := $r$            'images', CASE WHEN coalesce(phase_imgs, 0) > 0 THEN phase_imgs ELSE cardinality(key_imgs) END,
            'witness', CASE WHEN coalesce(phase_imgs, 0) > 0 THEN 'photographed_stage' ELSE 'photo_key_reading' END,
            'observation_ids', CASE WHEN coalesce(phase_imgs, 0) > 0 THEN NULL ELSE to_jsonb(key_obs) END,
$r$;
  a_evid text := $a$             AND coalesce(vi.is_sensitive, false) = false;
        ELSE
          unsupported_steps := unsupported_steps || jsonb_build_object(
$a$;
  r_evid text := $r$             AND coalesce(vi.is_sensitive, false) = false;
          IF coalesce(phase_imgs, 0) = 0 THEN  -- labor_photo_key_v1
            paint_key_steps := paint_key_steps + 1;
            evid_ids := coalesce(evid_ids, '{}'::uuid[]) || key_imgs;
          END IF;
        ELSE
          unsupported_steps := unsupported_steps || jsonb_build_object(
$r$;
  a_grade text := $a$        'evidence_grade', CASE WHEN status <> 'no evidence' THEN 'photographed_stage' END,
$a$;
  r_grade text := $r$        'evidence_grade', CASE WHEN status = 'no evidence' THEN NULL
                               WHEN paint_key_steps > 0 THEN 'photo_key_reading'  -- labor_photo_key_v1: the weaker grade
                               ELSE 'photographed_stage' END,
$r$;
  anchors text[];
  repls text[];
BEGIN
  d := pg_get_functiondef('public.vehicle_labor_appraisal(uuid)'::regprocedure);
  IF position('labor_photo_key_v1' IN d) > 0 THEN RETURN; END IF;
  IF position('labor_return_rule_v1' IN d) = 0 THEN
    RAISE EXCEPTION 'vehicle_labor_appraisal is not at 20261124222000; rebase this migration';
  END IF;
  anchors := ARRAY[a_ver, a_decl, a_start, a_sel, a_cond, a_img, a_evid, a_grade];
  repls := ARRAY[r_ver, r_decl, r_start, r_sel, r_cond, r_img, r_evid, r_grade];
  FOR i IN 1 .. array_length(anchors, 1) LOOP
    n := (length(d) - length(replace(d, anchors[i], ''))) / length(anchors[i]);
    IF n <> 1 THEN RAISE EXCEPTION 'labor photo key anchor % drifted: % matches', i, n; END IF;
    d := replace(d, anchors[i], repls[i]);
  END LOOP;
  EXECUTE d;
END $patch$;

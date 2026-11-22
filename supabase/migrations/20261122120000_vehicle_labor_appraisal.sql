-- Database-computed labor appraisal from evidence-gated stage rules.
-- Replaces hand-typed stage assignment. Hours come only from
-- stage_transition_labor_map / estimate_labor_from_delta, shop paper hours,
-- or labor_operations.base_hours for matched reassembly pieces — never invented.
--
-- Contracts: supabase/sql/test_vehicle_labor_appraisal.sql
-- No production apply without owner approval.

SET lock_timeout = '5s';
SET statement_timeout = '120s';
SET search_path = public;

-- =============================================================================
-- 1. labor_stage_rules — evidence condition → stage transition + times
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.labor_stage_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_key text NOT NULL,
  category text NOT NULL,
  zone_pattern text NOT NULL DEFAULT '*',
  from_stage text NOT NULL,
  to_stage text NOT NULL,
  evidence_requirements jsonb NOT NULL DEFAULT '{}'::jsonb,
  hours_min numeric,
  hours_typical numeric,
  hours_max numeric,
  citation text NOT NULL,
  sort_order int NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (segment_key, from_stage, to_stage, zone_pattern)
);

COMMENT ON TABLE public.labor_stage_rules IS
  'Evidence-gated stage transitions for vehicle_labor_appraisal. Hours cite '
  'stage_transition_labor_map (or are looked up at read time). No free-text '
  'photo vocabulary; requirements are closed JSON condition kinds.';

REVOKE ALL ON TABLE public.labor_stage_rules FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.labor_stage_rules TO anon, authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON TABLE public.labor_stage_rules TO service_role;

INSERT INTO public.labor_stage_rules (
  segment_key, category, zone_pattern, from_stage, to_stage,
  evidence_requirements, hours_min, hours_typical, hours_max, citation, sort_order
) VALUES
  ('engine', 'powertrain', '*', 'none', 'rebuilt_original',
   '{"all":[
      {"type":"reconstruction_paper_lines","system_key":"machining","min":1},
      {"type":"facet_truthy","key":"engine.derived.changed"}
    ],
    "paper_hours_system":"machining"}'::jsonb,
   20, 32, 50,
   'stage_transition_labor_map:powertrain none→rebuilt_original', 10),
  ('gearbox', 'powertrain', '*', 'none', 'trans_rebuild',
   '{"all":[
      {"type":"statement_present"},
      {"type":"part_line_match","description_regex":"clutch|pressure plate|flywheel|linkage","min":1}
    ],
    "evidence_grade":"statement"}'::jsonb,
   8, 12, 16,
   'stage_transition_labor_map:powertrain none→trans_rebuild', 20),
  ('chassis', 'chassis', '*', 'stock', 'refreshed',
   '{"all":[
      {"type":"part_line_system","systems":["suspension","steering","brakes"],"min":1},
      {"type":"part_line_match","description_regex":"front end","line_kinds":["labor","service","note","part"],"min":1}
    ]}'::jsonb,
   8, 14, 24,
   'stage_transition_labor_map:chassis stock→refreshed', 30),
  ('electrical', 'electrical', '*', 'original', 'rewire',
   '{"all":[
      {"type":"facet_truthy","key":"engine.derived.changed"},
      {"type":"part_line_match","description_regex":"harness|hrns","min":1},
      {"type":"statement_present"}
    ],
    "evidence_grade":"statement"}'::jsonb,
   8, 14, 20,
   'stage_transition_labor_map:electrical original→rewire', 40),
  ('body_metal', 'body', 'panel_tail', 'stripped', 'fabricated',
   '{"all":[
      {"type":"part_line_match","description_regex":"tail panel|rad(iator)? support|rr bdy pnl|deck fllr","min":1}
    ],
    "panel_multiplier_regex":"tail panel|rad(iator)? support|rr bdy pnl|deck fllr",
    "panel_multiplier_cap":2}'::jsonb,
   4, 6, 12,
   'stage_transition_labor_map:body panel_* stripped→fabricated (×evidenced panels)', 50),
  ('paint', 'body', '*', 'fabricated', 'clearcoated',
   '{"paint_chain":[
      {"from_stage":"fabricated","to_stage":"primed","photo_phase":null},
      {"from_stage":"primed","to_stage":"blocked","photo_phase":"paint_prep"},
      {"from_stage":"blocked","to_stage":"basecoated","photo_phase":"paint_application"},
      {"from_stage":"basecoated","to_stage":"clearcoated","photo_phase":null}
    ]}'::jsonb,
   NULL, NULL, NULL,
   'stage_transition_labor_map:body paint chain; charge only photographed steps', 60),
  ('reassembly', 'body', '*', 'clearcoated', 'assembled',
   '{"reassembly_pieces":true}'::jsonb,
   NULL, NULL, NULL,
   'labor_operations via receipt_part_visible installed=yes + receipt_line_labor_operation', 70),
  ('interior', 'interior', '*', 'needs_work', 'recovered',
   '{"all":[
      {"type":"part_line_system","systems":["interior"],"min":1},
      {"type":"image_scene","scene_type":"body_interior","min":2}
    ]}'::jsonb,
   16, 24, 40,
   'stage_transition_labor_map:interior needs_work→recovered', 80)
ON CONFLICT (segment_key, from_stage, to_stage, zone_pattern) DO NOTHING;

-- =============================================================================
-- 2. vehicle_labor_appraisal — evidence-gated reader
-- =============================================================================

CREATE OR REPLACE FUNCTION public.vehicle_labor_appraisal(p_vehicle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  version text := 'vehicle_labor_appraisal/20261122120000';
  v record;
  v_visible boolean;
  recon jsonb;
  facets jsonb := '{}'::jsonb;
  facet_blob jsonb;
  facet_arr jsonb;
  statements jsonb;
  statement_ids uuid[] := '{}';
  segments jsonb := '[]'::jsonb;
  rule record;
  step record;
  ok boolean;
  missing text[];
  evid_ids uuid[] := '{}';
  evid_grade text;
  hours_min numeric;
  hours_typ numeric;
  hours_max numeric;
  paper_h numeric;
  range_below boolean;
  status text;
  steps_j jsonb;
  step_j jsonb;
  est record;
  mult int;
  panel_n int;
  piece record;
  pieces_matched jsonb := '[]'::jsonb;
  pieces_unmatched jsonb := '[]'::jsonb;
  matched_n int := 0;
  unmatched_n int := 0;
  piece_hours numeric := 0;
  tot_min numeric := 0;
  tot_typ numeric := 0;
  tot_max numeric := 0;
  seg jsonb;
  phase_imgs int;
  desc_text text;
  op_code text;
  base_h numeric;
  img_id uuid;
  item_id uuid;
  req jsonb;
  cond jsonb;
  sys_key text;
  regex text;
  min_n int;
  line_kinds text[];
  systems text[];
  cnt int;
  paint_supported_min numeric;
  paint_supported_typ numeric;
  paint_supported_max numeric;
  unsupported_steps jsonb;
BEGIN
  SELECT * INTO v FROM vehicles WHERE id = p_vehicle_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'vehicle_not_found', 'logic_version', version);
  END IF;

  v_visible := v.deleted_at IS NULL
    AND (v.is_public IS TRUE OR auth.role() = 'service_role'
         OR (auth.uid() IS NOT NULL AND (
               v.user_id = auth.uid() OR v.owner_id = auth.uid()
               OR v.uploaded_by = auth.uid()
               OR public.vehicle_user_has_access(v.id, auth.uid()))));
  IF v_visible IS NOT TRUE THEN
    RETURN NULL;
  END IF;

  recon := public.vehicle_build_reconstruction(p_vehicle_id);
  IF recon IS NULL THEN
    RETURN NULL;
  END IF;

  -- Flatten facet items across top-level arrays into key → item.
  BEGIN
    facet_blob := public.vehicle_facet_items(p_vehicle_id);
  EXCEPTION WHEN undefined_function THEN
    facet_blob := '{}'::jsonb;
  END;
  IF jsonb_typeof(facet_blob) = 'object' THEN
    FOR facet_arr IN
      SELECT value FROM jsonb_each(facet_blob) WHERE jsonb_typeof(value) = 'array'
    LOOP
      FOR cond IN SELECT value FROM jsonb_array_elements(facet_arr)
      LOOP
        IF cond ? 'key' THEN
          facets := facets || jsonb_build_object(cond->>'key', cond);
        END IF;
      END LOOP;
    END LOOP;
  END IF;

  BEGIN
    statements := public.vehicle_statements(p_vehicle_id);
  EXCEPTION WHEN undefined_function THEN
    statements := jsonb_build_object('statements', '[]'::jsonb);
  END;
  SELECT coalesce(array_agg((s->>'id')::uuid), '{}'::uuid[])
    INTO statement_ids
    FROM jsonb_array_elements(coalesce(statements->'statements', '[]'::jsonb)) s
   WHERE nullif(s->>'id', '') IS NOT NULL;

  FOR rule IN
    SELECT * FROM labor_stage_rules
     WHERE active IS TRUE
     ORDER BY sort_order, segment_key
  LOOP
    evid_ids := '{}';
    evid_grade := NULL;
    hours_min := NULL;
    hours_typ := NULL;
    hours_max := NULL;
    paper_h := NULL;
    range_below := false;
    status := 'ok';
    steps_j := '[]'::jsonb;
    missing := ARRAY[]::text[];
    ok := true;
    pieces_matched := '[]'::jsonb;
    pieces_unmatched := '[]'::jsonb;
    matched_n := 0;
    unmatched_n := 0;
    piece_hours := 0;
    paint_supported_min := 0;
    paint_supported_typ := 0;
    paint_supported_max := 0;
    unsupported_steps := '[]'::jsonb;

    -- ----- Reassembly: per-piece book hours only -----
    IF coalesce((rule.evidence_requirements->>'reassembly_pieces')::boolean, false) THEN
      FOR piece IN
        SELECT e.id AS judgment_id,
               e.answer->>'image_id' AS image_id,
               coalesce(
                 e.params->>'description',
                 e.params#>>'{question_context,description}',
                 ''
               ) AS description,
               nullif(coalesce(
                 e.params->>'item_id',
                 e.params#>>'{question_context,item_id}',
                 e.subject_id::text
               ), '')::uuid AS item_id
          FROM evidence_judgment_requests e
         WHERE e.vehicle_id = p_vehicle_id
           AND e.question_kind = 'receipt_part_visible'
           AND e.status = 'answered'
           AND e.superseded_by IS NULL
           AND e.answer->>'installed' = 'yes'
      LOOP
        evid_ids := array_append(evid_ids, piece.judgment_id);
        op_code := public.receipt_line_labor_operation(piece.description);
        IF op_code IS NULL THEN
          unmatched_n := unmatched_n + 1;
          pieces_unmatched := pieces_unmatched || jsonb_build_object(
            'judgment_id', piece.judgment_id,
            'item_id', piece.item_id,
            'image_id', nullif(piece.image_id, '')::uuid,
            'hours', NULL,
            'reason', 'no book operation'
          );
        ELSE
          SELECT o.base_hours INTO base_h
            FROM labor_operations o
           WHERE o.code = op_code
             AND (o.model_year_min IS NULL OR v.year IS NULL OR v.year >= o.model_year_min)
             AND (o.model_year_max IS NULL OR v.year IS NULL OR v.year <= o.model_year_max)
           LIMIT 1;
          IF base_h IS NULL THEN
            unmatched_n := unmatched_n + 1;
            pieces_unmatched := pieces_unmatched || jsonb_build_object(
              'judgment_id', piece.judgment_id,
              'item_id', piece.item_id,
              'image_id', nullif(piece.image_id, '')::uuid,
              'operation_code', op_code,
              'hours', NULL,
              'reason', 'no book operation'
            );
          ELSE
            matched_n := matched_n + 1;
            piece_hours := piece_hours + base_h;
            pieces_matched := pieces_matched || jsonb_build_object(
              'judgment_id', piece.judgment_id,
              'item_id', piece.item_id,
              'image_id', nullif(piece.image_id, '')::uuid,
              'operation_code', op_code,
              'hours', base_h
            );
          END IF;
        END IF;
      END LOOP;

      IF matched_n = 0 AND unmatched_n = 0 THEN
        status := 'no evidence';
        hours_min := NULL; hours_typ := NULL; hours_max := NULL;
      ELSE
        hours_min := CASE WHEN matched_n > 0 THEN piece_hours ELSE NULL END;
        hours_typ := hours_min;
        hours_max := hours_min;
        IF matched_n = 0 THEN
          status := 'no evidence';
        END IF;
      END IF;

      seg := jsonb_build_object(
        'segment', rule.segment_key,
        'category', rule.category,
        'status', status,
        'stage_steps', jsonb_build_array(jsonb_build_object(
          'from_stage', rule.from_stage,
          'to_stage', rule.to_stage,
          'zone', rule.zone_pattern,
          'mode', 'per_piece'
        )),
        'hours_min', hours_min,
        'hours_typical', hours_typ,
        'hours_max', hours_max,
        'evidence_ids', to_jsonb(evid_ids),
        'evidence_count', coalesce(array_length(evid_ids, 1), 0),
        'evidence_grade', 'receipt_part_visible',
        'reassembly', jsonb_build_object(
          'matched_count', matched_n,
          'unmatched_count', unmatched_n,
          'matched', pieces_matched,
          'unmatched', pieces_unmatched
        ),
        'citation', rule.citation
      );
      segments := segments || seg;
      IF hours_min IS NOT NULL THEN
        tot_min := tot_min + hours_min;
        tot_typ := tot_typ + hours_typ;
        tot_max := tot_max + hours_max;
      END IF;
      CONTINUE;
    END IF;

    -- ----- Paint chain: only photographed steps -----
    IF rule.evidence_requirements ? 'paint_chain' THEN
      FOR step_j IN SELECT value FROM jsonb_array_elements(rule.evidence_requirements->'paint_chain')
      LOOP
        phase_imgs := 0;
        IF nullif(step_j->>'photo_phase', '') IS NOT NULL THEN
          SELECT coalesce((s->>'images')::int, 0) INTO phase_imgs
            FROM jsonb_array_elements(coalesce(recon->'systems', '[]'::jsonb)) sys
            CROSS JOIN LATERAL jsonb_array_elements(coalesce(sys->'stages', '[]'::jsonb)) s
           WHERE sys->>'system_key' = 'paint'
             AND s->>'phase' = step_j->>'photo_phase'
           LIMIT 1;
        END IF;

        IF nullif(step_j->>'photo_phase', '') IS NOT NULL AND coalesce(phase_imgs, 0) > 0 THEN
          SELECT * INTO est
            FROM public.estimate_labor_from_delta(
              p_vehicle_id, rule.zone_pattern,
              step_j->>'from_stage', step_j->>'to_stage'
            );
          paint_supported_min := paint_supported_min + coalesce(est.hours_min, 0);
          paint_supported_typ := paint_supported_typ + coalesce(est.hours_typical, 0);
          paint_supported_max := paint_supported_max + coalesce(est.hours_max, 0);
          steps_j := steps_j || jsonb_build_object(
            'from_stage', step_j->>'from_stage',
            'to_stage', step_j->>'to_stage',
            'photo_phase', step_j->>'photo_phase',
            'status', 'supported',
            'images', phase_imgs,
            'hours_min', est.hours_min,
            'hours_typical', est.hours_typical,
            'hours_max', est.hours_max
          );
          -- Stage sample image ids (no free text).
          SELECT coalesce(array_agg(DISTINCT (samp->>'image_id')::uuid), evid_ids)
            INTO evid_ids
            FROM jsonb_array_elements(coalesce(recon->'systems', '[]'::jsonb)) sys
            CROSS JOIN LATERAL jsonb_array_elements(coalesce(sys->'stages', '[]'::jsonb)) s
            CROSS JOIN LATERAL jsonb_array_elements(coalesce(s->'sample', '[]'::jsonb)) samp
           WHERE sys->>'system_key' = 'paint'
             AND s->>'phase' = step_j->>'photo_phase'
             AND nullif(samp->>'image_id', '') IS NOT NULL;
        ELSE
          unsupported_steps := unsupported_steps || jsonb_build_object(
            'from_stage', step_j->>'from_stage',
            'to_stage', step_j->>'to_stage',
            'photo_phase', step_j->>'photo_phase',
            'status', 'unsupported'
          );
          steps_j := steps_j || jsonb_build_object(
            'from_stage', step_j->>'from_stage',
            'to_stage', step_j->>'to_stage',
            'photo_phase', step_j->>'photo_phase',
            'status', 'unsupported',
            'hours_min', NULL,
            'hours_typical', NULL,
            'hours_max', NULL
          );
        END IF;
      END LOOP;

      IF paint_supported_min = 0 AND paint_supported_typ = 0 AND paint_supported_max = 0 THEN
        status := 'no evidence';
        hours_min := NULL; hours_typ := NULL; hours_max := NULL;
      ELSE
        hours_min := paint_supported_min;
        hours_typ := paint_supported_typ;
        hours_max := paint_supported_max;
      END IF;

      seg := jsonb_build_object(
        'segment', rule.segment_key,
        'category', rule.category,
        'status', status,
        'stage_steps', steps_j,
        'unsupported_steps', unsupported_steps,
        'hours_min', hours_min,
        'hours_typical', hours_typ,
        'hours_max', hours_max,
        'evidence_ids', to_jsonb(evid_ids),
        'evidence_count', coalesce(array_length(evid_ids, 1), 0),
        'evidence_grade', 'photographed_stage',
        'citation', rule.citation
      );
      segments := segments || seg;
      IF hours_min IS NOT NULL THEN
        tot_min := tot_min + hours_min;
        tot_typ := tot_typ + hours_typ;
        tot_max := tot_max + hours_max;
      END IF;
      CONTINUE;
    END IF;

    -- ----- Standard evidence-gated stage transitions -----
    FOR cond IN
      SELECT value FROM jsonb_array_elements(coalesce(rule.evidence_requirements->'all', '[]'::jsonb))
    LOOP
      IF cond->>'type' = 'reconstruction_paper_lines' THEN
        sys_key := cond->>'system_key';
        min_n := coalesce((cond->>'min')::int, 1);
        SELECT coalesce((s->'paper'->>'lines')::int, (s->>'paper_work_lines')::int, 0),
               (s->'paper'->>'hours')::numeric
          INTO cnt, paper_h
          FROM jsonb_array_elements(coalesce(recon->'systems', '[]'::jsonb)) s
         WHERE s->>'system_key' = sys_key
         LIMIT 1;
        -- Shop paper hours alone satisfy the "has paper lines" intent for machining.
        IF coalesce(cnt, 0) < min_n AND paper_h IS NULL THEN
          ok := false;
          missing := array_append(missing, format('reconstruction_paper_lines:%s', sys_key));
        ELSE
          SELECT coalesce(evid_ids || array_agg(w.item_id), evid_ids) INTO evid_ids
            FROM (
              SELECT w.item_id
                FROM public.receipt_work_lines(p_vehicle_id) w
               WHERE public.receipt_line_system(w.description) = sys_key
                 AND w.line_kind IN ('labor', 'service', 'note', 'part')
                 AND w.item_id IS NOT NULL
               LIMIT 50
            ) w;
        END IF;

      ELSIF cond->>'type' = 'facet_truthy' THEN
        IF (facets->(cond->>'key')->'value') IS DISTINCT FROM 'true'::jsonb
           AND lower(coalesce(facets->(cond->>'key')->>'value', '')) NOT IN ('true', 't', '1') THEN
          ok := false;
          missing := array_append(missing, format('facet_truthy:%s', cond->>'key'));
        END IF;

      ELSIF cond->>'type' = 'statement_present' THEN
        IF coalesce(array_length(statement_ids, 1), 0) = 0 THEN
          ok := false;
          missing := array_append(missing, 'statement_present');
        ELSE
          evid_ids := evid_ids || statement_ids;
          evid_grade := coalesce(rule.evidence_requirements->>'evidence_grade', 'statement');
        END IF;

      ELSIF cond->>'type' = 'part_line_match' THEN
        regex := cond->>'description_regex';
        min_n := coalesce((cond->>'min')::int, 1);
        IF cond ? 'line_kinds' THEN
          SELECT array_agg(x) INTO line_kinds
            FROM jsonb_array_elements_text(cond->'line_kinds') x;
        ELSE
          line_kinds := ARRAY['part'];
        END IF;
        SELECT count(*)::int INTO cnt
          FROM public.receipt_work_lines(p_vehicle_id) w
         WHERE w.line_kind = ANY (line_kinds)
           AND lower(coalesce(w.description, '')) ~ regex;
        IF coalesce(cnt, 0) < min_n THEN
          ok := false;
          missing := array_append(missing, format('part_line_match:%s', regex));
        ELSE
          SELECT coalesce(evid_ids || array_agg(w.item_id), evid_ids) INTO evid_ids
            FROM (
              SELECT w.item_id
                FROM public.receipt_work_lines(p_vehicle_id) w
               WHERE w.line_kind = ANY (line_kinds)
                 AND lower(coalesce(w.description, '')) ~ regex
                 AND w.item_id IS NOT NULL
               LIMIT 50
            ) w;
        END IF;

      ELSIF cond->>'type' = 'part_line_system' THEN
        SELECT array_agg(x) INTO systems
          FROM jsonb_array_elements_text(cond->'systems') x;
        min_n := coalesce((cond->>'min')::int, 1);
        SELECT count(*)::int INTO cnt
          FROM public.receipt_work_lines(p_vehicle_id) w
         WHERE w.line_kind = 'part'
           AND public.receipt_line_system(w.description) = ANY (systems);
        IF coalesce(cnt, 0) < min_n THEN
          ok := false;
          missing := array_append(missing, format('part_line_system:%s', array_to_string(systems, ',')));
        ELSE
          SELECT coalesce(evid_ids || array_agg(w.item_id), evid_ids) INTO evid_ids
            FROM (
              SELECT w.item_id
                FROM public.receipt_work_lines(p_vehicle_id) w
               WHERE w.line_kind = 'part'
                 AND public.receipt_line_system(w.description) = ANY (systems)
                 AND w.item_id IS NOT NULL
               LIMIT 50
            ) w;
        END IF;

      ELSIF cond->>'type' = 'image_scene' THEN
        min_n := coalesce((cond->>'min')::int, 1);
        SELECT count(*)::int INTO cnt
          FROM vehicle_images vi
         WHERE vi.vehicle_id = p_vehicle_id
           AND coalesce(vi.is_superseded, false) IS NOT TRUE
           AND coalesce(vi.is_duplicate, false) IS NOT TRUE
           AND vi.ai_scan_metadata#>>'{byok_deep_analysis,scene_type}' = cond->>'scene_type';
        IF coalesce(cnt, 0) < min_n THEN
          ok := false;
          missing := array_append(missing, format('image_scene:%s', cond->>'scene_type'));
        ELSE
          SELECT coalesce(evid_ids || array_agg(vi.id), evid_ids) INTO evid_ids
            FROM (
              SELECT vi.id FROM vehicle_images vi
               WHERE vi.vehicle_id = p_vehicle_id
                 AND coalesce(vi.is_superseded, false) IS NOT TRUE
                 AND coalesce(vi.is_duplicate, false) IS NOT TRUE
                 AND vi.ai_scan_metadata#>>'{byok_deep_analysis,scene_type}' = cond->>'scene_type'
               LIMIT 20
            ) vi;
        END IF;
      ELSE
        ok := false;
        missing := array_append(missing, format('unknown_condition:%s', cond->>'type'));
      END IF;
    END LOOP;

    IF (NOT ok) OR coalesce(array_length(evid_ids, 1), 0) = 0 THEN
      status := 'no evidence';
      seg := jsonb_build_object(
        'segment', rule.segment_key,
        'category', rule.category,
        'status', status,
        'stage_steps', jsonb_build_array(jsonb_build_object(
          'from_stage', rule.from_stage,
          'to_stage', rule.to_stage,
          'zone', rule.zone_pattern
        )),
        'hours_min', NULL,
        'hours_typical', NULL,
        'hours_max', NULL,
        'evidence_ids', '[]'::jsonb,
        'evidence_count', 0,
        'missing_evidence', to_jsonb(missing),
        'citation', rule.citation
      );
      segments := segments || seg;
      CONTINUE;
    END IF;

    -- Hours from map (prefer live estimate; fall back to rule seed).
    SELECT * INTO est
      FROM public.estimate_labor_from_delta(
        p_vehicle_id, rule.zone_pattern, rule.from_stage, rule.to_stage
      );
    hours_min := coalesce(est.hours_min, rule.hours_min);
    hours_typ := coalesce(est.hours_typical, rule.hours_typical);
    hours_max := coalesce(est.hours_max, rule.hours_max);

    -- Body metal: multiply by evidenced panel count (cap 2).
    IF rule.evidence_requirements ? 'panel_multiplier_regex' THEN
      regex := rule.evidence_requirements->>'panel_multiplier_regex';
      SELECT count(*)::int INTO panel_n
        FROM public.receipt_work_lines(p_vehicle_id) w
       WHERE w.line_kind = 'part'
         AND lower(coalesce(w.description, '')) ~ regex;
      mult := least(
        greatest(coalesce(panel_n, 1), 1),
        coalesce((rule.evidence_requirements->>'panel_multiplier_cap')::int, 2)
      );
      -- Prefer distinct panel families when ≥2 families present.
      SELECT count(DISTINCT CASE
               WHEN lower(w.description) ~ 'tail panel|rr bdy pnl|deck fllr' THEN 'tail'
               WHEN lower(w.description) ~ 'rad(iator)? support' THEN 'radiator_support'
               ELSE 'other'
             END)::int INTO panel_n
        FROM public.receipt_work_lines(p_vehicle_id) w
       WHERE w.line_kind = 'part'
         AND lower(coalesce(w.description, '')) ~ regex;
      mult := least(greatest(coalesce(panel_n, 1), 1),
                    coalesce((rule.evidence_requirements->>'panel_multiplier_cap')::int, 2));
      hours_min := hours_min * mult;
      hours_typ := hours_typ * mult;
      hours_max := hours_max * mult;
      steps_j := jsonb_build_array(jsonb_build_object(
        'from_stage', rule.from_stage,
        'to_stage', rule.to_stage,
        'zone', rule.zone_pattern,
        'panel_multiplier', mult
      ));
    ELSE
      steps_j := jsonb_build_array(jsonb_build_object(
        'from_stage', rule.from_stage,
        'to_stage', rule.to_stage,
        'zone', rule.zone_pattern
      ));
    END IF;

    -- Paper hours win when above stored max (never clip).
    IF rule.evidence_requirements ? 'paper_hours_system' THEN
      sys_key := rule.evidence_requirements->>'paper_hours_system';
      SELECT (s->'paper'->>'hours')::numeric INTO paper_h
        FROM jsonb_array_elements(coalesce(recon->'systems', '[]'::jsonb)) s
       WHERE s->>'system_key' = sys_key
       LIMIT 1;
      IF paper_h IS NOT NULL AND hours_max IS NOT NULL AND paper_h > hours_max THEN
        range_below := true;
      END IF;
    END IF;

    IF coalesce(array_length(evid_ids, 1), 0) = 0 THEN
      status := 'no evidence';
      hours_min := NULL; hours_typ := NULL; hours_max := NULL;
    END IF;

    IF evid_grade IS NULL AND rule.evidence_requirements ? 'evidence_grade' THEN
      evid_grade := rule.evidence_requirements->>'evidence_grade';
    END IF;

    seg := jsonb_build_object(
      'segment', rule.segment_key,
      'category', rule.category,
      'status', status,
      'stage_steps', steps_j,
      'hours_min', hours_min,
      'hours_typical', hours_typ,
      'hours_max', hours_max,
      'paper_hours', paper_h,
      'range_below_paper', range_below,
      'evidence_ids', to_jsonb(evid_ids),
      'evidence_count', coalesce(array_length(evid_ids, 1), 0),
      'evidence_grade', evid_grade,
      'citation', rule.citation
    );
    segments := segments || seg;
    IF hours_min IS NOT NULL THEN
      tot_min := tot_min + hours_min;
      tot_typ := tot_typ + hours_typ;
      tot_max := tot_max + hours_max;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'applicable', true,
    'segments', segments,
    'totals', jsonb_build_object(
      'hours_min', tot_min,
      'hours_typical', tot_typ,
      'hours_max', tot_max
    ),
    'logic_version', version,
    'as_of', now()
  );
END
$fn$;

COMMENT ON FUNCTION public.vehicle_labor_appraisal(uuid) IS
  'Evidence-gated labor appraisal from labor_stage_rules. Hours only from '
  'stage_transition_labor_map / estimate_labor_from_delta, shop paper hours, or '
  'labor_operations.base_hours for matched reassembly pieces. No dollars, no photo '
  'free text, no invented hours. Private/deleted vehicles return null to anon.';

REVOKE ALL ON FUNCTION public.vehicle_labor_appraisal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_labor_appraisal(uuid) TO anon, authenticated, service_role;

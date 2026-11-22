-- Database-computed labor appraisal from evidence-gated stage rules.
-- Replaces hand-typed stage assignment. Hours come only from
-- stage_transition_labor_map (via estimate_labor_from_delta), shop paper hours,
-- or labor_operations.base_hours for matched reassembly pieces; never typed here.
--
-- Rules key on the shared line classifiers (receipt_line_system,
-- receipt_line_labor_operation), the reconstruction's keyed systems and phases,
-- and keyed photo scenes, so any vehicle's paper and photos can satisfy them.
-- No rule carries a description regex and no rule carries an hour number.
--
-- Contracts: supabase/sql/test_vehicle_labor_appraisal.sql

SET lock_timeout = '5s';
SET statement_timeout = '120s';
SET search_path = public;

-- =============================================================================
-- 1. labor_stage_rules: evidence condition -> stage transition
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.labor_stage_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_key text NOT NULL,
  category text NOT NULL,
  zone_pattern text NOT NULL DEFAULT '*',
  from_stage text NOT NULL,
  to_stage text NOT NULL,
  evidence_requirements jsonb NOT NULL DEFAULT '{}'::jsonb,
  citation text NOT NULL,
  sort_order int NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (segment_key, from_stage, to_stage, zone_pattern)
);

COMMENT ON TABLE public.labor_stage_rules IS
  'Evidence-gated stage transitions read by vehicle_labor_appraisal. Requirements are closed '
  'JSON condition kinds over shared keys (receipt_line_system, receipt_line_labor_operation, '
  'reconstruction systems/phases, photo scene_type). Hours are never stored here: they come '
  'from stage_transition_labor_map at read time.';

ALTER TABLE public.labor_stage_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS labor_stage_rules_read ON public.labor_stage_rules;
CREATE POLICY labor_stage_rules_read ON public.labor_stage_rules
  FOR SELECT TO anon, authenticated USING (true);

REVOKE ALL ON TABLE public.labor_stage_rules FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.labor_stage_rules TO anon, authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON TABLE public.labor_stage_rules TO service_role;

-- Book transitions used by the seed rules. Body paint/metal rows already ship in
-- 20260227290000; powertrain/chassis/electrical/interior lived only in prod until
-- this migration. ON CONFLICT keeps a fresh DB and live in sync without overwrite.
ALTER TABLE public.stage_transition_labor_map
  ADD COLUMN IF NOT EXISTS category text;

INSERT INTO public.stage_transition_labor_map (
  from_stage, to_stage, zone_pattern, category, description,
  estimated_hours_min, estimated_hours_typical, estimated_hours_max,
  materials_cost_min, materials_cost_max, confidence
) VALUES
  ('none', 'rebuilt_original', '*', 'powertrain',
   'Rebuild matching-numbers engine — machine work, gaskets, assembly',
   20, 32, 50, 2000, 5000, 'low'),
  ('none', 'trans_rebuild', '*', 'powertrain',
   'Transmission rebuild or replacement — remove, rebuild/source, install',
   8, 12, 16, 800, 3500, 'low'),
  ('stock', 'refreshed', '*', 'chassis',
   'Brake rebuild, shocks, bushings, steering — standard chassis refresh',
   8, 14, 24, 800, 3500, 'low'),
  ('original', 'rewire', '*', 'electrical',
   'Full rewire — new harness for engine swap or modernization',
   8, 14, 20, 500, 2500, 'low'),
  ('needs_work', 'recovered', '*', 'interior',
   'Seat recover, carpet, headliner — standard upholstery refresh',
   16, 24, 40, 1500, 5000, 'low')
ON CONFLICT (from_stage, to_stage, zone_pattern) DO NOTHING;

INSERT INTO public.labor_stage_rules (
  segment_key, category, zone_pattern, from_stage, to_stage,
  evidence_requirements, citation, sort_order
) VALUES
  ('engine', 'powertrain', '*', 'none', 'rebuilt_original',
   '{"all":[
      {"type":"reconstruction_paper_lines","system_key":"machining","min":1}
    ],
    "paper_hours_system":"machining"}'::jsonb,
   'stage_transition_labor_map:powertrain none->rebuilt_original; machining paper hours win', 10),
  ('gearbox', 'powertrain', '*', 'none', 'trans_rebuild',
   '{"all":[
      {"type":"part_line_operation","operations":["MECH-TRANS-RR"],"min":1}
    ]}'::jsonb,
   'stage_transition_labor_map:powertrain none->trans_rebuild', 20),
  ('chassis', 'chassis', '*', 'stock', 'refreshed',
   '{"all":[
      {"type":"part_line_system","systems":["suspension","steering","brakes"],
       "line_kinds":["part","labor","note"],"min":3,"min_distinct":2}
    ]}'::jsonb,
   'stage_transition_labor_map:chassis stock->refreshed', 30),
  ('electrical', 'electrical', '*', 'original', 'rewire',
   '{"all":[
      {"type":"part_line_operation","operations":["ELEC-WIRING-HARNESS"],"min":2}
    ]}'::jsonb,
   'stage_transition_labor_map:electrical original->rewire', 40),
  ('body_metal', 'body', 'panel_*', 'stripped', 'fabricated',
   '{"all":[
      {"type":"part_line_operation","operations":["BODY-RUST-PANEL"],"min":1}
    ],
    "panel_multiplier":{"operations":["BODY-RUST-PANEL"]}}'::jsonb,
   'stage_transition_labor_map:body panel_* stripped->fabricated x distinct evidenced panel lines', 50),
  ('paint', 'body', '*', 'fabricated', 'clearcoated',
   '{"paint_chain":[
      {"from_stage":"fabricated","to_stage":"primed","photo_phase":null},
      {"from_stage":"primed","to_stage":"blocked","photo_phase":"paint_prep"},
      {"from_stage":"blocked","to_stage":"basecoated","photo_phase":"paint_application"},
      {"from_stage":"basecoated","to_stage":"clearcoated","photo_phase":null}
    ]}'::jsonb,
   'stage_transition_labor_map:body paint chain; charge only photographed steps', 60),
  ('reassembly', 'body', '*', 'clearcoated', 'assembled',
   '{"reassembly_pieces":true}'::jsonb,
   'labor_operations via receipt_part_visible installed=yes + receipt_line_labor_operation', 70),
  ('interior', 'interior', '*', 'needs_work', 'recovered',
   '{"all":[
      {"type":"part_line_operation",
       "operations":["INT-SEATS-RR","INT-CARPET-RR","INT-HEADLINER-RR","INT-DOOR-PANELS"],
       "min":2,"min_distinct":2},
      {"type":"image_scene","scene_type":"body_interior","min":2}
    ]}'::jsonb,
   'stage_transition_labor_map:interior needs_work->recovered', 80)
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
  version text := 'vehicle_labor_appraisal/20261122120000.3';
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
  lines jsonb := '[]'::jsonb;
  distinct_n int;
  ops text[];
  book_min numeric;
  book_typ numeric;
  book_max numeric;
  hours_basis text;
  panel_count int;
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

  -- Receipt lines are read once, projected to keys only. Descriptions never leave
  -- this statement: later conditions see the shared classifier outputs
  -- (system, labor operation) and an opaque distinctness hash.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'item_id', w.item_id,
           'line_kind', w.line_kind,
           'system', public.receipt_line_system(w.description),
           'op', public.receipt_line_labor_operation(w.description),
           'dk', md5(coalesce(nullif(btrim(w.part_number), ''), lower(btrim(coalesce(w.description, '')))))
         )), '[]'::jsonb)
    INTO lines
    FROM public.receipt_work_lines(p_vehicle_id) w
   WHERE w.item_id IS NOT NULL;

  -- Facets and statements are read only when an active rule asks for them.
  IF EXISTS (
    SELECT 1 FROM labor_stage_rules r,
           jsonb_array_elements(coalesce(r.evidence_requirements->'all', '[]'::jsonb)) c
     WHERE r.active AND c->>'type' = 'facet_truthy'
  ) THEN
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
  END IF;

  statements := jsonb_build_object('statements', '[]'::jsonb);
  IF EXISTS (
    SELECT 1 FROM labor_stage_rules r,
           jsonb_array_elements(coalesce(r.evidence_requirements->'all', '[]'::jsonb)) c
     WHERE r.active AND c->>'type' = 'statement_present'
  ) THEN
    BEGIN
      statements := public.vehicle_statements(p_vehicle_id);
    EXCEPTION WHEN undefined_function THEN
      statements := jsonb_build_object('statements', '[]'::jsonb);
    END;
    -- vehicle_statements emits statement_id only for tied viewers; anon sees the
    -- row with a null id. Presence uses the array; citeable ids are non-null only.
    SELECT coalesce(array_agg(sid), '{}'::uuid[])
      INTO statement_ids
      FROM (
        SELECT nullif(coalesce(s->>'statement_id', s->>'id'), '')::uuid AS sid
          FROM jsonb_array_elements(coalesce(statements->'statements', '[]'::jsonb)) s
      ) x
     WHERE sid IS NOT NULL;
  END IF;

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
    book_min := NULL; book_typ := NULL; book_max := NULL;
    hours_basis := NULL;
    panel_count := NULL;

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
         ORDER BY e.id
      LOOP
        evid_ids := array_append(evid_ids, piece.judgment_id);
        -- Never return gallery-ineligible / sensitive image ids (anon can feed them to
        -- get_image_deep_analysis). Judgment ids remain; witness image id is gated.
        img_id := NULL;
        IF nullif(piece.image_id, '') IS NOT NULL THEN
          SELECT vi.id INTO img_id
            FROM vehicle_images vi
           WHERE vi.id = piece.image_id::uuid
             AND vi.vehicle_id = p_vehicle_id
             AND public.vehicle_image_gallery_eligible(vi)
             AND coalesce(vi.is_sensitive, false) = false;
        END IF;
        op_code := public.receipt_line_labor_operation(piece.description);
        IF op_code IS NULL THEN
          unmatched_n := unmatched_n + 1;
          pieces_unmatched := pieces_unmatched || jsonb_build_object(
            'judgment_id', piece.judgment_id,
            'item_id', piece.item_id,
            'image_id', img_id,
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
              'image_id', img_id,
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
              'image_id', img_id,
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
          -- Stage sample image ids (no free text). Re-check gallery gate even though
          -- vehicle_build_reconstruction already filters samples for visitors.
          SELECT coalesce(evid_ids || array_agg(DISTINCT vi.id), evid_ids)
            INTO evid_ids
            FROM jsonb_array_elements(coalesce(recon->'systems', '[]'::jsonb)) sys
            CROSS JOIN LATERAL jsonb_array_elements(coalesce(sys->'stages', '[]'::jsonb)) s
            CROSS JOIN LATERAL jsonb_array_elements(coalesce(s->'sample', '[]'::jsonb)) samp
            JOIN vehicle_images vi
              ON vi.id = nullif(samp->>'image_id', '')::uuid
             AND vi.vehicle_id = p_vehicle_id
           WHERE sys->>'system_key' = 'paint'
             AND s->>'phase' = step_j->>'photo_phase'
             AND nullif(samp->>'image_id', '') IS NOT NULL
             AND public.vehicle_image_gallery_eligible(vi)
             AND coalesce(vi.is_sensitive, false) = false;
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
              SELECT (l->>'item_id')::uuid AS item_id
                FROM jsonb_array_elements(lines) l
               WHERE l->>'system' = sys_key
                 AND l->>'line_kind' IN ('labor', 'service', 'note', 'part')
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
        IF jsonb_array_length(coalesce(statements->'statements', '[]'::jsonb)) = 0 THEN
          ok := false;
          missing := array_append(missing, 'statement_present');
        ELSE
          IF coalesce(array_length(statement_ids, 1), 0) > 0 THEN
            evid_ids := evid_ids || statement_ids;
          END IF;
          evid_grade := coalesce(rule.evidence_requirements->>'evidence_grade', 'statement');
        END IF;

      ELSIF cond->>'type' IN ('part_line_system', 'part_line_operation') THEN
        -- Closed keys only: the shared classifiers' system or labor operation code.
        IF cond->>'type' = 'part_line_system' THEN
          SELECT array_agg(x) INTO ops FROM jsonb_array_elements_text(cond->'systems') x;
        ELSE
          SELECT array_agg(x) INTO ops FROM jsonb_array_elements_text(cond->'operations') x;
        END IF;
        IF cond ? 'line_kinds' THEN
          SELECT array_agg(x) INTO line_kinds FROM jsonb_array_elements_text(cond->'line_kinds') x;
        ELSE
          line_kinds := ARRAY['part'];
        END IF;
        min_n := coalesce((cond->>'min')::int, 1);
        SELECT count(*)::int,
               count(DISTINCT CASE WHEN cond->>'type' = 'part_line_system' THEN l->>'system' ELSE l->>'op' END)::int
          INTO cnt, distinct_n
          FROM jsonb_array_elements(lines) l
         WHERE l->>'line_kind' = ANY (line_kinds)
           AND (CASE WHEN cond->>'type' = 'part_line_system' THEN l->>'system' ELSE l->>'op' END) = ANY (ops);
        IF coalesce(cnt, 0) < min_n
           OR coalesce(distinct_n, 0) < coalesce((cond->>'min_distinct')::int, 1) THEN
          ok := false;
          missing := array_append(missing, format('%s:%s', cond->>'type', array_to_string(ops, ',')));
        ELSE
          SELECT coalesce(evid_ids || array_agg(w.item_id), evid_ids) INTO evid_ids
            FROM (
              SELECT (l->>'item_id')::uuid AS item_id
                FROM jsonb_array_elements(lines) l
               WHERE l->>'line_kind' = ANY (line_kinds)
                 AND (CASE WHEN cond->>'type' = 'part_line_system' THEN l->>'system' ELSE l->>'op' END) = ANY (ops)
               LIMIT 50
            ) w;
        END IF;

      ELSIF cond->>'type' = 'image_scene' THEN
        -- Same public-frame predicates as vehicle_build_reconstruction /
        -- vehicle_open_questions: gallery eligible and not sensitive.
        min_n := coalesce((cond->>'min')::int, 1);
        SELECT count(*)::int INTO cnt
          FROM vehicle_images vi
         WHERE vi.vehicle_id = p_vehicle_id
           AND public.vehicle_image_gallery_eligible(vi)
           AND coalesce(vi.is_sensitive, false) = false
           AND vi.ai_scan_metadata#>>'{byok_deep_analysis,scene_type}' = cond->>'scene_type';
        IF coalesce(cnt, 0) < min_n THEN
          ok := false;
          missing := array_append(missing, format('image_scene:%s', cond->>'scene_type'));
        ELSE
          SELECT coalesce(evid_ids || array_agg(vi.id), evid_ids) INTO evid_ids
            FROM (
              SELECT vi.id FROM vehicle_images vi
               WHERE vi.vehicle_id = p_vehicle_id
                 AND public.vehicle_image_gallery_eligible(vi)
                 AND coalesce(vi.is_sensitive, false) = false
                 AND vi.ai_scan_metadata#>>'{byok_deep_analysis,scene_type}' = cond->>'scene_type'
               LIMIT 20
            ) vi;
        END IF;
      ELSE
        ok := false;
        missing := array_append(missing, format('unknown_condition:%s', cond->>'type'));
      END IF;
    END LOOP;

    -- Citeable evidence ids are required unless statement presence already
    -- set evid_grade for an untied viewer (vehicle_statements withholds statement_id).
    IF (NOT ok) OR (coalesce(array_length(evid_ids, 1), 0) = 0 AND evid_grade IS NULL) THEN
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

    -- Book hours come from the map only. No map row: the segment says so.
    SELECT * INTO est
      FROM public.estimate_labor_from_delta(
        p_vehicle_id, rule.zone_pattern, rule.from_stage, rule.to_stage
      );
    book_min := est.hours_min;
    book_typ := est.hours_typical;
    book_max := est.hours_max;
    IF book_typ IS NULL THEN
      status := 'no book hours';
    END IF;

    -- Body metal: book hours per panel x distinct evidenced panel lines.
    IF rule.evidence_requirements ? 'panel_multiplier' THEN
      SELECT array_agg(x) INTO ops
        FROM jsonb_array_elements_text(rule.evidence_requirements#>'{panel_multiplier,operations}') x;
      SELECT count(DISTINCT l->>'dk')::int INTO panel_count
        FROM jsonb_array_elements(lines) l
       WHERE l->>'line_kind' = 'part' AND l->>'op' = ANY (ops);
      mult := greatest(coalesce(panel_count, 1), 1);
      book_min := book_min * mult;
      book_typ := book_typ * mult;
      book_max := book_max * mult;
      steps_j := jsonb_build_array(jsonb_build_object(
        'from_stage', rule.from_stage,
        'to_stage', rule.to_stage,
        'zone', rule.zone_pattern,
        'panel_count', panel_count,
        'panel_multiplier', mult
      ));
    ELSE
      steps_j := jsonb_build_array(jsonb_build_object(
        'from_stage', rule.from_stage,
        'to_stage', rule.to_stage,
        'zone', rule.zone_pattern
      ));
    END IF;

    hours_min := book_min;
    hours_typ := book_typ;
    hours_max := book_max;
    hours_basis := CASE WHEN book_typ IS NOT NULL THEN 'book' END;

    -- Shop paper wins and is never clipped: no hour figure sits below the paper.
    IF rule.evidence_requirements ? 'paper_hours_system' THEN
      sys_key := rule.evidence_requirements->>'paper_hours_system';
      SELECT (s->'paper'->>'hours')::numeric INTO paper_h
        FROM jsonb_array_elements(coalesce(recon->'systems', '[]'::jsonb)) s
       WHERE s->>'system_key' = sys_key
       LIMIT 1;
      IF paper_h IS NOT NULL THEN
        range_below := book_max IS NOT NULL AND paper_h > book_max;
        hours_min := greatest(coalesce(book_min, paper_h), paper_h);
        hours_typ := greatest(coalesce(book_typ, paper_h), paper_h);
        hours_max := greatest(coalesce(book_max, paper_h), paper_h);
        hours_basis := CASE WHEN book_typ IS NULL OR range_below THEN 'shop_paper' ELSE 'book_at_or_above_paper' END;
        IF status = 'no book hours' THEN status := 'ok'; END IF;
      END IF;
    END IF;

    IF coalesce(array_length(evid_ids, 1), 0) = 0 AND evid_grade IS NULL THEN
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
      'hours_basis', hours_basis,
      'book_hours', CASE WHEN book_typ IS NULL THEN NULL ELSE jsonb_build_object(
        'hours_min', book_min, 'hours_typical', book_typ, 'hours_max', book_max) END,
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

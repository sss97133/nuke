-- labor_witness_v1: hours bought but not witnessed stop counting as work done; a rule names what its evidence proves.
--
-- WHY. Measured live 2026-11-24 on the proof vehicle (anon RPC): 132.5 / 180.5 / 269.5 h. Of that, body metal was
-- 28 / 42 / 84 h = the stage range x 7 purchased panel lines, none witnessed fitted (every receipt_part_visible answer
-- on them is cannot_tell); the gearbox was priced as a rebuild (8-16 h) from two flywheel bolt-set lines that prove at
-- most a remove-and-refit; a purchased part later returned (same part number, a return line) still counted; segments
-- with no evidence carried a grade; a car with nothing priced returned 0 / 0 / 0 instead of unknown; fitted pieces with
-- no book operation read 'no evidence'.
-- NOT FIXED HERE: a stage-priced segment (chassis, interior) is graded fitted_in_photos when any one of its parts is
-- seen fitted, so one fitted part still opens a whole stage range in full (second car: 1977 Blazer chassis 8-24 h).
--
-- WHAT CHANGES.
--   * labor_evidence_grade_policy (new, one row per grade key): which named total a segment of that grade enters.
--     shop_paper, statement, fitted_in_photos, photographed_stage, receipt_part_visible: 'witnessed'; parts_bought:
--     'unwitnessed_purchase' (bought, the fitted question unanswered: not the same as not fitted). Every priced segment
--     carries counts_in and witnessed_hours_min/typical/max. totals carries two named totals side by side, each a fold
--     over the policy rows: totals.witnessed and totals.with_unwitnessed_purchases (min/typical/max each), plus by_grade.
--     The top-level totals.hours_min/typical/max equal with_unwitnessed_purchases for one release (renderer contract).
--     Nothing priced: every total is null with priced_segments = 0. A grade change is a row update, not code.
--   * Returned purchases leave the evidence: a negative charge line saying return (not a core return or exchange) with
--     the same part number cancels one purchase line of that number. totals.returned_lines counts them.
--   * per_piece rule mode (body metal): one piece per distinct part on the rule's operations, each with its own witness
--     (fitted / not_fitted / unwitnessed from answered receipt_part_visible checks; cannot_tell stays unwitnessed).
--     Fitted and unwitnessed pieces price at the range each; only fitted ones enter witnessed_hours; not_fitted pieces
--     never price. Each unwitnessed piece names its witness question state (open, cannot_tell, cancelled or
--     none_raised) with the question ids, so a landing job that raises the question moves it. Replaces
--     panel_multiplier.
--   * labor_stage_rules.hours_operation_code (FK labor_operations): hours come from that stored operation, not a stage
--     range. labor_stage_rules.exclusive_group: segments pricing the same work at different depths; the first open one by sort order prices it,
--     a later open one says counted_in. Gearbox rows: gearbox = remove and refit (MECH-TRANS-RR lines,
--     labor_operations hours); gearbox_rebuild = none -> trans_rebuild only on transmission shop paper.
--   * Grades only on segments with evidence; reassembly with fitted pieces and no book operation says 'no book hours'.
-- Test: supabase/sql/test_vehicle_labor_appraisal_witness.sql (PG17).
--
-- REVERT. Restore the function from 20261124191000 + 20261124120000, set the two rule rows back (panel_multiplier;
-- gearbox none -> trans_rebuild), delete gearbox_rebuild, drop labor_evidence_grade_policy.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $guard$
DECLARE d text := pg_get_functiondef('public.vehicle_labor_appraisal(uuid)'::regprocedure);
BEGIN
  IF position('labor_reader_fast_v1' IN d) = 0 OR position('labor_evidence_grade_v1_end' IN d) = 0
     OR position('labor_grade_no_evidence_v1' IN d) = 0 THEN
    RAISE EXCEPTION 'vehicle_labor_appraisal is not at 20261124191000 + 20261124120000 + 20261124200000; rebase this migration';
  END IF;
END $guard$;

CREATE TABLE IF NOT EXISTS public.labor_evidence_grade_policy (
  grade text PRIMARY KEY,
  counts_in text NOT NULL CHECK (counts_in IN ('witnessed', 'unwitnessed_purchase', 'none')),
  rank int NOT NULL,
  meaning text NOT NULL
);
COMMENT ON TABLE public.labor_evidence_grade_policy IS
  'labor_witness_v1: one row per evidence grade vehicle_labor_appraisal emits; counts_in names the total its segment hours enter (witnessed = both named totals; unwitnessed_purchase = totals.with_unwitnessed_purchases only; none = listed, never added). Written by migrations only; read per call by vehicle_labor_appraisal.';
ALTER TABLE public.labor_evidence_grade_policy ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS labor_evidence_grade_policy_read ON public.labor_evidence_grade_policy;
CREATE POLICY labor_evidence_grade_policy_read ON public.labor_evidence_grade_policy FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.labor_evidence_grade_policy TO anon, authenticated;
-- Two rule fields that are edges, not jsonb text: the stored operation a rule prices from, and the group of rules that
-- price the same work at different depths.
ALTER TABLE public.labor_stage_rules
  ADD COLUMN IF NOT EXISTS hours_operation_code text REFERENCES public.labor_operations(code),
  ADD COLUMN IF NOT EXISTS exclusive_group text;
COMMENT ON COLUMN public.labor_stage_rules.hours_operation_code IS
  'labor_witness_v1: when set, the segment''s hours are this labor_operations row''s base_hours (the evidence proves that operation), not the stage map range.';
COMMENT ON COLUMN public.labor_stage_rules.exclusive_group IS
  'labor_witness_v1: rules pricing the same work at different depths; the first open one by sort_order prices it, later open ones say counted_in.';

INSERT INTO public.labor_evidence_grade_policy (grade, counts_in, rank, meaning) VALUES
  ('shop_paper', 'witnessed', 1, 'hours printed on shop paper for this work'),
  ('statement', 'witnessed', 2, 'a stored statement by someone tied to the vehicle says the work was done'),
  ('receipt_part_visible', 'witnessed', 3, 'each priced piece is seen fitted in a photo'),
  ('fitted_in_photos', 'witnessed', 3, 'at least one of the segment''s parts is seen fitted in a photo'),
  ('photographed_stage', 'witnessed', 4, 'the build stage is seen in photos'),
  ('parts_bought', 'unwitnessed_purchase', 9, 'parts for the work are on receipts; the fitted question is unanswered (not the same as not fitted)')
ON CONFLICT (grade) DO UPDATE SET counts_in = EXCLUDED.counts_in, rank = EXCLUDED.rank, meaning = EXCLUDED.meaning;

CREATE OR REPLACE FUNCTION public.vehicle_labor_appraisal(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  version text := 'vehicle_labor_appraisal/20261124194000.1';
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
  fitted_n int; /* labor_evidence_grade_v1 */
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
  overlap_h numeric;
  overlap_map jsonb;
  returned_ids jsonb := '[]'::jsonb;  -- labor_witness_v1
  each_j jsonb;
  pieces jsonb;
  fit_n int;
  unw_n int;
  nofit_n int;
  op_h numeric;
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

  -- labor_reader_fast_v1: the reconstruction lenses this reader uses are built below, after the lines are read.

  -- Receipt lines are read once, projected to keys only. Descriptions never leave
  -- this statement: later conditions see the shared classifier outputs
  -- (system, labor operation) and an opaque distinctness hash.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'item_id', w.item_id,
           'line_kind', w.line_kind,
           'system', public.receipt_line_system(w.description),
           'op', public.receipt_line_labor_operation(w.description),
           'dk', md5(coalesce(nullif(btrim(w.part_number), ''), lower(btrim(coalesce(w.description, ''))))),
           'h', w.printed_hours,
           'wk', public.receipt_line_work_kind(w.line_kind, w.part_number, w.description)
         )) FILTER (WHERE NOT w.returned), '[]'::jsonb),
         coalesce(jsonb_agg(w.item_id) FILTER (WHERE w.returned), '[]'::jsonb)
    INTO lines, returned_ids
    FROM (
      -- labor_witness_v1: a bought part a later return line cancels is not evidence of work. A return line is a
      -- negative charge whose words say return (a core return or core exchange is a deposit refund, not the part coming
      -- back) from the same vendor with the same part number; each one cancels one purchase line of that number from that
      -- vendor, oldest item id first.
      SELECT x.*,
             x.line_kind = 'part' AND nullif(btrim(x.part_number), '') IS NOT NULL
             AND row_number() OVER (PARTITION BY btrim(x.part_number), lower(btrim(coalesce(x.vendor_name, ''))), x.line_kind = 'part'
                                    ORDER BY x.item_id)
                 <= count(*) FILTER (WHERE x.line_kind = 'charge' AND x.total_price < 0
                                       AND lower(x.description) ~ '\mreturn' AND lower(x.description) !~ '\mcore\M')
                      OVER (PARTITION BY btrim(x.part_number), lower(btrim(coalesce(x.vendor_name, '')))) AS returned
        FROM public.receipt_work_lines(p_vehicle_id, 90, 0) x
       WHERE x.item_id IS NOT NULL) w;

  -- labor_reader_fast_v1: shop paper per system and the build phases photographed, from the same shared reads
  -- vehicle_build_reconstruction uses (receipt_line_work_kind, vehicle_reviewed_phase_frames), shaped as its systems[].
  WITH f AS (
    SELECT public.build_phase_system(x.phase) AS system_key, x.phase, x.image_id, x.taken_at
      FROM public.vehicle_reviewed_phase_frames(p_vehicle_id) x
     WHERE public.build_phase_system(x.phase) IS NOT NULL),
  st AS (
    SELECT q.system_key, jsonb_agg(jsonb_build_object('phase', q.phase, 'images', q.images, 'sample', q.sample) ORDER BY q.phase) AS stages
      FROM (SELECT f.system_key, f.phase, count(*) AS images,
                   (SELECT jsonb_agg(jsonb_build_object('image_id', t.image_id) ORDER BY t.taken_at, t.image_id)
                      FROM (SELECT g.image_id, g.taken_at FROM f g WHERE g.phase = f.phase
                             ORDER BY g.taken_at, g.image_id LIMIT 6) t) AS sample
              FROM f GROUP BY f.system_key, f.phase) q
     GROUP BY q.system_key),
  pp AS (
    SELECT coalesce(l->>'system', 'unplaced') AS system_key,
           count(*) FILTER (WHERE l->>'wk' IN ('labor', 'note', 'service')) AS paper_lines,
           sum((l->>'h')::numeric) AS paper_hours
      FROM jsonb_array_elements(lines) l
     WHERE l->>'line_kind' IN ('part', 'labor', 'note', 'backordered', 'kit_component')
     GROUP BY 1)
  SELECT jsonb_build_object('systems', coalesce(jsonb_agg(jsonb_build_object(
           'system_key', coalesce(pp.system_key, st.system_key),
           'paper', jsonb_build_object('lines', coalesce(pp.paper_lines, 0), 'hours', pp.paper_hours),
           'stages', st.stages)), '[]'::jsonb))
    INTO recon
    FROM pp FULL JOIN st ON st.system_key = pp.system_key;

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
              'system', public.receipt_line_system(piece.description),
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
          -- labor_witness_v1: fitted pieces with no book operation are evidence without an hours source, not no evidence
          status := 'no book hours';
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
        'evidence_grade', CASE WHEN status <> 'no evidence' THEN 'receipt_part_visible' END,
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
        'evidence_grade', CASE WHEN status <> 'no evidence' THEN 'photographed_stage' END,
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

    -- Book hours come from the stage map, or from one stored operation when the rule names it
    -- (labor_stage_rules.hours_operation_code: the evidence proves that operation, not a stage). No row: the segment says so.
    IF rule.hours_operation_code IS NOT NULL THEN
      op_h := NULL;
      SELECT o.base_hours INTO op_h
        FROM labor_operations o
       WHERE o.code = rule.hours_operation_code
         AND (o.model_year_min IS NULL OR v.year IS NULL OR v.year >= o.model_year_min)
         AND (o.model_year_max IS NULL OR v.year IS NULL OR v.year <= o.model_year_max)
       LIMIT 1;
      book_min := op_h; book_typ := op_h; book_max := op_h;
    ELSE
      SELECT * INTO est
        FROM public.estimate_labor_from_delta(
          p_vehicle_id, rule.zone_pattern, rule.from_stage, rule.to_stage
        );
      book_min := est.hours_min;
      book_typ := est.hours_typical;
      book_max := est.hours_max;
    END IF;
    IF book_typ IS NULL THEN
      status := 'no book hours';
    END IF;
    steps_j := jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'from_stage', rule.from_stage,
      'to_stage', rule.to_stage,
      'zone', rule.zone_pattern,
      'operation_code', rule.hours_operation_code
    )));

    -- labor_witness_v1: per piece. One piece per distinct part (part number, else words) on the rule's operations;
    -- each piece carries its own witness from answered receipt_part_visible checks on any of its lines:
    -- fitted (installed = yes), not_fitted (installed = no, never priced), unwitnessed (nothing answered yes or no;
    -- cannot_tell stays unwitnessed). Fitted and unwitnessed pieces price at the rule's range each; only fitted ones
    -- enter witnessed_hours. An unwitnessed piece names the state of its witness question and the question ids.
    IF rule.evidence_requirements ? 'per_piece' THEN
      SELECT array_agg(x) INTO ops
        FROM jsonb_array_elements_text(rule.evidence_requirements#>'{per_piece,operations}') x;
      WITH pc AS (
        SELECT l->>'dk' AS dk, array_agg(DISTINCT l->>'item_id') AS items
          FROM jsonb_array_elements(lines) l
         WHERE l->>'line_kind' = 'part' AND l->>'op' = ANY (ops)
         GROUP BY 1),
      ans AS (
        SELECT nullif(coalesce(e.params->>'item_id', e.params#>>'{question_context,item_id}', e.subject_id::text), '') AS item_id,
               CASE WHEN e.status = 'answered' THEN e.answer->>'installed' END AS installed, e.status, e.id
          FROM evidence_judgment_requests e
         WHERE e.vehicle_id = p_vehicle_id
           AND e.question_kind = 'receipt_part_visible'
           AND e.superseded_by IS NULL),
      wt AS (
        SELECT pc.items,
               CASE WHEN bool_or(a.installed = 'yes') THEN 'fitted'
                    WHEN bool_or(a.installed = 'no') THEN 'not_fitted'
                    ELSE 'unwitnessed' END AS witness,
               array_agg(a.id ORDER BY a.id) FILTER (WHERE a.installed IN ('yes', 'no')) AS judgment_ids,
               CASE WHEN bool_or(a.status NOT IN ('answered', 'cancelled')) THEN 'open'
                    WHEN bool_or(a.installed = 'cannot_tell') THEN 'cannot_tell'
                    WHEN bool_or(a.status = 'cancelled') THEN 'cancelled'
                    ELSE 'none_raised' END AS question_state,
               array_agg(a.id ORDER BY a.id) FILTER (WHERE a.id IS NOT NULL AND coalesce(a.installed, '') NOT IN ('yes', 'no')) AS question_ids
          FROM pc LEFT JOIN ans a ON a.item_id = ANY (pc.items)
         GROUP BY pc.dk, pc.items)
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'item_ids', to_jsonb(wt.items), 'witness', wt.witness,
               'judgment_ids', coalesce(to_jsonb(wt.judgment_ids), '[]'::jsonb))
             || CASE WHEN wt.witness = 'unwitnessed' THEN jsonb_build_object(
                  'question_state', wt.question_state,
                  'question_ids', coalesce(to_jsonb(wt.question_ids), '[]'::jsonb)) ELSE '{}'::jsonb END
             ORDER BY wt.items[1]), '[]'::jsonb),
             count(*) FILTER (WHERE wt.witness = 'fitted')::int,
             count(*) FILTER (WHERE wt.witness = 'unwitnessed')::int,
             count(*) FILTER (WHERE wt.witness = 'not_fitted')::int
        INTO pieces, fit_n, unw_n, nofit_n
        FROM wt;
      each_j := CASE WHEN book_typ IS NOT NULL THEN jsonb_build_object(
                  'hours_min', book_min, 'hours_typical', book_typ, 'hours_max', book_max) END;
      IF fit_n + unw_n > 0 THEN
        book_min := book_min * (fit_n + unw_n);
        book_typ := book_typ * (fit_n + unw_n);
        book_max := book_max * (fit_n + unw_n);
      ELSE
        ok := false;
        status := 'no evidence';
      END IF;
      steps_j := jsonb_build_array(jsonb_build_object(
        'from_stage', rule.from_stage,
        'to_stage', rule.to_stage,
        'zone', rule.zone_pattern,
        'mode', 'per_piece',
        'hours_each', each_j,
        -- only the fitted pieces are witnessed work
        'witnessed_hours', CASE WHEN each_j IS NOT NULL THEN jsonb_build_object(
            'hours_min', (each_j->>'hours_min')::numeric * fit_n,
            'hours_typical', (each_j->>'hours_typical')::numeric * fit_n,
            'hours_max', (each_j->>'hours_max')::numeric * fit_n) END,
        'fitted_count', fit_n,
        'unwitnessed_count', unw_n,
        'not_fitted_count', nofit_n,
        'pieces', pieces
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

    IF status = 'no evidence' OR (coalesce(array_length(evid_ids, 1), 0) = 0 AND evid_grade IS NULL) THEN
      status := 'no evidence';
      hours_min := NULL; hours_typ := NULL; hours_max := NULL;
    END IF;

    IF evid_grade IS NULL AND rule.evidence_requirements ? 'evidence_grade' THEN
      evid_grade := rule.evidence_requirements->>'evidence_grade';
    END IF;

    -- labor_evidence_grade_v1: grade the segment from its own evidence rows.
    fitted_n := NULL;
    IF status <> 'no evidence'
       AND NOT (rule.evidence_requirements ? 'reassembly_pieces')
       AND NOT (rule.evidence_requirements ? 'paint_chain') THEN
      SELECT count(DISTINCT x.item_id)::int INTO fitted_n
        FROM (SELECT nullif(coalesce(e.params->>'item_id', e.params#>>'{question_context,item_id}', e.subject_id::text), '') AS item_id
                FROM evidence_judgment_requests e
               WHERE e.vehicle_id = p_vehicle_id
                 AND e.question_kind = 'receipt_part_visible'
                 AND e.status = 'answered'
                 AND e.superseded_by IS NULL
                 AND e.answer->>'installed' = 'yes') x
       WHERE x.item_id = ANY (SELECT i::text FROM unnest(evid_ids) i);
      IF evid_grade IS NULL THEN
        evid_grade := CASE WHEN paper_h IS NOT NULL THEN 'shop_paper'
                           WHEN fitted_n > 0 THEN 'fitted_in_photos'
                           ELSE 'parts_bought' END;
      END IF;
    END IF;
    IF status = 'no evidence' THEN evid_grade := NULL; END IF; /* labor_grade_no_evidence_v1 */
    -- labor_evidence_grade_v1_end

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
      'fitted_parts', fitted_n,
      'citation', rule.citation
    );
    segments := segments || seg;
    IF hours_min IS NOT NULL THEN
      tot_min := tot_min + hours_min;
      tot_typ := tot_typ + hours_typ;
      tot_max := tot_max + hours_max;
    END IF;
  END LOOP;

  -- labor_witness_v1: segments in one exclusive_group price the same work at different depths (a gearbox rebuild
  -- includes taking it out and refitting it). The first open segment of the group by sort order prices it; a later open
  -- one is listed with counted_in and no hours.
  SELECT jsonb_agg(CASE WHEN x.winner IS NOT NULL AND x.winner <> x.s ->> 'segment' THEN
                     x.s || jsonb_build_object('status', 'counted_in', 'counted_in', x.winner,
                                               'hours_min', NULL, 'hours_typical', NULL, 'hours_max', NULL)
                   ELSE x.s END ORDER BY x.i)
    INTO segments
    FROM (SELECT t.s, t.i,
                 (SELECT r2.segment_key
                    FROM labor_stage_rules r2
                    JOIN jsonb_array_elements(segments) s2 ON s2 ->> 'segment' = r2.segment_key AND s2 ->> 'hours_min' IS NOT NULL
                   WHERE r2.active IS TRUE
                     AND r2.exclusive_group = r.exclusive_group
                   ORDER BY r2.sort_order, r2.segment_key LIMIT 1) AS winner
            FROM jsonb_array_elements(segments) WITH ORDINALITY AS t(s, i)
            LEFT JOIN labor_stage_rules r ON r.segment_key = t.s ->> 'segment' AND r.active IS TRUE
                                         AND r.exclusive_group IS NOT NULL
                                         AND t.s ->> 'hours_min' IS NOT NULL) x;

  -- A reassembly piece whose work an open segment already prices (that segment's rule keys on the piece's operation
  -- code or line system) is counted there, not twice: it stays listed with counted_in, and its hours leave
  -- reassembly and the totals (shown as hours_counted_elsewhere).
  SELECT coalesce(sum((p ->> 'hours')::numeric), 0), jsonb_object_agg(p ->> 'judgment_id', o.segment_key)
    INTO overlap_h, overlap_map
    FROM jsonb_array_elements(segments) s
   CROSS JOIN LATERAL jsonb_array_elements(coalesce(s #> '{reassembly,matched}', '[]'::jsonb)) p
   CROSS JOIN LATERAL (
     SELECT r.segment_key
       FROM labor_stage_rules r
       JOIN jsonb_array_elements(segments) s2 ON s2 ->> 'segment' = r.segment_key AND s2 ->> 'status' = 'ok'
      WHERE r.active IS TRUE AND r.segment_key <> s ->> 'segment'
        AND (jsonb_path_exists(r.evidence_requirements, '$.**.operations[*] ? (@ == $v)', jsonb_build_object('v', p ->> 'operation_code'))
          OR jsonb_path_exists(r.evidence_requirements, '$.**.systems[*] ? (@ == $v)', jsonb_build_object('v', p ->> 'system')))
      ORDER BY r.sort_order, r.segment_key
      LIMIT 1) o
   WHERE s ? 'reassembly';
  IF overlap_h > 0 THEN
    SELECT jsonb_agg(CASE WHEN s ? 'reassembly' THEN
             s || jsonb_build_object(
               'hours_min', (s ->> 'hours_min')::numeric - overlap_h,
               'hours_typical', (s ->> 'hours_typical')::numeric - overlap_h,
               'hours_max', (s ->> 'hours_max')::numeric - overlap_h,
               'hours_counted_elsewhere', overlap_h,
               'reassembly', jsonb_set(s -> 'reassembly', '{matched}', (
                 SELECT jsonb_agg(CASE WHEN overlap_map ? (p ->> 'judgment_id')
                                       THEN p || jsonb_build_object('counted_in', overlap_map ->> (p ->> 'judgment_id'))
                                       ELSE p END ORDER BY m.ord)
                   FROM jsonb_array_elements(s #> '{reassembly,matched}') WITH ORDINALITY AS m(p, ord))))
           ELSE s END ORDER BY t.i)
      INTO segments
      FROM jsonb_array_elements(segments) WITH ORDINALITY AS t(s, i);
  END IF;

  -- labor_witness_v1: counts_in and witnessed hours on every priced segment, from the grade policy rows.
  SELECT coalesce(jsonb_agg(CASE WHEN t.s ->> 'hours_min' IS NOT NULL THEN
           t.s || jsonb_build_object(
             'counts_in', coalesce(gp.counts_in, 'witnessed'),
             'witnessed_hours_min', CASE WHEN t.s #> '{stage_steps,0,witnessed_hours}' IS NOT NULL
                                         THEN (t.s #>> '{stage_steps,0,witnessed_hours,hours_min}')::numeric
                                         WHEN coalesce(gp.counts_in, 'witnessed') = 'witnessed' THEN (t.s ->> 'hours_min')::numeric
                                         ELSE 0 END,
             'witnessed_hours_typical', CASE WHEN t.s #> '{stage_steps,0,witnessed_hours}' IS NOT NULL
                                             THEN (t.s #>> '{stage_steps,0,witnessed_hours,hours_typical}')::numeric
                                             WHEN coalesce(gp.counts_in, 'witnessed') = 'witnessed' THEN (t.s ->> 'hours_typical')::numeric
                                             ELSE 0 END,
             'witnessed_hours_max', CASE WHEN t.s #> '{stage_steps,0,witnessed_hours}' IS NOT NULL
                                         THEN (t.s #>> '{stage_steps,0,witnessed_hours,hours_max}')::numeric
                                         WHEN coalesce(gp.counts_in, 'witnessed') = 'witnessed' THEN (t.s ->> 'hours_max')::numeric
                                         ELSE 0 END)
           ELSE t.s END ORDER BY t.i), '[]'::jsonb)
    INTO segments
    FROM jsonb_array_elements(segments) WITH ORDINALITY AS t(s, i)
    LEFT JOIN labor_evidence_grade_policy gp ON gp.grade = t.s ->> 'evidence_grade';

  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'applicable', true,
    -- labor_witness_v1: every priced segment says which named total it enters (labor_evidence_grade_policy, by its
    -- grade) and its witnessed hours: a per_piece segment's fitted pieces, else all of it when its grade is witnessed,
    -- else none. Two named totals side by side, each a fold over those rows; the top-level hours equal
    -- with_unwitnessed_purchases for one release. Nothing priced: the totals are unknown (null), not zero.
    'segments', segments,
    'totals', (SELECT jsonb_build_object(
        'hours_min', sum((s ->> 'hours_min')::numeric) FILTER (WHERE c IN ('witnessed', 'unwitnessed_purchase')),
        'hours_typical', sum((s ->> 'hours_typical')::numeric) FILTER (WHERE c IN ('witnessed', 'unwitnessed_purchase')),
        'hours_max', sum((s ->> 'hours_max')::numeric) FILTER (WHERE c IN ('witnessed', 'unwitnessed_purchase')),
        'with_unwitnessed_purchases', CASE WHEN count(*) FILTER (WHERE c IN ('witnessed', 'unwitnessed_purchase')) > 0 THEN jsonb_build_object(
            'hours_min', sum((s ->> 'hours_min')::numeric) FILTER (WHERE c IN ('witnessed', 'unwitnessed_purchase')),
            'hours_typical', sum((s ->> 'hours_typical')::numeric) FILTER (WHERE c IN ('witnessed', 'unwitnessed_purchase')),
            'hours_max', sum((s ->> 'hours_max')::numeric) FILTER (WHERE c IN ('witnessed', 'unwitnessed_purchase'))) END,
        'witnessed', CASE WHEN count(*) FILTER (WHERE c IN ('witnessed', 'unwitnessed_purchase')) > 0 THEN jsonb_build_object(
            'hours_min', coalesce(sum((s ->> 'witnessed_hours_min')::numeric), 0),
            'hours_typical', coalesce(sum((s ->> 'witnessed_hours_typical')::numeric), 0),
            'hours_max', coalesce(sum((s ->> 'witnessed_hours_max')::numeric), 0)) END,
        'priced_segments', count(*) FILTER (WHERE c IN ('witnessed', 'unwitnessed_purchase')),
        'unwitnessed_purchase_segments', count(*) FILTER (WHERE c = 'unwitnessed_purchase'),
        'rule', 'witnessed adds each priced segment''s witnessed hours; with_unwitnessed_purchases adds every priced segment whose grade enters a total (labor_evidence_grade_policy); hours_min/typical/max = with_unwitnessed_purchases; null when nothing is priced',
        'returned_lines', jsonb_array_length(returned_ids),
        'by_grade', (SELECT coalesce(jsonb_object_agg(g.grade, jsonb_build_object(
                              'hours_min', g.mn, 'hours_typical', g.ty, 'hours_max', g.mx, 'segments', g.n)), '{}'::jsonb)
                       FROM (SELECT coalesce(s2->>'evidence_grade', 'ungraded') AS grade,
                                    sum((s2->>'hours_min')::numeric) AS mn, sum((s2->>'hours_typical')::numeric) AS ty,
                                    sum((s2->>'hours_max')::numeric) AS mx, count(*) AS n
                               FROM jsonb_array_elements(segments) s2
                              WHERE s2->>'hours_min' IS NOT NULL
                              GROUP BY 1) g))
      FROM (SELECT t.s, t.s ->> 'counts_in' AS c FROM jsonb_array_elements(segments) t(s)) z(s, c)),
    'logic_version', version,
    'as_of', now()
  );
END
$function$;

UPDATE public.labor_stage_rules
   SET evidence_requirements = '{"all":[{"min":1,"type":"part_line_operation","operations":["BODY-RUST-PANEL"]}],"per_piece":{"operations":["BODY-RUST-PANEL"]}}'::jsonb,
       citation = 'stage_transition_labor_map:body panel_* stripped->fabricated per distinct panel; fitted pieces witnessed, unwitnessed pieces with_unwitnessed_purchases only'
 WHERE segment_key = 'body_metal' AND evidence_requirements ? 'panel_multiplier';

UPDATE public.labor_stage_rules
   SET from_stage = 'in_car', to_stage = 'removed_and_refit',
       evidence_requirements = '{"all":[{"min":1,"type":"part_line_operation","operations":["MECH-TRANS-RR"]}]}'::jsonb,
       hours_operation_code = 'MECH-TRANS-RR', exclusive_group = 'gearbox',
       citation = 'labor_operations:MECH-TRANS-RR (remove and refit); a rebuild is the gearbox_rebuild segment'
 WHERE segment_key = 'gearbox' AND to_stage = 'trans_rebuild';

INSERT INTO public.labor_stage_rules (segment_key, category, from_stage, to_stage, zone_pattern, evidence_requirements, citation, sort_order, active, exclusive_group)
SELECT 'gearbox_rebuild', 'powertrain', 'none', 'trans_rebuild', '*',
       '{"all":[{"min":1,"type":"reconstruction_paper_lines","system_key":"transmission"}],"paper_hours_system":"transmission"}'::jsonb,
       'stage_transition_labor_map:powertrain none->trans_rebuild; only on transmission shop paper', 15, true, 'gearbox'
 WHERE NOT EXISTS (SELECT 1 FROM public.labor_stage_rules WHERE segment_key = 'gearbox_rebuild');

-- labor_edges_v1: a labor rule references the stage transitions it prices and the operations it requires by foreign key.
--
-- WHY. Measured live 2026-11-24 (v_schema_atlas, pg_constraint): labor_stage_rules, stage_transition_labor_map and
-- labor_operations had no foreign key in or out. vehicle_labor_appraisal found a rule's transition at read time by text
-- (estimate_labor_from_delta: exact zone, then LIKE pattern, then '*'), paint's four steps sat in a jsonb array, and the
-- operation codes a rule requires (gearbox, electrical, body metal twice, interior: 8 references) were jsonb strings.
--
-- WHAT CHANGES.
--   * labor_stage_rule_transitions (rule_id FK labor_stage_rules, step_no, transition_id FK stage_transition_labor_map,
--     photo_phase): one row per priced step. Backfilled with the row estimate_labor_from_delta resolves today, asserted
--     here to give the same hours; paint gets its four chain steps.
--   * labor_stage_rule_operations (rule_id FK labor_stage_rules, operation_code FK labor_operations, role evidence |
--     per_piece): backfilled from the jsonb arrays, asserted equal; the arrays are then removed from the rule rows so
--     there is one source.
--   * vehicle_labor_appraisal reads both tables: hours come from the transition row by id, a part_line_operation
--     condition and per-piece mode read the rule's operation rows, and the reassembly overlap check joins them. Every
--     priced step carries its transition_id. Systems (suspension, steering, brakes ...) stay text: no keyed system
--     registry exists yet.
-- Grain: rule x step; rule x operation x role. Writer: migrations. Recompute: per read; a new row changes the next read.
-- Test: supabase/sql/test_vehicle_labor_appraisal_edges.sql (PG17).
--
-- REVERT. Restore the jsonb arrays from labor_stage_rule_operations / labor_stage_rule_transitions, redefine the function
-- without labor_edges_v1 (restore the anchors below), drop the two tables.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.labor_stage_rule_transitions (
  rule_id uuid NOT NULL REFERENCES public.labor_stage_rules(id) ON DELETE CASCADE,
  step_no integer NOT NULL CHECK (step_no > 0),
  transition_id uuid NOT NULL REFERENCES public.stage_transition_labor_map(id),
  photo_phase text,
  PRIMARY KEY (rule_id, step_no)
);
COMMENT ON TABLE public.labor_stage_rule_transitions IS
  'labor_edges_v1: the stage_transition_labor_map rows a labor_stage_rules row prices, in order (paint: its chain; photo_phase = the reviewed build phase that must be photographed for that step). Written by migrations; read per call by vehicle_labor_appraisal.';
CREATE TABLE IF NOT EXISTS public.labor_stage_rule_operations (
  rule_id uuid NOT NULL REFERENCES public.labor_stage_rules(id) ON DELETE CASCADE,
  operation_code text NOT NULL REFERENCES public.labor_operations(code),
  role text NOT NULL CHECK (role IN ('evidence', 'per_piece')),
  PRIMARY KEY (rule_id, operation_code, role)
);
COMMENT ON TABLE public.labor_stage_rule_operations IS
  'labor_edges_v1: labor_operations a labor_stage_rules row requires: evidence = receipt part lines classified to it open the segment; per_piece = each distinct part line classified to it is one priced piece. Written by migrations; read per call by vehicle_labor_appraisal.';
CREATE INDEX IF NOT EXISTS labor_stage_rule_operations_code_idx ON public.labor_stage_rule_operations (operation_code);
CREATE INDEX IF NOT EXISTS labor_stage_rule_transitions_transition_idx ON public.labor_stage_rule_transitions (transition_id);
ALTER TABLE public.labor_stage_rule_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.labor_stage_rule_operations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS labor_stage_rule_transitions_read ON public.labor_stage_rule_transitions;
CREATE POLICY labor_stage_rule_transitions_read ON public.labor_stage_rule_transitions FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS labor_stage_rule_operations_read ON public.labor_stage_rule_operations;
CREATE POLICY labor_stage_rule_operations_read ON public.labor_stage_rule_operations FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.labor_stage_rule_transitions, public.labor_stage_rule_operations TO anon, authenticated;

DO $backfill$
DECLARE bad int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.labor_stage_rule_transitions) OR EXISTS (SELECT 1 FROM public.labor_stage_rule_operations) THEN
    RETURN;  -- already backfilled
  END IF;
  -- Transitions: the row estimate_labor_from_delta resolves (exact zone, else pattern, else '*').
  INSERT INTO public.labor_stage_rule_transitions (rule_id, step_no, transition_id, photo_phase)
  SELECT s.rule_id, s.step_no, m.id, s.photo_phase
    FROM (SELECT r.id AS rule_id, r.zone_pattern, x.ord::int AS step_no, x.st->>'from_stage' AS from_stage,
                 x.st->>'to_stage' AS to_stage, nullif(x.st->>'photo_phase', '') AS photo_phase
            FROM public.labor_stage_rules r
            CROSS JOIN LATERAL jsonb_array_elements(r.evidence_requirements->'paint_chain') WITH ORDINALITY AS x(st, ord)
           WHERE r.evidence_requirements ? 'paint_chain'
          UNION ALL
          SELECT r.id, r.zone_pattern, 1, r.from_stage, r.to_stage, NULL
            FROM public.labor_stage_rules r
           WHERE NOT (r.evidence_requirements ? 'paint_chain')) s
    CROSS JOIN LATERAL (
      SELECT m.id FROM public.stage_transition_labor_map m
       WHERE m.from_stage = s.from_stage AND m.to_stage = s.to_stage
         AND (m.zone_pattern = s.zone_pattern
              OR (m.zone_pattern <> '*' AND s.zone_pattern LIKE replace(m.zone_pattern, '*', '%'))
              OR m.zone_pattern = '*')
       ORDER BY (m.zone_pattern = s.zone_pattern) DESC,
                (m.zone_pattern <> '*' AND s.zone_pattern LIKE replace(m.zone_pattern, '*', '%')) DESC
       LIMIT 1) m;
  -- Same hours as the text lookup, step by step.
  SELECT count(*) INTO bad
    FROM public.labor_stage_rule_transitions t
    JOIN public.labor_stage_rules r ON r.id = t.rule_id
    JOIN public.stage_transition_labor_map m ON m.id = t.transition_id
    CROSS JOIN LATERAL public.estimate_labor_from_delta(NULL::uuid, r.zone_pattern, m.from_stage, m.to_stage) e
   WHERE (e.hours_min, e.hours_typical, e.hours_max) IS DISTINCT FROM (m.estimated_hours_min, m.estimated_hours_typical, m.estimated_hours_max);
  IF bad > 0 THEN RAISE EXCEPTION 'labor_edges_v1: % transition rows differ from estimate_labor_from_delta', bad; END IF;

  -- Operations: every jsonb operations array, by role.
  INSERT INTO public.labor_stage_rule_operations (rule_id, operation_code, role)
  SELECT DISTINCT r.id, o.code, 'evidence'
    FROM public.labor_stage_rules r
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(r.evidence_requirements->'all', '[]'::jsonb)) c
    CROSS JOIN LATERAL jsonb_array_elements_text(c->'operations') o(code)
   WHERE c->>'type' = 'part_line_operation'
  UNION
  SELECT DISTINCT r.id, o.code, 'per_piece'
    FROM public.labor_stage_rules r
    CROSS JOIN LATERAL jsonb_array_elements_text(r.evidence_requirements#>'{per_piece,operations}') o(code)
   WHERE r.evidence_requirements #> '{per_piece,operations}' IS NOT NULL;
  -- A rule holds at most one part_line_operation condition (the reader keys its operations by rule and role).
  SELECT count(*) INTO bad FROM (
    SELECT r.id FROM public.labor_stage_rules r
      CROSS JOIN LATERAL jsonb_array_elements(coalesce(r.evidence_requirements->'all', '[]'::jsonb)) c
     WHERE c->>'type' = 'part_line_operation' GROUP BY r.id HAVING count(*) > 1) x;
  IF bad > 0 THEN RAISE EXCEPTION 'labor_edges_v1: % rules have more than one part_line_operation condition', bad; END IF;

  -- One source: the arrays leave the rule rows.
  UPDATE public.labor_stage_rules r
     SET evidence_requirements = jsonb_set(r.evidence_requirements, '{all}', (
           SELECT jsonb_agg(CASE WHEN c->>'type' = 'part_line_operation' THEN c - 'operations' ELSE c END ORDER BY ord)
             FROM jsonb_array_elements(r.evidence_requirements->'all') WITH ORDINALITY AS x(c, ord)))
   WHERE r.evidence_requirements ? 'all'
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(r.evidence_requirements->'all') c WHERE c ? 'operations');
  UPDATE public.labor_stage_rules
     SET evidence_requirements = jsonb_set(evidence_requirements, '{per_piece}', (evidence_requirements->'per_piece') - 'operations')
   WHERE evidence_requirements #> '{per_piece,operations}' IS NOT NULL;
  UPDATE public.labor_stage_rules
     SET evidence_requirements = jsonb_set(evidence_requirements, '{paint_chain}', 'true'::jsonb)
   WHERE jsonb_typeof(evidence_requirements->'paint_chain') = 'array';
END $backfill$;

DO $patch$
DECLARE
  d text;
  n integer;
  a_ver text := $a$  version text := 'vehicle_labor_appraisal/20261124205500.1';
$a$;
  r_ver text := $r$  version text := 'vehicle_labor_appraisal/20261124213000.1';
$r$;
  a_decl text := $a$  op_cap integer; /* labor_pair_ops_v1 */
$a$;
  r_decl text := $r$  op_cap integer; /* labor_pair_ops_v1 */
  tr_id uuid; /* labor_edges_v1 */
$r$;
  a_chain text := $a$FOR step_j IN SELECT value FROM jsonb_array_elements(rule.evidence_requirements->'paint_chain')$a$;
  r_chain text := $r$FOR step_j IN SELECT jsonb_build_object('from_stage', m.from_stage, 'to_stage', m.to_stage,
                                         'photo_phase', t.photo_phase, 'transition_id', m.id) /* labor_edges_v1 */
                      FROM labor_stage_rule_transitions t
                      JOIN stage_transition_labor_map m ON m.id = t.transition_id
                     WHERE t.rule_id = rule.id
                     ORDER BY t.step_no$r$;
  a_chain_est text := $a$          SELECT * INTO est
            FROM public.estimate_labor_from_delta(
              p_vehicle_id, rule.zone_pattern,
              step_j->>'from_stage', step_j->>'to_stage'
            );
$a$;
  r_chain_est text := $r$          SELECT m.estimated_hours_min AS hours_min, m.estimated_hours_typical AS hours_typical,
                 m.estimated_hours_max AS hours_max
            INTO est
            FROM stage_transition_labor_map m
           WHERE m.id = (step_j->>'transition_id')::uuid;
$r$;
  a_chain_step text := $a$            'photo_phase', step_j->>'photo_phase',
            'status', 'supported',
$a$;
  r_chain_step text := $r$            'photo_phase', step_j->>'photo_phase',
            'transition_id', step_j->>'transition_id',
            'status', 'supported',
$r$;
  a_est text := $a$      SELECT * INTO est
        FROM public.estimate_labor_from_delta(
          p_vehicle_id, rule.zone_pattern, rule.from_stage, rule.to_stage
        );
      book_min := est.hours_min;
$a$;
  r_est text := $r$      -- labor_edges_v1: the rule's priced transition, by key (labor_stage_rule_transitions)
      tr_id := NULL;
      SELECT m.id, m.estimated_hours_min AS hours_min, m.estimated_hours_typical AS hours_typical,
             m.estimated_hours_max AS hours_max
        INTO est
        FROM labor_stage_rule_transitions t
        JOIN stage_transition_labor_map m ON m.id = t.transition_id
       WHERE t.rule_id = rule.id
       ORDER BY t.step_no
       LIMIT 1;
      tr_id := est.id;
      book_min := est.hours_min;
$r$;
  a_op_branch text := $a$      book_min := op_h; book_typ := op_h; book_max := op_h;
$a$;
  r_op_branch text := $r$      book_min := op_h; book_typ := op_h; book_max := op_h;
      tr_id := NULL;
$r$;
  a_step text := $a$      'operation_code', rule.hours_operation_code
    )));
$a$;
  r_step text := $r$      'operation_code', rule.hours_operation_code,
      'transition_id', tr_id
    )));
$r$;
  a_ops text := $a$          SELECT array_agg(x) INTO ops FROM jsonb_array_elements_text(cond->'operations') x;$a$;
  r_ops text := $r$          SELECT array_agg(o.operation_code ORDER BY o.operation_code) INTO ops
            FROM labor_stage_rule_operations o WHERE o.rule_id = rule.id AND o.role = 'evidence';$r$;
  a_pp text := $a$      SELECT array_agg(x) INTO ops
        FROM jsonb_array_elements_text(rule.evidence_requirements#>'{per_piece,operations}') x;$a$;
  r_pp text := $r$      SELECT array_agg(o.operation_code ORDER BY o.operation_code) INTO ops
        FROM labor_stage_rule_operations o WHERE o.rule_id = rule.id AND o.role = 'per_piece';$r$;
  a_overlap text := $a$        AND (jsonb_path_exists(r.evidence_requirements, '$.**.operations[*] ? (@ == $v)', jsonb_build_object('v', p ->> 'operation_code'))$a$;
  r_overlap text := $r$        AND (EXISTS (SELECT 1 FROM labor_stage_rule_operations ro
                      WHERE ro.rule_id = r.id AND ro.operation_code = p ->> 'operation_code')$r$;
  anchors text[];
  repls text[];
  i int;
BEGIN
  d := pg_get_functiondef('public.vehicle_labor_appraisal(uuid)'::regprocedure);
  IF position('labor_edges_v1' IN d) > 0 THEN RETURN; END IF;
  IF position('labor_pair_ops_v1' IN d) = 0 THEN
    RAISE EXCEPTION 'vehicle_labor_appraisal is not at 20261124205500; rebase this migration';
  END IF;
  anchors := ARRAY[a_ver, a_decl, a_chain, a_chain_est, a_chain_step, a_est, a_op_branch, a_step, a_ops, a_pp, a_overlap];
  repls := ARRAY[r_ver, r_decl, r_chain, r_chain_est, r_chain_step, r_est, r_op_branch, r_step, r_ops, r_pp, r_overlap];
  FOR i IN 1 .. array_length(anchors, 1) LOOP
    n := (length(d) - length(replace(d, anchors[i], ''))) / length(anchors[i]);
    IF n <> 1 THEN RAISE EXCEPTION 'labor edges anchor % drifted: % matches', i, n; END IF;
    d := replace(d, anchors[i], repls[i]);
  END LOOP;
  EXECUTE d;
END $patch$;

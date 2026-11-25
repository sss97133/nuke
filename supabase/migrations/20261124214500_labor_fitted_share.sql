-- labor_fitted_share_v1: a stage-priced segment's witnessed hours come piece by piece from its evidence parts, not from
-- any one fitted part opening the whole stage. No threshold.
--
-- WHY. Measured live 2026-11-24 (anon reader + evidence_judgment_requests): chassis on the proof vehicle has 29 evidence
-- part lines, 1 answered fitted, 3 cannot_tell, 25 never asked; on the 1977 Blazer 15 lines, 1 fitted, 8 cannot_tell.
-- The grade rule (labor_evidence_grade_v1) called both fitted_in_photos, so the whole 8-24 h stage range counted as
-- witnessed work on one witnessed part, and on both cars that part has no labor operation.
--
-- WHAT CHANGES (segments priced by a stage range from part evidence: not per-piece, not shop paper, not an operation).
--   * Each evidence part line is a piece with its witness: fitted (installed = yes), not_fitted (no), cannot_tell, or
--     unwitnessed (open, cancelled or never asked). The segment returns witness_share: evidence_parts,
--     fitted_with_operation, fitted_without_operation, not_fitted, cannot_tell, unwitnessed, none_raised (no question row
--     at all), fitted_share, and the pieces
--     (item id, operation code, witness, hours: the operation's base_hours for a fitted piece, max_per_vehicle respected;
--     null with 'fitted, no book hours' for a fitted piece with no operation or no hours; never 0).
--   * Witnessed hours of the segment (stage_steps[0].witnessed_hours): every evidence part answered not fitted -> 0 (a
--     measured zero); nothing fitted otherwise -> min and typical null, max = the stage max, witnessed_reason 'not
--     witnessed'; fitted pieces but none with book hours -> the same with 'fitted, no book hours'; otherwise min =
--     typical = the fitted pieces' book hours, max = the larger of that and the stage max. The stage range stays in
--     with_unwitnessed_purchases. Every segment priced from bought-but-unanswered evidence (parts_bought: body metal
--     per piece, gearbox, electrical) follows the same rule: unknown, never a zero standing for unasked parts.
--   * totals.witnessed adds the known witnessed hours and returns unknown_min_segments (segments whose witnessed min is
--     unknown), so the sum reads as a lower bound where it is one.
-- Grain: per call, segment x evidence part. Keys: receipt_items.id in evidence_ids -> the judgment's item id (jsonb
-- params or subject_id; debt: evidence_judgment_requests has no FK to receipt_items) -> labor_operations.code.
-- Recompute: per read; a judgment or an operation row landing changes the next read.
-- Test: supabase/sql/test_vehicle_labor_appraisal_share.sql (PG17).
--
-- REVERT. Redefine the function without labor_fitted_share_v1 (restore the anchors below).
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $patch$
DECLARE
  d text;
  n integer;
  i integer;
  a_ver text := $a$  version text := 'vehicle_labor_appraisal/20261124213000.1';
$a$;
  r_ver text := $r$  version text := 'vehicle_labor_appraisal/20261124214500.1';
$r$;
  a_decl text := $a$  tr_id uuid; /* labor_edges_v1 */
$a$;
  r_decl text := $r$  tr_id uuid; /* labor_edges_v1 */
  share_j jsonb; /* labor_fitted_share_v1 */
  wit_h numeric;
$r$;
  a_grade text := $a$      IF evid_grade IS NULL THEN
        evid_grade := CASE WHEN paper_h IS NOT NULL THEN 'shop_paper'
                           WHEN fitted_n > 0 THEN 'fitted_in_photos'
                           ELSE 'parts_bought' END;
      END IF;
$a$;
  r_grade text := $r$      IF evid_grade IS NULL THEN
        evid_grade := CASE WHEN paper_h IS NOT NULL THEN 'shop_paper'
                           WHEN fitted_n > 0 THEN 'fitted_in_photos'
                           ELSE 'parts_bought' END;
      END IF;
      -- labor_fitted_share_v1: a stage-priced segment is witnessed piece by piece.
      share_j := NULL;
      IF paper_h IS NULL AND rule.hours_operation_code IS NULL AND NOT (rule.evidence_requirements ? 'per_piece')
         AND hours_min IS NOT NULL THEN
        WITH ep AS (
          SELECT l->>'item_id' AS item_id, max(l->>'op') AS op
            FROM jsonb_array_elements(lines) l
           WHERE l->>'line_kind' = 'part'
             AND l->>'item_id' = ANY (SELECT x::text FROM unnest(evid_ids) x)
           GROUP BY 1),
        q AS (
          SELECT ep.item_id, ep.op,
                 coalesce(bool_or(e.status = 'answered' AND e.answer->>'installed' = 'yes'), false) AS yes,
                 coalesce(bool_or(e.status = 'answered' AND e.answer->>'installed' = 'no'), false) AS no,
                 coalesce(bool_or(e.status = 'answered' AND e.answer->>'installed' = 'cannot_tell'), false) AS ct,
                 count(e.id) AS n_req
            FROM ep
            LEFT JOIN evidence_judgment_requests e
              ON e.vehicle_id = p_vehicle_id AND e.question_kind = 'receipt_part_visible' AND e.superseded_by IS NULL
             AND nullif(coalesce(e.params->>'item_id', e.params#>>'{question_context,item_id}', e.subject_id::text), '') = ep.item_id
           GROUP BY ep.item_id, ep.op),
        pc AS (
          SELECT q.item_id, q.op, q.n_req,
                 CASE WHEN q.yes THEN 'fitted' WHEN q.no THEN 'not_fitted' WHEN q.ct THEN 'cannot_tell' ELSE 'unwitnessed' END AS w,
                 o.base_hours, o.max_per_vehicle,
                 row_number() OVER (PARTITION BY q.op, q.yes ORDER BY q.item_id) AS rn
            FROM q
            LEFT JOIN LATERAL (
              SELECT lo.base_hours, lo.max_per_vehicle FROM labor_operations lo
               WHERE lo.code = q.op
                 AND (lo.model_year_min IS NULL OR v.year IS NULL OR v.year >= lo.model_year_min)
                 AND (lo.model_year_max IS NULL OR v.year IS NULL OR v.year <= lo.model_year_max)
               LIMIT 1) o ON true),
        pv AS (
          SELECT pc.*, CASE WHEN pc.w = 'fitted' AND pc.base_hours IS NOT NULL
                             THEN CASE WHEN pc.max_per_vehicle IS NOT NULL AND pc.rn > pc.max_per_vehicle THEN 0
                                       ELSE pc.base_hours END END AS h
            FROM pc)
        SELECT jsonb_build_object(
                 'evidence_parts', count(*),
                 'fitted_with_operation', count(*) FILTER (WHERE w = 'fitted' AND base_hours IS NOT NULL),
                 'fitted_without_operation', count(*) FILTER (WHERE w = 'fitted' AND base_hours IS NULL),
                 'not_fitted', count(*) FILTER (WHERE w = 'not_fitted'),
                 'cannot_tell', count(*) FILTER (WHERE w = 'cannot_tell'),
                 'unwitnessed', count(*) FILTER (WHERE w = 'unwitnessed'),
                 -- of the unwitnessed: parts no witness question was ever raised for (no evidence_judgment_requests row)
                 'none_raised', count(*) FILTER (WHERE n_req = 0),
                 'fitted_share', CASE WHEN count(*) > 0 THEN round(count(*) FILTER (WHERE w = 'fitted')::numeric / count(*), 3) END,
                 'pieces', coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                     'item_id', pv.item_id, 'operation_code', pv.op, 'witness', pv.w, 'hours', pv.h,
                     'reason', CASE WHEN pv.w = 'fitted' AND pv.base_hours IS NULL THEN 'fitted, no book hours' END))
                   ORDER BY pv.item_id), '[]'::jsonb)),
               sum(h)
          INTO share_j, wit_h
          FROM pv;
        IF (share_j->>'evidence_parts')::int > 0 THEN
          steps_j := jsonb_set(steps_j, '{0,witnessed_hours}', CASE
            -- a measured zero only when every evidence part was answered not fitted
            WHEN (share_j->>'not_fitted')::int = (share_j->>'evidence_parts')::int
              THEN jsonb_build_object('hours_min', 0, 'hours_typical', 0, 'hours_max', 0)
            WHEN (share_j->>'fitted_with_operation')::int + (share_j->>'fitted_without_operation')::int = 0
              THEN jsonb_build_object('hours_min', NULL, 'hours_typical', NULL, 'hours_max', hours_max, 'reason', 'not witnessed')
            WHEN (share_j->>'fitted_with_operation')::int = 0
              THEN jsonb_build_object('hours_min', NULL, 'hours_typical', NULL, 'hours_max', hours_max, 'reason', 'fitted, no book hours')
            ELSE jsonb_build_object('hours_min', wit_h, 'hours_typical', wit_h, 'hours_max', greatest(hours_max, wit_h)) END);
        ELSE
          share_j := NULL;
        END IF;
      END IF;
      -- A per-piece segment with nothing fitted but pieces unanswered is unknown, not zero.
      IF rule.evidence_requirements ? 'per_piece' AND hours_min IS NOT NULL
         AND coalesce((steps_j->0->>'fitted_count')::int, 0) = 0
         AND coalesce((steps_j->0->>'unwitnessed_count')::int, 0) > 0 THEN
        steps_j := jsonb_set(steps_j, '{0,witnessed_hours}',
          jsonb_build_object('hours_min', NULL, 'hours_typical', NULL, 'hours_max', hours_max, 'reason', 'not witnessed'));
      END IF;
$r$;
  a_out text := $a$      'fitted_parts', fitted_n,
$a$;
  r_out text := $r$      'fitted_parts', fitted_n,
      'witness_share', share_j, /* labor_fitted_share_v1 */
$r$;
  a_tot text := $a$            'hours_min', coalesce(sum((s ->> 'witnessed_hours_min')::numeric), 0),
            'hours_typical', coalesce(sum((s ->> 'witnessed_hours_typical')::numeric), 0),
            'hours_max', coalesce(sum((s ->> 'witnessed_hours_max')::numeric), 0)) END,
$a$;
  r_tot text := $r$            -- the known witnessed hours (null when no priced segment's witnessed hours are known)
            'hours_min', sum((s ->> 'witnessed_hours_min')::numeric),
            'hours_typical', sum((s ->> 'witnessed_hours_typical')::numeric),
            'hours_max', coalesce(sum((s ->> 'witnessed_hours_max')::numeric), 0),
            -- labor_fitted_share_v1: segments whose witnessed min is unknown add nothing to min/typical (a lower bound)
            'unknown_min_segments', count(*) FILTER (WHERE c IN ('witnessed', 'unwitnessed_purchase')
                                                       AND s ? 'witnessed_hours_min' AND s -> 'witnessed_hours_min' = 'null'::jsonb)) END,
$r$;
  a_map text := $a$             'witnessed_hours_min', CASE WHEN t.s #> '{stage_steps,0,witnessed_hours}' IS NOT NULL
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
$a$;
  r_map text := $r$             -- labor_fitted_share_v1: bought and unanswered is unknown (null min/typical, the stage max), not zero
             'witnessed_hours_min', CASE WHEN t.s #> '{stage_steps,0,witnessed_hours}' IS NOT NULL
                                         THEN (t.s #>> '{stage_steps,0,witnessed_hours,hours_min}')::numeric
                                         WHEN coalesce(gp.counts_in, 'witnessed') = 'witnessed' THEN (t.s ->> 'hours_min')::numeric
                                         END,
             'witnessed_hours_typical', CASE WHEN t.s #> '{stage_steps,0,witnessed_hours}' IS NOT NULL
                                             THEN (t.s #>> '{stage_steps,0,witnessed_hours,hours_typical}')::numeric
                                             WHEN coalesce(gp.counts_in, 'witnessed') = 'witnessed' THEN (t.s ->> 'hours_typical')::numeric
                                             END,
             'witnessed_hours_max', CASE WHEN t.s #> '{stage_steps,0,witnessed_hours}' IS NOT NULL
                                         THEN (t.s #>> '{stage_steps,0,witnessed_hours,hours_max}')::numeric
                                         ELSE (t.s ->> 'hours_max')::numeric END)
           || CASE WHEN coalesce(t.s #>> '{stage_steps,0,witnessed_hours,reason}',
                                 CASE WHEN gp.counts_in = 'unwitnessed_purchase' THEN 'not witnessed' END) IS NOT NULL
                   THEN jsonb_build_object('witnessed_reason', coalesce(t.s #>> '{stage_steps,0,witnessed_hours,reason}', 'not witnessed'))
                   ELSE '{}'::jsonb END
$r$;
  anchors text[];
  repls text[];
BEGIN
  d := pg_get_functiondef('public.vehicle_labor_appraisal(uuid)'::regprocedure);
  IF position('labor_fitted_share_v1' IN d) > 0 THEN RETURN; END IF;
  IF position('labor_edges_v1' IN d) = 0 THEN
    RAISE EXCEPTION 'vehicle_labor_appraisal is not at 20261124213000; rebase this migration';
  END IF;
  anchors := ARRAY[a_ver, a_decl, a_grade, a_out, a_tot, a_map];
  repls := ARRAY[r_ver, r_decl, r_grade, r_out, r_tot, r_map];
  FOR i IN 1 .. array_length(anchors, 1) LOOP
    n := (length(d) - length(replace(d, anchors[i], ''))) / length(anchors[i]);
    IF n <> 1 THEN RAISE EXCEPTION 'labor fitted share anchor % drifted: % matches', i, n; END IF;
    d := replace(d, anchors[i], repls[i]);
  END LOOP;
  EXECUTE d;
END $patch$;

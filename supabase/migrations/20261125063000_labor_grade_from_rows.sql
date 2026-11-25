-- labor_grade_rows_v1: a segment's piece grade is read from labor_evidence_grade_policy rows over its pieces' witness
-- counts, not from a CASE in the reader; a segment with some pieces fitted and some not splits across by_grade.
--
-- WHY. Review criterion C6 (2026-11-24): the reader graded a segment fitted_in_photos when any one of its parts was
-- answered fitted (CASE WHEN fitted_n > 0), so live 20d21fb0 chassis (1 fitted of 17, 16 cannot_tell or unanswered)
-- and e08bf694 chassis (1 of 22) read fitted_in_photos / counts_in witnessed, and no policy column said why.
--
-- WHAT CHANGES.
--   labor_evidence_grade_policy  + piece_quantifier text (all | any | none): which of a set of pieces must be answered
--                                  fitted for the row to admit the set: every one, at least one, or none.
--                                + unwitnessed_allowed boolean: whether the set may hold pieces with no fitted / not
--                                  fitted answer (unanswered or cannot_tell). Both null = the row does not grade pieces.
--                                Seeds: fitted_in_photos (all, false); parts_bought (none, true). No count threshold.
--   vehicle_labor_appraisal      for a segment with no paper and no rule-set grade, its part lines in evidence (per-piece
--                                rules: its pieces) are counted fitted / unwitnessed (not fitted pieces are left out).
--                                The fitted subset and the unwitnessed subset are each graded by the strongest row
--                                (lowest rank) whose columns admit it; the segment takes the weaker of the two (a mixed
--                                segment is not witnessed as a whole). graded_pieces = {fitted, unwitnessed,
--                                witnessed_grade (mixed only)} on the segment.
--                                by_grade: a mixed segment with witnessed hours enters witnessed_grade with its witnessed
--                                hours and its own grade with the rest (max: hours_max less the witnessed max, else
--                                less the witnessed min); it is counted in both entries' segments.
--   Witnessed hours, with_unwitnessed_purchases and hours are unchanged; counts_in follows the grade row.
-- Dry run against live 2026-11-24 (pg_temp copy): see the PR.
-- Test: supabase/sql/test_vehicle_labor_appraisal_grade_rows.sql (PG17).
--
-- REVERT. Swap each anchor and replacement below and EXECUTE the body; drop the two columns and their CHECK.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE public.labor_evidence_grade_policy
  ADD COLUMN IF NOT EXISTS piece_quantifier text,
  ADD COLUMN IF NOT EXISTS unwitnessed_allowed boolean;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'labor_evidence_grade_policy_piece_rule') THEN
    ALTER TABLE public.labor_evidence_grade_policy ADD CONSTRAINT labor_evidence_grade_policy_piece_rule
      CHECK (piece_quantifier IN ('all', 'any', 'none') AND unwitnessed_allowed IS NOT NULL
             OR piece_quantifier IS NULL AND unwitnessed_allowed IS NULL);
  END IF;
END $$;
COMMENT ON COLUMN public.labor_evidence_grade_policy.piece_quantifier IS
  'Which pieces of a set must be answered fitted (receipt_part_visible installed = yes) for this grade to admit the set: all, any (at least one) or none. NULL: the grade is not read from pieces.';
COMMENT ON COLUMN public.labor_evidence_grade_policy.unwitnessed_allowed IS
  'Whether the set may hold pieces with no fitted or not-fitted answer (unanswered or cannot_tell). NULL with piece_quantifier NULL.';
UPDATE public.labor_evidence_grade_policy SET piece_quantifier = 'all', unwitnessed_allowed = false
 WHERE grade = 'fitted_in_photos' AND piece_quantifier IS NULL;
UPDATE public.labor_evidence_grade_policy SET piece_quantifier = 'none', unwitnessed_allowed = true
 WHERE grade = 'parts_bought' AND piece_quantifier IS NULL;

DO $patch$
DECLARE
  d text;
  n integer;
  i integer;
  a_ver text := $a$  version text := 'vehicle_labor_appraisal/20261125033000.1';$a$;
  r_ver text := $r$  version text := 'vehicle_labor_appraisal/20261125063000.1';$r$;
  a_decl text := $a$  fitted_n int; /* labor_evidence_grade_v1 */$a$;
  r_decl text := $r$  fitted_n int; /* labor_evidence_grade_v1 */
  pf_n int; pu_n int; grade_fit text; grade_unw text; graded_j jsonb; /* labor_grade_rows_v1 */$r$;
  a_reset text := $a$    fitted_n := NULL;
$a$;
  r_reset text := $r$    fitted_n := NULL;
    graded_j := NULL;
$r$;
  a_case text := $a$      IF evid_grade IS NULL THEN
        evid_grade := CASE WHEN paper_h IS NOT NULL THEN 'shop_paper'
                           WHEN fitted_n > 0 THEN 'fitted_in_photos'
                           ELSE 'parts_bought' END;
      END IF;$a$;
  r_case text := $r$      IF evid_grade IS NULL AND paper_h IS NOT NULL THEN
        evid_grade := 'shop_paper';
      ELSIF evid_grade IS NULL THEN
        -- labor_grade_rows_v1: count the pieces, then let the policy rows grade each subset.
        IF rule.evidence_requirements ? 'per_piece' THEN
          pf_n := coalesce(fit_n, 0);
          pu_n := coalesce(unw_n, 0);
        ELSE
          SELECT count(*) FILTER (WHERE q.yes), count(*) FILTER (WHERE NOT q.yes AND NOT q.no)
            INTO pf_n, pu_n
            FROM (SELECT l->>'item_id' AS item_id,
                         coalesce(bool_or(e.status = 'answered' AND e.answer->>'installed' = 'yes'), false) AS yes,
                         coalesce(bool_or(e.status = 'answered' AND e.answer->>'installed' = 'no'), false) AS no
                    FROM jsonb_array_elements(lines) l
                    LEFT JOIN evidence_judgment_requests e
                      ON e.vehicle_id = p_vehicle_id AND e.question_kind = 'receipt_part_visible' AND e.superseded_by IS NULL
                     AND nullif(coalesce(e.params->>'item_id', e.params#>>'{question_context,item_id}', e.subject_id::text), '') = l->>'item_id'
                   WHERE l->>'line_kind' = 'part'
                     AND l->>'item_id' = ANY (SELECT x::text FROM unnest(evid_ids) x)
                   GROUP BY 1) q;
        END IF;
        grade_fit := NULL;
        grade_unw := NULL;
        IF pf_n > 0 THEN
          SELECT gp.grade INTO grade_fit FROM labor_evidence_grade_policy gp
           WHERE gp.piece_quantifier IN ('all', 'any')
           ORDER BY gp.rank, gp.grade LIMIT 1;
        END IF;
        IF pu_n > 0 OR pf_n = 0 THEN
          SELECT gp.grade INTO grade_unw FROM labor_evidence_grade_policy gp
           WHERE gp.piece_quantifier = 'none' AND (gp.unwitnessed_allowed OR pu_n = 0)
           ORDER BY gp.rank, gp.grade LIMIT 1;
        END IF;
        SELECT gp.grade INTO evid_grade FROM labor_evidence_grade_policy gp
         WHERE gp.grade IN (grade_fit, grade_unw)
         ORDER BY gp.rank DESC, gp.grade LIMIT 1;
        graded_j := jsonb_build_object('fitted', pf_n, 'unwitnessed', pu_n)
                    || CASE WHEN grade_fit IS NOT NULL AND grade_unw IS NOT NULL
                            THEN jsonb_build_object('witnessed_grade', grade_fit) ELSE '{}'::jsonb END;
      END IF;$r$;
  a_seg text := $a$      'fitted_parts', fitted_n,$a$;
  r_seg text := $r$      'fitted_parts', fitted_n,
      'graded_pieces', graded_j,$r$;
  a_by text := $a$                       FROM (SELECT coalesce(s2->>'evidence_grade', 'ungraded') AS grade,
                                    sum((s2->>'hours_min')::numeric) AS mn, sum((s2->>'hours_typical')::numeric) AS ty,
                                    sum((s2->>'hours_max')::numeric) AS mx, count(*) AS n
                               FROM jsonb_array_elements(segments) s2
                              WHERE s2->>'hours_min' IS NOT NULL
                              GROUP BY 1) g))$a$;
  r_by text := $r$                       FROM (SELECT p.grade, sum(p.mn) AS mn, sum(p.ty) AS ty, sum(p.mx) AS mx, count(*) AS n
                               FROM jsonb_array_elements(segments) s2
                               -- labor_grade_rows_v1: a mixed segment's witnessed hours enter its witnessed_grade
                               CROSS JOIN LATERAL (
                                 SELECT s2 #>> '{graded_pieces,witnessed_grade}' AS wg,
                                        (s2->>'witnessed_hours_min')::numeric AS wmn,
                                        (s2->>'witnessed_hours_typical')::numeric AS wty,
                                        (s2->>'witnessed_hours_max')::numeric AS wmx) w
                               CROSS JOIN LATERAL (
                                 SELECT coalesce(s2->>'evidence_grade', 'ungraded') AS grade,
                                        (s2->>'hours_min')::numeric - CASE WHEN w.wg IS NOT NULL THEN coalesce(w.wmn, 0) ELSE 0 END AS mn,
                                        (s2->>'hours_typical')::numeric - CASE WHEN w.wg IS NOT NULL THEN coalesce(w.wty, 0) ELSE 0 END AS ty,
                                        (s2->>'hours_max')::numeric - CASE WHEN w.wg IS NOT NULL THEN coalesce(w.wmx, w.wmn, 0) ELSE 0 END AS mx
                                 UNION ALL
                                 SELECT w.wg, w.wmn, w.wty, w.wmx
                                  WHERE w.wg IS NOT NULL AND w.wty IS NOT NULL) p
                              WHERE s2->>'hours_min' IS NOT NULL
                              GROUP BY 1) g))$r$;
  anchors text[];
  repls text[];
BEGIN
  d := pg_get_functiondef('public.vehicle_labor_appraisal(uuid)'::regprocedure);
  IF position('labor_grade_rows_v1' IN d) > 0 THEN RETURN; END IF;
  IF position('labor_witnessed_max_v1' IN d) = 0 THEN
    RAISE EXCEPTION 'vehicle_labor_appraisal is not at 20261125033000; rebase this migration';
  END IF;
  anchors := ARRAY[a_ver, a_decl, a_reset, a_case, a_seg, a_by];
  repls := ARRAY[r_ver, r_decl, r_reset, r_case, r_seg, r_by];
  FOR i IN 1 .. array_length(anchors, 1) LOOP
    n := (length(d) - length(replace(d, anchors[i], ''))) / length(anchors[i]);
    IF n <> 1 THEN RAISE EXCEPTION 'labor grade rows anchor % drifted: % matches', i, n; END IF;
    d := replace(d, anchors[i], repls[i]);
  END LOOP;
  EXECUTE d;
END $patch$;

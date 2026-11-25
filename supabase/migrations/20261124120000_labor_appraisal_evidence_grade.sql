-- labor_evidence_grade_v1: every priced segment of vehicle_labor_appraisal says how well its work is witnessed.
--
-- WHY. Measured live on the proof vehicle 2026-11-24: six of eight segments returned evidence_grade NULL, so 28-84 h
-- of body metal priced from seven purchased panels (no witness that any was fitted) read exactly like 50.75 h printed
-- on shop paper. Hours with different support were added into one total with nothing to tell them apart.
--
-- WHAT CHANGES (reader only; no table, no rule row, no hour changes).
--   * A segment that had no grade gets one, derived from its own evidence rows:
--       shop_paper        the segment's hours are printed on shop paper
--       fitted_in_photos  at least one of its receipt parts has an answered receipt_part_visible check, installed = yes
--       parts_bought      its parts are on receipts; nothing on file witnesses the fitting
--     Grades set by the reader before this patch (statement, photographed_stage, receipt_part_visible) are kept.
--   * Each such segment carries fitted_parts: how many of its evidence parts were found fitted in photos.
--   * totals.by_grade: hours_min / hours_typical / hours_max summed per grade. They add up to the totals.
-- A page can now print "N h on paper, N h witnessed in photos, N h priced from parts alone" from the reader.
--
-- REVERT. Redefine the function without the text between labor_evidence_grade_v1 and labor_evidence_grade_v1_end.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $patch$
DECLARE
  d text;
  a1 text := E'  matched_n int := 0;\n';
  r1 text := E'  matched_n int := 0;\n  fitted_n int; /* labor_evidence_grade_v1 */\n';
  a2 text := E'    IF evid_grade IS NULL AND rule.evidence_requirements ? ''evidence_grade'' THEN\n      evid_grade := rule.evidence_requirements->>''evidence_grade'';\n    END IF;\n';
  r2 text := $r2$
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
    -- labor_evidence_grade_v1_end
$r2$;
  a3 text := E'      ''evidence_grade'', evid_grade,\n      ''citation'', rule.citation\n';
  r3 text := E'      ''evidence_grade'', evid_grade,\n      ''fitted_parts'', fitted_n,\n      ''citation'', rule.citation\n';
  a4 text := E'      ''hours_max'', tot_max\n    ),\n';
  r4 text := $r4$      'hours_max', tot_max,
      'by_grade', (SELECT coalesce(jsonb_object_agg(g.grade, jsonb_build_object(
                            'hours_min', g.mn, 'hours_typical', g.ty, 'hours_max', g.mx, 'segments', g.n)), '{}'::jsonb)
                     FROM (SELECT coalesce(s->>'evidence_grade', 'ungraded') AS grade,
                                  sum((s->>'hours_min')::numeric) AS mn, sum((s->>'hours_typical')::numeric) AS ty,
                                  sum((s->>'hours_max')::numeric) AS mx, count(*) AS n
                             FROM jsonb_array_elements(segments) s
                            WHERE s->>'hours_min' IS NOT NULL
                            GROUP BY 1) g)
    ),
$r4$;
  n integer;
BEGIN
  d := pg_get_functiondef('public.vehicle_labor_appraisal(uuid)'::regprocedure);
  IF position('labor_evidence_grade_v1' IN d) > 0 THEN RETURN; END IF;
  FOR n IN SELECT (length(d) - length(replace(d, a, ''))) / length(a) FROM unnest(ARRAY[a1, a2, a3, a4]) a LOOP
    IF n <> 1 THEN RAISE EXCEPTION 'labor evidence grade anchor drifted: % matches', n; END IF;
  END LOOP;
  d := replace(replace(replace(replace(d, a1, r1), a2, a2 || r2), a3, r3), a4, r4);
  EXECUTE d;
END $patch$;

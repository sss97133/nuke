-- labor_grade_no_evidence_v1: a segment of vehicle_labor_appraisal with status 'no evidence' carries no evidence grade.
--
-- WHY. The rule row's default grade (photographed_stage, receipt_part_visible) was written onto the paint and
-- reassembly segments even when the vehicle had no evidence for them, so a car with nothing on file showed a graded
-- segment. Measured 2026-11-24 on 105 public vehicles with photos or receipt links: 103 returned graded segments
-- with zero evidence rows.
--
-- WHAT CHANGES. In the three places a segment is built (reassembly, paint, the general path), a segment whose
-- status is 'no evidence' gets evidence_grade NULL.
-- Priced segments are unchanged. No row is written.
--
-- REVERT. Redefine the function without the line carrying labor_grade_no_evidence_v1.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $patch$
DECLARE
  d text;
  a text := E'    -- labor_evidence_grade_v1_end\n';
  r text := E'    IF status = ''no evidence'' THEN evid_grade := NULL; END IF; /* labor_grade_no_evidence_v1 */\n    -- labor_evidence_grade_v1_end\n';
  a2 text := E'        ''evidence_grade'', ''receipt_part_visible'',\n';
  r2 text := E'        ''evidence_grade'', CASE WHEN status <> ''no evidence'' THEN ''receipt_part_visible'' END,\n';
  a3 text := E'        ''evidence_grade'', ''photographed_stage'',\n';
  r3 text := E'        ''evidence_grade'', CASE WHEN status <> ''no evidence'' THEN ''photographed_stage'' END,\n';
  n integer;
BEGIN
  d := pg_get_functiondef('public.vehicle_labor_appraisal(uuid)'::regprocedure);
  IF position('labor_grade_no_evidence_v1' IN d) > 0 THEN RETURN; END IF;
  FOR n IN SELECT (length(d) - length(replace(d, x, ''))) / length(x) FROM unnest(ARRAY[a, a2, a3]) x LOOP
    IF n <> 1 THEN RAISE EXCEPTION 'labor grade no-evidence anchor drifted: % matches', n; END IF;
  END LOOP;
  EXECUTE replace(replace(replace(d, a, r), a2, r2), a3, r3);
END $patch$;

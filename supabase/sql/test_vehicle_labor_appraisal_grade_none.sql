-- Disposable PG17: a 'no evidence' segment carries no grade; priced segments keep theirs (labor_grade_no_evidence_v1).
\set ON_ERROR_STOP on
\ir test_vehicle_labor_appraisal_grade.sql
RESET ROLE;
\ir ../migrations/20261124200000_labor_grade_none_without_evidence.sql
\ir ../migrations/20261124200000_labor_grade_none_without_evidence.sql
DO $$
DECLARE j jsonb; v uuid; bad int; seen int := 0; d text;
BEGIN
  d := pg_get_functiondef('public.vehicle_labor_appraisal(uuid)'::regprocedure);
  IF (length(d) - length(replace(d, 'labor_grade_no_evidence_v1', ''))) / length('labor_grade_no_evidence_v1') <> 1 THEN
    RAISE EXCEPTION 'not patched exactly once'; END IF;
  FOREACH v IN ARRAY ARRAY['10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000004']::uuid[] LOOP
    j := public.vehicle_labor_appraisal(v);
    CONTINUE WHEN j IS NULL OR jsonb_typeof(j->'segments') <> 'array';
    SELECT count(*) FILTER (WHERE s->>'status' = 'no evidence' AND s->>'evidence_grade' IS NOT NULL),
           count(*) FILTER (WHERE s->>'status' = 'no evidence')
      INTO bad, seen FROM jsonb_array_elements(j->'segments') s;
    IF bad > 0 THEN RAISE EXCEPTION 'vehicle %: % no-evidence segments still graded', v, bad; END IF;
    SELECT count(*) INTO bad FROM jsonb_array_elements(j->'segments') s
     WHERE s->>'hours_min' IS NOT NULL AND s->>'evidence_grade' IS NULL;
    IF bad > 0 THEN RAISE EXCEPTION 'vehicle %: % priced segments lost their grade', v, bad; END IF;
    RAISE NOTICE 'vehicle %: % no-evidence segments, none graded', v, seen;
  END LOOP;
END $$;
\echo labor_grade_no_evidence: ok

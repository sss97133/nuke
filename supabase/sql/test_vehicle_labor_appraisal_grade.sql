-- Disposable PG17: every priced segment of vehicle_labor_appraisal carries an evidence grade, and the per-grade
-- totals add up to the totals (labor_evidence_grade_v1). Reuses the labor appraisal fixture. Synthetic rows only.
\set ON_ERROR_STOP on
\ir test_vehicle_labor_appraisal.sql
RESET ROLE;
\ir ../migrations/20261124120000_labor_appraisal_evidence_grade.sql
\ir ../migrations/20261124120000_labor_appraisal_evidence_grade.sql
DO $$
DECLARE j jsonb; d text; v uuid; bad int; t jsonb;
BEGIN
  d := pg_get_functiondef('public.vehicle_labor_appraisal(uuid)'::regprocedure);
  IF (length(d) - length(replace(d, 'labor_evidence_grade_v1_end', ''))) / length('labor_evidence_grade_v1_end') <> 1 THEN
    RAISE EXCEPTION 'patched % times', (length(d) - length(replace(d, 'labor_evidence_grade_v1_end', ''))) / length('labor_evidence_grade_v1_end'); END IF;
  FOREACH v IN ARRAY ARRAY['10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000004']::uuid[] LOOP
    j := public.vehicle_labor_appraisal(v);
    CONTINUE WHEN j IS NULL OR jsonb_typeof(j->'segments') <> 'array';
    SELECT count(*) INTO bad FROM jsonb_array_elements(j->'segments') s
     WHERE s->>'hours_min' IS NOT NULL AND s->>'evidence_grade' IS NULL;
    IF bad > 0 THEN RAISE EXCEPTION 'vehicle %: % priced segments without a grade: %', v, bad, j->'segments'; END IF;
    SELECT count(*) INTO bad FROM jsonb_array_elements(j->'segments') s
     WHERE s->>'evidence_grade' NOT IN ('shop_paper', 'fitted_in_photos', 'parts_bought', 'statement', 'photographed_stage', 'receipt_part_visible');
    IF bad > 0 THEN RAISE EXCEPTION 'vehicle %: unknown grade in %', v, j->'segments'; END IF;
    t := j->'totals';
    IF (SELECT coalesce(sum((e.value->>'hours_typical')::numeric), 0) FROM jsonb_each(t->'by_grade') e)
       IS DISTINCT FROM (SELECT coalesce(sum((s->>'hours_typical')::numeric), 0) FROM jsonb_array_elements(j->'segments') s WHERE s->>'hours_min' IS NOT NULL)
    THEN RAISE EXCEPTION 'vehicle %: by_grade does not add up: %', v, t; END IF;
    RAISE NOTICE 'vehicle % grades %', v, (SELECT jsonb_object_agg(s->>'segment', s->>'evidence_grade') FROM jsonb_array_elements(j->'segments') s);
  END LOOP;
END $$;
\echo labor_evidence_grade: ok

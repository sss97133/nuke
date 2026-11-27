-- Preserve complete canonical results and malformed-source refusal semantics.
\set ON_ERROR_STOP on
\i supabase/sql/test_harness_recorded_plan_agreement.sql
CREATE FUNCTION pg_temp.lookup_outcome(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
 RETURN jsonb_build_object('result',public.harness_model_compute(p),'sqlstate',NULL);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('sqlstate',SQLSTATE);
END $$;
CREATE TEMP TABLE lookup_cases AS SELECT name,p,pg_temp.lookup_outcome(p) expected FROM(
 SELECT name,p FROM direct_check_cases
 UNION ALL SELECT 'source baseline',p FROM direct_check_baseline
 UNION ALL SELECT '500-piece source',p FROM direct_check_scale
 UNION ALL SELECT 'current rules',public.harness_model_inputs('e08bf694-970f-4cbe-8a74-8715158a0f2e')
) samples;
INSERT INTO lookup_cases
SELECT name,p,pg_temp.lookup_outcome(p) FROM(
 SELECT 'null segment identity' name,jsonb_set(p,'{model,segments,0,id}','null') p FROM direct_check_baseline
 UNION ALL SELECT 'absent segment identity',jsonb_set(p,'{model,segments,0}',(p#>'{model,segments,0}')-'id') FROM direct_check_baseline
 UNION ALL SELECT 'duplicate source identity',jsonb_set(p,'{model,segments}',(p#>'{model,segments}')||jsonb_build_array(p#>'{model,segments,0}')) FROM direct_check_baseline
 UNION ALL SELECT 'only nonsegment rules',jsonb_set(p,'{rules}',coalesce((SELECT jsonb_agg(r) FROM jsonb_array_elements(p->'rules') r
  WHERE r->>'subject_kind'<>'segment'),'[]'::jsonb)) FROM direct_check_baseline
 UNION ALL SELECT 'unsupported segment predicate',jsonb_set(p,'{rules}',(p->'rules')||
  '[{"rule_key":"unsupported_segment","version":"1","subject_kind":"segment"}]'::jsonb) FROM direct_check_baseline
) adversaries;
CREATE TEMP TABLE lookup_properties AS SELECT proacl,proconfig,prosecdef,provolatile,proparallel
 FROM pg_proc WHERE oid='public.harness_model_compute(jsonb)'::regprocedure;
\i supabase/migrations/20261127014400_harness_check_lookup_scope.sql
DO $$ DECLARE sample record; actual jsonb; BEGIN
 FOR sample IN SELECT * FROM lookup_cases ORDER BY name LOOP
  actual:=pg_temp.lookup_outcome(sample.p);
  IF actual IS DISTINCT FROM sample.expected THEN
   RAISE EXCEPTION 'Scoped check lookup changed canonical result or error class for %',sample.name; END IF;
 END LOOP;
 IF (SELECT expected->>'sqlstate' FROM lookup_cases WHERE name='duplicate source identity') IS DISTINCT FROM '21000'
 THEN RAISE EXCEPTION 'Duplicate-source regression did not exercise the actual scalar-subquery refusal'; END IF;
 IF NOT EXISTS(SELECT FROM lookup_cases c CROSS JOIN LATERAL jsonb_array_elements(c.expected#>'{result,checks}') k
  WHERE k->>'segment_id' IS NULL)
 THEN RAISE EXCEPTION 'Lookup regressions lack non-segment check subjects'; END IF;
 IF EXISTS(SELECT FROM pg_proc p CROSS JOIN lookup_properties b WHERE p.oid='public.harness_model_compute(jsonb)'::regprocedure
  AND (p.proacl,p.proconfig,p.prosecdef,p.provolatile,p.proparallel) IS DISTINCT FROM
      (b.proacl,b.proconfig,b.prosecdef,b.provolatile,b.proparallel))
 THEN RAISE EXCEPTION 'Scoped check lookup changed function permission or execution properties'; END IF;
END $$;

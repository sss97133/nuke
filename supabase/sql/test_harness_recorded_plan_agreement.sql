-- Disposable native PostgreSQL17; parent contract owns source fixtures/RLS.
\set ON_ERROR_STOP on
\i supabase/sql/test_harness_check_field_bindings.sql
CREATE TEMP TABLE recorded_plan_baseline AS
 SELECT p,public.harness_model_compute(p) computed FROM direct_check_baseline;
CREATE TEMP TABLE recorded_plan_old_predicates AS
 SELECT r,s,public.harness_model_segment_check(r,s) result
 FROM(VALUES('segment_specification'),('wire_stock_key'),('material_source_status'),
  ('new_wire_demand'),('planned_wire_amount')) rules(r)
 CROSS JOIN LATERAL(SELECT piece s FROM direct_check_cases c
  CROSS JOIN LATERAL jsonb_array_elements(c.p#>'{model,segments}') piece) segments;
CREATE TEMP TABLE recorded_plan_old_receipt AS SELECT id,input_hash,logic_key FROM public.harness_model_evaluations
 WHERE id=(SELECT latest_evaluation_id FROM public.harness_model_state
  WHERE vehicle_id='e08bf694-970f-4cbe-8a74-8715158a0f2e');
\i supabase/migrations/20261126231500_harness_recorded_plan_agreement.sql

DO $$ DECLARE baseline record; BEGIN
 SELECT * INTO baseline FROM recorded_plan_baseline;
 IF public.harness_model_compute(baseline.p) IS DISTINCT FROM baseline.computed
 THEN RAISE EXCEPTION 'Adding recorded plan rule changed pre-existing rule/requirement output'; END IF;
 IF EXISTS(SELECT FROM recorded_plan_old_predicates b
  WHERE public.harness_model_segment_check(b.r,b.s) IS DISTINCT FROM b.result)
 THEN RAISE EXCEPTION 'Old segment predicate changed'; END IF;
 IF public.harness_model_segment_check('unregistered_predicate','{}') IS NOT NULL
 THEN RAISE EXCEPTION 'Unknown predicate acquired invented coverage'; END IF;
 IF public.harness_model_receipt_for_hash('e08bf694-970f-4cbe-8a74-8715158a0f2e',
  (SELECT input_hash FROM recorded_plan_old_receipt)) IS NOT NULL
 THEN RAISE EXCEPTION 'Old evaluation remained qualified after rule/logic change'; END IF;
END $$;

CREATE TEMP TABLE recorded_plan_cases(name text,patch jsonb,expected text);
INSERT INTO recorded_plan_cases VALUES
 ('unkeyed plan','{"wire_part_id":null,"specification_state":"incomplete"}','pass'),
 ('wrong gauge','{"gauge_awg":20}','fail'),
 ('wrong circuit gauge','{"circuit_gauge_awg":20}','fail'),
 ('reversed stripe','{"colour":"black/brown"}','fail'),
 ('omitted stripe','{"colour":"brown"}','fail'),
 ('extra stripe','{"colour":"brown/black/red"}','fail'),
 ('circuit stripe changed','{"circuit_colour":"brown/red"}','fail'),
 ('case and surrounding space','{"colour":"  BROWN/BLACK  "}','pass'),
 ('absent gauge','{}','hold'),
 ('null gauge','{"gauge_awg":null}','hold'),
 ('text gauge','{"gauge_awg":"22"}','hold'),
 ('fractional gauge','{"gauge_awg":22.5}','hold'),
 ('object gauge','{"gauge_awg":{}}','hold'),
 ('null circuit gauge','{"circuit_gauge_awg":null}','hold'),
 ('fractional circuit gauge','{"circuit_gauge_awg":22.5}','hold'),
 ('empty colour','{"colour":"  "}','hold'),
 ('tab-only colour','{"colour":"\t","circuit_colour":"\t"}','hold'),
 ('linebreak-only colour','{"colour":"\r\n","circuit_colour":"\r\n"}','hold'),
 ('mixed whitespace colour','{"colour":" \t\n ","circuit_colour":" \t\n "}','hold'),
 ('nonstring colour','{"colour":22}','hold'),
 ('null colour','{"colour":null}','hold'),
 ('null circuit colour','{"circuit_colour":null}','hold'),
 ('nonnumeric circuit gauge','{"circuit_gauge_awg":"unknown"}','hold'),
 ('known gauge conflict despite missing colour','{"gauge_awg":20,"colour":null}','fail'),
 ('known colour conflict despite missing gauge','{"gauge_awg":null,"colour":"red/black"}','fail'),
 ('zero gauge label agreement','{"gauge_awg":0,"circuit_gauge_awg":0}','pass'),
 ('negative gauge label agreement','{"gauge_awg":-1,"circuit_gauge_awg":-1}','pass'),
 ('numeric scale agreement','{"gauge_awg":22.0}','pass');
DO $$ DECLARE c record; s jsonb; r jsonb; a jsonb; b jsonb; f text; BEGIN
 s:='{"id":"00000000-0000-0000-0000-000000000001","gauge_awg":22,"circuit_gauge_awg":22,"colour":"brown/black","circuit_colour":"brown/black"}';
 FOR c IN SELECT * FROM recorded_plan_cases LOOP
  r:=public.harness_model_segment_check('segment_plan_agreement',
   CASE WHEN c.name='absent gauge' THEN s-'gauge_awg' ELSE s||c.patch END);
  IF r->>'result' IS DISTINCT FROM c.expected OR jsonb_array_length(r->'input_bindings')<>4
  THEN RAISE EXCEPTION 'Recorded plan case %: %',c.name,r; END IF;
  IF (SELECT array_agg(x->>'input_field' ORDER BY x->>'input_field') FROM jsonb_array_elements(r->'input_bindings') x)
   IS DISTINCT FROM ARRAY['circuit_colour','circuit_gauge_awg','colour','gauge_awg']
  THEN RAISE EXCEPTION 'Plan direct field coverage differs from its predicate'; END IF;
 END LOOP;
 a:=public.harness_model_segment_check('segment_plan_agreement',s-'gauge_awg');
 b:=public.harness_model_segment_check('segment_plan_agreement',s||'{"gauge_awg":null}');
 IF a=b OR a->>'result'<>'hold' OR b->>'result'<>'hold'
 THEN RAISE EXCEPTION 'Absent/null plan input lost its presence fingerprint'; END IF;
 a:=public.harness_model_segment_check('segment_plan_agreement',s);
 b:=public.harness_model_segment_check('segment_plan_agreement',s||'{"wire_part_id":null,"specification_state":"conflict","wire_type":"unassessed","planned_length_ft":null}');
 IF a IS DISTINCT FROM b THEN RAISE EXCEPTION 'Narrow plan predicate consumed undeclared stock/family/length fields'; END IF;
 FOREACH f IN ARRAY ARRAY['gauge_awg','circuit_gauge_awg','colour','circuit_colour'] LOOP
  b:=public.harness_model_segment_check('segment_plan_agreement',s-f);
  IF EXISTS(SELECT FROM jsonb_array_elements(a->'input_bindings') old
   JOIN jsonb_array_elements(b->'input_bindings') new ON old->>'input_field'=new->>'input_field'
   WHERE (old->>'input_field'=f)=(old=new))
  THEN RAISE EXCEPTION 'Direct edge fingerprint did not isolate changed field %',f; END IF;
 END LOOP;
END $$;

DO $$ DECLARE r jsonb; e uuid; n integer; c public.harness_model_checks; ctx jsonb; BEGIN
 r:=public.harness_model_fold('e08bf694-970f-4cbe-8a74-8715158a0f2e');
 IF r->>'status'<>'current' THEN RAISE EXCEPTION 'Plan-aware fold failed: %',r; END IF;
 e:=(r->>'evaluation_id')::uuid;
 IF e IS NULL THEN SELECT latest_evaluation_id INTO e FROM public.harness_model_state
  WHERE vehicle_id='e08bf694-970f-4cbe-8a74-8715158a0f2e'; END IF;
 SELECT count(*) INTO n FROM public.harness_segments WHERE vehicle_id='e08bf694-970f-4cbe-8a74-8715158a0f2e' AND NOT is_superseded;
 IF (SELECT count(*) FROM public.harness_model_checks WHERE evaluation_id=e AND rule_key='segment_plan_agreement')<>n
  OR EXISTS(SELECT FROM public.harness_model_checks WHERE evaluation_id=e AND rule_key='segment_plan_agreement'
   AND (rule_version<>'1' OR input_binding_count<>4))
  OR (SELECT count(*) FROM public.harness_model_check_inputs WHERE evaluation_id=e) < n*4
 THEN RAISE EXCEPTION 'Fold omitted typed plan checks/direct inputs'; END IF;
 FOR c IN SELECT * FROM public.harness_model_checks WHERE evaluation_id=e AND rule_key='segment_plan_agreement' LOOP
  ctx:=public.harness_model_check_context('e08bf694-970f-4cbe-8a74-8715158a0f2e',e,c.id);
  IF ctx->>'status'<>'current' OR jsonb_array_length(ctx->'inputs')<>4
   OR ctx#>>'{rule,rule_key}'<>'segment_plan_agreement' OR ctx#>>'{rule,version}'<>'1'
   OR ctx->>'source_lineage'<>'not_assessed'
  THEN RAISE EXCEPTION 'Current canonical plan check cannot be inspected: %',ctx; END IF;
 END LOOP;
END $$;
SET ROLE anon;
DO $$ DECLARE e uuid; c uuid; r jsonb; BEGIN
 SELECT latest_evaluation_id INTO e FROM public.harness_model_state WHERE vehicle_id='e08bf694-970f-4cbe-8a74-8715158a0f2e';
 SELECT id INTO c FROM public.harness_model_checks WHERE evaluation_id=e AND rule_key='segment_plan_agreement' LIMIT 1;
 r:=public.harness_model_check_context('e08bf694-970f-4cbe-8a74-8715158a0f2e',e,c);
 IF r->>'status'<>'current' OR jsonb_array_length(r->'inputs')<>4
 THEN RAISE EXCEPTION 'Public scoped plan check reader failed: %',r; END IF;
END $$;
RESET ROLE;
-- Existing invoker visibility remains consequential; no new definer reader.
BEGIN;
UPDATE public.vehicles SET is_public=false WHERE id='e08bf694-970f-4cbe-8a74-8715158a0f2e';
SET LOCAL ROLE anon;
DO $$ BEGIN
 IF EXISTS(SELECT FROM public.harness_model_checks c JOIN public.harness_model_evaluations e ON e.id=c.evaluation_id
  WHERE c.rule_key='segment_plan_agreement' AND e.vehicle_id='e08bf694-970f-4cbe-8a74-8715158a0f2e')
 THEN RAISE EXCEPTION 'Private plan checks remained public'; END IF;
END $$;
ROLLBACK;
SELECT 'test_harness_recorded_plan_agreement: PASS' AS result;

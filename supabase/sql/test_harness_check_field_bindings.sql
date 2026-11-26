-- Disposable PG17 contract. Reuse existing physical source fixtures unchanged.
\set ON_ERROR_STOP on
\i supabase/sql/test_harness_component_requirements.sql
CREATE TEMP TABLE direct_check_baseline AS
 SELECT p,public.harness_model_compute(p) computed FROM(
  SELECT public.harness_model_inputs('e08bf694-970f-4cbe-8a74-8715158a0f2e') p) source;
CREATE TEMP TABLE direct_check_cases AS
 SELECT name,p,public.harness_model_compute(p) computed FROM(
  SELECT v.name,jsonb_set(b.p,'{model,segments,0}',(b.p#>'{model,segments,0}')||v.patch) p
  FROM direct_check_baseline b CROSS JOIN(VALUES
   ('conflicting specification','{"specification_state":"conflict"}'::jsonb),
   ('unknown specification','{"specification_state":null}'::jsonb),
   ('missing expected stock','{"expected_part_number":null}'::jsonb),
   ('competing stock','{"wire_part_id":"00000000-0000-0000-0000-000000000001","expected_part_number":"A","keyed_part_number":"B"}'::jsonb),
   ('source hold','{"blockers":["unresolved_source"]}'::jsonb),
   ('physical progress','{"physical_progress":true}'::jsonb),
   ('reported measurement','{"measured_length_ft":1.25}'::jsonb),
   ('cut piece','{"build_state":"cut"}'::jsonb),
   ('zero length','{"planned_length_ft":0}'::jsonb),
   ('unknown length','{"planned_length_ft":null}'::jsonb),
   ('unknown route method','{"planned_length_ft":2,"planned_length_method":"unknown route"}'::jsonb),
   ('usable route plan','{"planned_length_ft":2,"planned_length_method":"route_plan"}'::jsonb)
  ) v(name,patch)
 ) cases;
CREATE TEMP TABLE direct_check_scale AS
 SELECT p,public.harness_model_compute(p) computed FROM(
  SELECT jsonb_set(b.p,'{model,segments}',(SELECT jsonb_agg(
   ((b.p#>'{model,segments}')->((n-1)%jsonb_array_length(b.p#>'{model,segments}')))||jsonb_build_object('id',md5('scale:'||n)::uuid))
   FROM generate_series(1,500) n)) p FROM direct_check_baseline b
 ) scaled;
\i supabase/migrations/20261126182000_harness_check_field_bindings.sql
DO $$ DECLARE before jsonb; after jsonb; old_checks jsonb; new_checks jsonb; BEGIN
 SELECT computed,public.harness_model_compute(p) INTO before,after FROM direct_check_baseline;
 SELECT jsonb_agg(c ORDER BY c->>'rule_key',c->>'segment_id',c->>'termination_id',c->>'circuit_id',c->>'component_requirement_id') INTO old_checks
 FROM jsonb_array_elements(before->'checks') c;
 SELECT jsonb_agg(c-'input_bindings' ORDER BY c->>'rule_key',c->>'segment_id',c->>'termination_id',c->>'circuit_id',c->>'component_requirement_id') INTO new_checks
 FROM jsonb_array_elements(after->'checks') c;
 IF old_checks IS DISTINCT FROM new_checks OR before-'checks' IS DISTINCT FROM after-'checks'
 THEN RAISE EXCEPTION 'Direct predicate extraction changed canonical verdicts, physical graph or material quantities'; END IF;
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(after->'checks') c WHERE jsonb_array_length(c->'input_bindings')>0)
 THEN RAISE EXCEPTION 'Canonical compute omitted declared direct predicate inputs'; END IF;
END $$;
DO $$ DECLARE sample record; old_checks jsonb; new_checks jsonb; computed jsonb; BEGIN
 FOR sample IN SELECT t.name,t.p,t.computed FROM direct_check_cases t UNION ALL SELECT '500-piece scale',t.p,t.computed FROM direct_check_scale t LOOP
  computed:=public.harness_model_compute(sample.p);
  SELECT jsonb_agg(c ORDER BY c->>'rule_key',c->>'segment_id',c->>'termination_id',c->>'circuit_id',c->>'component_requirement_id') INTO old_checks
   FROM jsonb_array_elements(sample.computed->'checks') c;
  SELECT jsonb_agg(c-'input_bindings' ORDER BY c->>'rule_key',c->>'segment_id',c->>'termination_id',c->>'circuit_id',c->>'component_requirement_id') INTO new_checks
   FROM jsonb_array_elements(computed->'checks') c;
  IF old_checks IS DISTINCT FROM new_checks OR sample.computed-'checks' IS DISTINCT FROM computed-'checks'
   THEN RAISE EXCEPTION 'Canonical regression for %',sample.name; END IF;
 END LOOP;
END $$;
DO $$ DECLARE a jsonb; b jsonb; r jsonb; BEGIN
 a:=public.harness_model_segment_check('planned_wire_amount','{"id":"00000000-0000-0000-0000-000000000001","planned_length_ft":1,"planned_length_method":"route_plan"}');
 b:=public.harness_model_segment_check('planned_wire_amount','{"id":"00000000-0000-0000-0000-000000000001","planned_length_ft":1,"planned_length_method":null}');
 IF a->>'result'<>'pass' OR b->>'result'<>'hold' THEN RAISE EXCEPTION 'Known plan / explicit unknown method mismatch'; END IF;
 a:=public.harness_model_segment_check('planned_wire_amount','{}');
 b:=public.harness_model_segment_check('planned_wire_amount','{"planned_length_ft":null}');
 IF a->>'result'<>'hold' OR b->>'result'<>'hold'
 OR a#>>'{input_bindings,0,value_md5}'=b#>>'{input_bindings,0,value_md5}'
 THEN RAISE EXCEPTION 'Absent and explicit-null length conflated'; END IF;
 IF public.harness_model_segment_check('engineering_coverage','{}') IS NOT NULL
 THEN RAISE EXCEPTION 'Unknown predicate acquired invented direct-input coverage'; END IF;
 r:=public.harness_model_fold('e08bf694-970f-4cbe-8a74-8715158a0f2e');
 IF r->>'status'<>'current' THEN RAISE EXCEPTION 'Instrumented canonical fold failed: %',r; END IF;
END $$;
DO $$ DECLARE e uuid; n integer; r jsonb; c public.harness_model_checks; BEGIN
 SELECT latest_evaluation_id INTO e FROM public.harness_model_state WHERE vehicle_id='e08bf694-970f-4cbe-8a74-8715158a0f2e';
 SELECT count(*) INTO n FROM public.harness_model_check_inputs WHERE evaluation_id=e;
 IF n=0 OR n<>(SELECT check_input_count FROM public.harness_model_evaluations WHERE id=e)
  OR n<>(SELECT sum(input_binding_count) FROM public.harness_model_checks WHERE evaluation_id=e)
 THEN RAISE EXCEPTION 'Persisted direct input conservation failed'; END IF;
 FOR c IN SELECT * FROM public.harness_model_checks WHERE evaluation_id=e AND input_binding_count IS NOT NULL LOOP
  r:=public.harness_model_check_context('e08bf694-970f-4cbe-8a74-8715158a0f2e',e,c.id);
  IF r->>'status'<>'current' OR jsonb_array_length(r->'inputs')<>c.input_binding_count
   OR r->>'input_coverage'<>'direct_segment_predicate_v1' OR r->>'source_lineage'<>'not_assessed'
   OR r#>>'{subject,id}'<>c.segment_id::text
  THEN RAISE EXCEPTION 'Bounded current direct-input reader failed: %',r; END IF;
 END LOOP;
 SELECT * INTO c FROM public.harness_model_checks WHERE evaluation_id=e AND rule_key='engineering_coverage';
 r:=public.harness_model_check_context('e08bf694-970f-4cbe-8a74-8715158a0f2e',e,c.id);
 IF r->>'input_coverage'<>'not_recorded' OR jsonb_array_length(r->'inputs')<>0 OR r#>>'{check,result}'<>'hold'
 THEN RAISE EXCEPTION 'Uninstrumented engineering rule claimed direct inputs or readiness'; END IF;
 SELECT * INTO c FROM public.harness_model_checks WHERE evaluation_id=e AND rule_key='segment_links' LIMIT 1;
 r:=public.harness_model_check_context('e08bf694-970f-4cbe-8a74-8715158a0f2e',e,c.id);
 IF r->>'input_coverage'<>'not_recorded' OR jsonb_array_length(r#>'{inspection_context,ends}')<>2
  OR r#>>'{inspection_context,role}'<>'recorded_design_addresses_only_not_consumed_witnesses_or_continuity'
  OR jsonb_array_length(r#>'{inspection_context,endpoints}')>2
 THEN RAISE EXCEPTION 'Recorded inspection context is missing or falsely claims predicate lineage'; END IF;
END $$;

SET ROLE anon;
DO $$ DECLARE e uuid; c uuid; r jsonb; BEGIN
 SELECT latest_evaluation_id INTO e FROM public.harness_model_state WHERE vehicle_id='e08bf694-970f-4cbe-8a74-8715158a0f2e';
 SELECT id INTO c FROM public.harness_model_checks WHERE evaluation_id=e AND rule_key='planned_wire_amount' LIMIT 1;
 r:=public.harness_model_check_context('e08bf694-970f-4cbe-8a74-8715158a0f2e',e,c);
 IF r->>'status'<>'current' OR jsonb_array_length(r->'inputs')<>2 THEN RAISE EXCEPTION 'Anonymous direct check inspection failed: %',r; END IF;
 r:=public.harness_model_check_context('e08bf694-970f-4cbe-8a74-8715158a0f2e','00000000-0000-0000-0000-000000000001',c);
 IF r->>'status'<>'pending' OR r->'check'<>'null'::jsonb OR jsonb_array_length(r->'inputs')<>0
 THEN RAISE EXCEPTION 'Different requested evaluation reused a current check or misreported visibility'; END IF;
 IF has_column_privilege(current_user,'public.harness_model_evaluations','input_snapshot','SELECT')
  OR has_column_privilege(current_user,'public.harness_model_evaluations','logic_snapshot','SELECT')
 THEN RAISE EXCEPTION 'Private evaluation receipts exposed'; END IF;
END $$;
RESET ROLE;

-- One hidden child must withhold the shared receipt, all manual consumers and
-- the bounded context reader. It cannot become an empty successful explanation.
BEGIN;
ALTER POLICY harness_model_check_inputs_read ON public.harness_model_check_inputs USING(input_field<>'planned_length_method');
SET LOCAL ROLE anon;
DO $$ DECLARE e uuid; c uuid; r jsonb; BEGIN
 SELECT latest_evaluation_id INTO e FROM public.harness_model_state WHERE vehicle_id='e08bf694-970f-4cbe-8a74-8715158a0f2e';
 SELECT id INTO c FROM public.harness_model_checks WHERE evaluation_id=e AND rule_key='planned_wire_amount' LIMIT 1;
 r:=public.harness_model_check_context('e08bf694-970f-4cbe-8a74-8715158a0f2e',e,c);
 IF r->>'status'='current' OR r->'check'<>'null'::jsonb OR jsonb_array_length(r->'inputs')<>0
  OR public.harness_manual_index('e08bf694-970f-4cbe-8a74-8715158a0f2e')->>'status'='current'
 THEN RAISE EXCEPTION 'Hidden direct-input row left a current consumer'; END IF;
END $$;
ROLLBACK;

DO $$ DECLARE b public.harness_model_check_inputs; other_segment uuid; e uuid; q uuid; original public.harness_model_checks; BEGIN
 SELECT * INTO b FROM public.harness_model_check_inputs LIMIT 1;
 SELECT * INTO original FROM public.harness_model_checks WHERE id=b.check_id;
 -- Fresh derived result fixture, not testimony. Its first input INSERT cannot
 -- be rejected by an existing duplicate key and mask a broken source guard.
 INSERT INTO public.harness_model_evaluations(vehicle_id,input_hash,logic_key,input_snapshot,logic_snapshot,
  node_count,segment_end_count,check_count,wire_requirement_count,check_input_count)
 SELECT vehicle_id,md5((input_snapshot||'{"contract":"fresh_direct_input_guard"}'::jsonb)::text),logic_key,
  input_snapshot||'{"contract":"fresh_direct_input_guard"}'::jsonb,logic_snapshot,0,0,1,0,original.input_binding_count
 FROM public.harness_model_evaluations WHERE id=b.evaluation_id RETURNING id INTO e;
 INSERT INTO public.harness_model_checks(evaluation_id,rule_key,rule_version,segment_id,result,input_binding_count)
 VALUES(e,original.rule_key,original.rule_version,original.segment_id,original.result,original.input_binding_count) RETURNING id INTO q;
 BEGIN
  INSERT INTO public.harness_model_check_inputs VALUES(e,q,b.segment_id,b.input_field,b.field_present,repeat('0',32));
  RAISE EXCEPTION 'Forged direct-input hash admitted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 SELECT id INTO other_segment FROM public.harness_segments WHERE id<>b.segment_id LIMIT 1;
 BEGIN
  INSERT INTO public.harness_model_check_inputs VALUES(e,q,other_segment,b.input_field,b.field_present,b.value_md5);
  RAISE EXCEPTION 'Foreign physical-piece input admitted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 INSERT INTO public.harness_model_check_inputs VALUES(e,q,b.segment_id,b.input_field,b.field_present,b.value_md5);
 BEGIN UPDATE public.harness_model_check_inputs SET value_md5=repeat('0',32) WHERE check_id=q;
  RAISE EXCEPTION 'Immutable direct inputs updated'; EXCEPTION WHEN raise_exception THEN
   IF SQLERRM='Immutable direct inputs updated' THEN RAISE; END IF; END;
 BEGIN DELETE FROM public.harness_model_check_inputs WHERE check_id=q;
  RAISE EXCEPTION 'Immutable direct inputs deleted'; EXCEPTION WHEN raise_exception THEN
   IF SQLERRM='Immutable direct inputs deleted' THEN RAISE; END IF; END;
END $$;

BEGIN;
UPDATE public.harness_segments SET planned_length_ft=coalesce(planned_length_ft,1)+1
 WHERE id=(SELECT segment_id FROM public.harness_model_check_inputs LIMIT 1);
SET LOCAL ROLE anon;
DO $$ DECLARE e uuid; c uuid; r jsonb; BEGIN
 SELECT latest_evaluation_id INTO e FROM public.harness_model_state WHERE vehicle_id='e08bf694-970f-4cbe-8a74-8715158a0f2e';
 SELECT id INTO c FROM public.harness_model_checks WHERE evaluation_id=e AND rule_key='planned_wire_amount' LIMIT 1;
 r:=public.harness_model_check_context('e08bf694-970f-4cbe-8a74-8715158a0f2e',e,c);
 IF r->>'status'='current' OR r->'check'<>'null'::jsonb OR jsonb_array_length(r->'inputs')<>0
 THEN RAISE EXCEPTION 'Changed plan left old check explanation current'; END IF;
END $$;
ROLLBACK;

BEGIN;
DO $$ DECLARE body text:=pg_get_functiondef('public.harness_model_segment_check(text,jsonb)'::regprocedure); BEGIN
 EXECUTE replace(body,'DECLARE fields text[];','-- interpreter change invalidates prior receipts'||E'\nDECLARE fields text[];');
 IF public.harness_manual_index('e08bf694-970f-4cbe-8a74-8715158a0f2e')->>'status'='current'
 THEN RAISE EXCEPTION 'Predicate interpreter change left receipt current'; END IF;
END $$;
ROLLBACK;
-- Reuse the pre-existing population through the actual atomic producer, not
-- just the pure JSON computation. Batch admission must retain every field.
SET statement_timeout='10s';
\i supabase/sql/helpers/harness_model_scale_fixture.sql
SET ROLE anon;
DO $$ DECLARE e uuid; expected integer; c uuid; r jsonb; BEGIN
 SELECT latest_evaluation_id INTO e FROM public.harness_model_state WHERE vehicle_id=md5('harness scale vehicle')::uuid;
 SELECT check_input_count INTO expected FROM public.harness_model_evaluations WHERE id=e;
 IF expected<>5500 OR (SELECT count(*) FROM public.harness_model_check_inputs WHERE evaluation_id=e)<>5500
 THEN RAISE EXCEPTION '500-piece producer lost direct field bindings: %',expected; END IF;
 SELECT id INTO c FROM public.harness_model_checks WHERE evaluation_id=e AND rule_key='planned_wire_amount' LIMIT 1;
 r:=public.harness_model_check_context(md5('harness scale vehicle')::uuid,e,c);
 IF r->>'status'<>'current' OR jsonb_array_length(r->'inputs')<>2
 THEN RAISE EXCEPTION '500-piece current check inspection failed'; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(r#>'{inspection_context,endpoints}') ep
  WHERE jsonb_array_length(ep->'selected_piece_ends')>8)
  OR NOT EXISTS(SELECT FROM jsonb_array_elements(r#>'{inspection_context,endpoints}') ep
   WHERE (ep->>'selected_piece_end_count')::int=500 AND ep->>'selected_piece_ends_complete'='false')
 THEN RAISE EXCEPTION 'Large endpoint context lost its bound or truncation declaration'; END IF;
END $$;
RESET ROLE;
SELECT 'test_harness_check_field_bindings: PASS' result;

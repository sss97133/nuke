-- Full evaluation contract; shared setup also supports focused downstream contracts.
\set ON_ERROR_STOP on
\i supabase/sql/helpers/harness_model_evaluation_setup.sql

DO $$ BEGIN
 IF has_function_privilege('anon','public.harness_model_fold(uuid)','EXECUTE')
  OR has_function_privilege('authenticated','public.harness_model_signal(uuid[],text,boolean)','EXECUTE')
  OR has_function_privilege('anon','public.harness_model_compute(jsonb)','EXECUTE')
 THEN RAISE EXCEPTION 'Hosted default grants reopened producer helpers'; END IF;
END $$;

DO $$
DECLARE i jsonb; again jsonb; r jsonb; n int; ft numeric;
BEGIN
 i:=public.harness_model_inputs('e08bf694-970f-4cbe-8a74-8715158a0f2e');
 again:=public.harness_model_inputs('e08bf694-970f-4cbe-8a74-8715158a0f2e');
 IF md5(i::text)<>md5(again::text) THEN RAISE EXCEPTION 'Unchanged source changed its input fingerprint'; END IF;
 IF i->'model'->>'selection'<>'decided_design' THEN RAISE EXCEPTION 'Selected design contract missing'; END IF;
 SELECT count(*),sum((x->>'planned_length_ft')::numeric) INTO n,ft
 FROM jsonb_array_elements(i->'model'->'segments') x WHERE x->>'circuit_code'='110';
 IF n<>2 OR ft<>4.63 THEN RAISE EXCEPTION '110 physical quantities changed: %, %',n,ft; END IF;
 r:=public.harness_model_compute(i);
 IF NOT EXISTS (SELECT FROM jsonb_array_elements(r->'checks') x WHERE x->>'rule_key'='segment_specification'
  AND x->>'segment_id'=(SELECT s.id::text FROM public.harness_segments s JOIN public.vehicle_custom_circuits c ON c.id=s.vehicle_custom_circuit_id WHERE c.circuit_code='23')
  AND x->>'result'='fail') THEN RAISE EXCEPTION '23 disagreement did not become an input-bound failure'; END IF;
 IF NOT EXISTS (SELECT FROM jsonb_array_elements(r->'checks') x WHERE x->>'rule_key'='engineering_coverage' AND x->>'result'='hold')
  THEN RAISE EXCEPTION 'Structural checks were promoted to engineering release'; END IF;
 IF jsonb_array_length(r->'segment_ends')=0 THEN RAISE EXCEPTION 'DB did not derive physical end attachments'; END IF;
 IF NOT EXISTS (SELECT FROM jsonb_array_elements(r->'wire_requirements') x
  WHERE x->>'segment_id'=(SELECT s.id::text FROM public.harness_segments s JOIN public.vehicle_custom_circuits c ON c.id=s.vehicle_custom_circuit_id WHERE c.circuit_code='23')
  AND x->>'state'='held') THEN RAISE EXCEPTION 'Conflicting wire became a usable stock requirement'; END IF;
END $$;
DO $$
DECLARE r jsonb; again jsonb; run uuid; n int;
BEGIN
 r:=public.harness_model_fold('e08bf694-970f-4cbe-8a74-8715158a0f2e');
 IF r->>'status'<>'current' THEN RAISE EXCEPTION 'Atomic writer did not complete: %',r; END IF;
 run:=(r->>'evaluation_id')::uuid;
 again:=public.harness_model_fold('e08bf694-970f-4cbe-8a74-8715158a0f2e');
 IF again->>'evaluation_id'<>run::text OR again->>'reused'<>'true' THEN RAISE EXCEPTION 'Unchanged input was recomputed: %',again; END IF;
 SELECT count(*) INTO n FROM public.harness_model_checks WHERE evaluation_id=run;
 IF n=0 THEN RAISE EXCEPTION 'No result rows were stored'; END IF;
 IF NOT EXISTS (SELECT FROM public.harness_model_segment_ends WHERE evaluation_id=run) THEN RAISE EXCEPTION 'No typed edge attachments were stored'; END IF;
 IF NOT EXISTS (SELECT FROM public.harness_model_evaluations WHERE id=run AND input_hash=md5(input_snapshot::text)
   AND logic_key=md5(logic_snapshot::text)) THEN RAISE EXCEPTION 'Input/code receipt is not bound to its hash'; END IF;
 BEGIN
  UPDATE public.harness_model_checks SET result='pass' WHERE evaluation_id=run AND result='fail';
  RAISE EXCEPTION 'tampered_result_accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='tampered_result_accepted' THEN RAISE; END IF;
 END;
END $$;
DO $$
DECLARE r jsonb; again jsonb; n int;
BEGIN
 r:=public.harness_evaluated_model('e08bf694-970f-4cbe-8a74-8715158a0f2e');
 again:=public.harness_evaluated_model('e08bf694-970f-4cbe-8a74-8715158a0f2e');
 IF r->>'status'<>'current' OR r->'model'->>'contract_version'<>'2' THEN RAISE EXCEPTION 'Current read failed: %',r->>'status'; END IF;
 IF r->'model'->>'snapshot_hash'<>again->'model'->>'snapshot_hash' THEN RAISE EXCEPTION 'Stable result changed its content hash'; END IF;
 SELECT count(*) INTO n FROM jsonb_array_elements(r->'model'->'segments') x WHERE x->>'circuit_code'='110';
 IF n<>2 THEN RAISE EXCEPTION 'Persisted read lost physical grain'; END IF;
 IF jsonb_array_length(r->'model'->'model_checks')=0 THEN RAISE EXCEPTION 'Consumer received no stored checks'; END IF;
 IF jsonb_array_length(r->'model'->'rule_definitions')<>12 THEN RAISE EXCEPTION 'Consumer has no bound check meanings'; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(r#>'{model,rule_definitions}') x WHERE nullif(x->>'display_name','') IS NULL
  OR nullif(x->>'attention_action','') IS NULL) THEN RAISE EXCEPTION 'Builder receives a hold without its named resolution step'; END IF;
 IF jsonb_array_length(r#>'{model,attention_check_ids}')<>(SELECT count(*) FROM jsonb_array_elements(r#>'{model,model_checks}') x WHERE x->>'result'<>'pass')
 THEN RAISE EXCEPTION 'Database did not order the actual unresolved result IDs'; END IF;
END $$;

-- Typed result guards cannot attach another asset or swap a physical piece's recorded side.
DO $$
DECLARE run uuid; foreign_overlay uuid:=gen_random_uuid(); foreign_circuit uuid:=gen_random_uuid(); edge record;
BEGIN
 SELECT latest_evaluation_id INTO run FROM public.harness_model_state;
 INSERT INTO public.vehicle_wiring_overlays(id,vehicle_id) VALUES(foreign_overlay,'00000000-0000-0000-0000-00000000ff01');
 INSERT INTO public.vehicle_custom_circuits(id,overlay_id,circuit_code) VALUES(foreign_circuit,foreign_overlay,'FOREIGN');
 BEGIN
  INSERT INTO public.harness_model_checks(evaluation_id,rule_key,rule_version,circuit_id,result)
   VALUES(run,'circuit_segments','1',foreign_circuit,'pass');
  RAISE EXCEPTION 'Cross-vehicle result accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 SELECT a.* INTO edge FROM public.harness_model_segment_ends a JOIN public.harness_segments s ON s.id=a.segment_id
  WHERE a.evaluation_id=run AND a.side='from' AND s.to_termination_id IS NOT NULL
   AND s.to_termination_id<>a.termination_id LIMIT 1;
 BEGIN
  INSERT INTO public.harness_model_segment_ends(evaluation_id,segment_id,side,termination_id,node_id)
   SELECT run,edge.segment_id,'from',s.to_termination_id,edge.node_id FROM public.harness_segments s WHERE s.id=edge.segment_id;
  RAISE EXCEPTION 'Unrecorded physical end accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;
DO $$
DECLARE before_hash text; previous_timezone text:=current_setting('TimeZone');
BEGIN
 before_hash:=public.harness_evaluated_model('e08bf694-970f-4cbe-8a74-8715158a0f2e')#>>'{model,snapshot_hash}';
 PERFORM set_config('TimeZone','America/Los_Angeles',true);
 IF before_hash IS DISTINCT FROM (public.harness_evaluated_model('e08bf694-970f-4cbe-8a74-8715158a0f2e')#>>'{model,snapshot_hash}')
 THEN RAISE EXCEPTION 'Session timezone changed model identity'; END IF;
 PERFORM set_config('TimeZone',previous_timezone,true);
END $$;

-- An unresolved endpoint reused by two pieces is not proof of shared electrical continuity.
DO $$
DECLARE i jsonb; g jsonb; piece jsonb; r jsonb; ids int;
BEGIN
 i:=public.harness_model_inputs('e08bf694-970f-4cbe-8a74-8715158a0f2e');
 piece:=i#>'{model,segments,0}';
 g:=jsonb_set(i->'model','{segments}',jsonb_build_array(piece,piece||jsonb_build_object('id',gen_random_uuid())));
 g:=jsonb_set(g,'{endpoints}',(SELECT jsonb_agg(x||'{"node_kind":null}'::jsonb) FROM jsonb_array_elements(g->'endpoints') x));
 r:=public.harness_model_compute(jsonb_set(i,'{model}',g));
 SELECT count(DISTINCT x->>'node_id') INTO ids FROM jsonb_array_elements(r->'segment_ends') x;
 IF ids<>jsonb_array_length(r->'segment_ends') THEN RAISE EXCEPTION 'Unknown endpoint established shared continuity'; END IF;
END $$;

-- A canonical-reader extension may retain physical history and add metadata.
-- Simulate that contract extension over the actual source reader, then restore it.
ALTER FUNCTION public.harness_schematic_model(uuid) RENAME TO harness_schematic_fixture_original;
CREATE FUNCTION public.harness_schematic_model(p_vehicle_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 WITH original AS (SELECT public.harness_schematic_fixture_original(p_vehicle_id) AS g)
 SELECT g || jsonb_build_object('snapshot_key','unselected snapshot metadata','source','private prose',
  'circuits',(SELECT jsonb_agg(c || CASE WHEN c->>'code'='23' THEN '{"is_superseded":true}'::jsonb ELSE '{}'::jsonb END)
    FROM jsonb_array_elements(g->'circuits') c),
  'segments',(SELECT jsonb_agg(x || CASE WHEN x->>'circuit_code'='110' THEN '{"in_current_plan":false}'::jsonb ELSE '{}'::jsonb END
    || '{"source":"private prose","method":"private method"}'::jsonb) FROM jsonb_array_elements(g->'segments') x)) FROM original;
$$;
DO $contract_extension$
DECLARE i jsonb; before_key text;
BEGIN
 i:=public.harness_model_inputs('e08bf694-970f-4cbe-8a74-8715158a0f2e');
 IF EXISTS(SELECT FROM jsonb_array_elements(i#>'{model,circuits}') x WHERE x->>'code'='23')
  OR EXISTS(SELECT FROM jsonb_array_elements(i#>'{model,segments}') x WHERE x->>'circuit_code' IN ('110','23'))
 THEN RAISE EXCEPTION 'Retained/out-of-plan rows entered selected design'; END IF;
 IF jsonb_path_exists(i,'$.model.**.source') OR jsonb_path_exists(i,'$.model.**.method')
  OR i->'model' ? 'snapshot_key' THEN RAISE EXCEPTION 'Unallowlisted metadata entered public evaluation'; END IF;
 before_key:=public.harness_model_logic_key();
 EXECUTE $sql$CREATE FUNCTION public.harness_segment_spec_status(uuid) RETURNS text LANGUAGE sql AS 'SELECT ''fixture helper''::text'$sql$;
 IF public.harness_model_logic_key()=before_key THEN RAISE EXCEPTION 'New material helper did not invalidate logic'; END IF;
 EXECUTE 'DROP FUNCTION public.harness_segment_spec_status(uuid)';
END $contract_extension$;
DROP FUNCTION public.harness_schematic_model(uuid);
ALTER FUNCTION public.harness_schematic_fixture_original(uuid) RENAME TO harness_schematic_model;

-- Follow source admission through the same worker boundaries that production patches.
DO $$
DECLARE before_id uuid; before_epoch bigint; before_runs int; r jsonb;
BEGIN
 SELECT latest_evaluation_id,source_epoch INTO before_id,before_epoch FROM public.harness_model_state
 WHERE vehicle_id='e08bf694-970f-4cbe-8a74-8715158a0f2e';
 SELECT count(*) INTO before_runs FROM public.harness_model_evaluations;
 UPDATE public.harness_segments SET planned_length_ft=planned_length_ft+0.1
 WHERE id=(SELECT s.id FROM public.harness_segments s JOIN public.vehicle_custom_circuits c ON c.id=s.vehicle_custom_circuit_id
  WHERE c.circuit_code='110' ORDER BY s.id LIMIT 1);
 IF NOT EXISTS (SELECT FROM public.harness_model_state WHERE source_epoch>before_epoch AND source_epoch<>folded_epoch)
  THEN RAISE EXCEPTION 'Source change did not invalidate its cursor'; END IF;
 r:=public.harness_evaluated_model('e08bf694-970f-4cbe-8a74-8715158a0f2e');
 IF r->>'status'<>'pending' OR r->'model'<>'null'::jsonb THEN RAISE EXCEPTION 'Stale evaluation survived a source change'; END IF;
 IF NOT EXISTS (SELECT FROM public.model_fold_signal WHERE reason LIKE 'harness:%') THEN RAISE EXCEPTION 'No existing-worker signal'; END IF;
 CALL public.model_fold_tick();
 r:=public.harness_evaluated_model('e08bf694-970f-4cbe-8a74-8715158a0f2e');
 IF r->>'status'<>'current' OR (r->>'evaluation_id')::uuid=before_id THEN RAISE EXCEPTION 'Worker did not publish changed input: %',r->>'status'; END IF;
 IF (SELECT count(*) FROM public.harness_model_evaluations)<>before_runs+1 THEN RAISE EXCEPTION 'One changed input did not produce one receipt'; END IF;
 IF public.harness_model_enqueue_changed()<>0 THEN RAISE EXCEPTION 'Current cursor requeued itself'; END IF;
 -- A no-op source UPDATE must not continually invalidate its own consumer.
 SELECT source_epoch INTO before_epoch FROM public.harness_model_state;
 UPDATE public.harness_segments SET planned_length_ft=planned_length_ft;
 IF (SELECT source_epoch FROM public.harness_model_state)<>before_epoch THEN RAISE EXCEPTION 'No-op writes invalidate the model'; END IF;
END $$;

-- The legacy reader lacks physical_progress; circuit/event history must still hold new wire demand.
DO $$
DECLARE i jsonb; cid uuid; sid text;
BEGIN
 SELECT id INTO cid FROM public.vehicle_custom_circuits WHERE circuit_code='110';
 UPDATE public.vehicle_custom_circuits SET build_state='cut' WHERE id=cid;
 i:=public.harness_model_inputs('e08bf694-970f-4cbe-8a74-8715158a0f2e');
 IF EXISTS(SELECT FROM jsonb_array_elements(i#>'{model,segments}') x WHERE x->>'circuit_id'=cid::text
   AND x->>'physical_progress' IS DISTINCT FROM 'true') THEN RAISE EXCEPTION 'Circuit build state lost at physical grain'; END IF;
 UPDATE public.vehicle_custom_circuits SET build_state='uncut' WHERE id=cid;
 INSERT INTO public.harness_build_events(vehicle_id,circuit_id,to_state) VALUES('e08bf694-970f-4cbe-8a74-8715158a0f2e',cid,'terminated');
 i:=public.harness_model_inputs('e08bf694-970f-4cbe-8a74-8715158a0f2e');
 IF EXISTS(SELECT FROM jsonb_array_elements(i#>'{model,segments}') x WHERE x->>'circuit_id'=cid::text
   AND x->>'physical_progress' IS DISTINCT FROM 'true') THEN RAISE EXCEPTION 'Recorded build history lost after scalar reset'; END IF;
 CALL public.model_fold_tick();
 IF public.harness_evaluated_model('e08bf694-970f-4cbe-8a74-8715158a0f2e')->>'status'<>'current'
 THEN RAISE EXCEPTION 'Build history did not refold'; END IF;
END $$;

-- Code changes have no source-row trigger; the existing tick detects the changed implementation key.
DO $$
DECLARE d text; before_id uuid; r jsonb;
BEGIN
 SELECT latest_evaluation_id INTO before_id FROM public.harness_model_state;
 d:=pg_get_functiondef('public.harness_model_compute(jsonb)'::regprocedure);
 EXECUTE replace(d,'WITH model AS','-- deliberate contract code revision'||chr(10)||'WITH model AS');
 r:=public.harness_evaluated_model('e08bf694-970f-4cbe-8a74-8715158a0f2e');
 IF r->>'status'<>'pending' THEN RAISE EXCEPTION 'Old code result stayed current'; END IF;
 CALL public.model_fold_tick();
 r:=public.harness_evaluated_model('e08bf694-970f-4cbe-8a74-8715158a0f2e');
 IF r->>'status'<>'current' OR (r->>'evaluation_id')::uuid=before_id THEN RAISE EXCEPTION 'Code-only change was not folded'; END IF;
END $$;

-- A broken rule contract fails atomically, visibly backs off, then recovers through a new retained version.
DO $$
DECLARE before_runs int; r jsonb; failures int;
BEGIN
 SELECT count(*) INTO before_runs FROM public.harness_model_evaluations;
 UPDATE public.harness_model_rules SET is_current=false,superseded_at=clock_timestamp() WHERE rule_key='segment_links' AND is_current;
 CALL public.model_fold_tick();
 IF (SELECT count(*) FROM public.harness_model_evaluations)<>before_runs THEN RAISE EXCEPTION 'Failed fold admitted partial outputs'; END IF;
 r:=public.harness_evaluated_model('e08bf694-970f-4cbe-8a74-8715158a0f2e');
 IF r->>'status'<>'error' OR r->'model'<>'null'::jsonb THEN RAISE EXCEPTION 'Failure was hidden behind an old result'; END IF;
 SELECT failure_count INTO failures FROM public.harness_model_state;
 r:=public.harness_model_fold('e08bf694-970f-4cbe-8a74-8715158a0f2e');
 IF r->>'status'<>'backoff' OR (SELECT failure_count FROM public.harness_model_state)<>failures THEN RAISE EXCEPTION 'Retry backoff was ignored'; END IF;
 INSERT INTO public.harness_model_rules(rule_key,version,subject_kind,description,implementation,display_name,attention_action,attention_order)
 SELECT rule_key,'2',subject_kind,description,implementation,display_name,attention_action,attention_order FROM public.harness_model_rules WHERE rule_key='segment_links' AND version='1';
 IF (SELECT failure_count FROM public.harness_model_state)<>0 THEN RAISE EXCEPTION 'New source contract did not reset backoff'; END IF;
 CALL public.model_fold_tick();
 IF public.harness_evaluated_model('e08bf694-970f-4cbe-8a74-8715158a0f2e')->>'status'<>'current'
  THEN RAISE EXCEPTION 'Retained rule revision did not recover'; END IF;
 IF (SELECT count(*) FROM public.harness_model_rules WHERE rule_key='segment_links')<>2 THEN RAISE EXCEPTION 'Prior rule version lost'; END IF;
END $$;

-- The parent reader contract ended with source segment RLS denied. Restore its original public policy.
DROP POLICY reader_contract_deny_segments ON public.harness_segments;
CREATE POLICY "Public read for public vehicles" ON public.harness_segments FOR SELECT USING (
 EXISTS (SELECT FROM public.vehicles v WHERE v.id=harness_segments.vehicle_id
  AND (v.is_public IS TRUE OR v.user_id=auth.uid() OR v.owner_id=auth.uid())));
SET ROLE anon;
DO $$
DECLARE r jsonb;
BEGIN
 r:=public.harness_evaluated_model('e08bf694-970f-4cbe-8a74-8715158a0f2e');
 IF r->>'status'<>'current' THEN RAISE EXCEPTION 'Anonymous public evaluation failed: %',r->>'status'; END IF;
 BEGIN
  PERFORM input_snapshot FROM public.harness_model_evaluations;
  RAISE EXCEPTION 'private_snapshot_visible';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 IF public.harness_evaluated_model('00000000-0000-0000-0000-00000000ff01')->>'status'<>'unavailable'
  THEN RAISE EXCEPTION 'Private/deleted vehicle evaluation visible'; END IF;
END $$;
RESET ROLE;

-- Retiring public visibility cannot expose a prior public receipt to an anonymous owner session.
CREATE TEMP TABLE prior_public_model AS SELECT latest_evaluation_id,source_epoch FROM public.harness_model_state;
UPDATE public.vehicles SET is_public=false,user_id='00000000-0000-0000-0000-00000000ff11'
 WHERE id='e08bf694-970f-4cbe-8a74-8715158a0f2e';
SELECT set_config('test.auth_jwt','{"is_anonymous":true}',false);
SET ROLE authenticated;
DO $$ BEGIN
 IF public.harness_model_visible('e08bf694-970f-4cbe-8a74-8715158a0f2e') THEN RAISE EXCEPTION 'Anonymous owner can see private evaluation'; END IF;
 IF public.harness_model_inputs('e08bf694-970f-4cbe-8a74-8715158a0f2e') IS NOT NULL THEN RAISE EXCEPTION 'Input helper bypasses visibility'; END IF;
 IF public.harness_evaluated_model('e08bf694-970f-4cbe-8a74-8715158a0f2e')->>'status'<>'unavailable'
  THEN RAISE EXCEPTION 'Former public result still available'; END IF;
 IF EXISTS (SELECT FROM public.harness_model_evaluations) OR EXISTS (SELECT FROM public.harness_model_checks)
  THEN RAISE EXCEPTION 'Stored private metadata bypasses visibility'; END IF;
END $$;
RESET ROLE;
-- A private edit must retain invalidation without admitting private work to the public loop.
UPDATE public.harness_segments SET planned_length_ft=planned_length_ft+0.01
 WHERE vehicle_custom_circuit_id=(SELECT id FROM public.vehicle_custom_circuits WHERE circuit_code='110');
DO $$ BEGIN
 IF (SELECT source_epoch FROM public.harness_model_state)<=(SELECT source_epoch FROM prior_public_model)
  THEN RAISE EXCEPTION 'Enrolled private edit lost its invalidation'; END IF;
 IF EXISTS (SELECT FROM public.model_fold_signal) THEN RAISE EXCEPTION 'Private harness queued in public execution scope'; END IF;
END $$;
UPDATE public.vehicles SET is_public=true WHERE id='e08bf694-970f-4cbe-8a74-8715158a0f2e';
SELECT set_config('test.auth_jwt','{}',false);
CALL public.model_fold_tick();
DO $$ BEGIN
 IF public.harness_evaluated_model('e08bf694-970f-4cbe-8a74-8715158a0f2e')->>'status'<>'current'
  OR (SELECT latest_evaluation_id FROM public.harness_model_state)=(SELECT latest_evaluation_id FROM prior_public_model)
 THEN RAISE EXCEPTION 'Public return did not recover through normal worker'; END IF;
END $$;

-- Physical progress keeps the gross plan but holds new stock eligibility, without changing source evidence.
DO $$
DECLARE i jsonb; r jsonb; sid text;
BEGIN
 i:=public.harness_model_inputs('e08bf694-970f-4cbe-8a74-8715158a0f2e');
 sid:=i#>>'{model,segments,0,id}';
 i:=jsonb_set(i,'{model,segments,0,build_state}','"cut"');
 r:=public.harness_model_compute(i);
 IF NOT EXISTS (SELECT FROM jsonb_array_elements(r->'checks') x WHERE x->>'segment_id'=sid
   AND x->>'rule_key'='new_wire_demand' AND x->>'result'='hold') THEN RAISE EXCEPTION 'Cut piece became new stock demand'; END IF;
 IF NOT EXISTS (SELECT FROM jsonb_array_elements(r->'wire_requirements') x WHERE x->>'segment_id'=sid AND x->>'state'='held')
  THEN RAISE EXCEPTION 'Progressed gross plan was released'; END IF;
END $$;

-- Representative population and shared bus: exercise the complete producer and public cached read.
-- Synthetic source records remain inside this disposable database; no live source fixture is shipped.
DO $population$
DECLARE v uuid:=md5('harness scale vehicle')::uuid; o uuid:=md5('harness scale overlay')::uuid;
 d uuid:=md5('harness scale design')::uuid; net uuid:=md5('harness scale net')::uuid;
 a uuid:=md5('harness scale bus')::uuid; b uuid:=md5('harness scale connector')::uuid; r jsonb;
BEGIN
 INSERT INTO public.vehicles(id,is_public) VALUES(v,true);
 INSERT INTO public.vehicle_wiring_overlays(id,vehicle_id) VALUES(o,v);
 INSERT INTO public.harness_designs(id,vehicle_id) VALUES(d,v);
 INSERT INTO public.harness_endpoints(id,design_id,code,node_kind) VALUES(a,d,'SCALE-BUS','bus'),(b,d,'SCALE-PINS','terminals');
 INSERT INTO public.harness_nets(id,vehicle_id,net_code,source,method,observed_at,trust)
  VALUES(net,v,'scale','disposable fixture','synthetic shared-net population',now(),'T3');
 INSERT INTO public.vehicle_custom_circuits(id,overlay_id,circuit_code,circuit_name,design_status,build_state,wire_type,wire_gauge_awg,wire_color)
  SELECT md5('harness scale circuit '||i)::uuid,o,'SCALE-'||i,'synthetic fixture','decided','uncut','M22759/32',20,'red' FROM generate_series(1,500) i;
 INSERT INTO public.wire_termination_specs(id,vehicle_id,circuit_id,endpoint_id,cavity)
  SELECT md5('harness scale end '||i||side)::uuid,v,md5('harness scale circuit '||i)::uuid,
   CASE side WHEN 'from' THEN a ELSE b END,CASE side WHEN 'from' THEN 'bus' ELSE 'P'||i END
  FROM generate_series(1,500) i CROSS JOIN (VALUES('from'),('to')) s(side);
 INSERT INTO public.harness_segments(id,vehicle_id,vehicle_custom_circuit_id,net_id,from_termination_id,to_termination_id,
  wire_part_id,gauge_awg,colour,planned_length_ft,planned_length_method,build_state,design_status,source,method,observed_at,trust)
  SELECT md5('harness scale piece '||i)::uuid,v,md5('harness scale circuit '||i)::uuid,net,
   md5('harness scale end '||i||'from')::uuid,md5('harness scale end '||i||'to')::uuid,
   '00000000-0000-0000-0000-00000000c001',20,'red',1,'synthetic fixture plan','uncut','decided','disposable fixture','synthetic population',now(),'T3'
  FROM generate_series(1,500) i;
 -- Production tables have planner statistics; refresh the disposable bulk-loaded fixture before measuring its path.
 ANALYZE public.vehicles; ANALYZE public.vehicle_wiring_overlays; ANALYZE public.vehicle_custom_circuits;
 ANALYZE public.harness_designs; ANALYZE public.harness_endpoints; ANALYZE public.wire_termination_specs;
 ANALYZE public.harness_segments; ANALYZE public.harness_nets; ANALYZE public.catalog_parts;
 r:=public.harness_model_fold(v);
 IF r->>'status'<>'current' THEN RAISE EXCEPTION 'Population fold failed: %',r; END IF;
END $population$;
SET ROLE anon;
DO $$
DECLARE r jsonb; g jsonb;
BEGIN
 r:=public.harness_evaluated_model(md5('harness scale vehicle')::uuid);g:=r->'model';
 IF r->>'status'<>'current' OR jsonb_array_length(g->'segments')<>500
  OR jsonb_array_length(g->'electrical_nodes')<>501 OR jsonb_array_length(g->'segment_ends')<>1000
  OR jsonb_array_length(g->'model_checks')<>7501 OR jsonb_array_length(g->'wire_requirements')<>500
 THEN RAISE EXCEPTION 'Population cached graph lost grain or public visibility'; END IF;
 IF (SELECT count(DISTINCT x->>'node_id') FROM jsonb_array_elements(g->'segment_ends') x WHERE x->>'side'='from')<>1
 THEN RAISE EXCEPTION 'Shared bus was split into individual physical ends'; END IF;
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(g->'model_checks') x WHERE x->>'rule_key'='engineering_coverage' AND x->>'result'='hold')
 THEN RAISE EXCEPTION 'Population consistency became engineering release'; END IF;
END $$;
RESET ROLE;

-- Missing cached check rows cannot turn into a zero-failure model.
ALTER POLICY harness_model_checks_read ON public.harness_model_checks USING (false);
SET ROLE anon;
DO $$
DECLARE r jsonb;
BEGIN
 r:=public.harness_evaluated_model('e08bf694-970f-4cbe-8a74-8715158a0f2e');
 IF r->>'status'<>'incomplete_visibility' OR r->'model'<>'null'::jsonb THEN RAISE EXCEPTION 'Partial cached output was served as current'; END IF;
END $$;
RESET ROLE;
SELECT 'test_harness_model_evaluation: PASS' AS result;

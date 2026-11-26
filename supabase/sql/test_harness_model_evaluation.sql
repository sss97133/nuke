-- Empty disposable PG17 only. Reuse the real physical-grain/visibility regression fixture.
\set ON_ERROR_STOP on
\i supabase/sql/test_harness_schematic_model.sql

CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT coalesce(nullif(current_setting('test.auth_jwt',true),'')::jsonb,'{}'::jsonb);
$$;
-- The historical reshape fixture predates physical segment qualification.
UPDATE public.harness_segments SET design_status='decided' WHERE NOT is_superseded;
CREATE FUNCTION public.vein_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN RAISE EXCEPTION 'append only'; END $$;
CREATE TABLE IF NOT EXISTS public.harness_build_events(id uuid DEFAULT gen_random_uuid(),vehicle_id uuid REFERENCES public.vehicles(id));
CREATE FUNCTION public.model_fold_config() RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT '{"enabled":true,"signals_enabled":true,"max_attempts":3,"max_vehicles":2,"settle_seconds":1,"max_delay_seconds":60}'::jsonb;
$$;
-- Minimal boundaries of the already-tested generic worker; this contract exercises the real new domain fold.
CREATE TABLE public.model_fold_signal(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 vehicle_id uuid REFERENCES public.vehicles(id),reason text,priority integer,at timestamptz DEFAULT now());
CREATE TABLE public.model_fold_work(vehicle_id uuid PRIMARY KEY REFERENCES public.vehicles(id),state text);
CREATE FUNCTION public.model_fold_absorb_signals(p_limit integer) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
 INSERT INTO public.model_fold_work(vehicle_id,state) SELECT DISTINCT vehicle_id,'pending' FROM public.model_fold_signal
 ON CONFLICT(vehicle_id) DO UPDATE SET state='pending';
 GET DIAGNOSTICS n=ROW_COUNT;
 DELETE FROM public.model_fold_signal;
 RETURN n;
END $$;
CREATE FUNCTION public.model_fold_one(p_tick uuid,p_vehicle uuid,p_cfg jsonb,p_edited uuid[] DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  -- labor_fold_v1_end
 RETURN '{}'::jsonb;
END $$;
CREATE PROCEDURE public.model_fold_tick() LANGUAGE plpgsql AS $$
DECLARE v_sig integer; x record;
BEGIN
  v_sig := public.model_fold_absorb_signals(100);
 FOR x IN SELECT vehicle_id FROM public.model_fold_work WHERE state='pending' LOOP
  PERFORM public.model_fold_one(gen_random_uuid(),x.vehicle_id,public.model_fold_config(),'{}');
  UPDATE public.model_fold_work SET state='done' WHERE vehicle_id=x.vehicle_id;
 END LOOP;
END $$;
\i supabase/migrations/20261125233922_harness_model_evaluation_loop.sql

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
 INSERT INTO public.harness_model_rules(rule_key,version,subject_kind,description,implementation)
 SELECT rule_key,'2',subject_kind,description,implementation FROM public.harness_model_rules WHERE rule_key='segment_links' AND version='1';
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
UPDATE public.vehicles SET is_public=true WHERE id='e08bf694-970f-4cbe-8a74-8715158a0f2e';
SELECT set_config('test.auth_jwt','{}',false);

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

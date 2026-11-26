-- Standalone analytical simulation fixtures; no vehicle/testimony rows.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF NOT starts_with(current_database(),'dm_refinement_') OR EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p'))
 THEN RAISE EXCEPTION 'Requires an empty disposable dm_refinement database'; END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
\i supabase/migrations/20261126181729_harness_model_dc_compute.sql
CREATE FUNCTION pg_temp.fixture() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{
 "reference_node_id":"ground","nodes":[{"id":"ground"},{"id":"battery"},{"id":"switch_in"},{"id":"load_in"},{"id":"return"}],
 "branches":[
 {"id":"source","kind":"voltage_source","from_node_id":"battery","to_node_id":"ground","voltage_v":12},
 {"id":"feed","kind":"resistor","from_node_id":"battery","to_node_id":"switch_in","resistance_ohm":0.1},
 {"id":"contact","kind":"switch","from_node_id":"switch_in","to_node_id":"load_in","state":"closed","resistance_ohm":0.1},
 {"id":"load","kind":"resistor","from_node_id":"load_in","to_node_id":"return","resistance_ohm":1},
 {"id":"return_wire","kind":"resistor","from_node_id":"return","to_node_id":"ground","resistance_ohm":0.2}]}'::jsonb $$;
CREATE FUNCTION pg_temp.branch(p_result jsonb,p_id text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT x FROM jsonb_array_elements(p_result->'branches') t(x) WHERE x->>'id'=p_id $$;
CREATE FUNCTION pg_temp.near(p_actual double precision,p_expected double precision) RETURNS boolean LANGUAGE sql AS $$
 SELECT p_actual IS NOT NULL AND abs(p_actual-p_expected)<1e-7*greatest(1,abs(p_expected)) $$;
DO $$
DECLARE f jsonb:=pg_temp.fixture(); r jsonb; changed jsonb; reordered jsonb; other_result jsonb; expected double precision:=12/1.4::double precision;
BEGIN
 r:=public.harness_model_dc_compute(f);
 IF r->>'status' IS DISTINCT FROM 'solved' OR r->>'qualification' IS DISTINCT FROM 'conditional_simulation_only'
  OR NOT pg_temp.near((pg_temp.branch(r,'feed')->>'current_a')::float8,expected)
  OR NOT pg_temp.near((pg_temp.branch(r,'load')->>'voltage_drop_v')::float8,expected)
  OR NOT pg_temp.near((pg_temp.branch(r,'source')->>'current_a')::float8,-expected)
  OR NOT pg_temp.near((pg_temp.branch(r,'load')->>'absorbed_power_w')::float8,expected*expected)
  OR NOT pg_temp.near((r->'residuals'->>'net_absorbed_power_w')::float8,0)
  OR NOT pg_temp.near((r->'residuals'->>'max_node_current_imbalance_a')::float8,0)
  OR NOT pg_temp.near((r->'residuals'->>'max_voltage_source_error_v')::float8,0)
 THEN RAISE EXCEPTION 'Analytical source/wire/contact/load/return mismatch: %',r; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(r->'nodes')) IS DISTINCT FROM 5 OR jsonb_array_length(r->'branches') IS DISTINCT FROM 5
 THEN RAISE EXCEPTION 'Lost node or physical element identity'; END IF;

 r:=public.harness_model_dc_compute(jsonb_set(f,'{branches,2,state}','"open"'));
 IF r->>'status' IS DISTINCT FROM 'solved' OR NOT pg_temp.near((pg_temp.branch(r,'contact')->>'current_a')::float8,0)
  OR NOT pg_temp.near((pg_temp.branch(r,'load')->>'current_a')::float8,0)
  OR NOT pg_temp.near((pg_temp.branch(r,'contact')->>'voltage_drop_v')::float8,12)
 THEN RAISE EXCEPTION 'Open switch leaked or erased voltage: %',r; END IF;

 r:=public.harness_model_dc_compute(jsonb_set(f,'{branches,1,resistance_ohm}','0.6'));
 IF r->>'status' IS DISTINCT FROM 'solved' OR NOT pg_temp.near((pg_temp.branch(r,'load')->>'current_a')::float8,12/1.9::float8)
  OR (pg_temp.branch(r,'load')->>'voltage_drop_v')::float8>=expected
 THEN RAISE EXCEPTION 'Increased resistance did not lower delivered load voltage: %',r; END IF;

 changed:=f||jsonb_build_object('branches',(f->'branches')||jsonb_build_array(jsonb_build_object('id','parallel_load','kind','resistor',
  'from_node_id','load_in','to_node_id','return','resistance_ohm',2)));
 r:=public.harness_model_dc_compute(changed);
 IF r->>'status' IS DISTINCT FROM 'solved' OR NOT pg_temp.near((pg_temp.branch(r,'feed')->>'current_a')::float8,11.25)
  OR NOT pg_temp.near((pg_temp.branch(r,'load')->>'current_a')::float8,7.5)
  OR NOT pg_temp.near((pg_temp.branch(r,'parallel_load')->>'current_a')::float8,3.75)
 THEN RAISE EXCEPTION 'Parallel branch current conservation failed: %',r; END IF;
 SELECT changed||jsonb_build_object('nodes',(SELECT jsonb_agg(x ORDER BY ord DESC) FROM jsonb_array_elements(changed->'nodes') WITH ORDINALITY t(x,ord)),
 'branches',(SELECT jsonb_agg(x ORDER BY ord DESC) FROM jsonb_array_elements(changed->'branches') WITH ORDINALITY t(x,ord))) INTO reordered;
 other_result:=public.harness_model_dc_compute(reordered);
 IF other_result->>'status' IS DISTINCT FROM 'solved' OR other_result->'nodes' IS DISTINCT FROM r->'nodes' OR other_result->'branches' IS DISTINCT FROM r->'branches' THEN RAISE EXCEPTION 'Input order changed keyed results'; END IF;

 r:=public.harness_model_dc_compute('{"reference_node_id":"g","nodes":[{"id":"g"},{"id":"n"}],"branches":[
 {"id":"i","kind":"current_source","from_node_id":"g","to_node_id":"n","current_a":2},
 {"id":"r","kind":"resistor","from_node_id":"n","to_node_id":"g","resistance_ohm":4}]}');
 IF r->>'status' IS DISTINCT FROM 'solved' OR NOT pg_temp.near((pg_temp.branch(r,'r')->>'voltage_drop_v')::float8,8)
 OR NOT pg_temp.near((pg_temp.branch(r,'i')->>'absorbed_power_w')::float8,-16)
 THEN RAISE EXCEPTION 'Independent current source solve failed: %',r; END IF;

 -- A short is an explicit changed branch value, never a fuse-rated load.
 r:=public.harness_model_dc_compute(jsonb_set(f,'{branches,3,resistance_ohm}','0.001'));
 IF r->>'status' IS DISTINCT FROM 'solved' OR NOT pg_temp.near((pg_temp.branch(r,'feed')->>'current_a')::float8,12/0.401::float8)
 THEN RAISE EXCEPTION 'Finite short-current fixture failed: %',r; END IF;
END $$;
DO $$
DECLARE f jsonb:=pg_temp.fixture(); r jsonb; c jsonb;
BEGIN
 FOR c IN SELECT x FROM (VALUES
  (jsonb_set(f,'{branches,2,state}','"unknown"'),'held'),
  (jsonb_set(f,'{branches,2,state}','null'),'held'),
  (jsonb_set(f,'{branches,1,resistance_ohm}','null'),'held'),
  (jsonb_set(f,'{branches,0,voltage_v}','null'),'held'),
  (jsonb_set(f,'{branches,3,kind}','"motor_unmodeled"'),'held'),
  (jsonb_set(f,'{branches,1,resistance_ohm}','0'),'invalid'),
  (jsonb_set(f,'{branches,1,resistance_ohm}','-1'),'invalid'),
  (jsonb_set(f,'{branches,1,resistance_ohm}','"0.1"'),'held'),
  (jsonb_set(f,'{branches,2,state}','"energized"'),'invalid'),
  (jsonb_set(f,'{branches,1,to_node_id}','"missing"'),'invalid'),
  (jsonb_set(f,'{branches,1,id}','"source"'),'invalid'),
  (jsonb_set(f,'{reference_node_id}','"missing"'),'invalid'),
  (jsonb_set(f,'{nodes,0,id}','"battery"'),'invalid'),
  (jsonb_set(f,'{nodes}','{}'),'invalid'),
  (jsonb_set(f,'{branches}','null'),'invalid'),
  ('null'::jsonb,'invalid'),
  ('[]'::jsonb,'invalid'),
  (jsonb_set(f,'{branches,0,voltage_v}','1e999'),'invalid')
  ,(jsonb_set(f,'{branches,1,state}','"open"'),'invalid')
  ,(jsonb_set(f,'{branches,3,capacitance_f}','1'),'invalid')
  ,(jsonb_set(f,'{nodes,1,voltage_v}','12'),'invalid')
  ,(f||'{"automatic_ground":true}'::jsonb,'invalid')
 ) t(input,status) CROSS JOIN LATERAL (SELECT jsonb_build_object('input',input,'status',status) x) q LOOP
  r:=public.harness_model_dc_compute(c->'input');
  IF r->>'status' IS DISTINCT FROM c->>'status' OR r->'nodes' IS DISTINCT FROM '[]'::jsonb OR r->'branches' IS DISTINCT FROM '[]'::jsonb
   THEN RAISE EXCEPTION 'Malformed/unknown input manufactured a result: input %, result %',c,r; END IF;
 END LOOP;
 c:=jsonb_set(f,'{branches,2,state}','"open"'); c:=jsonb_set(c,'{branches}',(c->'branches')-4);
 r:=public.harness_model_dc_compute(c);
 IF r->>'status' IS DISTINCT FROM 'indeterminate' OR r->'issues'->0->>'code' IS DISTINCT FROM 'no_conductive_reference_path'
 OR NOT (r->'issues'->0->'node_ids' ? 'return') THEN RAISE EXCEPTION 'Floating return was silently grounded: %',r; END IF;

 c:=f||jsonb_build_object('branches',(f->'branches')||jsonb_build_array(jsonb_build_object('id','conflict','kind','voltage_source',
 'from_node_id','battery','to_node_id','ground','voltage_v',13)));
 r:=public.harness_model_dc_compute(c);
 IF r->>'status' IS DISTINCT FROM 'inconsistent' THEN RAISE EXCEPTION 'Conflicting ideal supplies did not fail: %',r; END IF;
 c:=jsonb_set(c,'{branches,5,voltage_v}','12');r:=public.harness_model_dc_compute(c);
 IF r->>'status' IS DISTINCT FROM 'indeterminate' THEN RAISE EXCEPTION 'Parallel ideal-source current was guessed: %',r; END IF;

 c:=jsonb_set(f,'{nodes}',(f->'nodes')||(SELECT jsonb_agg(jsonb_build_object('id','extra'||i)) FROM generate_series(1,60) t(i)));
 r:=public.harness_model_dc_compute(c);IF r->>'status' IS DISTINCT FROM 'invalid' OR r->'issues'->0->>'code' IS DISTINCT FROM 'scenario_bound_exceeded' THEN RAISE EXCEPTION 'Node bound ignored'; END IF;
 c:=jsonb_set(f,'{branches}',(f->'branches')||(SELECT jsonb_agg((f->'branches'->1)||jsonb_build_object('id','extra'||i)) FROM generate_series(1,124) t(i)));
 r:=public.harness_model_dc_compute(c);IF r->>'status' IS DISTINCT FROM 'invalid' OR r->'issues'->0->>'code' IS DISTINCT FROM 'scenario_bound_exceeded' THEN RAISE EXCEPTION 'Branch bound ignored'; END IF;
 c:=jsonb_set(f,'{branches}',(SELECT jsonb_agg((f->'branches'->0)||jsonb_build_object('id','source'||i)) FROM generate_series(1,17) t(i)));
 r:=public.harness_model_dc_compute(c);
 IF r->>'status' IS DISTINCT FROM 'invalid' OR r->'issues'->0->>'code' IS DISTINCT FROM 'voltage_source_bound_exceeded'
  OR r->'input_hash' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Voltage-source bound/hash contract ignored'; END IF;
 IF has_function_privilege('anon','public.harness_model_dc_compute(jsonb)','execute')
  OR has_function_privilege('authenticated','public.harness_model_dc_compute(jsonb)','execute')
  OR NOT has_function_privilege('service_role','public.harness_model_dc_compute(jsonb)','execute')
 THEN RAISE EXCEPTION 'Pure internal solver was exposed as a public vehicle reader'; END IF;
 IF EXISTS(SELECT FROM pg_proc WHERE oid='public.harness_model_dc_compute(jsonb)'::regprocedure AND (prosecdef OR provolatile<>'i'))
 THEN RAISE EXCEPTION 'Solver changed from pure invoker semantics'; END IF;
END $$;
-- Non-grounded source terminals and explicit zero-volt contact/probe.
DO $$
DECLARE r jsonb;
BEGIN
 r:=public.harness_model_dc_compute('{"reference_node_id":"g","nodes":[{"id":"g"},{"id":"a"},{"id":"b"},{"id":"c"}],"branches":[
 {"id":"v","kind":"voltage_source","from_node_id":"a","to_node_id":"b","voltage_v":12},
 {"id":"r1","kind":"resistor","from_node_id":"a","to_node_id":"g","resistance_ohm":2},
 {"id":"r2","kind":"resistor","from_node_id":"g","to_node_id":"c","resistance_ohm":4},
 {"id":"probe","kind":"voltage_source","from_node_id":"c","to_node_id":"b","voltage_v":0}]}');
 IF r->>'status' IS DISTINCT FROM 'solved' OR NOT pg_temp.near((pg_temp.branch(r,'r1')->>'current_a')::float8,2)
 OR NOT pg_temp.near((pg_temp.branch(r,'r2')->>'current_a')::float8,2)
 OR NOT pg_temp.near((pg_temp.branch(r,'probe')->>'current_a')::float8,2)
 OR NOT pg_temp.near((pg_temp.branch(r,'v')->>'current_a')::float8,-2)
 THEN RAISE EXCEPTION 'Non-grounded supply or zero-volt contact failed: %',r; END IF;
END $$;
-- Exercise the maximum allowed matrix/branch/source size, not just toy loops.
DO $$
DECLARE f jsonb; r jsonb;
BEGIN
 SELECT jsonb_build_object('reference_node_id','g','nodes',
  '[{"id":"g"}]'::jsonb||(SELECT jsonb_agg(jsonb_build_object('id','n'||i)) FROM generate_series(1,63) t(i)),
  'branches',(SELECT jsonb_agg(x) FROM (
   SELECT jsonb_build_object('id','v'||i,'kind','voltage_source','from_node_id','n'||i,'to_node_id','g','voltage_v',12-i*0.1) x
    FROM generate_series(1,16) t(i)
   UNION ALL
   SELECT jsonb_build_object('id','r'||i,'kind','resistor','from_node_id','n'||(1+((i-1)%63)),
    'to_node_id','n'||(1+(i%63)),'resistance_ohm',0.1+i*0.01) x FROM generate_series(1,112) t(i)) b)) INTO f;
 r:=public.harness_model_dc_compute(f);
 IF r->>'status' IS DISTINCT FROM 'solved' OR jsonb_array_length(r->'nodes') IS DISTINCT FROM 64 OR jsonb_array_length(r->'branches') IS DISTINCT FROM 128
 THEN RAISE EXCEPTION 'Bounded full-size scenario failed: %',r; END IF;
END $$;
-- Review regressions: cancellation, weak coupling and caller serialization.
DO $$
DECLARE f jsonb; r jsonb; before_ jsonb; after_ jsonb; c jsonb;
BEGIN
 f:='{"reference_node_id":"g","nodes":[{"id":"g"},{"id":"n"}],"branches":[
 {"id":"r","kind":"resistor","from_node_id":"n","to_node_id":"g","resistance_ohm":1e12},
 {"id":"01","kind":"current_source","from_node_id":"g","to_node_id":"n","current_a":1e6},
 {"id":"02","kind":"current_source","from_node_id":"g","to_node_id":"n","current_a":1e-11},
 {"id":"03","kind":"current_source","from_node_id":"g","to_node_id":"n","current_a":-1e6}]}';
 r:=public.harness_model_dc_compute(f);
 IF r->>'status' IS DISTINCT FROM 'solved' OR NOT pg_temp.near((pg_temp.branch(r,'r')->>'voltage_drop_v')::float8,10)
  OR NOT pg_temp.near((r->'residuals'->>'max_node_current_imbalance_a')::float8,0)
 THEN RAISE EXCEPTION 'Small current lost during source cancellation: %',r; END IF;
 r:=public.harness_model_dc_compute(jsonb_set(f,'{branches}',(f->'branches')-2));
 IF r->>'status' IS DISTINCT FROM 'solved' OR NOT pg_temp.near((pg_temp.branch(r,'r')->>'voltage_drop_v')::float8,0)
 THEN RAISE EXCEPTION 'Balanced sources introduced a potential: %',r; END IF;
 r:=public.harness_model_dc_compute('{"reference_node_id":"g","nodes":[{"id":"g"},{"id":"a"},{"id":"b"}],"branches":[
 {"id":"r1","kind":"resistor","from_node_id":"a","to_node_id":"g","resistance_ohm":1e12},
 {"id":"r2","kind":"resistor","from_node_id":"a","to_node_id":"b","resistance_ohm":0.125},
 {"id":"i","kind":"current_source","from_node_id":"g","to_node_id":"a","current_a":1e-12}]}');
 IF r->>'status' IS DISTINCT FROM 'solved' OR NOT pg_temp.near((pg_temp.branch(r,'r1')->>'voltage_drop_v')::float8,1)
  OR NOT pg_temp.near((pg_temp.branch(r,'r2')->>'voltage_drop_v')::float8,0)
 THEN RAISE EXCEPTION 'Resolvable weak coupling was called dependent ideal sources: %',r; END IF;
 f:='{"reference_node_id":"g","nodes":[{"id":"g"},{"id":"n"}],"branches":[
 {"id":"v","kind":"voltage_source","from_node_id":"n","to_node_id":"g","voltage_v":12.34},
 {"id":"r","kind":"resistor","from_node_id":"n","to_node_id":"g","resistance_ohm":2}]}';
 PERFORM set_config('extra_float_digits','-13',true);before_:=public.harness_model_dc_compute(f);
 PERFORM set_config('extra_float_digits','3',true);after_:=public.harness_model_dc_compute(f);
 IF before_ IS DISTINCT FROM after_ OR before_->>'status' IS DISTINCT FROM 'solved'
  OR NOT pg_temp.near((pg_temp.branch(before_,'v')->>'voltage_drop_v')::float8,12.34)
 THEN RAISE EXCEPTION 'Caller serialization settings changed an immutable result'; END IF;

 f:=jsonb_set(pg_temp.fixture(),'{branches,2,state}','"open"');
 FOR c IN SELECT value FROM jsonb_array_elements('[{},[],null,"0.1",0,-1,1e131071]') LOOP
  r:=public.harness_model_dc_compute(jsonb_set(f,'{branches,2,resistance_ohm}',c));
  IF r->>'status' IS DISTINCT FROM 'invalid' OR r->'input_hash' IS DISTINCT FROM 'null'::jsonb
  THEN RAISE EXCEPTION 'Open contact accepted an invalid retained resistance'; END IF;
 END LOOP;
 r:=public.harness_model_dc_compute(jsonb_set(f,'{branches,2}',(f->'branches'->2)-'resistance_ohm'));
 IF r->>'status' IS DISTINCT FROM 'solved' THEN RAISE EXCEPTION 'Open contact required irrelevant missing resistance'; END IF;
 r:=public.harness_model_dc_compute(jsonb_set(pg_temp.fixture(),'{branches,0,voltage_v}','1e131071'));
 IF r->>'status' IS DISTINCT FROM 'invalid' OR r->'input_hash' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Outsize numeric rendered before domain check'; END IF;
 r:=public.harness_model_dc_compute(jsonb_set(pg_temp.fixture(),'{branches,0,voltage_v}','1e-16000'));
 IF r->>'status' IS DISTINCT FROM 'invalid' OR r->'input_hash' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Outsize numeric scale rendered before domain check'; END IF;
 f:=jsonb_set(pg_temp.fixture(),'{branches,2,state}','"unknown"');
 r:=public.harness_model_dc_compute(jsonb_set(f,'{branches,2,resistance_ohm}','1e131071'));
 IF r->>'status' IS DISTINCT FROM 'held' OR r->'input_hash' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Unvalidated held input was rendered for a hash'; END IF;
END $$;
-- Bind a conditional operating scenario to exact existing piece/end/node keys.
CREATE FUNCTION pg_temp.bound_fixture() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"model":{
 "contract_version":2,"vehicle_id":"vehicle","evaluation_id":"evaluation","snapshot_hash":"source-hash","sheet_id":"sheet",
 "sheet_scope":"bounded_manual_sheet","selection":"decided_design",
 "unsegmented_end_records":[],"unsegmented_end_count":0,"unsegmented_end_records_complete":true,
 "segments":[{"id":"feed","from_termination_id":"t1","to_termination_id":"t2"},{"id":"return","from_termination_id":"t3","to_termination_id":"t4"}],
 "electrical_nodes":[{"id":"b"},{"id":"l"},{"id":"r"},{"id":"g"}],
 "segment_ends":[{"segment_id":"feed","side":"from","termination_id":"t1","node_id":"b"},
 {"segment_id":"feed","side":"to","termination_id":"t2","node_id":"l"},
 {"segment_id":"return","side":"from","termination_id":"t3","node_id":"r"},
 {"segment_id":"return","side":"to","termination_id":"t4","node_id":"g"}]},
 "scenario":{"id":"conditional-on","basis":"conditional_assumption","scope":"selected_sheet_only","evaluation_id":"evaluation","snapshot_hash":"source-hash",
 "reference_termination_id":"t4","wires":[{"segment_id":"feed","state":"closed","resistance_ohm":0.1},{"segment_id":"return","state":"closed","resistance_ohm":0.2}],
 "devices":[{"id":"source","kind":"voltage_source","from_termination_id":"t1","to_termination_id":"t4","voltage_v":12},
 {"id":"load","kind":"resistor","from_termination_id":"t2","to_termination_id":"t3","resistance_ohm":1}],"assumed_open_termination_ids":[]}}'::jsonb $$;
DO $$
DECLARE f jsonb:=pg_temp.bound_fixture(); r jsonb; open_ jsonb; c jsonb;
BEGIN
 r:=public.harness_model_dc_compute(f);
 IF r->>'status' IS DISTINCT FROM 'solved' OR NOT pg_temp.near((pg_temp.branch(r,'wire/feed')->>'current_a')::float8,12/1.3::float8)
  OR r->>'parameter_basis' IS DISTINCT FROM 'conditional_assumption'
  OR r->'model_identity'->>'evaluation_id' IS DISTINCT FROM 'evaluation'
  OR r->'model_identity'->>'currentness' IS DISTINCT FROM 'caller_supplied_not_verified'
  OR r->>'input_hash_scope' IS DISTINCT FROM 'compiled_dc_network'
  OR r->>'network_completeness' IS DISTINCT FROM 'not_established_by_bounded_sheet'
  OR r->>'terminal_coverage' IS DISTINCT FROM 'evaluated_piece_attachments_only'
  OR r->>'structural_checks' IS DISTINCT FROM 'not_consumed_by_conditional_solver'
  OR jsonb_array_length(r->'branch_bindings') IS DISTINCT FROM 4
  OR NOT EXISTS(SELECT FROM jsonb_array_elements(r->'branch_bindings') t(x) WHERE x->>'branch_id'='wire/feed'
   AND x->>'segment_id'='feed' AND x->>'from_termination_id'='t1' AND x->>'to_termination_id'='t2')
 THEN RAISE EXCEPTION 'Conditional topology binding lost physical identity or qualification: %',r; END IF;
 open_:=public.harness_model_dc_compute(jsonb_set(f,'{scenario,wires,0,state}','"open"'));
 IF open_->>'status' IS DISTINCT FROM 'solved' OR NOT pg_temp.near((pg_temp.branch(open_,'device/load')->>'current_a')::float8,0)
  OR open_->'input_hash' IS NOT DISTINCT FROM r->'input_hash'
 THEN RAISE EXCEPTION 'Explicit wire-open state did not change bound operating point'; END IF;
 FOR c IN SELECT x FROM (VALUES
  (jsonb_set(f,'{scenario,evaluation_id}','"other"'),'invalid','conditional_scenario_identity_invalid'),
  (jsonb_set(f,'{scenario,snapshot_hash}','"other"'),'invalid','conditional_scenario_identity_invalid'),
  (jsonb_set(f,'{scenario,basis}','"manufacturer_verified"'),'invalid','conditional_scenario_identity_invalid'),
  (jsonb_set(f,'{scenario,scope}','"complete_vehicle"'),'invalid','conditional_scenario_identity_invalid'),
  (jsonb_set(f,'{scenario,wires}',(f->'scenario'->'wires')-0),'held','wire_operating_parameters_missing'),
  (jsonb_set(f,'{scenario,wires,1,segment_id}','"feed"'),'invalid','wire_parameter_identity_invalid'),
  (jsonb_set(f,'{model,segments,0,to_termination_id}','"foreign"'),'held','piece_end_attachment_unresolved'),
  (jsonb_set(f,'{model,segment_ends,0,node_id}','"missing"'),'invalid','evaluated_attachment_invalid'),
  (jsonb_set(f,'{scenario,devices}',(f->'scenario'->'devices')-1),'held','terminal_behavior_undeclared'),
  (jsonb_set(f,'{scenario,devices,0,from_termination_id}','"foreign"'),'invalid','device_terminal_binding_invalid'),
  (jsonb_set(f,'{scenario,assumed_open_termination_ids}','["t1"]'),'invalid','open_boundary_identity_invalid'),
  (jsonb_set(f,'{model,unsegmented_end_count}','1'),'held','source_end_coverage_unresolved'),
  (jsonb_set(f,'{model,unsegmented_end_records_complete}','false'),'held','source_end_coverage_unresolved'),
  (jsonb_set(f,'{model,unsegmented_end_count}','null'),'held','source_end_coverage_unresolved')
 ) t(input,status,issue) CROSS JOIN LATERAL (SELECT jsonb_build_object('input',input,'status',status,'issue',issue) x) q LOOP
  r:=public.harness_model_dc_compute(c->'input');
  IF r->>'status' IS DISTINCT FROM c->>'status' OR r->'nodes' IS DISTINCT FROM '[]'::jsonb OR r->'branches' IS DISTINCT FROM '[]'::jsonb
   OR NOT EXISTS(SELECT FROM jsonb_array_elements(r->'issues') t(x) WHERE x->>'code'=c->>'issue')
  THEN RAISE EXCEPTION 'Incomplete or foreign bound input was accepted: %',r; END IF;
 END LOOP;
 c:=jsonb_set(f,'{scenario,devices}',(f->'scenario'->'devices')-1);
 c:=jsonb_set(c,'{scenario,assumed_open_termination_ids}','["t2","t3"]');r:=public.harness_model_dc_compute(c);
 IF r->>'status' IS DISTINCT FROM 'solved' OR NOT pg_temp.near((pg_temp.branch(r,'wire/feed')->>'current_a')::float8,0)
 THEN RAISE EXCEPTION 'Explicit assumed-open boundaries did not yield an open-load scenario'; END IF;
 c:=jsonb_set(f,'{model,segments,1,from_termination_id}','"t1"');
 c:=jsonb_set(c,'{model,segment_ends,2,termination_id}','"t1"');c:=jsonb_set(c,'{model,segment_ends,2,node_id}','"b"');
 r:=public.harness_model_dc_compute(c);
 IF r->>'status' IS DISTINCT FROM 'held' OR r->'issues'->0->>'code' IS DISTINCT FROM 'physical_end_reused_by_segments'
 THEN RAISE EXCEPTION 'One physical termination was accepted on two pieces'; END IF;
 c:=jsonb_set(f,'{model,segments,0,to_termination_id}','"t1"');
 c:=jsonb_set(c,'{model,segment_ends,1,termination_id}','"t1"');c:=jsonb_set(c,'{model,segment_ends,1,node_id}','"b"');
 r:=public.harness_model_dc_compute(c);
 IF r->>'status' IS DISTINCT FROM 'held' OR r->'issues'->0->>'code' IS DISTINCT FROM 'physical_end_reused_by_segments'
 THEN RAISE EXCEPTION 'One physical termination was accepted on both piece ends'; END IF;
END $$;
DO $$
DECLARE f jsonb:=pg_temp.bound_fixture(); r jsonb; path_ text[]; value_ jsonb;
BEGIN
 FOREACH path_ SLICE 1 IN ARRAY ARRAY[
  ARRAY['model','segments','0'],ARRAY['model','electrical_nodes','0'],ARRAY['model','segment_ends','0'],
  ARRAY['scenario','wires','0'],ARRAY['scenario','devices','0']] LOOP
  FOR value_ IN SELECT value FROM jsonb_array_elements('[null,[],{},true,1,"invalid"]') LOOP
   r:=public.harness_model_dc_compute(jsonb_set(f,path_,value_));
   IF r->>'status' IS DISTINCT FROM 'invalid' OR r->'nodes' IS DISTINCT FROM '[]'::jsonb
    OR r->'branches' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'Malformed binding row did not fail closed: %',path_; END IF;
  END LOOP;
 END LOOP;
END $$;
SET ROLE service_role;
SELECT public.harness_model_dc_compute('{"reference_node_id":"g","nodes":[{"id":"g"}],"branches":[]}')->>'status' AS service_result;
RESET ROLE;
SELECT 'test_harness_model_dc_compute: PASS' AS result;

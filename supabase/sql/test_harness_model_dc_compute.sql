-- Standalone analytical simulation fixtures; no vehicle/testimony rows.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%' OR EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p'))
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
 IF r->>'status'<>'solved' OR r->>'qualification'<>'conditional_simulation_only'
  OR NOT pg_temp.near((pg_temp.branch(r,'feed')->>'current_a')::float8,expected)
  OR NOT pg_temp.near((pg_temp.branch(r,'load')->>'voltage_drop_v')::float8,expected)
  OR NOT pg_temp.near((pg_temp.branch(r,'source')->>'current_a')::float8,-expected)
  OR NOT pg_temp.near((pg_temp.branch(r,'load')->>'absorbed_power_w')::float8,expected*expected)
  OR abs((r->'residuals'->>'net_absorbed_power_w')::float8)>1e-8
  OR abs((r->'residuals'->>'max_node_current_imbalance_a')::float8)>1e-8
 THEN RAISE EXCEPTION 'Analytical source/wire/contact/load/return mismatch: %',r; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(r->'nodes'))<>5 OR jsonb_array_length(r->'branches')<>5
 THEN RAISE EXCEPTION 'Lost node or physical element identity'; END IF;

 r:=public.harness_model_dc_compute(jsonb_set(f,'{branches,2,state}','"open"'));
 IF r->>'status'<>'solved' OR NOT pg_temp.near((pg_temp.branch(r,'contact')->>'current_a')::float8,0)
  OR NOT pg_temp.near((pg_temp.branch(r,'load')->>'current_a')::float8,0)
  OR NOT pg_temp.near((pg_temp.branch(r,'contact')->>'voltage_drop_v')::float8,12)
 THEN RAISE EXCEPTION 'Open switch leaked or erased voltage: %',r; END IF;

 r:=public.harness_model_dc_compute(jsonb_set(f,'{branches,1,resistance_ohm}','0.6'));
 IF r->>'status'<>'solved' OR NOT pg_temp.near((pg_temp.branch(r,'load')->>'current_a')::float8,12/1.9::float8)
  OR (pg_temp.branch(r,'load')->>'voltage_drop_v')::float8>=expected
 THEN RAISE EXCEPTION 'Increased resistance did not lower delivered load voltage: %',r; END IF;

 changed:=f||jsonb_build_object('branches',(f->'branches')||jsonb_build_array(jsonb_build_object('id','parallel_load','kind','resistor',
  'from_node_id','load_in','to_node_id','return','resistance_ohm',2)));
 r:=public.harness_model_dc_compute(changed);
 IF r->>'status'<>'solved' OR NOT pg_temp.near((pg_temp.branch(r,'feed')->>'current_a')::float8,11.25)
  OR NOT pg_temp.near((pg_temp.branch(r,'load')->>'current_a')::float8,7.5)
  OR NOT pg_temp.near((pg_temp.branch(r,'parallel_load')->>'current_a')::float8,3.75)
 THEN RAISE EXCEPTION 'Parallel branch current conservation failed: %',r; END IF;
 SELECT changed||jsonb_build_object('nodes',(SELECT jsonb_agg(x ORDER BY ord DESC) FROM jsonb_array_elements(changed->'nodes') WITH ORDINALITY t(x,ord)),
 'branches',(SELECT jsonb_agg(x ORDER BY ord DESC) FROM jsonb_array_elements(changed->'branches') WITH ORDINALITY t(x,ord))) INTO reordered;
 other_result:=public.harness_model_dc_compute(reordered);
 IF other_result->'nodes'<>r->'nodes' OR other_result->'branches'<>r->'branches' THEN RAISE EXCEPTION 'Input order changed keyed results'; END IF;

 r:=public.harness_model_dc_compute('{"reference_node_id":"g","nodes":[{"id":"g"},{"id":"n"}],"branches":[
 {"id":"i","kind":"current_source","from_node_id":"g","to_node_id":"n","current_a":2},
 {"id":"r","kind":"resistor","from_node_id":"n","to_node_id":"g","resistance_ohm":4}]}');
 IF r->>'status'<>'solved' OR NOT pg_temp.near((pg_temp.branch(r,'r')->>'voltage_drop_v')::float8,8)
 OR NOT pg_temp.near((pg_temp.branch(r,'i')->>'absorbed_power_w')::float8,-16)
 THEN RAISE EXCEPTION 'Independent current source solve failed: %',r; END IF;

 -- A short is an explicit changed branch value, never a fuse-rated load.
 r:=public.harness_model_dc_compute(jsonb_set(f,'{branches,3,resistance_ohm}','0.001'));
 IF r->>'status'<>'solved' OR NOT pg_temp.near((pg_temp.branch(r,'feed')->>'current_a')::float8,12/0.401::float8)
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
  IF r->>'status'<>c->>'status' OR jsonb_array_length(r->'nodes')<>0 OR jsonb_array_length(r->'branches')<>0
   THEN RAISE EXCEPTION 'Malformed/unknown input manufactured a result: input %, result %',c,r; END IF;
 END LOOP;
 c:=jsonb_set(f,'{branches,2,state}','"open"'); c:=jsonb_set(c,'{branches}',(c->'branches')-4);
 r:=public.harness_model_dc_compute(c);
 IF r->>'status'<>'indeterminate' OR r->'issues'->0->>'code'<>'no_conductive_reference_path'
 OR NOT (r->'issues'->0->'node_ids' ? 'return') THEN RAISE EXCEPTION 'Floating return was silently grounded: %',r; END IF;

 c:=f||jsonb_build_object('branches',(f->'branches')||jsonb_build_array(jsonb_build_object('id','conflict','kind','voltage_source',
 'from_node_id','battery','to_node_id','ground','voltage_v',13)));
 r:=public.harness_model_dc_compute(c);
 IF r->>'status'<>'inconsistent' THEN RAISE EXCEPTION 'Conflicting ideal supplies did not fail: %',r; END IF;
 c:=jsonb_set(c,'{branches,5,voltage_v}','12');r:=public.harness_model_dc_compute(c);
 IF r->>'status'<>'indeterminate' THEN RAISE EXCEPTION 'Parallel ideal-source current was guessed: %',r; END IF;

 c:=jsonb_set(f,'{nodes}',(SELECT jsonb_agg(jsonb_build_object('id','n'||i)) FROM generate_series(1,65) t(i)));
 r:=public.harness_model_dc_compute(c);IF r->>'status'<>'invalid' THEN RAISE EXCEPTION 'Node bound ignored'; END IF;
 c:=jsonb_set(f,'{branches}',(SELECT jsonb_agg(f->'branches'->0) FROM generate_series(1,129)));
 r:=public.harness_model_dc_compute(c);IF r->>'status'<>'invalid' THEN RAISE EXCEPTION 'Branch bound ignored'; END IF;
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
 IF r->>'status'<>'solved' OR NOT pg_temp.near((pg_temp.branch(r,'r1')->>'current_a')::float8,2)
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
 IF r->>'status'<>'solved' OR jsonb_array_length(r->'nodes')<>64 OR jsonb_array_length(r->'branches')<>128
 THEN RAISE EXCEPTION 'Bounded full-size scenario failed: %',r; END IF;
END $$;
SET ROLE service_role;
SELECT public.harness_model_dc_compute('{"reference_node_id":"g","nodes":[{"id":"g"}],"branches":[]}')->>'status' AS service_result;
RESET ROLE;
SELECT 'test_harness_model_dc_compute: PASS' AS result;

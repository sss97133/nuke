-- Empty disposable PostgreSQL17 only. The parent contract enforces that boundary.
-- All additional source rows below are synthetic; no live vehicle capture is embedded.
\set ON_ERROR_STOP on
\i supabase/sql/test_harness_manual_sheets.sql
\i supabase/migrations/20261126041635_harness_functional_manual_sheets.sql
\i supabase/migrations/20261126051125_harness_fold_phase_diagnostics.sql

-- The parent deliberately ends by hiding sheet members. Restore its reviewed policy.
ALTER POLICY harness_model_sheet_members_read ON public.harness_model_sheet_members USING (
 EXISTS(SELECT FROM public.harness_model_sheets h
  WHERE h.evaluation_id=harness_model_sheet_members.evaluation_id AND h.id=harness_model_sheet_members.sheet_id)
 AND EXISTS(SELECT FROM public.harness_model_wire_requirements q
  WHERE q.evaluation_id=harness_model_sheet_members.evaluation_id AND q.segment_id=harness_model_sheet_members.segment_id));

-- Historical fixture compatibility only; these columns already have production owners.
ALTER TABLE public.vehicle_custom_circuits
 ADD COLUMN IF NOT EXISTS system_category text,
 ADD COLUMN IF NOT EXISTS from_endpoint_id uuid,
 ADD COLUMN IF NOT EXISTS to_endpoint_id uuid;
SELECT set_config('test.auth_uid','',false),set_config('test.auth_jwt','{}',false);

DO $fixture$
DECLARE v uuid:=md5('functional context vehicle')::uuid; o uuid:=md5('functional context overlay')::uuid;
 d uuid:=md5('functional context design')::uuid; net uuid:=md5('functional context net')::uuid;
 bus uuid:=md5('functional context controller')::uuid; device uuid:=md5('functional context device')::uuid;
 plug uuid:=md5('functional context connector')::uuid; r jsonb;
BEGIN
 INSERT INTO public.vehicles(id,is_public,user_id,year,make,model,license_plate) VALUES
  (v,true,NULL,2000,'Synthetic','Functional context','PRIVATE_FUNCTIONAL_PLATE'),
  (md5('functional foreign vehicle')::uuid,true,NULL,2001,'Synthetic','Foreign context',NULL),
  (md5('functional private vehicle')::uuid,false,md5('functional private owner')::uuid,2002,'Synthetic','Private context',NULL);
 INSERT INTO public.vehicle_wiring_overlays(id,vehicle_id) VALUES(o,v),
  (md5('functional foreign overlay')::uuid,md5('functional foreign vehicle')::uuid),
  (md5('functional private overlay')::uuid,md5('functional private vehicle')::uuid);
 INSERT INTO public.harness_designs(id,vehicle_id) VALUES(d,v),
  (md5('functional foreign design')::uuid,md5('functional foreign vehicle')::uuid);
 INSERT INTO public.harness_endpoints(id,design_id,code,name,endpoint_type,node_kind,notes) VALUES
  (bus,d,'FC-CONTROLLER','Synthetic controller','ecu','terminals','PRIVATE_FUNCTIONAL_ENDPOINT'),
  (device,d,'FC-DEVICE','Synthetic thermal device','sensor','terminals',NULL),
  (plug,d,'FC-CONNECTOR','Synthetic connector','connector','terminals',NULL),
  (md5('functional foreign endpoint')::uuid,md5('functional foreign design')::uuid,
   'FOREIGN-ENDPOINT','FOREIGN_FUNCTIONAL_DETAIL','sensor','terminals',NULL);
 INSERT INTO public.catalog_parts(id,part_number) VALUES(md5('functional wire part')::uuid,'M22759/32-20-2');
 INSERT INTO public.harness_nets(id,vehicle_id,net_code,source,method,observed_at,trust)
  VALUES(net,v,'FC-NET','synthetic fixture','synthetic fixture',now(),'T3');
 INSERT INTO public.vehicle_custom_circuits(id,overlay_id,circuit_code,circuit_name,design_status,build_state,
  wire_type,wire_gauge_awg,wire_color,harness_section,system_category,from_endpoint_id,to_endpoint_id,source,checks)
 SELECT md5('functional circuit '||i)::uuid,o,'FC-'||lpad(i::text,2,'0'),'Synthetic circuit '||i,
  'decided','uncut','M22759/32',20,'red',CASE WHEN i<=18 THEN 'engine' ELSE 'dash_cabin' END,
  CASE WHEN i<=18 THEN 'Recorded thermal system' ELSE 'Recorded cabin system' END,
  bus,CASE WHEN i<=10 THEN device ELSE plug END,'PRIVATE_FUNCTIONAL_CIRCUIT',
  '{"PRIVATE_FUNCTIONAL_LEGACY_CHECK":"not a current engineering verdict"}'::jsonb
 FROM generate_series(1,22) i;
 -- Same wire code on another vehicle must never enrich or qualify this vehicle's circuit.
 INSERT INTO public.vehicle_custom_circuits(id,overlay_id,circuit_code,circuit_name,design_status,build_state,
  system_category,from_endpoint_id,to_endpoint_id) VALUES
  (md5('functional foreign circuit')::uuid,md5('functional foreign overlay')::uuid,'FC-01','Foreign circuit','decided','uncut',
   'FOREIGN_FUNCTIONAL_CATEGORY',md5('functional foreign endpoint')::uuid,md5('functional foreign endpoint')::uuid),
  (md5('functional private circuit')::uuid,md5('functional private overlay')::uuid,'PRIVATE-FC','Private circuit','decided','uncut',
   'PRIVATE_FUNCTIONAL_CATEGORY',NULL,NULL);
 INSERT INTO public.wire_termination_specs(id,vehicle_id,circuit_id,endpoint_id,cavity)
 SELECT md5('functional end '||i||side)::uuid,v,md5('functional circuit '||i)::uuid,
  CASE WHEN side='from' THEN bus WHEN i<=10 THEN device ELSE plug END,'P'||i
 FROM generate_series(1,20) i CROSS JOIN (VALUES('from'),('to')) s(side);
 INSERT INTO public.harness_segments(id,vehicle_id,vehicle_custom_circuit_id,net_id,from_termination_id,to_termination_id,
  wire_part_id,gauge_awg,colour,planned_length_ft,planned_length_method,build_state,design_status,source,method,observed_at,trust)
 SELECT md5('functional piece '||i)::uuid,v,md5('functional circuit '||i)::uuid,net,
  md5('functional end '||i||'from')::uuid,md5('functional end '||i||'to')::uuid,md5('functional wire part')::uuid,
  20,'red',1,'synthetic plan','uncut','decided','synthetic fixture','synthetic fixture',now(),'T3'
 FROM generate_series(1,20) i;
 r:=public.harness_model_fold(v);
 IF r->>'status' IS DISTINCT FROM 'current' THEN RAISE EXCEPTION 'Synthetic baseline fold failed: %',r; END IF;
END $fixture$;

CREATE TEMP TABLE functional_context_baseline AS
SELECT s.latest_evaluation_id AS old_evaluation_id,
 (SELECT h.id FROM public.harness_model_sheets h WHERE h.evaluation_id=s.latest_evaluation_id ORDER BY h.sort_key LIMIT 1) AS old_sheet_id,
 public.harness_model_inputs(s.vehicle_id) AS input,
 public.harness_model_compute(public.harness_model_inputs(s.vehicle_id)) AS electrical
FROM public.harness_model_state s WHERE s.vehicle_id=md5('functional context vehicle')::uuid;
GRANT SELECT ON functional_context_baseline TO anon,authenticated;

\i supabase/migrations/20261126052721_harness_manual_context_references.sql

-- 1. Additive source context, unchanged electrical computation and complete selected population.
DO $$
DECLARE v uuid:=md5('functional context vehicle')::uuid; inp jsonb; r jsonb; old jsonb; k text;
BEGIN
 inp:=public.harness_model_inputs(v);
 SELECT input INTO old FROM functional_context_baseline;
 IF jsonb_array_length(inp#>'{model,circuits}')<>22 OR jsonb_array_length(inp#>'{model,segments}')<>20
  OR (SELECT jsonb_agg(x->>'id' ORDER BY x->>'id') FROM jsonb_array_elements(inp#>'{model,circuits}') x)
   IS DISTINCT FROM (SELECT jsonb_agg(x->>'id' ORDER BY x->>'id') FROM jsonb_array_elements(old#>'{model,circuits}') x)
 THEN RAISE EXCEPTION 'Context enrichment dropped or multiplied selected/unmodeled circuits'; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(inp#>'{model,circuits}') x
  JOIN public.vehicle_custom_circuits c ON c.id=(x->>'id')::uuid
  WHERE x->>'system_category' IS DISTINCT FROM c.system_category
   OR x->>'from_endpoint_id' IS DISTINCT FROM c.from_endpoint_id::text
   OR x->>'to_endpoint_id' IS DISTINCT FROM c.to_endpoint_id::text)
 THEN RAISE EXCEPTION 'Context did not preserve the exact stored source fields'; END IF;
 IF (SELECT jsonb_agg(x-'system_category'-'from_endpoint_id'-'to_endpoint_id' ORDER BY x->>'id')
   FROM jsonb_array_elements(inp#>'{model,circuits}') x)
  IS DISTINCT FROM (SELECT jsonb_agg(x ORDER BY x->>'id') FROM jsonb_array_elements(old#>'{model,circuits}') x)
 THEN RAISE EXCEPTION 'Circuit enrichment changed fields outside its allowlist'; END IF;
 FOREACH k IN ARRAY ARRAY['nodes','segment_ends','wire_requirements','checks'] LOOP
  IF public.harness_model_compute(inp)->k IS DISTINCT FROM (SELECT electrical->k FROM functional_context_baseline)
  THEN RAISE EXCEPTION 'Presentation metadata changed electrical output %',k; END IF;
 END LOOP;
 IF inp::text LIKE '%PRIVATE_FUNCTIONAL%' OR inp::text LIKE '%FOREIGN_FUNCTIONAL%'
 THEN RAISE EXCEPTION 'Input allowlist admitted private prose or another vehicle context'; END IF;
 IF public.harness_model_logic_snapshot()#>>'{functions,harness_model_inputs(uuid)}' IS DISTINCT FROM
  pg_get_functiondef('public.harness_model_inputs(uuid)'::regprocedure)
 THEN RAISE EXCEPTION 'Input enrichment is not bound to the existing logic receipt'; END IF;
 IF EXISTS(SELECT FROM pg_proc WHERE oid IN('public.harness_model_inputs(uuid)'::regprocedure,
  'public.harness_manual_index(uuid,text,integer,text,uuid)'::regprocedure,'public.harness_manual_sheet(uuid,uuid,uuid)'::regprocedure)
  AND (prosecdef OR provolatile<>'s'))
 THEN RAISE EXCEPTION 'Public context reader lost its stable invoker boundary'; END IF;
 r:=public.harness_manual_index(v);
 IF r->>'status' IS DISTINCT FROM 'pending' OR r->'evaluation' IS DISTINCT FROM 'null'::jsonb
 THEN RAISE EXCEPTION 'New input/compute/index logic reused an old evaluation'; END IF;
 r:=public.harness_model_fold(v);
 IF r->>'status' IS DISTINCT FROM 'current' OR (r->>'evaluation_id')::uuid=(SELECT old_evaluation_id FROM functional_context_baseline)
 THEN RAISE EXCEPTION 'Normal fold failed to publish new context logic: %',r; END IF;
END $$;

-- 2. Exact public population, private prose exclusion, unmodeled pagination and title search.
SET ROLE anon;
DO $$
DECLARE v uuid:=md5('functional context vehicle')::uuid; r jsonb; p jsonb; h jsonb; eid uuid;
 after_ text; unmodeled_after_ uuid; ids uuid[]:='{}'; expected uuid[]; seen uuid[]:='{}';
 pieces integer:=0; pages integer:=0;
BEGIN
 r:=public.harness_manual_index(v);
 eid:=(r#>>'{evaluation,id}')::uuid;
 IF r->>'status' IS DISTINCT FROM 'current' OR jsonb_array_length(r->'circuits_without_pieces')<>2
  OR r::text LIKE '%PRIVATE_FUNCTIONAL%' OR r::text LIKE '%FOREIGN_FUNCTIONAL%'
 THEN RAISE EXCEPTION 'Public context index lost source scope/qualification'; END IF;
 FOR h IN SELECT x FROM jsonb_array_elements(r->'sheets') x LOOP
  p:=public.harness_manual_sheet(v,eid,(h->>'id')::uuid);
  IF p->>'status' IS DISTINCT FROM 'current' OR jsonb_array_length(p#>'{model,segments}')<>(h->>'piece_count')::integer
   OR jsonb_array_length(p#>'{model,segments}')>8 OR p::text LIKE '%PRIVATE_FUNCTIONAL%' OR p::text LIKE '%FOREIGN_FUNCTIONAL%'
  THEN RAISE EXCEPTION 'Bounded public sheet lost exact pieces or excluded source privacy'; END IF;
  IF NOT EXISTS(SELECT FROM jsonb_array_elements(p#>'{model,model_checks}') x
   WHERE x->>'rule_key'='engineering_coverage' AND x->>'result'='hold')
  THEN RAISE EXCEPTION 'Functional grouping implied electrical engineering release'; END IF;
  FOR ids IN SELECT array_agg((x->>'id')::uuid) FROM jsonb_array_elements(p#>'{model,segments}') x LOOP
   IF seen && ids THEN RAISE EXCEPTION 'Piece appeared on multiple functional pages'; END IF;
   seen:=seen||ids;
  END LOOP;
  pieces:=pieces+(h->>'piece_count')::integer;
 END LOOP;
 IF pieces<>20 OR cardinality(seen)<>20 THEN RAISE EXCEPTION 'Functional pages lost actual source population'; END IF;
 seen:='{}';
 LOOP
  p:=public.harness_manual_index(v,NULL,1,NULL,unmodeled_after_);
  IF p->>'status' IS DISTINCT FROM 'current' OR jsonb_array_length(p->'circuits_without_pieces')<>1
  THEN RAISE EXCEPTION 'Unmodeled circuit page lost its independent bounded source population'; END IF;
  ids:=ARRAY[(p#>>'{circuits_without_pieces,0,id}')::uuid];
  IF seen && ids THEN RAISE EXCEPTION 'Unmodeled cursor repeated a source row'; END IF;
  seen:=seen||ids;
  EXIT WHEN p->>'unmodeled_next_after' IS NULL;
  unmodeled_after_:=(p->>'unmodeled_next_after')::uuid;
  IF cardinality(seen)>2 THEN RAISE EXCEPTION 'Unmodeled cursor did not terminate'; END IF;
 END LOOP;
 IF cardinality(seen)<>2 OR NOT seen @> ARRAY[md5('functional circuit 21')::uuid,md5('functional circuit 22')::uuid]
 THEN RAISE EXCEPTION 'Missing-piece circuits were silently omitted or treated as zero demand'; END IF;
 -- The query is present only in the principal page title, not in circuit codes/names.
 r:=public.harness_manual_index(v,NULL,25,'Synthetic thermal device');
 SELECT array_agg((x->>'id')::uuid ORDER BY x->>'sort_key') INTO expected FROM jsonb_array_elements(r->'sheets') x;
 IF cardinality(expected) IS DISTINCT FROM 2 OR r->>'next_after' IS NOT NULL
 THEN RAISE EXCEPTION 'Device title search omitted a later part'; END IF;
 seen:='{}';
 LOOP
  p:=public.harness_manual_index(v,after_,1,'Synthetic thermal device');
  IF p->>'status' IS DISTINCT FROM 'current' OR jsonb_array_length(p->'sheets')<>1
  THEN RAISE EXCEPTION 'Title-search keyset page was missing or unbounded'; END IF;
  seen:=array_append(seen,(p#>>'{sheets,0,id}')::uuid); pages:=pages+1;
  EXIT WHEN p->>'next_after' IS NULL;
  after_:=p->>'next_after';
  IF pages>2 THEN RAISE EXCEPTION 'Title-search next cursor did not reach EOF'; END IF;
 END LOOP;
 IF seen IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Title-search filter and cursor predicate disagree'; END IF;
 r:=public.harness_manual_index(v,NULL,25,'FC-01');
 IF jsonb_array_length(r->'sheets')<>1 OR r->>'next_after' IS NOT NULL
  OR NOT EXISTS(SELECT FROM jsonb_array_elements(r#>'{sheets,0,circuits}') x WHERE x->>'code'='FC-01')
 THEN RAISE EXCEPTION 'Exact circuit-code priority was broadened by title search'; END IF;
END $$;
RESET ROLE;

-- 3. Each newly admitted source field advances the existing epoch and changes input identity.
-- Declared circuit endpoints remain presentation claims, never replacement physical wire ends.
DO $$
DECLARE v uuid:=md5('functional context vehicle')::uuid; cid uuid:=md5('functional circuit 11')::uuid;
 field_ text; before_hash text; before_epoch bigint; eid uuid; sid uuid; r jsonb; inp jsonb; k text;
BEGIN
 FOREACH field_ IN ARRAY ARRAY['system_category','from_endpoint_id','to_endpoint_id'] LOOP
  before_hash:=md5(public.harness_model_inputs(v)::text);
  SELECT source_epoch,latest_evaluation_id INTO before_epoch,eid FROM public.harness_model_state WHERE vehicle_id=v;
  SELECT id INTO sid FROM public.harness_model_sheets WHERE evaluation_id=eid ORDER BY sort_key LIMIT 1;
  CASE field_
   WHEN 'system_category' THEN UPDATE public.vehicle_custom_circuits SET system_category='Recorded alternate system' WHERE id=cid;
   WHEN 'from_endpoint_id' THEN UPDATE public.vehicle_custom_circuits SET from_endpoint_id=md5('functional foreign endpoint')::uuid WHERE id=cid;
   WHEN 'to_endpoint_id' THEN UPDATE public.vehicle_custom_circuits SET to_endpoint_id=NULL WHERE id=cid;
  END CASE;
  inp:=public.harness_model_inputs(v);
  IF md5(inp::text)=before_hash OR NOT EXISTS(SELECT FROM public.harness_model_state
   WHERE vehicle_id=v AND source_epoch>before_epoch AND source_epoch IS DISTINCT FROM folded_epoch)
  THEN RAISE EXCEPTION 'Source % did not invalidate hash and source epoch',field_; END IF;
  r:=public.harness_manual_sheet(v,eid,sid);
  IF r->>'status' IS DISTINCT FROM 'pending' OR r->'model' IS DISTINCT FROM 'null'::jsonb
   OR r#>'{sheet,previous_sheet}' IS NOT NULL OR r#>'{sheet,next_sheet}' IS NOT NULL
  THEN RAISE EXCEPTION 'Source % left stale sheet/navigation published',field_; END IF;
  FOREACH k IN ARRAY ARRAY['nodes','segment_ends','wire_requirements','checks'] LOOP
   IF public.harness_model_compute(inp)->k IS DISTINCT FROM (SELECT electrical->k FROM functional_context_baseline)
   THEN RAISE EXCEPTION 'Declared source % changed electrical output %',field_,k; END IF;
  END LOOP;
  IF inp::text LIKE '%FOREIGN_FUNCTIONAL_DETAIL%' OR inp::text LIKE '%FOREIGN_FUNCTIONAL_CATEGORY%'
  THEN RAISE EXCEPTION 'Declared endpoint UUID pulled another vehicle content'; END IF;
  -- Exercise the existing scheduled fold path, not a new test-only output writer.
  CALL public.model_fold_tick();
  r:=public.harness_manual_index(v);
  IF r->>'status' IS DISTINCT FROM 'current' OR (r#>>'{evaluation,id}')::uuid=eid
  THEN RAISE EXCEPTION 'Existing fold did not recover source %: %',field_,r->>'status'; END IF;
  r:=public.harness_manual_sheet(v,eid,sid);
  IF r->>'status' IS DISTINCT FROM 'pending' OR r->'model' IS DISTINCT FROM 'null'::jsonb
  THEN RAISE EXCEPTION 'Old evaluation silently retargeted after source % refold',field_; END IF;
 END LOOP;
 -- A no-op writes no new generation; source updates cannot churn the consumer.
 SELECT source_epoch INTO before_epoch FROM public.harness_model_state WHERE vehicle_id=v;
 UPDATE public.vehicle_custom_circuits SET system_category=system_category,from_endpoint_id=from_endpoint_id,to_endpoint_id=to_endpoint_id WHERE id=cid;
 IF (SELECT source_epoch FROM public.harness_model_state WHERE vehicle_id=v)<>before_epoch
 THEN RAISE EXCEPTION 'No-op context update advanced the epoch'; END IF;
END $$;

-- 4. Adjacent sheet references are exact addresses in the same evaluation and section.
SET ROLE anon;
DO $$
DECLARE v uuid:=md5('functional context vehicle')::uuid; eid uuid; h record; r jsonb; previous_ jsonb; next_ jsonb;
 n integer:=0; starts integer:=0; finishes integer:=0;
BEGIN
 eid:=(public.harness_manual_index(v)#>>'{evaluation,id}')::uuid;
 FOR h IN SELECT * FROM public.harness_model_sheets WHERE evaluation_id=eid ORDER BY sort_key LOOP
  SELECT jsonb_build_object('id',a.id,'title',a.title) INTO previous_ FROM public.harness_model_sheets a
   WHERE a.evaluation_id=eid AND a.section IS NOT DISTINCT FROM h.section AND a.ordinal=h.ordinal-1;
  SELECT jsonb_build_object('id',a.id,'title',a.title) INTO next_ FROM public.harness_model_sheets a
   WHERE a.evaluation_id=eid AND a.section IS NOT DISTINCT FROM h.section AND a.ordinal=h.ordinal+1;
  r:=public.harness_manual_sheet(v,eid,h.id);
  IF r->>'status' IS DISTINCT FROM 'current'
   OR NOT (r->'sheet' ?& ARRAY['previous_sheet','next_sheet'])
   OR r#>'{sheet,previous_sheet}' IS DISTINCT FROM coalesce(previous_,'null'::jsonb)
   OR r#>'{sheet,next_sheet}' IS DISTINCT FROM coalesce(next_,'null'::jsonb)
  THEN RAISE EXCEPTION 'Wrong evaluation/section/ordinal navigation for sheet %: %',h.id,r->'sheet'; END IF;
  IF previous_ IS NULL THEN starts:=starts+1; END IF;
  IF next_ IS NULL THEN finishes:=finishes+1; END IF;
  n:=n+1;
 END LOOP;
 IF n<4 OR starts<>2 OR finishes<>2 THEN RAISE EXCEPTION 'Fixture did not exercise multiple sheets and section boundaries'; END IF;
 r:=public.harness_manual_sheet(v,(SELECT old_evaluation_id FROM functional_context_baseline),
  (SELECT old_sheet_id FROM functional_context_baseline));
 IF r->>'status' IS DISTINCT FROM 'pending' OR r->'model' IS DISTINCT FROM 'null'::jsonb OR r->'sheet' IS DISTINCT FROM 'null'::jsonb
 THEN RAISE EXCEPTION 'Old evaluation returned navigation or a retargeted sheet'; END IF;
 r:=public.harness_manual_sheet(md5('functional foreign vehicle')::uuid,eid,h.id);
 IF r->'model' IS DISTINCT FROM 'null'::jsonb OR r->'sheet' IS DISTINCT FROM 'null'::jsonb OR r->>'status'='current'
 THEN RAISE EXCEPTION 'Sheet/navigation crossed vehicle scope'; END IF;
 r:=public.harness_manual_sheet(v,eid,md5('functional nonexistent sheet')::uuid);
 IF r->>'status' IS DISTINCT FROM 'unavailable' OR r->'sheet' IS DISTINCT FROM 'null'::jsonb
 THEN RAISE EXCEPTION 'Missing sheet exposed adjacent addresses'; END IF;
END $$;
RESET ROLE;

-- 5. Public visibility and authenticated-anonymous owner claims remain fail closed.
SET ROLE anon;
DO $$ BEGIN
 IF public.harness_model_inputs(md5('functional private vehicle')::uuid) IS NOT NULL
  OR public.harness_manual_index(md5('functional private vehicle')::uuid)->>'status' IS DISTINCT FROM 'unavailable'
 THEN RAISE EXCEPTION 'Public context reader exposed a private vehicle'; END IF;
END $$;
RESET ROLE;
SELECT set_config('test.auth_uid',md5('functional private owner')::uuid::text,false),
 set_config('test.auth_jwt','{"is_anonymous":true}',false);
SET ROLE authenticated;
DO $$ BEGIN
 IF public.harness_model_inputs(md5('functional private vehicle')::uuid) IS NOT NULL
 THEN RAISE EXCEPTION 'Anonymous auth owner claim bypassed context visibility'; END IF;
END $$;
RESET ROLE;
SELECT set_config('test.auth_jwt','{"is_anonymous":false}',false);
SET ROLE authenticated;
DO $$
DECLARE inp jsonb;
BEGIN
 inp:=public.harness_model_inputs(md5('functional private vehicle')::uuid);
 IF jsonb_array_length(inp#>'{model,circuits}') IS DISTINCT FROM 1
  OR inp#>>'{model,circuits,0,system_category}' IS DISTINCT FROM 'PRIVATE_FUNCTIONAL_CATEGORY'
 THEN RAISE EXCEPTION 'Qualified owner lost their exact private source context'; END IF;
END $$;
RESET ROLE;
SELECT set_config('test.auth_uid','',false),set_config('test.auth_jwt','{}',false);

-- 6. An upstream source row without an eligible enrichment match stays in the selection.
-- Deliberately inject foreign/missing IDs into a disposable upstream projection to exercise
-- the join boundary independently of the current upstream reader's own vehicle filtering.
-- Its exact definition is restored before any fold or normal reader assertion.
DO $$
DECLARE v uuid:=md5('functional context vehicle')::uuid; raw jsonb; inp jsonb; x jsonb;
 original text:=pg_get_functiondef('public.harness_schematic_model(uuid)'::regprocedure);
BEGIN
 raw:=public.harness_schematic_model(v);
 raw:=jsonb_set(raw,'{circuits}',(raw->'circuits')||jsonb_build_array(
  jsonb_build_object('id',md5('functional foreign circuit')::uuid,'code','FOREIGN-PROJECTION','design_status','decided',
   'system_category','UNQUALIFIED_RAW_CONTEXT','from_endpoint_id',md5('functional foreign endpoint')::uuid,'private_notes','PRIVATE_FUNCTIONAL_RAW'),
  jsonb_build_object('id',md5('functional missing circuit')::uuid,'code','MISSING-PROJECTION','design_status','decided',
   'system_category','UNQUALIFIED_RAW_CONTEXT','to_endpoint_id',md5('functional foreign endpoint')::uuid)));
 EXECUTE format('CREATE OR REPLACE FUNCTION public.harness_schematic_model(p_vehicle_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS %L',
  'SELECT '||quote_literal(raw::text)||'::jsonb WHERE p_vehicle_id='||quote_literal(v::text)||'::uuid');
 inp:=public.harness_model_inputs(v);
 IF jsonb_array_length(inp#>'{model,circuits}')<>24 THEN RAISE EXCEPTION 'LEFT enrichment became a population-filtering join'; END IF;
 FOR x IN SELECT a FROM jsonb_array_elements(inp#>'{model,circuits}') a
  WHERE a->>'code' IN('FOREIGN-PROJECTION','MISSING-PROJECTION') LOOP
  IF NOT (x ?& ARRAY['system_category','from_endpoint_id','to_endpoint_id'])
   OR x->>'system_category' IS NOT NULL OR x->>'from_endpoint_id' IS NOT NULL OR x->>'to_endpoint_id' IS NOT NULL
  THEN RAISE EXCEPTION 'Missing/foreign enrichment retained unqualified context: %',x; END IF;
 END LOOP;
 IF inp::text LIKE '%PRIVATE_FUNCTIONAL%' OR inp::text LIKE '%UNQUALIFIED_RAW_CONTEXT%' OR inp::text LIKE '%FOREIGN_FUNCTIONAL%'
 THEN RAISE EXCEPTION 'Allowlist/join admitted unrelated or unqualified raw fields'; END IF;
 EXECUTE original;
END $$;

-- 7. Source-RLS denial cannot be replaced by a definer enrichment or partial current receipt.
-- Restrict only this disposable circuit fixture; restore the original no-RLS fixture state.
ALTER TABLE public.vehicle_custom_circuits ENABLE ROW LEVEL SECURITY;
CREATE POLICY functional_context_deny_one ON public.vehicle_custom_circuits FOR SELECT USING
 (id<>md5('functional circuit 22')::uuid);
SET ROLE anon;
DO $$
DECLARE v uuid:=md5('functional context vehicle')::uuid; inp jsonb; r jsonb;
BEGIN
 inp:=public.harness_model_inputs(v);
 IF jsonb_array_length(inp#>'{model,circuits}')<>21 OR EXISTS(SELECT FROM jsonb_array_elements(inp#>'{model,circuits}') x
  WHERE x->>'id'=md5('functional circuit 22')::uuid::text)
 THEN RAISE EXCEPTION 'Enrichment bypassed source circuit RLS'; END IF;
 r:=public.harness_manual_index(v);
 IF r->>'status'='current' OR r->'evaluation' IS DISTINCT FROM 'null'::jsonb OR jsonb_array_length(r->'sheets')<>0
 THEN RAISE EXCEPTION 'Partial source visibility was presented as a current complete manual'; END IF;
END $$;
RESET ROLE;
DROP POLICY functional_context_deny_one ON public.vehicle_custom_circuits;
ALTER TABLE public.vehicle_custom_circuits DISABLE ROW LEVEL SECURITY;
SET ROLE anon;
DO $$ BEGIN
 IF public.harness_manual_index(md5('functional context vehicle')::uuid)->>'status' IS DISTINCT FROM 'current'
 THEN RAISE EXCEPTION 'Restoring source visibility did not restore the unchanged current receipt'; END IF;
END $$;
RESET ROLE;
-- 8. The page overload reports every evaluated origin, including origins with no targets.
DO $$ BEGIN
 IF public.harness_model_logic_snapshot()->>'harness_manual_sheet(uuid,uuid,uuid,text,integer)'
  IS DISTINCT FROM pg_get_functiondef('public.harness_manual_sheet(uuid,uuid,uuid,text,integer)'::regprocedure)
 THEN RAISE EXCEPTION 'Reference overload is not bound to the existing logic receipt'; END IF;
 IF EXISTS(SELECT FROM pg_proc WHERE oid='public.harness_manual_sheet(uuid,uuid,uuid,text,integer)'::regprocedure
  AND (prosecdef OR provolatile<>'s' OR pronargdefaults<>0))
 THEN RAISE EXCEPTION 'Reference overload weakened invoker/snapshot or three-argument dispatch'; END IF;
END $$;
SET ROLE anon;
DO $$
DECLARE v uuid:=md5('functional context vehicle')::uuid; eid uuid; sid uuid; r jsonb; expected jsonb;
BEGIN
 eid:=(public.harness_manual_index(v)#>>'{evaluation,id}')::uuid;
 SELECT id INTO sid FROM public.harness_model_sheets WHERE evaluation_id=eid AND piece_count=8 ORDER BY sort_key LIMIT 1;
 SELECT jsonb_agg(jsonb_build_object('segment_id',a.segment_id,'side',a.side,
  'termination_id',a.termination_id,'node_id',a.node_id) ORDER BY a.segment_id,a.side) INTO expected
 FROM public.harness_model_segment_ends a JOIN public.harness_model_sheet_members m USING(evaluation_id,segment_id)
 WHERE m.evaluation_id=eid AND m.sheet_id=sid;
 r:=public.harness_manual_sheet(v,eid,sid,NULL,50);
 IF sid IS NULL OR jsonb_array_length(expected)<>16 OR r->>'status' IS DISTINCT FROM 'current'
  OR r->'origins' IS DISTINCT FROM expected OR r->'references' IS DISTINCT FROM '[]'::jsonb OR r->>'next_after' IS NOT NULL
 THEN RAISE EXCEPTION 'Empty-reference origins were lost, fabricated or not complete: %',r; END IF;
END $$;
RESET ROLE;

-- A synthetic shared bus plus two explicitly reciprocal connector halves gives both
-- reference kinds, off-sheet destinations and more than50 total rows on an eight-piece sheet.
UPDATE public.harness_endpoints SET node_kind='bus' WHERE id=md5('functional context controller')::uuid;
UPDATE public.harness_endpoints SET endpoint_type='connector',mates_with_endpoint_id=md5('functional context connector')::uuid
 WHERE id=md5('functional context device')::uuid;
UPDATE public.harness_endpoints SET mates_with_endpoint_id=md5('functional context device')::uuid
 WHERE id=md5('functional context connector')::uuid;
DO $$
DECLARE r jsonb;
BEGIN
 r:=public.harness_model_fold(md5('functional context vehicle')::uuid);
 IF r->>'status' IS DISTINCT FROM 'current' THEN RAISE EXCEPTION 'Reference fixture fold failed: %',r; END IF;
END $$;
CREATE TEMP TABLE functional_reference_address AS
SELECT s.latest_evaluation_id AS evaluation_id,h.id AS sheet_id,
 (SELECT other.id FROM public.harness_model_sheets other WHERE other.evaluation_id=h.evaluation_id
   AND other.id<>h.id ORDER BY other.sort_key LIMIT 1) AS other_sheet_id
FROM public.harness_model_state s JOIN public.harness_model_sheets h ON h.evaluation_id=s.latest_evaluation_id
WHERE s.vehicle_id=md5('functional context vehicle')::uuid AND h.piece_count=8 ORDER BY h.sort_key LIMIT 1;
GRANT SELECT ON functional_reference_address TO anon,authenticated;

-- 9. Follow the total-row cursor to EOF and compare every address/label with the legacy per-end union.
SET ROLE anon;
DO $$
DECLARE v uuid:=md5('functional context vehicle')::uuid; eid uuid; sid uuid; r jsonb; legacy jsonb;
 expected_origins jsonb; actual jsonb:='[]'; expected jsonb:='[]'; origin_ jsonb; dest jsonb; ref jsonb;
 after_ text; legacy_after text; kind_ text; last_key text; n integer:=0; limit_ integer:=100000;
BEGIN
 SELECT evaluation_id,sheet_id INTO eid,sid FROM functional_reference_address;
 SELECT jsonb_agg(jsonb_build_object('segment_id',a.segment_id,'side',a.side,
  'termination_id',a.termination_id,'node_id',a.node_id) ORDER BY a.segment_id,a.side) INTO expected_origins
 FROM public.harness_model_segment_ends a JOIN public.harness_model_sheet_members m USING(evaluation_id,segment_id)
 WHERE m.evaluation_id=eid AND m.sheet_id=sid;
 LOOP
  r:=public.harness_manual_sheet(v,eid,sid,after_,limit_);
  IF r->>'status' IS DISTINCT FROM 'current' OR r->>'vehicle_id' IS DISTINCT FROM v::text
   OR r->>'evaluation_id' IS DISTINCT FROM eid::text OR r->>'sheet_id' IS DISTINCT FROM sid::text
   OR r->>'origin_scope' IS DISTINCT FROM 'bounded_manual_sheet' OR r->'origins' IS DISTINCT FROM expected_origins
   OR jsonb_array_length(r->'origins')<>16 OR jsonb_array_length(r->'references')>least(limit_,50)
  THEN RAISE EXCEPTION 'Reference page scope/origins/total bound changed: %',r; END IF;
  IF n=0 AND (jsonb_array_length(r->'references')<>50 OR r->>'next_after' IS NULL)
  THEN RAISE EXCEPTION 'Fixture did not exercise total-row cap and a continuation page'; END IF;
  FOR ref IN SELECT x FROM jsonb_array_elements(r->'references') x LOOP
   IF (last_key IS NOT NULL AND (ref->>'sort_key') COLLATE "C"<=last_key COLLATE "C")
    OR ref->>'contact_mapping_qualified' IS DISTINCT FROM 'false'
    OR NOT expected_origins @> jsonb_build_array(ref->'origin')
    OR (ref->>'kind'='node' AND (ref->>'relation' IS DISTINCT FROM 'same_evaluated_electrical_node'
     OR ref#>>'{origin,node_id}' IS DISTINCT FROM ref#>>'{destination,node_id}'))
    OR (ref->>'kind'='mate' AND ref->>'relation' IS DISTINCT FROM 'recorded_connector_mate_same_declared_net')
    OR ref->>'kind' NOT IN('node','mate')
   THEN RAISE EXCEPTION 'Reference duplicated, changed relation or overstated contact qualification: %',ref; END IF;
   last_key:=ref->>'sort_key';
  END LOOP;
  actual:=actual||(r->'references'); n:=n+1;
  EXIT WHEN r->>'next_after' IS NULL;
  IF r->>'next_after' IS DISTINCT FROM last_key OR n>50 THEN RAISE EXCEPTION 'Reference cursor did not advance exactly to the page tail'; END IF;
  after_:=r->>'next_after'; limit_:=17;
 END LOOP;
 IF n<2 OR NOT EXISTS(SELECT FROM jsonb_array_elements(actual) x WHERE x->>'kind'='node')
  OR NOT EXISTS(SELECT FROM jsonb_array_elements(actual) x WHERE x->>'kind'='mate')
  OR NOT EXISTS(SELECT FROM jsonb_array_elements(actual) x WHERE x#>>'{destination,sheet_id}'<>sid::text)
 THEN RAISE EXCEPTION 'Fixture missed shared nodes, mate context or off-sheet continuation'; END IF;
 FOR origin_ IN SELECT x FROM jsonb_array_elements(expected_origins) x LOOP
  FOREACH kind_ IN ARRAY ARRAY['node','mate'] LOOP
   legacy_after:=NULL;
   LOOP
    IF kind_='node' THEN
     legacy:=public.harness_manual_continuations(v,eid,(origin_->>'segment_id')::uuid,origin_->>'side',legacy_after,50);
    ELSE
     legacy:=public.harness_manual_mate_context(v,eid,(origin_->>'segment_id')::uuid,origin_->>'side',legacy_after,50);
    END IF;
    IF legacy->>'status' IS DISTINCT FROM 'current' THEN RAISE EXCEPTION 'Legacy oracle lost the same evaluated origin'; END IF;
    FOR dest IN SELECT x FROM jsonb_array_elements(legacy->'destinations') x LOOP
     expected:=expected||jsonb_build_array(jsonb_build_object('kind',kind_,'relation',legacy->>'relation',
      'contact_mapping_qualified',false,'origin',origin_,
      'destination',dest-'sort_key'-'endpoint_id'-'recorded_mating',
      'sort_key',(origin_->>'segment_id')||'/'||(origin_->>'side')||'/'||kind_||'/'||(dest->>'segment_id')||'/'||(dest->>'side')));
    END LOOP;
    EXIT WHEN legacy->>'next_after' IS NULL;
    IF legacy->>'next_after' IS NOT DISTINCT FROM legacy_after THEN RAISE EXCEPTION 'Legacy oracle cursor stalled'; END IF;
    legacy_after:=legacy->>'next_after';
   END LOOP;
  END LOOP;
 END LOOP;
 IF (SELECT jsonb_agg(x ORDER BY x::text) FROM jsonb_array_elements(actual) x)
  IS DISTINCT FROM (SELECT jsonb_agg(x ORDER BY x::text) FROM jsonb_array_elements(expected) x)
 THEN RAISE EXCEPTION 'Sheet page differs from exact legacy per-end node/mate union: actual %, expected %',
  jsonb_array_length(actual),jsonb_array_length(expected); END IF;
 IF (SELECT count(DISTINCT x->>'sort_key') FROM jsonb_array_elements(actual) x)<>jsonb_array_length(actual)
 THEN RAISE EXCEPTION 'Reciprocal mating witnesses duplicated a destination address'; END IF;
 -- A low requested bound constrains the whole union, not each origin or reference kind.
 r:=public.harness_manual_sheet(v,eid,sid,NULL,0);
 IF jsonb_array_length(r->'references')<>1 OR jsonb_array_length(r->'origins')<>16 OR r->>'next_after' IS NULL
 THEN RAISE EXCEPTION 'Reference lower-bound clamp or complete origin scope failed'; END IF;
END $$;
RESET ROLE;

-- 10. Wrong subjects and invisible source labels produce no partial printable payload/cursor.
SET ROLE anon;
DO $$
DECLARE v uuid:=md5('functional context vehicle')::uuid; eid uuid; sid uuid; r jsonb; request_ record;
BEGIN
 SELECT evaluation_id,sheet_id INTO eid,sid FROM functional_reference_address;
 FOR request_ IN SELECT * FROM (VALUES
  (v,(SELECT old_evaluation_id FROM functional_context_baseline),sid,'pending'),
  (v,eid,md5('functional nonexistent sheet')::uuid,'unavailable'),
  (md5('functional foreign vehicle')::uuid,eid,sid,'pending'),
  (md5('functional private vehicle')::uuid,eid,sid,'unavailable')) q(vehicle,evaluation,sheet,status)
 LOOP
  r:=public.harness_manual_sheet(request_.vehicle,request_.evaluation,request_.sheet,NULL,50);
  IF r->>'status' IS DISTINCT FROM request_.status OR r->'origins' IS DISTINCT FROM '[]'::jsonb
   OR r->'references' IS DISTINCT FROM '[]'::jsonb OR r->>'next_after' IS NOT NULL
  THEN RAISE EXCEPTION 'Wrong reference subject exposed a partial packet: %',r; END IF;
 END LOOP;
END $$;
RESET ROLE;

-- Real source RLS denial changes the source proof and/or derived receipt visibility.
-- Do not weaken derived-child policies merely to force the defensive labels-count branch.
ALTER TABLE public.harness_endpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY functional_reference_hide_label ON public.harness_endpoints FOR SELECT USING
 (id<>md5('functional context connector')::uuid);
SET ROLE anon;
DO $$
DECLARE r jsonb; eid uuid; sid uuid;
BEGIN
 SELECT evaluation_id,sheet_id INTO eid,sid FROM functional_reference_address;
 r:=public.harness_manual_sheet(md5('functional context vehicle')::uuid,eid,sid,NULL,50);
 IF r->>'status' NOT IN('pending','incomplete_visibility') OR r->'origins' IS DISTINCT FROM '[]'::jsonb
  OR r->'references' IS DISTINCT FROM '[]'::jsonb OR r->>'next_after' IS NOT NULL
 THEN RAISE EXCEPTION 'Hidden endpoint label left a partially printable reference page: %',r; END IF;
END $$;
RESET ROLE;
DROP POLICY functional_reference_hide_label ON public.harness_endpoints;
ALTER TABLE public.harness_endpoints DISABLE ROW LEVEL SECURITY;

-- Hidden destination sheet labels must fail receipt completeness rather than omit rows.
CREATE POLICY functional_reference_hide_sheet ON public.harness_model_sheets AS RESTRICTIVE FOR SELECT USING
 (id<>(SELECT h.other_sheet_id FROM functional_reference_address h));
SET ROLE anon;
DO $$
DECLARE r jsonb; eid uuid; sid uuid;
BEGIN
 SELECT evaluation_id,sheet_id INTO eid,sid FROM functional_reference_address;
 r:=public.harness_manual_sheet(md5('functional context vehicle')::uuid,eid,sid,NULL,50);
 IF r->>'status' IS DISTINCT FROM 'incomplete_visibility' OR r->'origins' IS DISTINCT FROM '[]'::jsonb
  OR r->'references' IS DISTINCT FROM '[]'::jsonb OR r->>'next_after' IS NOT NULL
 THEN RAISE EXCEPTION 'Hidden sheet labels were treated as pending or a partial current reference page: %',r; END IF;
END $$;
RESET ROLE;
DROP POLICY functional_reference_hide_sheet ON public.harness_model_sheets;
SET ROLE anon;
DO $$
DECLARE r jsonb; eid uuid; sid uuid;
BEGIN
 SELECT evaluation_id,sheet_id INTO eid,sid FROM functional_reference_address;
 r:=public.harness_manual_sheet(md5('functional context vehicle')::uuid,eid,sid,NULL,50);
 IF r->>'status' IS DISTINCT FROM 'current' OR jsonb_array_length(r->'references')<>50
 THEN RAISE EXCEPTION 'Restored reference visibility did not recover exact unchanged receipt'; END IF;
END $$;
RESET ROLE;
SELECT 'test_harness_manual_functional_context: PASS' AS result;

-- Oversized public cursors must short-circuit source construction, not merely
-- hide a completed expensive query. This fault exists only in the disposable DB.
DO $cursor_guard$
DECLARE original_inputs text; eid uuid; sid uuid; r jsonb;
BEGIN
 SELECT evaluation_id,sheet_id INTO eid,sid FROM functional_reference_address;
 original_inputs:=pg_get_functiondef('public.harness_model_inputs(uuid)'::regprocedure);
 EXECUTE $fault$CREATE OR REPLACE FUNCTION public.harness_model_inputs(p_vehicle_id uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $body$
 BEGIN RAISE EXCEPTION 'oversized cursor evaluated source builder'; END; $body$$fault$;
 r:=public.harness_manual_sheet(md5('functional context vehicle')::uuid,eid,sid,repeat('x',513),50);
 IF r->>'status' IS DISTINCT FROM 'unavailable' OR r->'references' IS DISTINCT FROM '[]'::jsonb
  OR r->'origins' IS DISTINCT FROM '[]'::jsonb OR r->>'next_after' IS NOT NULL
 THEN RAISE EXCEPTION 'Oversized cursor exposed a partial reference packet: %',r; END IF;
 EXECUTE original_inputs;
END $cursor_guard$;
SELECT 'test_harness_manual_context_references: PASS' AS result;

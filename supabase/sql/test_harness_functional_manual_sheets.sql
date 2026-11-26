-- Empty disposable PG17 only; exercise the existing source/fold/public-reader path.
\set ON_ERROR_STOP on
\i supabase/sql/test_harness_manual_sheets.sql
ALTER POLICY harness_model_sheet_members_read ON public.harness_model_sheet_members USING (
 EXISTS(SELECT FROM public.harness_model_sheets s WHERE s.evaluation_id=harness_model_sheet_members.evaluation_id AND s.id=harness_model_sheet_members.sheet_id)
 AND EXISTS(SELECT FROM public.harness_model_wire_requirements q WHERE q.evaluation_id=harness_model_sheet_members.evaluation_id AND q.segment_id=harness_model_sheet_members.segment_id));
CREATE TEMP TABLE before_functional AS SELECT latest_evaluation_id FROM public.harness_model_state
 WHERE vehicle_id='e08bf694-970f-4cbe-8a74-8715158a0f2e';
\i supabase/migrations/20261126041635_harness_functional_manual_sheets.sql

DO $$
DECLARE v uuid:='e08bf694-970f-4cbe-8a74-8715158a0f2e'; r jsonb; eid uuid;
BEGIN
 IF (public.harness_manual_cursor(v)->>'eligible_cursor')::boolean
 THEN RAISE EXCEPTION 'Partition code replacement left old evaluation eligible'; END IF;
 r:=public.harness_model_fold(v); eid:=(r->>'evaluation_id')::uuid;
 IF r->>'status'<>'current' OR eid=(SELECT latest_evaluation_id FROM before_functional)
 THEN RAISE EXCEPTION 'Functional partition did not produce a fresh atomic evaluation: %',r; END IF;
 IF EXISTS(SELECT FROM public.harness_model_sheets h WHERE h.evaluation_id=eid
  AND h.piece_count<>(SELECT count(*) FROM public.harness_model_sheet_members m WHERE m.evaluation_id=eid AND m.sheet_id=h.id))
 THEN RAISE EXCEPTION 'Functional sheet membership count mismatch'; END IF;
 -- A recorded component name is a presentation input. It is not a wire-code alias.
 UPDATE public.harness_endpoints SET name='functional component search witness',node_kind='terminals' WHERE code='CLT-ECU';
 r:=public.harness_manual_index(v);
 IF r->>'status'<>'pending' THEN RAISE EXCEPTION 'Recorded principal label edit left stale titles available'; END IF;
 r:=public.harness_model_fold(v);
 IF r->>'status'<>'current' THEN RAISE EXCEPTION 'Component title refold failed: %',r; END IF;
END $$;
SET ROLE anon;
DO $$
DECLARE v uuid:='e08bf694-970f-4cbe-8a74-8715158a0f2e'; r jsonb; h jsonb; first_ jsonb; after_ text;
BEGIN
 r:=public.harness_manual_index(v,NULL,25,'functional component search witness');
 IF r->>'status'<>'current' OR jsonb_array_length(r->'sheets')<>1
  OR NOT EXISTS(SELECT FROM jsonb_array_elements(r->'sheets'->0->'circuits') c WHERE c->>'code'='110')
 THEN RAISE EXCEPTION 'Recorded component-title search failed: %',r; END IF;
 first_:=r;
 r:=public.harness_manual_index(v,NULL,25,'110');
 IF jsonb_array_length(r->'sheets')<>1 OR r->'sheets'->0->>'id'<>first_->'sheets'->0->>'id'
 THEN RAISE EXCEPTION 'Exact wire lookup lost priority'; END IF;
 LOOP
  r:=public.harness_manual_index(v,after_,1,'ungrouped');
  FOR h IN SELECT x FROM jsonb_array_elements(r->'sheets') a(x) LOOP
   IF h->>'title' NOT LIKE '%Ungrouped circuits%' THEN RAISE EXCEPTION 'Title-search keyset included a nonmatching sheet'; END IF;
  END LOOP;
  EXIT WHEN r->>'next_after' IS NULL;
  IF after_ IS NOT NULL AND r->>'next_after'<=after_ THEN RAISE EXCEPTION 'Title-search cursor did not advance'; END IF;
  after_:=r->>'next_after';
 END LOOP;
 BEGIN
  PERFORM public.harness_manual_compute('{}','{}');
  RAISE EXCEPTION 'Pure producer helper became anonymous';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- Independent functional fixture: one ten-piece device, another device and
-- missing/ambiguous principals. All pieces/ends must survive exact-key grouping.
DO $$
DECLARE i jsonb; g jsonb; r jsonb; reversed_ jsonb; changed_ jsonb; part jsonb;
 cs jsonb:='[]'; ss jsonb:='[]'; ts jsonb:='[]'; es jsonb:='[]'; ends_ jsonb:='[]';
 c integer; n integer; k integer; cid uuid; sid uuid; tid uuid; eid uuid;
BEGIN
 es:=jsonb_build_array(
  jsonb_build_object('id',md5('device one')::uuid,'code','DEVICE-ONE','name','Device one','type','sensor','node_kind','terminals'),
  jsonb_build_object('id',md5('device two')::uuid,'code','DEVICE-TWO','name','Device two','type','actuator','node_kind','terminals'),
  jsonb_build_object('id',md5('controller')::uuid,'code','ECU','name','Controller','type','ecu','node_kind','terminals'));
 FOR c IN 1..6 LOOP
  cid:=md5('functional circuit '||c)::uuid;
  n:=CASE WHEN c IN(1,2) THEN 4 WHEN c=3 THEN 2 ELSE 1 END;
  cs:=cs||jsonb_build_array(jsonb_build_object('id',cid,'code','TEST-'||c,'section','engine','design_status','decided'));
  FOR k IN 1..n LOOP
   sid:=md5('functional piece '||c||'/'||k)::uuid; tid:=md5('functional from '||c||'/'||k)::uuid;
   eid:=CASE WHEN c IN(1,2,3,6) THEN md5('device one')::uuid WHEN c=4 THEN md5('device two')::uuid ELSE md5('controller')::uuid END;
   ts:=ts||jsonb_build_array(jsonb_build_object('id',tid,'circuit_id',cid,'endpoint_id',eid),
    jsonb_build_object('id',md5('functional to '||c||'/'||k)::uuid,'circuit_id',cid,
     'endpoint_id',CASE WHEN c=6 THEN md5('device two')::uuid ELSE md5('controller')::uuid END));
   ss:=ss||jsonb_build_array(jsonb_build_object('id',sid,'circuit_id',cid,'from_termination_id',tid,'to_termination_id',md5('functional to '||c||'/'||k)::uuid));
   ends_:=ends_||jsonb_build_array(jsonb_build_object('segment_id',sid,'side','from'));
  END LOOP;
 END LOOP;
 g:=jsonb_build_object('vehicle_id',md5('functional vehicle')::uuid,'circuits',cs,'segments',ss,'terminations',ts,'endpoints',es);
 i:=jsonb_build_object('model',g); r:=public.harness_manual_compute(i,jsonb_build_object('segment_ends',ends_));
 IF jsonb_array_length(r->'members')<>13 OR jsonb_array_length(r->'ends')<>13
  OR (SELECT count(DISTINCT x->>'segment_id') FROM jsonb_array_elements(r->'members') x)<>13
  OR EXISTS(SELECT FROM jsonb_array_elements(r->'sheets') x WHERE (x->>'piece_count')::int NOT BETWEEN 1 AND 8)
 THEN RAISE EXCEPTION 'Partition dropped/duplicated pieces or exceeded bound'; END IF;
 IF (SELECT array_agg((x->>'piece_count')::int ORDER BY x->>'sort_key') FROM jsonb_array_elements(r->'sheets') x WHERE x->>'title' LIKE '%[DEVICE-ONE]%')<>ARRAY[8,2]
  OR (SELECT count(*) FROM jsonb_array_elements(r->'sheets') x WHERE x->>'title' LIKE '%Ungrouped circuits%')<>1
 THEN RAISE EXCEPTION 'Related functional pages or ambiguity fallback wrong: %',r->'sheets'; END IF;
 IF (SELECT count(DISTINCT x->>'title') FROM jsonb_array_elements(r->'sheets') x)<>jsonb_array_length(r->'sheets')
 THEN RAISE EXCEPTION 'Printed sheet addresses collide'; END IF;
 reversed_:=g;
 FOR part IN SELECT to_jsonb(field_name) FROM unnest(ARRAY['circuits','segments','terminations','endpoints']) fields(field_name) LOOP
  reversed_:=jsonb_set(reversed_,ARRAY[part#>>'{}'],(SELECT jsonb_agg(x ORDER BY ord DESC) FROM jsonb_array_elements(g->(part#>>'{}')) WITH ORDINALITY a(x,ord)));
 END LOOP;
 IF public.harness_manual_compute(jsonb_build_object('model',reversed_),jsonb_build_object('segment_ends',ends_))<>r
 THEN RAISE EXCEPTION 'Presentation depends on source-array order'; END IF;
 -- A pointer-only retired endpoint cannot qualify a group; its pieces remain.
 changed_:=jsonb_set(i,'{model,endpoints,0,superseded_by}',to_jsonb(md5('replacement')::uuid));
 r:=public.harness_manual_compute(changed_,jsonb_build_object('segment_ends',ends_));
 IF EXISTS(SELECT FROM jsonb_array_elements(r->'sheets') x WHERE x->>'title' LIKE '%[DEVICE-ONE]%')
  OR jsonb_array_length(r->'members')<>13 THEN RAISE EXCEPTION 'Retired principal qualified or lost pieces'; END IF;
 -- A termination from a different circuit cannot supply the principal.
 changed_:=jsonb_set(i,'{model,terminations}',(SELECT jsonb_agg(CASE WHEN x->>'endpoint_id'=md5('device one')::uuid::text THEN x||jsonb_build_object('circuit_id',md5('unrelated circuit')::uuid) ELSE x END) FROM jsonb_array_elements(ts) x));
 r:=public.harness_manual_compute(changed_,jsonb_build_object('segment_ends',ends_));
 IF EXISTS(SELECT FROM jsonb_array_elements(r->'sheets') x WHERE x->>'title' LIKE '%[DEVICE-ONE]%')
  OR jsonb_array_length(r->'members')<>13 THEN RAISE EXCEPTION 'Wrong-circuit termination grouped or lost pieces'; END IF;
END $$;
SELECT 'test_harness_functional_manual_sheets: PASS' AS result;

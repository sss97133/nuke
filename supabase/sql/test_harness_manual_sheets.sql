-- Disposable PostgreSQL17 only; retain the original canonical model contracts.
\set ON_ERROR_STOP on
\i supabase/sql/test_harness_model_evaluation.sql
-- Prior contract deliberately hid all checks as its final negative assay.
DROP POLICY harness_model_checks_read ON public.harness_model_checks;
CREATE POLICY harness_model_checks_read ON public.harness_model_checks FOR SELECT USING (
 EXISTS(SELECT FROM public.harness_model_evaluations r WHERE r.id=harness_model_checks.evaluation_id)
 AND (segment_id IS NULL OR EXISTS(SELECT FROM public.harness_segments s WHERE s.id=harness_model_checks.segment_id))
 AND (termination_id IS NULL OR EXISTS(SELECT FROM public.wire_termination_specs t WHERE t.id=harness_model_checks.termination_id))
 AND (circuit_id IS NULL OR EXISTS(SELECT FROM public.vehicle_custom_circuits c WHERE c.id=harness_model_checks.circuit_id)));
\i supabase/migrations/20261126021500_harness_manual_sheets.sql

DO $$
DECLARE r jsonb; v uuid:='e08bf694-970f-4cbe-8a74-8715158a0f2e';
BEGIN
 r:=public.harness_model_fold(v);
 IF r->>'status'<>'current' OR (r->>'reused')::boolean THEN RAISE EXCEPTION 'Sheet logic did not publish a new evaluation: %',r; END IF;
 IF NOT EXISTS(SELECT FROM public.harness_model_sheets h JOIN public.harness_model_state s ON s.latest_evaluation_id=h.evaluation_id WHERE s.vehicle_id=v)
 THEN RAISE EXCEPTION 'Fold published without manual sheets'; END IF;
 r:=public.harness_model_fold(md5('harness scale vehicle')::uuid);
 IF r->>'status'<>'current' THEN RAISE EXCEPTION 'Scale sheet fold failed: %',r; END IF;
END $$;

SET ROLE anon;
DO $$
DECLARE r jsonb; page jsonb; sh jsonb; eid uuid; sid uuid; after_ text; total_ integer:=0; seen uuid[]:='{}'; limit_ integer:=3;
BEGIN
 BEGIN
  PERFORM public.harness_evaluated_model('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  RAISE EXCEPTION 'Anonymous bulk derived graph remained callable';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 r:=public.harness_manual_index('e08bf694-970f-4cbe-8a74-8715158a0f2e',NULL,100000);
 IF r->>'status'<>'current' OR jsonb_array_length(r->'sheets')>25 THEN RAISE EXCEPTION 'Manual index missing or unbounded: %',r; END IF;
 eid:=(r->'evaluation'->>'id')::uuid;
  IF NOT coalesce((public.harness_manual_cursor('e08bf694-970f-4cbe-8a74-8715158a0f2e')->>'eligible_cursor')::boolean,false)
  THEN RAISE EXCEPTION 'Current manual cursor was not eligible'; END IF;
 r:=public.harness_manual_index('e08bf694-970f-4cbe-8a74-8715158a0f2e',NULL,25,'110');
 IF jsonb_array_length(r->'sheets')=0 OR NOT EXISTS(SELECT FROM jsonb_array_elements(r->'sheets') h
  CROSS JOIN LATERAL jsonb_array_elements(h->'circuits') c WHERE c->>'code'='110')
 THEN RAISE EXCEPTION 'Wire search could not find its actual sheet'; END IF;
 FOR sh IN SELECT x FROM jsonb_array_elements(r->'sheets') a(x) LOOP
  page:=public.harness_manual_sheet('e08bf694-970f-4cbe-8a74-8715158a0f2e',eid,(sh->>'id')::uuid);
  IF page->>'status'<>'current' OR jsonb_array_length(page->'model'->'segments')<>(sh->>'piece_count')::integer
   OR jsonb_array_length(page->'model'->'segments')>8 THEN RAISE EXCEPTION 'Sheet lost its bounded physical pieces'; END IF;
  IF NOT EXISTS(SELECT FROM jsonb_array_elements(page->'model'->'model_checks') a(x) WHERE x->>'rule_key'='engineering_coverage' AND x->>'result'='hold')
  THEN RAISE EXCEPTION 'Manual sheet lost engineering qualification'; END IF;
 END LOOP;
 page:=public.harness_manual_sheet('e08bf694-970f-4cbe-8a74-8715158a0f2e',gen_random_uuid(),(r->'sheets'->0->>'id')::uuid);
 IF page->>'status'<>'pending' OR page->'model'<>'null'::jsonb THEN RAISE EXCEPTION 'Old evaluation silently retargeted a sheet'; END IF;
 r:=public.harness_manual_index('00000000-0000-0000-0000-00000000fefe');
 IF r->>'status'<>'unavailable' OR r->'evaluation'<>'null'::jsonb THEN RAISE EXCEPTION 'Unknown vehicle exposed a receipt'; END IF;
 LOOP
  r:=public.harness_manual_index(md5('harness scale vehicle')::uuid,after_,limit_);
  IF r->>'status'<>'current' OR jsonb_array_length(r->'sheets')>limit_ THEN RAISE EXCEPTION 'Scale index not keyset bounded'; END IF;
  FOR sh IN SELECT x FROM jsonb_array_elements(r->'sheets') a(x) LOOP
   sid:=(sh->>'id')::uuid;
   IF sid=ANY(seen) THEN RAISE EXCEPTION 'Sheet keyset repeated a header'; END IF;
   seen:=array_append(seen,sid);total_:=total_+(sh->>'piece_count')::integer;
  END LOOP;
  EXIT WHEN r->>'next_after' IS NULL;
  after_:=r->>'next_after';
  limit_:=25;
 END LOOP;
 IF total_<>500 OR cardinality(seen)<>63 THEN RAISE EXCEPTION 'Sheet keyset omitted physical population: %, %',total_,cardinality(seen); END IF;
END $$;
RESET ROLE;

SET ROLE anon;
DO $$
DECLARE eid uuid; seg uuid; side_ text; r jsonb;
BEGIN
 SELECT latest_evaluation_id INTO eid FROM public.harness_model_state WHERE vehicle_id='e08bf694-970f-4cbe-8a74-8715158a0f2e';
 SELECT a.segment_id,a.side INTO seg,side_ FROM public.harness_model_segment_ends a
 JOIN public.harness_model_nodes n ON n.evaluation_id=a.evaluation_id AND n.id=a.node_id
 JOIN public.harness_endpoints e ON e.id=n.endpoint_id WHERE a.evaluation_id=eid AND e.code='FIREWALL-CABIN'
 ORDER BY a.segment_id,a.side LIMIT 1;
 r:=public.harness_manual_mate_context('e08bf694-970f-4cbe-8a74-8715158a0f2e',eid,seg,side_);
 IF r->>'status'<>'current' OR (r->>'contact_mapping_qualified')::boolean OR jsonb_array_length(r->'destinations')=0
 THEN RAISE EXCEPTION 'Explicit connector mate context missing or overstated: %',r; END IF;
END $$;
RESET ROLE;

SET ROLE anon;
DO $$
DECLARE eid uuid; first_ jsonb; second_ jsonb;
BEGIN
 SELECT latest_evaluation_id INTO eid FROM public.harness_model_state WHERE vehicle_id=md5('harness scale vehicle')::uuid;
 first_:=public.harness_model_collection_page(md5('harness scale vehicle')::uuid,eid,'checks',NULL,100000);
 IF first_->>'status'<>'available' OR jsonb_array_length(first_->'rows')<>100 OR first_->>'next_after' IS NULL
  OR first_->>'qualification'<>'immutable_evaluation_page_recheck_manifest' THEN RAISE EXCEPTION 'Derived collection was not bounded/qualified'; END IF;
 second_:=public.harness_model_collection_page(md5('harness scale vehicle')::uuid,eid,'checks',first_->>'next_after',100);
 IF jsonb_array_length(second_->'rows')<>100 OR EXISTS(SELECT FROM jsonb_array_elements(first_->'rows') a
   JOIN jsonb_array_elements(second_->'rows') b ON a->>'id'=b->>'id') THEN RAISE EXCEPTION 'Check keyset repeated or dropped its next page'; END IF;
 second_:=public.harness_model_collection_page('e08bf694-970f-4cbe-8a74-8715158a0f2e',eid,'checks');
 IF second_->>'status'<>'pending' OR jsonb_array_length(second_->'rows')<>0 THEN RAISE EXCEPTION 'Collection crossed vehicle/evaluation scope'; END IF;
END $$;
RESET ROLE;

-- Same-node continuation is paged by existing physical end keys, not inferred from the sheet layout.
SET ROLE anon;
DO $$
DECLARE eid uuid; seg uuid; r jsonb;
BEGIN
 SELECT latest_evaluation_id INTO eid FROM public.harness_model_state WHERE vehicle_id=md5('harness scale vehicle')::uuid;
 SELECT segment_id INTO seg FROM public.harness_model_segment_ends WHERE evaluation_id=eid AND side='from' ORDER BY segment_id LIMIT 1;
 r:=public.harness_manual_continuations(md5('harness scale vehicle')::uuid,eid,seg,'from',NULL,100000);
 IF r->>'status'<>'current' OR jsonb_array_length(r->'destinations')<>50 OR r->>'next_after' IS NULL
 THEN RAISE EXCEPTION 'Shared bus continuation not bounded'; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(r->'destinations') a(x) WHERE x->>'node_id'<>r->'origin'->>'node_id')
 THEN RAISE EXCEPTION 'Sheet continuation fabricated a connection'; END IF;
END $$;
RESET ROLE;

-- Source/code changes invalidate the displayed receipt and its bounded pages, without rewriting history.
DO $$
DECLARE eid uuid; sid uuid; circuit uuid; r jsonb; body text;
BEGIN
 SELECT latest_evaluation_id INTO eid FROM public.harness_model_state WHERE vehicle_id='e08bf694-970f-4cbe-8a74-8715158a0f2e';
 SELECT id INTO sid FROM public.harness_model_sheets WHERE evaluation_id=eid ORDER BY sort_key LIMIT 1;
 SELECT (x->>'id')::uuid INTO circuit FROM jsonb_array_elements(public.harness_model_inputs('e08bf694-970f-4cbe-8a74-8715158a0f2e')->'model'->'circuits') a(x)
  WHERE x->>'code'='110';
 UPDATE public.vehicle_custom_circuits SET circuit_name=circuit_name||' manual invalidation' WHERE id=circuit;
 r:=public.harness_manual_sheet('e08bf694-970f-4cbe-8a74-8715158a0f2e',eid,sid);
 IF r->>'status'<>'pending' OR r->'model'<>'null'::jsonb THEN RAISE EXCEPTION 'Source edit left old sheet visible'; END IF;
 r:=public.harness_model_collection_page('e08bf694-970f-4cbe-8a74-8715158a0f2e',eid,'checks');
 IF r->>'status'<>'pending' OR jsonb_array_length(r->'rows')<>0 THEN RAISE EXCEPTION 'Source edit left derived pages available'; END IF;
 r:=public.harness_model_fold('e08bf694-970f-4cbe-8a74-8715158a0f2e');
 IF r->>'status'<>'current' OR (r->>'evaluation_id')::uuid=eid THEN RAISE EXCEPTION 'Source edit did not create a new receipt'; END IF;
 r:=public.harness_manual_sheet('e08bf694-970f-4cbe-8a74-8715158a0f2e',eid,sid);
 IF r->>'status'<>'pending' OR r->'model'<>'null'::jsonb THEN RAISE EXCEPTION 'Old sheet request silently retargeted after recompute'; END IF;
 body:=pg_get_functiondef('public.harness_manual_compute(jsonb,jsonb)'::regprocedure);
 EXECUTE replace(body,'WITH RECURSIVE',E'-- contract logic revision\nWITH RECURSIVE');
 IF coalesce((public.harness_manual_cursor('e08bf694-970f-4cbe-8a74-8715158a0f2e')->>'eligible_cursor')::boolean,true)
 THEN RAISE EXCEPTION 'Small cursor missed a code-only invalidation'; END IF;
 r:=public.harness_manual_index('e08bf694-970f-4cbe-8a74-8715158a0f2e');
 IF r->>'status'<>'pending' THEN RAISE EXCEPTION 'Sheet helper change missed logic receipt'; END IF;
 r:=public.harness_model_fold('e08bf694-970f-4cbe-8a74-8715158a0f2e');
 IF r->>'status'<>'current' THEN RAISE EXCEPTION 'Sheet helper change did not recover'; END IF;
END $$;

-- Fail closed when any sheet child becomes invisible; no partial model or silent empty list.
ALTER POLICY harness_model_sheet_members_read ON public.harness_model_sheet_members USING(false);
SET ROLE anon;
DO $$
DECLARE r jsonb;
BEGIN
 r:=public.harness_manual_index('e08bf694-970f-4cbe-8a74-8715158a0f2e');
 IF r->>'status'<>'incomplete_visibility' OR r->'evaluation'<>'null'::jsonb OR jsonb_array_length(r->'sheets')<>0
 THEN RAISE EXCEPTION 'Incomplete sheet visibility passed currentness'; END IF;
END $$;
RESET ROLE;
SELECT 'test_harness_manual_sheets: PASS' AS result;

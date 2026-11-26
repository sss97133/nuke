-- Disposable PostgreSQL17 only; parent contract enforces that boundary.
\set ON_ERROR_STOP on
-- Reuse source/schema bootstrap without repeating the parent contracts'500-piece
-- scale and adversarial assays here. CI still runs every parent contract.
\i supabase/sql/helpers/harness_model_evaluation_setup.sql
-- The source-reader contract ends with a deliberate RLS denial. Restore the
-- same public source policy as the complete evaluation contract.
DROP POLICY reader_contract_deny_segments ON public.harness_segments;
CREATE POLICY "Public read for public vehicles" ON public.harness_segments FOR SELECT USING (
 EXISTS(SELECT FROM public.vehicles v WHERE v.id=harness_segments.vehicle_id
  AND (v.is_public IS TRUE OR v.user_id=auth.uid() OR v.owner_id=auth.uid())));
SELECT set_config('test.auth_uid','',false),set_config('test.auth_jwt','{}',false);
ALTER TABLE public.vehicles ADD COLUMN year integer, ADD COLUMN make text, ADD COLUMN model text, ADD COLUMN license_plate text;
REVOKE SELECT ON public.vehicles FROM anon;
GRANT SELECT(id,is_public,user_id,owner_id,deleted_at,year,make,model) ON public.vehicles TO anon;
ALTER TABLE public.vehicle_custom_circuits ADD COLUMN IF NOT EXISTS system_category text,
 ADD COLUMN IF NOT EXISTS from_endpoint_id uuid, ADD COLUMN IF NOT EXISTS to_endpoint_id uuid;
ALTER TABLE public.harness_endpoints ADD COLUMN IF NOT EXISTS superseded_by uuid;
ALTER TABLE public.wire_termination_specs ADD COLUMN IF NOT EXISTS superseded_by uuid;
\i supabase/migrations/20261126021500_harness_manual_sheets.sql
\i supabase/migrations/20261126041635_harness_functional_manual_sheets.sql
\i supabase/migrations/20261126051125_harness_fold_phase_diagnostics.sql
\i supabase/migrations/20261126052721_harness_manual_context_references.sql
\i supabase/migrations/20261126061300_harness_contact_end_accounting.sql

-- Compatibility with the earlier minimal source fixture. All of these fields
-- and splice owners already exist in production; this change does not mint them.
ALTER TABLE public.harness_endpoints ADD COLUMN IF NOT EXISTS design_status text;
ALTER TABLE public.wire_termination_specs
 ADD COLUMN IF NOT EXISTS connector_housing_catalog_id uuid REFERENCES public.catalog_parts(id),
 ADD COLUMN IF NOT EXISTS connector_housing_pn text,
 ADD COLUMN IF NOT EXISTS wedge_lock_catalog_id uuid REFERENCES public.catalog_parts(id),
 ADD COLUMN IF NOT EXISTS wedge_lock_pn text,
 ADD COLUMN IF NOT EXISTS boot_catalog_id uuid REFERENCES public.catalog_parts(id),
 ADD COLUMN IF NOT EXISTS boot_pn text;
CREATE TABLE public.harness_splices(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid REFERENCES public.vehicles(id),
 splice_code text,placement text,endpoint_id uuid REFERENCES public.harness_endpoints(id),cavity text,
 part_id uuid REFERENCES public.catalog_parts(id),part_number text,is_superseded boolean NOT NULL DEFAULT false,
 superseded_by uuid REFERENCES public.harness_splices(id));
CREATE TABLE public.harness_splice_members(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),splice_id uuid REFERENCES public.harness_splices(id),
 circuit_id uuid REFERENCES public.vehicle_custom_circuits(id),ordinal integer,member_label text,side smallint);
GRANT SELECT ON public.harness_splices,public.harness_splice_members TO anon,authenticated,service_role;

\i supabase/migrations/20261126062400_harness_component_requirements.sql

DO $$
DECLARE r jsonb;
BEGIN
 r:=public.harness_model_fold('e08bf694-970f-4cbe-8a74-8715158a0f2e'::uuid);
 IF r->>'status' IS DISTINCT FROM 'current' THEN RAISE EXCEPTION 'Component producer failed: %',r; END IF;
 IF (SELECT count(*) FROM public.harness_model_component_requirements q JOIN public.harness_model_state s
 ON s.latest_evaluation_id=q.evaluation_id WHERE s.vehicle_id='e08bf694-970f-4cbe-8a74-8715158a0f2e'::uuid)=0
 THEN RAISE EXCEPTION 'Unassigned contacts disappeared as verified zero demand'; END IF;
 IF EXISTS(SELECT FROM public.harness_model_component_requirements q JOIN public.harness_model_state s
 ON s.latest_evaluation_id=q.evaluation_id WHERE s.vehicle_id='e08bf694-970f-4cbe-8a74-8715158a0f2e'::uuid AND q.state='provisional')
 THEN RAISE EXCEPTION 'Missing catalog assignments or endpoint design status defaulted to qualified'; END IF;
 IF NOT EXISTS(SELECT FROM public.harness_model_evaluations e JOIN public.harness_model_state s ON s.latest_evaluation_id=e.id,
 jsonb_array_elements(e.component_role_coverage) x WHERE s.vehicle_id='e08bf694-970f-4cbe-8a74-8715158a0f2e'::uuid
 AND x->>'role'='boot' AND (x->>'recorded_owner_groups')::int>0 AND (x->>'groups_without_assignment')::int>0
 AND x->>'applicability_state'='unassessed' AND x->>'kind'='recorded_assignment_coverage')
 THEN RAISE EXCEPTION 'Absent boot assignments appeared as verified zero required parts'; END IF;
END $$;

SELECT 'test_harness_component_requirements: bootstrap PASS' AS result;

-- Additional existing source columns needed only by the reviewed synthetic fixture.
ALTER TABLE public.catalog_parts ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.harness_splices ADD COLUMN IF NOT EXISTS at_label text, ADD COLUMN IF NOT EXISTS fingerprint text, ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.vehicle_custom_circuits ADD COLUMN IF NOT EXISTS observed_at timestamptz, ADD COLUMN IF NOT EXISTS trust text;
BEGIN;
CREATE TEMP TABLE demand_fixture (vehicle_id uuid, circuit_a uuid, circuit_b uuid, circuit_ground uuid,
  segment_a uuid, segment_b uuid, segment_ground uuid, endpoint_a uuid, endpoint_splice uuid,
  endpoint_ground uuid, end_a1 uuid, end_a2 uuid, splice_id uuid);
INSERT INTO public.catalog_parts(part_number,name) VALUES
  ('DEMAND-TERMINAL','fixture contact'),('DEMAND-SPLICE','fixture splice'),
  ('DEMAND-HOUSING','fixture housing'),('DEMAND-OTHER-HOUSING','conflicting fixture housing'),
  ('DEMAND-WEDGE','fixture wedge'),('DEMAND-BOOT','fixture boot'),
  ('DEMAND-SEAL','fixture seal'),('DEMAND-TOOL','fixture reusable tool');

DO $fixture$
DECLARE v uuid := gen_random_uuid(); o uuid := gen_random_uuid(); d uuid := gen_random_uuid(); n uuid := gen_random_uuid();
  a uuid := gen_random_uuid(); sp uuid := gen_random_uuid(); g uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); c3 uuid := gen_random_uuid(); c4 uuid := gen_random_uuid();
  s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid(); s3 uuid := gen_random_uuid(); s4 uuid := gen_random_uuid();
  a1 uuid := gen_random_uuid(); a2 uuid := gen_random_uuid(); p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid();
  g1 uuid := gen_random_uuid(); g2 uuid := gen_random_uuid(); b1 uuid := gen_random_uuid(); b2 uuid := gen_random_uuid(); component uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.vehicles(id,is_public,user_id) VALUES(v,true,'00000000-0000-0000-0000-000000007777');
  INSERT INTO public.vehicle_wiring_overlays(id,vehicle_id) VALUES(o,v);
  INSERT INTO public.harness_designs(id,vehicle_id) VALUES(d,v);
  INSERT INTO public.harness_endpoints(id,design_id,code,endpoint_type,node_kind,design_status) VALUES
    (a,d,'DEMAND-CONNECTOR','connector','terminals','decided'),(sp,d,'DEMAND-SPLICE','splice','bus','decided'),
    (g,d,'DEMAND-GROUND','ground','bus','decided'),(b,d,'DEMAND-OTHER-END','connector','terminals','decided');
  INSERT INTO public.vehicle_custom_circuits(id,overlay_id,circuit_code,design_status,build_state,
    wire_type,wire_gauge_awg,wire_color,from_endpoint_id,to_endpoint_id,source,observed_at,trust) VALUES
    (c1,o,'DEMAND-A','decided','uncut','M22759/32',18,'red',a,sp,'fixture',now(),'T3'),
    (c2,o,'DEMAND-B','decided','uncut','M22759/32',18,'red',a,sp,'fixture',now(),'T3'),
    (c3,o,'DEMAND-G','decided','uncut','M22759/32',18,'red',g,b,'fixture',now(),'T3'),
    (c4,o,'DEMAND-G2','decided','uncut','M22759/32',18,'red',g,b,'fixture',now(),'T3');
  INSERT INTO public.wire_termination_specs(id,vehicle_id,circuit_id,endpoint_id,cavity) VALUES
    (a1,v,c1,a,'1'),(p1,v,c1,sp,'splice'),(a2,v,c2,a,'2'),(p2,v,c2,sp,'splice'),
    (g1,v,c3,g,'stud'),(b1,v,c3,b,'1'),(g2,v,c4,g,'stud'),(b2,v,c4,b,'2');
  UPDATE public.wire_termination_specs SET terminal_contact_pn='DEMAND-TERMINAL',
    terminal_contact_catalog_id=(SELECT id FROM public.catalog_parts WHERE part_number='DEMAND-TERMINAL'),
    crimp_tool_pn='DEMAND-TOOL',crimp_tool_catalog_id=(SELECT id FROM public.catalog_parts WHERE part_number='DEMAND-TOOL')
    WHERE vehicle_id=v;
  UPDATE public.wire_termination_specs SET terminal_contact_pn='DEMAND-SPLICE',
    terminal_contact_catalog_id=(SELECT id FROM public.catalog_parts WHERE part_number='DEMAND-SPLICE') WHERE id IN(p1,p2);
  UPDATE public.wire_termination_specs SET connector_housing_pn='DEMAND-HOUSING',
    connector_housing_catalog_id=(SELECT id FROM public.catalog_parts WHERE part_number='DEMAND-HOUSING'),
    wedge_lock_pn='DEMAND-WEDGE',wedge_lock_catalog_id=(SELECT id FROM public.catalog_parts WHERE part_number='DEMAND-WEDGE'),
    pin_seal_pn='DEMAND-SEAL',pin_seal_catalog_id=(SELECT id FROM public.catalog_parts WHERE part_number='DEMAND-SEAL') WHERE id IN(a1,a2);
  UPDATE public.wire_termination_specs SET boot_pn='DEMAND-BOOT',
    boot_catalog_id=(SELECT id FROM public.catalog_parts WHERE part_number='DEMAND-BOOT') WHERE id IN(a1,a2,g1,g2);
  INSERT INTO public.harness_nets(id,vehicle_id,net_code,source,method,observed_at,trust) VALUES(n,v,'DEMAND','fixture','fixture',now(),'T3');
  INSERT INTO public.harness_segments(id,vehicle_id,net_id,vehicle_custom_circuit_id,from_termination_id,to_termination_id,
    gauge_awg,colour,wire_part_id,planned_length_ft,planned_length_method,source,method,observed_at,trust) VALUES
    (s1,v,n,c1,a1,p1,18,'red',(SELECT id FROM public.catalog_parts WHERE part_number='M22759/32-18-2'),2,'fixture estimate','fixture','fixture',now(),'T3'),
    (s2,v,n,c2,a2,p2,18,'red',(SELECT id FROM public.catalog_parts WHERE part_number='M22759/32-18-2'),3,'fixture estimate','fixture','fixture',now(),'T3'),
    (s3,v,n,c3,g1,b1,18,'red',(SELECT id FROM public.catalog_parts WHERE part_number='M22759/32-18-2'),NULL,'unknown','fixture','fixture',now(),'T3'),
    (s4,v,n,c4,g2,b2,18,'red',(SELECT id FROM public.catalog_parts WHERE part_number='M22759/32-18-2'),NULL,'unknown','fixture','fixture',now(),'T3');
  INSERT INTO public.harness_splices(id,vehicle_id,splice_code,placement,at_label,endpoint_id,part_number,part_id,fingerprint,source)
    VALUES(component,v,'DEMAND-SPLICE','stub','fixture splice',sp,'DEMAND-SPLICE',
      (SELECT id FROM public.catalog_parts WHERE part_number='DEMAND-SPLICE'),'fixture','fixture');
  INSERT INTO public.harness_splice_members(splice_id,ordinal,member_label,circuit_id) VALUES(component,1,'A',c1),(component,2,'B',c2);
  INSERT INTO demand_fixture VALUES(v,c1,c2,c3,s1,s2,s3,a,sp,g,a1,a2,component);
END $fixture$;
UPDATE public.harness_segments SET design_status='decided' WHERE vehicle_id IN(SELECT vehicle_id FROM demand_fixture);
GRANT SELECT ON demand_fixture TO anon, authenticated;

CREATE TEMP TABLE integration_result AS SELECT public.harness_model_fold(vehicle_id) AS result FROM demand_fixture;
TABLE integration_result;
DO $$
DECLARE r jsonb; q record; n numeric; v uuid; evaluation uuid;
BEGIN
 SELECT vehicle_id INTO v FROM demand_fixture;
 SELECT result INTO r FROM integration_result;
 IF r->>'status'<>'current' THEN RAISE EXCEPTION 'Component fold failed: %',r; END IF;
 evaluation:=(r->>'evaluation_id')::uuid;
 FOR q IN SELECT * FROM (VALUES
  ('terminal_contact',6::numeric),('splice',1),('connector_housing',1),('wedge_lock',1),('boot',3),('pin_seal',2)) x(role,expected)
 LOOP
  SELECT sum(quantity) INTO n FROM public.harness_model_component_requirements c
   WHERE c.evaluation_id=evaluation AND c.role=q.role AND c.state='provisional';
  IF n IS DISTINCT FROM q.expected THEN RAISE EXCEPTION 'Wrong % count: %, expected %; requirements %',q.role,n,q.expected,
   (SELECT jsonb_agg(to_jsonb(c)) FROM public.harness_model_component_requirements c WHERE c.evaluation_id=evaluation); END IF;
 END LOOP;
 IF (SELECT sum(planned_quantity) FROM public.harness_model_wire_requirements WHERE evaluation_id=evaluation AND state='provisional')<>5
  OR (SELECT count(*) FROM public.harness_model_wire_requirements WHERE evaluation_id=evaluation AND state='held')<>2 THEN
  RAISE EXCEPTION 'Existing wire owner changed'; END IF;
 r:=public.harness_evaluated_model(v);
 IF r->>'status'<>'current' OR jsonb_array_length(r#>'{model,component_contributors}')<14 THEN
  RAISE EXCEPTION 'Combined reader omitted component contributor rows: %',r; END IF;
 IF public.harness_model_fold(v)->>'reused'<>'true' THEN RAISE EXCEPTION 'Unchanged component source did not reuse evaluation'; END IF;
END $$;
SELECT 'component baseline: PASS';

CREATE FUNCTION pg_temp.fold_current() RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
 r:=public.harness_model_fold((SELECT vehicle_id FROM demand_fixture));
 IF r->>'status'<>'current' THEN RAISE EXCEPTION 'Expected complete evaluation: %',r; END IF;
 RETURN (r->>'evaluation_id')::uuid;
END $$;
COMMIT;

BEGIN;
UPDATE public.wire_termination_specs SET cavity='1' WHERE id=(SELECT end_a2 FROM demand_fixture);
DO $$
DECLARE ev uuid:=pg_temp.fold_current(); n int;
BEGIN
 SELECT count(*) INTO n FROM public.harness_model_component_requirements q WHERE q.evaluation_id=ev
  AND q.endpoint_id=(SELECT endpoint_a FROM demand_fixture) AND q.role IN('terminal_contact','pin_seal')
  AND q.state='held' AND q.quantity IS NULL AND 'shared_contact_quantity_unresolved'=ANY(q.blockers);
 IF n<>2 THEN RAISE EXCEPTION 'Shared cavity produced eligible terminal or seal'; END IF;
 IF (SELECT count(*) FROM public.harness_model_component_contributors c JOIN public.harness_model_component_requirements q
  ON q.evaluation_id=c.evaluation_id AND q.id=c.requirement_id WHERE q.evaluation_id=ev
  AND q.endpoint_id=(SELECT endpoint_a FROM demand_fixture) AND q.role IN('terminal_contact','pin_seal'))<>4 THEN
  RAISE EXCEPTION 'Shared contacts lost exact distinct physical ends'; END IF;
END $$;
INSERT INTO public.connector_cavity_layouts(id,connector_model,cavity_id) VALUES('ab000000-0000-0000-0000-000000000001','SYNTHETIC-CONTACT','1');
UPDATE public.wire_termination_specs SET cavity_layout_id='ab000000-0000-0000-0000-000000000001' WHERE id=(SELECT end_a1 FROM demand_fixture);
DO $$
DECLARE ev uuid:=pg_temp.fold_current();
BEGIN
 IF (SELECT count(*) FROM public.harness_model_component_requirements q WHERE q.evaluation_id=ev
  AND q.endpoint_id=(SELECT endpoint_a FROM demand_fixture) AND q.role IN('terminal_contact','pin_seal')
  AND q.state='held' AND q.quantity IS NULL AND 'shared_contact_identity_unresolved'=ANY(q.blockers))<>4 THEN
  RAISE EXCEPTION 'Mixed typed/untyped same recorded cavity produced two contact assemblies'; END IF;
END $$;
ROLLBACK;

BEGIN;
UPDATE public.wire_termination_specs SET cavity='2?' WHERE id=(SELECT end_a2 FROM demand_fixture);
DO $$
DECLARE ev uuid:=pg_temp.fold_current();
BEGIN
 IF EXISTS(SELECT FROM public.harness_model_component_requirements q JOIN public.harness_model_component_contributors c
 ON c.evaluation_id=q.evaluation_id AND c.requirement_id=q.id WHERE q.evaluation_id=ev
 AND c.termination_id=(SELECT end_a2 FROM demand_fixture) AND q.role IN('terminal_contact','pin_seal') AND q.state='provisional') THEN
 RAISE EXCEPTION 'Uncertain cavity became known material amount'; END IF;
END $$;
ROLLBACK;

BEGIN;
UPDATE public.wire_termination_specs SET connector_housing_catalog_id=NULL WHERE id=(SELECT end_a2 FROM demand_fixture);
DO $$
DECLARE ev uuid:=pg_temp.fold_current();
BEGIN
 IF NOT EXISTS(SELECT FROM public.harness_model_component_requirements WHERE evaluation_id=ev AND role='connector_housing'
 AND state='held' AND quantity IS NULL AND 'part_assignment_incomplete'=ANY(blockers)) THEN
 RAISE EXCEPTION 'Missing shared housing choice became default one'; END IF;
END $$;
UPDATE public.wire_termination_specs SET connector_housing_catalog_id=(SELECT id FROM public.catalog_parts WHERE part_number='DEMAND-OTHER-HOUSING'),
 connector_housing_pn='DEMAND-OTHER-HOUSING' WHERE id=(SELECT end_a2 FROM demand_fixture);
DO $$
DECLARE ev uuid:=pg_temp.fold_current();
BEGIN
 IF NOT EXISTS(SELECT FROM public.harness_model_component_requirements q JOIN public.harness_model_checks k
 ON k.evaluation_id=q.evaluation_id AND k.component_requirement_id=q.id WHERE q.evaluation_id=ev AND q.role='connector_housing'
 AND q.state='held' AND q.quantity IS NULL AND k.rule_key='component_part_assignment' AND k.result='fail') THEN
 RAISE EXCEPTION 'Conflicting shared housing choice was selected'; END IF;
END $$;
ROLLBACK;

BEGIN;
UPDATE public.harness_endpoints SET design_status='concept' WHERE id=(SELECT endpoint_a FROM demand_fixture);
DO $$
DECLARE ev uuid:=pg_temp.fold_current();
BEGIN
 IF EXISTS(SELECT FROM public.harness_model_component_requirements q WHERE q.evaluation_id=ev
 AND q.endpoint_id=(SELECT endpoint_a FROM demand_fixture) AND q.state='provisional') THEN
 RAISE EXCEPTION 'Decided circuit promoted concept connector choices'; END IF;
END $$;
ROLLBACK;

BEGIN;
DO $$
DECLARE f demand_fixture%ROWTYPE; empty_endpoint uuid:=gen_random_uuid(); orphan uuid:=gen_random_uuid(); ev uuid;
BEGIN
 SELECT * INTO f FROM demand_fixture;
 INSERT INTO public.harness_endpoints(id,design_id,code,endpoint_type,node_kind,design_status)
 SELECT empty_endpoint,design_id,'SYNTHETIC-EMPTY','splice','bus','decided' FROM public.harness_endpoints WHERE id=f.endpoint_a;
 INSERT INTO public.harness_splices(id,vehicle_id,splice_code,placement,at_label,endpoint_id,part_number,part_id,fingerprint,source)
 VALUES(orphan,f.vehicle_id,'SYNTHETIC-ORPHAN','stub','unlinked synthetic test',empty_endpoint,'DEMAND-SPLICE',
 (SELECT id FROM public.catalog_parts WHERE part_number='DEMAND-SPLICE'),'orphan','synthetic');
 INSERT INTO public.harness_splice_members(splice_id,ordinal,member_label,circuit_id) VALUES(orphan,1,'A',f.circuit_a),(orphan,2,'B',f.circuit_b);
 ev:=pg_temp.fold_current();
 IF NOT EXISTS(SELECT FROM public.harness_model_component_requirements WHERE evaluation_id=ev AND splice_id=orphan
 AND state='held' AND 'splice_member_endpoint_unresolved'=ANY(blockers)) THEN
 RAISE EXCEPTION 'A circuit existing somewhere was treated as reaching the splice'; END IF;
 IF EXISTS(SELECT FROM public.harness_model_component_contributors c JOIN public.harness_model_component_requirements q
 ON q.evaluation_id=c.evaluation_id AND q.id=c.requirement_id WHERE q.evaluation_id=ev AND q.splice_id=orphan) THEN
 RAISE EXCEPTION 'Orphan splice received invented end edges'; END IF;
END $$;
ROLLBACK;

BEGIN;
INSERT INTO public.harness_splice_members(splice_id,ordinal,member_label,circuit_id)
 SELECT splice_id,3,'unmodeled lead',NULL FROM demand_fixture;
DO $$
DECLARE ev uuid:=pg_temp.fold_current();
BEGIN
 IF NOT EXISTS(SELECT FROM public.harness_model_component_requirements WHERE evaluation_id=ev
 AND splice_id=(SELECT splice_id FROM demand_fixture) AND state='held' AND 'splice_member_unresolved'=ANY(blockers)) THEN
 RAISE EXCEPTION 'An unmodeled splice lead was silently discarded'; END IF;
END $$;
ROLLBACK;

BEGIN;
UPDATE public.harness_segments SET build_state='cut' WHERE id=(SELECT segment_a FROM demand_fixture);
DO $$
DECLARE ev uuid:=pg_temp.fold_current();
BEGIN
 IF EXISTS(SELECT FROM public.harness_model_component_requirements q JOIN public.harness_model_component_contributors c
 ON c.evaluation_id=q.evaluation_id AND c.requirement_id=q.id WHERE q.evaluation_id=ev
 AND c.segment_id=(SELECT segment_a FROM demand_fixture) AND q.state='provisional') THEN
 RAISE EXCEPTION 'Existing physical progress produced new stock component demand'; END IF;
END $$;
ROLLBACK;

BEGIN;
DO $$
DECLARE ev uuid; extra uuid:=gen_random_uuid();
BEGIN
 INSERT INTO public.harness_splices(id,vehicle_id,splice_code,placement,at_label,endpoint_id,part_number,part_id,fingerprint,source)
 SELECT extra,vehicle_id,'SYNTHETIC-EXTRA','stub','synthetic unlisted conductor',endpoint_splice,'DEMAND-SPLICE',
 (SELECT id FROM public.catalog_parts WHERE part_number='DEMAND-SPLICE'),'extra','synthetic' FROM demand_fixture;
 INSERT INTO public.harness_splice_members(splice_id,ordinal,member_label,circuit_id)
 SELECT extra,1,'only A declared',circuit_a FROM demand_fixture;
 ev:=pg_temp.fold_current();
 IF NOT EXISTS(SELECT FROM public.harness_model_component_requirements WHERE evaluation_id=ev
 AND splice_id=extra AND state='held' AND 'splice_extra_endpoint_conductor'=ANY(blockers)) THEN
 RAISE EXCEPTION 'Undeclared endpoint conductor silently became a splice member'; END IF;
END $$;
ROLLBACK;

-- Source changes invalidate both forms of demand under the same published cursor.
BEGIN;
UPDATE public.catalog_parts SET part_number='DEMAND-HOUSING-REVISED' WHERE part_number='DEMAND-HOUSING';
DO $$
DECLARE ev uuid;
BEGIN
 IF public.harness_evaluated_model((SELECT vehicle_id FROM demand_fixture))->>'current'<>'false' THEN
 RAISE EXCEPTION 'Catalog change left component evaluation current'; END IF;
 ev:=pg_temp.fold_current();
 IF NOT EXISTS(SELECT FROM public.harness_model_component_requirements WHERE evaluation_id=ev AND role='connector_housing'
 AND state='held' AND 'catalog_part_number_conflict'=ANY(blockers)) THEN RAISE EXCEPTION 'Exact catalog revision mismatch lost'; END IF;
END $$;
ROLLBACK;

BEGIN;
UPDATE public.harness_model_rules SET is_current=false,superseded_at=clock_timestamp() WHERE rule_key='component_quantity_basis';
DO $$
DECLARE r jsonb;
BEGIN
 r:=public.harness_model_fold((SELECT vehicle_id FROM demand_fixture));
 IF r->>'status'<>'error' OR r->>'error_code'<>'22023' THEN RAISE EXCEPTION 'Missing component rule became success: %',r; END IF;
 IF public.harness_evaluated_model((SELECT vehicle_id FROM demand_fixture))->>'current'<>'false' THEN
 RAISE EXCEPTION 'Partial rule catalog left old results current'; END IF;
END $$;
ROLLBACK;

DO $$
DECLARE ev uuid:=pg_temp.fold_current(); q public.harness_model_component_requirements; f demand_fixture%ROWTYPE;
BEGIN
 SELECT * INTO f FROM demand_fixture;
 SELECT * INTO q FROM public.harness_model_component_requirements WHERE evaluation_id=ev AND role='connector_housing' LIMIT 1;
 BEGIN
  UPDATE public.harness_model_component_requirements SET quantity=2 WHERE evaluation_id=ev AND id=q.id;
  RAISE EXCEPTION 'immutable requirement changed' USING ERRCODE='XX001';
 EXCEPTION WHEN OTHERS THEN IF SQLSTATE='XX001' THEN RAISE; END IF; END;
 BEGIN
  INSERT INTO public.harness_model_component_contributors(evaluation_id,requirement_id,segment_id,termination_id,circuit_id)
  SELECT ev,q.id,s.id,s.from_termination_id,s.vehicle_custom_circuit_id FROM public.harness_segments s WHERE s.id=f.segment_ground;
  RAISE EXCEPTION 'wrong-owner edge accepted' USING ERRCODE='XX001';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  INSERT INTO public.harness_model_component_requirements(evaluation_id,id,demand_key,role,termination_id,quantity,unit,state,blockers)
  SELECT ev,gen_random_uuid(),'crossvehicle','terminal_contact',t.id,NULL,'each','held',ARRAY['test']
  FROM public.wire_termination_specs t WHERE t.vehicle_id<>f.vehicle_id LIMIT 1;
  RAISE EXCEPTION 'crossvehicle component accepted' USING ERRCODE='XX001';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

GRANT SELECT ON integration_result TO anon,authenticated;
SET ROLE anon;
DO $$ BEGIN
 IF public.harness_manual_index((SELECT vehicle_id FROM demand_fixture))->>'status'<>'current' THEN
 RAISE EXCEPTION 'Public component reader lost visible source rows'; END IF;
 BEGIN
  PERFORM input_snapshot FROM public.harness_model_evaluations LIMIT 1;
  RAISE EXCEPTION 'Public acquired private source receipt' USING ERRCODE='XX001';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.harness_model_fold((SELECT vehicle_id FROM demand_fixture));
  RAISE EXCEPTION 'Public acquired fold writer' USING ERRCODE='XX001';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
BEGIN;
UPDATE public.vehicles SET is_public=false WHERE id=(SELECT vehicle_id FROM demand_fixture);
SET ROLE anon;
DO $$ BEGIN
 IF EXISTS(SELECT FROM public.harness_model_component_requirements q WHERE q.evaluation_id=(SELECT (result->>'evaluation_id')::uuid FROM integration_result)) THEN
 RAISE EXCEPTION 'Private component requirements visible'; END IF;
 IF public.harness_manual_index((SELECT vehicle_id FROM demand_fixture))->>'status'<>'unavailable' THEN
 RAISE EXCEPTION 'Private model visible'; END IF;
END $$;
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('test.auth_uid','00000000-0000-0000-0000-000000007777',true),set_config('test.auth_jwt','{"is_anonymous":true}',true);
DO $$ BEGIN
 IF EXISTS(SELECT FROM public.harness_model_component_requirements q WHERE q.evaluation_id=(SELECT (result->>'evaluation_id')::uuid FROM integration_result)) THEN
 RAISE EXCEPTION 'Anonymous owner saw private component result'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'persisted component integration: PASS';

-- Bounded public drawing and collection readers use those same persisted rows.
SET ROLE anon;
DO $$
DECLARE v uuid:=(SELECT vehicle_id FROM demand_fixture); eid uuid; sid uuid; r jsonb; p jsonb;
 kind text; cursor_ text; seen text[]; key_ text; expected int; n int;
BEGIN
 r:=public.harness_manual_index(v);
 IF r->>'status' IS DISTINCT FROM 'current' THEN RAISE EXCEPTION 'Public component index unavailable'; END IF;
 eid:=(r#>>'{evaluation,id}')::uuid; sid:=(r#>>'{sheets,0,id}')::uuid;
 r:=public.harness_manual_sheet(v,eid,sid);
 IF r->>'status' IS DISTINCT FROM 'current' OR (r#>>'{model,component_requirement_count}')::int<1
 OR jsonb_array_length(r#>'{model,component_role_coverage}')<>6
 OR (r#>>'{model,component_requirements_complete}')::boolean IS DISTINCT FROM true
 OR (r#>>'{model,component_contributors_complete}')::boolean IS DISTINCT FROM true
 OR EXISTS(SELECT FROM jsonb_array_elements(r#>'{model,component_contributors}') x
 WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(r#>'{model,segments}') s WHERE s->>'id'=x->>'segment_id'))
 OR EXISTS(SELECT FROM jsonb_array_elements(r#>'{model,model_checks}') k WHERE k->>'component_requirement_id' IS NOT NULL
 AND NOT EXISTS(SELECT FROM jsonb_array_elements(r#>'{model,component_requirements}') q WHERE q->>'id'=k->>'component_requirement_id'))
 THEN RAISE EXCEPTION 'Sheet included foreign component edges or lost complete scoped demand'; END IF;
 FOREACH kind IN ARRAY ARRAY['component_requirements','component_contributors'] LOOP
  cursor_:=NULL; seen:='{}'; n:=0;
  expected:=(r#>>ARRAY['model',CASE kind WHEN 'component_requirements' THEN 'component_requirement_count' ELSE 'component_contributor_count' END])::int;
  LOOP
   p:=public.harness_model_collection_page(v,eid,kind,cursor_,1);
   IF p->>'status' IS DISTINCT FROM 'available' OR p->>'qualification' IS DISTINCT FROM 'immutable_evaluation_page_recheck_manifest'
   OR jsonb_array_length(p->'rows')>1 THEN RAISE EXCEPTION 'Invalid bounded component collection page'; END IF;
   FOR key_ IN SELECT CASE kind WHEN 'component_requirements' THEN x->>'id'
    ELSE x->>'requirement_id'||'/'||(x->>'segment_id')||'/'||(x->>'termination_id') END FROM jsonb_array_elements(p->'rows') x LOOP
    IF key_=ANY(seen) THEN RAISE EXCEPTION 'Duplicate component collection key'; END IF;
    seen:=array_append(seen,key_);n:=n+1;
   END LOOP;
   EXIT WHEN p->>'next_after' IS NULL;
   IF cursor_ IS NOT NULL AND p->>'next_after'<=cursor_ THEN RAISE EXCEPTION 'Component cursor failed to advance'; END IF;
   cursor_:=p->>'next_after';
   IF n>100 THEN RAISE EXCEPTION 'Small synthetic collection failed to terminate'; END IF;
  END LOOP;
  IF n<>expected THEN RAISE EXCEPTION 'Component keyset walk lost rows: %, got%, expected%',kind,n,expected; END IF;
 END LOOP;
 BEGIN
  PERFORM public.harness_evaluated_model(v);
  RAISE EXCEPTION 'Anonymous bulk diagnostic permission widened' USING ERRCODE='XX001';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- New end-accounting holds must reach the component contributor qualification.
BEGIN;
INSERT INTO public.wire_termination_specs(id,vehicle_id,circuit_id,endpoint_id,cavity)
 SELECT md5('component source extra end')::uuid,vehicle_id,circuit_a,endpoint_a,'EXTRA' FROM demand_fixture;
DO $$
DECLARE ev uuid:=pg_temp.fold_current();
BEGIN
 IF EXISTS(SELECT FROM public.harness_model_component_requirements q JOIN public.harness_model_component_contributors c
 ON c.evaluation_id=q.evaluation_id AND c.requirement_id=q.id WHERE q.evaluation_id=ev
 AND c.segment_id=(SELECT segment_a FROM demand_fixture) AND q.state='provisional')
 THEN RAISE EXCEPTION 'Circuit end-accounting hold disappeared from components'; END IF;
 IF NOT EXISTS(SELECT FROM public.harness_model_component_requirements q WHERE q.evaluation_id=ev
 AND q.role='connector_housing' AND q.quantity=1 AND q.state='held' AND 'physical_source_unresolved'=ANY(q.blockers))
 THEN RAISE EXCEPTION 'Known positive housing count vanished instead of remaining held'; END IF;
END $$;
ROLLBACK;

-- Source ambiguity can produce many held component rows. The drawing must
-- expose overflow, and the separate exact-evaluation pages retain every row.
BEGIN;
INSERT INTO public.harness_splices(id,vehicle_id,splice_code,placement,endpoint_id,part_id,part_number)
 SELECT md5('component overflow splice '||i)::uuid,f.vehicle_id,'OVERFLOW-'||i,'stub',f.endpoint_splice,
 (SELECT id FROM public.catalog_parts WHERE part_number='DEMAND-SPLICE'),'DEMAND-SPLICE'
 FROM demand_fixture f CROSS JOIN generate_series(1,105) i;
INSERT INTO public.harness_splice_members(splice_id,circuit_id,ordinal,member_label)
 SELECT md5('component overflow splice '||i)::uuid,f.circuit_a,1,'only A declared'
 FROM demand_fixture f CROSS JOIN generate_series(1,105) i;
DO $$
DECLARE ev uuid:=pg_temp.fold_current(); sid uuid; r jsonb;
BEGIN
 SELECT sheet_id INTO sid FROM public.harness_model_sheet_members WHERE evaluation_id=ev AND segment_id=(SELECT segment_a FROM demand_fixture);
 r:=public.harness_manual_sheet((SELECT vehicle_id FROM demand_fixture),ev,sid);
 IF r->>'status' IS DISTINCT FROM 'current' OR jsonb_array_length(r#>'{model,component_requirements}')<>100
 OR jsonb_array_length(r#>'{model,component_contributors}')<>100
 OR (r#>>'{model,component_requirements_complete}')::boolean IS DISTINCT FROM false
 OR (r#>>'{model,component_contributors_complete}')::boolean IS DISTINCT FROM false
 OR (r#>>'{model,component_requirement_count}')::int<=100 OR (r#>>'{model,component_contributor_count}')::int<=100
 THEN RAISE EXCEPTION 'Component overflow became unbounded or falsely complete'; END IF;
 IF EXISTS(SELECT FROM public.harness_model_component_requirements q WHERE q.evaluation_id=ev
 AND q.splice_id IN(SELECT md5('component overflow splice '||i)::uuid FROM generate_series(1,105)i) AND q.state='provisional')
 THEN RAISE EXCEPTION 'Undeclared endpoint conductors were hidden in overflow'; END IF;
END $$;
ROLLBACK;

-- A missing visible component child invalidates the entire qualified drawing,
-- rather than making the BOM look smaller. Source and immutable epoch are unchanged.
DO $$
DECLARE hidden uuid;
BEGIN
 SELECT q.id INTO hidden FROM public.harness_model_component_requirements q JOIN public.harness_model_state s
 ON s.latest_evaluation_id=q.evaluation_id WHERE s.vehicle_id=(SELECT vehicle_id FROM demand_fixture) AND q.role='connector_housing' LIMIT 1;
 EXECUTE format('CREATE POLICY component_fixture_hide_one ON public.harness_model_component_requirements AS RESTRICTIVE FOR SELECT TO anon USING(id<>%L::uuid)',hidden);
END $$;
SET ROLE anon;
DO $$
DECLARE r jsonb;
BEGIN
 r:=public.harness_manual_index((SELECT vehicle_id FROM demand_fixture));
 IF r->>'status' IS DISTINCT FROM 'incomplete_visibility' OR r->'evaluation' IS DISTINCT FROM 'null'::jsonb
 THEN RAISE EXCEPTION 'Hidden component child left a current complete index'; END IF;
END $$;
RESET ROLE;
DROP POLICY component_fixture_hide_one ON public.harness_model_component_requirements;

-- Nullable unresolved endpoint: keep every recorded assigned role under the
-- exact end identity, held, rather than aborting the whole evaluation.
BEGIN;
UPDATE public.wire_termination_specs SET endpoint_id=NULL WHERE id=(SELECT end_a1 FROM demand_fixture);
DO $$
DECLARE ev uuid:=pg_temp.fold_current();
BEGIN
 IF (SELECT count(*) FROM public.harness_model_component_requirements q WHERE q.evaluation_id=ev
 AND q.termination_id=(SELECT end_a1 FROM demand_fixture) AND q.id IS NOT NULL AND q.demand_key IS NOT NULL
 AND q.endpoint_id IS NULL AND q.state='held' AND 'endpoint_unresolved'=ANY(q.blockers))<>5
 THEN RAISE EXCEPTION 'Unresolved endpoint lost recorded contact/seal/housing/wedge/boot demand'; END IF;
 IF (SELECT count(*) FROM public.harness_model_component_contributors c JOIN public.harness_model_component_requirements q
 ON q.evaluation_id=c.evaluation_id AND q.id=c.requirement_id WHERE c.evaluation_id=ev
 AND q.termination_id=(SELECT end_a1 FROM demand_fixture) AND c.segment_id=(SELECT segment_a FROM demand_fixture))<>5
 THEN RAISE EXCEPTION 'Unresolved endpoint lost exact contributor edges'; END IF;
END $$;
ROLLBACK;

-- The existing splice owner normalizes A02/A_002 to A2. Apply that same
-- convention in material grouping/reach and the persisted contributor guard.
BEGIN;
UPDATE public.wire_termination_specs SET cavity=CASE WHEN id=(SELECT end_a1 FROM demand_fixture) THEN 'A02' ELSE 'A_002' END
 WHERE id IN((SELECT end_a1 FROM demand_fixture),(SELECT end_a2 FROM demand_fixture));
INSERT INTO public.harness_splices(id,vehicle_id,splice_code,placement,endpoint_id,cavity,part_number,part_id)
 SELECT md5('component at-pin normalized splice')::uuid,vehicle_id,'NORMALIZED-PIN','at_pin',endpoint_a,'A2',
 'DEMAND-SPLICE',(SELECT id FROM public.catalog_parts WHERE part_number='DEMAND-SPLICE') FROM demand_fixture;
INSERT INTO public.harness_splice_members(splice_id,circuit_id,ordinal,member_label)
 SELECT md5('component at-pin normalized splice')::uuid,circuit_a,1,'A' FROM demand_fixture
 UNION ALL SELECT md5('component at-pin normalized splice')::uuid,circuit_b,2,'B' FROM demand_fixture;
DO $$
DECLARE ev uuid:=pg_temp.fold_current(); q uuid; r jsonb; sid uuid;
BEGIN
 SELECT id INTO STRICT q FROM public.harness_model_component_requirements WHERE evaluation_id=ev
 AND splice_id=md5('component at-pin normalized splice')::uuid;
 IF (SELECT count(*) FROM public.harness_model_component_contributors WHERE evaluation_id=ev AND requirement_id=q)<>2
 OR EXISTS(SELECT FROM public.harness_model_component_requirements WHERE evaluation_id=ev AND id=q
 AND blockers && ARRAY['splice_member_endpoint_unresolved','splice_member_unmodeled'])
 THEN RAISE EXCEPTION 'Established at-pin cavity normalization lost exact physical reach'; END IF;
 IF NOT EXISTS(SELECT FROM public.harness_model_component_requirements WHERE evaluation_id=ev
 AND endpoint_id=(SELECT endpoint_a FROM demand_fixture) AND role='terminal_contact' AND state='held'
 AND quantity IS NULL AND 'shared_contact_quantity_unresolved'=ANY(blockers))
 THEN RAISE EXCEPTION 'One normalized shared pin was counted as two contact assemblies'; END IF;
 SELECT sheet_id INTO sid FROM public.harness_model_sheet_members WHERE evaluation_id=ev AND segment_id=(SELECT segment_a FROM demand_fixture);
 r:=public.harness_manual_sheet((SELECT vehicle_id FROM demand_fixture),ev,sid);
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(r#>'{model,component_requirements}') x WHERE x->>'id'=q::text)
 THEN RAISE EXCEPTION 'Normalized at-pin splice disappeared from the drawing'; END IF;
END $$;
-- Case is an identity distinction (for example D38999 F/f), never normalized.
UPDATE public.wire_termination_specs SET cavity='a02' WHERE id=(SELECT end_a2 FROM demand_fixture);
DO $$
DECLARE ev uuid:=pg_temp.fold_current(); q uuid;
BEGIN
 SELECT id INTO STRICT q FROM public.harness_model_component_requirements WHERE evaluation_id=ev
 AND splice_id=md5('component at-pin normalized splice')::uuid;
 IF (SELECT count(*) FROM public.harness_model_component_contributors WHERE evaluation_id=ev AND requirement_id=q)<>1
 OR NOT EXISTS(SELECT FROM public.harness_model_component_requirements WHERE evaluation_id=ev AND id=q
 AND state='held' AND 'splice_member_endpoint_unresolved'=ANY(blockers))
 THEN RAISE EXCEPTION 'Differently cased at-pin claims were silently joined'; END IF;
END $$;
ROLLBACK;
-- Separate splice groups can share a connector pin. Declared membership
-- separates their contributor edges; an actually unassigned conductor is held.
BEGIN;
UPDATE public.wire_termination_specs SET cavity='A02' WHERE id=(SELECT end_a1 FROM demand_fixture);
UPDATE public.wire_termination_specs SET cavity='A_002' WHERE id=(SELECT end_a2 FROM demand_fixture);
INSERT INTO public.harness_splices(id,vehicle_id,splice_code,placement,endpoint_id,cavity,part_number,part_id)
 SELECT md5('component pin group A')::uuid,vehicle_id,'PIN-GROUP-A','at_pin',endpoint_a,'A2',
 'DEMAND-SPLICE',(SELECT id FROM public.catalog_parts WHERE part_number='DEMAND-SPLICE') FROM demand_fixture
 UNION ALL SELECT md5('component pin group B')::uuid,vehicle_id,'PIN-GROUP-B','at_pin',endpoint_a,'A2',
 'DEMAND-SPLICE',(SELECT id FROM public.catalog_parts WHERE part_number='DEMAND-SPLICE') FROM demand_fixture;
INSERT INTO public.harness_splice_members(splice_id,circuit_id,ordinal,member_label)
 SELECT md5('component pin group A')::uuid,circuit_a,1,'A' FROM demand_fixture
 UNION ALL SELECT md5('component pin group B')::uuid,circuit_b,1,'B' FROM demand_fixture;
DO $$
DECLARE ev uuid:=pg_temp.fold_current(); q uuid; f demand_fixture%ROWTYPE;
BEGIN
 SELECT * INTO f FROM demand_fixture;
 IF (SELECT count(*) FROM public.harness_model_component_requirements WHERE evaluation_id=ev
 AND splice_id IN(md5('component pin group A')::uuid,md5('component pin group B')::uuid))<>2
 OR EXISTS(SELECT FROM public.harness_model_component_requirements WHERE evaluation_id=ev
 AND splice_id IN(md5('component pin group A')::uuid,md5('component pin group B')::uuid)
 AND blockers && ARRAY['splice_extra_endpoint_conductor','splice_member_endpoint_unresolved'])
 THEN RAISE EXCEPTION 'Separate declared splice groups at one pin contaminated each other'; END IF;
 IF (SELECT count(*) FROM public.harness_model_component_contributors c JOIN public.harness_model_component_requirements r
 ON r.evaluation_id=c.evaluation_id AND r.id=c.requirement_id WHERE c.evaluation_id=ev
 AND ((r.splice_id=md5('component pin group A')::uuid AND c.circuit_id=f.circuit_a)
 OR (r.splice_id=md5('component pin group B')::uuid AND c.circuit_id=f.circuit_b)))<>2
 OR (SELECT count(*) FROM public.harness_model_component_contributors c JOIN public.harness_model_component_requirements r
 ON r.evaluation_id=c.evaluation_id AND r.id=c.requirement_id WHERE c.evaluation_id=ev
 AND r.splice_id IN(md5('component pin group A')::uuid,md5('component pin group B')::uuid))<>2
 THEN RAISE EXCEPTION 'Pin groups lost exact declared contributor conservation'; END IF;
 SELECT id INTO STRICT q FROM public.harness_model_component_requirements WHERE evaluation_id=ev AND splice_id=md5('component pin group A')::uuid;
 BEGIN
  INSERT INTO public.harness_model_component_contributors(evaluation_id,requirement_id,segment_id,termination_id,circuit_id)
  VALUES(ev,q,f.segment_b,f.end_a2,f.circuit_b);
  RAISE EXCEPTION 'Scope guard accepted a neighboring pin-group contributor';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;
DELETE FROM public.harness_splice_members WHERE splice_id=md5('component pin group B')::uuid;
DO $$
DECLARE ev uuid:=pg_temp.fold_current();
BEGIN
 IF NOT EXISTS(SELECT FROM public.harness_model_component_requirements WHERE evaluation_id=ev
 AND splice_id=md5('component pin group A')::uuid AND state='held' AND 'splice_extra_endpoint_conductor'=ANY(blockers))
 THEN RAISE EXCEPTION 'An actually unassigned pin conductor disappeared from qualification'; END IF;
END $$;
ROLLBACK;
SELECT 'test_harness_component_requirements: PASS' AS result;

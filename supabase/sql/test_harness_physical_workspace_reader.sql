-- Disposable PG17; actual reader and actual physical writers, not a mocked response.
\set ON_ERROR_STOP on
\i supabase/sql/test_harness_segment_material_revisions.sql

-- Fill historical fixture stubs out to the live columns this reader selects.
ALTER TABLE public.vehicle_custom_circuits
  ADD COLUMN IF NOT EXISTS is_shielded boolean,
  ADD COLUMN IF NOT EXISTS harness_section text,
  ADD COLUMN IF NOT EXISTS method text;
ALTER TABLE public.wire_termination_specs
  ADD COLUMN IF NOT EXISTS wire_code text,
  ADD COLUMN IF NOT EXISTS cavity_layout_id uuid,
  ADD COLUMN IF NOT EXISTS terminal_contact_pn text,
  ADD COLUMN IF NOT EXISTS terminal_contact_catalog_id uuid,
  ADD COLUMN IF NOT EXISTS pin_seal_pn text,
  ADD COLUMN IF NOT EXISTS pin_seal_catalog_id uuid,
  ADD COLUMN IF NOT EXISTS crimp_tool_pn text,
  ADD COLUMN IF NOT EXISTS crimp_tool_catalog_id uuid,
  ADD COLUMN IF NOT EXISTS connector_housing_pn text,
  ADD COLUMN IF NOT EXISTS connector_housing_catalog_id uuid,
  ADD COLUMN IF NOT EXISTS wedge_lock_pn text,
  ADD COLUMN IF NOT EXISTS wedge_lock_catalog_id uuid,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS method text,
  ADD COLUMN IF NOT EXISTS observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS trust text,
  ADD COLUMN IF NOT EXISTS superseded_by uuid;
ALTER TABLE public.harness_endpoints
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS family text,
  ADD COLUMN IF NOT EXISTS harness_section text,
  ADD COLUMN IF NOT EXISTS design_status text,
  ADD COLUMN IF NOT EXISTS work_status text,
  ADD COLUMN IF NOT EXISTS part_number text,
  ADD COLUMN IF NOT EXISTS catalog_part_id uuid,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS method text,
  ADD COLUMN IF NOT EXISTS observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS trust text,
  ADD COLUMN IF NOT EXISTS topology_node_id uuid,
  ADD COLUMN IF NOT EXISTS superseded_by uuid;
ALTER TABLE public.vehicle_harness_landmarks
  ADD COLUMN IF NOT EXISTS landmark_code text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS method text,
  ADD COLUMN IF NOT EXISTS from_node_id uuid,
  ADD COLUMN IF NOT EXISTS to_node_id uuid,
  ADD COLUMN IF NOT EXISTS polyline_m jsonb,
  ADD COLUMN IF NOT EXISTS source_file text,
  ADD COLUMN IF NOT EXISTS derived_on date,
  ADD COLUMN IF NOT EXISTS superseded_by uuid;
ALTER TABLE public.harness_topology_nodes
  ADD COLUMN IF NOT EXISTS kind text,
  ADD COLUMN IF NOT EXISTS pos_z_m numeric,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS method text,
  ADD COLUMN IF NOT EXISTS observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS trust text,
  ADD COLUMN IF NOT EXISTS superseded_by uuid;

GRANT SELECT ON public.harness_topology_nodes, public.vehicle_harness_landmarks TO anon, authenticated;
\i supabase/migrations/20261125233333_harness_physical_workspace_reader.sql

CREATE TEMP TABLE workspace_fixture (vehicle_id uuid, circuit_id uuid, net_id uuid, design_id uuid,
  first_segment uuid, second_segment uuid, first_endpoint uuid, second_endpoint uuid, third_endpoint uuid, fourth_endpoint uuid);
DO $fixture$
DECLARE v uuid := gen_random_uuid(); o uuid := gen_random_uuid(); d uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  n uuid := gen_random_uuid(); a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); e uuid := gen_random_uuid(); f uuid := gen_random_uuid();
  ta uuid := gen_random_uuid(); tb uuid := gen_random_uuid(); te uuid := gen_random_uuid(); tf uuid := gen_random_uuid();
  s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.vehicles(id,is_public,user_id) VALUES(v,true,'00000000-0000-0000-0000-000000007777');
  INSERT INTO public.vehicle_wiring_overlays(id,vehicle_id) VALUES(o,v);
  INSERT INTO public.harness_designs(id,vehicle_id) VALUES(d,v);
  INSERT INTO public.harness_endpoints(id,design_id,code,name,endpoint_type) VALUES
    (a,d,'M130-B','ECU','connector'),(b,d,'FIREWALL-CABIN','Cabin half','connector'),
    (e,d,'FIREWALL-ENGINE','Engine half','connector'),(f,d,'CLT-ECU','Coolant temperature','connector');
  UPDATE public.harness_endpoints SET mates_with_endpoint_id=e WHERE id=b;
  UPDATE public.harness_endpoints SET mates_with_endpoint_id=b WHERE id=e;
  INSERT INTO public.vehicle_custom_circuits(id,overlay_id,circuit_code,circuit_name,design_status,build_state,
    wire_type,wire_gauge_awg,wire_color,source,observed_at,trust,checks,checked_at,checks_version)
  VALUES(c,o,'110','Two-piece fixture','decided','uncut','M22759/32',18,'red','private fixture provenance',now(),'T3',
    '{"R8":["PASS","historical fixture"]}',now(),'fixture-import');
  INSERT INTO public.wire_termination_specs(id,vehicle_id,circuit_id,endpoint_id,cavity) VALUES
    (ta,v,c,a,'B04'),(tb,v,c,b,'w'),(te,v,c,e,'w'),(tf,v,c,f,'2?');
  INSERT INTO public.harness_nets(id,vehicle_id,net_code,source,method,observed_at,trust)
    VALUES(n,v,'110','fixture','fixture',now(),'T3');
  INSERT INTO public.harness_segments(id,vehicle_id,net_id,vehicle_custom_circuit_id,from_termination_id,to_termination_id,
    gauge_awg,colour,wire_part_id,planned_length_ft,planned_length_method,source,method,observed_at,trust) VALUES
    (s1,v,n,c,ta,tb,18,'red',(SELECT id FROM public.catalog_parts WHERE part_number='M22759/32-18-2'),1.09,'fixture estimate','fixture','fixture',now(),'T3'),
    (s2,v,n,c,te,tf,18,'red',(SELECT id FROM public.catalog_parts WHERE part_number='M22759/32-18-2'),3.54,'fixture estimate','fixture','fixture',now(),'T3');
  INSERT INTO workspace_fixture VALUES(v,c,n,d,s1,s2,a,b,e,f);
END $fixture$;

DO $physical$
DECLARE f workspace_fixture%ROWTYPE; p jsonb; again jsonb;
BEGIN
  SELECT * INTO f FROM workspace_fixture;
  p := public.harness_schematic_model(f.vehicle_id);
  IF p::text LIKE '%private fixture provenance%' THEN RAISE EXCEPTION 'elevated shared reader leaked prose'; END IF;
  again := public.harness_schematic_model(f.vehicle_id);
  IF p->>'snapshot_key' IS DISTINCT FROM again->>'snapshot_key' THEN RAISE EXCEPTION 'unchanged snapshot hash changed'; END IF;
  IF jsonb_array_length(p->'segments')<>2 OR jsonb_array_length(p->'ends')<>4 OR jsonb_array_length(p->'mates')<>1
    OR (p#>>'{counts,current_circuits}')::int<>1 THEN RAISE EXCEPTION 'physical grains wrong: %',p->'counts'; END IF;
  IF (p#>>'{counts,current_plan_segments}')::int<>2 THEN RAISE EXCEPTION 'decided plan membership missing'; END IF;
  UPDATE public.harness_segments SET design_status='contradicted' WHERE id=f.second_segment;
  again := public.harness_schematic_model(f.vehicle_id);
  IF (again#>>'{counts,current_plan_segments}')::int<>1 OR jsonb_array_length(again->'segments')<>2
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(again->'segments') x WHERE x->>'id'=f.second_segment::text
      AND x->>'in_current_plan'='false' AND x->>'design_status'='contradicted')
    THEN RAISE EXCEPTION 'contradicted piece mixed into current plan or hidden'; END IF;
  UPDATE public.harness_segments SET design_status='decided' WHERE id=f.second_segment;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'segments') x WHERE x->>'id'=f.first_segment::text
    AND (x->>'planned_length_ft')::numeric=1.09 AND x->>'measured_length_ft' IS NULL)
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'segments') x WHERE x->>'id'=f.second_segment::text
    AND (x->>'planned_length_ft')::numeric=3.54) THEN RAISE EXCEPTION 'piece lengths collapsed or claimed measured'; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'ends') x WHERE x->>'cavity'='2?') THEN RAISE EXCEPTION 'uncertainty stripped'; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'circuits') x WHERE x->>'check_applicability' IN ('unbound','invalidated'))
    THEN RAISE EXCEPTION 'legacy PASS became current'; END IF;
  UPDATE public.harness_segments SET planned_length_ft=NULL WHERE id=f.second_segment;
  again := public.harness_schematic_model(f.vehicle_id);
  IF again->>'snapshot_key'=p->>'snapshot_key' OR (again#>>'{counts,segments_with_planned_length}')::int<>1
    THEN RAISE EXCEPTION 'missing length or input change not represented'; END IF;
  -- The preceding real model contract left a cut piece with its old source superseded.
  SELECT public.harness_schematic_model(vehicle_id) INTO p FROM material_fixture WHERE name='physical';
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'segments') x
    WHERE x->>'build_state'='cut' AND x->'blockers' ? 'physical_revision_hold')
    THEN RAISE EXCEPTION 'retained built revision vanished'; END IF;
END $physical$;

-- Reader must contain pre-existing malformed relations even when another vehicle is public.
DO $cross_vehicle$
DECLARE f workspace_fixture%ROWTYPE; other_design uuid; p jsonb;
BEGIN
  SELECT * INTO f FROM workspace_fixture;
  SELECT design_id INTO other_design FROM material_fixture WHERE name='physical';
  UPDATE public.harness_endpoints SET design_id=other_design,name='FOREIGN_DETAIL_MUST_NOT_LEAK' WHERE id=f.first_endpoint;
  p := public.harness_schematic_model(f.vehicle_id);
  IF p::text LIKE '%FOREIGN_DETAIL_MUST_NOT_LEAK%' THEN RAISE EXCEPTION 'other public vehicle detail leaked'; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'segments') x WHERE x->>'id'=f.first_segment::text
    AND x->>'from_termination_id' IS NULL AND x->'blockers' ? 'from_termination_unresolved') THEN RAISE EXCEPTION 'bad reference silently disappeared'; END IF;
  UPDATE public.harness_endpoints SET design_id=f.design_id,name='ECU' WHERE id=f.first_endpoint;
END $cross_vehicle$;

-- A successor design cannot claim its predecessor's already-cut piece as its own.
DO $retained_source$
DECLARE f material_fixture%ROWTYPE; successor uuid:=gen_random_uuid(); p jsonb;
BEGIN
  SELECT * INTO f FROM material_fixture WHERE name='physical';
  INSERT INTO public.vehicle_custom_circuits(id,overlay_id,circuit_code,circuit_name,design_status,
    build_state,wire_type,wire_gauge_awg,wire_color,from_endpoint_id,to_endpoint_id,source,observed_at,trust)
  VALUES(successor,f.overlay_id,'23','new source for retained physical fixture','decided','uncut',
    'M22759/32',18,'red',f.from_plug,f.to_plug,'fixture',now(),'T3');
  UPDATE public.vehicle_custom_circuits SET superseded_by=successor WHERE id=f.circuit_id;
  INSERT INTO public.wire_termination_specs(vehicle_id,circuit_id,endpoint_id,cavity) VALUES
    (f.vehicle_id,successor,f.from_plug,'1'),(f.vehicle_id,successor,f.to_plug,'2');
  p:=public.harness_schematic_model(f.vehicle_id);
  IF (p#>>'{counts,current_circuits}')::int<>1
    OR (p#>>'{counts,current_circuits_without_segments}')::int<>1
    OR (p#>>'{counts,current_plan_segments}')::int<>0
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'segments') s
      WHERE s->>'circuit_id'=f.circuit_id::text AND s->>'current_circuit_id'=successor::text
        AND s->>'in_current_plan'='false' AND s->>'build_state'='cut')
  THEN RAISE EXCEPTION 'retained old piece falsely counted for its successor'; END IF;
END $retained_source$;

-- Same vehicle is necessary but not sufficient: an end must belong to this source circuit.
DO $wrong_circuit_end$
DECLARE f workspace_fixture%ROWTYPE; other_circuit uuid:=gen_random_uuid(); end_id uuid; before_read jsonb; p jsonb;
BEGIN
  SELECT * INTO f FROM workspace_fixture;
  SELECT from_termination_id INTO end_id FROM public.harness_segments WHERE id=f.first_segment;
  INSERT INTO public.vehicle_custom_circuits(id,overlay_id,circuit_code,circuit_name,design_status,
    wire_type,wire_gauge_awg,wire_color)
  SELECT other_circuit,overlay_id,'110-OTHER','different source circuit','decided',wire_type,wire_gauge_awg,wire_color
    FROM public.vehicle_custom_circuits WHERE id=f.circuit_id;
  before_read:=public.harness_schematic_model(f.vehicle_id);
  UPDATE public.wire_termination_specs SET circuit_id=other_circuit WHERE id=end_id;
  p:=public.harness_schematic_model(f.vehicle_id);
  IF p->>'snapshot_key'=before_read->>'snapshot_key'
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'segments') s
      WHERE s->>'id'=f.first_segment::text AND s->>'from_termination_id' IS NULL
        AND s->'blockers' ? 'from_termination_unresolved' AND s->>'link_state'='stale')
  THEN RAISE EXCEPTION 'same-vehicle wrong-circuit end appears resolved'; END IF;
  UPDATE public.wire_termination_specs SET circuit_id=f.circuit_id WHERE id=end_id;
  UPDATE public.vehicle_custom_circuits SET is_superseded=true WHERE id=other_circuit;
END $wrong_circuit_end$;

-- Meaning is owned by harness_signals, reached through the net, not by a same-code circuit.
DO $signal_ownership$
DECLARE f workspace_fixture%ROWTYPE; g uuid:=gen_random_uuid(); foreign_g uuid:=gen_random_uuid();
  other_vehicle uuid; observation uuid:=gen_random_uuid(); valid_edge uuid:=gen_random_uuid();
  wrong_kind_edge uuid:=gen_random_uuid(); p jsonb;
BEGIN
  SELECT * INTO f FROM workspace_fixture;
  SELECT vehicle_id INTO other_vehicle FROM material_fixture WHERE name='physical';
  INSERT INTO public.harness_signals(id,vehicle_id,signal_key,name,signal_type,source,method,observed_at,trust) VALUES
    (g,f.vehicle_id,'110','coolant meaning','analog','private signal source','fixture',now(),'T3'),
    (foreign_g,other_vehicle,'foreign-fixture','FOREIGN_SIGNAL_MUST_NOT_LEAK','analog','fixture','fixture',now(),'T3');
  INSERT INTO public.vehicle_observations(id,vehicle_id,source_identifier,structured_data)
  VALUES(observation,f.vehicle_id,'synthetic signal contract','{"domain":"wiring"}');
  INSERT INTO public.harness_evidence(id,vehicle_id,observation_id,row_kind,row_id,field,relation) VALUES
    (valid_edge,f.vehicle_id,observation,'signal',g,'meaning','supports'),
    (wrong_kind_edge,f.vehicle_id,observation,'signal',f.circuit_id,'meaning','supports');
  UPDATE public.harness_nets SET signal_id=g WHERE id=f.net_id;
  p:=public.harness_schematic_model(f.vehicle_id);
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'signals') x WHERE x->>'id'=g::text)
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'nets') x WHERE x->>'id'=f.net_id::text AND x->>'signal_id'=g::text)
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'evidence_edges') x WHERE x->>'id'=valid_edge::text)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p->'evidence_edges') x WHERE x->>'id'=wrong_kind_edge::text)
    OR p::text LIKE '%private signal source%'
  THEN RAISE EXCEPTION 'signal key/prose/evidence ownership incorrect'; END IF;
  BEGIN
    UPDATE public.harness_signals SET is_superseded=true WHERE id=g;
    UPDATE public.harness_nets SET is_superseded=true WHERE id=f.net_id;
    p:=public.harness_schematic_model(f.vehicle_id);
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'signals') x WHERE x->>'id'=g::text AND x->>'is_superseded'='true')
      OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'nets') x WHERE x->>'id'=f.net_id::text AND x->>'signal_link_state'='retained')
    THEN RAISE EXCEPTION 'retained signal through retained net disappeared'; END IF;
    RAISE SQLSTATE 'Z0001';
  EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL; END;
  UPDATE public.harness_nets SET signal_id=foreign_g WHERE id=f.net_id;
  p:=public.harness_schematic_model(f.vehicle_id);
  IF p::text LIKE '%FOREIGN_SIGNAL_MUST_NOT_LEAK%'
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p->'signals') x WHERE x->>'id'=foreign_g::text)
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'nets') x WHERE x->>'id'=f.net_id::text
      AND x->>'signal_id' IS NULL AND x->>'signal_link_state'='unresolved')
  THEN RAISE EXCEPTION 'foreign signal exposed or unresolved signal suppressed'; END IF;
  UPDATE public.harness_nets SET signal_id=g WHERE id=f.net_id;
END $signal_ownership$;

GRANT SELECT ON workspace_fixture TO anon, authenticated;
UPDATE public.vehicles SET deleted_at=NULL WHERE id=(SELECT vehicle_id FROM material_fixture WHERE name='second');
SET ROLE anon;
DO $anon$
DECLARE p jsonb;
BEGIN
  SELECT public.harness_schematic_model(vehicle_id) INTO p FROM workspace_fixture;
  IF p IS NULL OR jsonb_array_length(p->'segments')<>2 THEN RAISE EXCEPTION 'public workspace unavailable'; END IF;
  IF p::text LIKE '%private fixture provenance%' THEN RAISE EXCEPTION 'private provenance exposed to visitor'; END IF;
  IF public.harness_schematic_model((SELECT vehicle_id FROM material_fixture WHERE name='second')) IS NOT NULL
    THEN RAISE EXCEPTION 'private workspace exposed'; END IF;
END $anon$;
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('test.auth_uid','00000000-0000-0000-0000-000000007778',false);
DO $$ BEGIN
  IF public.harness_schematic_model((SELECT vehicle_id FROM material_fixture WHERE name='second')) IS NOT NULL
    THEN RAISE EXCEPTION 'unrelated account sees private workspace'; END IF;
END $$;
SELECT set_config('test.auth_uid','00000000-0000-0000-0000-000000007777',false);
SELECT set_config('test.auth_jwt','{"is_anonymous":true}',false);
DO $$ BEGIN
  IF public.harness_schematic_model((SELECT vehicle_id FROM material_fixture WHERE name='second')) IS NOT NULL
    THEN RAISE EXCEPTION 'anonymous owner session sees private workspace'; END IF;
END $$;
SELECT set_config('test.auth_jwt','{"is_anonymous":false}',false);
DO $$ BEGIN
  IF public.harness_schematic_model((SELECT vehicle_id FROM material_fixture WHERE name='second')) IS NULL
    THEN RAISE EXCEPTION 'owner private workspace unavailable'; END IF;
  IF public.harness_schematic_model((SELECT vehicle_id FROM workspace_fixture))::text LIKE '%private fixture provenance%'
    THEN RAISE EXCEPTION 'owner prose entered shared graph'; END IF;
END $$;
RESET ROLE;
UPDATE public.vehicles SET deleted_at=now() WHERE id=(SELECT vehicle_id FROM material_fixture WHERE name='second');
SET ROLE authenticated;
DO $$ BEGIN
  IF public.harness_schematic_model((SELECT vehicle_id FROM material_fixture WHERE name='second')) IS NOT NULL
    THEN RAISE EXCEPTION 'deleted workspace exposed'; END IF;
END $$;
RESET ROLE;
SELECT set_config('test.auth_uid','',false);
SELECT set_config('test.auth_jwt','{}',false);
SELECT 'test_harness_physical_workspace_reader: PASS';

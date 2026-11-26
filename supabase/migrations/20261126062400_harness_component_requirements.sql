-- Component requirements are typed children of the existing atomic evaluation.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';

CREATE TABLE public.harness_model_component_requirements (
 evaluation_id uuid NOT NULL REFERENCES public.harness_model_evaluations(id),
 id uuid NOT NULL,
 demand_key text NOT NULL,
 role text NOT NULL CHECK (role IN ('terminal_contact','pin_seal','connector_housing','wedge_lock','boot','splice')),
 termination_id uuid REFERENCES public.wire_termination_specs(id),
 endpoint_id uuid REFERENCES public.harness_endpoints(id),
 splice_id uuid REFERENCES public.harness_splices(id),
 catalog_part_id uuid REFERENCES public.catalog_parts(id),
 quantity numeric CHECK (quantity IS NULL OR (quantity>0 AND quantity=trunc(quantity))),
 unit text NOT NULL CHECK (unit='each'),
 state text NOT NULL CHECK (state IN ('held','provisional')),
 blockers text[] NOT NULL,
 specified_part_numbers text[],
 PRIMARY KEY (evaluation_id,id),
 UNIQUE (evaluation_id,demand_key),
 CHECK (num_nonnulls(termination_id,endpoint_id,splice_id)=1),
 CHECK ((role='splice')=(splice_id IS NOT NULL)),
 CHECK (state<>'provisional' OR (catalog_part_id IS NOT NULL AND quantity IS NOT NULL AND cardinality(blockers)=0))
);
COMMENT ON TABLE public.harness_model_component_requirements IS 'Grain: one physical component contribution in one input-bound evaluation. Contacts/seals use an endpoint cavity unless an individual bus lug; housings/wedges and connector boots use a physical endpoint; a shared splice uses its existing splice revision once. Unknown or conflicting assignments retain held rows, never guessed quantities. Provisional means structural demand only, never stock, receipt, fit, cut, purchasing or assembly release.';
CREATE TABLE public.harness_model_component_contributors (
 evaluation_id uuid NOT NULL,
 requirement_id uuid NOT NULL,
 segment_id uuid NOT NULL REFERENCES public.harness_segments(id),
 termination_id uuid NOT NULL REFERENCES public.wire_termination_specs(id),
 circuit_id uuid NOT NULL REFERENCES public.vehicle_custom_circuits(id),
 PRIMARY KEY(evaluation_id,requirement_id,segment_id,termination_id),
 FOREIGN KEY(evaluation_id,requirement_id) REFERENCES public.harness_model_component_requirements(evaluation_id,id)
);
COMMENT ON TABLE public.harness_model_component_contributors IS 'Grain: one actual typed physical segment/end/circuit edge contributing to a component requirement in the same immutable evaluation. It preserves distinct conductors behind shared hardware; no summing per-circuit estimates or phantom contact edges.';


ALTER TABLE public.harness_model_evaluations
 ADD COLUMN component_requirement_count integer NOT NULL DEFAULT 0 CHECK(component_requirement_count>=0),
 ADD COLUMN component_contributor_count integer NOT NULL DEFAULT 0 CHECK(component_contributor_count>=0),
 ADD COLUMN component_role_coverage jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(component_role_coverage)='array' AND jsonb_array_length(component_role_coverage) IN(0,6));
GRANT SELECT(component_requirement_count,component_contributor_count,component_role_coverage) ON public.harness_model_evaluations TO anon,authenticated;
ALTER TABLE public.harness_model_rules DROP CONSTRAINT harness_model_rules_subject_kind_check,
 ADD CONSTRAINT harness_model_rules_subject_kind_check CHECK(subject_kind IN('vehicle','circuit','segment','termination','component'));
ALTER TABLE public.harness_model_checks ADD COLUMN component_requirement_id uuid,
 ADD CONSTRAINT harness_model_checks_component_fkey FOREIGN KEY(evaluation_id,component_requirement_id)
  REFERENCES public.harness_model_component_requirements(evaluation_id,id),
 DROP CONSTRAINT harness_model_checks_check,
 ADD CONSTRAINT harness_model_checks_check CHECK(num_nonnulls(segment_id,termination_id,circuit_id,component_requirement_id)<=1),
 DROP CONSTRAINT harness_model_checks_evaluation_id_rule_key_rule_version_se_key,
 ADD CONSTRAINT harness_model_checks_subject_once UNIQUE NULLS NOT DISTINCT
  (evaluation_id,rule_key,rule_version,segment_id,termination_id,circuit_id,component_requirement_id);
ALTER TABLE public.harness_model_checks ALTER COLUMN subject_kind SET EXPRESSION AS
 (CASE WHEN segment_id IS NOT NULL THEN 'segment' WHEN termination_id IS NOT NULL THEN 'termination'
 WHEN circuit_id IS NOT NULL THEN 'circuit' WHEN component_requirement_id IS NOT NULL THEN 'component' ELSE 'vehicle' END);

ALTER TABLE public.harness_model_component_requirements ENABLE ROW LEVEL SECURITY;
CREATE POLICY harness_model_components_read ON public.harness_model_component_requirements FOR SELECT USING (
 EXISTS (SELECT FROM public.harness_model_evaluations r WHERE r.id=harness_model_component_requirements.evaluation_id)
 AND (termination_id IS NULL OR EXISTS(SELECT FROM public.wire_termination_specs t WHERE t.id=harness_model_component_requirements.termination_id))
 AND (endpoint_id IS NULL OR EXISTS(SELECT FROM public.harness_endpoints e WHERE e.id=harness_model_component_requirements.endpoint_id))
 AND (splice_id IS NULL OR EXISTS(SELECT FROM public.harness_splices s WHERE s.id=harness_model_component_requirements.splice_id))
 AND (catalog_part_id IS NULL OR EXISTS(SELECT FROM public.catalog_parts p WHERE p.id=harness_model_component_requirements.catalog_part_id)));
ALTER TABLE public.harness_model_component_contributors ENABLE ROW LEVEL SECURITY;
CREATE POLICY harness_model_component_contributors_read ON public.harness_model_component_contributors FOR SELECT USING (
 EXISTS (SELECT FROM public.harness_model_component_requirements q WHERE q.evaluation_id=harness_model_component_contributors.evaluation_id AND q.id=harness_model_component_contributors.requirement_id)
 AND EXISTS (SELECT FROM public.harness_segments s WHERE s.id=harness_model_component_contributors.segment_id)
 AND EXISTS (SELECT FROM public.wire_termination_specs t WHERE t.id=harness_model_component_contributors.termination_id)
 AND EXISTS (SELECT FROM public.vehicle_custom_circuits c WHERE c.id=harness_model_component_contributors.circuit_id));
REVOKE ALL ON public.harness_model_component_requirements,public.harness_model_component_contributors FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.harness_model_component_requirements,public.harness_model_component_contributors TO anon,authenticated,service_role;


DO $policy$
DECLARE expr text;
BEGIN
 SELECT pg_get_expr(polqual,polrelid) INTO STRICT expr FROM pg_policy
 WHERE polrelid='public.harness_model_checks'::regclass AND polname='harness_model_checks_read';
 EXECUTE 'ALTER POLICY harness_model_checks_read ON public.harness_model_checks USING(('||expr||') AND '
  ||'(component_requirement_id IS NULL OR EXISTS(SELECT FROM public.harness_model_component_requirements q '
  ||'WHERE q.evaluation_id=harness_model_checks.evaluation_id AND q.id=harness_model_checks.component_requirement_id)))';
END $policy$;

CREATE OR REPLACE FUNCTION public.harness_model_inputs(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public SET timezone='UTC' AS $fn$
WITH raw AS MATERIALIZED (SELECT CASE WHEN public.harness_model_visible(p_vehicle_id)
 THEN public.harness_schematic_model(p_vehicle_id) END AS g),
c AS MATERIALIZED (
 SELECT a.x || jsonb_build_object('system_category',vc.system_category,
  'from_endpoint_id',vc.from_endpoint_id,'to_endpoint_id',vc.to_endpoint_id) AS x
 FROM raw CROSS JOIN LATERAL jsonb_array_elements(g->'circuits') a(x)
 LEFT JOIN public.vehicle_custom_circuits vc ON vc.id=(a.x->>'id')::uuid
  AND EXISTS(SELECT FROM public.vehicle_wiring_overlays vo WHERE vo.id=vc.overlay_id AND vo.vehicle_id=p_vehicle_id)
 WHERE a.x->>'design_status'='decided' AND NOT coalesce((a.x->>'is_superseded')::boolean,false)),
progressed_circuits AS MATERIALIZED (
 SELECT DISTINCT b.circuit_id FROM public.harness_build_events b WHERE b.vehicle_id=p_vehicle_id AND b.to_state<>'uncut'),
s AS MATERIALIZED (
 SELECT a.x || jsonb_build_object('physical_progress',
   coalesce((a.x->>'physical_progress')::boolean,false) OR hs.build_state IS DISTINCT FROM 'uncut'
   OR hs.measured_length_ft IS NOT NULL OR hs.measured_at IS NOT NULL
   OR coalesce(vc.build_state,'uncut')<>'uncut' OR to_jsonb(vc)->>'measured_length_ft' IS NOT NULL
   OR hs.vehicle_custom_circuit_id IN (SELECT circuit_id FROM progressed_circuits)) AS x
 FROM raw CROSS JOIN LATERAL jsonb_array_elements(g->'segments') a(x)
 LEFT JOIN public.harness_segments hs ON hs.id=(a.x->>'id')::uuid AND hs.vehicle_id=p_vehicle_id
 LEFT JOIN public.vehicle_custom_circuits vc ON vc.id=hs.vehicle_custom_circuit_id
  AND EXISTS (SELECT FROM public.vehicle_wiring_overlays vo WHERE vo.id=vc.overlay_id AND vo.vehicle_id=p_vehicle_id)
 WHERE a.x->>'design_status'='decided' AND coalesce((a.x->>'in_current_plan')::boolean,true)
  AND a.x->>'circuit_id' IN (SELECT c.x->>'id' FROM c)),
t AS MATERIALIZED (
 SELECT a.x||jsonb_build_object(
  'connector_housing_catalog_id',wt.connector_housing_catalog_id,'connector_housing_pn',wt.connector_housing_pn,
  'wedge_lock_catalog_id',wt.wedge_lock_catalog_id,'wedge_lock_pn',wt.wedge_lock_pn,
  'boot_catalog_id',wt.boot_catalog_id,'boot_pn',wt.boot_pn,
  'is_superseded',wt.is_superseded,'superseded_by',wt.superseded_by) AS x
 FROM raw CROSS JOIN LATERAL jsonb_array_elements(g->'terminations') a(x)
 LEFT JOIN public.wire_termination_specs wt ON wt.id=(a.x->>'id')::uuid AND wt.vehicle_id=p_vehicle_id
 WHERE EXISTS (SELECT FROM s WHERE a.x->>'id' IN (s.x->>'from_termination_id',s.x->>'to_termination_id'))),
-- Include every visible current end on a selected circuit, even if its only
-- segment is excluded from this design selection. Absence never means zero wire.
unattached AS MATERIALIZED (
 SELECT jsonb_build_object('id',wt.id,'circuit_id',wt.circuit_id,'endpoint_id',wt.endpoint_id,
  'cavity',wt.cavity,'cavity_layout_id',wt.cavity_layout_id,
  'endpoint_code',he.code,'endpoint_name',he.name,'endpoint_node_kind',he.node_kind) AS x
 FROM public.wire_termination_specs wt
 LEFT JOIN public.harness_endpoints he ON he.id=wt.endpoint_id
  AND NOT coalesce(he.is_superseded,false) AND he.superseded_by IS NULL
  AND EXISTS(SELECT FROM public.harness_designs hd WHERE hd.id=he.design_id AND hd.vehicle_id=p_vehicle_id)
 WHERE wt.vehicle_id=p_vehicle_id AND NOT coalesce(wt.is_superseded,false) AND wt.superseded_by IS NULL
  AND wt.circuit_id::text IN(SELECT c.x->>'id' FROM c)
  AND NOT EXISTS(SELECT FROM s WHERE wt.id::text IN(s.x->>'from_termination_id',s.x->>'to_termination_id'))),
qualified_endpoints AS MATERIALIZED (
 SELECT a.x||jsonb_build_object('design_status',he.design_status,'is_superseded',he.is_superseded,'superseded_by',he.superseded_by) AS x
 FROM raw CROSS JOIN LATERAL jsonb_array_elements(g->'endpoints') a(x)
 LEFT JOIN public.harness_endpoints he ON he.id=(a.x->>'id')::uuid
  AND EXISTS(SELECT FROM public.harness_designs hd WHERE hd.id=he.design_id AND hd.vehicle_id=p_vehicle_id)),
splices AS MATERIALIZED (
 SELECT jsonb_build_object('id',sp.id,'endpoint_id',sp.endpoint_id,'placement',sp.placement,'cavity',sp.cavity,
  'part_id',sp.part_id,'part_number',sp.part_number) AS x
 FROM public.harness_splices sp WHERE sp.vehicle_id=p_vehicle_id AND NOT sp.is_superseded AND sp.superseded_by IS NULL
  AND(sp.endpoint_id::text IN(SELECT x->>'endpoint_id' FROM t)
   OR EXISTS(SELECT FROM public.harness_splice_members m WHERE m.splice_id=sp.id AND m.circuit_id::text IN(SELECT x->>'id' FROM c)))),
splice_members AS MATERIALIZED (
 SELECT jsonb_build_object('id',sm.id,'splice_id',sm.splice_id,'circuit_id',sm.circuit_id,'ordinal',sm.ordinal,
  'member_label',sm.member_label,'side',sm.side) AS x
 FROM public.harness_splice_members sm WHERE sm.splice_id::text IN(SELECT x->>'id' FROM splices)),
-- Explicit projection prevents a future raw-reader metadata/prose extension from entering public evaluations.
allowed(k,keys) AS (VALUES
  ('circuits',ARRAY['id','code','name','section','system_category','from_endpoint_id','to_endpoint_id','design_status','gauge_awg','colour','wire_type','is_superseded','superseded_by']::text[]),
  ('segments',ARRAY['id','net_id','circuit_id','current_circuit_id','reference_fingerprint','from_termination_id','to_termination_id','wire_part_id','gauge_awg','colour','planned_length_ft','planned_length_method','measured_length_ft','measured_at','build_state','design_status','in_current_plan','expected_gauge_awg','expected_colour','expected_part_number','expected_part_id','physical_progress','needs_revision','circuit_code','circuit_gauge_awg','circuit_colour','wire_type','keyed_part_number','link_state','specification_state','blockers']::text[]),
  ('terminations',ARRAY['id','circuit_id','endpoint_id','cavity','cavity_layout_id','terminal_contact_catalog_id','terminal_contact_pn','pin_seal_catalog_id','pin_seal_pn','crimp_tool_catalog_id','crimp_tool_pn','connector_housing_catalog_id','connector_housing_pn','wedge_lock_catalog_id','wedge_lock_pn','boot_catalog_id','boot_pn','is_superseded','superseded_by']::text[]),
  ('endpoints',ARRAY['id','code','name','type','node_kind','part_number','topology_node_id','design_status','is_superseded','superseded_by']::text[]),
  ('nets',ARRAY['id','code','signal_id','signal_link_state','signal_reference_fingerprint','function','nominal_current_a','peak_current_a','protection_pdm_channel_ids','protection_pdm_channel_id','protection_fuse_part_id','protection_setting_a','is_superseded','superseded_by']::text[]),
  ('connector_matings',ARRAY['from_endpoint_id','to_endpoint_id','relation']::text[]),
  ('splices',ARRAY['id','endpoint_id','placement','cavity','part_id','part_number']::text[]),
  ('splice_members',ARRAY['id','splice_id','circuit_id','ordinal','member_label','side']::text[]),
  ('unsegmented_end_records',ARRAY['id','circuit_id','endpoint_id','cavity','cavity_layout_id','endpoint_code','endpoint_name','endpoint_node_kind']::text[]),
  ('evidence_edges',ARRAY['id','observation_id','row_kind','row_id','field','relation']::text[])),
objects AS (
 SELECT a.k,coalesce(jsonb_agg(coalesce((SELECT jsonb_object_agg(j.key,j.value) FROM jsonb_each(x) j
    WHERE j.key=ANY(a.keys)),'{}'::jsonb) ORDER BY x->>'id',x::text) FILTER(WHERE x IS NOT NULL),'[]'::jsonb) AS items
 FROM raw CROSS JOIN allowed a LEFT JOIN LATERAL jsonb_array_elements(
  CASE a.k WHEN 'circuits' THEN coalesce((SELECT jsonb_agg(x) FROM c),'[]'::jsonb)
   WHEN 'segments' THEN coalesce((SELECT jsonb_agg(x) FROM s),'[]'::jsonb)
   WHEN 'terminations' THEN coalesce((SELECT jsonb_agg(x) FROM t),'[]'::jsonb)
   WHEN 'endpoints' THEN coalesce((SELECT jsonb_agg(x) FROM qualified_endpoints),'[]'::jsonb)
   WHEN 'splices' THEN coalesce((SELECT jsonb_agg(x) FROM splices),'[]'::jsonb)
   WHEN 'splice_members' THEN coalesce((SELECT jsonb_agg(x) FROM splice_members),'[]'::jsonb)
   WHEN 'unsegmented_end_records' THEN coalesce((SELECT jsonb_agg(x) FROM unattached),'[]'::jsonb)
   ELSE coalesce(g->a.k,'[]'::jsonb) END) o(x) ON true GROUP BY a.k),
model AS (
 SELECT jsonb_object_agg(k,items) || jsonb_build_object('contract_version',2,'vehicle_id',p_vehicle_id,
  'snapshot_kind','current_read_not_published_revision','selection','decided_design') AS g
 FROM objects WHERE EXISTS (SELECT FROM raw WHERE g IS NOT NULL) HAVING count(*)>0),
part_ids AS (
 SELECT (x->>'wire_part_id')::uuid AS id FROM s
 UNION SELECT (x->>'terminal_contact_catalog_id')::uuid FROM t
 UNION SELECT (x->>'pin_seal_catalog_id')::uuid FROM t
 UNION SELECT (x->>'crimp_tool_catalog_id')::uuid FROM t
 UNION SELECT (x->>'connector_housing_catalog_id')::uuid FROM t
 UNION SELECT (x->>'wedge_lock_catalog_id')::uuid FROM t
 UNION SELECT (x->>'boot_catalog_id')::uuid FROM t
 UNION SELECT (x->>'part_id')::uuid FROM splices)
SELECT jsonb_build_object('model',g,
 'catalog_parts',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'part_number',p.part_number) ORDER BY p.id)
   FROM public.catalog_parts p WHERE p.id IN (SELECT id FROM part_ids)),'[]'::jsonb),
 'rules',coalesce((SELECT jsonb_agg(jsonb_build_object('rule_key',r.rule_key,'version',r.version,
   'subject_kind',r.subject_kind,'description',r.description,'display_name',r.display_name,
   'attention_action',r.attention_action,'attention_order',r.attention_order,'implementation',r.implementation::text)
   ORDER BY r.rule_key) FROM public.harness_model_rules r WHERE r.is_current),'[]'::jsonb))
FROM model;
$fn$;


-- Pure component contribution substep of the canonical evaluation.
-- It consumes the same captured input and already computed segment checks.
CREATE FUNCTION public.harness_model_components(p_input jsonb,p_checks jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $component$
WITH
s AS MATERIALIZED (SELECT * FROM jsonb_to_recordset(p_input#>'{model,segments}') x(
 id uuid,circuit_id uuid,from_termination_id uuid,to_termination_id uuid)),
t_raw AS MATERIALIZED (SELECT * FROM jsonb_to_recordset(p_input#>'{model,terminations}') x(
 id uuid,circuit_id uuid,endpoint_id uuid,cavity text,cavity_layout_id uuid,is_superseded boolean,superseded_by uuid,
 terminal_contact_catalog_id uuid,terminal_contact_pn text,pin_seal_catalog_id uuid,pin_seal_pn text,
 connector_housing_catalog_id uuid,connector_housing_pn text,wedge_lock_catalog_id uuid,wedge_lock_pn text,
 boot_catalog_id uuid,boot_pn text)),
-- Existing load_harness_splices/v_harness_pin_occupancy convention, not a
-- manufacturer alias inference. Preserve raw cavity and letter case.
t AS MATERIALIZED (SELECT t_raw.*,regexp_replace(btrim(cavity),
 '^([A-Za-z]+)_?0*([0-9]+)$','\1\2') AS material_cavity FROM t_raw),
e AS MATERIALIZED (SELECT * FROM jsonb_to_recordset(p_input#>'{model,endpoints}') x(
 id uuid,type text,node_kind text,design_status text,is_superseded boolean,superseded_by uuid)),
c AS MATERIALIZED (SELECT * FROM jsonb_to_recordset(p_input#>'{model,circuits}') x(id uuid)),
sp AS MATERIALIZED (SELECT * FROM jsonb_to_recordset(coalesce(p_input#>'{model,splices}','[]')) x(
 id uuid,endpoint_id uuid,placement text,cavity text,part_id uuid,part_number text)),
sm AS MATERIALIZED (SELECT * FROM jsonb_to_recordset(coalesce(p_input#>'{model,splice_members}','[]')) x(
 id uuid,splice_id uuid,circuit_id uuid)),
parts AS MATERIALIZED (SELECT * FROM jsonb_to_recordset(p_input->'catalog_parts') x(id uuid,part_number text)),
segment_qualification AS MATERIALIZED (
 SELECT k.segment_id,count(*)=4 AND bool_and(k.result='pass') AS source_ok
 FROM jsonb_to_recordset(p_checks) k(segment_id uuid,rule_key text,result text)
 WHERE k.rule_key IN('segment_links','segment_specification','material_source_status','new_wire_demand')
 GROUP BY k.segment_id),
circuit_qualification AS MATERIALIZED (
 SELECT k.circuit_id,count(*)=1 AND bool_and(k.result='pass') AS source_ok
 FROM jsonb_to_recordset(p_checks) k(circuit_id uuid,rule_key text,result text)
 WHERE k.rule_key='circuit_segments' GROUP BY k.circuit_id),
edges AS MATERIALIZED (
 SELECT s.id AS segment_id,s.circuit_id,t.id AS termination_id,t.endpoint_id,(coalesce(q.source_ok,false) AND coalesce(cq.source_ok,false)) AS source_ok
 FROM s CROSS JOIN LATERAL (VALUES(s.from_termination_id),(s.to_termination_id)) side(id)
 JOIN t ON t.id=side.id AND t.circuit_id=s.circuit_id
 LEFT JOIN segment_qualification q ON q.segment_id=s.id
 LEFT JOIN circuit_qualification cq ON cq.circuit_id=s.circuit_id),
end_stats AS MATERIALIZED (
 SELECT termination_id,bool_and(source_ok) AS source_ok,count(DISTINCT segment_id) AS segment_count FROM edges GROUP BY termination_id),
mixed_cavities AS MATERIALIZED (
 SELECT t.endpoint_id,t.material_cavity AS cavity FROM t JOIN end_stats n ON n.termination_id=t.id
 JOIN e ON e.id=t.endpoint_id AND e.node_kind IS DISTINCT FROM 'bus'
 WHERE nullif(btrim(t.cavity),'') IS NOT NULL
 GROUP BY t.endpoint_id,t.material_cavity HAVING count(*)>1 AND count(DISTINCT coalesce(t.cavity_layout_id::text,'unkeyed'))>1),
physical_ends AS MATERIALIZED (
 SELECT t.*,e.node_kind,e.type AS endpoint_type,e.design_status AS endpoint_design_status,
 array_remove(ARRAY[
  CASE WHEN NOT n.source_ok THEN 'physical_source_unresolved' END,
  CASE WHEN n.segment_count>1 THEN 'physical_end_reused_by_segments' END,
  CASE WHEN coalesce(t.is_superseded,false) OR t.superseded_by IS NOT NULL THEN 'termination_superseded' END,
  CASE WHEN e.id IS NULL OR coalesce(e.is_superseded,false) OR e.superseded_by IS NOT NULL THEN 'endpoint_unresolved' END,
  CASE WHEN e.design_status IS DISTINCT FROM 'decided' THEN 'endpoint_design_not_decided' END
 ],NULL)::text[] AS blockers,
 m.endpoint_id IS NOT NULL AS mixed_cavity,
 e.node_kind IS DISTINCT FROM 'bus' AND
 ((t.cavity_layout_id IS NULL AND nullif(btrim(t.cavity),'') IS NULL)
  OR t.cavity ~* '[?]|(^|[^a-z])(unknown|open|tbd)([^a-z]|$)') AS cavity_unknown
 FROM t JOIN end_stats n ON n.termination_id=t.id LEFT JOIN e ON e.id=t.endpoint_id
 LEFT JOIN mixed_cavities m ON m.endpoint_id=t.endpoint_id AND m.cavity=t.material_cavity),
member_pairs AS MATERIALIZED (SELECT DISTINCT splice_id,circuit_id FROM sm WHERE circuit_id IS NOT NULL),
splice_end_edges AS MATERIALIZED (
 SELECT sp.id AS splice_id,ed.*,mp.circuit_id IS NOT NULL AS declared_member
 FROM sp JOIN edges ed ON ed.endpoint_id=sp.endpoint_id
 JOIN t ON t.id=ed.termination_id
 LEFT JOIN member_pairs mp ON mp.splice_id=sp.id AND mp.circuit_id=ed.circuit_id WHERE sp.placement<>'at_pin' OR t.material_cavity=sp.cavity),
member_reach AS MATERIALIZED (
 SELECT sm.id,sm.splice_id,sm.circuit_id,c.id IS NOT NULL AS selected_circuit,
 count(DISTINCT s.id)>0 AS modeled,count(DISTINCT se.termination_id)>0 AS reaches
 FROM sm LEFT JOIN c ON c.id=sm.circuit_id LEFT JOIN s ON s.circuit_id=sm.circuit_id
 LEFT JOIN splice_end_edges se ON se.splice_id=sm.splice_id AND se.circuit_id=sm.circuit_id
 GROUP BY sm.id,sm.splice_id,sm.circuit_id,c.id),
splice_stats AS MATERIALIZED (
 SELECT sp.id,count(m.id) AS member_count,bool_and(m.selected_circuit) AS members_selected,
 bool_and(m.modeled) AS members_modeled,bool_and(m.reaches) AS members_reach
 FROM sp LEFT JOIN member_reach m ON m.splice_id=sp.id GROUP BY sp.id),
roles AS MATERIALIZED (
 SELECT en.*,r.role,r.part_id,r.pn,
 CASE WHEN en.endpoint_id IS NOT NULL AND (r.role IN('connector_housing','wedge_lock') OR (r.role='boot' AND en.node_kind IS DISTINCT FROM 'bus'))
  THEN 'endpoint:'||en.endpoint_id||':'||r.role
 WHEN en.endpoint_id IS NOT NULL AND r.role IN('terminal_contact','pin_seal') AND en.node_kind IS DISTINCT FROM 'bus'
  AND (en.cavity_layout_id IS NOT NULL OR nullif(btrim(en.cavity),'') IS NOT NULL)
  THEN 'contact:'||en.endpoint_id||':'||coalesce(en.cavity_layout_id::text,'recorded:'||en.material_cavity)||':'||r.role
 ELSE 'end:'||en.id||':'||r.role END AS demand_key
 FROM physical_ends en CROSS JOIN LATERAL(VALUES
 ('terminal_contact',en.terminal_contact_catalog_id,en.terminal_contact_pn),
 ('pin_seal',en.pin_seal_catalog_id,en.pin_seal_pn),
 ('connector_housing',en.connector_housing_catalog_id,en.connector_housing_pn),
 ('wedge_lock',en.wedge_lock_catalog_id,en.wedge_lock_pn),
 ('boot',en.boot_catalog_id,en.boot_pn)) r(role,part_id,pn)
 LEFT JOIN (SELECT DISTINCT endpoint_id FROM sp WHERE placement<>'at_pin') joints ON joints.endpoint_id=en.endpoint_id
 WHERE r.role<>'terminal_contact' OR joints.endpoint_id IS NULL),
groups AS MATERIALIZED (
 SELECT demand_key,role,min(endpoint_id::text)::uuid AS endpoint_id,
 CASE WHEN demand_key LIKE 'end:%' THEN min(id::text)::uuid END AS termination_id,
 CASE WHEN count(DISTINCT part_id)=1 AND count(part_id)=count(*) THEN min(part_id::text)::uuid END AS part_id,
 array_agg(DISTINCT pn ORDER BY pn) FILTER(WHERE nullif(btrim(pn),'') IS NOT NULL) AS pns,
 array_agg(id ORDER BY id) AS end_ids,
 array_remove(ARRAY[
  CASE WHEN count(DISTINCT part_id)>1 OR count(DISTINCT nullif(btrim(pn),''))>1 THEN 'shared_part_conflict' END,
  CASE WHEN count(part_id)<>count(*) THEN 'part_assignment_incomplete' END,
  CASE WHEN role='terminal_contact' AND bool_or(endpoint_type='splice') THEN 'splice_component_unresolved' END,
  CASE WHEN role IN('terminal_contact','pin_seal') AND count(*)>1 THEN 'shared_contact_quantity_unresolved' END,
  CASE WHEN role IN('terminal_contact','pin_seal') AND bool_or(mixed_cavity) THEN 'shared_contact_identity_unresolved' END,
  CASE WHEN role IN('terminal_contact','pin_seal') AND bool_or(cavity_unknown) THEN 'contact_cavity_unresolved' END
 ],NULL)::text[] AS blockers
 FROM roles GROUP BY demand_key,role
 HAVING role='terminal_contact' OR count(part_id)>0 OR count(nullif(btrim(pn),''))>0),
group_blockers AS MATERIALIZED (
 SELECT r.demand_key,array_agg(DISTINCT b ORDER BY b) AS blockers
 FROM roles r CROSS JOIN LATERAL unnest(r.blockers) b GROUP BY r.demand_key),
component_base AS MATERIALIZED (
 SELECT md5('component_v1:'||g.demand_key)::uuid AS id,g.demand_key,g.role,g.termination_id,
 CASE WHEN g.termination_id IS NULL THEN g.endpoint_id END AS endpoint_id,NULL::uuid AS splice_id,
 g.part_id,g.pns,g.end_ids,
 g.blockers||coalesce(b.blockers,'{}') AS blockers,
 CASE WHEN g.role IN('terminal_contact','pin_seal') AND
 g.blockers && ARRAY['shared_contact_quantity_unresolved','shared_contact_identity_unresolved','contact_cavity_unresolved','splice_component_unresolved']
 THEN NULL ELSE 1::numeric END AS stated_quantity
 FROM groups g LEFT JOIN group_blockers b USING(demand_key)
 UNION ALL
 SELECT md5('component_v1:splice:'||sp.id)::uuid,'splice:'||sp.id,'splice',NULL,NULL,sp.id,sp.part_id,
 array_remove(ARRAY[sp.part_number],NULL),coalesce(array_agg(DISTINCT pe.id) FILTER(WHERE pe.id IS NOT NULL),'{}'),
 array_remove(ARRAY[
 CASE WHEN e.id IS NULL OR e.design_status IS DISTINCT FROM 'decided' OR coalesce(e.is_superseded,false) OR e.superseded_by IS NOT NULL THEN 'splice_endpoint_unresolved' END,
 CASE WHEN st.member_count=0 OR st.members_selected IS DISTINCT FROM true THEN 'splice_member_unresolved' END,
 CASE WHEN st.members_modeled IS DISTINCT FROM true THEN 'splice_member_unmodeled' END,
 CASE WHEN st.members_reach IS DISTINCT FROM true THEN 'splice_member_endpoint_unresolved' END,
 CASE WHEN bool_or(NOT se.declared_member) THEN 'splice_extra_endpoint_conductor' END,
 CASE WHEN bool_or(cardinality(pe.blockers)>0) THEN 'splice_member_withheld' END,
 CASE WHEN sp.placement<>'at_pin' AND bool_or(
  pe.terminal_contact_catalog_id IS NOT NULL AND pe.terminal_contact_catalog_id IS DISTINCT FROM sp.part_id
  OR nullif(btrim(pe.terminal_contact_pn),'') IS NOT NULL AND pe.terminal_contact_pn IS DISTINCT FROM sp.part_number)
 THEN 'splice_material_conflict' END
 ],NULL)::text[],1::numeric
 FROM sp JOIN splice_stats st ON st.id=sp.id LEFT JOIN e ON e.id=sp.endpoint_id
 LEFT JOIN splice_end_edges se ON se.splice_id=sp.id LEFT JOIN physical_ends pe ON pe.id=se.termination_id
 GROUP BY sp.id,sp.endpoint_id,sp.placement,sp.cavity,sp.part_id,sp.part_number,e.id,e.design_status,e.is_superseded,e.superseded_by,
 st.member_count,st.members_selected,st.members_modeled,st.members_reach),
contributors AS MATERIALIZED (
 SELECT DISTINCT b.id AS requirement_id,ed.segment_id,ed.termination_id,ed.circuit_id
 FROM component_base b CROSS JOIN LATERAL unnest(b.end_ids) x(id) JOIN edges ed ON ed.termination_id=x.id),
component_refs AS MATERIALIZED (
 SELECT b.id AS requirement_id,'termination'::text AS row_kind,t.id AS row_id FROM component_base b
 CROSS JOIN LATERAL unnest(b.end_ids) t(id)
 UNION SELECT b.id,'endpoint',t.endpoint_id FROM component_base b
 CROSS JOIN LATERAL unnest(b.end_ids) x(id) JOIN t ON t.id=x.id
 UNION SELECT requirement_id,'segment',segment_id FROM contributors),
evidence_blockers AS MATERIALIZED (
 SELECT r.requirement_id,bool_or(ev.relation='contradicts') AS contradiction
 FROM component_refs r JOIN jsonb_to_recordset(coalesce(p_input#>'{model,evidence_edges}','[]')) ev(row_kind text,row_id uuid,relation text)
 ON ev.row_kind=r.row_kind AND ev.row_id=r.row_id GROUP BY r.requirement_id),
qualified AS MATERIALIZED (
 SELECT b.*,CASE WHEN p.id IS NOT NULL AND b.part_id IS NOT NULL THEN b.stated_quantity END AS quantity,
 ARRAY(SELECT DISTINCT x FROM unnest(b.blockers||array_remove(ARRAY[
 CASE WHEN p.id IS NULL THEN 'catalog_part_unresolved' END,
 CASE WHEN p.id IS NOT NULL AND cardinality(b.pns)>0 AND NOT (b.pns <@ ARRAY[p.part_number]) THEN 'catalog_part_number_conflict' END,
 CASE WHEN b.stated_quantity IS NULL OR p.id IS NULL THEN 'quantity_unresolved' END,
 CASE WHEN ev.contradiction THEN 'contradicting_evidence' END
 ],NULL)::text[]) x ORDER BY x) AS all_blockers
 FROM component_base b LEFT JOIN parts p ON p.id=b.part_id LEFT JOIN evidence_blockers ev ON ev.requirement_id=b.id),
rules AS MATERIALIZED (SELECT * FROM jsonb_to_recordset(p_input->'rules') x(rule_key text,version text,subject_kind text)
 WHERE subject_kind='component'),
checks AS MATERIALIZED (
 SELECT r.rule_key,r.version AS rule_version,q.id AS component_requirement_id,
 NULL::uuid AS segment_id,NULL::uuid AS termination_id,NULL::uuid AS circuit_id,
 CASE r.rule_key
 WHEN 'component_source_status' THEN CASE WHEN q.all_blockers && ARRAY['physical_source_unresolved','physical_end_reused_by_segments','termination_superseded','endpoint_unresolved',
 'endpoint_design_not_decided','splice_endpoint_unresolved','splice_member_unresolved','splice_member_unmodeled','splice_member_endpoint_unresolved',
 'splice_member_withheld','splice_extra_endpoint_conductor','contradicting_evidence'] THEN 'hold' ELSE 'pass' END
 WHEN 'component_part_assignment' THEN CASE
 WHEN q.all_blockers && ARRAY['shared_part_conflict','catalog_part_number_conflict','splice_material_conflict'] THEN 'fail'
 WHEN q.all_blockers && ARRAY['part_assignment_incomplete','catalog_part_unresolved'] THEN 'hold' ELSE 'pass' END
 WHEN 'component_quantity_basis' THEN CASE WHEN q.all_blockers && ARRAY['shared_contact_quantity_unresolved','shared_contact_identity_unresolved',
 'contact_cavity_unresolved','quantity_unresolved','splice_component_unresolved'] THEN 'hold' ELSE 'pass' END
 ELSE 'hold' END AS result
 FROM qualified q CROSS JOIN rules r),
requirement_results AS MATERIALIZED (
 SELECT q.id,q.demand_key,q.role,q.termination_id,q.endpoint_id,q.splice_id,q.part_id AS catalog_part_id,
 q.quantity,'each'::text AS unit,q.pns AS specified_part_numbers,q.all_blockers AS blockers,
 CASE WHEN count(k.rule_key)=3 AND bool_and(k.result='pass') AND cardinality(q.all_blockers)=0 THEN 'provisional' ELSE 'held' END AS state
 FROM qualified q LEFT JOIN checks k ON k.component_requirement_id=q.id
 GROUP BY q.id,q.demand_key,q.role,q.termination_id,q.endpoint_id,q.splice_id,q.part_id,q.quantity,q.pns,q.all_blockers)
SELECT jsonb_build_object(
 'requirements',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM requirement_results r),'[]'::jsonb),
 'contributors',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.requirement_id,r.segment_id,r.termination_id) FROM contributors r),'[]'::jsonb),
 'checks',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.component_requirement_id,r.rule_key) FROM checks r),'[]'::jsonb),
 'coverage',coalesce((SELECT jsonb_agg(jsonb_build_object('role',x.role,
  'recorded_owner_groups',x.total,'groups_with_any_assignment',x.assigned,
  'groups_without_assignment',x.total-x.assigned,'applicability_state','unassessed',
  'scope','selected_physical_piece_ends','kind','recorded_assignment_coverage') ORDER BY x.role)
  FROM(SELECT expected.role,count(DISTINCT r.demand_key) AS total,
   count(DISTINCT r.demand_key) FILTER(WHERE r.part_id IS NOT NULL OR nullif(btrim(r.pn),'') IS NOT NULL) AS assigned
   FROM(VALUES('terminal_contact'),('pin_seal'),('connector_housing'),('wedge_lock'),('boot')) expected(role)
   LEFT JOIN roles r ON r.role=expected.role GROUP BY expected.role
   UNION ALL SELECT 'splice',count(*),count(*) FILTER(WHERE part_id IS NOT NULL OR nullif(btrim(part_number),'') IS NOT NULL) FROM sp)x),'[]'::jsonb));
$component$;


REVOKE ALL ON FUNCTION public.harness_model_components(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.harness_model_components(jsonb,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.harness_model_compute(p_input jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=public AS $fn$
WITH model AS (SELECT p_input->'model' AS g),
s AS MATERIALIZED (SELECT x FROM model CROSS JOIN LATERAL jsonb_array_elements(g->'segments') a(x)),
t AS MATERIALIZED (SELECT x FROM model CROSS JOIN LATERAL jsonb_array_elements(g->'terminations') a(x)),
e AS MATERIALIZED (SELECT x FROM model CROSS JOIN LATERAL jsonb_array_elements(g->'endpoints') a(x)),
net_ids AS MATERIALIZED (SELECT x->>'id' AS id FROM model CROSS JOIN LATERAL jsonb_array_elements(g->'nets') a(x)),
part_ids AS MATERIALIZED (SELECT x->>'id' AS id FROM jsonb_array_elements(p_input->'catalog_parts') a(x)),
ends AS MATERIALIZED (
 SELECT s.x AS seg,side.side,t.x AS term,e.x AS endpoint,
  CASE WHEN s.x->>'link_state'<>'stale'
    AND s.x->>'net_id' IN (SELECT id FROM net_ids)
    AND e.x->>'node_kind'='bus' THEN 'bus'
   WHEN s.x->>'link_state'<>'stale'
    AND s.x->>'net_id' IN (SELECT id FROM net_ids)
    AND e.x->>'node_kind'='terminals' AND t.x->>'cavity_layout_id' IS NOT NULL THEN 'keyed_cavity'
   WHEN s.x->>'link_state'<>'stale'
    AND s.x->>'net_id' IN (SELECT id FROM net_ids)
    AND e.x->>'node_kind'='terminals' AND nullif(t.x->>'cavity','') IS NOT NULL
    AND t.x->>'cavity' !~* '^(stud|lug|[-+]?\s*post)' THEN 'recorded_cavity'
   ELSE 'isolated_end' END AS basis
 FROM s CROSS JOIN (VALUES ('from'),('to')) side(side)
 JOIN t ON t.x->>'id'=CASE side.side WHEN 'from' THEN s.x->>'from_termination_id' ELSE s.x->>'to_termination_id' END
 JOIN e ON e.x->>'id'=t.x->>'endpoint_id'
 WHERE t.x->>'circuit_id'=s.x->>'circuit_id'),
-- These groups compare recorded claims, not manufacturer applicability or a
-- physical continuity test. Case and annotation are deliberately preserved.
key_claims AS MATERIALIZED (
 SELECT endpoint->>'id' AS endpoint_id,term->>'cavity_layout_id' AS cavity_key,
  count(DISTINCT coalesce(term->>'cavity','')) AS labels,
  count(DISTINCT seg->>'net_id') AS nets
 FROM ends WHERE basis='keyed_cavity' GROUP BY 1,2),
label_claims AS MATERIALIZED (
 SELECT endpoint->>'id' AS endpoint_id,term->>'cavity' AS label,
  count(DISTINCT coalesce(term->>'cavity_layout_id','unkeyed')) AS keys,
  count(DISTINCT seg->>'net_id') AS nets
 FROM ends WHERE basis IN('keyed_cavity','recorded_cavity') AND nullif(term->>'cavity','') IS NOT NULL GROUP BY 1,2),
bus_claims AS MATERIALIZED (
 SELECT endpoint->>'id' AS endpoint_id,count(DISTINCT seg->>'net_id') AS nets
 FROM ends WHERE basis='bus' GROUP BY 1),
contact_states AS MATERIALIZED (
 SELECT a.*,
  CASE WHEN coalesce(k.nets,0)>1 OR coalesce(b.nets,0)>1 THEN 'fail'
   WHEN coalesce(k.labels,0)>1 OR coalesce(l.keys,0)>1 OR coalesce(l.nets,0)>1
    OR(a.basis='keyed_cavity' AND nullif(a.term->>'cavity','') IS NULL) THEN 'hold'
   ELSE 'pass' END AS contact_state
 FROM ends a
 LEFT JOIN key_claims k ON k.endpoint_id=a.endpoint->>'id' AND k.cavity_key=a.term->>'cavity_layout_id'
 LEFT JOIN label_claims l ON l.endpoint_id=a.endpoint->>'id' AND l.label=a.term->>'cavity' AND a.basis<>'bus'
 LEFT JOIN bus_claims b ON b.endpoint_id=a.endpoint->>'id' AND a.basis='bus'),
safe_ends AS MATERIALIZED (
 SELECT seg,side,term,endpoint,CASE WHEN contact_state='pass' THEN basis ELSE 'isolated_end' END AS basis,contact_state
 FROM contact_states),
keyed AS MATERIALIZED (
 SELECT *,jsonb_build_array('harness_model_node_v1',p_input->'model'->>'vehicle_id',seg->>'net_id',endpoint->>'id',basis,
   CASE basis WHEN 'bus' THEN 'bus' WHEN 'keyed_cavity' THEN term->>'cavity_layout_id'
    WHEN 'recorded_cavity' THEN term->>'cavity' ELSE jsonb_build_array(seg->>'id',side,term->>'id')::text END)::text AS node_key FROM safe_ends),
nodes AS MATERIALIZED (
 SELECT DISTINCT ON (node_key) md5(node_key)::uuid AS id,
  CASE WHEN seg->>'net_id' IN (SELECT id FROM net_ids) THEN (seg->>'net_id')::uuid END AS net_id,
  (endpoint->>'id')::uuid AS endpoint_id,
  CASE WHEN basis='keyed_cavity' THEN (term->>'cavity_layout_id')::uuid END AS cavity_layout_id,
  (seg->>'id')::uuid AS source_segment_id,(term->>'id')::uuid AS source_termination_id,basis,
  CASE WHEN basis='bus' THEN NULL ELSE term->>'cavity' END AS cavity_label
 FROM keyed ORDER BY node_key,seg->>'id',side),
attachments AS MATERIALIZED (
 SELECT (seg->>'id')::uuid AS segment_id,side,(term->>'id')::uuid AS termination_id,md5(node_key)::uuid AS node_id
 FROM keyed),
rules AS MATERIALIZED (SELECT x FROM jsonb_array_elements(p_input->'rules') a(x)),
checks AS MATERIALIZED (
 SELECT r.x->>'rule_key' AS rule_key,r.x->>'version' AS rule_version,(s.x->>'id')::uuid AS segment_id,NULL::uuid AS termination_id,NULL::uuid AS circuit_id,
  CASE r.x->>'rule_key'
   WHEN 'segment_links' THEN CASE
    WHEN EXISTS(SELECT FROM safe_ends a WHERE a.seg->>'id'=s.x->>'id' AND a.contact_state='fail') THEN 'fail'
    WHEN EXISTS(SELECT FROM safe_ends a WHERE a.seg->>'id'=s.x->>'id' AND a.contact_state='hold') THEN 'hold'
    WHEN s.x->>'from_termination_id' IS NOT NULL
     AND s.x->>'from_termination_id'=s.x->>'to_termination_id' THEN 'fail'
     ELSE CASE s.x->>'link_state' WHEN 'linked' THEN 'pass' WHEN 'stale' THEN 'fail' ELSE 'hold' END END
   WHEN 'segment_specification' THEN CASE s.x->>'specification_state' WHEN 'agrees' THEN 'pass' WHEN 'conflict' THEN 'fail' ELSE 'hold' END
   WHEN 'wire_stock_key' THEN CASE WHEN s.x->>'wire_part_id' IS NULL OR s.x->>'expected_part_number' IS NULL THEN 'hold'
     WHEN s.x->>'keyed_part_number' IS DISTINCT FROM s.x->>'expected_part_number' THEN 'fail' ELSE 'pass' END
   WHEN 'material_source_status' THEN CASE WHEN jsonb_typeof(s.x->'blockers')='array'
      AND jsonb_array_length(s.x->'blockers')>0 THEN 'hold' ELSE 'pass' END
   WHEN 'new_wire_demand' THEN CASE WHEN coalesce((s.x->>'physical_progress')::boolean,false)
      OR s.x->>'build_state' IS DISTINCT FROM 'uncut' OR s.x->>'measured_length_ft' IS NOT NULL
      OR s.x->>'measured_at' IS NOT NULL THEN 'hold' ELSE 'pass' END
   WHEN 'planned_wire_amount' THEN CASE WHEN (s.x->>'planned_length_ft')::numeric>0
     AND nullif(btrim(s.x->>'planned_length_method'),'') IS NOT NULL
     AND s.x->>'planned_length_method' !~* '^unknown' THEN 'pass' ELSE 'hold' END
   ELSE 'hold' END AS result
 FROM s CROSS JOIN rules r WHERE r.x->>'subject_kind'='segment'
 UNION ALL
 SELECT r.x->>'rule_key',r.x->>'version',NULL::uuid,(t.x->>'id')::uuid,NULL::uuid,
  CASE r.x->>'rule_key'
   WHEN 'termination_cavity_key' THEN CASE
    WHEN EXISTS(SELECT FROM safe_ends a WHERE a.term->>'id'=t.x->>'id' AND a.contact_state='fail') THEN 'fail'
    WHEN EXISTS(SELECT FROM safe_ends a WHERE a.term->>'id'=t.x->>'id' AND a.contact_state='hold') THEN 'hold'
    WHEN t.x->>'cavity_layout_id' IS NOT NULL THEN 'pass' ELSE 'hold' END
   WHEN 'terminal_catalog_key' THEN CASE WHEN t.x->>'terminal_contact_catalog_id' IN (SELECT id FROM part_ids) THEN 'pass' ELSE 'hold' END
   WHEN 'seal_catalog_key' THEN CASE WHEN t.x->>'pin_seal_catalog_id' IN (SELECT id FROM part_ids) THEN 'pass' ELSE 'hold' END
   WHEN 'tool_catalog_key' THEN CASE WHEN t.x->>'crimp_tool_catalog_id' IN (SELECT id FROM part_ids) THEN 'pass' ELSE 'hold' END
   ELSE 'hold' END
 FROM t CROSS JOIN rules r WHERE r.x->>'subject_kind'='termination'
 UNION ALL
 SELECT r.x->>'rule_key',r.x->>'version',NULL::uuid,NULL::uuid,(c.x->>'id')::uuid,
  CASE WHEN r.x->>'rule_key'='circuit_segments' AND EXISTS(SELECT FROM s WHERE s.x->>'circuit_id'=c.x->>'id')
   AND NOT EXISTS(SELECT FROM jsonb_array_elements(coalesce(g->'unsegmented_end_records','[]'::jsonb)) u(x)
    WHERE u.x->>'circuit_id'=c.x->>'id') THEN 'pass' ELSE 'hold' END
 FROM model CROSS JOIN LATERAL jsonb_array_elements(g->'circuits') c(x) CROSS JOIN rules r WHERE r.x->>'subject_kind'='circuit'
 UNION ALL
 SELECT r.x->>'rule_key',r.x->>'version',NULL::uuid,NULL::uuid,NULL::uuid,'hold'
 FROM rules r WHERE r.x->>'subject_kind'='vehicle'),
requirements AS MATERIALIZED (
 SELECT (s.x->>'id')::uuid AS segment_id,(s.x->>'wire_part_id')::uuid AS catalog_part_id,
  CASE WHEN s.x->>'wire_type' ~ '^M22759/(16|32)$' AND (s.x->>'planned_length_ft')::numeric>0
   THEN (s.x->>'planned_length_ft')::numeric END AS planned_quantity,
  CASE WHEN s.x->>'wire_type' ~ '^M22759/(16|32)$' THEN 'ft' END AS unit,
  CASE WHEN s.x->>'wire_type' ~ '^M22759/(16|32)$' AND s.x->>'wire_part_id' IS NOT NULL
    AND (s.x->>'planned_length_ft')::numeric>0
    AND s.x->>'link_state'='linked' AND s.x->>'specification_state'='agrees'
    AND s.x->>'expected_part_number' IS NOT NULL AND s.x->>'keyed_part_number'=s.x->>'expected_part_number'
    AND s.x->>'from_termination_id' IS DISTINCT FROM s.x->>'to_termination_id'
    AND NOT EXISTS (SELECT FROM checks k WHERE k.segment_id=(s.x->>'id')::uuid AND k.result<>'pass')
    AND NOT EXISTS (SELECT FROM checks k WHERE k.circuit_id=(s.x->>'circuit_id')::uuid
      AND k.rule_key='circuit_segments' AND k.result<>'pass')
   THEN 'provisional' ELSE 'held' END AS state FROM s),
components AS MATERIALIZED (
 SELECT public.harness_model_components(p_input,coalesce((SELECT jsonb_agg(to_jsonb(k)) FROM checks k),'[]'::jsonb)) AS result)
SELECT jsonb_build_object(
 'nodes',coalesce((SELECT jsonb_agg(to_jsonb(n) ORDER BY n.id) FROM nodes n),'[]'::jsonb),
 'segment_ends',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.segment_id,a.side) FROM attachments a),'[]'::jsonb),
 'checks',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.rule_key,c.segment_id,c.termination_id,c.circuit_id) FROM checks c),'[]'::jsonb)||(SELECT result->'checks' FROM components),
 'component_role_coverage',(SELECT result->'coverage' FROM components),
 'component_requirements',(SELECT result->'requirements' FROM components),
 'component_contributors',(SELECT result->'contributors' FROM components),
 'wire_requirements',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.segment_id) FROM requirements r),'[]'::jsonb));
$fn$;

CREATE OR REPLACE FUNCTION public.harness_model_scope_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE j jsonb:=to_jsonb(NEW); v uuid; k text; source_vehicle uuid; source_id uuid;
BEGIN
 SELECT r.vehicle_id INTO STRICT v FROM public.harness_model_evaluations r WHERE r.id=NEW.evaluation_id;
 FOREACH k IN ARRAY ARRAY['segment_id','source_segment_id','termination_id','source_termination_id','endpoint_id','net_id','circuit_id','splice_id'] LOOP
  IF j->>k IS NULL THEN CONTINUE; END IF;
  source_id:=(j->>k)::uuid;
  source_vehicle:=NULL;
  IF k IN ('segment_id','source_segment_id') THEN
   SELECT s.vehicle_id INTO source_vehicle FROM public.harness_segments s WHERE s.id=source_id;
  ELSIF k IN ('termination_id','source_termination_id') THEN
   SELECT t.vehicle_id INTO source_vehicle FROM public.wire_termination_specs t WHERE t.id=source_id;
  ELSIF k='endpoint_id' THEN
   SELECT d.vehicle_id INTO source_vehicle FROM public.harness_endpoints e JOIN public.harness_designs d ON d.id=e.design_id WHERE e.id=source_id;
  ELSIF k='net_id' THEN
   SELECT n.vehicle_id INTO source_vehicle FROM public.harness_nets n WHERE n.id=source_id;
  ELSIF k='splice_id' THEN
   SELECT sp.vehicle_id INTO source_vehicle FROM public.harness_splices sp WHERE sp.id=source_id;
  ELSIF k='circuit_id' THEN
   SELECT o.vehicle_id INTO source_vehicle FROM public.vehicle_custom_circuits c JOIN public.vehicle_wiring_overlays o ON o.id=c.overlay_id WHERE c.id=source_id;
  END IF;
  IF source_vehicle IS DISTINCT FROM v THEN RAISE EXCEPTION 'harness evaluation source scope mismatch: %',k USING ERRCODE='23514'; END IF;
 END LOOP;
 IF TG_TABLE_NAME='harness_model_segment_ends' THEN
  SELECT CASE NEW.side WHEN 'from' THEN s.from_termination_id ELSE s.to_termination_id END INTO source_id
  FROM public.harness_segments s WHERE s.id=NEW.segment_id;
  IF source_id IS DISTINCT FROM NEW.termination_id THEN RAISE EXCEPTION 'harness evaluation attachment is not the recorded segment end' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS (SELECT FROM public.harness_model_nodes n JOIN public.wire_termination_specs t ON t.endpoint_id=n.endpoint_id
    WHERE n.evaluation_id=NEW.evaluation_id AND n.id=NEW.node_id AND t.id=NEW.termination_id) THEN
   RAISE EXCEPTION 'harness evaluation node is not the recorded endpoint' USING ERRCODE='23514';
  END IF;
 END IF;
 IF TG_TABLE_NAME='harness_model_component_contributors' THEN
 IF NOT EXISTS (
  SELECT FROM public.harness_segments s JOIN public.wire_termination_specs t
   ON t.id=NEW.termination_id AND t.circuit_id=s.vehicle_custom_circuit_id
  JOIN public.harness_model_component_requirements q ON q.evaluation_id=NEW.evaluation_id AND q.id=NEW.requirement_id
  LEFT JOIN public.harness_splices sp ON sp.id=q.splice_id
  WHERE s.id=NEW.segment_id AND s.vehicle_custom_circuit_id=NEW.circuit_id
   AND t.id IN(s.from_termination_id,s.to_termination_id)
   AND (q.termination_id=t.id OR q.endpoint_id=t.endpoint_id OR (sp.endpoint_id=t.endpoint_id
     AND (sp.placement<>'at_pin' OR sp.cavity=regexp_replace(btrim(t.cavity),'^([A-Za-z]+)_?0*([0-9]+)$','\1\2'))))) THEN
  RAISE EXCEPTION 'component contributor is not the recorded physical owner edge' USING ERRCODE='23514';
 END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE TRIGGER harness_model_components_scope BEFORE INSERT ON public.harness_model_component_requirements FOR EACH ROW EXECUTE FUNCTION public.harness_model_scope_guard();
CREATE TRIGGER harness_model_contributors_scope BEFORE INSERT ON public.harness_model_component_contributors FOR EACH ROW EXECUTE FUNCTION public.harness_model_scope_guard();
CREATE TRIGGER harness_model_components_immutable BEFORE UPDATE OR DELETE ON public.harness_model_component_requirements FOR EACH ROW EXECUTE FUNCTION public.vein_append_only();
CREATE TRIGGER harness_model_contributors_immutable BEFORE UPDATE OR DELETE ON public.harness_model_component_contributors FOR EACH ROW EXECUTE FUNCTION public.vein_append_only();

COMMENT ON COLUMN public.harness_model_component_requirements.evaluation_id IS 'Exact immutable input and logic receipt that owns this computed requirement.';
COMMENT ON COLUMN public.harness_model_component_requirements.id IS 'Deterministic component identity within this evaluation; use the composite key, never this UUID alone.';
COMMENT ON COLUMN public.harness_model_component_requirements.demand_key IS 'Typed physical owner and role key; source labels do not become additional material quantities.';
COMMENT ON COLUMN public.harness_model_component_requirements.role IS 'Physical component role; tools and construction materials have separate applicability and are not invented here.';
COMMENT ON COLUMN public.harness_model_component_requirements.termination_id IS 'Individual physical end owner, used for distinct bus lugs or unresolved isolated ends.';
COMMENT ON COLUMN public.harness_model_component_requirements.endpoint_id IS 'Shared physical endpoint or contact-site owner, qualified by demand_key and contributor edges.';
COMMENT ON COLUMN public.harness_model_component_requirements.splice_id IS 'Existing physical splice revision counted once, with its declared members retained in input_snapshot.';
COMMENT ON COLUMN public.harness_model_component_requirements.catalog_part_id IS 'Exact agreed catalog identity; null when missing or conflicting.';
COMMENT ON COLUMN public.harness_model_component_requirements.quantity IS 'Whole physical component count when its basis and catalog binding are known; null means unresolved, not zero.';
COMMENT ON COLUMN public.harness_model_component_requirements.unit IS 'Canonical component count unit each; no supplier pack conversion.';
COMMENT ON COLUMN public.harness_model_component_requirements.state IS 'Provisional structural amount or held; neither constitutes procurement, fit or assembly release.';
COMMENT ON COLUMN public.harness_model_component_requirements.blockers IS 'Explicit deterministic reasons that prevent provisional structural demand.';
COMMENT ON COLUMN public.harness_model_component_requirements.specified_part_numbers IS 'Distinct raw part-number assignments retained for exact catalog agreement checks.';
COMMENT ON COLUMN public.harness_model_component_contributors.evaluation_id IS 'Same exact evaluation as the requirement composite foreign key.';
COMMENT ON COLUMN public.harness_model_component_contributors.requirement_id IS 'Component requirement identity within the bound evaluation.';
COMMENT ON COLUMN public.harness_model_component_contributors.segment_id IS 'Actual contributing physical piece revision; never a route branch.';
COMMENT ON COLUMN public.harness_model_component_contributors.termination_id IS 'Actual recorded end of that physical piece. For splices this is physical reach, not an invented member declaration.';
COMMENT ON COLUMN public.harness_model_component_contributors.circuit_id IS 'Exact source circuit revision of both piece and end.';
COMMENT ON COLUMN public.harness_model_evaluations.component_requirement_count IS 'Expected component child row count; the public reader withholds derived results if visible rows are incomplete.';
COMMENT ON COLUMN public.harness_model_evaluations.component_contributor_count IS 'Expected exact physical contributor edge count for visibility and atomicity verification.';
COMMENT ON COLUMN public.harness_model_evaluations.component_role_coverage IS 'Immutable input-bound recorded-assignment coverage for six component roles. Owner groups without assignments are unassessed, never verified zero required parts; fit/applicability is unassessed. Historical receipts default to an empty unassessed array.';
COMMENT ON COLUMN public.harness_model_checks.component_requirement_id IS 'Optional typed component subject in this same evaluation; exactly one subject grain is allowed.';
COMMENT ON FUNCTION public.harness_model_components(jsonb,jsonb) IS 'Pure set-based physical component substep of the canonical evaluation. It consumes the exact same captured model and existing segment rule results, preserves source holds, and never supplies electrical readiness, supplier conversions or stock state.';



-- Remaining producer/reader/logic/invalidation integration follows below.

DO $producer$
DECLARE b text:=pg_get_functiondef('public.harness_model_fold(uuid)'::regprocedure); a text; z text;
BEGIN
 FOR a,z IN SELECT * FROM(VALUES
 ($a$('engineering_coverage')) expected(k)$a$,$z$('component_source_status'),('component_part_assignment'),('component_quantity_basis'),('engineering_coverage')) expected(k)$z$),
 ($a$wire_requirement_count,sheet_count$a$,$z$wire_requirement_count,component_requirement_count,component_contributor_count,component_role_coverage,sheet_count$z$),
 ($a$jsonb_array_length(result->'wire_requirements'),jsonb_array_length(result->'manual'->'sheets')$a$,
  $z$jsonb_array_length(result->'wire_requirements'),jsonb_array_length(result->'component_requirements'),jsonb_array_length(result->'component_contributors'),result->'component_role_coverage',jsonb_array_length(result->'manual'->'sheets')$z$),
 ($a$circuit_id,result)$a$,$z$circuit_id,component_requirement_id,result)$z$),
 ($a$x.circuit_id,x.result$a$,$z$x.circuit_id,x.component_requirement_id,x.result$z$),
 ($a$circuit_id uuid,result text)$a$,$z$circuit_id uuid,component_requirement_id uuid,result text)$z$),
 ($a$INSERT INTO public.harness_model_checks(evaluation_id$a$,$z$harness_phase:='component_requirements';
   RAISE LOG 'harness_fold_phase vehicle %, phase %, fold_ms %, statement_ms %',p_vehicle_id,harness_phase,
    round(extract(epoch from clock_timestamp()-harness_started_at)*1000),round(extract(epoch from clock_timestamp()-statement_timestamp())*1000);
   INSERT INTO public.harness_model_component_requirements(evaluation_id,id,demand_key,role,termination_id,endpoint_id,splice_id,catalog_part_id,quantity,unit,state,blockers,specified_part_numbers)
    SELECT evaluation,x.id,x.demand_key,x.role,x.termination_id,x.endpoint_id,x.splice_id,x.catalog_part_id,x.quantity,x.unit,x.state,x.blockers,x.specified_part_numbers
    FROM jsonb_to_recordset(result->'component_requirements') x(id uuid,demand_key text,role text,termination_id uuid,endpoint_id uuid,splice_id uuid,catalog_part_id uuid,quantity numeric,unit text,state text,blockers text[],specified_part_numbers text[]);
   harness_phase:='component_contributors';
   RAISE LOG 'harness_fold_phase vehicle %, phase %, fold_ms %, statement_ms %',p_vehicle_id,harness_phase,
    round(extract(epoch from clock_timestamp()-harness_started_at)*1000),round(extract(epoch from clock_timestamp()-statement_timestamp())*1000);
   INSERT INTO public.harness_model_component_contributors(evaluation_id,requirement_id,segment_id,termination_id,circuit_id)
    SELECT evaluation,x.requirement_id,x.segment_id,x.termination_id,x.circuit_id
    FROM jsonb_to_recordset(result->'component_contributors') x(requirement_id uuid,segment_id uuid,termination_id uuid,circuit_id uuid);
   harness_phase:='checks';
   INSERT INTO public.harness_model_checks(evaluation_id$z$)
 ) changes(old,new) LOOP
  IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'component producer anchor drift: %',left(a,100); END IF;
  b:=replace(b,a,z);
 END LOOP;
 EXECUTE b;
END $producer$;

-- New source dependencies use the same epoch/signal owner, not a new queue.
DO $dependencies$
DECLARE b text:=pg_get_functiondef('public.harness_model_source_changed()'::regprocedure); a text; z text;
BEGIN
 FOR a,z IN SELECT * FROM(VALUES
 ($a$ ELSIF TG_TABLE_NAME='catalog_parts' THEN$a$,$z$ ELSIF TG_TABLE_NAME='harness_splice_members' THEN
  SELECT array_agg(DISTINCT sp.vehicle_id) INTO ids FROM public.harness_splices sp
   WHERE sp.id IN((a->>'splice_id')::uuid,(b->>'splice_id')::uuid);
 ELSIF TG_TABLE_NAME='catalog_parts' THEN$z$),
 ($a$t.terminal_contact_catalog_id,t.pin_seal_catalog_id,t.crimp_tool_catalog_id$a$,
  $z$t.terminal_contact_catalog_id,t.pin_seal_catalog_id,t.crimp_tool_catalog_id,t.connector_housing_catalog_id,t.wedge_lock_catalog_id,t.boot_catalog_id$z$),
 ($a$t.crimp_tool_catalog_id,t.connector_housing_catalog_id,t.wedge_lock_catalog_id,t.boot_catalog_id))) q;$a$,
  $z$t.crimp_tool_catalog_id,t.connector_housing_catalog_id,t.wedge_lock_catalog_id,t.boot_catalog_id))
   UNION SELECT sp.vehicle_id FROM public.harness_splices sp WHERE NOT sp.is_superseded
    AND sp.part_id IN((a->>'id')::uuid,(b->>'id')::uuid)) q;$z$)
 ) changes(old,new) LOOP
  -- The catalog part tuple occurs twice, once for OLD and once for NEW.
  IF a LIKE 't.terminal_contact%' THEN
   IF (length(b)-length(replace(b,a,'')))/length(a)<>2 THEN RAISE EXCEPTION 'component catalog tuple anchor drift'; END IF;
  ELSIF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'component dependency anchor drift: %',left(a,100); END IF;
  b:=replace(b,a,z);
 END LOOP;
 EXECUTE b;
END $dependencies$;
CREATE TRIGGER harness_model_splices_changed AFTER INSERT OR UPDATE OR DELETE ON public.harness_splices FOR EACH ROW EXECUTE FUNCTION public.harness_model_source_changed();
CREATE TRIGGER harness_model_splice_members_changed AFTER INSERT OR UPDATE OR DELETE ON public.harness_splice_members FOR EACH ROW EXECUTE FUNCTION public.harness_model_source_changed();

INSERT INTO public.harness_model_rules(rule_key,version,subject_kind,description,implementation,display_name,attention_action,attention_order) VALUES
 ('component_source_status','1','component','Exact physical contributors and current decided source revisions are usable, including contact consistency and selected-circuit end accounting; unresolved splice members hold the component.','public.harness_model_compute(jsonb)'::regprocedure,'Component source relationships checked','Resolve the exact source ends, circuit gaps and splice members before using this component demand.',100),
 ('component_part_assignment','1','component','All contributors agree on one visible exact catalog identity; this does not establish manufacturer fit.','public.harness_model_compute(jsonb)'::regprocedure,'Component part identified','Resolve missing or competing catalog identities and recorded part numbers.',110),
 ('component_quantity_basis','1','component','Component count has an unambiguous physical owner; shared contacts and missing cavity identity remain withheld.','public.harness_model_compute(jsonb)'::regprocedure,'Component quantity basis checked','Resolve the physical contact or shared-component count before using its demand.',120);

DO $receipt$
DECLARE b text:=pg_get_functiondef('public.harness_model_receipt_for_hash(uuid,text)'::regprocedure); a text; z text;
BEGIN
 FOR a,z IN SELECT * FROM(VALUES
 ($a$e.wire_requirement_count,e.sheet_count$a$,$z$e.wire_requirement_count,e.component_requirement_count,e.component_contributor_count,e.component_role_coverage,e.sheet_count$z$),
 ($a$ AND r.sheet_count=$a$,$z$ AND r.component_requirement_count=(SELECT count(*) FROM public.harness_model_component_requirements q WHERE q.evaluation_id=r.id)
 AND r.component_contributor_count=(SELECT count(*) FROM public.harness_model_component_contributors q WHERE q.evaluation_id=r.id)
 AND r.sheet_count=$z$)
 ) changes(old,new) LOOP
  IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'component receipt anchor drift: %',a; END IF;
  b:=replace(b,a,z);
 END LOOP;
 EXECUTE b;
END $receipt$;

DO $drawing$
DECLARE b text:=pg_get_functiondef('public.harness_manual_sheet(uuid,uuid,uuid)'::regprocedure); a text; z text;
BEGIN
 FOR a,z IN SELECT * FROM(VALUES
 ($a$checks AS MATERIALIZED(SELECT c.*$a$,$z$component_ids AS MATERIALIZED(SELECT DISTINCT q.requirement_id FROM public.harness_model_component_contributors q
 WHERE q.evaluation_id=p_evaluation_id AND q.segment_id IN(SELECT segment_id FROM members)),
component_page AS MATERIALIZED(SELECT q.* FROM public.harness_model_component_requirements q
 WHERE q.evaluation_id=p_evaluation_id AND q.id IN(SELECT requirement_id FROM component_ids) ORDER BY q.id LIMIT 100),
component_edge_page AS MATERIALIZED(SELECT q.* FROM public.harness_model_component_contributors q
 WHERE q.evaluation_id=p_evaluation_id AND q.requirement_id IN(SELECT id FROM component_page)
 AND q.segment_id IN(SELECT segment_id FROM members) ORDER BY q.requirement_id,q.segment_id,q.termination_id LIMIT 100),
checks AS MATERIALIZED(SELECT c.*$z$),
 ($a$OR c.circuit_id::text IN(SELECT x->>'id' FROM circuits) OR$a$,$z$OR c.circuit_id::text IN(SELECT x->>'id' FROM circuits)
 OR c.component_requirement_id IN(SELECT id FROM component_page) OR$z$),
 ($a$  'rule_definitions',p->'rules',$a$,$z$  'component_requirements',coalesce((SELECT jsonb_agg(to_jsonb(q)-'evaluation_id' ORDER BY q.id) FROM component_page q),'[]'::jsonb),
  'component_requirement_count',(SELECT count(*) FROM component_ids),
  'component_requirements_complete',(SELECT count(*)<=100 FROM component_ids),
  'component_contributors',coalesce((SELECT jsonb_agg(to_jsonb(q)-'evaluation_id' ORDER BY q.requirement_id,q.segment_id,q.termination_id) FROM component_edge_page q),'[]'::jsonb),
  'component_contributor_count',(SELECT count(*) FROM public.harness_model_component_contributors q
   WHERE q.evaluation_id=p_evaluation_id AND q.requirement_id IN(SELECT requirement_id FROM component_ids) AND q.segment_id IN(SELECT segment_id FROM members)),
  'component_contributors_complete',(SELECT count(*)<=100 FROM public.harness_model_component_contributors q
   WHERE q.evaluation_id=p_evaluation_id AND q.requirement_id IN(SELECT requirement_id FROM component_ids) AND q.segment_id IN(SELECT segment_id FROM members)),
  'component_role_coverage',r->'component_role_coverage','component_coverage_scope','entire_selected_evaluation',
  'component_scope','actual_sheet_piece_contributions','rule_definitions',p->'rules',$z$)
 ) changes(old,new) LOOP
  IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'component drawing anchor drift: %',left(a,100); END IF;
  b:=replace(b,a,z);
 END LOOP;
 EXECUTE b;
END $drawing$;

DO $collections$
DECLARE b text:=pg_get_functiondef('public.harness_model_collection_page(uuid,uuid,text,text,integer)'::regprocedure); a text; z text;
BEGIN
 a:=$a$p_collection='wire_requirements' AND q.evaluation_id=p_evaluation_id AND EXISTS(SELECT FROM eligible))$a$;
 z:=$z$p_collection='wire_requirements' AND q.evaluation_id=p_evaluation_id AND EXISTS(SELECT FROM eligible)
 UNION ALL SELECT q.id::text,to_jsonb(q)-'evaluation_id' FROM public.harness_model_component_requirements q
 WHERE p_collection='component_requirements' AND q.evaluation_id=p_evaluation_id AND EXISTS(SELECT FROM eligible)
 UNION ALL SELECT q.requirement_id::text||'/'||q.segment_id::text||'/'||q.termination_id::text,to_jsonb(q)-'evaluation_id'
 FROM public.harness_model_component_contributors q WHERE p_collection='component_contributors' AND q.evaluation_id=p_evaluation_id AND EXISTS(SELECT FROM eligible))$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'component collection row anchor drift'; END IF;
 b:=replace(b,a,z);
 a:=$a$'checks','nodes','ends','wire_requirements'$a$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'component collection kind anchor drift'; END IF;
 EXECUTE replace(b,a,$z$'checks','nodes','ends','wire_requirements','component_requirements','component_contributors'$z$);
END $collections$;

DO $logic$
DECLARE b text:=pg_get_functiondef('public.harness_model_logic_snapshot()'::regprocedure);
 a text:=$a$'postgres_version',current_setting('server_version_num')$a$;
BEGIN
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'component logic receipt anchor drift'; END IF;
 EXECUTE replace(b,a,$z$'harness_model_components(jsonb,jsonb)',pg_get_functiondef('public.harness_model_components(jsonb,jsonb)'::regprocedure),
  'postgres_version',current_setting('server_version_num')$z$);
END $logic$;
-- Preserve the service-only bulk diagnostic while sharing complete-receipt
-- eligibility with the public bounded readers. Function privileges stay intact.
CREATE OR REPLACE FUNCTION public.harness_evaluated_model(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public SET timezone='UTC' AS $fn$
WITH input AS MATERIALIZED(SELECT public.harness_model_inputs(p_vehicle_id) AS p),
receipt AS MATERIALIZED(SELECT public.harness_model_receipt_for_hash(p_vehicle_id,md5(p::text)) AS r FROM input),
body AS(SELECT jsonb_build_object('status',CASE WHEN p IS NULL THEN 'unavailable' WHEN r IS NULL
 THEN public.harness_model_pending_status(p_vehicle_id,md5(p::text)) ELSE 'current' END,
 'current',r IS NOT NULL,'evaluation_id',r->'id','coverage','structural_v1',
 'checked_at',(SELECT checked_at FROM public.harness_model_state WHERE vehicle_id=p_vehicle_id),
 'source_epoch',(SELECT source_epoch FROM public.harness_model_state WHERE vehicle_id=p_vehicle_id),
 'folded_epoch',(SELECT folded_epoch FROM public.harness_model_state WHERE vehicle_id=p_vehicle_id),
 'model',CASE WHEN r IS NOT NULL THEN p->'model'||jsonb_build_object(
 'evaluation_id',r->'id','input_hash',r->'input_hash','logic_key',r->'logic_key','evaluated_at',r->'evaluated_at',
 'coverage','structural_v1','component_role_coverage',r->'component_role_coverage','rule_definitions',p->'rules',
 'electrical_nodes',coalesce((SELECT jsonb_agg(to_jsonb(q)-'evaluation_id' ORDER BY q.id) FROM public.harness_model_nodes q WHERE q.evaluation_id=(r->>'id')::uuid),'[]'::jsonb),
 'segment_ends',coalesce((SELECT jsonb_agg(to_jsonb(q)-'evaluation_id' ORDER BY q.segment_id,q.side) FROM public.harness_model_segment_ends q WHERE q.evaluation_id=(r->>'id')::uuid),'[]'::jsonb),
 'model_checks',coalesce((SELECT jsonb_agg(to_jsonb(q)-'evaluation_id' ORDER BY q.id) FROM public.harness_model_checks q WHERE q.evaluation_id=(r->>'id')::uuid),'[]'::jsonb),
 'attention_check_ids',coalesce((SELECT jsonb_agg(q.id ORDER BY CASE q.result WHEN 'fail' THEN 0 ELSE 1 END,d.attention_order,q.id) FROM public.harness_model_checks q JOIN public.harness_model_rules d ON d.rule_key=q.rule_key AND d.version=q.rule_version WHERE q.evaluation_id=(r->>'id')::uuid AND q.result<>'pass'),'[]'::jsonb),
 'wire_requirements',coalesce((SELECT jsonb_agg(to_jsonb(q)-'evaluation_id' ORDER BY q.segment_id) FROM public.harness_model_wire_requirements q WHERE q.evaluation_id=(r->>'id')::uuid),'[]'::jsonb),
 'component_requirements',coalesce((SELECT jsonb_agg(to_jsonb(q)-'evaluation_id' ORDER BY q.id) FROM public.harness_model_component_requirements q WHERE q.evaluation_id=(r->>'id')::uuid),'[]'::jsonb),
 'component_contributors',coalesce((SELECT jsonb_agg(to_jsonb(q)-'evaluation_id' ORDER BY q.requirement_id,q.segment_id,q.termination_id) FROM public.harness_model_component_contributors q WHERE q.evaluation_id=(r->>'id')::uuid),'[]'::jsonb)) END) AS payload FROM input CROSS JOIN receipt)
SELECT payload||jsonb_build_object('model',CASE WHEN payload->'model'<>'null'::jsonb THEN payload->'model'||jsonb_build_object('snapshot_hash',md5((payload->'model')::text),'read_at',statement_timestamp()) ELSE NULL END) FROM body;
$fn$;
COMMENT ON FUNCTION public.harness_model_inputs(uuid) IS 'Invoker current selected input over the existing source graph, exact component catalog assignments, actual endpoint revision/design status, reached splice revisions and every declared member. Named-field projection preserves current circuit context and selected-end gaps; no source prose, default-decided status, fit or purchase fact is manufactured.';
COMMENT ON FUNCTION public.harness_model_compute(jsonb) IS 'One pure input-bound structural computation for nodes, end attachments, typed checks, per-piece wire predictions and shared/end/splice component contributions. Known counts remain held when source relationships are incomplete. Recorded assignment coverage explicitly leaves applicability unassessed; it is not a complete BOM or engineering/order/build release.';
COMMENT ON FUNCTION public.harness_manual_sheet(uuid,uuid,uuid) IS 'Source-verified exact-evaluation drawing of at most8 physical pieces. Includes at most25 current unattached-end addresses and100 component requirements/contributor edges, each with exact full count and explicit completeness. Component checks use the same typed persisted owner. Follow bounded collection pages and final manifest proof before assembling a complete packet; no procurement or construction release.';
COMMENT ON FUNCTION public.harness_model_collection_page(uuid,uuid,text,text,integer) IS 'At most100 immutable derived rows per keyset page, now including typed component requirements and physical contributors. Requires the complete current evaluation cursor/code and source visibility. Status available is not a new source hash proof; recheck the source-verified manual manifest before publishing an assembled export. No old evaluation retargeting.';
COMMENT ON FUNCTION public.harness_evaluated_model(uuid) IS 'Service-only bulk diagnostic of the same complete source/code/epoch-bound evaluation consumed by bounded public manual readers, including component requirements, exact contributor edges and unassessed role coverage. Private receipts and caller privileges remain unchanged; no complete-BOM, engineering, stock or build release.';
NOTIFY pgrst,'reload schema';
COMMIT;

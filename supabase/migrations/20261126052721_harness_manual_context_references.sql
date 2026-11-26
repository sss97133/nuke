-- Follow-up to41635: source categories, adjacent navigation and bounded print references.
-- Functional manual pages retain canonical source keys and existing evaluation ownership.
-- Source categories organize presentation only; no new electrical or physical claim.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';

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
 SELECT a.x FROM raw CROSS JOIN LATERAL jsonb_array_elements(g->'terminations') a(x)
 WHERE EXISTS (SELECT FROM s WHERE a.x->>'id' IN (s.x->>'from_termination_id',s.x->>'to_termination_id'))),
-- Explicit projection prevents a future raw-reader metadata/prose extension from entering public evaluations.
allowed(k,keys) AS (VALUES
  ('circuits',ARRAY['id','code','name','section','system_category','from_endpoint_id','to_endpoint_id','design_status','gauge_awg','colour','wire_type','is_superseded','superseded_by']::text[]),
  ('segments',ARRAY['id','net_id','circuit_id','current_circuit_id','reference_fingerprint','from_termination_id','to_termination_id','wire_part_id','gauge_awg','colour','planned_length_ft','planned_length_method','measured_length_ft','measured_at','build_state','design_status','in_current_plan','expected_gauge_awg','expected_colour','expected_part_number','expected_part_id','physical_progress','needs_revision','circuit_code','circuit_gauge_awg','circuit_colour','wire_type','keyed_part_number','link_state','specification_state','blockers']::text[]),
  ('terminations',ARRAY['id','circuit_id','endpoint_id','cavity','cavity_layout_id','terminal_contact_catalog_id','terminal_contact_pn','pin_seal_catalog_id','pin_seal_pn','crimp_tool_catalog_id','crimp_tool_pn','connector_housing_catalog_id','connector_housing_pn','wedge_lock_catalog_id','wedge_lock_pn','is_superseded','superseded_by']::text[]),
  ('endpoints',ARRAY['id','code','name','type','node_kind','part_number','topology_node_id','design_status','is_superseded','superseded_by']::text[]),
  ('nets',ARRAY['id','code','signal_id','signal_link_state','signal_reference_fingerprint','function','nominal_current_a','peak_current_a','protection_pdm_channel_ids','protection_pdm_channel_id','protection_fuse_part_id','protection_setting_a','is_superseded','superseded_by']::text[]),
  ('connector_matings',ARRAY['from_endpoint_id','to_endpoint_id','relation']::text[]),
  ('evidence_edges',ARRAY['id','observation_id','row_kind','row_id','field','relation']::text[])),
objects AS (
 SELECT a.k,coalesce(jsonb_agg(coalesce((SELECT jsonb_object_agg(j.key,j.value) FROM jsonb_each(x) j
    WHERE j.key=ANY(a.keys)),'{}'::jsonb) ORDER BY x->>'id',x::text) FILTER(WHERE x IS NOT NULL),'[]'::jsonb) AS items
 FROM raw CROSS JOIN allowed a LEFT JOIN LATERAL jsonb_array_elements(
  CASE a.k WHEN 'circuits' THEN coalesce((SELECT jsonb_agg(x) FROM c),'[]'::jsonb)
   WHEN 'segments' THEN coalesce((SELECT jsonb_agg(x) FROM s),'[]'::jsonb)
   WHEN 'terminations' THEN coalesce((SELECT jsonb_agg(x) FROM t),'[]'::jsonb)
   ELSE coalesce(g->a.k,'[]'::jsonb) END) o(x) ON true GROUP BY a.k),
model AS (
 SELECT jsonb_object_agg(k,items) || jsonb_build_object('contract_version',2,'vehicle_id',p_vehicle_id,
  'snapshot_kind','current_read_not_published_revision','selection','decided_design') AS g
 FROM objects WHERE EXISTS (SELECT FROM raw WHERE g IS NOT NULL) HAVING count(*)>0),
part_ids AS (
 SELECT (x->>'wire_part_id')::uuid AS id FROM s
 UNION SELECT (x->>'terminal_contact_catalog_id')::uuid FROM t
 UNION SELECT (x->>'pin_seal_catalog_id')::uuid FROM t
 UNION SELECT (x->>'crimp_tool_catalog_id')::uuid FROM t)
SELECT jsonb_build_object('model',g,
 'catalog_parts',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'part_number',p.part_number) ORDER BY p.id)
   FROM public.catalog_parts p WHERE p.id IN (SELECT id FROM part_ids)),'[]'::jsonb),
 'rules',coalesce((SELECT jsonb_agg(jsonb_build_object('rule_key',r.rule_key,'version',r.version,
   'subject_kind',r.subject_kind,'description',r.description,'display_name',r.display_name,
   'attention_action',r.attention_action,'attention_order',r.attention_order,'implementation',r.implementation::text)
   ORDER BY r.rule_key) FROM public.harness_model_rules r WHERE r.is_current),'[]'::jsonb))
FROM model;
$fn$;

CREATE OR REPLACE FUNCTION public.harness_manual_compute(p_input jsonb,p_result jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=public AS $fn$
WITH RECURSIVE circuits AS MATERIALIZED (
 SELECT x FROM jsonb_array_elements(coalesce(p_input->'model'->'circuits','[]'::jsonb)) a(x)),
terminations AS MATERIALIZED (
 SELECT x FROM jsonb_array_elements(coalesce(p_input->'model'->'terminations','[]'::jsonb)) a(x)
 WHERE NOT coalesce((x->>'is_superseded')::boolean,false) AND x->>'superseded_by' IS NULL),
endpoints AS MATERIALIZED (
 SELECT x FROM jsonb_array_elements(coalesce(p_input->'model'->'endpoints','[]'::jsonb)) a(x)
 WHERE NOT coalesce((x->>'is_superseded')::boolean,false) AND x->>'superseded_by' IS NULL),
pieces AS MATERIALIZED (
 SELECT s.x AS piece,c.x AS circuit,s.x->>'id' AS segment_id,s.x->>'circuit_id' AS circuit_id,
  coalesce(s.x->>'circuit_id','piece/'||(s.x->>'id')) AS circuit_key,
  c.x->>'code' AS code,c.x->>'section' AS section,c.x->>'system_category' AS system_category,
  row_number() OVER(PARTITION BY coalesce(s.x->>'circuit_id','piece/'||(s.x->>'id')) ORDER BY s.x->>'id') AS circuit_position
 FROM jsonb_array_elements(coalesce(p_input->'model'->'segments','[]'::jsonb)) s(x)
 LEFT JOIN circuits c ON c.x->>'id'=s.x->>'circuit_id'),
principal_candidates AS MATERIALIZED (
 SELECT DISTINCT p.circuit_key,e.x->>'id' AS endpoint_id,e.x->>'code' AS endpoint_code,e.x->>'name' AS endpoint_name
 FROM pieces p JOIN terminations t ON t.x->>'id' IN (p.piece->>'from_termination_id',p.piece->>'to_termination_id')
  AND t.x->>'circuit_id'=p.circuit_id
 JOIN endpoints e ON e.x->>'id'=t.x->>'endpoint_id'
 WHERE p.circuit->>'design_status'='decided'
  AND NOT coalesce((p.circuit->>'is_superseded')::boolean,false) AND p.circuit->>'superseded_by' IS NULL
  AND e.x->>'type' IN ('sensor','actuator','switch','display') AND e.x->>'node_kind'='terminals'),
principal_counts AS (
 SELECT circuit_key,count(*) AS candidate_count,min(endpoint_id) AS endpoint_id,
  min(endpoint_code) AS endpoint_code,min(endpoint_name) AS endpoint_name
 FROM principal_candidates GROUP BY circuit_key),
grouped AS (
 SELECT p.*,CASE WHEN q.candidate_count=1 THEN 'endpoint/'||q.endpoint_id ELSE 'ungrouped/'||jsonb_build_array(p.system_category)::text END AS group_key,
  CASE WHEN q.candidate_count=1 THEN coalesce(nullif(q.endpoint_code,''),q.endpoint_id)
   ELSE '~ungrouped/'||jsonb_build_array(p.system_category)::text END AS group_order,
  CASE WHEN q.candidate_count=1 THEN
    coalesce(nullif(q.endpoint_name,''),nullif(q.endpoint_code,''),'Unnamed device')
    ||CASE WHEN nullif(q.endpoint_code,'') IS NOT NULL THEN ' ['||q.endpoint_code||']' ELSE '' END
   ELSE CASE WHEN p.system_category IS NULL THEN 'Subsystem not recorded'
    WHEN btrim(p.system_category)='' THEN 'Blank recorded subsystem' ELSE p.system_category END||' / Ungrouped circuits'
  END AS group_title
 FROM pieces p LEFT JOIN principal_counts q ON q.circuit_key=p.circuit_key),
chunks AS (
 SELECT circuit_key,code,section,group_key,group_order,group_title,(circuit_position-1)/8 AS chunk,count(*)::integer AS weight
 FROM grouped GROUP BY circuit_key,code,section,group_key,group_order,group_title,(circuit_position-1)/8),
ordered AS (
 SELECT *,row_number() OVER(PARTITION BY section,group_key ORDER BY code COLLATE "C",circuit_key,chunk) AS position
 FROM chunks),
packed AS (
 SELECT o.*,1 AS page,weight AS used FROM ordered o WHERE position=1
 UNION ALL
 SELECT o.*,CASE WHEN p.used+o.weight>8 THEN p.page+1 ELSE p.page END,
  CASE WHEN p.used+o.weight>8 THEN o.weight ELSE p.used+o.weight END
 FROM packed p JOIN ordered o ON o.section IS NOT DISTINCT FROM p.section AND o.group_key=p.group_key AND o.position=p.position+1),
assigned AS (
 SELECT a.*,p.page FROM grouped a JOIN packed p ON p.circuit_key=a.circuit_key AND p.chunk=(a.circuit_position-1)/8),
raw_headers AS (
 SELECT section,group_key,group_order,group_title,page,
  md5(jsonb_build_array('manual_sheet_device_v2',p_input->'model'->>'vehicle_id',section,group_key,
   jsonb_agg(segment_id ORDER BY code COLLATE "C",circuit_key,circuit_position))::text)::uuid AS id,
  count(*)::integer AS piece_count
 FROM assigned GROUP BY section,group_key,group_order,group_title,page),
headers AS (
 SELECT *,row_number() OVER(PARTITION BY section ORDER BY group_order COLLATE "C",group_key,page)::integer AS ordinal,
  count(*) OVER(PARTITION BY section,group_key) AS group_pages
 FROM raw_headers),
members AS (
 SELECT h.id AS sheet_id,a.segment_id::uuid,
  row_number() OVER(PARTITION BY h.id ORDER BY a.code COLLATE "C",a.circuit_key,a.circuit_position)::integer AS ordinal
 FROM assigned a JOIN headers h ON h.section IS NOT DISTINCT FROM a.section AND h.group_key=a.group_key AND h.page=a.page)
SELECT jsonb_build_object(
 'sheets',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'section',section,'ordinal',ordinal,
    'title',coalesce(initcap(replace(section,'_',' ')),'Unassigned section')||' / '||ordinal
     ||CASE WHEN group_pages>1 THEN ' (Part '||page||' of '||group_pages||')' ELSE '' END||' — '||group_title,
    'sort_key',coalesce(section,'~unassigned')||'/'||lpad(ordinal::text,10,'0'),'piece_count',piece_count)
    ORDER BY section NULLS LAST,ordinal) FROM headers),'[]'::jsonb),
 'members',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY sheet_id,ordinal) FROM members m),'[]'::jsonb),
 'ends',coalesce((SELECT jsonb_agg(jsonb_build_object('sheet_id',m.sheet_id,'segment_id',m.segment_id,'side',a.x->>'side')
    ORDER BY m.sheet_id,m.ordinal,a.x->>'side') FROM members m
    JOIN jsonb_array_elements(coalesce(p_result->'segment_ends','[]'::jsonb)) a(x) ON a.x->>'segment_id'=m.segment_id::text),'[]'::jsonb));
$fn$;

CREATE OR REPLACE FUNCTION public.harness_manual_sheet(p_vehicle_id uuid,p_evaluation_id uuid,p_sheet_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public SET timezone='UTC' AS $fn$
WITH input AS MATERIALIZED(SELECT public.harness_model_inputs(p_vehicle_id) AS p),
receipt AS MATERIALIZED(SELECT public.harness_model_receipt_for_hash(p_vehicle_id,md5(p::text)) AS r FROM input),
sheet AS MATERIALIZED(SELECT h.* FROM public.harness_model_sheets h CROSS JOIN receipt
 WHERE h.evaluation_id=(r->>'id')::uuid AND h.evaluation_id=p_evaluation_id AND h.id=p_sheet_id),
members AS MATERIALIZED(SELECT m.* FROM public.harness_model_sheet_members m JOIN sheet h USING(evaluation_id) WHERE m.sheet_id=h.id),
ends AS MATERIALIZED(SELECT a.* FROM public.harness_model_segment_ends a JOIN members m USING(evaluation_id,segment_id)),
segments AS MATERIALIZED(SELECT x FROM input CROSS JOIN LATERAL jsonb_array_elements(p->'model'->'segments') a(x)
 WHERE (x->>'id')::uuid IN(SELECT segment_id FROM members)),
circuits AS MATERIALIZED(SELECT x FROM input CROSS JOIN LATERAL jsonb_array_elements(p->'model'->'circuits') a(x)
 WHERE x->>'id' IN(SELECT x->>'circuit_id' FROM segments)),
terms AS MATERIALIZED(SELECT x FROM input CROSS JOIN LATERAL jsonb_array_elements(p->'model'->'terminations') a(x)
 WHERE x->>'id' IN(SELECT x->>'from_termination_id' FROM segments UNION SELECT x->>'to_termination_id' FROM segments)),
nodes AS MATERIALIZED(SELECT n.* FROM public.harness_model_nodes n CROSS JOIN receipt
 WHERE n.evaluation_id=(r->>'id')::uuid AND n.id IN(SELECT node_id FROM ends)),
checks AS MATERIALIZED(SELECT c.* FROM public.harness_model_checks c CROSS JOIN receipt WHERE c.evaluation_id=(r->>'id')::uuid
 AND (c.segment_id IN(SELECT segment_id FROM members) OR c.termination_id::text IN(SELECT x->>'id' FROM terms)
 OR c.circuit_id::text IN(SELECT x->>'id' FROM circuits) OR (c.segment_id IS NULL AND c.termination_id IS NULL AND c.circuit_id IS NULL
  AND to_jsonb(c)->>'component_requirement_id' IS NULL))),
body AS(SELECT jsonb_build_object('contract_version',1,'vehicle_id',p_vehicle_id,
 'vehicle_label',(SELECT nullif(concat_ws(' ',v.year,v.make,v.model),'')
   FROM public.vehicles v WHERE v.id=p_vehicle_id AND p IS NOT NULL),
 'status',CASE WHEN p IS NULL THEN 'unavailable' WHEN r IS NULL THEN public.harness_model_pending_status(p_vehicle_id,md5(p::text))
  WHEN (r->>'id')::uuid<>p_evaluation_id THEN 'pending'
  WHEN NOT EXISTS(SELECT FROM sheet) THEN 'unavailable' ELSE 'current' END,
 'current',EXISTS(SELECT FROM sheet),'evaluation',r,'sheet',(SELECT (to_jsonb(h)-'evaluation_id') || jsonb_build_object(
  'previous_sheet',(SELECT jsonb_build_object('id',a.id,'title',a.title) FROM public.harness_model_sheets a
   WHERE a.evaluation_id=h.evaluation_id AND a.section IS NOT DISTINCT FROM h.section AND a.ordinal<h.ordinal
   ORDER BY a.ordinal DESC LIMIT 1),
  'next_sheet',(SELECT jsonb_build_object('id',a.id,'title',a.title) FROM public.harness_model_sheets a
   WHERE a.evaluation_id=h.evaluation_id AND a.section IS NOT DISTINCT FROM h.section AND a.ordinal>h.ordinal
   ORDER BY a.ordinal LIMIT 1)) FROM sheet h),
 'model',CASE WHEN EXISTS(SELECT FROM sheet) THEN jsonb_build_object(
  'contract_version',2,'vehicle_id',p_vehicle_id,'evaluation_id',r->>'id','evaluated_at',r->>'evaluated_at',
  'selection','decided_design','coverage','structural_v1','snapshot_kind','current_read_not_published_revision',
  'sheet_id',p_sheet_id,'sheet_scope','bounded_manual_sheet',
  'circuits',coalesce((SELECT jsonb_agg(x ORDER BY x->>'id') FROM circuits),'[]'::jsonb),
  'segments',coalesce((SELECT jsonb_agg(x ORDER BY x->>'id') FROM segments),'[]'::jsonb),
  'terminations',coalesce((SELECT jsonb_agg(x ORDER BY x->>'id') FROM terms),'[]'::jsonb),
  'endpoints',coalesce((SELECT jsonb_agg(x ORDER BY x->>'id') FROM jsonb_array_elements(p->'model'->'endpoints') a(x)
    WHERE x->>'id' IN(SELECT x->>'endpoint_id' FROM terms)),'[]'::jsonb),
  'nets',coalesce((SELECT jsonb_agg(x ORDER BY x->>'id') FROM jsonb_array_elements(p->'model'->'nets') a(x)
    WHERE x->>'id' IN(SELECT x->>'net_id' FROM segments)),'[]'::jsonb),
  'connector_matings',coalesce((SELECT jsonb_agg(x ORDER BY x::text) FROM
    (SELECT x FROM jsonb_array_elements(p->'model'->'connector_matings') a(x)
     WHERE x->>'from_endpoint_id' IN(SELECT x->>'endpoint_id' FROM terms)
       OR x->>'to_endpoint_id' IN(SELECT x->>'endpoint_id' FROM terms) ORDER BY x::text LIMIT 50) limited),'[]'::jsonb),
  'connector_matings_complete',(SELECT count(*)<=50 FROM jsonb_array_elements(p->'model'->'connector_matings') a(x)
    WHERE x->>'from_endpoint_id' IN(SELECT x->>'endpoint_id' FROM terms) OR x->>'to_endpoint_id' IN(SELECT x->>'endpoint_id' FROM terms)),
  'electrical_nodes',coalesce((SELECT jsonb_agg(to_jsonb(n)-'evaluation_id' ORDER BY n.id) FROM nodes n),'[]'::jsonb),
  'segment_ends',coalesce((SELECT jsonb_agg(to_jsonb(a)-'evaluation_id' ORDER BY a.segment_id,a.side) FROM ends a),'[]'::jsonb),
  'model_checks',coalesce((SELECT jsonb_agg(to_jsonb(c)-'evaluation_id' ORDER BY c.id) FROM checks c),'[]'::jsonb),
  'wire_requirements',coalesce((SELECT jsonb_agg(to_jsonb(q)-'evaluation_id' ORDER BY q.segment_id)
    FROM public.harness_model_wire_requirements q WHERE q.evaluation_id=p_evaluation_id AND q.segment_id IN(SELECT segment_id FROM members)),'[]'::jsonb),
  'rule_definitions',p->'rules',
  'attention_check_ids',coalesce((SELECT jsonb_agg(c.id ORDER BY CASE c.result WHEN 'fail' THEN 0 ELSE 1 END,d.attention_order,c.id)
    FROM checks c JOIN public.harness_model_rules d ON d.rule_key=c.rule_key AND d.version=c.rule_version WHERE c.result<>'pass'),'[]'::jsonb)
 ) END) AS payload FROM input CROSS JOIN receipt),
hashed AS(SELECT payload||jsonb_build_object('model',CASE WHEN payload->'model'<>'null'::jsonb
 THEN payload->'model'||jsonb_build_object('snapshot_hash',md5((payload->'model')::text)) ELSE NULL END) AS payload FROM body)
SELECT payload||jsonb_build_object('snapshot_hash',md5(payload::text),'read_at',statement_timestamp()) FROM hashed;
$fn$;

-- Bounded page form of the existing sheet reader. The three-argument drawing
-- form remains unchanged; five named arguments select this page contract.
CREATE OR REPLACE FUNCTION public.harness_manual_sheet(
 p_vehicle_id uuid,p_evaluation_id uuid,p_sheet_id uuid,p_after text,p_limit integer)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public SET timezone='UTC' AS $fn$
WITH input AS MATERIALIZED(SELECT CASE WHEN length(coalesce(p_after,''))<=512 THEN public.harness_model_inputs(p_vehicle_id) END AS p),
receipt AS MATERIALIZED(SELECT public.harness_model_receipt_for_hash(p_vehicle_id,md5(p::text)) AS r FROM input),
sheet AS MATERIALIZED(SELECT h.* FROM public.harness_model_sheets h CROSS JOIN receipt
 WHERE h.evaluation_id=(r->>'id')::uuid AND h.evaluation_id=p_evaluation_id AND h.id=p_sheet_id),
origins AS MATERIALIZED(
 SELECT a.segment_id,a.side,a.termination_id,a.node_id,a.evaluation_id,n.endpoint_id,n.net_id
 FROM public.harness_model_sheet_members m JOIN sheet h ON h.evaluation_id=m.evaluation_id AND h.id=m.sheet_id
 JOIN public.harness_model_segment_ends a ON a.evaluation_id=m.evaluation_id AND a.segment_id=m.segment_id
 JOIN public.harness_model_nodes n ON n.evaluation_id=a.evaluation_id AND n.id=a.node_id),
mates AS MATERIALIZED(SELECT x FROM input CROSS JOIN LATERAL jsonb_array_elements(p->'model'->'connector_matings') a(x)),
node_targets AS(
 SELECT o.segment_id AS origin_segment_id,o.side AS origin_side,o.termination_id AS origin_termination_id,o.node_id AS origin_node_id,
  a.segment_id,a.side,a.termination_id,a.node_id,h.sheet_id,'node'::text AS kind
 FROM origins o JOIN public.harness_model_segment_ends a ON a.evaluation_id=o.evaluation_id AND a.node_id=o.node_id
 JOIN public.harness_model_sheet_ends h ON h.evaluation_id=a.evaluation_id AND h.segment_id=a.segment_id AND h.side=a.side
 WHERE (a.segment_id,a.side)<>(o.segment_id,o.side)),
mate_targets AS(
 SELECT DISTINCT ON(o.segment_id,o.side,a.segment_id,a.side)
  o.segment_id AS origin_segment_id,o.side AS origin_side,o.termination_id AS origin_termination_id,o.node_id AS origin_node_id,
  a.segment_id,a.side,a.termination_id,a.node_id,h.sheet_id,'mate'::text AS kind
 FROM origins o JOIN mates m ON o.endpoint_id::text IN(m.x->>'from_endpoint_id',m.x->>'to_endpoint_id')
 JOIN public.harness_model_nodes n ON n.evaluation_id=o.evaluation_id AND n.net_id=o.net_id AND n.endpoint_id<>o.endpoint_id
  AND n.endpoint_id::text IN(m.x->>'from_endpoint_id',m.x->>'to_endpoint_id')
 JOIN public.harness_model_segment_ends a ON a.evaluation_id=n.evaluation_id AND a.node_id=n.id
 JOIN public.harness_model_sheet_ends h ON h.evaluation_id=a.evaluation_id AND h.segment_id=a.segment_id AND h.side=a.side
 ORDER BY o.segment_id,o.side,a.segment_id,a.side),
targets AS MATERIALIZED(
 SELECT a.*,a.origin_segment_id::text||'/'||a.origin_side||'/'||a.kind||'/'||a.segment_id::text||'/'||a.side AS sort_key
 FROM(SELECT * FROM node_targets UNION ALL SELECT * FROM mate_targets) a),
page AS MATERIALIZED(SELECT * FROM targets WHERE p_after IS NULL OR sort_key COLLATE "C">p_after COLLATE "C"
 ORDER BY sort_key COLLATE "C" LIMIT greatest(1,least(coalesce(p_limit,50),50))),
labels AS MATERIALIZED(
 SELECT a.*,sh.title AS sheet_title,c.circuit_code AS wire_code,e.code AS endpoint_code,t.cavity
 FROM page a JOIN public.harness_model_sheets sh ON sh.evaluation_id=p_evaluation_id AND sh.id=a.sheet_id
 JOIN public.wire_termination_specs t ON t.id=a.termination_id
 JOIN public.harness_endpoints e ON e.id=t.endpoint_id
 JOIN public.harness_segments s ON s.id=a.segment_id
 JOIN public.vehicle_custom_circuits c ON c.id=s.vehicle_custom_circuit_id),
health AS MATERIALIZED(SELECT CASE WHEN p IS NULL THEN 'unavailable'
 WHEN r IS NULL THEN public.harness_model_pending_status(p_vehicle_id,md5(p::text))
 WHEN (r->>'id')::uuid<>p_evaluation_id THEN 'pending'
 WHEN NOT EXISTS(SELECT FROM sheet) THEN 'unavailable'
 WHEN (SELECT count(*) FROM page)<>(SELECT count(*) FROM labels) THEN 'incomplete_visibility' ELSE 'current' END AS status
 FROM input CROSS JOIN receipt)
SELECT jsonb_build_object(
 'vehicle_id',p_vehicle_id,'evaluation_id',r->>'id','sheet_id',p_sheet_id,
 'status',status,
 'origin_scope','bounded_manual_sheet',
 'origins',CASE WHEN status<>'current' THEN '[]'::jsonb ELSE coalesce((SELECT jsonb_agg(jsonb_build_object('segment_id',o.segment_id,'side',o.side,
  'termination_id',o.termination_id,'node_id',o.node_id) ORDER BY o.segment_id,o.side) FROM origins o),'[]'::jsonb) END,
 'references',CASE WHEN status<>'current' THEN '[]'::jsonb ELSE coalesce((SELECT jsonb_agg(jsonb_build_object(
  'kind',a.kind,'relation',CASE WHEN a.kind='node' THEN 'same_evaluated_electrical_node' ELSE 'recorded_connector_mate_same_declared_net' END,
  'contact_mapping_qualified',false,
  'origin',jsonb_build_object('segment_id',a.origin_segment_id,'side',a.origin_side,'termination_id',a.origin_termination_id,'node_id',a.origin_node_id),
  'destination',jsonb_build_object('segment_id',a.segment_id,'side',a.side,'termination_id',a.termination_id,'node_id',a.node_id,
   'sheet_id',a.sheet_id,'sheet_title',a.sheet_title,'wire_code',a.wire_code,'endpoint_code',a.endpoint_code,'cavity',a.cavity),
  'sort_key',a.sort_key) ORDER BY a.sort_key COLLATE "C") FROM labels a),'[]'::jsonb) END,
 'next_after',CASE WHEN status='current' AND EXISTS(SELECT FROM targets t WHERE t.sort_key COLLATE "C">(SELECT max(sort_key COLLATE "C") FROM page))
  THEN (SELECT max(sort_key COLLATE "C") FROM page) END)
FROM input CROSS JOIN receipt CROSS JOIN health;
$fn$;
COMMENT ON FUNCTION public.harness_manual_sheet(uuid,uuid,uuid,text,integer) IS
 'Reference-page form of the canonical sheet reader: at most16 evaluated origins and50 total same-node or unqualified mate addresses, exact vehicle/evaluation/sheet, source/logic proof once per page. Follow every cursor and recheck the drawing before publishing a complete print packet. No inferred continuity, source rewrite or construction release.';
REVOKE ALL ON FUNCTION public.harness_manual_sheet(uuid,uuid,uuid,text,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.harness_manual_sheet(uuid,uuid,uuid,text,integer) TO anon,authenticated,service_role;

DO $patch$
DECLARE body text:=pg_get_functiondef('public.harness_model_logic_snapshot()'::regprocedure);
 anchor text:='''postgres_version'',current_setting(''server_version_num'')';
BEGIN
 IF (length(body)-length(replace(body,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'manual reference logic receipt anchor drifted'; END IF;
 EXECUTE replace(body,anchor,
  '''harness_manual_sheet(uuid,uuid,uuid,text,integer)'',pg_get_functiondef(''public.harness_manual_sheet(uuid,uuid,uuid,text,integer)''::regprocedure),'||E'\n  '||anchor);
END $patch$;

-- The RPC overload must be visible to the API with its exact five named arguments.
NOTIFY pgrst, 'reload schema';
COMMIT;

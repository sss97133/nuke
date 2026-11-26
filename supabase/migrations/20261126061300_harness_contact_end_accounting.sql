-- Source-consistency and completeness repairs in the existing evaluation owner.
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
-- Explicit projection prevents a future raw-reader metadata/prose extension from entering public evaluations.
allowed(k,keys) AS (VALUES
  ('circuits',ARRAY['id','code','name','section','system_category','from_endpoint_id','to_endpoint_id','design_status','gauge_awg','colour','wire_type','is_superseded','superseded_by']::text[]),
  ('segments',ARRAY['id','net_id','circuit_id','current_circuit_id','reference_fingerprint','from_termination_id','to_termination_id','wire_part_id','gauge_awg','colour','planned_length_ft','planned_length_method','measured_length_ft','measured_at','build_state','design_status','in_current_plan','expected_gauge_awg','expected_colour','expected_part_number','expected_part_id','physical_progress','needs_revision','circuit_code','circuit_gauge_awg','circuit_colour','wire_type','keyed_part_number','link_state','specification_state','blockers']::text[]),
  ('terminations',ARRAY['id','circuit_id','endpoint_id','cavity','cavity_layout_id','terminal_contact_catalog_id','terminal_contact_pn','pin_seal_catalog_id','pin_seal_pn','crimp_tool_catalog_id','crimp_tool_pn','connector_housing_catalog_id','connector_housing_pn','wedge_lock_catalog_id','wedge_lock_pn','is_superseded','superseded_by']::text[]),
  ('endpoints',ARRAY['id','code','name','type','node_kind','part_number','topology_node_id','design_status','is_superseded','superseded_by']::text[]),
  ('nets',ARRAY['id','code','signal_id','signal_link_state','signal_reference_fingerprint','function','nominal_current_a','peak_current_a','protection_pdm_channel_ids','protection_pdm_channel_id','protection_fuse_part_id','protection_setting_a','is_superseded','superseded_by']::text[]),
  ('connector_matings',ARRAY['from_endpoint_id','to_endpoint_id','relation']::text[]),
  ('unsegmented_end_records',ARRAY['id','circuit_id','endpoint_id','cavity','cavity_layout_id','endpoint_code','endpoint_name','endpoint_node_kind']::text[]),
  ('evidence_edges',ARRAY['id','observation_id','row_kind','row_id','field','relation']::text[])),
objects AS (
 SELECT a.k,coalesce(jsonb_agg(coalesce((SELECT jsonb_object_agg(j.key,j.value) FROM jsonb_each(x) j
    WHERE j.key=ANY(a.keys)),'{}'::jsonb) ORDER BY x->>'id',x::text) FILTER(WHERE x IS NOT NULL),'[]'::jsonb) AS items
 FROM raw CROSS JOIN allowed a LEFT JOIN LATERAL jsonb_array_elements(
  CASE a.k WHEN 'circuits' THEN coalesce((SELECT jsonb_agg(x) FROM c),'[]'::jsonb)
   WHEN 'segments' THEN coalesce((SELECT jsonb_agg(x) FROM s),'[]'::jsonb)
   WHEN 'terminations' THEN coalesce((SELECT jsonb_agg(x) FROM t),'[]'::jsonb)
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
   THEN 'provisional' ELSE 'held' END AS state FROM s)
SELECT jsonb_build_object(
 'nodes',coalesce((SELECT jsonb_agg(to_jsonb(n) ORDER BY n.id) FROM nodes n),'[]'::jsonb),
 'segment_ends',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.segment_id,a.side) FROM attachments a),'[]'::jsonb),
 'checks',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.rule_key,c.segment_id,c.termination_id,c.circuit_id) FROM checks c),'[]'::jsonb),
 'wire_requirements',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.segment_id) FROM requirements r),'[]'::jsonb));
$fn$;
-- Add bounded source-gap addresses to the existing three-argument drawing.
-- Keep exact total and truncation explicit; no synthetic piece or quantity.
DO $patch$
DECLARE body text:=pg_get_functiondef('public.harness_manual_sheet(uuid,uuid,uuid)'::regprocedure);
 anchor text:=$anchor$  'rule_definitions',p->'rules',$anchor$;
 replacement text:=$new$  'unsegmented_end_records',coalesce((SELECT jsonb_agg(x ORDER BY x->>'id') FROM (
   SELECT x FROM jsonb_array_elements(p->'model'->'unsegmented_end_records') u(x)
   WHERE x->>'circuit_id' IN(SELECT c.x->>'id' FROM circuits c) ORDER BY x->>'id' LIMIT 25) page),'[]'::jsonb),
  'unsegmented_end_count',(SELECT count(*) FROM jsonb_array_elements(p->'model'->'unsegmented_end_records') u(x)
   WHERE x->>'circuit_id' IN(SELECT c.x->>'id' FROM circuits c)),
  'unsegmented_end_records_complete',(SELECT count(*)<=25 FROM jsonb_array_elements(p->'model'->'unsegmented_end_records') u(x)
   WHERE x->>'circuit_id' IN(SELECT c.x->>'id' FROM circuits c)),
  'rule_definitions',p->'rules',$new$;
BEGIN
 IF (length(body)-length(replace(body,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'manual gap projection anchor drift'; END IF;
 EXECUTE replace(body,anchor,replacement);
END $patch$;
-- Keep old definitions/results immutable; changed predicates get new versions.
UPDATE public.harness_model_rules SET is_current=false,superseded_at=clock_timestamp()
 WHERE is_current AND rule_key IN('segment_links','termination_cavity_key','circuit_segments');
INSERT INTO public.harness_model_rules(rule_key,version,subject_kind,description,implementation,display_name,attention_action,attention_order) VALUES
 ('segment_links','3','segment','Both current typed ends belong to this physical piece circuit, and their recorded contact identities have no conflicting net or ambiguous key/label claims. These are source consistency checks, not physical continuity or manufacturer applicability.','public.harness_model_compute(jsonb)'::regprocedure,'End links and contact claims checked','Resolve the exact end links and competing contact or declared-net claims before using this connection.',20),
 ('termination_cavity_key','2','termination','A cavity key is recorded without conflicting declared nets or competing key/label claims on this endpoint. No alias is inferred, and manufacturer applicability, wire range and physical continuity remain separate.','public.harness_model_compute(jsonb)'::regprocedure,'Recorded cavity identity checked','Inspect competing case-sensitive cavity claims and admit a qualified mapping or source correction.',80),
 ('circuit_segments','2','circuit','At least one current selected physical piece exists and every current end record of this selected circuit is attached to a selected piece. Unaccounted ends hold material planning; they never imply a zero amount or an invented wire.','public.harness_model_compute(jsonb)'::regprocedure,'Physical pieces and end records accounted for','Resolve the exact unattached current end records before using the material or cut plan.',10);
NOTIFY pgrst,'reload schema';
COMMIT;

-- Database-owned structural harness evaluation, graph attachments and gross wire requirements.
-- Owner authorization 2026-11-25: DB-required recursive loop, including necessary schema/keys/edges/folds.
-- These are computed results over the existing design owners, never new observations or build events.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

CREATE TABLE public.harness_model_rules (
  rule_key text NOT NULL,
  version text NOT NULL,
  subject_kind text NOT NULL CHECK (subject_kind IN ('vehicle','circuit','segment','termination')),
  description text NOT NULL,
  display_name text NOT NULL CHECK (btrim(display_name)<>''),
  attention_action text NOT NULL CHECK (btrim(attention_action)<>''),
  attention_order integer NOT NULL CHECK (attention_order>0),
  implementation regprocedure NOT NULL,
  is_current boolean NOT NULL DEFAULT true,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  PRIMARY KEY (rule_key,version),
  UNIQUE (rule_key,version,subject_kind),
  CHECK (is_current = (superseded_at IS NULL))
);
CREATE UNIQUE INDEX harness_model_rules_current ON public.harness_model_rules(rule_key) WHERE is_current;
COMMENT ON TABLE public.harness_model_rules IS 'Grain: one version of a deterministic structural harness check and its native PostgreSQL implementation key. This catalog describes code checks, not engineering policy values or observations. Prior versions remain for their result rows.';

CREATE TABLE public.harness_model_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
  input_hash text NOT NULL CHECK (length(input_hash)=32),
  logic_key text NOT NULL CHECK (length(logic_key)=32),
  input_snapshot jsonb NOT NULL,
  logic_snapshot jsonb NOT NULL,
  coverage text NOT NULL DEFAULT 'structural_v1' CHECK (coverage='structural_v1'),
  evaluated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  node_count integer NOT NULL CHECK (node_count>=0),
  segment_end_count integer NOT NULL CHECK (segment_end_count>=0),
  check_count integer NOT NULL CHECK (check_count>=0),
  wire_requirement_count integer NOT NULL CHECK (wire_requirement_count>=0),
  UNIQUE (vehicle_id,input_hash,logic_key),
  UNIQUE (id,vehicle_id),
  CHECK (input_hash=md5(input_snapshot::text)),
  CHECK (logic_key=md5(logic_snapshot::text))
);
COMMENT ON TABLE public.harness_model_evaluations IS 'Grain: one immutable evaluation of one vehicle input snapshot under one logic fingerprint. input_snapshot is a private derived input receipt, not a new source owner. Structural consistency never constitutes engineering release, purchasing approval or a physical build event.';

CREATE TABLE public.harness_model_nodes (
  evaluation_id uuid NOT NULL REFERENCES public.harness_model_evaluations(id),
  id uuid NOT NULL,
  net_id uuid REFERENCES public.harness_nets(id),
  endpoint_id uuid NOT NULL REFERENCES public.harness_endpoints(id),
  cavity_layout_id uuid REFERENCES public.connector_cavity_layouts(id),
  source_segment_id uuid NOT NULL REFERENCES public.harness_segments(id),
  source_termination_id uuid NOT NULL REFERENCES public.wire_termination_specs(id),
  basis text NOT NULL CHECK (basis IN ('bus','keyed_cavity','recorded_cavity','isolated_end')),
  cavity_label text,
  PRIMARY KEY (evaluation_id,id)
);
COMMENT ON TABLE public.harness_model_nodes IS 'Grain: one computed electrical junction in an evaluation, from existing net and endpoint/cavity or bus keys. A recorded cavity is a source alias, not a newly verified library pin. An isolated end establishes no shared continuity. This is a result, not a physical contact inventory.';

CREATE TABLE public.harness_model_segment_ends (
  evaluation_id uuid NOT NULL REFERENCES public.harness_model_evaluations(id),
  segment_id uuid NOT NULL REFERENCES public.harness_segments(id),
  side text NOT NULL CHECK (side IN ('from','to')),
  termination_id uuid NOT NULL REFERENCES public.wire_termination_specs(id),
  node_id uuid NOT NULL,
  PRIMARY KEY (evaluation_id,segment_id,side),
  FOREIGN KEY (evaluation_id,node_id) REFERENCES public.harness_model_nodes(evaluation_id,id)
);
COMMENT ON TABLE public.harness_model_segment_ends IS 'Grain: one recorded physical segment end attached to one computed node in the same evaluation. Distinct segment and termination IDs survive a shared pin or bus. Connector mating never creates a segment.';

CREATE TABLE public.harness_model_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id uuid NOT NULL REFERENCES public.harness_model_evaluations(id),
  rule_key text NOT NULL,
  rule_version text NOT NULL,
  segment_id uuid REFERENCES public.harness_segments(id),
  termination_id uuid REFERENCES public.wire_termination_specs(id),
  circuit_id uuid REFERENCES public.vehicle_custom_circuits(id),
  subject_kind text GENERATED ALWAYS AS
    (CASE WHEN segment_id IS NOT NULL THEN 'segment' WHEN termination_id IS NOT NULL THEN 'termination'
      WHEN circuit_id IS NOT NULL THEN 'circuit' ELSE 'vehicle' END) STORED,
  result text NOT NULL CHECK (result IN ('pass','hold','fail')),
  CHECK (num_nonnulls(segment_id,termination_id,circuit_id)<=1),
  FOREIGN KEY (rule_key,rule_version,subject_kind) REFERENCES public.harness_model_rules(rule_key,version,subject_kind),
  UNIQUE NULLS NOT DISTINCT (evaluation_id,rule_key,rule_version,segment_id,termination_id,circuit_id)
);
COMMENT ON TABLE public.harness_model_checks IS 'Grain: one versioned deterministic rule result for one typed subject in one input-bound evaluation. pass means only the named structural predicate passed. No imported legacy verdict becomes a current engineering proof.';

CREATE TABLE public.harness_model_wire_requirements (
  evaluation_id uuid NOT NULL REFERENCES public.harness_model_evaluations(id),
  segment_id uuid NOT NULL REFERENCES public.harness_segments(id),
  catalog_part_id uuid REFERENCES public.catalog_parts(id),
  planned_quantity numeric CHECK (planned_quantity IS NULL OR planned_quantity>0),
  unit text CHECK (unit IS NULL OR unit='ft'),
  state text NOT NULL CHECK (state IN ('held','provisional')),
  PRIMARY KEY (evaluation_id,segment_id),
  CHECK (state<>'provisional' OR (catalog_part_id IS NOT NULL AND planned_quantity IS NOT NULL AND unit IS NOT NULL))
);
COMMENT ON TABLE public.harness_model_wire_requirements IS 'Grain: one gross planned wire-stock requirement for one physical segment in an evaluation. Route-plan allowances are already in the source plan; no second pad is added. Assembly cables with unknown stock classification remain held. These rows do not subtract stock, convert supplier packs, claim receipt/consumption or release an order.';

CREATE TABLE public.harness_model_state (
  vehicle_id uuid PRIMARY KEY REFERENCES public.vehicles(id),
  latest_evaluation_id uuid,
  source_epoch bigint NOT NULL DEFAULT 0 CHECK (source_epoch>=0),
  folded_epoch bigint CHECK (folded_epoch>=0),
  source_changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  checked_at timestamptz,
  last_error_code text,
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count>=0),
  retry_after timestamptz,
  last_attempt_input_hash text,
  last_attempt_logic_key text,
  FOREIGN KEY (latest_evaluation_id,vehicle_id) REFERENCES public.harness_model_evaluations(id,vehicle_id)
);
COMMENT ON TABLE public.harness_model_state IS 'Grain: one harness evaluation cursor per vehicle. Source triggers advance source_epoch; a successful fold records the epoch it answered. A later source change, logic change or fold error invalidates currentness. Existing model_fold machinery owns scheduling; this is not another work queue.';

-- Public readers use explicit vehicle visibility and retain source RLS. The complete input receipt is never public.
CREATE FUNCTION public.harness_model_visible(p_vehicle_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT EXISTS (SELECT FROM public.vehicles v WHERE v.id=p_vehicle_id AND v.deleted_at IS NULL
    AND (v.is_public IS TRUE OR (auth.uid() IS NOT NULL
      AND coalesce(auth.jwt()->>'is_anonymous','false')<>'true'
      AND (v.user_id=auth.uid() OR v.owner_id=auth.uid()))));
$$;

ALTER TABLE public.harness_model_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY harness_model_rules_read ON public.harness_model_rules FOR SELECT USING (true);
ALTER TABLE public.harness_model_evaluations ENABLE ROW LEVEL SECURITY;
CREATE POLICY harness_model_evaluations_read ON public.harness_model_evaluations FOR SELECT
 USING (public.harness_model_visible(vehicle_id));
ALTER TABLE public.harness_model_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY harness_model_state_read ON public.harness_model_state FOR SELECT
 USING (public.harness_model_visible(vehicle_id));
ALTER TABLE public.harness_model_nodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY harness_model_nodes_read ON public.harness_model_nodes FOR SELECT USING (
 EXISTS (SELECT FROM public.harness_model_evaluations r WHERE r.id=harness_model_nodes.evaluation_id)
 AND EXISTS (SELECT FROM public.harness_segments s WHERE s.id=harness_model_nodes.source_segment_id)
 AND EXISTS (SELECT FROM public.wire_termination_specs t WHERE t.id=harness_model_nodes.source_termination_id)
 AND EXISTS (SELECT FROM public.harness_endpoints e WHERE e.id=harness_model_nodes.endpoint_id)
 AND (net_id IS NULL OR EXISTS (SELECT FROM public.harness_nets n WHERE n.id=harness_model_nodes.net_id)));
ALTER TABLE public.harness_model_segment_ends ENABLE ROW LEVEL SECURITY;
CREATE POLICY harness_model_segment_ends_read ON public.harness_model_segment_ends FOR SELECT USING (
 EXISTS (SELECT FROM public.harness_model_nodes n WHERE n.evaluation_id=harness_model_segment_ends.evaluation_id AND n.id=harness_model_segment_ends.node_id)
 AND EXISTS (SELECT FROM public.harness_segments s WHERE s.id=harness_model_segment_ends.segment_id)
 AND EXISTS (SELECT FROM public.wire_termination_specs t WHERE t.id=harness_model_segment_ends.termination_id));
ALTER TABLE public.harness_model_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY harness_model_checks_read ON public.harness_model_checks FOR SELECT USING (
 EXISTS (SELECT FROM public.harness_model_evaluations r WHERE r.id=harness_model_checks.evaluation_id)
 AND (segment_id IS NULL OR EXISTS (SELECT FROM public.harness_segments s WHERE s.id=harness_model_checks.segment_id))
 AND (termination_id IS NULL OR EXISTS (SELECT FROM public.wire_termination_specs t WHERE t.id=harness_model_checks.termination_id))
 AND (circuit_id IS NULL OR EXISTS (SELECT FROM public.vehicle_custom_circuits c WHERE c.id=harness_model_checks.circuit_id)));
ALTER TABLE public.harness_model_wire_requirements ENABLE ROW LEVEL SECURITY;
CREATE POLICY harness_model_wire_requirements_read ON public.harness_model_wire_requirements FOR SELECT USING (
 EXISTS (SELECT FROM public.harness_model_evaluations r WHERE r.id=harness_model_wire_requirements.evaluation_id)
 AND EXISTS (SELECT FROM public.harness_segments s WHERE s.id=harness_model_wire_requirements.segment_id)
 AND (catalog_part_id IS NULL OR EXISTS (SELECT FROM public.catalog_parts p WHERE p.id=harness_model_wire_requirements.catalog_part_id)));

REVOKE ALL ON public.harness_model_rules,public.harness_model_evaluations,public.harness_model_nodes,
 public.harness_model_segment_ends,public.harness_model_checks,public.harness_model_wire_requirements,
 public.harness_model_state FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.harness_model_rules,public.harness_model_nodes,public.harness_model_segment_ends,
 public.harness_model_checks,public.harness_model_wire_requirements,public.harness_model_state TO anon,authenticated,service_role;
GRANT SELECT(id,vehicle_id,input_hash,logic_key,coverage,evaluated_at,node_count,segment_end_count,check_count,wire_requirement_count)
 ON public.harness_model_evaluations TO anon,authenticated;
GRANT SELECT ON public.harness_model_evaluations TO service_role;

CREATE FUNCTION public.harness_model_inputs(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public SET timezone='UTC' AS $fn$
WITH raw AS MATERIALIZED (SELECT CASE WHEN public.harness_model_visible(p_vehicle_id)
 THEN public.harness_schematic_model(p_vehicle_id) END AS g),
c AS MATERIALIZED (
 SELECT x FROM raw CROSS JOIN LATERAL jsonb_array_elements(g->'circuits') a(x)
 WHERE x->>'design_status'='decided' AND NOT coalesce((x->>'is_superseded')::boolean,false)),
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
  ('circuits',ARRAY['id','code','name','section','design_status','gauge_awg','colour','wire_type','is_superseded','superseded_by']::text[]),
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
COMMENT ON FUNCTION public.harness_model_inputs(uuid) IS 'One invoker-RLS read snapshot of the selected decided design, exact referenced catalog identities and current check definitions. Unknowns stay unknown. Prototype and contradicted segments remain in their source tables and are absent from this selection.';

CREATE FUNCTION public.harness_model_compute(p_input jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=public AS $fn$
WITH model AS (SELECT p_input->'model' AS g),
s AS MATERIALIZED (SELECT x FROM model CROSS JOIN LATERAL jsonb_array_elements(g->'segments') a(x)),
t AS MATERIALIZED (SELECT x FROM model CROSS JOIN LATERAL jsonb_array_elements(g->'terminations') a(x)),
e AS MATERIALIZED (SELECT x FROM model CROSS JOIN LATERAL jsonb_array_elements(g->'endpoints') a(x)),
net_ids AS MATERIALIZED (SELECT x->>'id' AS id FROM model CROSS JOIN LATERAL jsonb_array_elements(g->'nets') a(x)),
part_ids AS MATERIALIZED (SELECT x->>'id' AS id FROM jsonb_array_elements(p_input->'catalog_parts') a(x)),
ends AS (
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
keyed AS MATERIALIZED (
 SELECT *,jsonb_build_array('harness_model_node_v1',p_input->'model'->>'vehicle_id',seg->>'net_id',endpoint->>'id',basis,
   CASE basis WHEN 'bus' THEN 'bus' WHEN 'keyed_cavity' THEN term->>'cavity_layout_id'
    WHEN 'recorded_cavity' THEN term->>'cavity' ELSE jsonb_build_array(seg->>'id',side,term->>'id')::text END)::text AS node_key FROM ends),
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
   WHEN 'segment_links' THEN CASE WHEN s.x->>'from_termination_id' IS NOT NULL
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
   WHEN 'termination_cavity_key' THEN CASE WHEN t.x->>'cavity_layout_id' IS NOT NULL THEN 'pass' ELSE 'hold' END
   WHEN 'terminal_catalog_key' THEN CASE WHEN t.x->>'terminal_contact_catalog_id' IN (SELECT id FROM part_ids) THEN 'pass' ELSE 'hold' END
   WHEN 'seal_catalog_key' THEN CASE WHEN t.x->>'pin_seal_catalog_id' IN (SELECT id FROM part_ids) THEN 'pass' ELSE 'hold' END
   WHEN 'tool_catalog_key' THEN CASE WHEN t.x->>'crimp_tool_catalog_id' IN (SELECT id FROM part_ids) THEN 'pass' ELSE 'hold' END
   ELSE 'hold' END
 FROM t CROSS JOIN rules r WHERE r.x->>'subject_kind'='termination'
 UNION ALL
 SELECT r.x->>'rule_key',r.x->>'version',NULL::uuid,NULL::uuid,(c.x->>'id')::uuid,
  CASE WHEN r.x->>'rule_key'='circuit_segments' AND EXISTS(SELECT FROM s WHERE s.x->>'circuit_id'=c.x->>'id') THEN 'pass' ELSE 'hold' END
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
   THEN 'provisional' ELSE 'held' END AS state FROM s)
SELECT jsonb_build_object(
 'nodes',coalesce((SELECT jsonb_agg(to_jsonb(n) ORDER BY n.id) FROM nodes n),'[]'::jsonb),
 'segment_ends',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.segment_id,a.side) FROM attachments a),'[]'::jsonb),
 'checks',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.rule_key,c.segment_id,c.termination_id,c.circuit_id) FROM checks c),'[]'::jsonb),
 'wire_requirements',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.segment_id) FROM requirements r),'[]'::jsonb));
$fn$;
COMMENT ON FUNCTION public.harness_model_compute(jsonb) IS 'Pure structural computation over one captured input. Electrical joins use stored current net plus endpoint/cavity or bus identities; isolated ends create no shared continuity. Gross wire plans use physical segments once with no extra allowance. Unimplemented or engineering checks hold. No source rows, as-built states, supplier units or stock are invented.';

INSERT INTO public.harness_model_rules(rule_key,version,subject_kind,description,implementation,display_name,attention_action,attention_order)
SELECT r.*,l.display_name,l.attention_action,l.attention_order FROM (VALUES
('circuit_segments','1','circuit','A selected decided circuit has at least one current decided physical segment; a missing physical piece is not a zero material requirement.','public.harness_model_compute(jsonb)'::regprocedure),
 ('segment_links','1','segment','Physical segment has both current typed end links in its source circuit.','public.harness_model_compute(jsonb)'::regprocedure),
 ('segment_specification','1','segment','Recorded segment, current circuit and exact keyed wire identity agree; this is structural agreement, not an engineering rating.','public.harness_model_compute(jsonb)'::regprocedure),
 ('wire_stock_key','1','segment','An exact known wire-stock catalog identity is present for this recorded specification.','public.harness_model_compute(jsonb)'::regprocedure),
 ('material_source_status','1','segment','No canonical material-source blocker is recorded; structural scope only.','public.harness_model_compute(jsonb)'::regprocedure),
 ('new_wire_demand','1','segment','No recorded physical progress or measurement allows this gross plan to be considered for new stock; allocation and ordering remain separate.','public.harness_model_compute(jsonb)'::regprocedure),
 ('planned_wire_amount','1','segment','Positive planned physical-piece amount has a recorded basis; it remains a prediction, not a cut measurement.','public.harness_model_compute(jsonb)'::regprocedure),
 ('termination_cavity_key','1','termination','The recorded end has a library cavity key; applicability/fit is not established by key presence alone.','public.harness_model_compute(jsonb)'::regprocedure),
 ('terminal_catalog_key','1','termination','The recorded end names a visible canonical terminal catalog identity; wire-range fit is a separate engineering check.','public.harness_model_compute(jsonb)'::regprocedure),
 ('seal_catalog_key','1','termination','The recorded seal has a canonical catalog identity. Missing identification or applicability remains unknown.','public.harness_model_compute(jsonb)'::regprocedure),
 ('tool_catalog_key','1','termination','The recorded tool has a canonical catalog identity; qualification for the terminal remains separate.','public.harness_model_compute(jsonb)'::regprocedure),
 ('engineering_coverage','1','vehicle','This evaluation covers structure only. Electrical sizing, protection, geometry, construction and procurement release still require their own input-bound rules.','public.harness_model_compute(jsonb)'::regprocedure)
) r(rule_key,version,subject_kind,description,implementation) JOIN (VALUES
 ('circuit_segments','Physical pieces identified','Identify the physical pieces for this circuit before calculating its material or cut list.',10),
 ('segment_links','Both piece ends identified','Identify both recorded ends and reconcile their circuit and connector assignments.',20),
 ('segment_specification','Piece and stock specifications agree','Resolve the piece, circuit and stock disagreement; preserve any cut or built material as its own physical revision.',30),
 ('wire_stock_key','Wire stock identified','Identify the exact wire stock and verify its gauge, insulation and colour against the design.',40),
 ('material_source_status','Current material records agree','Resolve the recorded material blockers and current source revision before using this requirement.',50),
 ('new_wire_demand','Existing physical work reconciled','Reconcile recorded cuts, measurements and stock allocation before adding wire to an order.',60),
 ('planned_wire_amount','Piece length plan identified','Record a route-based length plan and its basis; verify the actual cut length at the build stage.',70),
 ('termination_cavity_key','Connector cavity identified','Identify the connector cavity from its manufacturer drawing and resolve any ambiguous pin assignment.',80),
 ('terminal_catalog_key','Contact identified','Identify the contact stock part, then qualify wire range and connector fit separately.',90),
 ('seal_catalog_key','Seal applicability identified','Resolve whether this end requires a seal and identify the applicable stock part from the connector drawing.',100),
 ('tool_catalog_key','Crimp tool identified','Identify the tool stock or library entry, then qualify it for the selected contact separately.',110),
 ('engineering_coverage','Electrical and construction qualification incomplete','Complete the sizing, protection, route and contact-fit checks before final cutting or assembly; reconcile stock and supplier packs before ordering.',120)
) l(rule_key,display_name,attention_action,attention_order) USING(rule_key);

CREATE FUNCTION public.harness_model_logic_snapshot() RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT jsonb_build_object('functions',jsonb_build_object(
  'harness_schematic_model(uuid)',pg_get_functiondef('public.harness_schematic_model(uuid)'::regprocedure),
  -- Optional until the canonical workspace reader lands; its appearance or replacement invalidates prior receipts.
  'harness_segment_spec_status(uuid)',pg_get_functiondef(to_regprocedure('public.harness_segment_spec_status(uuid)')),
  'harness_model_inputs(uuid)',pg_get_functiondef('public.harness_model_inputs(uuid)'::regprocedure),
  'harness_model_compute(jsonb)',pg_get_functiondef('public.harness_model_compute(jsonb)'::regprocedure),
  'harness_model_fold(uuid)',pg_get_functiondef(to_regprocedure('public.harness_model_fold(uuid)')),
  'harness_model_scope_guard()',pg_get_functiondef(to_regprocedure('public.harness_model_scope_guard()')),
  'harness_evaluated_model(uuid)',pg_get_functiondef(to_regprocedure('public.harness_evaluated_model(uuid)')),
  'harness_model_logic_snapshot()',pg_get_functiondef(to_regprocedure('public.harness_model_logic_snapshot()')),
  'harness_model_logic_key()',pg_get_functiondef(to_regprocedure('public.harness_model_logic_key()'))),
  'postgres_version',current_setting('server_version_num'),
  'rules',coalesce((SELECT jsonb_agg(jsonb_build_object('key',r.rule_key,'version',r.version,'subject',r.subject_kind,
    'description',r.description,'display_name',r.display_name,'attention_action',r.attention_action,'attention_order',r.attention_order,
    'implementation',r.implementation::text) ORDER BY r.rule_key)
    FROM public.harness_model_rules r WHERE r.is_current),'[]'::jsonb));
$$;
CREATE FUNCTION public.harness_model_logic_key() RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT md5(public.harness_model_logic_snapshot()::text);
$$;
COMMENT ON FUNCTION public.harness_model_logic_key() IS 'Fingerprint of the closed structural computation: the source reader, input builder, pure compute body and active rule definitions. Replacing any of these invalidates prior structural results. Viewer eligibility is evaluated separately on every read.';

CREATE FUNCTION public.harness_model_scope_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE j jsonb:=to_jsonb(NEW); v uuid; k text; source_vehicle uuid; source_id uuid;
BEGIN
 SELECT r.vehicle_id INTO STRICT v FROM public.harness_model_evaluations r WHERE r.id=NEW.evaluation_id;
 FOREACH k IN ARRAY ARRAY['segment_id','source_segment_id','termination_id','source_termination_id','endpoint_id','net_id','circuit_id'] LOOP
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
 RETURN NEW;
END $$;
CREATE TRIGGER harness_model_nodes_scope BEFORE INSERT ON public.harness_model_nodes FOR EACH ROW EXECUTE FUNCTION public.harness_model_scope_guard();
CREATE TRIGGER harness_model_ends_scope BEFORE INSERT ON public.harness_model_segment_ends FOR EACH ROW EXECUTE FUNCTION public.harness_model_scope_guard();
CREATE TRIGGER harness_model_checks_scope BEFORE INSERT ON public.harness_model_checks FOR EACH ROW EXECUTE FUNCTION public.harness_model_scope_guard();
CREATE TRIGGER harness_model_requirements_scope BEFORE INSERT ON public.harness_model_wire_requirements FOR EACH ROW EXECUTE FUNCTION public.harness_model_scope_guard();

CREATE TRIGGER harness_model_evaluations_immutable BEFORE UPDATE OR DELETE ON public.harness_model_evaluations FOR EACH ROW EXECUTE FUNCTION public.vein_append_only();
CREATE TRIGGER harness_model_nodes_immutable BEFORE UPDATE OR DELETE ON public.harness_model_nodes FOR EACH ROW EXECUTE FUNCTION public.vein_append_only();
CREATE TRIGGER harness_model_ends_immutable BEFORE UPDATE OR DELETE ON public.harness_model_segment_ends FOR EACH ROW EXECUTE FUNCTION public.vein_append_only();
CREATE TRIGGER harness_model_checks_immutable BEFORE UPDATE OR DELETE ON public.harness_model_checks FOR EACH ROW EXECUTE FUNCTION public.vein_append_only();
CREATE TRIGGER harness_model_requirements_immutable BEFORE UPDATE OR DELETE ON public.harness_model_wire_requirements FOR EACH ROW EXECUTE FUNCTION public.vein_append_only();

CREATE FUNCTION public.harness_model_rule_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'harness check versions are retained'; END IF;
 IF to_jsonb(NEW)-ARRAY['is_current','superseded_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['is_current','superseded_at']
  OR NOT OLD.is_current OR NEW.is_current OR NEW.superseded_at IS NULL THEN
  RAISE EXCEPTION 'harness check definitions change by a new version';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER harness_model_rules_immutable BEFORE UPDATE OR DELETE ON public.harness_model_rules FOR EACH ROW EXECUTE FUNCTION public.harness_model_rule_guard();

CREATE FUNCTION public.harness_model_fold(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE st public.harness_model_state; inp jsonb; logic jsonb; result jsonb; h text; lk text; evaluation uuid;
  changed integer; reused boolean; cfg jsonb; max_attempts integer; failures integer; err text;
BEGIN
 -- This initial recurring scope is public harness designs. Visibility is rechecked by each consumer.
 IF NOT public.harness_model_in_scope(p_vehicle_id) THEN
  RETURN jsonb_build_object('status','not_in_scope');
 END IF;
 -- Never wait behind a source writer that may request a fold in its own transaction.
 IF NOT pg_try_advisory_xact_lock(hashtextextended('harness_model:'||p_vehicle_id::text,0)) THEN
  RETURN jsonb_build_object('status','busy');
 END IF;
 INSERT INTO public.harness_model_state(vehicle_id) VALUES(p_vehicle_id) ON CONFLICT DO NOTHING;
 SELECT s.* INTO STRICT st FROM public.harness_model_state s WHERE s.vehicle_id=p_vehicle_id;
 BEGIN
  cfg:=public.model_fold_config();
  max_attempts:=greatest(1,coalesce((cfg->>'max_attempts')::integer,1));
  logic:=public.harness_model_logic_snapshot();
  lk:=md5(logic::text);
  inp:=public.harness_model_inputs(p_vehicle_id);
  IF inp IS NULL THEN RAISE EXCEPTION 'harness input is unavailable' USING ERRCODE='22023'; END IF;
  h:=md5(inp::text);
  IF st.last_attempt_input_hash=h AND st.last_attempt_logic_key=lk
    AND (st.failure_count>=max_attempts OR st.retry_after>clock_timestamp()) THEN
   RETURN jsonb_build_object('status','backoff','error_code',st.last_error_code);
  END IF;
  -- Missing check contracts never silently remove a guard from a stock requirement.
  IF EXISTS (SELECT FROM (VALUES ('circuit_segments'),('segment_links'),('segment_specification'),('wire_stock_key'),('material_source_status'),('new_wire_demand'),('planned_wire_amount'),
     ('termination_cavity_key'),('terminal_catalog_key'),('seal_catalog_key'),('tool_catalog_key'),('engineering_coverage')) expected(k)
    WHERE NOT EXISTS (SELECT FROM public.harness_model_rules r WHERE r.is_current AND r.rule_key=expected.k
      AND r.implementation='public.harness_model_compute(jsonb)'::regprocedure)) THEN
   RAISE EXCEPTION 'harness check contract is incomplete' USING ERRCODE='22023';
  END IF;
  SELECT r.id INTO evaluation FROM public.harness_model_evaluations r
   WHERE r.vehicle_id=p_vehicle_id AND r.input_hash=h AND r.logic_key=lk;
  reused:=FOUND;
  IF NOT reused THEN
   result:=public.harness_model_compute(inp);
   INSERT INTO public.harness_model_evaluations(vehicle_id,input_hash,logic_key,input_snapshot,logic_snapshot,
      node_count,segment_end_count,check_count,wire_requirement_count)
    VALUES(p_vehicle_id,h,lk,inp,logic,jsonb_array_length(result->'nodes'),jsonb_array_length(result->'segment_ends'),
      jsonb_array_length(result->'checks'),jsonb_array_length(result->'wire_requirements')) RETURNING id INTO evaluation;
   INSERT INTO public.harness_model_nodes(evaluation_id,id,net_id,endpoint_id,cavity_layout_id,source_segment_id,source_termination_id,basis,cavity_label)
    SELECT evaluation,x.id,x.net_id,x.endpoint_id,x.cavity_layout_id,x.source_segment_id,x.source_termination_id,x.basis,x.cavity_label
    FROM jsonb_to_recordset(result->'nodes') x(id uuid,net_id uuid,endpoint_id uuid,cavity_layout_id uuid,
      source_segment_id uuid,source_termination_id uuid,basis text,cavity_label text);
   INSERT INTO public.harness_model_segment_ends(evaluation_id,segment_id,side,termination_id,node_id)
    SELECT evaluation,x.segment_id,x.side,x.termination_id,x.node_id
    FROM jsonb_to_recordset(result->'segment_ends') x(segment_id uuid,side text,termination_id uuid,node_id uuid);
   INSERT INTO public.harness_model_checks(evaluation_id,rule_key,rule_version,segment_id,termination_id,circuit_id,result)
    SELECT evaluation,x.rule_key,x.rule_version,x.segment_id,x.termination_id,x.circuit_id,x.result
    FROM jsonb_to_recordset(result->'checks') x(rule_key text,rule_version text,segment_id uuid,termination_id uuid,circuit_id uuid,result text);
   INSERT INTO public.harness_model_wire_requirements(evaluation_id,segment_id,catalog_part_id,planned_quantity,unit,state)
    SELECT evaluation,x.segment_id,x.catalog_part_id,x.planned_quantity,x.unit,x.state
    FROM jsonb_to_recordset(result->'wire_requirements') x(segment_id uuid,catalog_part_id uuid,planned_quantity numeric,unit text,state text);
  END IF;
  -- An intervening source commit or code change leaves this receipt historical, never current.
  UPDATE public.harness_model_state s SET latest_evaluation_id=evaluation,folded_epoch=st.source_epoch,
    checked_at=clock_timestamp(),last_error_code=NULL,failure_count=0,retry_after=NULL,
    last_attempt_input_hash=h,last_attempt_logic_key=lk
   WHERE s.vehicle_id=p_vehicle_id AND s.source_epoch=st.source_epoch AND public.harness_model_logic_key()=lk;
  GET DIAGNOSTICS changed=ROW_COUNT;
  RETURN jsonb_build_object('status',CASE WHEN changed=1 THEN 'current' ELSE 'source_changed' END,
    'evaluation_id',evaluation,'input_hash',h,'logic_key',lk,'reused',reused);
 EXCEPTION WHEN OTHERS OR query_canceled THEN
  -- The inner transaction rolls back all partial result rows. Only the bounded failure cursor survives.
  err:=SQLSTATE;
  failures:=CASE WHEN st.last_attempt_input_hash IS NOT DISTINCT FROM h AND st.last_attempt_logic_key IS NOT DISTINCT FROM lk
    THEN st.failure_count+1 ELSE 1 END;
  UPDATE public.harness_model_state s SET last_error_code=err,failure_count=failures,
    retry_after=clock_timestamp()+make_interval(secs=>least(greatest(1,coalesce((cfg->>'max_delay_seconds')::int,1)),
      greatest(1,coalesce((cfg->>'settle_seconds')::int,1))*power(2,least(failures,8)))::double precision),
    last_attempt_input_hash=h,last_attempt_logic_key=lk
   WHERE s.vehicle_id=p_vehicle_id AND s.source_epoch=st.source_epoch;
  RETURN jsonb_build_object('status','error','error',true,'error_code',err);
 END;
END $$;
COMMENT ON FUNCTION public.harness_model_fold(uuid) IS 'Atomic writer of one immutable structural evaluation and its typed nodes, end edges, checks and gross wire requirements. Publishes only for the captured source epoch and current code key. Unchanged inputs reuse a receipt. Errors roll back partial outputs, stay visible in the cursor and back off under existing model_fold configuration. Public-harness scope; no canonical source or as-built writes.';
REVOKE ALL ON FUNCTION public.harness_model_fold(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.harness_model_fold(uuid) TO service_role;

CREATE FUNCTION public.harness_evaluated_model(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public SET timezone='UTC' AS $fn$
WITH input AS MATERIALIZED (SELECT public.harness_model_inputs(p_vehicle_id) AS payload),
state AS MATERIALIZED (SELECT s.* FROM public.harness_model_state s WHERE s.vehicle_id=p_vehicle_id),
candidate AS MATERIALIZED (
 SELECT r.id,r.vehicle_id,r.input_hash,r.logic_key,r.coverage,r.evaluated_at,
  r.node_count,r.segment_end_count,r.check_count,r.wire_requirement_count
 FROM public.harness_model_evaluations r JOIN state s ON s.latest_evaluation_id=r.id
 CROSS JOIN input i
 WHERE s.source_epoch=s.folded_epoch AND s.last_error_code IS NULL
  AND r.input_hash=md5(i.payload::text) AND r.logic_key=public.harness_model_logic_key()),
nodes AS MATERIALIZED (SELECT n.* FROM public.harness_model_nodes n WHERE n.evaluation_id IN (SELECT id FROM candidate)),
ends AS MATERIALIZED (SELECT a.* FROM public.harness_model_segment_ends a WHERE a.evaluation_id IN (SELECT id FROM candidate)),
checks AS MATERIALIZED (SELECT c.* FROM public.harness_model_checks c WHERE c.evaluation_id IN (SELECT id FROM candidate)),
requirements AS MATERIALIZED (SELECT r.* FROM public.harness_model_wire_requirements r WHERE r.evaluation_id IN (SELECT id FROM candidate)),
complete AS MATERIALIZED (
 SELECT r.* FROM candidate r WHERE r.node_count=(SELECT count(*) FROM nodes)
  AND r.segment_end_count=(SELECT count(*) FROM ends) AND r.check_count=(SELECT count(*) FROM checks)
  AND r.wire_requirement_count=(SELECT count(*) FROM requirements)),
graph AS (
 SELECT (i.payload->'model') || jsonb_build_object(
   'evaluation_id',r.id,'input_hash',r.input_hash,'logic_key',r.logic_key,'evaluated_at',r.evaluated_at,'coverage',r.coverage,
   'rule_definitions',i.payload->'rules',
   'attention_check_ids',coalesce((SELECT jsonb_agg(c.id ORDER BY CASE c.result WHEN 'fail' THEN 0 ELSE 1 END,r.attention_order,c.id)
     FROM checks c JOIN public.harness_model_rules r ON r.rule_key=c.rule_key AND r.version=c.rule_version
     WHERE c.result<>'pass'),'[]'::jsonb),
   'electrical_nodes',coalesce((SELECT jsonb_agg(to_jsonb(n)-'evaluation_id' ORDER BY n.id) FROM nodes n),'[]'::jsonb),
   'segment_ends',coalesce((SELECT jsonb_agg(to_jsonb(a)-'evaluation_id' ORDER BY a.segment_id,a.side) FROM ends a),'[]'::jsonb),
   'model_checks',coalesce((SELECT jsonb_agg(to_jsonb(c)-'evaluation_id' ORDER BY c.id) FROM checks c),'[]'::jsonb),
   'wire_requirements',coalesce((SELECT jsonb_agg(to_jsonb(q)-'evaluation_id' ORDER BY q.segment_id) FROM requirements q),'[]'::jsonb)) AS payload
 FROM input i CROSS JOIN complete r)
SELECT CASE WHEN i.payload IS NULL THEN jsonb_build_object('status','unavailable','current',false,'model',NULL)
 ELSE jsonb_build_object('status',CASE WHEN EXISTS(SELECT FROM complete) THEN 'current'
    WHEN EXISTS(SELECT FROM candidate) THEN 'incomplete_visibility'
    WHEN EXISTS(SELECT FROM state WHERE last_error_code IS NOT NULL) THEN 'error' ELSE 'pending' END,
   'current',EXISTS(SELECT FROM complete),'coverage','structural_v1',
   'evaluation_id',(SELECT id FROM complete),'checked_at',(SELECT checked_at FROM state),
   'source_epoch',(SELECT source_epoch FROM state),'folded_epoch',(SELECT folded_epoch FROM state),
   'model',(SELECT payload || jsonb_build_object('snapshot_hash',md5(payload::text),'read_at',statement_timestamp()) FROM graph)) END
FROM input i;
$fn$;
COMMENT ON FUNCTION public.harness_evaluated_model(uuid) IS 'Invoker-RLS read of the database-selected decided harness and its persisted structural results. Returns a model only when source/code fingerprints, epoch and visible child counts all match. Cached private input/code receipts are never read by this public function. A current structural evaluation is not engineering or order release.';
REVOKE ALL ON FUNCTION public.harness_evaluated_model(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.harness_evaluated_model(uuid) TO anon,authenticated,service_role;

CREATE FUNCTION public.harness_model_in_scope(p_vehicle_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT EXISTS (SELECT FROM public.vehicles v JOIN public.harness_designs d ON d.vehicle_id=v.id
  WHERE v.id=p_vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL
   AND v.id::text NOT LIKE '9cf5b7a4%');
$$;

CREATE FUNCTION public.harness_model_signal(p_vehicle_ids uuid[],p_reason text,p_immediate boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cfg jsonb:=public.model_fold_config(); ids uuid[]; at_ timestamptz;
BEGIN
 SELECT array_agg(x ORDER BY x) INTO ids FROM (SELECT DISTINCT unnest(p_vehicle_ids) AS x) u
  WHERE x::text NOT LIKE '9cf5b7a4%' AND (public.harness_model_in_scope(x)
    OR EXISTS (SELECT FROM public.harness_model_state st WHERE st.vehicle_id=x));
 IF ids IS NULL THEN RETURN; END IF;
 INSERT INTO public.harness_model_state AS s(vehicle_id,source_epoch,source_changed_at)
  SELECT x,1,clock_timestamp() FROM unnest(ids) x
 ON CONFLICT(vehicle_id) DO UPDATE SET source_epoch=s.source_epoch+1,source_changed_at=clock_timestamp(),
  last_error_code=NULL,failure_count=0,retry_after=NULL;
 IF NOT coalesce((cfg->>'enabled')::boolean,false) OR NOT coalesce((cfg->>'signals_enabled')::boolean,false) THEN RETURN; END IF;
 at_:=clock_timestamp()-CASE WHEN p_immediate THEN make_interval(secs=>greatest(0,coalesce((cfg->>'settle_seconds')::int,0))) ELSE interval '0' END;
 -- Use the existing signal/work/tick machinery. No facet rows are locked by a harness source write.
 INSERT INTO public.model_fold_signal(vehicle_id,reason,priority,at)
 SELECT x,'harness:'||p_reason,2,at_ FROM unnest(ids) x
 WHERE public.harness_model_in_scope(x)
  AND NOT EXISTS (SELECT FROM public.model_fold_signal s WHERE s.vehicle_id=x);
END $$;
COMMENT ON FUNCTION public.harness_model_signal(uuid[],text,boolean) IS 'Advances the harness source epoch and deduplicates an event in the existing model_fold signal table. Retains invalidations for already enrolled private/deleted vehicles while queue admission stays in public execution scope. Honors global enable/signals controls and the excluded vehicle prefix. A source write fails if invalidation cannot be recorded; it never leaves an accepted source with a silently current old evaluation.';
REVOKE ALL ON FUNCTION public.harness_model_signal(uuid[],text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.harness_model_signal(uuid[],text,boolean) TO service_role;

CREATE FUNCTION public.harness_model_source_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a jsonb; b jsonb; ids uuid[];
BEGIN
 IF TG_OP='UPDATE' AND to_jsonb(NEW) IS NOT DISTINCT FROM to_jsonb(OLD) THEN RETURN NULL; END IF;
 IF TG_OP<>'DELETE' THEN a:=to_jsonb(NEW); END IF;
 IF TG_OP<>'INSERT' THEN b:=to_jsonb(OLD); END IF;
 IF TG_TABLE_NAME='vehicles' THEN
  -- Visibility changes only concern already enrolled harnesses; do not enroll the vehicle population.
  IF NOT EXISTS (SELECT FROM public.harness_model_state st WHERE st.vehicle_id=NEW.id) THEN RETURN NULL; END IF;
  ids:=ARRAY[NEW.id];
 ELSIF TG_TABLE_NAME='vehicle_custom_circuits' THEN
  SELECT array_agg(DISTINCT o.vehicle_id) INTO ids FROM public.vehicle_wiring_overlays o
   WHERE o.id IN ((a->>'overlay_id')::uuid,(b->>'overlay_id')::uuid);
 ELSIF TG_TABLE_NAME='vehicle_wiring_overlays' THEN
  ids:=ARRAY[(a->>'vehicle_id')::uuid,(b->>'vehicle_id')::uuid];
 ELSIF TG_TABLE_NAME='harness_endpoints' THEN
  SELECT array_agg(DISTINCT d.vehicle_id) INTO ids FROM public.harness_designs d
   WHERE d.id IN ((a->>'design_id')::uuid,(b->>'design_id')::uuid);
 ELSIF TG_TABLE_NAME='catalog_parts' THEN
  SELECT array_agg(DISTINCT v) INTO ids FROM (
   -- Canonical material status may resolve a missing or ambiguous MIL stock key after this insert/update.
   SELECT st.vehicle_id AS v FROM public.harness_model_state st
    WHERE coalesce(a->>'part_number','') ~ '^M22759/(16|32)-' OR coalesce(b->>'part_number','') ~ '^M22759/(16|32)-'
   UNION
   SELECT s.vehicle_id AS v FROM public.harness_segments s WHERE NOT s.is_superseded
    AND s.wire_part_id IN ((a->>'id')::uuid,(b->>'id')::uuid)
   UNION SELECT t.vehicle_id FROM public.wire_termination_specs t WHERE NOT coalesce(t.is_superseded,false)
    AND ((a->>'id')::uuid IN (t.terminal_contact_catalog_id,t.pin_seal_catalog_id,t.crimp_tool_catalog_id)
      OR (b->>'id')::uuid IN (t.terminal_contact_catalog_id,t.pin_seal_catalog_id,t.crimp_tool_catalog_id))) q;
 ELSIF TG_TABLE_NAME='harness_build_events' THEN
  ids:=ARRAY[(a->>'vehicle_id')::uuid,(b->>'vehicle_id')::uuid];
 ELSIF TG_TABLE_NAME='harness_model_rules' THEN
  SELECT array_agg(s.vehicle_id) INTO ids FROM public.harness_model_state s;
 ELSE
  ids:=ARRAY[(a->>'vehicle_id')::uuid,(b->>'vehicle_id')::uuid];
 END IF;
 PERFORM public.harness_model_signal(ids,TG_TABLE_NAME||':'||lower(TG_OP));
 RETURN NULL;
END $$;

CREATE FUNCTION public.harness_model_enqueue_changed() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cfg jsonb:=public.model_fold_config(); lk text; n integer;
BEGIN
 IF NOT coalesce((cfg->>'enabled')::boolean,false) OR NOT coalesce((cfg->>'signals_enabled')::boolean,false) THEN RETURN 0; END IF;
 lk:=public.harness_model_logic_key();
 INSERT INTO public.model_fold_signal(vehicle_id,reason,priority,at)
 SELECT s.vehicle_id,'harness:stale_or_logic',2,clock_timestamp()-make_interval(secs=>greatest(0,coalesce((cfg->>'settle_seconds')::int,0)))
 FROM public.harness_model_state s LEFT JOIN public.harness_model_evaluations r ON r.id=s.latest_evaluation_id
 WHERE public.harness_model_in_scope(s.vehicle_id)
  AND (s.latest_evaluation_id IS NULL OR s.source_epoch IS DISTINCT FROM s.folded_epoch OR r.logic_key IS DISTINCT FROM lk OR s.last_error_code IS NOT NULL)
  AND (s.last_attempt_logic_key IS DISTINCT FROM lk OR s.source_epoch IS DISTINCT FROM s.folded_epoch AND s.failure_count=0
    OR (s.failure_count<greatest(1,coalesce((cfg->>'max_attempts')::int,1)) AND coalesce(s.retry_after,'-infinity')<=clock_timestamp()))
  AND NOT EXISTS (SELECT FROM public.model_fold_signal q WHERE q.vehicle_id=s.vehicle_id)
  AND NOT EXISTS (SELECT FROM public.model_fold_work w WHERE w.vehicle_id=s.vehicle_id AND w.state IN ('pending','leased'))
 ORDER BY s.source_changed_at,s.vehicle_id LIMIT greatest(1,coalesce((cfg->>'max_vehicles')::int,1));
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN n;
END $$;
COMMENT ON FUNCTION public.harness_model_enqueue_changed() IS 'Admits stale harness cursors and code changes to the existing model_fold queue, bounded by its max_vehicles and retry/settle controls. A logic change can revive a failed interpretation; ordinary repeated failures back off and stop at max_attempts. No separate scheduler or network lane.';
REVOKE ALL ON FUNCTION public.harness_model_enqueue_changed() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.harness_model_enqueue_changed() TO service_role;

CREATE TRIGGER harness_model_visibility_changed AFTER UPDATE OF is_public,deleted_at ON public.vehicles FOR EACH ROW
 WHEN (OLD.is_public IS DISTINCT FROM NEW.is_public OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at) EXECUTE FUNCTION public.harness_model_source_changed();
CREATE TRIGGER harness_model_overlays_changed AFTER INSERT OR UPDATE OR DELETE ON public.vehicle_wiring_overlays FOR EACH ROW EXECUTE FUNCTION public.harness_model_source_changed();
CREATE TRIGGER harness_model_circuits_changed AFTER INSERT OR UPDATE OR DELETE ON public.vehicle_custom_circuits FOR EACH ROW EXECUTE FUNCTION public.harness_model_source_changed();
CREATE TRIGGER harness_model_endpoints_changed AFTER INSERT OR UPDATE OR DELETE ON public.harness_endpoints FOR EACH ROW EXECUTE FUNCTION public.harness_model_source_changed();
CREATE TRIGGER harness_model_terminations_changed AFTER INSERT OR UPDATE OR DELETE ON public.wire_termination_specs FOR EACH ROW EXECUTE FUNCTION public.harness_model_source_changed();
CREATE TRIGGER harness_model_segments_changed AFTER INSERT OR UPDATE OR DELETE ON public.harness_segments FOR EACH ROW EXECUTE FUNCTION public.harness_model_source_changed();
CREATE TRIGGER harness_model_build_events_changed AFTER INSERT OR UPDATE OR DELETE ON public.harness_build_events FOR EACH ROW EXECUTE FUNCTION public.harness_model_source_changed();
CREATE TRIGGER harness_model_signals_changed AFTER INSERT OR UPDATE OR DELETE ON public.harness_signals FOR EACH ROW EXECUTE FUNCTION public.harness_model_source_changed();
CREATE TRIGGER harness_model_nets_changed AFTER INSERT OR UPDATE OR DELETE ON public.harness_nets FOR EACH ROW EXECUTE FUNCTION public.harness_model_source_changed();
CREATE TRIGGER harness_model_evidence_changed AFTER INSERT OR UPDATE OR DELETE ON public.harness_evidence FOR EACH ROW EXECUTE FUNCTION public.harness_model_source_changed();
CREATE TRIGGER harness_model_designs_changed AFTER INSERT OR UPDATE OR DELETE ON public.harness_designs FOR EACH ROW EXECUTE FUNCTION public.harness_model_source_changed();
CREATE TRIGGER harness_model_catalog_inserted AFTER INSERT OR DELETE ON public.catalog_parts FOR EACH ROW EXECUTE FUNCTION public.harness_model_source_changed();
CREATE TRIGGER harness_model_catalog_changed AFTER UPDATE OF part_number ON public.catalog_parts FOR EACH ROW EXECUTE FUNCTION public.harness_model_source_changed();
CREATE TRIGGER harness_model_rules_changed AFTER INSERT OR UPDATE ON public.harness_model_rules FOR EACH ROW EXECUTE FUNCTION public.harness_model_source_changed();

-- The existing worker runs the domain fold; its failure cursor remains visible without aborting other vehicle folds.
DO $patch$
DECLARE d text; anchor text:=E'  -- labor_fold_v1_end\n';
BEGIN
 d:=pg_get_functiondef('public.model_fold_one(uuid,uuid,jsonb,uuid[])'::regprocedure);
 IF position('harness_model_loop_v1' IN d)>0 THEN RAISE EXCEPTION 'harness worker hook already exists'; END IF;
 IF (length(d)-length(replace(d,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'harness worker anchor is not unique'; END IF;
 d:=replace(d,anchor,anchor||E'  -- harness_model_loop_v1\n'
  ||E'  if public.harness_model_in_scope(p_vehicle) then\n    perform public.harness_model_fold(p_vehicle);\n  end if;\n'
  ||E'  -- harness_model_loop_v1_end\n');
 EXECUTE d;
END $patch$;
DO $patch$
DECLARE d text; anchor text:='  v_sig := public.model_fold_absorb_signals(';
BEGIN
 d:=pg_get_functiondef('public.model_fold_tick()'::regprocedure);
 IF position('harness_model_loop_v1' IN d)>0 THEN RAISE EXCEPTION 'harness tick hook already exists'; END IF;
 IF (length(d)-length(replace(d,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'harness tick anchor is not unique'; END IF;
 d:=replace(d,anchor,E'  -- harness_model_loop_v1: data and logic freshness share the existing queue and budget\n'
  ||E'  perform public.harness_model_enqueue_changed();\n  -- harness_model_loop_v1_end\n'||anchor);
 EXECUTE d;
END $patch$;

-- Scope bootstrap is the requested build. The real scheduled worker creates its first evaluation.
SELECT public.harness_model_signal(ARRAY['e08bf694-970f-4cbe-8a74-8715158a0f2e'::uuid],'initial_enrollment',true);

COMMENT ON COLUMN public.harness_model_rules.rule_key IS 'Stable named predicate identifier.';
COMMENT ON COLUMN public.harness_model_rules.version IS 'Retained implementation contract version for the named predicate.';
COMMENT ON COLUMN public.harness_model_rules.subject_kind IS 'Typed grain to which this rule applies.';
COMMENT ON COLUMN public.harness_model_rules.description IS 'Exact meaning and qualification limits of a passing result.';
COMMENT ON COLUMN public.harness_model_rules.display_name IS 'Builder-facing name of this retained predicate version; not a verdict.';
COMMENT ON COLUMN public.harness_model_rules.attention_action IS 'Plain next resolution step for a held or failed result; no unrecorded physical work or release is inferred.';
COMMENT ON COLUMN public.harness_model_rules.attention_order IS 'Resolution order within a result severity; current reader projects the ordered check IDs so clients do not invent build priorities.';
COMMENT ON COLUMN public.harness_model_rules.implementation IS 'Native PostgreSQL function identity that computes this predicate.';
COMMENT ON COLUMN public.harness_model_rules.is_current IS 'Whether this version participates in new evaluations.';
COMMENT ON COLUMN public.harness_model_rules.recorded_at IS 'Database clock when this definition was admitted.';
COMMENT ON COLUMN public.harness_model_rules.superseded_at IS 'Database retirement clock; prior results keep this version.';
COMMENT ON COLUMN public.harness_model_evaluations.id IS 'Immutable evaluation identity.';
COMMENT ON COLUMN public.harness_model_evaluations.vehicle_id IS 'Asset whose selected design was evaluated.';
COMMENT ON COLUMN public.harness_model_evaluations.input_hash IS 'MD5 content identity of the exact captured JSONB input receipt; not a security signature.';
COMMENT ON COLUMN public.harness_model_evaluations.logic_key IS 'MD5 content identity of the captured code and rule receipt; not engineering approval.';
COMMENT ON COLUMN public.harness_model_evaluations.input_snapshot IS 'Private immutable source input receipt; canonical testimony remains in its source owners.';
COMMENT ON COLUMN public.harness_model_evaluations.logic_snapshot IS 'Private immutable function bodies, engine version and active rule definitions used for replay.';
COMMENT ON COLUMN public.harness_model_evaluations.coverage IS 'Explicit limited rule coverage; structural_v1 never constitutes electrical sizing or order release.';
COMMENT ON COLUMN public.harness_model_evaluations.evaluated_at IS 'Database clock of evaluation admission.';
COMMENT ON COLUMN public.harness_model_evaluations.node_count IS 'Expected number of visible typed electrical node rows.';
COMMENT ON COLUMN public.harness_model_evaluations.segment_end_count IS 'Expected number of visible physical end attachment rows.';
COMMENT ON COLUMN public.harness_model_evaluations.check_count IS 'Expected number of visible rule result rows.';
COMMENT ON COLUMN public.harness_model_evaluations.wire_requirement_count IS 'Expected number of visible gross wire requirement rows.';
COMMENT ON COLUMN public.harness_model_nodes.evaluation_id IS 'Evaluation owning this computed node.';
COMMENT ON COLUMN public.harness_model_nodes.id IS 'Deterministic electrical junction identity within an evaluation.';
COMMENT ON COLUMN public.harness_model_nodes.net_id IS 'Existing current logical net, when available.';
COMMENT ON COLUMN public.harness_model_nodes.endpoint_id IS 'Canonical endpoint containing this electrical junction.';
COMMENT ON COLUMN public.harness_model_nodes.cavity_layout_id IS 'Existing library cavity identity when that establishes the junction.';
COMMENT ON COLUMN public.harness_model_nodes.source_segment_id IS 'Deterministic source segment witness for the node.';
COMMENT ON COLUMN public.harness_model_nodes.source_termination_id IS 'Deterministic recorded termination witness for the node.';
COMMENT ON COLUMN public.harness_model_nodes.basis IS 'Stored key basis for electrical continuity; isolated_end establishes no shared continuity.';
COMMENT ON COLUMN public.harness_model_nodes.cavity_label IS 'Recorded case-sensitive pin alias for display; never a verified pin assignment by itself.';
COMMENT ON COLUMN public.harness_model_segment_ends.evaluation_id IS 'Evaluation owning this physical end attachment.';
COMMENT ON COLUMN public.harness_model_segment_ends.segment_id IS 'Existing physical piece whose end is attached.';
COMMENT ON COLUMN public.harness_model_segment_ends.side IS 'Recorded from or to side of this physical piece.';
COMMENT ON COLUMN public.harness_model_segment_ends.termination_id IS 'Exact existing termination at this side; not a sorted or inferred endpoint.';
COMMENT ON COLUMN public.harness_model_segment_ends.node_id IS 'Computed junction in the same evaluation, enforced by composite foreign key.';
COMMENT ON COLUMN public.harness_model_checks.id IS 'Immutable individual predicate result identity.';
COMMENT ON COLUMN public.harness_model_checks.evaluation_id IS 'Input and code receipt to which this result is bound.';
COMMENT ON COLUMN public.harness_model_checks.rule_key IS 'Named predicate in the retained check catalog.';
COMMENT ON COLUMN public.harness_model_checks.rule_version IS 'Exact retained version of the predicate.';
COMMENT ON COLUMN public.harness_model_checks.segment_id IS 'Physical piece subject for a segment-grain predicate.';
COMMENT ON COLUMN public.harness_model_checks.termination_id IS 'Recorded end subject for a termination-grain predicate.';
COMMENT ON COLUMN public.harness_model_checks.circuit_id IS 'Logical circuit subject for a circuit-grain predicate.';
COMMENT ON COLUMN public.harness_model_checks.subject_kind IS 'Generated typed subject grain; null subject foreign keys mean vehicle.';
COMMENT ON COLUMN public.harness_model_checks.result IS 'pass is only the named structural predicate; hold is unresolved; fail is a demonstrated conflict.';
COMMENT ON COLUMN public.harness_model_wire_requirements.evaluation_id IS 'Evaluation owning this gross planned wire requirement.';
COMMENT ON COLUMN public.harness_model_wire_requirements.segment_id IS 'Existing physical piece counted once.';
COMMENT ON COLUMN public.harness_model_wire_requirements.catalog_part_id IS 'Existing exact stock catalog identity, if keyed.';
COMMENT ON COLUMN public.harness_model_wire_requirements.planned_quantity IS 'Positive gross physical-piece plan in feet when classified; not a measured cut or extra allowance.';
COMMENT ON COLUMN public.harness_model_wire_requirements.unit IS 'ft only when the stock classification is known; null remains unclassified.';
COMMENT ON COLUMN public.harness_model_wire_requirements.state IS 'provisional is structurally consistent gross planning only; held remains unresolved. Neither releases an order.';
COMMENT ON COLUMN public.harness_model_state.vehicle_id IS 'Asset enrolled in the existing fold loop.';
COMMENT ON COLUMN public.harness_model_state.latest_evaluation_id IS 'Latest published structural receipt for this asset.';
COMMENT ON COLUMN public.harness_model_state.source_epoch IS 'Monotonic invalidation generation advanced by admitted source changes.';
COMMENT ON COLUMN public.harness_model_state.folded_epoch IS 'Source generation answered by the latest published receipt.';
COMMENT ON COLUMN public.harness_model_state.source_changed_at IS 'Most recent database clock of source invalidation.';
COMMENT ON COLUMN public.harness_model_state.checked_at IS 'Most recent successful fold/currentness check clock.';
COMMENT ON COLUMN public.harness_model_state.last_error_code IS 'SQLSTATE of the latest failed fold; never raw private exception text.';
COMMENT ON COLUMN public.harness_model_state.failure_count IS 'Consecutive attempts for the same failed input and code identity.';
COMMENT ON COLUMN public.harness_model_state.retry_after IS 'Earliest ordinary retry under existing model_fold controls.';
COMMENT ON COLUMN public.harness_model_state.last_attempt_input_hash IS 'Captured input identity of the last attempted fold.';
COMMENT ON COLUMN public.harness_model_state.last_attempt_logic_key IS 'Captured logic identity of the last attempted fold.';

-- Public functions only read RLS-visible source/results. Only the existing trusted worker may produce results.
REVOKE ALL ON FUNCTION public.harness_model_visible(uuid),public.harness_model_inputs(uuid),public.harness_model_compute(jsonb),
 public.harness_model_logic_snapshot(),public.harness_model_logic_key(),public.harness_model_in_scope(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.harness_model_visible(uuid),public.harness_model_inputs(uuid),
 public.harness_model_logic_snapshot(),public.harness_model_logic_key() TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.harness_model_compute(jsonb),public.harness_model_in_scope(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.harness_model_scope_guard(),public.harness_model_rule_guard(),public.harness_model_source_changed() FROM PUBLIC,anon,authenticated,service_role;

COMMIT;

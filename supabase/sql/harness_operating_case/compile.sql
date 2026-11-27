-- Candidate implementation for schema proposal f8215459-ec38-4e2e-a855-509257740313.
-- Not an automatically deployed migration. Disposable PG17 contracts only.

BEGIN;
DO $candidate$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%'
  OR current_setting('server_version_num')::integer/10000<>17 THEN
  RAISE EXCEPTION 'Operating-case candidate requires a disposable PG17 contract database';
 END IF;
END $candidate$;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
CREATE OR REPLACE FUNCTION public.harness_operating_case_compile(p_revision uuid,p_evaluation uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE r public.harness_operating_case_revisions%ROWTYPE; c public.harness_operating_cases%ROWTYPE;
 w public.harness_operating_case_wires%ROWTYPE; e public.harness_operating_case_elements%ROWTYPE;
 inp jsonb; parent jsonb; seg jsonb; ref jsonb; wire_receipt jsonb; issue text;
 selected text[]:='{}'; circuits text[]:='{}'; terms text[]:='{}'; node_ids text[]:='{}'; covered text[]:='{}';
 wire_rows jsonb:='[]'; bindings jsonb:='[]'; branches jsonb:='[]'; issues jsonb:='[]'; source_rows jsonb:='[]';
 a record; ends_ jsonb; from_node uuid; to_node uuid; reference_node uuid; b record;
 term_node jsonb:='{}'; ft numeric; metres numeric; rho numeric; resistance numeric; exact_r numeric; field_ text;
 required_rule text; pass_required boolean; failed_rule text; required_checks jsonb; check_rows jsonb; check_count integer; definition_count integer;
 network jsonb; receipt jsonb; out_ jsonb; key_ text; state_ text; source_count integer;
BEGIN
 SELECT * INTO r FROM public.harness_operating_case_revisions WHERE id=p_revision AND sealed_at IS NOT NULL;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','unavailable','network',NULL,'issues','[]'::jsonb); END IF;
 SELECT * INTO c FROM public.harness_operating_cases WHERE id=r.case_id AND vehicle_id=r.vehicle_id;
 IF c.current_revision_id IS DISTINCT FROM r.id OR r.requested_state<>'enabled' THEN
  RETURN jsonb_build_object('status','held','network',NULL,'issues','[{"code":"case_revision_not_enabled_current"}]'::jsonb);
 END IF;
 inp:=public.harness_model_inputs(r.vehicle_id);
 parent:=public.harness_model_receipt_for_hash(r.vehicle_id,md5(inp::text));
 IF inp IS NULL OR parent IS NULL OR (parent->>'id')::uuid IS DISTINCT FROM p_evaluation THEN
  RETURN jsonb_build_object('status','held','network',NULL,'issues','[{"code":"structural_dependency_not_current"}]'::jsonb);
 END IF;
 IF inp#>'{model,contract_version}' IS DISTINCT FROM '2'::jsonb
  OR inp#>>'{model,selection}' IS DISTINCT FROM 'decided_design'
  OR inp#>>'{model,vehicle_id}' IS DISTINCT FROM r.vehicle_id::text
  OR jsonb_typeof(inp->'rules') IS DISTINCT FROM 'array'
  OR EXISTS(SELECT FROM unnest(ARRAY['segments','terminations','unsegmented_end_records']) k
   WHERE jsonb_typeof(inp->'model'->k) IS DISTINCT FROM 'array') THEN
  RETURN jsonb_build_object('status','held','network',NULL,'issues','[{"code":"structural_input_contract_unqualified"}]'::jsonb);
 END IF;
 IF md5(public.harness_operating_case_recipe(r.id)::text)<>r.recipe_hash THEN
  RETURN jsonb_build_object('status','held','network',NULL,'issues','[{"code":"recipe_closure_changed"}]'::jsonb);
 END IF;
 SELECT coalesce(array_agg(segment_id::text ORDER BY segment_id),'{}') INTO selected
  FROM public.harness_operating_case_wires WHERE revision_id=r.id;
 IF cardinality(selected) NOT BETWEEN 1 AND 8 THEN
  issues:=issues||'[{"code":"selected_scope_empty_or_unbounded"}]'::jsonb;
 END IF;
 FOR w IN SELECT * FROM public.harness_operating_case_wires WHERE revision_id=r.id ORDER BY segment_id LOOP
  seg:=NULL;ref:=NULL;rho:=NULL;resistance:=NULL;exact_r:=NULL;ft:=NULL;metres:=NULL;field_:=NULL;issue:=NULL;
  required_checks:='[]';failed_rule:=NULL;
  SELECT count(*),(jsonb_agg(s))->0 INTO source_count,seg
   FROM jsonb_array_elements(inp#>'{model,segments}') s WHERE s->>'id'=w.segment_id::text;
  IF source_count<>1 THEN issue:='selected_piece_not_in_current_source';
  ELSE
   circuits:=array_append(circuits,seg->>'circuit_id');source_rows:=source_rows||jsonb_build_array(seg);
  END IF;
  FOR required_rule IN SELECT k FROM unnest(ARRAY['segment_links','segment_plan_agreement','material_source_status','segment_specification','wire_stock_key']
   ||CASE WHEN seg ? 'wire_part_id' AND seg->>'wire_part_id' IS NULL THEN ARRAY['new_wire_demand'] ELSE '{}'::text[] END
   ||CASE WHEN w.resistance_basis='source_reference' AND w.length_basis='planned_gross' THEN ARRAY['planned_wire_amount'] ELSE '{}'::text[] END) k LOOP
   SELECT count(*) INTO definition_count FROM jsonb_array_elements(inp->'rules') definition WHERE definition->>'rule_key'=required_rule;
   SELECT count(*),coalesce(jsonb_agg(jsonb_build_object('check_id',h.id,'rule_key',h.rule_key,
    'rule_version',h.rule_version,'result',h.result) ORDER BY h.id),'[]') INTO check_count,check_rows
   FROM public.harness_model_checks h JOIN jsonb_array_elements(inp->'rules') definition
    ON definition->>'rule_key'=h.rule_key AND definition->>'version'=h.rule_version AND definition->>'subject_kind'='segment'
   WHERE h.evaluation_id=p_evaluation AND h.segment_id=w.segment_id AND h.rule_key=required_rule;
   pass_required:=NOT(required_rule IN('segment_specification','wire_stock_key') AND seg ? 'wire_part_id' AND seg->>'wire_part_id' IS NULL);
   required_checks:=required_checks||jsonb_build_array(jsonb_build_object('required_rule',required_rule,
    'requires_pass',pass_required,'definition_count',definition_count,'results',check_rows));
   IF definition_count<>1 OR check_count<>1 OR check_rows->0->>'result' IS NULL
    OR (pass_required AND check_rows->0->>'result'<>'pass')
    OR (NOT pass_required AND check_rows->0->>'result' NOT IN('pass','hold')) THEN
    issue:=coalesce(issue,'required_structural_check_unqualified');failed_rule:=coalesce(failed_rule,required_rule);
   END IF;
  END LOOP;
  IF (w.direct_resistance_ohm IS NOT NULL OR w.resistance_basis='source_reference')
   AND w.applicability_basis<>'conditional_assumption' THEN issue:=coalesce(issue,'authored_parameter_assumption_unresolved'); END IF;
  IF w.resistance_basis='direct_assumption' THEN resistance:=w.direct_resistance_ohm;
  ELSIF w.resistance_basis='source_reference' THEN
   ref:=public.wire_resistance_reference_evidence(w.resistance_claim_observation_id);
   IF ref IS NULL OR ref->>'observation_id' IS DISTINCT FROM w.resistance_claim_observation_id::text
    OR ref->>'unit' IS DISTINCT FROM 'ohm_per_m' OR jsonb_typeof(ref->'value') IS DISTINCT FROM 'number'
    OR ref#>>'{condition,value_role}' IS DISTINCT FROM 'maximum' THEN
    issue:=coalesce(issue,'selected_resistance_reference_unqualified');
   ELSIF w.applicability_basis<>'conditional_assumption' OR jsonb_typeof(seg->'gauge_awg') IS DISTINCT FROM 'number'
    OR seg->'gauge_awg' IS DISTINCT FROM ref#>'{condition,gauge_awg}' THEN
    issue:=coalesce(issue,'reference_gauge_or_assumption_unresolved');
   ELSE rho:=(ref->>'value')::numeric;
   END IF;
   IF w.length_basis='planned_gross' THEN
    field_:='planned_length_ft';
   ELSIF w.length_basis='measured' THEN
    field_:='measured_length_ft';
    IF seg->>'measured_at' IS NULL THEN issue:=coalesce(issue,'recorded_measurement_clock_absent'); END IF;
   ELSIF w.length_basis='design_override' THEN metres:=w.design_length_m;
   ELSE issue:=coalesce(issue,'selected_length_basis_unresolved'); END IF;
   IF field_ IS NOT NULL THEN
    IF jsonb_typeof(seg->field_)='number' THEN ft:=(seg->>field_)::numeric;metres:=ft*0.3048;
    ELSE issue:=coalesce(issue,'selected_length_absent'); END IF;
   END IF;
   IF metres IS NULL OR NOT metres BETWEEN 0.000000000001 AND 1000000000 THEN
    issue:=coalesce(issue,'selected_length_out_of_numeric_domain');
   ELSIF rho IS NULL OR NOT rho BETWEEN 0.000000000001 AND 1000000000000 THEN
    issue:=coalesce(issue,'reference_resistance_out_of_numeric_domain');
   ELSE
    exact_r:=metres*rho;
    -- Retain a maximum as an upper bound through the numeric solver domain.
    -- The raw exact product and rounding rule remain in the input receipt.
    resistance:=trim_scale(ceil(exact_r*1e24::numeric)*1e-24::numeric);
   END IF;
  END IF;
  IF w.wire_state='unknown' THEN issue:=coalesce(issue,'wire_state_unknown'); END IF;
  IF w.wire_state<>'open' AND resistance IS NULL THEN issue:=coalesce(issue,'wire_resistance_unresolved'); END IF;
  IF resistance IS NOT NULL AND NOT resistance BETWEEN 0.000000001 AND 1000000000000 THEN
   issue:=coalesce(issue,'derived_resistance_out_of_numeric_domain');
  END IF;
  wire_receipt:=jsonb_build_object('segment_id',w.segment_id,'wire_state',w.wire_state,'length_basis',w.length_basis,
   'selected_length_ft',ft,'selected_length_m',metres,'length_source_field',field_,'design_length_m',w.design_length_m,
   'length_conversion',CASE WHEN field_ IS NOT NULL THEN 'international_foot_0.3048_m_exact' END,
   'length_source_context',CASE WHEN field_='planned_length_ft' THEN seg->'planned_length_method'
    WHEN field_='measured_length_ft' THEN seg->'measured_at' END,
   'resistance_claim_observation_id',w.resistance_claim_observation_id,'reference',ref,
   'reference_ohm_per_m',rho,'exact_reference_product_ohm',exact_r,'derived_resistance_ohm',resistance,
   'resistance_normalization',CASE WHEN exact_r IS NOT NULL THEN 'maximum_upward_24_fractional_places_v1' END,
   'parameter_basis','conditional_assumption','required_structural_checks',required_checks,
   'applicability_state',CASE WHEN w.applicability_basis<>'conditional_assumption' THEN 'unresolved' WHEN w.resistance_basis='source_reference'
    THEN 'selected_source_class_assumed_not_manufacturer_or_installed_applicability' ELSE 'direct_analytical_assumption' END,
   'input_state',CASE WHEN issue IS NULL THEN 'ready' ELSE 'held' END,'issue',issue);
  wire_rows:=wire_rows||jsonb_build_array(wire_receipt);
  IF issue IS NOT NULL THEN issues:=issues||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('code',issue,'segment_id',w.segment_id,'parameter_key',failed_rule))); END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.side),'[]') INTO ends_
   FROM public.harness_model_segment_ends t WHERE evaluation_id=p_evaluation AND segment_id=w.segment_id;
  IF jsonb_array_length(ends_)<>2 OR ends_->0->>'side' IS DISTINCT FROM 'from' OR ends_->1->>'side' IS DISTINCT FROM 'to'
   OR ends_->0->'termination_id' IS DISTINCT FROM seg->'from_termination_id'
   OR ends_->1->'termination_id' IS DISTINCT FROM seg->'to_termination_id' THEN
   issues:=issues||jsonb_build_array(jsonb_build_object('code','selected_piece_attachment_unresolved','segment_id',w.segment_id));CONTINUE;
  END IF;
  FOR a IN SELECT * FROM jsonb_to_recordset(ends_) t(termination_id uuid,node_id uuid) LOOP
   IF a.termination_id::text=ANY(terms) THEN
    issues:=issues||jsonb_build_array(jsonb_build_object('code','physical_end_reused_by_pieces','termination_id',a.termination_id));
   END IF;
   terms:=array_append(terms,a.termination_id::text);term_node:=term_node||jsonb_build_object(a.termination_id::text,a.node_id);
   IF NOT a.node_id::text=ANY(node_ids) THEN node_ids:=array_append(node_ids,a.node_id::text); END IF;
  END LOOP;
  from_node:=(ends_->0->>'node_id')::uuid;to_node:=(ends_->1->>'node_id')::uuid;
  branches:=branches||jsonb_build_array(jsonb_build_object('id','wire/'||w.segment_id,'kind','switch',
   'from_node_id',from_node,'to_node_id',to_node,'state',w.wire_state)
   ||CASE WHEN resistance IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('resistance_ohm',resistance) END);
  bindings:=bindings||jsonb_build_array(jsonb_build_object('branch_id','wire/'||w.segment_id,'segment_id',w.segment_id,
   'from_node_id',from_node,'to_node_id',to_node,'from_termination_id',ends_->0->'termination_id','to_termination_id',ends_->1->'termination_id'));
 END LOOP;
 IF EXISTS(SELECT FROM jsonb_array_elements(inp#>'{model,unsegmented_end_records}') x WHERE x->>'circuit_id'=ANY(circuits)) THEN
  issues:=issues||'[{"code":"selected_circuit_source_end_accounting_unresolved"}]'::jsonb;
 END IF;
 IF cardinality(node_ids)>16 OR EXISTS(SELECT FROM unnest(node_ids) n WHERE NOT EXISTS(
  SELECT FROM public.harness_model_nodes x WHERE x.evaluation_id=p_evaluation AND x.id=n::uuid)) THEN
  issues:=issues||'[{"code":"scoped_node_dependency_invalid"}]'::jsonb;
 END IF;
 FOR e IN SELECT * FROM public.harness_operating_case_elements WHERE revision_id=r.id ORDER BY element_id LOOP
  IF NOT term_node ? e.from_termination_id::text OR NOT term_node ? e.to_termination_id::text THEN
   issues:=issues||jsonb_build_array(jsonb_build_object('code','device_terminal_not_in_selected_scope','element_id',e.element_id));CONTINUE;
  END IF;
  IF e.source_endpoint_id IS NOT NULL AND EXISTS(SELECT FROM unnest(ARRAY[e.from_termination_id,e.to_termination_id]) t
   WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(inp#>'{model,terminations}') x
    WHERE x->>'id'=t::text AND x->>'endpoint_id'=e.source_endpoint_id::text)) THEN
   issues:=issues||jsonb_build_array(jsonb_build_object('code','source_device_terminal_relationship_changed','element_id',e.element_id));CONTINUE;
  END IF;
  IF e.law_kind='unknown' THEN
   issues:=issues||jsonb_build_array(jsonb_build_object('code','device_behavior_unmodeled','element_id',e.element_id));CONTINUE;
  END IF;
  IF (e.law_kind='resistor' AND e.resistance_ohm IS NULL)
   OR (e.law_kind='switch' AND (e.contact_state='unknown' OR (e.contact_state='closed' AND e.resistance_ohm IS NULL)))
   OR (e.law_kind='voltage_source' AND e.voltage_v IS NULL) OR (e.law_kind='current_source' AND e.current_a IS NULL) THEN
   issues:=issues||jsonb_build_array(jsonb_build_object('code','device_parameter_unresolved','element_id',e.element_id));
  END IF;
  covered:=array_append(array_append(covered,e.from_termination_id::text),e.to_termination_id::text);
  branches:=branches||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('id','device/'||e.element_id,'kind',e.law_kind,
   'from_node_id',term_node->e.from_termination_id::text,'to_node_id',term_node->e.to_termination_id::text,
   'state',e.contact_state,'resistance_ohm',e.resistance_ohm,'voltage_v',e.voltage_v,'current_a',e.current_a)));
  bindings:=bindings||jsonb_build_array(jsonb_build_object('branch_id','device/'||e.element_id,'element_id',e.element_id,
   'from_node_id',term_node->e.from_termination_id::text,'to_node_id',term_node->e.to_termination_id::text,
   'from_termination_id',e.from_termination_id,'to_termination_id',e.to_termination_id));
 END LOOP;
 FOR b IN SELECT * FROM public.harness_operating_case_boundaries WHERE revision_id=r.id ORDER BY termination_id LOOP
  IF NOT term_node ? b.termination_id::text OR b.termination_id::text=ANY(covered) THEN
   issues:=issues||jsonb_build_array(jsonb_build_object('code','boundary_declaration_conflict','termination_id',b.termination_id));
  END IF;
  covered:=array_append(covered,b.termination_id::text);
 END LOOP;
 FOREACH key_ IN ARRAY terms LOOP
  IF NOT key_=ANY(covered) THEN
   issues:=issues||jsonb_build_array(jsonb_build_object('code','terminal_behavior_undeclared','termination_id',key_));
  END IF;
 END LOOP;
 IF r.reference_termination_id IS NULL OR NOT term_node ? r.reference_termination_id::text THEN
  issues:=issues||'[{"code":"reference_termination_unresolved"}]'::jsonb;
 ELSE reference_node:=(term_node->>r.reference_termination_id::text)::uuid; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(branches) x WHERE x->>'kind'='voltage_source')>16 THEN
  issues:=issues||'[{"code":"voltage_source_count_outside_solver_domain"}]'::jsonb;
 END IF;
 IF jsonb_array_length(issues)=0 THEN
  network:=jsonb_build_object('reference_node_id',reference_node,'nodes',
   (SELECT jsonb_agg(jsonb_build_object('id',n) ORDER BY n) FROM unnest(node_ids) n),'branches',branches);
 END IF;
 receipt:=jsonb_build_object('case_id',c.id,'revision_id',r.id,'scope_key',r.scope_key,'recipe_hash',r.recipe_hash,
  'private_generation',c.private_generation,'structural_evaluation_id',p_evaluation,'structural_input_hash',parent->'input_hash',
  'structural_prerequisite_policy','recorded_plan_with_separate_stock_holds_v1',
  'wire_inputs',wire_rows,'source_piece_inputs',source_rows,'network',network,'branch_bindings',bindings,'issues',issues);
 out_:=jsonb_build_object('status',CASE WHEN network IS NULL THEN 'held' ELSE 'ready' END,'network',network,
  'qualification','conditional_simulation_only','currentness','dependencies_checked_in_this_statement_only',
  'network_completeness','selected_piece_attachments_and_explicit_boundary_assumptions_only',
  'structural_checks','numerical_compilation_does_not_establish_engineering_release',
  'private_input_hash',md5(receipt::text),'input_receipt',receipt);
 RETURN out_;
END $$;
REVOKE ALL ON FUNCTION public.harness_operating_case_compile(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.harness_operating_case_compile(uuid,uuid) TO service_role;
COMMIT;

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
CREATE TABLE public.harness_model_dc_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 vehicle_id uuid NOT NULL,
 case_id uuid NOT NULL,
 revision_id uuid NOT NULL,
 scope_key text NOT NULL CHECK(scope_key ~ '^[0-9a-f]{32}$'),
 structural_evaluation_id uuid NOT NULL,
 private_generation bigint NOT NULL CHECK(private_generation>=0),
 private_input_hash text NOT NULL CHECK(private_input_hash ~ '^[0-9a-f]{32}$'),
 private_logic_key text NOT NULL CHECK(private_logic_key ~ '^[0-9a-f]{32}$'),
 input_receipt jsonb NOT NULL CHECK(jsonb_typeof(input_receipt)='object'),
 logic_receipt jsonb NOT NULL CHECK(jsonb_typeof(logic_receipt)='object'),
 status text NOT NULL CHECK(status IN('solved','held','indeterminate','inconsistent','numerical_failure')),
 qualification text NOT NULL CHECK(qualification='conditional_simulation_only'),
 expected_wire_input_count integer NOT NULL CHECK(expected_wire_input_count BETWEEN 0 AND 8),
 expected_node_count integer NOT NULL CHECK(expected_node_count BETWEEN 0 AND 16),
 expected_branch_count integer NOT NULL CHECK(expected_branch_count BETWEEN 0 AND 40),
 expected_issue_count integer NOT NULL CHECK(expected_issue_count BETWEEN 0 AND 256),
 sealed_at timestamptz,
 max_kcl_residual_a numeric CHECK(max_kcl_residual_a>=0 AND max_kcl_residual_a::text NOT IN('NaN','Infinity','-Infinity')),
 power_residual_w numeric CHECK(power_residual_w::text NOT IN('NaN','Infinity','-Infinity')),
 max_source_residual_v numeric CHECK(max_source_residual_v>=0 AND max_source_residual_v::text NOT IN('NaN','Infinity','-Infinity')),
 dependency_checked_at timestamptz NOT NULL,
 evaluated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(structural_evaluation_id,vehicle_id) REFERENCES public.harness_model_evaluations(id,vehicle_id),
 FOREIGN KEY(revision_id,case_id,vehicle_id) REFERENCES public.harness_operating_case_revisions(id,case_id,vehicle_id),
 UNIQUE(structural_evaluation_id,revision_id,scope_key,private_input_hash,private_logic_key),
 UNIQUE(id,case_id,vehicle_id),UNIQUE(id,revision_id),UNIQUE(id,structural_evaluation_id),
 UNIQUE(id,revision_id,structural_evaluation_id),
 CHECK(private_input_hash=md5(input_receipt::text)),CHECK(private_logic_key=md5(logic_receipt::text)),
 CHECK((status='solved' AND expected_issue_count=0 AND max_kcl_residual_a IS NOT NULL AND power_residual_w IS NOT NULL AND max_source_residual_v IS NOT NULL)
  OR (status<>'solved' AND expected_node_count=0 AND expected_branch_count=0 AND expected_issue_count>0
   AND max_kcl_residual_a IS NULL AND power_residual_w IS NULL AND max_source_residual_v IS NULL))
);
ALTER TABLE public.harness_operating_cases ADD FOREIGN KEY(latest_run_id,id,vehicle_id)
 REFERENCES public.harness_model_dc_runs(id,case_id,vehicle_id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX harness_model_dc_runs_case ON public.harness_model_dc_runs(case_id,evaluated_at DESC,id);
COMMENT ON TABLE public.harness_model_dc_runs IS 'One private closed conditional numerical interpretation of an exact recipe and structural dependency. Numerical status is separate from currentness, applicability and engineering release. No partial or late-appended results.';

CREATE TABLE public.harness_model_dc_wire_inputs (
 run_id uuid NOT NULL,
 revision_id uuid NOT NULL,
 segment_id uuid NOT NULL,
 length_basis text NOT NULL CHECK(length_basis IN('planned_gross','measured','design_override','unresolved','not_used')),
 selected_length_ft numeric,
 selected_length_m numeric,
 length_source_field text CHECK(length_source_field IN('planned_length_ft','measured_length_ft')),
 design_length_m numeric,
 resistance_claim_observation_id uuid REFERENCES public.wire_resistance_claims(observation_id),
 condition_key text REFERENCES public.wire_resistance_conditions(condition_key),
 reference_fingerprint text CHECK(reference_fingerprint ~ '^[0-9a-f]{32}$'),
 reference_ohm_per_m numeric,
 derived_resistance_ohm numeric,
 parameter_basis text NOT NULL CHECK(parameter_basis='conditional_assumption'),
 applicability_state text NOT NULL CHECK(applicability_state IN('unresolved','direct_analytical_assumption','selected_source_class_assumed_not_manufacturer_or_installed_applicability')),
 input_state text NOT NULL CHECK(input_state IN('ready','held')),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(run_id,segment_id),
 FOREIGN KEY(run_id,revision_id) REFERENCES public.harness_model_dc_runs(id,revision_id),
 FOREIGN KEY(revision_id,segment_id) REFERENCES public.harness_operating_case_wires(revision_id,segment_id),
 CHECK(resistance_claim_observation_id IS NOT NULL OR (condition_key IS NULL AND reference_fingerprint IS NULL AND reference_ohm_per_m IS NULL))
);
COMMENT ON TABLE public.harness_model_dc_wire_inputs IS 'One compiled private wire dependency receipt, not a copied authored source claim. Length basis and exact claim/condition keys survive alongside the derived resistance and unassessed applicability.';

CREATE TABLE public.harness_model_dc_node_results (
 run_id uuid NOT NULL,
 structural_evaluation_id uuid NOT NULL,
 node_id uuid NOT NULL,
 voltage_v numeric NOT NULL CHECK(voltage_v::text NOT IN('NaN','Infinity','-Infinity')),
 PRIMARY KEY(run_id,node_id),
 FOREIGN KEY(run_id,structural_evaluation_id) REFERENCES public.harness_model_dc_runs(id,structural_evaluation_id),
 FOREIGN KEY(structural_evaluation_id,node_id) REFERENCES public.harness_model_nodes(evaluation_id,id)
);
COMMENT ON TABLE public.harness_model_dc_node_results IS 'One signed voltage in volts at one exact structural node in one conditional run. Scope membership is checked against the compiled source network, not merely the same evaluation.';

CREATE TABLE public.harness_model_dc_branch_results (
 run_id uuid NOT NULL,
 revision_id uuid NOT NULL,
 structural_evaluation_id uuid NOT NULL,
 branch_id text NOT NULL,
 segment_id uuid,
 element_id uuid,
 from_node_id uuid NOT NULL,
 to_node_id uuid NOT NULL,
 state text NOT NULL CHECK(state IN('open','closed','fixed_model')),
 current_a numeric NOT NULL CHECK(current_a::text NOT IN('NaN','Infinity','-Infinity')),
 voltage_drop_v numeric NOT NULL CHECK(voltage_drop_v::text NOT IN('NaN','Infinity','-Infinity')),
 absorbed_power_w numeric NOT NULL CHECK(absorbed_power_w::text NOT IN('NaN','Infinity','-Infinity')),
 PRIMARY KEY(run_id,branch_id),CHECK(num_nonnulls(segment_id,element_id)=1),
 CHECK(branch_id=CASE WHEN segment_id IS NOT NULL THEN 'wire/'||segment_id ELSE 'device/'||element_id END),
 CHECK(state<>'open' OR (current_a=0 AND absorbed_power_w=0)),
 FOREIGN KEY(run_id,revision_id,structural_evaluation_id) REFERENCES public.harness_model_dc_runs(id,revision_id,structural_evaluation_id),
 FOREIGN KEY(revision_id,segment_id) REFERENCES public.harness_operating_case_wires(revision_id,segment_id),
 FOREIGN KEY(revision_id,element_id) REFERENCES public.harness_operating_case_elements(revision_id,element_id),
 FOREIGN KEY(run_id,from_node_id) REFERENCES public.harness_model_dc_node_results(run_id,node_id),
 FOREIGN KEY(run_id,to_node_id) REFERENCES public.harness_model_dc_node_results(run_id,node_id),
 FOREIGN KEY(structural_evaluation_id,from_node_id) REFERENCES public.harness_model_nodes(evaluation_id,id),
 FOREIGN KEY(structural_evaluation_id,to_node_id) REFERENCES public.harness_model_nodes(evaluation_id,id)
);
COMMENT ON TABLE public.harness_model_dc_branch_results IS 'One signed from-to current, voltage drop and absorbed power for an exact physical wire XOR explicit analytical element. Structural attachment and same-run node results must match the compiled binding.';

CREATE TABLE public.harness_model_dc_issues (
 run_id uuid NOT NULL,
 revision_id uuid NOT NULL,
 structural_evaluation_id uuid NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal>0),
 code text NOT NULL CHECK(code ~ '^[a-z][a-z0-9_]{0,99}$'),
 node_id uuid,
 segment_id uuid,
 termination_id uuid REFERENCES public.wire_termination_specs(id),
 element_id uuid,
 parameter_key text,
 PRIMARY KEY(run_id,ordinal),CHECK(num_nonnulls(node_id,segment_id,termination_id,element_id)<=1),
 FOREIGN KEY(run_id,revision_id,structural_evaluation_id) REFERENCES public.harness_model_dc_runs(id,revision_id,structural_evaluation_id),
 FOREIGN KEY(structural_evaluation_id,node_id) REFERENCES public.harness_model_nodes(evaluation_id,id),
 FOREIGN KEY(revision_id,segment_id) REFERENCES public.harness_operating_case_wires(revision_id,segment_id),
 FOREIGN KEY(revision_id,element_id) REFERENCES public.harness_operating_case_elements(revision_id,element_id)
);
COMMENT ON TABLE public.harness_model_dc_issues IS 'One typed conditional input or numerical failure reason. Floating-node arrays expand into one scoped node subject each; held runs have no numerical children. No raw private error text reaches shared telemetry.';

CREATE FUNCTION public.harness_operating_case_result_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE context_ text; frame_ text; r public.harness_model_dc_runs%ROWTYPE; binding jsonb; expected_wire jsonb;
BEGIN
 GET DIAGNOSTICS context_=PG_CONTEXT;
 frame_:=regexp_replace(regexp_replace(context_,E'[\\n\\r]+$',''),E'^.*\\n','','s');
 IF frame_ !~ '^PL/pgSQL function (public\.)?harness_operating_case_evaluate\(uuid,uuid\) line [0-9]+ at [^\n]+$'
  OR NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=to_regprocedure('public.harness_operating_case_evaluate(uuid,uuid)')
   AND p.prosecdef AND p.proowner=current_user::regrole) THEN
  RAISE EXCEPTION 'DC results require sanctioned evaluator' USING ERRCODE='42501';
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'DC history is append-only' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='harness_model_dc_runs' THEN
  IF TG_OP='INSERT' AND NEW.sealed_at IS NOT NULL THEN
   RAISE EXCEPTION 'DC run must be assembled before sealing' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND (OLD.sealed_at IS NOT NULL OR NEW.sealed_at IS NULL
   OR (to_jsonb(NEW)-'sealed_at') IS DISTINCT FROM (to_jsonb(OLD)-'sealed_at')) THEN
   RAISE EXCEPTION 'DC run permits only one seal' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT FROM public.harness_operating_case_revisions x WHERE x.id=NEW.revision_id
   AND x.case_id=NEW.case_id AND x.vehicle_id=NEW.vehicle_id AND x.scope_key=NEW.scope_key
   AND x.recipe_hash=NEW.input_receipt->>'recipe_hash' AND x.sealed_at IS NOT NULL)
   OR NEW.input_receipt->>'revision_id' IS DISTINCT FROM NEW.revision_id::text
   OR NEW.input_receipt->>'case_id' IS DISTINCT FROM NEW.case_id::text
   OR NEW.input_receipt->>'structural_evaluation_id' IS DISTINCT FROM NEW.structural_evaluation_id::text
   OR NEW.input_receipt->>'scope_key' IS DISTINCT FROM NEW.scope_key
   OR (NEW.input_receipt->>'private_generation')::bigint IS DISTINCT FROM NEW.private_generation THEN
   RAISE EXCEPTION 'DC run source binding mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO r FROM public.harness_model_dc_runs WHERE id=NEW.run_id FOR KEY SHARE;
 IF NOT FOUND OR r.sealed_at IS NOT NULL OR TG_OP<>'INSERT' THEN
  RAISE EXCEPTION 'DC children require matching unsealed run' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME='harness_model_dc_wire_inputs' THEN
  SELECT x INTO expected_wire FROM jsonb_array_elements(r.input_receipt->'wire_inputs') x WHERE x->>'segment_id'=NEW.segment_id::text;
  IF NEW.revision_id<>r.revision_id OR expected_wire IS NULL
   OR (to_jsonb(NEW)-ARRAY['run_id','revision_id','recorded_at','condition_key','reference_fingerprint']) IS DISTINCT FROM
    (SELECT jsonb_object_agg(k,expected_wire->k) FROM unnest(ARRAY['segment_id','length_basis','selected_length_ft','selected_length_m',
     'length_source_field','design_length_m','resistance_claim_observation_id','reference_ohm_per_m','derived_resistance_ohm',
     'parameter_basis','applicability_state','input_state']) k)
   OR NEW.reference_fingerprint IS DISTINCT FROM (CASE WHEN expected_wire->'reference'<>'null'::jsonb THEN md5((expected_wire->'reference')::text) END)
   OR (NEW.resistance_claim_observation_id IS NOT NULL AND NOT EXISTS(SELECT FROM public.wire_resistance_claims x
     WHERE x.observation_id=NEW.resistance_claim_observation_id AND x.condition_key=NEW.condition_key)) THEN
   RAISE EXCEPTION 'wire input outside exact run/claim condition' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='harness_model_dc_node_results' THEN
  IF r.status<>'solved' OR NEW.structural_evaluation_id<>r.structural_evaluation_id OR NOT EXISTS(
    SELECT FROM jsonb_array_elements(r.input_receipt#>'{network,nodes}') x WHERE x->>'id'=NEW.node_id::text) THEN
   RAISE EXCEPTION 'numerical node outside solved run scope' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='harness_model_dc_branch_results' THEN
  SELECT x INTO binding FROM jsonb_array_elements(r.input_receipt->'branch_bindings') x WHERE x->>'branch_id'=NEW.branch_id;
  IF r.status<>'solved' OR NEW.revision_id<>r.revision_id OR NEW.structural_evaluation_id<>r.structural_evaluation_id
   OR binding IS NULL OR binding->>'segment_id' IS DISTINCT FROM NEW.segment_id::text
   OR binding->>'element_id' IS DISTINCT FROM NEW.element_id::text
   OR binding->>'from_node_id' IS DISTINCT FROM NEW.from_node_id::text OR binding->>'to_node_id' IS DISTINCT FROM NEW.to_node_id::text THEN
   RAISE EXCEPTION 'branch does not match exact evaluated attachment' USING ERRCODE='23514';
  END IF;
 ELSE
  IF NEW.revision_id<>r.revision_id OR NEW.structural_evaluation_id<>r.structural_evaluation_id
   OR NEW.ordinal>r.expected_issue_count
   OR NOT r.logic_receipt->'issue_codes' ? NEW.code THEN
   RAISE EXCEPTION 'issue outside exact run/code vocabulary' USING ERRCODE='23514';
  END IF;
  IF NEW.node_id IS NOT NULL AND NOT EXISTS(SELECT FROM jsonb_array_elements(r.input_receipt#>'{network,nodes}') x
    WHERE x->>'id'=NEW.node_id::text) THEN RAISE EXCEPTION 'issue node outside compiled source scope' USING ERRCODE='23514'; END IF;
  IF NEW.termination_id IS NOT NULL AND NOT EXISTS(SELECT FROM jsonb_array_elements(r.input_receipt->'branch_bindings') x
    WHERE NEW.termination_id::text IN(x->>'from_termination_id',x->>'to_termination_id'))
   AND NOT EXISTS(SELECT FROM public.harness_operating_case_boundaries b WHERE b.revision_id=r.revision_id AND b.termination_id=NEW.termination_id)
   AND NOT EXISTS(SELECT FROM public.harness_operating_case_elements e WHERE e.revision_id=r.revision_id AND NEW.termination_id IN(e.from_termination_id,e.to_termination_id))
   AND NOT EXISTS(SELECT FROM public.harness_operating_case_revisions v WHERE v.id=r.revision_id AND v.reference_termination_id=NEW.termination_id) THEN
   RAISE EXCEPTION 'issue terminal outside compiled source scope' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.harness_operating_case_typed_issues(p_result jsonb,p_bindings jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE STRICT SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE item jsonb; subject jsonb; one_issue jsonb; node_ jsonb; answer jsonb:='[]';
BEGIN
 FOR item IN SELECT value FROM jsonb_array_elements(p_result->'issues') LOOP
  one_issue:=item-'branch_id'-'node_ids';
  IF item ? 'branch_id' THEN
   SELECT z INTO subject FROM jsonb_array_elements(p_bindings) z WHERE z->>'branch_id'=item->>'branch_id';
   IF subject IS NULL THEN RAISE EXCEPTION 'unbound solver branch issue' USING ERRCODE='23514'; END IF;
   one_issue:=one_issue||jsonb_strip_nulls(jsonb_build_object('segment_id',subject->'segment_id','element_id',subject->'element_id'));
  END IF;
  IF item ? 'node_ids' THEN
   FOR node_ IN SELECT value FROM jsonb_array_elements(item->'node_ids') ORDER BY value LOOP
    answer:=answer||jsonb_build_array(jsonb_strip_nulls(one_issue||jsonb_build_object('node_id',node_)));
   END LOOP;
  ELSE answer:=answer||jsonb_build_array(jsonb_strip_nulls(one_issue)); END IF;
 END LOOP;
 RETURN answer;
END $$;

CREATE FUNCTION public.harness_operating_case_run_closed() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE r public.harness_model_dc_runs%ROWTYPE; expected jsonb; expected_nodes jsonb; actual_nodes jsonb;
 expected_branches jsonb; actual_branches jsonb; expected_issues jsonb; actual_issues jsonb;
BEGIN
 SELECT * INTO r FROM public.harness_model_dc_runs WHERE id=NEW.id;
 IF r.sealed_at IS NULL THEN RAISE EXCEPTION 'DC run is unsealed' USING ERRCODE='23514'; END IF;
 -- The queued initial INSERT can now see the final seal. The one-way seal
 -- UPDATE performs the full validation once; an unsealed-only transaction
 -- still fails above at commit.
 IF NEW.sealed_at IS NULL THEN RETURN NULL; END IF;
 IF r.sealed_at IS NULL
  OR r.expected_wire_input_count<>(SELECT count(*) FROM public.harness_model_dc_wire_inputs WHERE run_id=r.id)
  OR r.expected_node_count<>(SELECT count(*) FROM public.harness_model_dc_node_results WHERE run_id=r.id)
  OR r.expected_branch_count<>(SELECT count(*) FROM public.harness_model_dc_branch_results WHERE run_id=r.id)
  OR r.expected_issue_count<>(SELECT count(*) FROM public.harness_model_dc_issues WHERE run_id=r.id)
  OR r.expected_wire_input_count<>jsonb_array_length(r.input_receipt->'wire_inputs')
  OR r.expected_wire_input_count<>(SELECT expected_wire_count FROM public.harness_operating_case_revisions WHERE id=r.revision_id)
  OR (r.status='solved' AND (r.expected_node_count<>jsonb_array_length(r.input_receipt#>'{network,nodes}')
    OR r.expected_branch_count<>jsonb_array_length(r.input_receipt#>'{network,branches}')
    OR r.expected_branch_count<>r.expected_wire_input_count+(SELECT expected_element_count FROM public.harness_operating_case_revisions WHERE id=r.revision_id))) THEN
  RAISE EXCEPTION 'DC run is unsealed or incomplete' USING ERRCODE='23514';
 END IF;
 IF r.input_receipt->'network' IS NULL OR r.input_receipt->'network'='null'::jsonb THEN
  expected:=jsonb_build_object('status','held','nodes','[]'::jsonb,'branches','[]'::jsonb,'issues',r.input_receipt->'issues');
 ELSE expected:=public.harness_model_dc_compute(r.input_receipt->'network'); END IF;
 SELECT coalesce(jsonb_agg(x ORDER BY x->>'id'),'[]') INTO expected_nodes FROM jsonb_array_elements(coalesce(expected->'nodes','[]')) x;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',node_id,'voltage_v',voltage_v) ORDER BY node_id),'[]') INTO actual_nodes
  FROM public.harness_model_dc_node_results WHERE run_id=r.id;
 SELECT coalesce(jsonb_agg(x-'kind' ORDER BY x->>'id'),'[]') INTO expected_branches FROM jsonb_array_elements(coalesce(expected->'branches','[]')) x;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',branch_id,'from_node_id',from_node_id,'to_node_id',to_node_id,
  'state',state,'current_a',current_a,'voltage_drop_v',voltage_drop_v,'absorbed_power_w',absorbed_power_w) ORDER BY branch_id),'[]')
  INTO actual_branches FROM public.harness_model_dc_branch_results WHERE run_id=r.id;
 expected_issues:=public.harness_operating_case_typed_issues(expected,r.input_receipt->'branch_bindings');
 SELECT coalesce(jsonb_agg(jsonb_strip_nulls(to_jsonb(i)-ARRAY['run_id','revision_id','structural_evaluation_id','ordinal']) ORDER BY ordinal),'[]')
  INTO actual_issues FROM public.harness_model_dc_issues i WHERE run_id=r.id;
 IF r.status IS DISTINCT FROM expected->>'status' OR actual_nodes IS DISTINCT FROM expected_nodes
  OR actual_branches IS DISTINCT FROM expected_branches OR actual_issues IS DISTINCT FROM expected_issues
  OR r.max_kcl_residual_a IS DISTINCT FROM (expected#>>'{residuals,max_node_current_imbalance_a}')::numeric
  OR r.power_residual_w IS DISTINCT FROM (expected#>>'{residuals,net_absorbed_power_w}')::numeric
  OR r.max_source_residual_v IS DISTINCT FROM (expected#>>'{residuals,max_voltage_source_error_v}')::numeric THEN
  RAISE EXCEPTION 'typed DC output differs from canonical computation' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;

-- Filled by the local builder from exact reviewed compiler + released solver
-- code literals. The local module remains inert until this implementation and
-- its closed vocabulary are reviewed together.
CREATE FUNCTION public.harness_operating_case_logic() RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('version','conditional_dc_private_run_v1','issue_codes','["authored_parameter_assumption_unresolved","binding_envelope_invalid","boundary_declaration_conflict","bounded_model_identity_invalid","bounded_model_size_invalid","branch_identity_or_node_invalid","case_revision_not_enabled_current","conditional_scenario_bound_exceeded","conditional_scenario_identity_invalid","conservation_or_source_residual_exceeded","contact_state_invalid","contact_state_unknown","dependent_ideal_source_currents","derived_resistance_out_of_numeric_domain","device_behavior_unmodeled","device_parameter_unresolved","device_terminal_binding_invalid","device_terminal_not_in_selected_scope","element_field_unsupported","element_kind_invalid","element_model_unsupported","evaluated_attachment_ambiguous","evaluated_attachment_invalid","evaluated_node_identity_invalid","inconsistent_ideal_source_constraints","no_conductive_reference_path","node_field_unsupported","node_identity_or_reference_invalid","node_key_invalid","number_outside_solver_domain","open_boundary_identity_invalid","open_contact_resistance_invalid","physical_end_reused_by_pieces","physical_end_reused_by_segments","piece_end_attachment_unresolved","pivot_below_numeric_resolution","recipe_closure_changed","recorded_measurement_clock_absent","reference_gauge_or_assumption_unresolved","reference_key_invalid","reference_resistance_out_of_numeric_domain","reference_termination_unresolved","required_structural_check_unqualified","resistance_outside_solver_domain","resistance_unknown","scenario_bound_exceeded","scenario_field_unsupported","scenario_object_required","scenario_shape_invalid","scoped_node_dependency_invalid","selected_circuit_source_end_accounting_unresolved","selected_length_absent","selected_length_basis_unresolved","selected_length_out_of_numeric_domain","selected_piece_attachment_unresolved","selected_piece_identity_invalid","selected_piece_not_in_current_source","selected_resistance_reference_unqualified","selected_scope_empty_or_unbounded","source_device_terminal_relationship_changed","source_end_coverage_unresolved","source_outside_solver_domain","source_value_unknown","structural_dependency_not_current","structural_input_contract_unqualified","terminal_behavior_undeclared","unresolved_numeric_rank","voltage_source_bound_exceeded","voltage_source_count_outside_solver_domain","wire_operating_parameters_missing","wire_parameter_identity_invalid","wire_resistance_unresolved","wire_state_unknown"]'::jsonb,
  'source_binding_functions',(SELECT coalesce(jsonb_object_agg(pg_get_function_identity_arguments(p.oid),md5(pg_get_functiondef(p.oid))),'{}')
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='wire_resistance_observation_binding'),
  'functions',(SELECT jsonb_object_agg(k,md5(pg_get_functiondef(to_regprocedure(k))) ORDER BY k) FROM unnest(ARRAY[
   'public.harness_operating_case_compile(uuid,uuid)','public.harness_operating_case_evaluate(uuid,uuid)',
   'public.harness_operating_case_logic()','public.harness_operating_case_result_guard()',
   'public.harness_operating_case_run_closed()','public.harness_model_dc_compute(jsonb)',
   'public.harness_operating_case_typed_issues(jsonb,jsonb)',
   'public.wire_resistance_reference_evidence(uuid)',
   'public.qualify_wire_resistance_reference(jsonb)','public.wire_resistance_condition_key(uuid,uuid,text,integer,numeric,text)']) k))
$$;

CREATE FUNCTION public.harness_operating_case_evaluate(p_case uuid,p_evaluation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='10s' SET lock_timeout='2s' AS $$
DECLARE c public.harness_operating_cases%ROWTYPE; compiled jsonb; result_ jsonb; logic_ jsonb; issues_ jsonb:='[]';
 run_ uuid; existing_ uuid; check_ jsonb;
 at_ timestamptz:=clock_timestamp();
BEGIN
 SET CONSTRAINTS public.operating_dc_run_closed DEFERRED;
 SELECT * INTO c FROM public.harness_operating_cases WHERE id=p_case;
 IF NOT FOUND OR c.current_revision_id IS NULL THEN RETURN jsonb_build_object('status','unavailable','run_id',NULL); END IF;
 logic_:=public.harness_operating_case_logic();
 compiled:=public.harness_operating_case_compile(c.current_revision_id,p_evaluation);
 IF compiled->'input_receipt' IS NULL THEN
  RETURN jsonb_build_object('status','dependency_pending','run_id',NULL,'dependency',compiled);
 END IF;
 SELECT id INTO existing_ FROM public.harness_model_dc_runs WHERE revision_id=c.current_revision_id
  AND structural_evaluation_id=p_evaluation AND scope_key=compiled#>>'{input_receipt,scope_key}'
  AND private_input_hash=compiled->>'private_input_hash' AND private_logic_key=md5(logic_::text) AND sealed_at IS NOT NULL;
 IF FOUND THEN RETURN jsonb_build_object('status','reused','run_id',existing_,'qualification','conditional_simulation_only'); END IF;
 IF compiled->>'status'='ready' THEN result_:=public.harness_model_dc_compute(compiled->'network');
 ELSE result_:=jsonb_build_object('status','held','nodes','[]'::jsonb,'branches','[]'::jsonb,'issues',compiled#>'{input_receipt,issues}'); END IF;
 IF result_->>'status' NOT IN('solved','held','indeterminate','inconsistent','numerical_failure') THEN
  RAISE EXCEPTION 'compiler/solver contract mismatch' USING ERRCODE='22023';
 END IF;
 IF logic_ IS DISTINCT FROM public.harness_operating_case_logic() THEN
  RAISE EXCEPTION 'DC logic changed during evaluation' USING ERRCODE='40001';
 END IF;
 issues_:=public.harness_operating_case_typed_issues(result_,compiled#>'{input_receipt,branch_bindings}');
 INSERT INTO public.harness_model_dc_runs(vehicle_id,case_id,revision_id,scope_key,structural_evaluation_id,
  private_generation,private_input_hash,private_logic_key,input_receipt,logic_receipt,status,qualification,
  expected_wire_input_count,expected_node_count,expected_branch_count,expected_issue_count,
  max_kcl_residual_a,power_residual_w,max_source_residual_v,dependency_checked_at)
 VALUES(c.vehicle_id,c.id,c.current_revision_id,compiled#>>'{input_receipt,scope_key}',p_evaluation,
  (compiled#>>'{input_receipt,private_generation}')::bigint,compiled->>'private_input_hash',md5(logic_::text),
  compiled->'input_receipt',logic_,result_->>'status','conditional_simulation_only',
  jsonb_array_length(compiled#>'{input_receipt,wire_inputs}'),coalesce(jsonb_array_length(result_->'nodes'),0),
  coalesce(jsonb_array_length(result_->'branches'),0),jsonb_array_length(issues_),
  (result_#>>'{residuals,max_node_current_imbalance_a}')::numeric,(result_#>>'{residuals,net_absorbed_power_w}')::numeric,
  (result_#>>'{residuals,max_voltage_source_error_v}')::numeric,at_)
 ON CONFLICT(structural_evaluation_id,revision_id,scope_key,private_input_hash,private_logic_key) DO NOTHING RETURNING id INTO run_;
 IF run_ IS NULL THEN
  SELECT id INTO run_ FROM public.harness_model_dc_runs WHERE revision_id=c.current_revision_id
   AND structural_evaluation_id=p_evaluation AND scope_key=compiled#>>'{input_receipt,scope_key}'
   AND private_input_hash=compiled->>'private_input_hash' AND private_logic_key=md5(logic_::text) AND sealed_at IS NOT NULL;
  IF run_ IS NULL THEN RAISE EXCEPTION 'concurrent DC run not closed' USING ERRCODE='40001'; END IF;
  RETURN jsonb_build_object('status','reused','run_id',run_,'qualification','conditional_simulation_only');
 END IF;
 INSERT INTO public.harness_model_dc_wire_inputs(run_id,revision_id,segment_id,length_basis,selected_length_ft,selected_length_m,
  length_source_field,design_length_m,resistance_claim_observation_id,condition_key,reference_fingerprint,reference_ohm_per_m,
  derived_resistance_ohm,parameter_basis,applicability_state,input_state)
 SELECT run_,c.current_revision_id,(x->>'segment_id')::uuid,x->>'length_basis',(x->>'selected_length_ft')::numeric,
  (x->>'selected_length_m')::numeric,x->>'length_source_field',(x->>'design_length_m')::numeric,
  (x->>'resistance_claim_observation_id')::uuid,q.condition_key,CASE WHEN x->'reference'<>'null'::jsonb THEN md5((x->'reference')::text) END,
  (x->>'reference_ohm_per_m')::numeric,(x->>'derived_resistance_ohm')::numeric,x->>'parameter_basis',x->>'applicability_state',x->>'input_state'
 FROM jsonb_array_elements(compiled#>'{input_receipt,wire_inputs}') x
 LEFT JOIN public.wire_resistance_claims q ON q.observation_id=(x->>'resistance_claim_observation_id')::uuid;
 INSERT INTO public.harness_model_dc_node_results(run_id,structural_evaluation_id,node_id,voltage_v)
 SELECT run_,p_evaluation,(x->>'id')::uuid,(x->>'voltage_v')::numeric FROM jsonb_array_elements(result_->'nodes') x;
 INSERT INTO public.harness_model_dc_branch_results(run_id,revision_id,structural_evaluation_id,branch_id,segment_id,element_id,
  from_node_id,to_node_id,state,current_a,voltage_drop_v,absorbed_power_w)
 SELECT run_,c.current_revision_id,p_evaluation,x->>'id',(b->>'segment_id')::uuid,(b->>'element_id')::uuid,
  (x->>'from_node_id')::uuid,(x->>'to_node_id')::uuid,x->>'state',(x->>'current_a')::numeric,
  (x->>'voltage_drop_v')::numeric,(x->>'absorbed_power_w')::numeric
 FROM jsonb_array_elements(result_->'branches') x JOIN jsonb_array_elements(compiled#>'{input_receipt,branch_bindings}') b ON b->>'branch_id'=x->>'id';
 INSERT INTO public.harness_model_dc_issues(run_id,revision_id,structural_evaluation_id,ordinal,code,node_id,segment_id,termination_id,element_id,parameter_key)
 SELECT run_,c.current_revision_id,p_evaluation,ordinality::int,x->>'code',(x->>'node_id')::uuid,(x->>'segment_id')::uuid,
  (x->>'termination_id')::uuid,(x->>'element_id')::uuid,x->>'parameter_key' FROM jsonb_array_elements(issues_) WITH ORDINALITY t(x,ordinality);
 UPDATE public.harness_model_dc_runs SET sealed_at=clock_timestamp() WHERE id=run_;
 SET CONSTRAINTS public.operating_dc_run_closed IMMEDIATE;
 -- A changed dependency keeps this immutable run as history. No case cursor is
 -- answered here; the future existing-worker integration owns that CAS/lease.
 check_:=public.harness_operating_case_compile(c.current_revision_id,p_evaluation);
 IF logic_ IS DISTINCT FROM public.harness_operating_case_logic() THEN
  RAISE EXCEPTION 'DC logic changed before closure' USING ERRCODE='40001';
 END IF;
 RETURN jsonb_build_object('status',result_->'status','run_id',run_,
  'dependencies_still_match',check_->>'private_input_hash' IS NOT DISTINCT FROM compiled->>'private_input_hash',
  'qualification','conditional_simulation_only');
END $$;

CREATE FUNCTION public.harness_operating_case_result(p_case uuid,p_evaluation uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE c public.harness_operating_cases%ROWTYPE; compiled jsonb; logic_ jsonb; r public.harness_model_dc_runs%ROWTYPE;
BEGIN
 SELECT * INTO c FROM public.harness_operating_cases WHERE id=p_case;
 IF NOT FOUND OR c.current_revision_id IS NULL THEN RETURN jsonb_build_object('status','unavailable','current',false,'run',NULL); END IF;
 compiled:=public.harness_operating_case_compile(c.current_revision_id,p_evaluation);
 IF compiled->'input_receipt' IS NULL THEN
  RETURN jsonb_build_object('status','dependency_pending','current',false,'run',NULL,'dependency',compiled);
 END IF;
 logic_:=public.harness_operating_case_logic();
 SELECT * INTO r FROM public.harness_model_dc_runs x WHERE x.revision_id=c.current_revision_id
  AND x.structural_evaluation_id=p_evaluation AND x.scope_key=compiled#>>'{input_receipt,scope_key}'
  AND x.private_input_hash=compiled->>'private_input_hash' AND x.private_logic_key=md5(logic_::text) AND x.sealed_at IS NOT NULL
  AND x.expected_wire_input_count=(SELECT count(*) FROM public.harness_model_dc_wire_inputs WHERE run_id=x.id)
  AND x.expected_node_count=(SELECT count(*) FROM public.harness_model_dc_node_results WHERE run_id=x.id)
  AND x.expected_branch_count=(SELECT count(*) FROM public.harness_model_dc_branch_results WHERE run_id=x.id)
  AND x.expected_issue_count=(SELECT count(*) FROM public.harness_model_dc_issues WHERE run_id=x.id);
 IF NOT FOUND THEN RETURN jsonb_build_object('status','pending','current',false,'run',NULL,
  'qualification','conditional_simulation_only','input_issues',compiled#>'{input_receipt,issues}'); END IF;
 RETURN jsonb_build_object('status',r.status,'current',true,'qualification','conditional_simulation_only',
  'currentness','same_statement_dependency_and_logic_checked','run',to_jsonb(r)-ARRAY['input_receipt','logic_receipt'],
  'wire_inputs',(SELECT coalesce(jsonb_agg(to_jsonb(w) ORDER BY w.segment_id),'[]') FROM public.harness_model_dc_wire_inputs w WHERE run_id=r.id),
  'nodes',(SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY n.node_id),'[]') FROM public.harness_model_dc_node_results n WHERE run_id=r.id),
  'branches',(SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.branch_id),'[]') FROM public.harness_model_dc_branch_results b WHERE run_id=r.id),
  'issues',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.ordinal),'[]') FROM public.harness_model_dc_issues i WHERE run_id=r.id));
END $$;

DO $$ DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['harness_model_dc_runs','harness_model_dc_wire_inputs','harness_model_dc_node_results',
  'harness_model_dc_branch_results','harness_model_dc_issues'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('GRANT SELECT ON public.%I TO service_role',t);
  EXECUTE format('CREATE TRIGGER result_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I
   FOR EACH ROW EXECUTE FUNCTION public.harness_operating_case_result_guard()',t);
  EXECUTE format('ALTER TABLE public.%I ENABLE ALWAYS TRIGGER result_guard',t);
 END LOOP;
END $$;
CREATE CONSTRAINT TRIGGER operating_dc_run_closed AFTER INSERT OR UPDATE ON public.harness_model_dc_runs
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.harness_operating_case_run_closed();
ALTER TABLE public.harness_model_dc_runs ENABLE ALWAYS TRIGGER operating_dc_run_closed;
REVOKE ALL ON FUNCTION public.harness_operating_case_logic(),public.harness_operating_case_evaluate(uuid,uuid),
 public.harness_operating_case_result(uuid,uuid),public.harness_operating_case_typed_issues(jsonb,jsonb),
 public.harness_operating_case_result_guard(),public.harness_operating_case_run_closed() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.harness_operating_case_logic(),public.harness_operating_case_evaluate(uuid,uuid),
 public.harness_operating_case_result(uuid,uuid),public.harness_operating_case_typed_issues(jsonb,jsonb) TO service_role;
COMMIT;

-- Install the reviewed conditional harness runtime from PR4059.
-- Manual build authorization is recorded by the implementing agent, following
-- 20261007014500_stack_registry.sql. No human review, app identity or Sign is made.
-- The current owner authorized this harness schema build on 2026-11-26.
-- All DDL, worker integration and proposal metadata commit or roll back together.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
DO $installation$
DECLARE p public.schema_proposals%ROWTYPE;
BEGIN
 SELECT * INTO p FROM public.schema_proposals
  WHERE id='f8215459-ec38-4e2e-a855-509257740313' FOR UPDATE;
 IF NOT FOUND OR p.proposal_type IS DISTINCT FROM 'add_table'
  OR p.proposed_by_agent_key IS DISTINCT FROM 'codex-wiring-operating-cases-20261126'
  OR p.proposed_by_user_id IS NOT NULL
  OR md5(p.payload::text) IS DISTINCT FROM '6f68c2a259fd485949afbdcdf64c39aa'
  OR md5(p.evidence::text) IS DISTINCT FROM '934f7065e684d8270cd9f0f6e77fc57e'
  OR md5(p.estimated_scope::text) IS DISTINCT FROM '79d12966546e97d04062aa090e2c53de'
  OR md5(p.backward_compatibility::text) IS DISTINCT FROM '9802b7b435bc9ec0d2c156839294c322'
  OR p.supersedes_proposal_id IS NOT NULL OR p.superseded_by IS NOT NULL
  OR p.promoted_to_id IS NOT NULL OR p.gate_measure IS NOT NULL
  OR p.motivating_observation_ids IS NOT NULL OR p.motivating_pending_claim_ids IS NOT NULL THEN
  RAISE EXCEPTION 'Operating runtime proposal identity or definition changed' USING ERRCODE='23514';
 END IF;
 IF p.status NOT IN('open','approved') OR EXISTS(
  SELECT FROM public.schema_proposal_reviews r WHERE r.proposal_id=p.id AND r.decision IS DISTINCT FROM 'approve')
  OR (p.status='open' AND (p.claimed_by_user_id IS NOT NULL OR p.claimed_at IS NOT NULL
   OR p.resolved_at IS NOT NULL OR p.decision_rationale IS NOT NULL
   OR EXISTS(SELECT FROM public.schema_proposal_reviews r WHERE r.proposal_id=p.id))) THEN
  RAISE EXCEPTION 'Operating runtime proposal has a separate review or decision' USING ERRCODE='55000';
 END IF;
 IF EXISTS(SELECT FROM pg_class c WHERE c.relnamespace='public'::regnamespace
  AND c.relname IN('harness_operating_cases','harness_operating_case_revisions','harness_operating_case_wires',
   'harness_operating_case_elements','harness_operating_case_boundaries','harness_model_dc_runs',
   'harness_model_dc_wire_inputs','harness_model_dc_node_results','harness_model_dc_branch_results','harness_model_dc_issues'))
  OR EXISTS(SELECT FROM pg_proc q WHERE q.pronamespace='public'::regnamespace AND q.proname LIKE 'harness_operating_case_%') THEN
  RAISE EXCEPTION 'Operating runtime already or partially installed; inspect before retrying' USING ERRCODE='55000';
 END IF;
 IF NOT EXISTS(SELECT FROM pg_proc q WHERE q.oid=to_regprocedure('public.model_fold_tick()')
  AND q.prokind='p' AND NOT q.prosecdef AND q.proowner='postgres'::regrole AND q.proconfig IS NULL
  AND has_function_privilege('service_role',q.oid,'EXECUTE')
  AND NOT has_function_privilege('anon',q.oid,'EXECUTE')
  AND NOT has_function_privilege('authenticated',q.oid,'EXECUTE')
  AND md5(q.prosrc)='876dc0513327e0bc5b66a03eb7d5ca70') THEN
  RAISE EXCEPTION 'Retained worker identity or definition changed; review the current owner' USING ERRCODE='23514';
 END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.harness_model_dc_compute(jsonb)'::regprocedure)
  IS DISTINCT FROM 'f4b9d69df0f59f5ba6d78f5f83a45920' THEN
  RAISE EXCEPTION 'Conditional DC kernel changed; review the current owner' USING ERRCODE='23514';
 END IF;
END $installation$;

-- Reviewed module: supabase/sql/harness_operating_case/recipe.sql
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';

CREATE TABLE public.harness_operating_cases (
 id uuid PRIMARY KEY,
 vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
 case_code text NOT NULL CHECK(case_code ~ '^[a-z][a-z0-9_.-]{0,79}$'),
 current_revision_id uuid,
 private_generation bigint NOT NULL DEFAULT 0 CHECK(private_generation>=0),
 answered_generation bigint CHECK(answered_generation>=0 AND answered_generation<=private_generation),
 latest_run_id uuid,
 attempt_revision_id uuid,
 attempt_structural_evaluation_id uuid,
 attempt_scope_key text,
 attempt_generation bigint,
 attempt_dependency_key text,
 attempt_logic_key text,
 attempt_tick_id uuid,
 attempted_at timestamptz,
 failure_count integer NOT NULL DEFAULT 0 CHECK(failure_count>=0),
 retry_after timestamptz,
 recorded_by_agent_key text NOT NULL CHECK(length(btrim(recorded_by_agent_key)) BETWEEN 1 AND 120),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 generation_changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(vehicle_id,case_code), UNIQUE(id,vehicle_id),
 FOREIGN KEY(attempt_structural_evaluation_id,vehicle_id)
  REFERENCES public.harness_model_evaluations(id,vehicle_id)
);
COMMENT ON TABLE public.harness_operating_cases IS
 'Private agent-authored conditional operating-case identity and cursor per vehicle. No ownership decision, engineering release, queue or independent lease. Run FKs are completed only in the unpublished result module.';

CREATE TABLE public.harness_operating_case_revisions (
 id uuid PRIMARY KEY,
 case_id uuid NOT NULL,
 vehicle_id uuid NOT NULL,
 revision_number integer NOT NULL CHECK(revision_number>0),
 prior_revision_id uuid,
 reference_termination_id uuid REFERENCES public.wire_termination_specs(id),
 recipe_hash text NOT NULL CHECK(recipe_hash ~ '^[0-9a-f]{32}$'),
 scope_key text NOT NULL CHECK(scope_key ~ '^[0-9a-f]{32}$'),
 requested_state text NOT NULL CHECK(requested_state IN('enabled','disabled','draft')),
 parameter_basis text NOT NULL CHECK(parameter_basis='conditional_assumption'),
 expected_wire_count integer NOT NULL CHECK(expected_wire_count BETWEEN 0 AND 8),
 expected_element_count integer NOT NULL CHECK(expected_element_count BETWEEN 0 AND 32),
 expected_boundary_count integer NOT NULL CHECK(expected_boundary_count BETWEEN 0 AND 16),
 recorded_by_agent_key text NOT NULL CHECK(length(btrim(recorded_by_agent_key)) BETWEEN 1 AND 120),
 method_version text NOT NULL CHECK(length(btrim(method_version)) BETWEEN 1 AND 120),
 authored_at timestamptz NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 sealed_at timestamptz,
 UNIQUE(case_id,revision_number), UNIQUE(id,case_id,vehicle_id),
 FOREIGN KEY(case_id,vehicle_id) REFERENCES public.harness_operating_cases(id,vehicle_id),
 FOREIGN KEY(prior_revision_id,case_id,vehicle_id)
  REFERENCES public.harness_operating_case_revisions(id,case_id,vehicle_id),
 CHECK(prior_revision_id IS DISTINCT FROM id)
);
ALTER TABLE public.harness_operating_cases
 ADD FOREIGN KEY(current_revision_id,id,vehicle_id)
  REFERENCES public.harness_operating_case_revisions(id,case_id,vehicle_id) DEFERRABLE INITIALLY DEFERRED,
 ADD FOREIGN KEY(attempt_revision_id,id,vehicle_id)
  REFERENCES public.harness_operating_case_revisions(id,case_id,vehicle_id);
COMMENT ON TABLE public.harness_operating_case_revisions IS
 'One complete immutable authored conditional recipe. Authored and recorded clocks are distinct. Sealed source children and exact counts commit atomically. Scope and recipe hashes are derived, never caller authority.';

CREATE TABLE public.harness_operating_case_wires (
 revision_id uuid NOT NULL,
 case_id uuid NOT NULL,
 vehicle_id uuid NOT NULL,
 segment_id uuid NOT NULL REFERENCES public.harness_segments(id),
 wire_state text NOT NULL CHECK(wire_state IN('open','closed','unknown')),
 resistance_basis text NOT NULL CHECK(resistance_basis IN('direct_assumption','source_reference','unresolved')),
 direct_resistance_ohm numeric CHECK(direct_resistance_ohm BETWEEN 0.000000001 AND 1000000000000
  AND scale(direct_resistance_ohm)<=24),
 resistance_claim_observation_id uuid REFERENCES public.wire_resistance_claims(observation_id),
 length_basis text NOT NULL CHECK(length_basis IN('planned_gross','measured','design_override','unresolved','not_used')),
 design_length_m numeric CHECK(design_length_m>0 AND design_length_m<='1000000000'::numeric
  AND scale(design_length_m)<=24),
 applicability_basis text NOT NULL CHECK(applicability_basis IN('conditional_assumption','unresolved')),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(revision_id,segment_id),
 FOREIGN KEY(revision_id,case_id,vehicle_id)
  REFERENCES public.harness_operating_case_revisions(id,case_id,vehicle_id),
 CHECK((resistance_basis='direct_assumption' AND resistance_claim_observation_id IS NULL
    AND length_basis='not_used' AND design_length_m IS NULL)
  OR (resistance_basis='source_reference' AND direct_resistance_ohm IS NULL AND length_basis<>'not_used')
  OR (resistance_basis='unresolved' AND direct_resistance_ohm IS NULL
    AND resistance_claim_observation_id IS NULL AND design_length_m IS NULL AND length_basis='unresolved')),
 CHECK((length_basis='design_override') OR design_length_m IS NULL)
);
COMMENT ON TABLE public.harness_operating_case_wires IS
 'One exact physical piece in a recipe, with explicit state and exclusive direct-assumption or exact source-claim resistance basis. Null quantities remain unresolved; planned gross length is never final cut or measured length.';

CREATE TABLE public.harness_operating_case_elements (
 revision_id uuid NOT NULL,
 element_id uuid NOT NULL,
 case_id uuid NOT NULL,
 vehicle_id uuid NOT NULL,
 element_code text NOT NULL CHECK(element_code ~ '^[a-z][a-z0-9_.-]{0,79}$'),
 source_endpoint_id uuid REFERENCES public.harness_endpoints(id),
 from_termination_id uuid NOT NULL REFERENCES public.wire_termination_specs(id),
 to_termination_id uuid NOT NULL REFERENCES public.wire_termination_specs(id),
 law_kind text NOT NULL CHECK(law_kind IN('resistor','switch','voltage_source','current_source','unknown')),
 contact_state text CHECK(contact_state IN('open','closed','unknown')),
 resistance_ohm numeric CHECK(resistance_ohm BETWEEN 0.000000001 AND 1000000000000 AND scale(resistance_ohm)<=24),
 voltage_v numeric CHECK(abs(voltage_v)<=1000000 AND scale(voltage_v)<=24),
 current_a numeric CHECK(abs(current_a)<=1000000 AND scale(current_a)<=24),
 parameter_basis text NOT NULL CHECK(parameter_basis='conditional_assumption'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(revision_id,element_id), UNIQUE(revision_id,element_code),
 FOREIGN KEY(revision_id,case_id,vehicle_id)
  REFERENCES public.harness_operating_case_revisions(id,case_id,vehicle_id),
 CHECK(from_termination_id<>to_termination_id),
 CHECK((law_kind='resistor' AND contact_state IS NULL AND voltage_v IS NULL AND current_a IS NULL)
  OR (law_kind='switch' AND contact_state IS NOT NULL AND voltage_v IS NULL AND current_a IS NULL)
  OR (law_kind='voltage_source' AND contact_state IS NULL AND resistance_ohm IS NULL AND current_a IS NULL)
  OR (law_kind='current_source' AND contact_state IS NULL AND resistance_ohm IS NULL AND voltage_v IS NULL)
  OR (law_kind='unknown' AND contact_state IS NULL AND resistance_ohm IS NULL AND voltage_v IS NULL AND current_a IS NULL))
);
COMMENT ON TABLE public.harness_operating_case_elements IS
 'One explicit analytical law between exact terminal ports. Element identity is not a physical stock instance. SI values are conditional assumptions; no endpoint-wide switch, inferred mating, ideal contact resistance or manufacturer behavior.';

CREATE TABLE public.harness_operating_case_boundaries (
 revision_id uuid NOT NULL,
 case_id uuid NOT NULL,
 vehicle_id uuid NOT NULL,
 termination_id uuid NOT NULL REFERENCES public.wire_termination_specs(id),
 boundary_kind text NOT NULL CHECK(boundary_kind='assumed_open'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(revision_id,termination_id),
 FOREIGN KEY(revision_id,case_id,vehicle_id)
  REFERENCES public.harness_operating_case_revisions(id,case_id,vehicle_id)
);
COMMENT ON TABLE public.harness_operating_case_boundaries IS
 'One explicit no-additional-device declaration for a selected physical end. It neither cuts the wire nor removes existing node continuity. No undeclared external network completeness claim.';

-- These helpers are not public APIs. Typed-row serialization supplies stable
-- hashes and excludes generated identities, knowledge clocks and renderer IDs.
CREATE FUNCTION public.harness_operating_case_recipe(p_revision uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('requested_state',r.requested_state,'parameter_basis',r.parameter_basis,
  'reference_termination_id',r.reference_termination_id,'recorded_by_agent_key',r.recorded_by_agent_key,
  'method_version',r.method_version,
  'wires',coalesce((SELECT jsonb_agg(to_jsonb(w)-ARRAY['revision_id','case_id','vehicle_id','recorded_at'] ORDER BY w.segment_id)
    FROM public.harness_operating_case_wires w WHERE w.revision_id=r.id),'[]'::jsonb),
  'elements',coalesce((SELECT jsonb_agg(to_jsonb(e)-ARRAY['revision_id','case_id','vehicle_id','recorded_at'] ORDER BY e.element_id)
    FROM public.harness_operating_case_elements e WHERE e.revision_id=r.id),'[]'::jsonb),
  'boundaries',coalesce((SELECT jsonb_agg(to_jsonb(b)-ARRAY['revision_id','case_id','vehicle_id','recorded_at'] ORDER BY b.termination_id)
    FROM public.harness_operating_case_boundaries b WHERE b.revision_id=r.id),'[]'::jsonb))
 FROM public.harness_operating_case_revisions r WHERE r.id=p_revision
$$;
CREATE FUNCTION public.harness_operating_case_scope(p_recipe jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('reference_termination_id',p_recipe->'reference_termination_id',
  'segments',coalesce((SELECT jsonb_agg(w->'segment_id' ORDER BY w->>'segment_id') FROM jsonb_array_elements(p_recipe->'wires') a(w)),'[]'::jsonb),
  'elements',coalesce((SELECT jsonb_agg(jsonb_build_object('element_id',e->'element_id',
     'from_termination_id',e->'from_termination_id','to_termination_id',e->'to_termination_id') ORDER BY e->>'element_id')
    FROM jsonb_array_elements(p_recipe->'elements') a(e)),'[]'::jsonb),
  'boundaries',coalesce((SELECT jsonb_agg(b->'termination_id' ORDER BY b->>'termination_id')
    FROM jsonb_array_elements(p_recipe->'boundaries') a(b)),'[]'::jsonb))
$$;

CREATE FUNCTION public.harness_operating_case_source_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE c text; writer_frame text; r public.harness_operating_case_revisions%ROWTYPE; v uuid; t uuid;
BEGIN
 GET DIAGNOSTICS c=PG_CONTEXT;
 -- The final frame must be the registered top-level writer. A comment in a
 -- DO block can contain a fake frame, but its genuine inline_code_block frame
 -- still follows that SQL text. Nested SQL/PLpgSQL wrappers are not this RPC.
 writer_frame:=regexp_replace(c,E'[\\n\\r]+$','');
 writer_frame:=regexp_replace(writer_frame,E'^.*\\n','','s');
 IF writer_frame !~ '^PL/pgSQL function (public\.)?harness_operating_case_record\(jsonb\) line [0-9]+ at [^\n]+$'
  OR NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=to_regprocedure('public.harness_operating_case_record(jsonb)')
    AND p.prosecdef AND p.proowner=current_user::regrole) THEN
  RAISE EXCEPTION 'operating-case source rows require sanctioned writer' USING ERRCODE='42501';
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'operating recipes are append-only' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='harness_operating_cases' THEN
  IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW.vehicle_id<>OLD.vehicle_id OR NEW.case_code<>OLD.case_code
   OR NEW.recorded_by_agent_key<>OLD.recorded_by_agent_key OR NEW.recorded_at<>OLD.recorded_at
   OR NEW.private_generation<>OLD.private_generation+1 OR NEW.generation_changed_at<OLD.generation_changed_at
   OR (to_jsonb(NEW)-ARRAY['current_revision_id','private_generation','generation_changed_at'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['current_revision_id','private_generation','generation_changed_at'])) THEN
    RAISE EXCEPTION 'invalid authoring cursor change' USING ERRCODE='23514';
  END IF;
  IF NEW.current_revision_id IS NOT NULL AND NOT EXISTS(SELECT FROM public.harness_operating_case_revisions x
   WHERE x.id=NEW.current_revision_id AND x.case_id=NEW.id AND x.vehicle_id=NEW.vehicle_id AND x.sealed_at IS NOT NULL) THEN
   RAISE EXCEPTION 'current recipe must be same-case sealed revision' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND NOT EXISTS(SELECT FROM public.harness_operating_case_revisions x
   WHERE x.id=NEW.current_revision_id AND x.prior_revision_id IS NOT DISTINCT FROM OLD.current_revision_id
    AND x.case_id=NEW.id AND x.vehicle_id=NEW.vehicle_id AND x.sealed_at IS NOT NULL
    AND x.revision_number=coalesce((SELECT revision_number FROM public.harness_operating_case_revisions WHERE id=OLD.current_revision_id),0)+1) THEN
   RAISE EXCEPTION 'authoring head must advance to its exact sealed successor' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='harness_operating_case_revisions' THEN
  IF TG_OP='UPDATE' AND (OLD.sealed_at IS NOT NULL OR NEW.sealed_at IS NULL
   OR (to_jsonb(NEW)-ARRAY['sealed_at','recipe_hash','scope_key'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['sealed_at','recipe_hash','scope_key'])) THEN
   RAISE EXCEPTION 'revision permits only one seal' USING ERRCODE='23514';
  END IF;
  IF NEW.reference_termination_id IS NOT NULL AND NOT EXISTS(SELECT FROM public.wire_termination_specs x
   WHERE x.id=NEW.reference_termination_id AND x.vehicle_id=NEW.vehicle_id) THEN
   RAISE EXCEPTION 'foreign reference terminal' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO r FROM public.harness_operating_case_revisions WHERE id=NEW.revision_id FOR KEY SHARE;
 IF NOT FOUND OR r.case_id<>NEW.case_id OR r.vehicle_id<>NEW.vehicle_id OR r.sealed_at IS NOT NULL OR TG_OP<>'INSERT' THEN
  RAISE EXCEPTION 'recipe children require matching unsealed revision' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME='harness_operating_case_wires' THEN
  SELECT vehicle_id INTO v FROM public.harness_segments WHERE id=NEW.segment_id;
  IF v IS DISTINCT FROM NEW.vehicle_id THEN RAISE EXCEPTION 'foreign recipe wire' USING ERRCODE='23514'; END IF;
  NEW.direct_resistance_ohm:=trim_scale(NEW.direct_resistance_ohm);
  NEW.design_length_m:=trim_scale(NEW.design_length_m);
 ELSIF TG_TABLE_NAME='harness_operating_case_elements' THEN
  IF NEW.source_endpoint_id IS NOT NULL AND NOT EXISTS(SELECT FROM public.harness_endpoints x
   JOIN public.harness_designs d ON d.id=x.design_id
   WHERE x.id=NEW.source_endpoint_id AND d.vehicle_id=NEW.vehicle_id) THEN
   RAISE EXCEPTION 'foreign source device' USING ERRCODE='23514';
  END IF;
  FOREACH t IN ARRAY ARRAY[NEW.from_termination_id,NEW.to_termination_id] LOOP
   IF NOT EXISTS(SELECT FROM public.wire_termination_specs x WHERE x.id=t AND x.vehicle_id=NEW.vehicle_id
    AND (NEW.source_endpoint_id IS NULL OR x.endpoint_id=NEW.source_endpoint_id)) THEN
    RAISE EXCEPTION 'foreign or mismatched source-device terminal' USING ERRCODE='23514';
   END IF;
  END LOOP;
  NEW.resistance_ohm:=trim_scale(NEW.resistance_ohm);
  NEW.voltage_v:=trim_scale(NEW.voltage_v);
  NEW.current_a:=trim_scale(NEW.current_a);
 ELSIF NOT EXISTS(SELECT FROM public.wire_termination_specs x WHERE x.id=NEW.termination_id AND x.vehicle_id=NEW.vehicle_id) THEN
  RAISE EXCEPTION 'foreign boundary terminal' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

-- Deferred checks read the final row, not the pre-seal NEW transition. A
-- transaction may assemble a recipe but cannot commit a partial/open recipe.
CREATE FUNCTION public.harness_operating_case_recipe_closed()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE r public.harness_operating_case_revisions%ROWTYPE; recipe jsonb; bad boolean;
BEGIN
 SELECT * INTO r FROM public.harness_operating_case_revisions WHERE id=NEW.id;
 recipe:=public.harness_operating_case_recipe(r.id);
 IF r.sealed_at IS NULL OR r.recipe_hash<>md5(recipe::text)
  OR r.scope_key<>md5(public.harness_operating_case_scope(recipe)::text)
  OR r.expected_wire_count<>(SELECT count(*) FROM public.harness_operating_case_wires WHERE revision_id=r.id)
  OR r.expected_element_count<>(SELECT count(*) FROM public.harness_operating_case_elements WHERE revision_id=r.id)
  OR r.expected_boundary_count<>(SELECT count(*) FROM public.harness_operating_case_boundaries WHERE revision_id=r.id) THEN
  RAISE EXCEPTION 'operating recipe is unsealed or incomplete' USING ERRCODE='23514';
 END IF;
 -- Source attachment keys constrain authored ports. Current eligibility is
 -- rechecked against the structural receipt by the future compiler.
 SELECT EXISTS(
  SELECT 1 FROM (
   SELECT e.from_termination_id t FROM public.harness_operating_case_elements e WHERE e.revision_id=r.id
   UNION SELECT e.to_termination_id FROM public.harness_operating_case_elements e WHERE e.revision_id=r.id
   UNION SELECT b.termination_id FROM public.harness_operating_case_boundaries b WHERE b.revision_id=r.id
   UNION SELECT r.reference_termination_id WHERE r.reference_termination_id IS NOT NULL
  ) ports WHERE NOT EXISTS(SELECT FROM public.harness_operating_case_wires w JOIN public.harness_segments s ON s.id=w.segment_id
   WHERE w.revision_id=r.id AND ports.t IN(s.from_termination_id,s.to_termination_id))
 ) INTO bad;
 IF bad THEN RAISE EXCEPTION 'declared port is outside selected physical pieces' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT FROM public.harness_operating_case_boundaries b JOIN public.harness_operating_case_elements e
   ON e.revision_id=b.revision_id AND b.termination_id IN(e.from_termination_id,e.to_termination_id) WHERE b.revision_id=r.id) THEN
  RAISE EXCEPTION 'terminal has conflicting device and boundary declarations' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION public.harness_operating_case_record(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='10s' AS $$
DECLARE c public.harness_operating_cases%ROWTYPE; revision_ uuid:=gen_random_uuid(); n integer; cfg jsonb;
 recipe jsonb; x jsonb; key_ text; v uuid; case_ uuid; expected_ uuid; at_ timestamptz; author_ text;
BEGIN
 -- Own closure mode only. Validate the complete recipe before returning even
 -- when the caller entered with SET CONSTRAINTS ALL IMMEDIATE.
 SET CONSTRAINTS public.operating_recipe_closed DEFERRED;
 IF p_input IS NULL OR jsonb_typeof(p_input)<>'object' OR pg_column_size(p_input)>131072 THEN
  RAISE EXCEPTION 'invalid conditional recipe envelope' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT FROM jsonb_object_keys(p_input) k WHERE k<>ALL(ARRAY['case_id','vehicle_id','case_code',
   'expected_revision_id','recorded_by_agent_key','method_version','authored_at','requested_state',
   'reference_termination_id','wires','elements','boundaries']))
  OR NOT p_input ?& ARRAY['case_id','vehicle_id','case_code','expected_revision_id','recorded_by_agent_key',
   'method_version','authored_at','requested_state','reference_termination_id','wires','elements','boundaries'] THEN
  RAISE EXCEPTION 'unknown or absent recipe field' USING ERRCODE='22023';
 END IF;
 FOREACH key_ IN ARRAY ARRAY['case_id','vehicle_id','case_code','recorded_by_agent_key','method_version','authored_at','requested_state'] LOOP
  IF jsonb_typeof(p_input->key_) IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'recipe identity/context must be text' USING ERRCODE='22023';
  END IF;
 END LOOP;
 FOREACH key_ IN ARRAY ARRAY['expected_revision_id','reference_termination_id'] LOOP
  IF jsonb_typeof(p_input->key_) NOT IN('string','null') THEN
   RAISE EXCEPTION 'recipe reference must be UUID text or null' USING ERRCODE='22023';
  END IF;
 END LOOP;
 FOREACH key_ IN ARRAY ARRAY['wires','elements','boundaries'] LOOP
  IF jsonb_typeof(p_input->key_) IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'recipe collections must be arrays' USING ERRCODE='22023';
  END IF;
 END LOOP;
 IF jsonb_array_length(p_input->'wires')>8 OR jsonb_array_length(p_input->'elements')>32
  OR jsonb_array_length(p_input->'boundaries')>16 THEN RAISE EXCEPTION 'bounded recipe exceeded' USING ERRCODE='22023'; END IF;
 case_:=(p_input->>'case_id')::uuid; v:=(p_input->>'vehicle_id')::uuid;
 expected_:=(p_input->>'expected_revision_id')::uuid; at_:=(p_input->>'authored_at')::timestamptz;
 author_:=p_input->>'recorded_by_agent_key';
 IF at_ IS NULL OR NOT isfinite(at_) OR author_ IS NULL OR NOT EXISTS(SELECT FROM public.vehicles WHERE id=v
  AND is_public IS TRUE AND deleted_at IS NULL) THEN
  RAISE EXCEPTION 'unsupported vehicle or authoring context' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.harness_operating_cases(id,vehicle_id,case_code,recorded_by_agent_key)
  VALUES(case_,v,p_input->>'case_code',author_) ON CONFLICT(id) DO NOTHING;
 SELECT * INTO c FROM public.harness_operating_cases WHERE id=case_ FOR UPDATE;
 IF c.vehicle_id<>v OR c.case_code IS DISTINCT FROM p_input->>'case_code' THEN
  RAISE EXCEPTION 'case identity collision' USING ERRCODE='23514';
 END IF;
 IF c.current_revision_id IS DISTINCT FROM expected_ THEN
  RAISE EXCEPTION 'conditional recipe head changed' USING ERRCODE='40001';
 END IF;
 SELECT coalesce(max(revision_number),0)+1 INTO n FROM public.harness_operating_case_revisions WHERE case_id=case_;
 INSERT INTO public.harness_operating_case_revisions(id,case_id,vehicle_id,revision_number,prior_revision_id,
  reference_termination_id,recipe_hash,scope_key,requested_state,parameter_basis,expected_wire_count,
  expected_element_count,expected_boundary_count,recorded_by_agent_key,method_version,authored_at)
 VALUES(revision_,case_,v,n,c.current_revision_id,(p_input->>'reference_termination_id')::uuid,
  repeat('0',32),repeat('0',32),p_input->>'requested_state','conditional_assumption',jsonb_array_length(p_input->'wires'),
  jsonb_array_length(p_input->'elements'),jsonb_array_length(p_input->'boundaries'),author_,p_input->>'method_version',at_);
 FOR x IN SELECT value FROM jsonb_array_elements(p_input->'wires') LOOP
  IF jsonb_typeof(x) IS DISTINCT FROM 'object' OR NOT x ?& ARRAY['segment_id','wire_state','resistance_basis','length_basis','applicability_basis']
   OR EXISTS(SELECT FROM jsonb_object_keys(x) k WHERE k<>ALL(ARRAY['segment_id','wire_state','resistance_basis',
    'direct_resistance_ohm','resistance_claim_observation_id','length_basis','design_length_m','applicability_basis'])) THEN
   RAISE EXCEPTION 'invalid wire recipe fields' USING ERRCODE='22023';
  END IF;
  FOREACH key_ IN ARRAY ARRAY['direct_resistance_ohm','design_length_m'] LOOP
   IF x ? key_ AND jsonb_typeof(x->key_) NOT IN('number','null') THEN
    RAISE EXCEPTION 'wire parameter must be JSON number or null' USING ERRCODE='22023';
   END IF;
  END LOOP;
  INSERT INTO public.harness_operating_case_wires(revision_id,case_id,vehicle_id,segment_id,wire_state,resistance_basis,
   direct_resistance_ohm,resistance_claim_observation_id,length_basis,design_length_m,applicability_basis)
  VALUES(revision_,case_,v,(x->>'segment_id')::uuid,x->>'wire_state',x->>'resistance_basis',(x->>'direct_resistance_ohm')::numeric,
   (x->>'resistance_claim_observation_id')::uuid,x->>'length_basis',(x->>'design_length_m')::numeric,x->>'applicability_basis');
 END LOOP;
 FOR x IN SELECT value FROM jsonb_array_elements(p_input->'elements') LOOP
  IF jsonb_typeof(x) IS DISTINCT FROM 'object' OR NOT x ?& ARRAY['element_id','element_code','from_termination_id','to_termination_id','law_kind']
   OR EXISTS(SELECT FROM jsonb_object_keys(x) k WHERE k<>ALL(ARRAY['element_id','element_code','source_endpoint_id',
    'from_termination_id','to_termination_id','law_kind','contact_state','resistance_ohm','voltage_v','current_a'])) THEN
   RAISE EXCEPTION 'invalid element recipe fields' USING ERRCODE='22023';
  END IF;
  FOREACH key_ IN ARRAY ARRAY['resistance_ohm','voltage_v','current_a'] LOOP
   IF x ? key_ AND jsonb_typeof(x->key_) NOT IN('number','null') THEN
    RAISE EXCEPTION 'element parameter must be JSON number or null' USING ERRCODE='22023';
   END IF;
  END LOOP;
  INSERT INTO public.harness_operating_case_elements(revision_id,element_id,case_id,vehicle_id,element_code,
   source_endpoint_id,from_termination_id,to_termination_id,law_kind,contact_state,resistance_ohm,voltage_v,current_a,parameter_basis)
  VALUES(revision_,(x->>'element_id')::uuid,case_,v,x->>'element_code',(x->>'source_endpoint_id')::uuid,
   (x->>'from_termination_id')::uuid,(x->>'to_termination_id')::uuid,x->>'law_kind',x->>'contact_state',
   (x->>'resistance_ohm')::numeric,(x->>'voltage_v')::numeric,(x->>'current_a')::numeric,'conditional_assumption');
 END LOOP;
 FOR x IN SELECT value FROM jsonb_array_elements(p_input->'boundaries') LOOP
  IF jsonb_typeof(x) IS DISTINCT FROM 'object' OR NOT x ?& ARRAY['termination_id','boundary_kind']
   OR EXISTS(SELECT FROM jsonb_object_keys(x) k WHERE k NOT IN('termination_id','boundary_kind')) THEN
   RAISE EXCEPTION 'invalid boundary recipe fields' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.harness_operating_case_boundaries(revision_id,case_id,vehicle_id,termination_id,boundary_kind)
  VALUES(revision_,case_,v,(x->>'termination_id')::uuid,x->>'boundary_kind');
 END LOOP;
 recipe:=public.harness_operating_case_recipe(revision_);
 -- Every successful explicit author call creates a complete new revision.
 -- No caller-controlled hash, overwrite or sparse inheritance changes history.
 UPDATE public.harness_operating_case_revisions SET recipe_hash=md5(recipe::text),
  scope_key=md5(public.harness_operating_case_scope(recipe)::text),sealed_at=clock_timestamp() WHERE id=revision_;
 SET CONSTRAINTS public.operating_recipe_closed IMMEDIATE;
 UPDATE public.harness_operating_cases SET current_revision_id=revision_,private_generation=private_generation+1,
  generation_changed_at=clock_timestamp() WHERE id=case_;
 cfg:=public.model_fold_config();
 IF coalesce((cfg->>'enabled')::boolean,false) AND coalesce((cfg->>'signals_enabled')::boolean,false)
  AND public.harness_model_in_scope(v) THEN
  INSERT INTO public.model_fold_signal(vehicle_id,reason,priority,at)
   VALUES(v,'harness_dc:changed',2,clock_timestamp());
 END IF;
 RETURN jsonb_build_object('case_id',case_,'revision_id',revision_,'revision_number',n,
  'private_generation',c.private_generation+1,'recipe_hash',md5(recipe::text),
  'scope_key',md5(public.harness_operating_case_scope(recipe)::text),'qualification','conditional_assumption');
END $$;

DO $$ DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['harness_operating_cases','harness_operating_case_revisions','harness_operating_case_wires',
  'harness_operating_case_elements','harness_operating_case_boundaries'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('GRANT SELECT ON public.%I TO service_role',t);
  EXECUTE format('CREATE TRIGGER source_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I
   FOR EACH ROW EXECUTE FUNCTION public.harness_operating_case_source_guard()',t);
  EXECUTE format('ALTER TABLE public.%I ENABLE ALWAYS TRIGGER source_guard',t);
 END LOOP;
END $$;
CREATE CONSTRAINT TRIGGER operating_recipe_closed AFTER INSERT OR UPDATE ON public.harness_operating_case_revisions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.harness_operating_case_recipe_closed();
ALTER TABLE public.harness_operating_case_revisions ENABLE ALWAYS TRIGGER operating_recipe_closed;
REVOKE ALL ON FUNCTION public.harness_operating_case_recipe(uuid),public.harness_operating_case_scope(jsonb),
 public.harness_operating_case_source_guard(),public.harness_operating_case_recipe_closed(),
 public.harness_operating_case_record(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.harness_operating_case_recipe(uuid),public.harness_operating_case_scope(jsonb),
 public.harness_operating_case_record(jsonb) TO service_role;


-- Reviewed module: supabase/sql/harness_operating_case/compile.sql
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


-- Reviewed module: supabase/sql/harness_operating_case/results.sql
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


-- Reviewed module: supabase/sql/harness_operating_case/worker_lifecycle.sql
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';

CREATE FUNCTION public.harness_operating_case_worker_context(p_vehicle uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE c text; frame text; tick uuid;
BEGIN
 GET DIAGNOSTICS c=PG_CONTEXT;
 frame:=regexp_replace(regexp_replace(c,E'[\n\r]+$',''),E'^.*\n','','s');
 IF frame !~ '^PL/pgSQL function (public\.)?model_fold_tick\(\) line [0-9]+ at [^\n]+$'
  OR NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=to_regprocedure('public.model_fold_tick()')
   AND p.prokind='p' AND p.proowner=current_user::regrole) THEN RETURN NULL; END IF;
 SELECT w.lease_tick INTO tick FROM public.model_fold_work w JOIN public.model_fold_ticks t ON t.tick_id=w.lease_tick
  WHERE w.vehicle_id=p_vehicle AND w.state='leased' AND w.leased_until>clock_timestamp()
   AND t.status='running' AND t.pid=pg_backend_pid();
 RETURN tick;
END $$;

CREATE FUNCTION public.harness_operating_case_worker_key()
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT md5(jsonb_build_object('calculation',public.harness_operating_case_logic(),
  'existing_tick',md5(pg_get_functiondef(to_regprocedure('public.model_fold_tick()'))),
  'worker_contract','private_case_attempt_v1',
  'functions',(SELECT jsonb_object_agg(k,md5(pg_get_functiondef(to_regprocedure(k))) ORDER BY k)
   FROM unnest(ARRAY['public.harness_operating_case_worker_context(uuid)',
    'public.harness_operating_case_worker_due(uuid,uuid)',
    'public.harness_operating_case_worker_claim(uuid,uuid,uuid)',
    'public.harness_operating_case_worker_finish(uuid,uuid,jsonb)',
    'public.harness_operating_case_source_guard()']) k))::text)
$$;

CREATE FUNCTION public.harness_operating_case_worker_due(p_case uuid,p_evaluation uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT coalesce((SELECT r.requested_state='enabled' AND r.sealed_at IS NOT NULL
  AND public.harness_model_in_scope(c.vehicle_id)
  AND (c.attempt_generation IS DISTINCT FROM c.private_generation
   OR c.attempt_revision_id IS DISTINCT FROM c.current_revision_id
   OR c.attempt_structural_evaluation_id IS DISTINCT FROM p_evaluation
   OR c.attempt_logic_key IS DISTINCT FROM public.harness_operating_case_worker_key()
   OR c.attempted_at IS NULL OR c.attempted_at<=statement_timestamp()-interval '15 minutes'
   OR ((c.retry_after IS NULL OR c.retry_after<=statement_timestamp())
    AND (c.answered_generation IS DISTINCT FROM c.private_generation OR c.failure_count>0)
    AND c.failure_count<coalesce((public.model_fold_config()->>'max_attempts')::integer,5)))
  FROM public.harness_operating_cases c JOIN public.harness_operating_case_revisions r ON r.id=c.current_revision_id
  WHERE c.id=p_case),false)
$$;

CREATE FUNCTION public.harness_operating_case_worker_claim(p_tick uuid,p_case uuid,p_evaluation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.harness_operating_cases; r public.harness_operating_case_revisions;
 compiled jsonb; key_ text; same_ boolean; budget integer;
BEGIN
 SELECT * INTO c FROM public.harness_operating_cases WHERE id=p_case FOR UPDATE;
 IF NOT FOUND OR public.harness_operating_case_worker_context(c.vehicle_id) IS DISTINCT FROM p_tick OR p_tick IS NULL THEN
  RAISE EXCEPTION 'private case claim requires its active existing worker lease' USING ERRCODE='42501'; END IF;
 IF NOT coalesce((public.model_fold_config()->>'enabled')::boolean,false)
  OR NOT public.harness_operating_case_worker_due(c.id,p_evaluation) THEN RETURN jsonb_build_object('status','not_due'); END IF;
 SELECT * INTO r FROM public.harness_operating_case_revisions WHERE id=c.current_revision_id;
 key_:=public.harness_operating_case_worker_key();
 compiled:=public.harness_operating_case_compile(r.id,p_evaluation);
 IF compiled->'input_receipt' IS NULL OR compiled->>'private_input_hash' IS NULL THEN
  RETURN jsonb_build_object('status','dependency_pending'); END IF;
 same_:=c.attempt_revision_id IS NOT DISTINCT FROM r.id
  AND c.attempt_generation IS NOT DISTINCT FROM c.private_generation
  AND c.attempt_structural_evaluation_id IS NOT DISTINCT FROM p_evaluation
  AND c.attempt_dependency_key IS NOT DISTINCT FROM compiled->>'private_input_hash'
  AND c.attempt_logic_key IS NOT DISTINCT FROM key_;
 budget:=coalesce((public.model_fold_config()->>'max_attempts')::integer,5);
 IF same_ AND c.failure_count>=budget THEN
  -- Recheck eligibility without reviving the unchanged computation budget.
  UPDATE public.harness_operating_cases SET attempted_at=clock_timestamp() WHERE id=c.id;
  RETURN jsonb_build_object('status','budget_exhausted');
 END IF;
 IF same_ AND c.retry_after>clock_timestamp() THEN
  UPDATE public.harness_operating_cases SET attempted_at=clock_timestamp() WHERE id=c.id;
  RETURN jsonb_build_object('status','backoff');
 END IF;
 UPDATE public.harness_operating_cases SET attempt_revision_id=r.id,
  attempt_structural_evaluation_id=p_evaluation,attempt_scope_key=r.scope_key,
  attempt_generation=c.private_generation,attempt_dependency_key=compiled->>'private_input_hash',attempt_logic_key=key_,
  attempt_tick_id=p_tick,attempted_at=clock_timestamp(),failure_count=CASE WHEN same_ THEN failure_count ELSE 0 END,
  retry_after=NULL WHERE id=c.id;
 RETURN jsonb_build_object('status','claimed','case_id',c.id,'revision_id',r.id,
  'generation',c.private_generation,'structural_evaluation_id',p_evaluation,
  'dependency_key',compiled->>'private_input_hash','worker_logic_key',key_);
END $$;

CREATE FUNCTION public.harness_operating_case_worker_finish(p_tick uuid,p_case uuid,p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.harness_operating_cases; shown jsonb; run_ public.harness_model_dc_runs; good boolean; failed boolean;
 at_ timestamptz:=clock_timestamp(); failures integer;
BEGIN
 SELECT * INTO c FROM public.harness_operating_cases WHERE id=p_case FOR UPDATE;
 IF NOT FOUND OR p_tick IS NULL OR c.attempt_tick_id IS DISTINCT FROM p_tick
  OR public.harness_operating_case_worker_context(c.vehicle_id) IS DISTINCT FROM p_tick THEN
  RAISE EXCEPTION 'private case completion requires its active existing worker attempt' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_result) IS DISTINCT FROM 'object' OR (p_result ? 'sqlstate'
  AND (p_result-'sqlstate'='{}'::jsonb AND jsonb_typeof(p_result->'sqlstate')='string'
   AND p_result->>'sqlstate' ~ '^[0-9A-Z]{5}$' AND left(p_result->>'sqlstate',2) NOT IN('00','01','02')) IS NOT TRUE) THEN
  RAISE EXCEPTION 'private case completion requires a typed outcome' USING ERRCODE='22023'; END IF;
 IF p_result ? 'changed' AND p_result<>'{"changed":true}'::jsonb THEN
  RAISE EXCEPTION 'changed completion must be an exclusive typed outcome' USING ERRCODE='22023'; END IF;
 IF p_result='{"changed":true}'::jsonb THEN
  shown:=public.harness_operating_case_compile(c.current_revision_id,c.attempt_structural_evaluation_id);
  IF c.current_revision_id=c.attempt_revision_id AND c.private_generation=c.attempt_generation
   AND c.attempt_logic_key=public.harness_operating_case_worker_key()
   AND shown->>'private_input_hash'=c.attempt_dependency_key THEN
   RAISE EXCEPTION 'unchanged attempt cannot be discarded as changed' USING ERRCODE='23514'; END IF;
  UPDATE public.harness_operating_cases SET attempt_tick_id=NULL,failure_count=0,retry_after=NULL WHERE id=c.id;
  RETURN jsonb_build_object('status','changed');
 END IF;
 failed:=p_result ? 'sqlstate';
 IF NOT failed THEN
  IF p_result-ARRAY['run_id','status','qualification','dependencies_still_match']<>'{}'::jsonb
   OR jsonb_typeof(p_result->'run_id') IS DISTINCT FROM 'string'
   OR (p_result->>'run_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') IS NOT TRUE
   OR (p_result->>'status' IN('solved','held','indeterminate','inconsistent','numerical_failure','reused')) IS NOT TRUE
   OR (p_result ? 'qualification' AND p_result->>'qualification' IS DISTINCT FROM 'conditional_simulation_only')
   OR (p_result ? 'dependencies_still_match' AND jsonb_typeof(p_result->'dependencies_still_match')<>'boolean') THEN
   RAISE EXCEPTION 'completed run requires an exclusive typed success outcome' USING ERRCODE='22023'; END IF;
  SELECT * INTO run_ FROM public.harness_model_dc_runs WHERE id=(p_result->>'run_id')::uuid
   AND case_id=c.id AND revision_id=c.attempt_revision_id AND private_generation=c.attempt_generation
   AND structural_evaluation_id=c.attempt_structural_evaluation_id AND scope_key=c.attempt_scope_key
   AND private_input_hash=c.attempt_dependency_key AND sealed_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'private completion has no exact closed run' USING ERRCODE='23514'; END IF;
  IF p_result->>'status'<>'reused' AND p_result->>'status' IS DISTINCT FROM run_.status THEN
   RAISE EXCEPTION 'completion status differs from the exact closed run' USING ERRCODE='22023'; END IF;
  shown:=public.harness_operating_case_result(c.id,c.attempt_structural_evaluation_id);
  good:=c.current_revision_id=c.attempt_revision_id AND c.private_generation=c.attempt_generation
   AND c.attempt_logic_key=public.harness_operating_case_worker_key()
   AND coalesce((shown->>'current')::boolean,false) AND shown#>>'{run,id}'=run_.id::text;
  UPDATE public.harness_operating_cases SET attempt_tick_id=NULL,failure_count=0,retry_after=NULL,
   answered_generation=CASE WHEN good THEN c.attempt_generation ELSE answered_generation END,
   latest_run_id=CASE WHEN good THEN run_.id ELSE latest_run_id END WHERE id=c.id;
  RETURN jsonb_build_object('status',CASE WHEN good THEN 'answered' ELSE 'changed' END);
 END IF;
 failures:=c.failure_count+1;
 UPDATE public.harness_operating_cases SET attempt_tick_id=NULL,failure_count=failures,
  retry_after=at_+make_interval(secs=>least(3600,60*power(2,least(failures,6))::integer)) WHERE id=c.id;
 RETURN jsonb_build_object('status','failed','sqlstate',p_result->>'sqlstate');
END $$;

-- Extend the existing append-only source guard only for controller fields
-- under a real model_fold_tick frame AND its live vehicle work lease.
DO $patch$
DECLARE b text:=pg_get_functiondef('public.harness_operating_case_source_guard()'::regprocedure);
 a text:=$a$ GET DIAGNOSTICS c=PG_CONTEXT;$a$;
 z text:=$z$ IF TG_TABLE_NAME='harness_operating_cases' AND TG_OP='UPDATE'
  AND public.harness_operating_case_worker_context(NEW.vehicle_id) IS NOT NULL THEN
  IF (to_jsonb(NEW)-ARRAY['answered_generation','latest_run_id','attempt_revision_id','attempt_structural_evaluation_id',
    'attempt_scope_key','attempt_generation','attempt_dependency_key','attempt_logic_key','attempt_tick_id','attempted_at','failure_count','retry_after'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['answered_generation','latest_run_id','attempt_revision_id','attempt_structural_evaluation_id',
    'attempt_scope_key','attempt_generation','attempt_dependency_key','attempt_logic_key','attempt_tick_id','attempted_at','failure_count','retry_after']) THEN
   RAISE EXCEPTION 'worker cannot change authored recipe identity or generation' USING ERRCODE='23514'; END IF;
  IF NEW.attempt_revision_id IS NOT NULL AND NOT EXISTS(SELECT FROM public.harness_operating_case_revisions x
   WHERE x.id=NEW.attempt_revision_id AND x.case_id=NEW.id AND x.vehicle_id=NEW.vehicle_id AND x.sealed_at IS NOT NULL
    AND x.scope_key=NEW.attempt_scope_key AND x.revision_number=NEW.attempt_generation) THEN
   RAISE EXCEPTION 'worker attempt must bind an exact sealed same-case scope/generation' USING ERRCODE='23514'; END IF;
  IF NEW.attempt_tick_id IS NOT NULL AND (NEW.attempt_tick_id IS DISTINCT FROM public.harness_operating_case_worker_context(NEW.vehicle_id)
   OR NEW.attempt_revision_id IS NULL OR NEW.attempt_structural_evaluation_id IS NULL
   OR NEW.attempt_scope_key IS NULL OR NEW.attempt_generation IS NULL
   OR NEW.attempt_dependency_key IS NULL OR NEW.attempt_dependency_key !~ '^[0-9a-f]{32}$'
   OR NEW.attempt_logic_key IS NULL OR NEW.attempt_logic_key !~ '^[0-9a-f]{32}$' OR NEW.attempted_at IS NULL) THEN
   RAISE EXCEPTION 'worker attempt lacks its real lease and complete durable context' USING ERRCODE='23514'; END IF;
  IF (NEW.answered_generation IS DISTINCT FROM OLD.answered_generation OR NEW.latest_run_id IS DISTINCT FROM OLD.latest_run_id)
   AND (NEW.answered_generation IS DISTINCT FROM NEW.private_generation
    OR NEW.current_revision_id IS DISTINCT FROM NEW.attempt_revision_id
    OR NOT EXISTS(SELECT FROM public.harness_model_dc_runs x WHERE x.id=NEW.latest_run_id AND x.case_id=NEW.id
     AND x.vehicle_id=NEW.vehicle_id AND x.revision_id=NEW.current_revision_id AND x.private_generation=NEW.answered_generation
     AND x.structural_evaluation_id=NEW.attempt_structural_evaluation_id AND x.scope_key=NEW.attempt_scope_key
     AND x.private_input_hash=NEW.attempt_dependency_key AND x.sealed_at IS NOT NULL)) THEN
   RAISE EXCEPTION 'worker answer must be the exact closed current-generation run' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 GET DIAGNOSTICS c=PG_CONTEXT;$z$;
BEGIN
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Worker source guard anchor drift'; END IF;
 EXECUTE replace(b,a,z);
END $patch$;

-- The existing evaluator remains the only run writer; permit its genuine
-- nested invocation by the existing leased tick, not a top-level wrapper.
DO $patch$
DECLARE b text:=pg_get_functiondef('public.harness_operating_case_result_guard()'::regprocedure); a text; z text;
BEGIN
 a:='DECLARE context_ text; frame_ text;';
 z:='DECLARE context_ text; frame_ text; context_lines_ text[]; previous_frame_ text;';
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Worker result declaration anchor drift'; END IF;
 b:=replace(b,a,z);
 a:=$a$ IF frame_ !~ '^PL/pgSQL function (public\.)?harness_operating_case_evaluate\(uuid,uuid\) line [0-9]+ at [^\n]+$'$a$;
 z:=$z$ context_lines_:=string_to_array(rtrim(context_,chr(10)||chr(13)),chr(10));
 previous_frame_:=context_lines_[cardinality(context_lines_)-1];
 IF (frame_ !~ '^PL/pgSQL function (public\.)?harness_operating_case_evaluate\(uuid,uuid\) line [0-9]+ at [^\n]+$'
  AND NOT coalesce(frame_ ~ '^PL/pgSQL function (public\.)?model_fold_tick\(\) line [0-9]+ at [^\n]+$'
   AND previous_frame_ ~ '^PL/pgSQL function (public\.)?harness_operating_case_evaluate\(uuid,uuid\) line [0-9]+ at SQL statement$'
   AND EXISTS(SELECT FROM public.harness_operating_cases x WHERE x.attempt_tick_id IS NOT NULL
    AND x.attempt_tick_id=public.harness_operating_case_worker_context(x.vehicle_id)),false))$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Worker result guard anchor drift'; END IF;
 b:=replace(b,a,z);
 a:=$a$ IF TG_OP='DELETE' THEN RAISE EXCEPTION 'DC history is append-only' USING ERRCODE='23514'; END IF;$a$;
 z:=$z$ IF frame_ ~ '^PL/pgSQL function (public\.)?model_fold_tick\(\) line [0-9]+ at [^\n]+$' AND TG_OP<>'DELETE' THEN
  IF TG_TABLE_NAME='harness_model_dc_runs' THEN r:=NEW;
  ELSE SELECT * INTO r FROM public.harness_model_dc_runs WHERE id=NEW.run_id; END IF;
  IF NOT EXISTS(SELECT FROM public.harness_operating_cases x WHERE x.id=r.case_id AND x.vehicle_id=r.vehicle_id
   AND x.attempt_tick_id=public.harness_operating_case_worker_context(x.vehicle_id)
   AND x.attempt_revision_id=r.revision_id AND x.attempt_generation=r.private_generation
   AND x.attempt_structural_evaluation_id=r.structural_evaluation_id AND x.attempt_scope_key=r.scope_key
   AND x.attempt_dependency_key=r.private_input_hash) THEN
   RAISE EXCEPTION 'worker result must belong to its durable exact attempt' USING ERRCODE='42501'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'DC history is append-only' USING ERRCODE='23514'; END IF;$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Worker result subject anchor drift'; END IF;
 EXECUTE replace(b,a,z);

END $patch$;

REVOKE ALL ON FUNCTION public.harness_operating_case_worker_context(uuid),public.harness_operating_case_worker_key(),
 public.harness_operating_case_worker_due(uuid,uuid),public.harness_operating_case_worker_claim(uuid,uuid,uuid),
 public.harness_operating_case_worker_finish(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;


-- Reviewed module: supabase/sql/harness_operating_case/tick_phase.sql
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';

CREATE FUNCTION public.harness_operating_case_worker_parent(p_vehicle uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE evaluation_ uuid; hash_ text; receipt_ jsonb;
BEGIN
 SELECT e.id,e.input_hash INTO evaluation_,hash_ FROM public.harness_model_state s
  JOIN public.harness_model_evaluations e ON e.id=s.latest_evaluation_id AND e.vehicle_id=s.vehicle_id
  WHERE s.vehicle_id=p_vehicle;
 IF NOT FOUND THEN RETURN NULL; END IF;
 -- Reuse the canonical completeness/epoch/code predicate as a cheap dispatch
 -- filter. The compiler still verifies the actual current input hash.
 receipt_:=public.harness_model_receipt_for_hash(p_vehicle,hash_);
 RETURN CASE WHEN receipt_->>'id'=evaluation_::text THEN evaluation_ END;
END $$;

CREATE FUNCTION public.harness_operating_case_worker_vehicle_due(p_vehicle uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE evaluation_ uuid;
BEGIN
 evaluation_:=public.harness_operating_case_worker_parent(p_vehicle);
 IF evaluation_ IS NULL THEN RETURN false; END IF;
 RETURN EXISTS(SELECT FROM public.harness_operating_cases c WHERE c.vehicle_id=p_vehicle
  AND public.harness_operating_case_worker_due(c.id,evaluation_));
END $$;

CREATE FUNCTION public.harness_operating_case_worker_enqueue_changed()
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE n integer; cfg jsonb:=public.model_fold_config();
BEGIN
 IF NOT coalesce((cfg->>'enabled')::boolean,false) OR NOT coalesce((cfg->>'signals_enabled')::boolean,false) THEN RETURN 0; END IF;
 INSERT INTO public.model_fold_signal(vehicle_id,reason,priority)
 SELECT v.vehicle_id,'harness_operating_case_changed',3 FROM(
  SELECT DISTINCT c.vehicle_id FROM public.harness_operating_cases c
   WHERE public.harness_model_in_scope(c.vehicle_id)
    AND public.harness_operating_case_worker_vehicle_due(c.vehicle_id)
   ORDER BY c.vehicle_id LIMIT 500) v;
 GET DIAGNOSTICS n=ROW_COUNT;RETURN n;
END $$;

ALTER TABLE public.model_fold_tick_runs
 DROP CONSTRAINT model_fold_tick_runs_fold_phase_check,
 ADD CONSTRAINT model_fold_tick_runs_fold_phase_check CHECK(fold_phase IN('vehicle','harness','dc')),
 ADD COLUMN dc_status text CHECK(dc_status IN('solved','held','indeterminate','inconsistent','numerical_failure','reused','changed','failed')),
 ADD COLUMN dc_error_code text CHECK(dc_error_code IS NULL OR dc_error_code ~ '^[0-9A-Z]{5}$'),
 ADD COLUMN dc_output_retained boolean NOT NULL DEFAULT false,
 ADD CONSTRAINT model_fold_run_dc_phase_status CHECK((fold_phase='dc')=(dc_status IS NOT NULL)),
 ADD CONSTRAINT model_fold_run_dc_retained CHECK(NOT dc_output_retained OR fold_phase='dc');
COMMENT ON COLUMN public.model_fold_tick_runs.dc_status IS
 'Opaque private DC phase outcome only. No case identifier, parameters, run identifier or raw exception is exposed here.';

DO $patch$
DECLARE b text:=pg_get_functiondef('public.model_fold_tick()'::regprocedure); a text; z text;
BEGIN
 FOR a,z IN SELECT * FROM(VALUES
 ($a$  v_statement_limit interval:=current_setting('statement_timeout')::interval;$a$,
  $z$  v_statement_limit interval:=current_setting('statement_timeout')::interval;
  v_dc_case uuid; v_dc_evaluation uuid; v_dc_phase boolean; v_dc_claim jsonb; v_dc_finish jsonb;
  v_dc_started timestamptz; v_dc_error text;$z$),
 ($a$  perform public.harness_model_enqueue_changed();$a$,
  $z$  perform public.harness_model_enqueue_changed();
  perform public.harness_operating_case_worker_enqueue_changed();$z$),
 ($a$    if v_harness_phase and v_statement_limit>interval '0'$a$,
  $z$    v_dc_case:=NULL;v_dc_evaluation:=NULL;v_dc_phase:=false;
    if v_stage='normal' AND NOT v_harness_phase then
      v_dc_evaluation:=public.harness_operating_case_worker_parent(v_veh);
      if v_dc_evaluation IS NOT NULL then
        select c.id into v_dc_case from public.harness_operating_cases c where c.vehicle_id=v_veh
          AND public.harness_operating_case_worker_due(c.id,v_dc_evaluation)
          order by c.attempted_at NULLS FIRST,c.generation_changed_at,c.id limit 1 for update skip locked;
        v_dc_phase:=v_dc_case IS NOT NULL;
      end if;
    end if;
    if (v_harness_phase OR v_dc_phase) and v_statement_limit>interval '0'$z$),
 ($a$    commit;
    n_claim := n_claim + 1;$a$,
  $z$    if v_dc_phase then
      v_dc_claim:=public.harness_operating_case_worker_claim(v_tick,v_dc_case,v_dc_evaluation);
      v_dc_phase:=v_dc_claim->>'status'='claimed';
    end if;
    commit;
    n_claim := n_claim + 1;$z$),
 ($a$      if v_harness_phase then$a$,
  $z$      if v_dc_phase then
        v_dc_started:=clock_timestamp();r:=NULL;
        if EXISTS(select from public.harness_operating_cases c where c.id=v_dc_case
          AND c.current_revision_id=c.attempt_revision_id AND c.private_generation=c.attempt_generation) then
          r:=public.harness_operating_case_evaluate(v_dc_case,v_dc_evaluation);
          if r->>'run_id' IS NULL then
            v_dc_finish:=public.harness_operating_case_worker_finish(v_tick,v_dc_case,'{"changed":true}');
          else v_dc_finish:=public.harness_operating_case_worker_finish(v_tick,v_dc_case,r);end if;
        else v_dc_finish:=public.harness_operating_case_worker_finish(v_tick,v_dc_case,'{"changed":true}');end if;
        insert into public.model_fold_tick_runs(tick_id,vehicle_id,fold_phase,dc_status,dc_output_retained,ms)
         values(v_tick,v_veh,'dc',case when v_dc_finish->>'status'='changed' then 'changed' else r->>'status' end,
          r->>'run_id' IS NOT NULL,round(extract(epoch from clock_timestamp()-v_dc_started)*1000)::integer);
        update public.model_fold_work set state='pending',fold_stage='vehicle_followup',attempts=greatest(0,attempts-1),
         leased_until=NULL,lease_tick=NULL,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp() where vehicle_id=v_veh;
      elsif v_harness_phase then$z$),
 ($a$dirty_at > v_dirty OR public.harness_model_due(v_veh,v_harness_key,v_maxatt)$a$,
  $z$dirty_at > v_dirty OR public.harness_model_due(v_veh,v_harness_key,v_maxatt)
        OR public.harness_operating_case_worker_vehicle_due(v_veh)$z$),
 ($a$      get stacked diagnostics v_err = message_text;$a$,
  $z$      if v_dc_phase then
        get stacked diagnostics v_dc_error=returned_sqlstate;
        perform public.harness_operating_case_worker_finish(v_tick,v_dc_case,jsonb_build_object('sqlstate',v_dc_error));
        insert into public.model_fold_tick_runs(tick_id,vehicle_id,fold_phase,dc_status,dc_error_code,ms)
         values(v_tick,v_veh,'dc','failed',v_dc_error,round(extract(epoch from clock_timestamp()-v_dc_started)*1000)::integer);
        update public.model_fold_work set state='pending',fold_stage='vehicle_followup',attempts=greatest(0,attempts-1),
         leased_until=NULL,lease_tick=NULL,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp() where vehicle_id=v_veh;
        n_fail:=n_fail+1;
      else
      get stacked diagnostics v_err = message_text;$z$),
 ($a$      if v_att >= v_maxatt then n_dead := n_dead + 1; end if;$a$,
  $z$      if v_att >= v_maxatt then n_dead := n_dead + 1; end if;
      end if;$z$),
 ($a$    exit when v_harness_phase OR v_stage='vehicle_followup';$a$,
  $z$    exit when v_harness_phase OR v_dc_phase OR v_stage='vehicle_followup';$z$)
 ) p(old,new) LOOP
  IF (length(b)-length(replace(b,a,'')))/length(a)<>(CASE WHEN a LIKE 'dirty_at >%' THEN 2 ELSE 1 END) THEN
   RAISE EXCEPTION 'Private tick phase anchor drift: %',left(a,80); END IF;
  b:=replace(b,a,z);
 END LOOP;
 EXECUTE b;
END $patch$;

REVOKE ALL ON FUNCTION public.harness_operating_case_worker_parent(uuid),
 public.harness_operating_case_worker_vehicle_due(uuid),public.harness_operating_case_worker_enqueue_changed()
 FROM PUBLIC,anon,authenticated,service_role;


-- Reviewed module: supabase/sql/harness_operating_case/worker_preparation.sql
SET LOCAL statement_timeout='10s';SET LOCAL lock_timeout='2s';

CREATE OR REPLACE FUNCTION public.harness_operating_case_worker_claim(p_tick uuid,p_case uuid,p_evaluation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.harness_operating_cases; r public.harness_operating_case_revisions; key_ text; same_ boolean;
BEGIN
 SELECT * INTO c FROM public.harness_operating_cases WHERE id=p_case FOR UPDATE;
 IF NOT FOUND OR p_tick IS NULL OR public.harness_operating_case_worker_context(c.vehicle_id) IS DISTINCT FROM p_tick THEN
  RAISE EXCEPTION 'private case claim requires its active existing worker lease' USING ERRCODE='42501'; END IF;
 IF NOT coalesce((public.model_fold_config()->>'enabled')::boolean,false)
  OR NOT public.harness_operating_case_worker_due(c.id,p_evaluation) THEN RETURN jsonb_build_object('status','not_due'); END IF;
 SELECT * INTO r FROM public.harness_operating_case_revisions WHERE id=c.current_revision_id;
 key_:=public.harness_operating_case_worker_key();
 same_:=c.attempt_revision_id IS NOT DISTINCT FROM r.id
  AND c.attempt_generation IS NOT DISTINCT FROM c.private_generation
  AND c.attempt_structural_evaluation_id IS NOT DISTINCT FROM p_evaluation AND c.attempt_logic_key IS NOT DISTINCT FROM key_;
 UPDATE public.harness_operating_cases SET attempt_revision_id=r.id,attempt_scope_key=r.scope_key,
  attempt_generation=c.private_generation,attempt_structural_evaluation_id=p_evaluation,attempt_logic_key=key_,
  attempt_dependency_key=CASE WHEN same_ THEN attempt_dependency_key END,attempt_tick_id=p_tick,attempted_at=clock_timestamp(),
  failure_count=CASE WHEN same_ THEN failure_count ELSE 0 END,retry_after=CASE WHEN same_ THEN retry_after END WHERE id=c.id;
 RETURN jsonb_build_object('status','claimed','case_id',c.id,'revision_id',r.id,'generation',c.private_generation,
  'structural_evaluation_id',p_evaluation,'worker_logic_key',key_,'preparation','pending');
END $$;

CREATE FUNCTION public.harness_operating_case_worker_prepare(p_tick uuid,p_case uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.harness_operating_cases; compiled jsonb; changed_ boolean; n integer; budget integer; state_ text;
BEGIN
 SELECT * INTO c FROM public.harness_operating_cases WHERE id=p_case;
 IF NOT FOUND OR p_tick IS NULL OR c.attempt_tick_id IS DISTINCT FROM p_tick
  OR public.harness_operating_case_worker_context(c.vehicle_id) IS DISTINCT FROM p_tick THEN
  RAISE EXCEPTION 'private preparation requires its committed existing worker attempt' USING ERRCODE='42501'; END IF;
 IF c.current_revision_id IS DISTINCT FROM c.attempt_revision_id OR c.private_generation IS DISTINCT FROM c.attempt_generation
  OR c.attempt_logic_key IS DISTINCT FROM public.harness_operating_case_worker_key() THEN
  RETURN jsonb_build_object('status','changed'); END IF;
 compiled:=public.harness_operating_case_compile(c.attempt_revision_id,c.attempt_structural_evaluation_id);
 IF compiled->'input_receipt' IS NULL OR compiled->>'private_input_hash' IS NULL THEN
  UPDATE public.harness_operating_cases SET attempt_tick_id=NULL,attempt_dependency_key=NULL,
   failure_count=0,retry_after=NULL WHERE id=c.id AND attempt_tick_id=p_tick
   AND current_revision_id=c.attempt_revision_id AND private_generation=c.attempt_generation;
  GET DIAGNOSTICS n=ROW_COUNT;
  RETURN jsonb_build_object('status',CASE WHEN n=1 THEN 'dependency_pending' ELSE 'changed' END);
 END IF;
 changed_:=c.attempt_dependency_key IS DISTINCT FROM compiled->>'private_input_hash';
 budget:=coalesce((public.model_fold_config()->>'max_attempts')::integer,5);
 state_:=CASE WHEN changed_ THEN 'ready' WHEN c.failure_count>=budget THEN 'budget_exhausted'
  WHEN c.retry_after>clock_timestamp() THEN 'backoff' ELSE 'ready' END;
 UPDATE public.harness_operating_cases SET attempt_dependency_key=compiled->>'private_input_hash',
  failure_count=CASE WHEN changed_ THEN 0 ELSE failure_count END,retry_after=CASE WHEN changed_ THEN NULL ELSE retry_after END,
  attempt_tick_id=CASE WHEN state_='ready' THEN attempt_tick_id END
  WHERE id=c.id AND attempt_tick_id=p_tick AND current_revision_id=c.attempt_revision_id AND private_generation=c.attempt_generation;
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN jsonb_build_object('status',CASE WHEN n=1 THEN state_ ELSE 'changed' END);
END $$;

DO $patch$
DECLARE b text; a text; z text;
BEGIN
 b:=pg_get_functiondef('public.harness_operating_case_worker_due(uuid,uuid)'::regprocedure);
 a:=$a$    AND (c.answered_generation IS DISTINCT FROM c.private_generation OR c.failure_count>0)$a$;
 z:=$z$    AND ((c.answered_generation IS DISTINCT FROM c.private_generation AND c.attempt_dependency_key IS NOT NULL)
     OR c.failure_count>0 OR (c.retry_after IS NOT NULL AND c.failure_count=0))$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Unprepared wait eligibility anchor drift'; END IF;
 EXECUTE replace(b,a,z);
 b:=pg_get_functiondef('public.harness_operating_case_worker_finish(uuid,uuid,jsonb)'::regprocedure);
 a:=$a$UPDATE public.harness_operating_cases SET attempt_tick_id=NULL,failure_count=0,retry_after=NULL WHERE id=c.id;$a$;
 z:=$z$UPDATE public.harness_operating_cases SET attempt_tick_id=NULL,failure_count=0,retry_after=at_ WHERE id=c.id;$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Changed-attempt fresh eligibility anchor drift'; END IF;b:=replace(b,a,z);
 a:=$a$UPDATE public.harness_operating_cases SET attempt_tick_id=NULL,failure_count=0,retry_after=NULL,
   answered_generation=$a$;
 z:=$z$UPDATE public.harness_operating_cases SET attempt_tick_id=NULL,failure_count=0,retry_after=CASE WHEN good THEN NULL ELSE at_ END,
   answered_generation=$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Historical-result fresh eligibility anchor drift'; END IF;
 EXECUTE replace(b,a,z);
 b:=pg_get_functiondef('public.harness_operating_case_source_guard()'::regprocedure);
 a:=$a$   OR NEW.attempt_dependency_key IS NULL OR NEW.attempt_dependency_key !~ '^[0-9a-f]{32}$'$a$;
 z:=$z$   OR (NEW.attempt_dependency_key IS NOT NULL AND NEW.attempt_dependency_key !~ '^[0-9a-f]{32}$')$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Unprepared durable context anchor drift'; END IF;
 EXECUTE replace(b,a,z);
 b:=pg_get_functiondef('public.harness_operating_case_worker_key()'::regprocedure);
 a:=$a$    'public.harness_operating_case_source_guard()'$a$;
 z:=$z$    'public.harness_operating_case_source_guard()',
    'public.harness_operating_case_worker_prepare(uuid,uuid)',
    'public.harness_operating_case_worker_parent(uuid)',
    'public.harness_operating_case_worker_vehicle_due(uuid)',
    'public.harness_operating_case_worker_enqueue_changed()'$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Preparation worker identity anchor drift'; END IF;
 EXECUTE replace(b,a,z);
END $patch$;

CREATE OR REPLACE FUNCTION public.harness_operating_case_worker_enqueue_changed()
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE n integer; cfg jsonb:=public.model_fold_config();
BEGIN
 IF NOT coalesce((cfg->>'enabled')::boolean,false) OR NOT coalesce((cfg->>'signals_enabled')::boolean,false) THEN RETURN 0; END IF;
 INSERT INTO public.model_fold_signal(vehicle_id,reason,priority,at)
 SELECT c.vehicle_id,'harness_operating_case_changed',3,
  clock_timestamp()-make_interval(secs=>greatest(0,coalesce((cfg->>'settle_seconds')::integer,0)))
 FROM public.harness_operating_cases c
 WHERE public.harness_model_in_scope(c.vehicle_id) AND public.harness_operating_case_worker_vehicle_due(c.vehicle_id)
  AND NOT EXISTS(SELECT FROM public.model_fold_signal s WHERE s.vehicle_id=c.vehicle_id)
  AND NOT EXISTS(SELECT FROM public.model_fold_work w WHERE w.vehicle_id=c.vehicle_id AND w.state IN('pending','leased','dead'))
 GROUP BY c.vehicle_id ORDER BY min(coalesce(c.attempted_at,c.generation_changed_at)),c.vehicle_id
 LIMIT greatest(1,coalesce((cfg->>'max_vehicles')::integer,1));
 GET DIAGNOSTICS n=ROW_COUNT;RETURN n;
END $$;

ALTER TABLE public.model_fold_tick_runs DROP CONSTRAINT model_fold_tick_runs_dc_status_check,
 ADD CONSTRAINT model_fold_tick_runs_dc_status_check CHECK(dc_status IN('solved','held','indeterminate','inconsistent','numerical_failure',
  'reused','changed','failed','dependency_pending','backoff','budget_exhausted'));

DO $patch$
DECLARE b text:=pg_get_functiondef('public.model_fold_tick()'::regprocedure); a text; z text;
BEGIN
 a:=$a$  v_dc_started timestamptz; v_dc_error text;$a$;z:=a||' v_dc_prepared jsonb;';
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Preparation variable anchor drift'; END IF;b:=replace(b,a,z);
 a:=$a$        if EXISTS(select from public.harness_operating_cases c where c.id=v_dc_case$a$;
 z:=$z$        v_dc_prepared:=public.harness_operating_case_worker_prepare(v_tick,v_dc_case);
        if v_dc_prepared->>'status' IN('dependency_pending','backoff','budget_exhausted') then
          v_dc_finish:=v_dc_prepared;
        elsif v_dc_prepared->>'status'='changed' then
          v_dc_finish:=public.harness_operating_case_worker_finish(v_tick,v_dc_case,'{"changed":true}');
        else
        if EXISTS(select from public.harness_operating_cases c where c.id=v_dc_case$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Preparation dispatch anchor drift'; END IF;b:=replace(b,a,z);
 a:=$a$        insert into public.model_fold_tick_runs(tick_id,vehicle_id,fold_phase,dc_status,dc_output_retained,ms)$a$;
 z:=$z$        end if;
        insert into public.model_fold_tick_runs(tick_id,vehicle_id,fold_phase,dc_status,dc_output_retained,ms)$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Preparation closure anchor drift'; END IF;b:=replace(b,a,z);
 a:=$a$case when v_dc_finish->>'status'='changed' then 'changed' else r->>'status' end$a$;
 z:=$z$case when v_dc_finish->>'status' IN('changed','dependency_pending','backoff','budget_exhausted') then v_dc_finish->>'status' else r->>'status' end$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Preparation telemetry anchor drift'; END IF;b:=replace(b,a,z);
 EXECUTE b;
END $patch$;

DO $patch$
DECLARE b text:=pg_get_functiondef('public.harness_operating_case_evaluate(uuid,uuid)'::regprocedure); a text; z text;
BEGIN
 a:=$a$ SELECT id INTO existing_ FROM public.harness_model_dc_runs WHERE revision_id=c.current_revision_id$a$;
 z:=$z$ IF public.harness_operating_case_worker_context(c.vehicle_id) IS NOT NULL AND
  (c.attempt_tick_id IS DISTINCT FROM public.harness_operating_case_worker_context(c.vehicle_id)
   OR c.attempt_revision_id IS DISTINCT FROM c.current_revision_id OR c.attempt_generation IS DISTINCT FROM c.private_generation
   OR c.attempt_structural_evaluation_id IS DISTINCT FROM p_evaluation OR c.attempt_scope_key IS DISTINCT FROM compiled#>>'{input_receipt,scope_key}'
   OR c.attempt_dependency_key IS DISTINCT FROM compiled->>'private_input_hash'
   OR c.attempt_logic_key IS DISTINCT FROM public.harness_operating_case_worker_key()) THEN
  RETURN jsonb_build_object('status','dependency_changed','run_id',NULL,'qualification','conditional_simulation_only'); END IF;
 SELECT id INTO existing_ FROM public.harness_model_dc_runs WHERE revision_id=c.current_revision_id$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Prepared evaluator context anchor drift'; END IF;
 EXECUTE replace(b,a,z);
END $patch$;

COMMENT ON COLUMN public.harness_operating_cases.attempt_dependency_key IS
 'Last successfully prepared full private input hash for this exact attempt identity. NULL means source compilation has not produced a bounded receipt. It is never an answered-generation or source-qualification claim.';
REVOKE ALL ON FUNCTION public.harness_operating_case_worker_prepare(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;


-- Reviewed module: supabase/sql/harness_operating_case/worker_recovery.sql
SET LOCAL statement_timeout='10s';SET LOCAL lock_timeout='2s';

CREATE FUNCTION public.harness_operating_case_worker_recover(p_tick uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE ctx text; frame_ text; w record; c public.harness_operating_cases; n integer:=0; at_ timestamptz:=clock_timestamp();
BEGIN
 GET DIAGNOSTICS ctx=PG_CONTEXT;
 frame_:=regexp_replace(regexp_replace(ctx,E'[\n\r]+$',''),E'^.*\n','','s');
 IF p_tick IS NULL OR frame_ !~ '^PL/pgSQL function (public\.)?model_fold_tick\(\) line [0-9]+ at [^\n]+$'
  OR NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=to_regprocedure('public.model_fold_tick()') AND p.prokind='p'
   AND p.proowner=current_user::regrole)
  OR NOT EXISTS(SELECT FROM public.model_fold_ticks t WHERE t.tick_id=p_tick AND t.status='running' AND t.pid=pg_backend_pid()) THEN
  RAISE EXCEPTION 'private recovery requires the actual new existing tick' USING ERRCODE='42501'; END IF;
 FOR w IN SELECT q.* FROM public.model_fold_work q LEFT JOIN public.model_fold_ticks old ON old.tick_id=q.lease_tick
  WHERE q.state='leased' AND (old.status='stale' OR q.leased_until<clock_timestamp()) AND EXISTS(SELECT FROM public.harness_operating_cases x
   WHERE x.vehicle_id=q.vehicle_id AND x.attempt_tick_id=q.lease_tick)
  ORDER BY q.vehicle_id FOR UPDATE OF q SKIP LOCKED LOOP
  FOR c IN SELECT * FROM public.harness_operating_cases x WHERE x.vehicle_id=w.vehicle_id AND x.attempt_tick_id=w.lease_tick
   ORDER BY x.id FOR UPDATE LOOP
   UPDATE public.harness_operating_cases SET attempt_tick_id=NULL,failure_count=failure_count+1,
    retry_after=at_+make_interval(secs=>least(3600,60*power(2,least(failure_count+1,6))::integer)) WHERE id=c.id;
   INSERT INTO public.model_fold_tick_runs(tick_id,vehicle_id,fold_phase,dc_status,dc_output_retained)
    VALUES(p_tick,c.vehicle_id,'dc','abandoned',false);
   n:=n+1;
  END LOOP;
  -- This vehicle lease counted one generic attempt, even if inconsistent
  -- historical controller rows named it more than once. Undo it only once.
  UPDATE public.model_fold_work SET state='pending',fold_stage='vehicle_followup',attempts=greatest(0,attempts-1),
   leased_until=NULL,lease_tick=NULL,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp()
   WHERE vehicle_id=w.vehicle_id AND state='leased' AND lease_tick=w.lease_tick;
  IF NOT FOUND THEN RAISE EXCEPTION 'private abandoned lease changed during recovery' USING ERRCODE='40001'; END IF;
 END LOOP;
 RETURN n;
END $$;

ALTER TABLE public.model_fold_tick_runs DROP CONSTRAINT model_fold_tick_runs_dc_status_check,
 ADD CONSTRAINT model_fold_tick_runs_dc_status_check CHECK(dc_status IN('solved','held','indeterminate','inconsistent','numerical_failure',
  'reused','changed','failed','dependency_pending','backoff','budget_exhausted','abandoned'));

DO $patch$
DECLARE b text:=pg_get_functiondef('public.harness_operating_case_source_guard()'::regprocedure); a text; z text;
BEGIN
 a:='DECLARE c text; writer_frame text;';z:=a||' recovery_lines_ text[]; recovery_frame_ text;';
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Recovery guard declaration anchor drift'; END IF;b:=replace(b,a,z);
 a:=$a$ IF TG_TABLE_NAME='harness_operating_cases' AND TG_OP='UPDATE'
  AND public.harness_operating_case_worker_context(NEW.vehicle_id) IS NOT NULL THEN$a$;
 z:=$z$ IF TG_TABLE_NAME='harness_operating_cases' AND TG_OP='UPDATE' THEN
  GET DIAGNOSTICS c=PG_CONTEXT;
  recovery_lines_:=string_to_array(rtrim(c,chr(10)||chr(13)),chr(10));
  writer_frame:=recovery_lines_[cardinality(recovery_lines_)];recovery_frame_:=recovery_lines_[cardinality(recovery_lines_)-1];
  IF coalesce(writer_frame ~ '^PL/pgSQL function (public\.)?model_fold_tick\(\) line [0-9]+ at [^\n]+$'
   AND recovery_frame_ ~ '^PL/pgSQL function (public\.)?harness_operating_case_worker_recover\(uuid\) line [0-9]+ at SQL statement$'
   AND EXISTS(SELECT FROM pg_proc p WHERE p.oid=to_regprocedure('public.harness_operating_case_worker_recover(uuid)')
    AND p.prosecdef AND p.proowner=current_user::regrole)
   AND EXISTS(SELECT FROM pg_proc p WHERE p.oid=to_regprocedure('public.model_fold_tick()')
    AND p.prokind='p' AND p.proowner=current_user::regrole)
   AND EXISTS(SELECT FROM public.model_fold_ticks t WHERE t.status='running' AND t.pid=pg_backend_pid()),false) THEN
   IF OLD.attempt_tick_id IS NULL OR NEW.attempt_tick_id IS NOT NULL OR NEW.failure_count<>OLD.failure_count+1
    OR NEW.retry_after IS NULL OR NOT isfinite(NEW.retry_after) OR NEW.retry_after<=clock_timestamp()
    OR (to_jsonb(NEW)-ARRAY['attempt_tick_id','failure_count','retry_after'])
     IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['attempt_tick_id','failure_count','retry_after'])
    OR NOT EXISTS(SELECT FROM public.model_fold_work w LEFT JOIN public.model_fold_ticks t ON t.tick_id=w.lease_tick
     WHERE w.vehicle_id=OLD.vehicle_id AND w.state='leased' AND w.lease_tick=OLD.attempt_tick_id
      AND (t.status='stale' OR w.leased_until<clock_timestamp())) THEN
    RAISE EXCEPTION 'recovery can only charge its exact abandoned attempt once' USING ERRCODE='23514'; END IF;
   RETURN NEW;
  END IF;
 END IF;
 IF TG_TABLE_NAME='harness_operating_cases' AND TG_OP='UPDATE'
  AND public.harness_operating_case_worker_context(NEW.vehicle_id) IS NOT NULL THEN$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Recovery source guard anchor drift'; END IF;
 EXECUTE replace(b,a,z);
END $patch$;

DO $patch$
DECLARE b text:=pg_get_functiondef('public.model_fold_tick()'::regprocedure); a text; z text;
BEGIN
 a:=$a$  v_dc_started timestamptz; v_dc_error text; v_dc_prepared jsonb;$a$;
 z:=a||' v_dc_staled uuid[]; v_dc_recovered integer;';
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Recovery tick declaration anchor drift'; END IF;b:=replace(b,a,z);
 a:=$a$  with st as (update public.model_fold_ticks set status = 'stale', finished_at = clock_timestamp(),
                     error = coalesce(error, 'tick ended without finishing (timeout or cancel)')
               where status = 'running' returning tick_id)
  update public.model_fold_work w set state = case when w.attempts >= v_maxatt then 'dead' else 'pending' end,
         next_attempt_at = now() + make_interval(secs => least(3600, 60 * power(2, w.attempts)::int)),
         leased_until = null, lease_tick = null, last_error = 'tick ended while folding this vehicle (timeout or cancel)', updated_at = now()
    from st where w.state = 'leased' and w.lease_tick = st.tick_id;
  insert into public.model_fold_ticks (tick_id, status, pid) values (v_tick, 'running', pg_backend_pid());$a$;
 z:=$z$  with st as (update public.model_fold_ticks set status='stale',finished_at=clock_timestamp(),
      error=coalesce(error,'tick ended without finishing (timeout or cancel)') where status='running' returning tick_id)
  select coalesce(array_agg(tick_id),'{}'::uuid[]) into v_dc_staled from st;
  insert into public.model_fold_ticks(tick_id,status,pid) values(v_tick,'running',pg_backend_pid());
  v_dc_recovered:=public.harness_operating_case_worker_recover(v_tick);
  update public.model_fold_work w set state=case when w.attempts>=v_maxatt then 'dead' else 'pending' end,
   next_attempt_at=now()+make_interval(secs=>least(3600,60*power(2,w.attempts)::int)),leased_until=NULL,lease_tick=NULL,
   last_error='tick ended while folding this vehicle (timeout or cancel)',updated_at=now()
   from unnest(v_dc_staled) st(tick_id) where w.state='leased' AND w.lease_tick=st.tick_id;$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Recovery stale work anchor drift'; END IF;
 b:=replace(b,a,z);
 a:=$a$       where w.state = 'leased' and w.lease_tick = v_stuck.tick_id;$a$;
 z:=$z$       where w.state = 'leased' and w.lease_tick = v_stuck.tick_id
        AND NOT EXISTS(select from public.harness_operating_cases c where c.vehicle_id=w.vehicle_id AND c.attempt_tick_id=w.lease_tick);$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Private stuck lease preservation anchor drift'; END IF;b:=replace(b,a,z);
 a:=$a$  -- Leases left by a tick that died: back to pending (their attempt already counted).$a$;
 z:=$z$  v_dc_recovered:=public.harness_operating_case_worker_recover(v_tick);
  -- Leases left by a tick that died: back to pending (their attempt already counted).$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Private expired lease recovery anchor drift'; END IF;b:=replace(b,a,z);
 a:=$a$   where state = 'leased' and leased_until < now();$a$;
 z:=$z$   where state = 'leased' and leased_until < now()
    AND NOT EXISTS(select from public.harness_operating_cases c where c.vehicle_id=model_fold_work.vehicle_id
     AND c.attempt_tick_id=model_fold_work.lease_tick);$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Private expired lease preservation anchor drift'; END IF;
 EXECUTE replace(b,a,z);

END $patch$;

DO $patch$
DECLARE b text:=pg_get_functiondef('public.harness_operating_case_worker_key()'::regprocedure);
 a text:=$a$    'public.harness_operating_case_worker_enqueue_changed()'$a$;
 z text:=$z$    'public.harness_operating_case_worker_enqueue_changed()',
    'public.harness_operating_case_worker_recover(uuid)'$z$;
BEGIN
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Recovery worker identity anchor drift'; END IF;
 EXECUTE replace(b,a,z);
END $patch$;

REVOKE ALL ON FUNCTION public.harness_operating_case_worker_recover(uuid) FROM PUBLIC,anon,authenticated,service_role;


-- Reviewed module: supabase/sql/harness_operating_case/worker_consumers.sql
SET LOCAL statement_timeout='10s';SET LOCAL lock_timeout='2s';
DO $patch$
DECLARE b text; a text; z text;
BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.model_fold_queue_gauge()'::regprocedure)<>'9d91e6fedde95ebea7d00d65a43f9e05'
  OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.model_fold_revert_v1(uuid)'::regprocedure)<>'9cf4d876c950d452db3b6bfefc42dd99'
  OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.model_fold_revert_since(timestamptz)'::regprocedure)<>'4d8bc1ae987c64af20f106626f98af22' THEN
  RAISE EXCEPTION 'Retained worker consumer definitions changed; review current owners before applying'; END IF;
 b:=pg_get_functiondef('public.model_fold_queue_gauge()'::regprocedure);
 a:=$a$    'counted_at', now())$a$;
 z:=$z$    'private_dc_phases_24h',(SELECT jsonb_build_object('scope','conditional_private_interpretation_not_build_readiness',
      'runs',count(*),'solved',count(*) FILTER(WHERE dc_status='solved'),
      'held',count(*) FILTER(WHERE dc_status='held'),'reused',count(*) FILTER(WHERE dc_status='reused'),
      'changed',count(*) FILTER(WHERE dc_status='changed'),'waiting',count(*) FILTER(WHERE dc_status='dependency_pending'),
      'failed',count(*) FILTER(WHERE dc_status='failed'),'abandoned',count(*) FILTER(WHERE dc_status='abandoned'),
      'backoff',count(*) FILTER(WHERE dc_status IN('backoff','budget_exhausted')),
      'outputs_retained',count(*) FILTER(WHERE dc_output_retained),'ms_avg',round(avg(ms)),'newest_at',max(at))
      FROM public.model_fold_tick_runs WHERE fold_phase='dc' AND at>now()-interval '24 hours'),
    'counted_at', now())$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'DC gauge owner anchor drift'; END IF;
 EXECUTE replace(b,a,z);

 b:=pg_get_functiondef('public.model_fold_revert_v1(uuid)'::regprocedure);
 FOR a,z IN SELECT * FROM(VALUES
 ($a$n_harness_retained int := 0;$a$,$z$n_harness_retained int := 0; n_dc_retained int := 0;$z$),
 ($a$  select count(*) into n_harness_retained from public.model_fold_tick_runs where tick_id=p_tick AND fold_phase='harness';$a$,
  $z$  select count(*) into n_harness_retained from public.model_fold_tick_runs where tick_id=p_tick AND fold_phase='harness';
  select count(*) into n_dc_retained from public.model_fold_tick_runs where tick_id=p_tick AND fold_phase='dc';$z$),
 ($a$n_runs>0 OR n_harness_retained=0$a$,$z$n_harness_retained=0 AND n_dc_retained=0$z$),
 ($a$'harness_receipts_retained',n_harness_retained$a$,
  $z$'harness_receipts_retained',n_harness_retained,'private_dc_phases_retained',n_dc_retained,
          'revert_complete',n_harness_retained=0 AND n_dc_retained=0$z$)
 ) p(old,new) LOOP
  IF (length(b)-length(replace(b,a,'')))/length(a)<>(CASE WHEN a IN('n_runs>0 OR n_harness_retained=0',
   '''harness_receipts_retained'',n_harness_retained') THEN 2 ELSE 1 END) THEN
   RAISE EXCEPTION 'DC revert owner anchor drift: %',left(a,80); END IF;
  b:=replace(b,a,z);
 END LOOP;
 EXECUTE b;

 b:=pg_get_functiondef('public.model_fold_revert_since(timestamptz)'::regprocedure);
 a:=$a$  return jsonb_build_object('ticks', jsonb_array_length(out), 'detail', out);$a$;
 z:=$z$  return jsonb_build_object('ticks',jsonb_array_length(out),'detail',out,
    'ticks_fully_reverted',(SELECT count(*) FROM jsonb_array_elements(out) x WHERE x->>'revert_complete'='true'),
    'ticks_with_retained_domain_outputs',(SELECT count(*) FROM jsonb_array_elements(out) x WHERE x->>'revert_complete'='false'));$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'DC bulk revert summary anchor drift'; END IF;
 EXECUTE replace(b,a,z);
END $patch$;


-- Reviewed module: supabase/sql/harness_operating_case/worker_callers.sql
SET LOCAL statement_timeout='10s';SET LOCAL lock_timeout='2s';
-- The pre-lease selection is only an eligibility hint. The existing guarded
-- DEFINER claim locks the selected case and rechecks its current recipe and
-- eligibility after the real vehicle lease is acquired. A pre-lease row lock
-- unnecessarily required direct UPDATE permission on the private case table.
DO $patch$
DECLARE b text:=pg_get_functiondef('public.model_fold_tick()'::regprocedure);
 a text:=$a$          order by c.attempted_at NULLS FIRST,c.generation_changed_at,c.id limit 1 for update skip locked;$a$;
 z text:=$z$          order by c.attempted_at NULLS FIRST,c.generation_changed_at,c.id limit 1;$z$;
BEGIN
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Private eligibility selection caller anchor drift'; END IF;
 EXECUTE replace(b,a,z);
 b:=pg_get_functiondef('public.harness_operating_case_worker_claim(uuid,uuid,uuid)'::regprocedure);
 a:=$a$ SELECT * INTO c FROM public.harness_operating_cases WHERE id=p_case FOR UPDATE;$a$;
 z:=$z$ SELECT * INTO c FROM public.harness_operating_cases WHERE id=p_case;$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Private claim context lookup anchor drift'; END IF;b:=replace(b,a,z);
 a:=$a$  RAISE EXCEPTION 'private case claim requires its active existing worker lease' USING ERRCODE='42501'; END IF;$a$;
 z:=a||$z$
 -- A concurrent author may hold the recipe head. Never wait or consume a
 -- private attempt before the protected calculation phase.
 SELECT * INTO c FROM public.harness_operating_cases WHERE id=p_case FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','contended'); END IF;$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Private claim skip-locked anchor drift'; END IF;
 EXECUTE replace(b,a,z);
 b:=pg_get_functiondef('public.model_fold_tick()'::regprocedure);
 a:=$a$      v_dc_phase:=v_dc_claim->>'status'='claimed';$a$;
 z:=a||$z$
      -- Give generic work one normal turn, then yield this vehicle instead
      -- of repeatedly selecting its same temporarily locked private case.
      if v_dc_claim->>'status'='contended' then v_stage:='vehicle_followup';end if;$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Contended claim followup anchor drift'; END IF;
 EXECUTE replace(b,a,z);
END $patch$;
GRANT EXECUTE ON FUNCTION public.harness_operating_case_worker_context(uuid),
 public.harness_operating_case_worker_key(),public.harness_operating_case_worker_due(uuid,uuid),
 public.harness_operating_case_worker_claim(uuid,uuid,uuid),public.harness_operating_case_worker_finish(uuid,uuid,jsonb),
 public.harness_operating_case_worker_prepare(uuid,uuid),public.harness_operating_case_worker_parent(uuid),
 public.harness_operating_case_worker_vehicle_due(uuid),public.harness_operating_case_worker_enqueue_changed(),
 public.harness_operating_case_worker_recover(uuid) TO service_role;
-- No PUBLIC, anonymous or authenticated grants; no table mutation grant.


-- Reviewed module: supabase/sql/harness_operating_case/worker_prepared_commit.sql
SET LOCAL statement_timeout='10s';SET LOCAL lock_timeout='2s';
DO $patch$
DECLARE b text:=pg_get_functiondef('public.model_fold_tick()'::regprocedure); a text; z text;
BEGIN
 a:=$a$    begin
      if v_dc_phase then
        v_dc_started:=clock_timestamp();r:=NULL;
        v_dc_prepared:=public.harness_operating_case_worker_prepare(v_tick,v_dc_case);
        if v_dc_prepared->>'status' IN('dependency_pending','backoff','budget_exhausted') then
          v_dc_finish:=v_dc_prepared;
        elsif v_dc_prepared->>'status'='changed' then
          v_dc_finish:=public.harness_operating_case_worker_finish(v_tick,v_dc_case,'{"changed":true}');
        else
        if EXISTS(select from public.harness_operating_cases c where c.id=v_dc_case$a$;
 z:=$z$    if v_dc_phase then
      v_dc_started:=clock_timestamp();r:=NULL;v_dc_error:=NULL;
      begin
        v_dc_prepared:=public.harness_operating_case_worker_prepare(v_tick,v_dc_case);
        if v_dc_prepared->>'status' IS DISTINCT FROM 'ready' then
          if v_dc_prepared->>'status'='changed' then
            v_dc_finish:=public.harness_operating_case_worker_finish(v_tick,v_dc_case,'{"changed":true}');
          else v_dc_finish:=v_dc_prepared;end if;
          insert into public.model_fold_tick_runs(tick_id,vehicle_id,fold_phase,dc_status,dc_output_retained,ms)
           values(v_tick,v_veh,'dc',v_dc_finish->>'status',false,
            round(extract(epoch from clock_timestamp()-v_dc_started)*1000)::integer);
          update public.model_fold_work set state='pending',fold_stage='vehicle_followup',attempts=greatest(0,attempts-1),
           leased_until=NULL,lease_tick=NULL,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp() where vehicle_id=v_veh;
        end if;
      exception when others then
        get stacked diagnostics v_dc_error=returned_sqlstate;
        v_dc_finish:=public.harness_operating_case_worker_finish(v_tick,v_dc_case,jsonb_build_object('sqlstate',v_dc_error));
        v_dc_prepared:=jsonb_build_object('status','failed','sqlstate',v_dc_error);
        insert into public.model_fold_tick_runs(tick_id,vehicle_id,fold_phase,dc_status,dc_error_code,dc_output_retained,ms)
         values(v_tick,v_veh,'dc','failed',v_dc_error,false,
          round(extract(epoch from clock_timestamp()-v_dc_started)*1000)::integer);
        update public.model_fold_work set state='pending',fold_stage='vehicle_followup',attempts=greatest(0,attempts-1),
         leased_until=NULL,lease_tick=NULL,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp() where vehicle_id=v_veh;
        n_fail:=n_fail+1;
      end;
      -- Ready retains its active case token and original work lease; every
      -- other outcome commits its cursor, telemetry and lease release together.
      commit;
    end if;
    begin
      if v_dc_phase then
        if v_dc_prepared->>'status'='ready' then
        if EXISTS(select from public.harness_operating_cases c where c.id=v_dc_case$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Durable preparation phase anchor drift'; END IF;b:=replace(b,a,z);
 a:=$a$        end if;
        insert into public.model_fold_tick_runs(tick_id,vehicle_id,fold_phase,dc_status,dc_output_retained,ms)$a$;
 z:=$z$        insert into public.model_fold_tick_runs(tick_id,vehicle_id,fold_phase,dc_status,dc_output_retained,ms)$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Ready-only output phase anchor drift'; END IF;b:=replace(b,a,z);
 a:=$a$         leased_until=NULL,lease_tick=NULL,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp() where vehicle_id=v_veh;
      elsif v_harness_phase then$a$;
 z:=$z$         leased_until=NULL,lease_tick=NULL,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp() where vehicle_id=v_veh;
        end if;
      elsif v_harness_phase then$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Ready-only followup phase anchor drift'; END IF;
 EXECUTE replace(b,a,z);
END $patch$;


-- Reviewed module: supabase/sql/harness_operating_case/worker_pending_identity.sql
SET LOCAL statement_timeout='10s';SET LOCAL lock_timeout='2s';
DO $patch$
DECLARE b text:=pg_get_functiondef('public.harness_operating_case_worker_prepare(uuid,uuid)'::regprocedure);
 a text:=$a$  UPDATE public.harness_operating_cases SET attempt_tick_id=NULL,attempt_dependency_key=NULL,
   failure_count=0,retry_after=NULL WHERE id=c.id AND attempt_tick_id=p_tick$a$;
 z text:=$z$  UPDATE public.harness_operating_cases SET attempt_tick_id=NULL,
   retry_after=greatest(coalesce(retry_after,'-infinity'::timestamptz),clock_timestamp()+interval '15 minutes')
   WHERE id=c.id AND attempt_tick_id=p_tick$z$;
BEGIN
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Pending preparation identity anchor drift'; END IF;
 EXECUTE replace(b,a,z);
END $patch$;


-- Reviewed module: supabase/sql/harness_operating_case/metadata.sql
SET LOCAL statement_timeout='10s';SET LOCAL lock_timeout='2s';
COMMENT ON COLUMN public.harness_operating_cases.id IS 'Stable private conditional-case UUID. One identity/control cursor per vehicle and case_code; not a queue or independent lease.';
COMMENT ON COLUMN public.harness_operating_cases.vehicle_id IS 'Existing vehicle key. Scope and foreign edges must remain within this vehicle; this module creates no vehicle or source graph.';
COMMENT ON COLUMN public.harness_operating_cases.case_code IS 'Stable case label unique within its vehicle. It identifies an analytical case, not a configuration or physical build event.';
COMMENT ON COLUMN public.harness_operating_cases.current_revision_id IS 'Current immutable authored recipe head. Changed only by the sanctioned writer using expected-head comparison.';
COMMENT ON COLUMN public.harness_operating_cases.private_generation IS 'Private recipe-generation counter. It is isolated from the public structural source epoch.';
COMMENT ON COLUMN public.harness_operating_cases.answered_generation IS 'Most recent recipe generation answered by a matching closed run under a genuine worker attempt. NULL means never answered.';
COMMENT ON COLUMN public.harness_operating_cases.latest_run_id IS 'Most recently answered immutable run for this case and vehicle. Readers still recheck dependencies and logic before showing numbers.';
COMMENT ON COLUMN public.harness_operating_cases.attempt_revision_id IS 'Recipe revision durably selected before compilation in the existing worker lease.';
COMMENT ON COLUMN public.harness_operating_cases.attempt_structural_evaluation_id IS 'Existing structural evaluation durably selected for this attempt, constrained to the same vehicle.';
COMMENT ON COLUMN public.harness_operating_cases.attempt_scope_key IS 'Exact selected recipe scope captured before compilation. NULL means no attempt scope yet.';
COMMENT ON COLUMN public.harness_operating_cases.attempt_generation IS 'Private generation captured by the existing worker before calculation. It cannot advance the authored generation.';
COMMENT ON COLUMN public.harness_operating_cases.attempt_dependency_key IS 'Last fully prepared private input MD5, retained during temporary dependency unavailability. NULL means no complete dependency has been prepared for this attempt identity, never an invented hash. Retention does not establish current qualification; readers recheck the current receipt.';
COMMENT ON COLUMN public.harness_operating_cases.attempt_logic_key IS 'Composite calculation and existing worker-definition MD5 used for attempt eligibility and budget invalidation.';
COMMENT ON COLUMN public.harness_operating_cases.attempt_tick_id IS 'Existing model_fold_tick token for the active private attempt. Validated against that backend and live vehicle lease; no new lease owner.';
COMMENT ON COLUMN public.harness_operating_cases.attempted_at IS 'Database clock of last worker selection or bounded eligibility probe. Used for the existing private recheck interval.';
COMMENT ON COLUMN public.harness_operating_cases.failure_count IS 'Private computational failures for the retained revision, generation, structural evaluation and interpreter attempt identity, with the last prepared input hash when available. Includes visible failed periodic preparation probes, so this is not a numerical evaluator-entry counter. Preparation can fail before a dependency hash exists. Normal held results and contention consume no private failure; an unchanged exhausted numerical input is not renewed by a probe.';
COMMENT ON COLUMN public.harness_operating_cases.retry_after IS 'Private retry eligibility clock. A failed computation backs off; missing qualification retains accounting and schedules the existing bounded freshness wait; a known changed dependency can schedule a fresh attempt. NULL is not a completed preparation.';
COMMENT ON COLUMN public.harness_operating_cases.recorded_by_agent_key IS 'Attributed implementing agent key, not an owner signature, authenticated user UUID or engineering decision.';
COMMENT ON COLUMN public.harness_operating_cases.recorded_at IS 'Immutable database creation clock of the stable case identity. Its recipe head and controller fields can advance through sanctioned writers; this clock is not a recipe authorship or physical measurement time.';
COMMENT ON COLUMN public.harness_operating_cases.generation_changed_at IS 'Database clock when the sanctioned authoring writer advanced the private recipe head. Passive seeding must not refresh this clock.';
COMMENT ON COLUMN public.harness_operating_case_revisions.id IS 'Immutable recipe-revision UUID, scoped to exactly one case and vehicle.';
COMMENT ON COLUMN public.harness_operating_case_revisions.case_id IS 'Private operating-case identity. Revision and result edges are constrained to the same case and vehicle.';
COMMENT ON COLUMN public.harness_operating_case_revisions.vehicle_id IS 'Existing vehicle key. Scope and foreign edges must remain within this vehicle; this module creates no vehicle or source graph.';
COMMENT ON COLUMN public.harness_operating_case_revisions.revision_number IS 'Monotonically increasing authored revision number within its case.';
COMMENT ON COLUMN public.harness_operating_case_revisions.prior_revision_id IS 'Previous recipe head in the same case and vehicle; NULL only for the first recipe.';
COMMENT ON COLUMN public.harness_operating_case_revisions.reference_termination_id IS 'Explicit selected physical end whose structural node is the voltage reference. No implicit chassis ground is introduced.';
COMMENT ON COLUMN public.harness_operating_case_revisions.recipe_hash IS 'Server-derived MD5 of the complete normalized recipe and typed children, verified again by compilation.';
COMMENT ON COLUMN public.harness_operating_case_revisions.scope_key IS 'Server-derived MD5 of the selected physical piece and attachment scope. Caller text never grants scope authority.';
COMMENT ON COLUMN public.harness_operating_case_revisions.requested_state IS 'Authored enabled, disabled or draft state. Only sealed enabled current recipes are eligible for numerical work.';
COMMENT ON COLUMN public.harness_operating_case_revisions.parameter_basis IS 'Explicit conditional_assumption. Analytical parameter declaration does not establish installed applicability or release.';
COMMENT ON COLUMN public.harness_operating_case_revisions.expected_wire_count IS 'Declared complete recipe wire-child count, bounded to eight and verified at closure.';
COMMENT ON COLUMN public.harness_operating_case_revisions.expected_element_count IS 'Declared complete recipe analytical-element count, bounded to thirty-two and verified at closure.';
COMMENT ON COLUMN public.harness_operating_case_revisions.expected_boundary_count IS 'Declared complete recipe boundary-child count, bounded to sixteen and verified at closure.';
COMMENT ON COLUMN public.harness_operating_case_revisions.recorded_by_agent_key IS 'Attributed implementing agent key, not an owner signature, authenticated user UUID or engineering decision.';
COMMENT ON COLUMN public.harness_operating_case_revisions.method_version IS 'Agent authoring method/version attribution. It does not confer source, owner or engineering authority.';
COMMENT ON COLUMN public.harness_operating_case_revisions.authored_at IS 'Finite authored clock supplied by the recipe writer, retained separately from database recording and seal clocks.';
COMMENT ON COLUMN public.harness_operating_case_revisions.recorded_at IS 'Database capture clock for this immutable row, distinct from the recipe author clock and physical measurement time.';
COMMENT ON COLUMN public.harness_operating_case_revisions.sealed_at IS 'Database closure clock, set once after exact child counts, identities and hashes validate. Unsealed parents are never useful results.';
COMMENT ON COLUMN public.harness_operating_case_wires.revision_id IS 'Exact complete authored recipe revision. Sealed recipe children are immutable and same-case/same-vehicle qualified.';
COMMENT ON COLUMN public.harness_operating_case_wires.case_id IS 'Private operating-case identity. Revision and result edges are constrained to the same case and vehicle.';
COMMENT ON COLUMN public.harness_operating_case_wires.vehicle_id IS 'Existing vehicle key. Scope and foreign edges must remain within this vehicle; this module creates no vehicle or source graph.';
COMMENT ON COLUMN public.harness_operating_case_wires.segment_id IS 'Existing physical wire-piece key. Logical circuit identity alone cannot identify this wire or its two ends.';
COMMENT ON COLUMN public.harness_operating_case_wires.wire_state IS 'Explicit assumed open, closed or unknown wire/contact state. Unknown holds numerical compilation; not a physical continuity test.';
COMMENT ON COLUMN public.harness_operating_case_wires.resistance_basis IS 'Direct analytical assumption, selected conditioned source reference or unresolved. No inferred zero resistance or family default.';
COMMENT ON COLUMN public.harness_operating_case_wires.direct_resistance_ohm IS 'Explicit analytical resistance in ohms, bounded to the numerical kernel domain. Not a measured wire property.';
COMMENT ON COLUMN public.harness_operating_case_wires.resistance_claim_observation_id IS 'Existing conditioned resistance-claim observation key. Its source and condition must qualify in the current statement; not a copied numerical claim.';
COMMENT ON COLUMN public.harness_operating_case_wires.length_basis IS 'Explicit planned_gross, measured, design_override, unresolved or not_used basis. Planned allowances cannot become cut or purchase quantities.';
COMMENT ON COLUMN public.harness_operating_case_wires.design_length_m IS 'Explicit assumed wire length in metres for design_override only. Positive bounded decimal; not a measured or cut event.';
COMMENT ON COLUMN public.harness_operating_case_wires.applicability_basis IS 'Conditional class/direct assumption or unresolved applicability. A catalogue or gauge key does not prove installed material applicability.';
COMMENT ON COLUMN public.harness_operating_case_wires.recorded_at IS 'Database capture clock for this immutable row, distinct from the recipe author clock and physical measurement time.';
COMMENT ON COLUMN public.harness_operating_case_elements.revision_id IS 'Exact complete authored recipe revision. Sealed recipe children are immutable and same-case/same-vehicle qualified.';
COMMENT ON COLUMN public.harness_operating_case_elements.element_id IS 'Authored analytical element key within one recipe revision. It is not automatically an installed device identity.';
COMMENT ON COLUMN public.harness_operating_case_elements.case_id IS 'Private operating-case identity. Revision and result edges are constrained to the same case and vehicle.';
COMMENT ON COLUMN public.harness_operating_case_elements.vehicle_id IS 'Existing vehicle key. Scope and foreign edges must remain within this vehicle; this module creates no vehicle or source graph.';
COMMENT ON COLUMN public.harness_operating_case_elements.element_code IS 'Stable label for one explicit analytical element within the recipe. Names are never interpreted as device laws.';
COMMENT ON COLUMN public.harness_operating_case_elements.source_endpoint_id IS 'Optional existing endpoint relationship. If present, both terminals must belong to it; coarse endpoint types do not supply behavior.';
COMMENT ON COLUMN public.harness_operating_case_elements.from_termination_id IS 'Existing physical wire-end key at the oriented element start, within the selected same-vehicle pieces.';
COMMENT ON COLUMN public.harness_operating_case_elements.to_termination_id IS 'Existing physical wire-end key at the oriented element end, within the selected same-vehicle pieces.';
COMMENT ON COLUMN public.harness_operating_case_elements.law_kind IS 'Explicit resistor, switch, independent voltage/current source or unknown law. Unknown device behavior prevents numerical output.';
COMMENT ON COLUMN public.harness_operating_case_elements.contact_state IS 'Explicit assumed open, closed or unknown switch state. No implied normally-open, relay, fuse-trip or diode behavior.';
COMMENT ON COLUMN public.harness_operating_case_elements.resistance_ohm IS 'Positive assumed resistance in ohms for resistor or closed-switch laws. Mathematical bounds are not component ratings.';
COMMENT ON COLUMN public.harness_operating_case_elements.voltage_v IS 'Signed voltage in volts. An authored voltage-source law declares V(from)-V(to); a node result is relative to the explicit reference node.';
COMMENT ON COLUMN public.harness_operating_case_elements.current_a IS 'Signed current in amperes, positive from from_node_id to to_node_id. A source may return negative supplied-current sign.';
COMMENT ON COLUMN public.harness_operating_case_elements.parameter_basis IS 'Explicit conditional_assumption. Analytical parameter declaration does not establish installed applicability or release.';
COMMENT ON COLUMN public.harness_operating_case_elements.recorded_at IS 'Database capture clock for this immutable row, distinct from the recipe author clock and physical measurement time.';
COMMENT ON COLUMN public.harness_operating_case_boundaries.revision_id IS 'Exact complete authored recipe revision. Sealed recipe children are immutable and same-case/same-vehicle qualified.';
COMMENT ON COLUMN public.harness_operating_case_boundaries.case_id IS 'Private operating-case identity. Revision and result edges are constrained to the same case and vehicle.';
COMMENT ON COLUMN public.harness_operating_case_boundaries.vehicle_id IS 'Existing vehicle key. Scope and foreign edges must remain within this vehicle; this module creates no vehicle or source graph.';
COMMENT ON COLUMN public.harness_operating_case_boundaries.termination_id IS 'Exact selected physical end explicitly declared outside the modeled attachments.';
COMMENT ON COLUMN public.harness_operating_case_boundaries.boundary_kind IS 'Explicit assumed_open declaration for additional external attachments. It does not cut the selected wire, remove existing node continuity or silently connect an external load or ground.';
COMMENT ON COLUMN public.harness_operating_case_boundaries.recorded_at IS 'Database capture clock for this immutable row, distinct from the recipe author clock and physical measurement time.';
COMMENT ON COLUMN public.harness_model_dc_runs.id IS 'Immutable conditional numerical-run UUID. One exact recipe, structural dependency, input receipt and interpreter identity.';
COMMENT ON COLUMN public.harness_model_dc_runs.vehicle_id IS 'Existing vehicle key. Scope and foreign edges must remain within this vehicle; this module creates no vehicle or source graph.';
COMMENT ON COLUMN public.harness_model_dc_runs.case_id IS 'Private operating-case identity. Revision and result edges are constrained to the same case and vehicle.';
COMMENT ON COLUMN public.harness_model_dc_runs.revision_id IS 'Exact complete authored recipe revision. Sealed recipe children are immutable and same-case/same-vehicle qualified.';
COMMENT ON COLUMN public.harness_model_dc_runs.scope_key IS 'Server-derived MD5 of the selected physical piece and attachment scope. Caller text never grants scope authority.';
COMMENT ON COLUMN public.harness_model_dc_runs.structural_evaluation_id IS 'Existing structural evaluation dependency. Exact input and interpreter currentness are rechecked; a structural key is not engineering approval.';
COMMENT ON COLUMN public.harness_model_dc_runs.private_generation IS 'Private recipe-generation counter. It is isolated from the public structural source epoch.';
COMMENT ON COLUMN public.harness_model_dc_runs.private_input_hash IS 'MD5 of the complete server-compiled input_receipt, including checks, selected source pieces, parameters, bindings and issues.';
COMMENT ON COLUMN public.harness_model_dc_runs.private_logic_key IS 'MD5 of the stored exact calculation logic_receipt. Current readers suppress results from obsolete definitions.';
COMMENT ON COLUMN public.harness_model_dc_runs.input_receipt IS 'Immutable complete compiled dependency receipt. A scoped interpretation, not a second canonical source graph or source claim.';
COMMENT ON COLUMN public.harness_model_dc_runs.logic_receipt IS 'Immutable exact function-definition identities used for compilation and numerical interpretation.';
COMMENT ON COLUMN public.harness_model_dc_runs.status IS 'Solved, held, indeterminate, inconsistent or numerical_failure numerical status. Separate from dependency currentness and physical build readiness.';
COMMENT ON COLUMN public.harness_model_dc_runs.qualification IS 'Fixed conditional_simulation_only. No electrical engineering, purchasing, cut or assembly release is implied.';
COMMENT ON COLUMN public.harness_model_dc_runs.expected_wire_input_count IS 'Exact compiled parameter-child count, bounded by the selected wire scope and verified at closure.';
COMMENT ON COLUMN public.harness_model_dc_runs.expected_node_count IS 'Exact numerical node-child count, zero for non-solved runs and bounded to sixteen.';
COMMENT ON COLUMN public.harness_model_dc_runs.expected_branch_count IS 'Exact numerical branch-child count, zero for non-solved runs and bounded to forty.';
COMMENT ON COLUMN public.harness_model_dc_runs.expected_issue_count IS 'Exact typed issue-child count, zero for solved runs and positive for held or failed numerical runs.';
COMMENT ON COLUMN public.harness_model_dc_runs.sealed_at IS 'Database closure clock, set once after exact child counts, identities and hashes validate. Unsealed parents are never useful results.';
COMMENT ON COLUMN public.harness_model_dc_runs.max_kcl_residual_a IS 'Maximum absolute Kirchhoff current residual in amperes from the actual solver. NULL when no solved numerical result exists.';
COMMENT ON COLUMN public.harness_model_dc_runs.power_residual_w IS 'Signed sum of absorbed branch power in watts. NULL when no solved numerical result exists.';
COMMENT ON COLUMN public.harness_model_dc_runs.max_source_residual_v IS 'Maximum absolute independent voltage-source constraint residual in volts. NULL when no solved numerical result exists.';
COMMENT ON COLUMN public.harness_model_dc_runs.dependency_checked_at IS 'Database clock of the source/dependency qualification check used by this immutable run. Not a promise of future freshness.';
COMMENT ON COLUMN public.harness_model_dc_runs.evaluated_at IS 'Database numerical evaluation clock, distinct from recipe authorship, source publication and physical measurement time.';
COMMENT ON COLUMN public.harness_model_dc_wire_inputs.run_id IS 'Exact immutable conditional DC run. Result children close atomically with the parent and cannot be appended later.';
COMMENT ON COLUMN public.harness_model_dc_wire_inputs.revision_id IS 'Exact complete authored recipe revision. Sealed recipe children are immutable and same-case/same-vehicle qualified.';
COMMENT ON COLUMN public.harness_model_dc_wire_inputs.segment_id IS 'Existing physical wire-piece key. Logical circuit identity alone cannot identify this wire or its two ends.';
COMMENT ON COLUMN public.harness_model_dc_wire_inputs.length_basis IS 'Explicit planned_gross, measured, design_override, unresolved or not_used basis. Planned allowances cannot become cut or purchase quantities.';
COMMENT ON COLUMN public.harness_model_dc_wire_inputs.selected_length_ft IS 'Selected source length in international feet. May include planned allowances; NULL when that basis is not used or unresolved.';
COMMENT ON COLUMN public.harness_model_dc_wire_inputs.selected_length_m IS 'Selected length in metres: measured/planned international feet convert using exactly 0.3048 m per foot; design_override uses the explicit authored metre value directly. NULL when no length is used or qualified. Not a final cut quantity.';
COMMENT ON COLUMN public.harness_model_dc_wire_inputs.length_source_field IS 'Exact measured_length_ft or planned_length_ft field consumed from the canonical piece, otherwise NULL.';
COMMENT ON COLUMN public.harness_model_dc_wire_inputs.design_length_m IS 'Explicit assumed wire length in metres for design_override only. Positive bounded decimal; not a measured or cut event.';
COMMENT ON COLUMN public.harness_model_dc_wire_inputs.resistance_claim_observation_id IS 'Existing conditioned resistance-claim observation key. Its source and condition must qualify in the current statement; not a copied numerical claim.';
COMMENT ON COLUMN public.harness_model_dc_wire_inputs.condition_key IS 'Existing source-condition key for the selected resistance claim, otherwise NULL. Conditions include source variant, gauge, temperature and value role.';
COMMENT ON COLUMN public.harness_model_dc_wire_inputs.reference_fingerprint IS 'Exact qualified source/reference fingerprint at compilation, otherwise NULL. Supersession or withdrawal invalidates currentness.';
COMMENT ON COLUMN public.harness_model_dc_wire_inputs.reference_ohm_per_m IS 'Qualified selected material-class maximum resistance in ohms per metre at its recorded source conditions. Not installed wire resistance.';
COMMENT ON COLUMN public.harness_model_dc_wire_inputs.derived_resistance_ohm IS 'Selected resistance in ohms after explicit basis/length and upward normalization to twenty-four fractional places for source maxima.';
COMMENT ON COLUMN public.harness_model_dc_wire_inputs.parameter_basis IS 'Explicit conditional_assumption. Analytical parameter declaration does not establish installed applicability or release.';
COMMENT ON COLUMN public.harness_model_dc_wire_inputs.applicability_state IS 'Unresolved, direct analytical assumption, or source class assumed without manufacturer/installed applicability.';
COMMENT ON COLUMN public.harness_model_dc_wire_inputs.input_state IS 'Ready or held compiled parameter status. A ready analytical input does not establish purchase eligibility.';
COMMENT ON COLUMN public.harness_model_dc_wire_inputs.recorded_at IS 'Database capture clock for this immutable row, distinct from the recipe author clock and physical measurement time.';
COMMENT ON COLUMN public.harness_model_dc_node_results.run_id IS 'Exact immutable conditional DC run. Result children close atomically with the parent and cannot be appended later.';
COMMENT ON COLUMN public.harness_model_dc_node_results.structural_evaluation_id IS 'Existing structural evaluation dependency. Exact input and interpreter currentness are rechecked; a structural key is not engineering approval.';
COMMENT ON COLUMN public.harness_model_dc_node_results.node_id IS 'Existing electrical-node key in the exact structural evaluation. Numerical scope membership is checked at result closure.';
COMMENT ON COLUMN public.harness_model_dc_node_results.voltage_v IS 'Signed node potential in volts relative to the explicitly selected reference termination node in this run. No implicit chassis reference.';
COMMENT ON COLUMN public.harness_model_dc_branch_results.run_id IS 'Exact immutable conditional DC run. Result children close atomically with the parent and cannot be appended later.';
COMMENT ON COLUMN public.harness_model_dc_branch_results.revision_id IS 'Exact complete authored recipe revision. Sealed recipe children are immutable and same-case/same-vehicle qualified.';
COMMENT ON COLUMN public.harness_model_dc_branch_results.structural_evaluation_id IS 'Existing structural evaluation dependency. Exact input and interpreter currentness are rechecked; a structural key is not engineering approval.';
COMMENT ON COLUMN public.harness_model_dc_branch_results.branch_id IS 'Deterministic wire/<segment UUID> or device/<element UUID> key in the compiled network. Exactly one typed segment or element edge is present.';
COMMENT ON COLUMN public.harness_model_dc_branch_results.segment_id IS 'Existing physical wire-piece key. Logical circuit identity alone cannot identify this wire or its two ends.';
COMMENT ON COLUMN public.harness_model_dc_branch_results.element_id IS 'Authored analytical element key within one recipe revision. It is not automatically an installed device identity.';
COMMENT ON COLUMN public.harness_model_dc_branch_results.from_node_id IS 'Existing structural node at the oriented branch start. Positive current flows from here to to_node_id.';
COMMENT ON COLUMN public.harness_model_dc_branch_results.to_node_id IS 'Existing structural node at the oriented branch end, in the same evaluation and same numerical run.';
COMMENT ON COLUMN public.harness_model_dc_branch_results.state IS 'Derived open, closed or fixed_model branch state from the declared law, not an observed installed state.';
COMMENT ON COLUMN public.harness_model_dc_branch_results.current_a IS 'Signed current in amperes, positive from from_node_id to to_node_id. A source may return negative supplied-current sign.';
COMMENT ON COLUMN public.harness_model_dc_branch_results.voltage_drop_v IS 'Signed V(from_node_id)-V(to_node_id) in volts within this numerical run.';
COMMENT ON COLUMN public.harness_model_dc_branch_results.absorbed_power_w IS 'Signed absorbed power in watts, equal to voltage_drop_v times current_a. Negative values mean supplied power.';
COMMENT ON COLUMN public.harness_model_dc_issues.run_id IS 'Exact immutable conditional DC run. Result children close atomically with the parent and cannot be appended later.';
COMMENT ON COLUMN public.harness_model_dc_issues.revision_id IS 'Exact complete authored recipe revision. Sealed recipe children are immutable and same-case/same-vehicle qualified.';
COMMENT ON COLUMN public.harness_model_dc_issues.structural_evaluation_id IS 'Existing structural evaluation dependency. Exact input and interpreter currentness are rechecked; a structural key is not engineering approval.';
COMMENT ON COLUMN public.harness_model_dc_issues.ordinal IS 'One-based deterministic issue order within the exact closed numerical run.';
COMMENT ON COLUMN public.harness_model_dc_issues.code IS 'Closed typed issue code from compilation or numerical calculation; no raw exception, private recipe title or arbitrary diagnostic prose.';
COMMENT ON COLUMN public.harness_model_dc_issues.node_id IS 'Existing electrical-node key in the exact structural evaluation. Numerical scope membership is checked at result closure.';
COMMENT ON COLUMN public.harness_model_dc_issues.segment_id IS 'Existing physical wire-piece key. Logical circuit identity alone cannot identify this wire or its two ends.';
COMMENT ON COLUMN public.harness_model_dc_issues.termination_id IS 'Optional exact authored boundary/physical end to which this typed issue applies.';
COMMENT ON COLUMN public.harness_model_dc_issues.element_id IS 'Authored analytical element key within one recipe revision. It is not automatically an installed device identity.';
COMMENT ON COLUMN public.harness_model_dc_issues.parameter_key IS 'Optional named prerequisite rule or parameter implicated by this issue. NULL when the issue has no parameter-specific edge.';
COMMENT ON COLUMN public.model_fold_tick_runs.dc_error_code IS 'Typed SQLSTATE only for a failed private numerical phase. NULL when the exact abandoned exception is unknown; no raw error prose.';
COMMENT ON COLUMN public.model_fold_tick_runs.dc_output_retained IS 'Whether this private phase retained a closed immutable output. It does not imply current dependency qualification or build readiness.';

-- Record the already-authorized build only after every module succeeded.
DO $authorization$
BEGIN
 UPDATE public.schema_proposals SET status='approved',resolved_at=clock_timestamp(),
  decision_rationale='Build authorized by the owner in the current harness engineering session on 2026-11-26; recorded by codex-wiring-operating-cases-20261126 through the reviewed runtime installation migration. The implementing agent wrote this metadata; no human review, authenticated-user identity, measured-key ratification or owner signature is asserted. Conditional calculation is not engineering or physical build approval.'
 WHERE id='f8215459-ec38-4e2e-a855-509257740313' AND status='open';
END $authorization$;
NOTIFY pgrst,'reload schema';
COMMIT;

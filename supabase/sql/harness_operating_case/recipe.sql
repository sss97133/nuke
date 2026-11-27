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
   WHERE x.id=NEW.source_endpoint_id AND x.vehicle_id=NEW.vehicle_id) THEN
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
COMMIT;

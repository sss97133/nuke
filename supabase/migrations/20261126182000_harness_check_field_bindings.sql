-- Direct predicate inputs belong to the existing immutable check/evaluation.
-- A projected field can itself be derived: this is not transitive source proof.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';

CREATE FUNCTION public.harness_model_segment_check(p_rule text,p_segment jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $fn$
DECLARE fields text[]; v jsonb; bindings jsonb; verdict text;
BEGIN
 fields:=CASE p_rule
  WHEN 'segment_specification' THEN ARRAY['specification_state']
  WHEN 'wire_stock_key' THEN ARRAY['wire_part_id','expected_part_number','keyed_part_number']
  WHEN 'material_source_status' THEN ARRAY['blockers']
  WHEN 'new_wire_demand' THEN ARRAY['physical_progress','build_state','measured_length_ft','measured_at']
  WHEN 'planned_wire_amount' THEN ARRAY['planned_length_ft','planned_length_method'] END;
 IF fields IS NULL THEN RETURN NULL; END IF;
 SELECT jsonb_object_agg(f,p_segment->f),jsonb_agg(jsonb_build_object(
  'segment_id',p_segment->'id','input_field',f,'field_present',p_segment ? f,
  'value_md5',md5(jsonb_build_object('present',p_segment ? f,'value',p_segment->f)::text)) ORDER BY f)
 INTO v,bindings FROM unnest(fields) f;
 -- Verdicts read only v, the exact declared and fingerprinted input fields.
 verdict:=CASE p_rule
  WHEN 'segment_specification' THEN CASE v->>'specification_state' WHEN 'agrees' THEN 'pass' WHEN 'conflict' THEN 'fail' ELSE 'hold' END
  WHEN 'wire_stock_key' THEN CASE WHEN v->>'wire_part_id' IS NULL OR v->>'expected_part_number' IS NULL THEN 'hold'
   WHEN v->>'keyed_part_number' IS DISTINCT FROM v->>'expected_part_number' THEN 'fail' ELSE 'pass' END
  WHEN 'material_source_status' THEN CASE WHEN jsonb_typeof(v->'blockers')='array'
   AND jsonb_array_length(v->'blockers')>0 THEN 'hold' ELSE 'pass' END
  WHEN 'new_wire_demand' THEN CASE WHEN coalesce((v->>'physical_progress')::boolean,false)
   OR v->>'build_state' IS DISTINCT FROM 'uncut' OR v->>'measured_length_ft' IS NOT NULL
   OR v->>'measured_at' IS NOT NULL THEN 'hold' ELSE 'pass' END
  WHEN 'planned_wire_amount' THEN CASE WHEN (v->>'planned_length_ft')::numeric>0
   AND nullif(btrim(v->>'planned_length_method'),'') IS NOT NULL
   AND v->>'planned_length_method' !~* '^unknown' THEN 'pass' ELSE 'hold' END END;
 RETURN jsonb_build_object('result',verdict,'input_bindings',bindings);
END $fn$;
REVOKE ALL ON FUNCTION public.harness_model_segment_check(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.harness_model_segment_check(text,jsonb) TO anon,authenticated,service_role;

ALTER TABLE public.harness_model_checks
 ADD COLUMN input_binding_count integer CHECK(input_binding_count IS NULL OR input_binding_count>=0),
 ADD CONSTRAINT harness_model_checks_id_evaluation_unique UNIQUE(id,evaluation_id);
ALTER TABLE public.harness_model_evaluations
 ADD COLUMN check_input_count integer NOT NULL DEFAULT 0 CHECK(check_input_count>=0);
GRANT SELECT(check_input_count) ON public.harness_model_evaluations TO anon,authenticated;
CREATE TABLE public.harness_model_check_inputs(
 evaluation_id uuid NOT NULL REFERENCES public.harness_model_evaluations(id),
 check_id uuid NOT NULL,
 segment_id uuid NOT NULL REFERENCES public.harness_segments(id),
 input_field text NOT NULL CHECK(input_field IN('specification_state','wire_part_id','expected_part_number','keyed_part_number',
  'blockers','physical_progress','build_state','measured_length_ft','measured_at','planned_length_ft','planned_length_method')),
 field_present boolean NOT NULL,
 value_md5 text NOT NULL CHECK(value_md5 ~ '^[0-9a-f]{32}$'),
 PRIMARY KEY(check_id,input_field),
 FOREIGN KEY(check_id,evaluation_id) REFERENCES public.harness_model_checks(id,evaluation_id)
);
CREATE INDEX harness_model_check_inputs_evaluation ON public.harness_model_check_inputs(evaluation_id,check_id);
ALTER TABLE public.harness_model_check_inputs ENABLE ROW LEVEL SECURITY;
CREATE POLICY harness_model_check_inputs_read ON public.harness_model_check_inputs FOR SELECT USING(
 EXISTS(SELECT FROM public.harness_model_checks c WHERE c.id=check_id AND c.evaluation_id=harness_model_check_inputs.evaluation_id)
 AND EXISTS(SELECT FROM public.harness_segments s WHERE s.id=segment_id));
REVOKE ALL ON public.harness_model_check_inputs FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.harness_model_check_inputs TO anon,authenticated,service_role;

CREATE FUNCTION public.harness_model_check_input_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $fn$
BEGIN
 -- Expand each captured segment once for the inserted batch. A per-field row
 -- trigger would repeatedly detoast and scan a complete 500-piece input receipt.
 IF EXISTS(
  WITH affected AS(SELECT DISTINCT evaluation_id FROM inserted_check_inputs),
  source_rows AS MATERIALIZED(SELECT e.id evaluation_id,s FROM public.harness_model_evaluations e
   JOIN affected a ON a.evaluation_id=e.id CROSS JOIN LATERAL jsonb_array_elements(e.input_snapshot#>'{model,segments}') s),
  checks AS MATERIALIZED(SELECT c.*,public.harness_model_segment_check(c.rule_key,s.s) computed
   FROM public.harness_model_checks c JOIN(SELECT DISTINCT check_id,evaluation_id FROM inserted_check_inputs) i
    ON i.check_id=c.id AND i.evaluation_id=c.evaluation_id
   LEFT JOIN source_rows s ON s.evaluation_id=c.evaluation_id AND s.s->>'id'=c.segment_id::text)
  SELECT FROM inserted_check_inputs b LEFT JOIN checks c ON c.id=b.check_id AND c.evaluation_id=b.evaluation_id
  WHERE c.id IS NULL OR c.segment_id IS DISTINCT FROM b.segment_id OR c.input_binding_count IS NULL
   OR c.computed IS NULL OR c.result IS DISTINCT FROM c.computed->>'result'
   OR c.input_binding_count<>jsonb_array_length(c.computed->'input_bindings')
   OR NOT EXISTS(SELECT FROM jsonb_array_elements(c.computed->'input_bindings') expected
    WHERE expected->>'input_field'=b.input_field AND (expected->>'field_present')::boolean=b.field_present AND expected->>'value_md5'=b.value_md5)
 ) THEN RAISE EXCEPTION 'Check input does not match the captured canonical predicate and exact segment subject' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.harness_model_check_input_guard() FROM PUBLIC,anon,authenticated,service_role;
-- Parent checks already enforce source vehicle scope. Composite FK and this
-- batch guard bind every child to that exact check/evaluation/segment subject.
CREATE TRIGGER harness_model_check_inputs_source AFTER INSERT ON public.harness_model_check_inputs
 REFERENCING NEW TABLE AS inserted_check_inputs FOR EACH STATEMENT EXECUTE FUNCTION public.harness_model_check_input_guard();
CREATE TRIGGER harness_model_check_inputs_immutable BEFORE UPDATE OR DELETE ON public.harness_model_check_inputs
 FOR EACH ROW EXECUTE FUNCTION public.vein_append_only();

-- Replace the five predicates in their canonical computation; do not add a
-- second evaluator. Unknown/other rules retain explicit unrecorded coverage.
DO $patch$
DECLARE b text:=pg_get_functiondef('public.harness_model_compute(jsonb)'::regprocedure); old text; replacement text;
BEGIN
 old:=$a$   WHEN 'segment_specification' THEN CASE s.x->>'specification_state' WHEN 'agrees' THEN 'pass' WHEN 'conflict' THEN 'fail' ELSE 'hold' END
   WHEN 'wire_stock_key' THEN CASE WHEN s.x->>'wire_part_id' IS NULL OR s.x->>'expected_part_number' IS NULL THEN 'hold'
     WHEN s.x->>'keyed_part_number' IS DISTINCT FROM s.x->>'expected_part_number' THEN 'fail' ELSE 'pass' END
   WHEN 'material_source_status' THEN CASE WHEN jsonb_typeof(s.x->'blockers')='array'
      AND jsonb_array_length(s.x->'blockers')>0 THEN 'hold' ELSE 'pass' END
   WHEN 'new_wire_demand' THEN CASE WHEN coalesce((s.x->>'physical_progress')::boolean,false)
      OR s.x->>'build_state' IS DISTINCT FROM 'uncut' OR s.x->>'measured_length_ft' IS NOT NULL
      OR s.x->>'measured_at' IS NOT NULL THEN 'hold' ELSE 'pass' END
   WHEN 'planned_wire_amount' THEN CASE WHEN (s.x->>'planned_length_ft')::numeric>0
     AND nullif(btrim(s.x->>'planned_length_method'),'') IS NOT NULL
     AND s.x->>'planned_length_method' !~* '^unknown' THEN 'pass' ELSE 'hold' END$a$;
 replacement:=$z$   WHEN 'segment_specification' THEN public.harness_model_segment_check(r.x->>'rule_key',s.x)->>'result'
   WHEN 'wire_stock_key' THEN public.harness_model_segment_check(r.x->>'rule_key',s.x)->>'result'
   WHEN 'material_source_status' THEN public.harness_model_segment_check(r.x->>'rule_key',s.x)->>'result'
   WHEN 'new_wire_demand' THEN public.harness_model_segment_check(r.x->>'rule_key',s.x)->>'result'
   WHEN 'planned_wire_amount' THEN public.harness_model_segment_check(r.x->>'rule_key',s.x)->>'result'$z$;
 IF (length(b)-length(replace(b,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'Direct segment predicate anchor drift'; END IF;
 b:=replace(b,old,replacement);
 old:=$a$to_jsonb(c) ORDER BY c.rule_key,c.segment_id,c.termination_id,c.circuit_id$a$;
 replacement:=$z$to_jsonb(c)||coalesce((SELECT public.harness_model_segment_check(c.rule_key,s.x)-'result' FROM s WHERE s.x->>'id'=c.segment_id::text),'{}'::jsonb) ORDER BY c.rule_key,c.segment_id,c.termination_id,c.circuit_id$z$;
 IF (length(b)-length(replace(b,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'Direct check receipt anchor drift'; END IF;
 EXECUTE replace(b,old,replacement);
END $patch$;

DO $patch$
DECLARE b text:=pg_get_functiondef('public.harness_model_fold(uuid)'::regprocedure); a text; z text;
BEGIN
 FOR a,z IN SELECT * FROM(VALUES
 ($a$component_requirement_count,component_contributor_count,component_role_coverage,sheet_count$a$,
  $z$component_requirement_count,component_contributor_count,component_role_coverage,check_input_count,sheet_count$z$),
 ($a$result->'component_role_coverage',jsonb_array_length(result->'manual'->'sheets')$a$,
  $z$result->'component_role_coverage',coalesce((SELECT sum(jsonb_array_length(c->'input_bindings')) FROM jsonb_array_elements(result->'checks') c),0),jsonb_array_length(result->'manual'->'sheets')$z$),
 ($a$termination_id,circuit_id,component_requirement_id,result)
    SELECT evaluation,x.rule_key,x.rule_version,x.segment_id,x.termination_id,x.circuit_id,x.component_requirement_id,x.result$a$,
  $z$termination_id,circuit_id,component_requirement_id,result,input_binding_count)
    SELECT evaluation,x.rule_key,x.rule_version,x.segment_id,x.termination_id,x.circuit_id,x.component_requirement_id,x.result,jsonb_array_length(x.input_bindings)$z$),
 ($a$component_requirement_id uuid,result text);$a$,$z$component_requirement_id uuid,result text,input_bindings jsonb);
   INSERT INTO public.harness_model_check_inputs(evaluation_id,check_id,segment_id,input_field,field_present,value_md5)
    SELECT evaluation,q.id,q.segment_id,b->>'input_field',(b->>'field_present')::boolean,b->>'value_md5'
    FROM jsonb_array_elements(result->'checks') c CROSS JOIN LATERAL jsonb_array_elements(c->'input_bindings') b
    JOIN public.harness_model_checks q ON q.evaluation_id=evaluation AND q.rule_key=c->>'rule_key'
     AND q.rule_version=c->>'rule_version' AND q.segment_id=(c->>'segment_id')::uuid;$z$)
 ) changes(old,new) LOOP
  IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Check input producer anchor drift: %',left(a,80); END IF;
  b:=replace(b,a,z);
 END LOOP;
 EXECUTE b;
END $patch$;

DO $patch$
DECLARE name text; b text; a text; z text;
BEGIN
 -- The bulk diagnostic and every bounded manual reader already consume this
 -- shared receipt; one completeness predicate covers all of those consumers.
 FOREACH name IN ARRAY ARRAY['public.harness_model_receipt_for_hash(uuid,text)'] LOOP
  b:=pg_get_functiondef(name::regprocedure);
  a:='r.component_requirement_count,r.component_contributor_count,r.component_role_coverage';
  IF name LIKE '%receipt_for_hash%' THEN a:='e.component_requirement_count,e.component_contributor_count,e.component_role_coverage'; END IF;
  z:=a||CASE WHEN name LIKE '%receipt_for_hash%' THEN ',e.check_input_count' ELSE ',r.check_input_count' END;
  IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Check input receipt fields drift: %',name; END IF;
  b:=replace(b,a,z);
  a:='AND r.component_contributor_count=(SELECT count(*) FROM public.harness_model_component_contributors q WHERE q.evaluation_id=r.id)';
  z:=a||E'\n AND r.check_input_count=(SELECT count(*) FROM public.harness_model_check_inputs q WHERE q.evaluation_id=r.id)';
  IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Check input completeness anchor drift: %',name; END IF;
  EXECUTE replace(b,a,z);
 END LOOP;
END $patch$;

DO $patch$
DECLARE b text:=pg_get_functiondef('public.harness_model_logic_snapshot()'::regprocedure);
 a text:=$a$'harness_model_compute(jsonb)',pg_get_functiondef('public.harness_model_compute(jsonb)'::regprocedure),$a$;
 z text:=$z$'harness_model_compute(jsonb)',pg_get_functiondef('public.harness_model_compute(jsonb)'::regprocedure),
  'harness_model_segment_check(text,jsonb)',pg_get_functiondef('public.harness_model_segment_check(text,jsonb)'::regprocedure),
  'harness_model_check_input_guard()',pg_get_functiondef('public.harness_model_check_input_guard()'::regprocedure),$z$;
BEGIN
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Check input logic anchor drift'; END IF;
 EXECUTE replace(b,a,z);
END $patch$;

CREATE FUNCTION public.harness_model_check_context(p_vehicle_id uuid,p_evaluation_id uuid,p_check_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public SET timezone='UTC' AS $fn$
DECLARE inp jsonb; receipt jsonb; c public.harness_model_checks; source_row jsonb; bindings jsonb;
BEGIN
 inp:=public.harness_model_inputs(p_vehicle_id);
 receipt:=public.harness_model_receipt_for_hash(p_vehicle_id,md5(inp::text));
 IF receipt IS NULL OR receipt->>'id' IS DISTINCT FROM p_evaluation_id::text THEN
  RETURN jsonb_build_object('status',coalesce(public.harness_model_pending_status(p_vehicle_id,md5(inp::text)),'unavailable'),'check',NULL,'inputs','[]'::jsonb); END IF;
 SELECT * INTO c FROM public.harness_model_checks WHERE evaluation_id=p_evaluation_id AND id=p_check_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','unavailable','check',NULL,'inputs','[]'::jsonb); END IF;
 SELECT s INTO source_row FROM jsonb_array_elements(inp#>'{model,segments}') s WHERE s->>'id'=c.segment_id::text;
 SELECT coalesce(jsonb_agg(jsonb_build_object('segment_id',b.segment_id,'input_field',b.input_field,
  'field_present',b.field_present,'value',source_row->b.input_field,'value_md5',b.value_md5) ORDER BY b.input_field),'[]'::jsonb)
 INTO bindings FROM public.harness_model_check_inputs b WHERE b.evaluation_id=p_evaluation_id AND b.check_id=c.id
  AND b.field_present=(source_row ? b.input_field)
  AND b.value_md5=md5(jsonb_build_object('present',source_row ? b.input_field,'value',source_row->b.input_field)::text);
 IF c.input_binding_count IS NOT NULL AND c.input_binding_count<>jsonb_array_length(bindings) THEN
  RETURN jsonb_build_object('status','incomplete_visibility','check',NULL,'inputs','[]'::jsonb); END IF;
 RETURN jsonb_build_object('status','current','evaluation_id',p_evaluation_id,'input_hash',receipt->'input_hash','logic_key',receipt->'logic_key',
  'check',jsonb_build_object('id',c.id,'rule_key',c.rule_key,'rule_version',c.rule_version,'result',c.result,
   'segment_id',c.segment_id,'termination_id',c.termination_id,'circuit_id',c.circuit_id,'component_requirement_id',c.component_requirement_id),
  'subject',CASE WHEN source_row IS NOT NULL THEN (SELECT jsonb_object_agg(k,source_row->k) FROM unnest(ARRAY[
   'id','circuit_id','net_id','gauge_awg','colour','wire_part_id','keyed_part_number','expected_gauge_awg','expected_part_number',
   'planned_length_ft','planned_length_method','measured_length_ft','build_state']) k) ELSE NULL END,
  'input_coverage',CASE WHEN c.input_binding_count IS NULL THEN 'not_recorded' ELSE 'direct_segment_predicate_v1' END,
  'source_lineage','not_assessed','inputs',bindings,'rule',(SELECT r FROM jsonb_array_elements(inp->'rules') r WHERE r->>'rule_key'=c.rule_key));
END $fn$;
REVOKE ALL ON FUNCTION public.harness_model_check_context(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.harness_model_check_context(uuid,uuid,uuid) TO anon,authenticated,service_role;

COMMENT ON FUNCTION public.harness_model_segment_check(text,jsonb) IS 'Canonical substep of harness_model_compute for five material/length predicates. Verdict and declared direct projected-segment inputs are produced together; unknown predicates return NULL, never invented coverage. Fields may themselves be derived; this is not transitive source/witness or engineering proof.';
COMMENT ON FUNCTION public.harness_model_check_input_guard() IS 'Binds one derived direct-input edge to its exact immutable evaluation segment, canonical verdict, field presence and value fingerprint. No testimony or source row is written.';
COMMENT ON FUNCTION public.harness_model_check_context(uuid,uuid,uuid) IS 'Bounded invoker-RLS inspection of one current canonical check and at most four direct projected-segment inputs. Values are recovered from the same current public allowlisted model and verified by fingerprints; private input/logic receipts are never exposed. Missing instrumentation remains not_recorded; transitive source/witness lineage is not_assessed.';
COMMENT ON COLUMN public.harness_model_checks.input_binding_count IS 'Expected direct predicate input children; NULL means unrecorded coverage. It is not zero or complete transitive source coverage.';
COMMENT ON COLUMN public.harness_model_evaluations.check_input_count IS 'Expected direct check-input child rows; incomplete visible children prevent a current receipt. Historical receipts retain zero and become stale on changed logic.';
COMMENT ON TABLE public.harness_model_check_inputs IS 'Grain: one declared direct projected-segment field consumed by one canonical check in one immutable evaluation. Typed segment and check/evaluation FKs; presence and fingerprint distinguish absent from explicit null. No copied source value, testimony, independent verdict or transitive witness claim.';
COMMENT ON COLUMN public.harness_model_check_inputs.evaluation_id IS 'Same exact immutable source/code receipt as the composite check FK.';
COMMENT ON COLUMN public.harness_model_check_inputs.check_id IS 'Existing canonical check result owner; never a second check registry.';
COMMENT ON COLUMN public.harness_model_check_inputs.segment_id IS 'Exact physical-piece revision whose evaluated projection supplies this direct field.';
COMMENT ON COLUMN public.harness_model_check_inputs.input_field IS 'Closed allowlisted field in the evaluation segment projection, potentially a derived state rather than a base-table column.';
COMMENT ON COLUMN public.harness_model_check_inputs.field_present IS 'Whether the captured projection contains the field; false differs from explicit JSON null.';
COMMENT ON COLUMN public.harness_model_check_inputs.value_md5 IS 'MD5 of canonical JSON containing presence and value; change detector, not cryptographic authentication or physical evidence.';
COMMIT;

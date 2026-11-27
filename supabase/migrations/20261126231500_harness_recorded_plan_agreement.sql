-- An additional recorded-plan answer; preserve all stock/build predicates.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';

DO $patch$
DECLARE b text:=pg_get_functiondef('public.harness_model_segment_check(text,jsonb)'::regprocedure);
 a text; z text;
BEGIN
 a:='DECLARE fields text[]; v jsonb; bindings jsonb; verdict text;';
 z:=a||' gauge_known boolean; colour_known boolean;';
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Plan predicate declaration anchor drift'; END IF;
 b:=replace(b,a,z);
 a:=$a$  WHEN 'segment_specification' THEN ARRAY['specification_state']$a$;
 z:=$z$  WHEN 'segment_plan_agreement' THEN ARRAY['gauge_awg','circuit_gauge_awg','colour','circuit_colour']
  WHEN 'segment_specification' THEN ARRAY['specification_state']$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Plan predicate field anchor drift'; END IF;
 b:=replace(b,a,z);
 a:=$a$ -- Verdicts read only v, the exact declared and fingerprinted input fields.$a$;
 z:=a||$z$
 IF p_rule='segment_plan_agreement' THEN
  gauge_known:=(jsonb_typeof(v->'gauge_awg')='number'
   AND jsonb_typeof(v->'circuit_gauge_awg')='number') IS TRUE;
  IF gauge_known THEN
   gauge_known:=trunc((v->>'gauge_awg')::numeric)=(v->>'gauge_awg')::numeric
    AND trunc((v->>'circuit_gauge_awg')::numeric)=(v->>'circuit_gauge_awg')::numeric;
  END IF;
  colour_known:=(jsonb_typeof(v->'colour')='string' AND jsonb_typeof(v->'circuit_colour')='string'
   AND (v->>'colour') ~ '[^[:space:]]'
   AND (v->>'circuit_colour') ~ '[^[:space:]]') IS TRUE;
 END IF;$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Plan predicate input anchor drift'; END IF;
 b:=replace(b,a,z);
 a:=$a$  WHEN 'segment_specification' THEN CASE v->>'specification_state' WHEN 'agrees' THEN 'pass' WHEN 'conflict' THEN 'fail' ELSE 'hold' END$a$;
 z:=$z$  WHEN 'segment_plan_agreement' THEN CASE
   WHEN (gauge_known AND v->'gauge_awg'<>v->'circuit_gauge_awg')
    OR (colour_known AND lower(btrim(v->>'colour'))<>lower(btrim(v->>'circuit_colour'))) THEN 'fail'
   WHEN NOT gauge_known OR NOT colour_known THEN 'hold' ELSE 'pass' END
  WHEN 'segment_specification' THEN CASE v->>'specification_state' WHEN 'agrees' THEN 'pass' WHEN 'conflict' THEN 'fail' ELSE 'hold' END$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Plan predicate verdict anchor drift'; END IF;
 EXECUTE replace(b,a,z);
END $patch$;

ALTER TABLE public.harness_model_check_inputs
 DROP CONSTRAINT harness_model_check_inputs_input_field_check,
 ADD CONSTRAINT harness_model_check_inputs_input_field_check CHECK(input_field IN(
  'specification_state','wire_part_id','expected_part_number','keyed_part_number','blockers',
  'physical_progress','build_state','measured_length_ft','measured_at','planned_length_ft','planned_length_method',
  'gauge_awg','circuit_gauge_awg','colour','circuit_colour')) NOT VALID;
ALTER TABLE public.harness_model_check_inputs VALIDATE CONSTRAINT harness_model_check_inputs_input_field_check;

DO $patch$
DECLARE b text:=pg_get_functiondef('public.harness_model_compute(jsonb)'::regprocedure);
 a text:=$a$   WHEN 'segment_specification' THEN public.harness_model_segment_check(r.x->>'rule_key',s.x)->>'result'$a$;
 z text:=$z$   WHEN 'segment_plan_agreement' THEN public.harness_model_segment_check(r.x->>'rule_key',s.x)->>'result'
   WHEN 'segment_specification' THEN public.harness_model_segment_check(r.x->>'rule_key',s.x)->>'result'$z$;
BEGIN
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Plan computation anchor drift'; END IF;
 EXECUTE replace(b,a,z);
END $patch$;

INSERT INTO public.harness_model_rules(rule_key,version,subject_kind,description,
 display_name,attention_action,attention_order,implementation) VALUES(
 'segment_plan_agreement','1','segment',
 'Recorded piece and current circuit agree on integral numeric gauge and full ordered nonblank colour labels. Known disagreement fails; otherwise missing or incompatible scalar values hold. Label validity, insulation family, physical material, keyed stock, ratings and engineering suitability are not established.',
 'Recorded wire plan agreement',
 'Record and reconcile piece gauge and full ordered colour against the current circuit plan. Separately resolve stock identity, material applicability and engineering requirements.',
 25,'public.harness_model_segment_check(text,jsonb)'::regprocedure);

COMMENT ON FUNCTION public.harness_model_segment_check(text,jsonb) IS
 'Canonical substep of harness_model_compute for six direct segment predicates, including narrower recorded plan agreement independently of compound specification and stock identity. Verdict and declared direct projected-segment inputs are produced together; unknown predicates return NULL. No transitive witness, physical material, rating or engineering proof.';
COMMIT;

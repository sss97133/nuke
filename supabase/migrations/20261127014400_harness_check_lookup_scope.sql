-- NULL segment subjects cannot contribute direct segment input bindings.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
DO $patch$
DECLARE b text:=pg_get_functiondef('public.harness_model_compute(jsonb)'::regprocedure);
 a text:=$a$coalesce((SELECT public.harness_model_segment_check(c.rule_key,s.x)-'result' FROM s WHERE s.x->>'id'=c.segment_id::text),'{}'::jsonb)$a$;
 z text:=$z$CASE WHEN c.segment_id IS NULL THEN '{}'::jsonb ELSE coalesce((SELECT public.harness_model_segment_check(c.rule_key,s.x)-'result' FROM s WHERE s.x->>'id'=c.segment_id::text),'{}'::jsonb) END$z$;
BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.harness_model_compute(jsonb)'::regprocedure)
  <>'b1dfa1613e36488fd47c2f14c896badd' THEN
  RAISE EXCEPTION 'Canonical harness computation drifted; review the current owner first'; END IF;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Canonical check binding lookup anchor drift'; END IF;
 EXECUTE replace(b,a,z);
END $patch$;
COMMIT;

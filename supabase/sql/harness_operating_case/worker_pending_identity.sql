-- Candidate pending dependency identity preservation; no runtime installation.
BEGIN;
DO $candidate$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%'
  OR current_setting('server_version_num')::integer/10000<>17 THEN
  RAISE EXCEPTION 'Operating-case candidate requires a disposable PG17 contract database';
 END IF;
END $candidate$;
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
COMMIT;

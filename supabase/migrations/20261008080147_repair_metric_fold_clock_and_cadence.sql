-- Intake grew beyond the five-minute derived drain:2359queued parents/17min
-- oldest age at07:51Z despite successful16–42s runs. Preserve existing chunks,
-- per-run caps,45s controller budget, parent locks/retry circuit and value OFF.
-- A long drain transaction can see source commits after its transaction start;
-- the fold's recording clock must describe materialization, not BEGIN.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
DO $repair$
DECLARE j bigint;f text;h text;
BEGIN
 SELECT jobid INTO j FROM cron.job WHERE jobname='drain-vehicle-derived-queues'
  AND active AND schedule IN('*/5 * * * *','*/2 * * * *')
  AND encode(sha256(convert_to(command,'UTF8')),'base64')='DyTDHVzhBBk4V6M507lB5RC/LsN7MqREJY1+qg0rTBI=';
 IF j IS NULL THEN RAISE EXCEPTION 'Active value-OFF derived drain contract changed; preserve owner pause';END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('public.drain_vehicle_derived_queues(boolean,integer)'::regprocedure),'UTF8')),'base64')
  IS DISTINCT FROM 'ORa96HNSwkFyBo1zNXUkSTEylzENegsEdhfF0EmuSko=' THEN
  RAISE EXCEPTION 'Derived controller budget/chunk owner changed';
 END IF;
 f:=pg_get_functiondef('public.drain_vehicle_metric_queue(integer)'::regprocedure);
 h:=encode(sha256(convert_to(f,'UTF8')),'base64');
 IF h='oQzzspRSSBOuW0GTD2pyzSC5488n+lNEWe7RX/YkHoM=' THEN
  IF cardinality(string_to_array(f,'max(observed_at),now()'))<>2 THEN RAISE EXCEPTION 'Metric clock owner anchor changed';END IF;
  EXECUTE replace(f,'max(observed_at),now()','max(observed_at),clock_timestamp()');
 ELSIF h IS DISTINCT FROM 'i/bVyc6ZROIvmHwIkdlQHzhGTOavHdmp7DfrM0B2QnA=' THEN
  RAISE EXCEPTION 'Metric drain owner changed';
 END IF;
 PERFORM cron.alter_job(job_id:=j,schedule:='*/2 * * * *');
END $repair$;
COMMENT ON COLUMN public.vehicle_live_metrics.updated_at IS 'Database materialization clock of this current per-vehicle aggregate, evaluated after source rows are read. drain_vehicle_metric_queue uses clock_timestamp so commits visible after the outer transaction began cannot make a newly computed fold appear older than its included input. Not source event time or a historical/PIT cutoff.';
COMMENT ON FUNCTION public.drain_vehicle_metric_queue(integer) IS 'Existing bounded1..1000(default100) metric owner, parent-first locks and failure requeue preserved. Aggregate updated_at records materialization wall clock after inputs, not transaction-start time. Existing derived controller uses10-row chunks/500cap/first third of unchanged45s budget, now every2min under unchanged value-OFF/retry/lock contracts.';
NOTIFY pgrst,'reload schema';
COMMIT;

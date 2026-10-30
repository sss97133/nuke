-- A dedicated wake for owed, registered, zero-model retained calculations.
-- Shared derivation dispatch also owns paid work; leave its cadence and scope
-- alone. No sweep, legacy enrollment, private source, or photo drain activation.
SET lock_timeout='5s';
SET statement_timeout='30s';
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM public.analysis_widgets WHERE retained_dispatch_method='registered_source_state_v1')
   OR to_regprocedure('public.claim_analysis_queue_batch(integer,text,uuid,boolean)') IS NULL
   OR to_regprocedure('public.analysis_queue_health(uuid,integer)') IS NULL THEN
  RAISE EXCEPTION 'Registered retained processing owners must be deployed first';
 END IF;
 PERFORM cron.schedule('analysis-retained-drain','* * * * *',$wake$
  SELECT net.http_post(
   url := get_service_url() || '/functions/v1/analysis-engine-coordinator',
   headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || get_service_role_key_for_cron()),
   body := '{"action":"compute_retained","batch_size":20,"time_budget_ms":45000}'::jsonb,
   timeout_milliseconds := 55000);
 $wake$);
END $$;

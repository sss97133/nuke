-- removes backfilled claims too (run ids recorded in the queue)
DELETE FROM public.evidence_claims c USING (SELECT DISTINCT run_id FROM public.evidence_backfill_queue WHERE run_id IS NOT NULL) r WHERE c.run_id = r.run_id;
DROP FUNCTION IF EXISTS public.evidence_backfill_next(uuid, int);
DROP TABLE IF EXISTS public.evidence_backfill_queue;
-- run FIRST: stop the throttled backfill job (created via cron.schedule, 1 batch of 500/min)
-- SELECT cron.unschedule('evidence-backfill-bf001');

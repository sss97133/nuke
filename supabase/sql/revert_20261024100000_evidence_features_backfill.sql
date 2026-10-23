-- SELECT cron.unschedule('evidence-features-fe001');
DELETE FROM public.evidence_features WHERE run_id = '7e1d0c24-2026-4a10-9e00-0000000fe001';
DROP FUNCTION IF EXISTS public.evidence_features_next(uuid, int);
ALTER TABLE public.evidence_backfill_queue DROP COLUMN IF EXISTS features_done_at;

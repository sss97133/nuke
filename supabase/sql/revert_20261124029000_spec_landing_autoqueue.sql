-- Revert 20261124029000_spec_landing_autoqueue: stop the cron, drop the function and the autoqueue columns.
-- Jobs it queued stay; cancel the ones not started with:
--   DELETE FROM public.spec_landing_jobs WHERE scope LIKE 'platform_hex_%' AND status = 'queued' AND ticks = 0;
begin;
set local lock_timeout = '5s';
SELECT cron.unschedule('spec-landing-autoqueue') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'spec-landing-autoqueue');
DROP FUNCTION IF EXISTS public.spec_landing_autoqueue_v1();
ALTER TABLE public.spec_landing_control
  DROP COLUMN IF EXISTS autoqueue_enabled, DROP COLUMN IF EXISTS autoqueue_batch, DROP COLUMN IF EXISTS autoqueue_low_water,
  DROP COLUMN IF EXISTS autoqueue_max_failed, DROP COLUMN IF EXISTS last_autoqueue_at, DROP COLUMN IF EXISTS last_autoqueue;
commit;

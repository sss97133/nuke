-- Retire mecum-reverify-enqueue.
--
-- 2026-10-15: the 53,638 mecum events that orphan-backfill-v1 wrote as sold are being matched against Mecum's own search
-- index results (sold / bid-goes-on per lot, no page fetches) and corrected through correct_vehicle_sale_provenance_batch,
-- so re-reading each lot page is not needed. The job was already paused. The extract-mecum action enqueue_reverify stays
-- in the function, uncalled.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'mecum-reverify-enqueue';

COMMIT;

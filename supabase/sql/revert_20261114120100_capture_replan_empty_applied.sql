-- Revert 20261114120100. Does not un-plan days already enqueued or planned; those remain signed chunks.
-- Pending queue rows with reason empty_applied_retry can be cancelled by setting done_at if they have not run.
DROP FUNCTION IF EXISTS public.capture_sets_arm_empty_applied(uuid, integer, integer, boolean);
DROP TABLE IF EXISTS public.capture_empty_applied_retry_epoch;

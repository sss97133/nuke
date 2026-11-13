-- Revert 20261113120200_capture_landing_supersede. First revert every applied run:
--   select capture_landing_supersede_revert_v1(run_id) from (select distinct run_id from capture_landing_supersede_log where reverted_at is null) r;
-- then drop the two functions. The log table is kept (it is the audit trail); drop it by hand only if it is empty.
BEGIN;
SELECT public.capture_landing_supersede_revert_v1(run_id) FROM (SELECT DISTINCT run_id FROM public.capture_landing_supersede_log WHERE reverted_at IS NULL) r;
DROP FUNCTION IF EXISTS public.capture_landing_supersede_v1(uuid, uuid, boolean, integer);
DROP FUNCTION IF EXISTS public.capture_landing_supersede_revert_v1(uuid);
COMMIT;

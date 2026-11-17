-- Revert 20261117141000 capture_archive_owner_attribution_v1.
-- Refuses while unreverted log rows remain: revert each run first with
--   select capture_archive_owner_revert_v1('<user>', '<run>');
DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.capture_archive_owner_log') IS NOT NULL THEN
    SELECT count(*) INTO n FROM public.capture_archive_owner_log WHERE reverted_at IS NULL;
    IF n > 0 THEN RAISE EXCEPTION 'capture_archive_owner: % unreverted log rows; revert those runs first', n; END IF;
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.capture_archive_owner_attribution_v1(uuid, uuid, uuid, text, boolean, integer);
DROP FUNCTION IF EXISTS public.capture_archive_owner_revert_v1(uuid, uuid);
DROP TABLE IF EXISTS public.capture_archive_owner_log;
DROP TABLE IF EXISTS public.capture_archive_owner_rules;

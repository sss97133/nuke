-- Revert 20261116242000 capture_junk_and_activity.
-- Refuses while unreverted junk log rows remain. Restores the live #3316
-- ledger bodies (md5 ba4646ae / 52d8f857).

DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.capture_junk_placeholder_log') IS NOT NULL THEN
    SELECT count(*) INTO n FROM public.capture_junk_placeholder_log WHERE reverted_at IS NULL;
    IF n > 0 THEN
      RAISE EXCEPTION 'capture_junk_placeholder: % unreverted log rows; revert those runs first', n;
    END IF;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.capture_junk_placeholder_v1(uuid, uuid, uuid, boolean, integer);
DROP FUNCTION IF EXISTS public.capture_junk_placeholder_revert_v1(uuid, uuid);
DROP FUNCTION IF EXISTS public.capture_activity_blocks_v1(uuid, text, date, date, integer);
DROP TABLE IF EXISTS public.capture_junk_placeholder_log;

\i supabase/sql/helpers/capture_ledger_live_parent_20261116242000.sql

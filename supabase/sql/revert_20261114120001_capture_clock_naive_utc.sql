-- Revert 20261114120000. First undo every write run:
--   SELECT capture_clock_naive_utc_revert('<run>', false);
-- or SELECT capture_clock_backfill_revert('<run>', false);
-- Does not drop capture_clock_backfill_log (owned by 20261113121000).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.capture_clock_backfill_log WHERE reverted_at IS NULL) THEN
    RAISE EXCEPTION 'unreverted capture_clock_backfill runs remain; run capture_clock_backfill_revert(run, false) first';
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.capture_clock_naive_utc_apply(uuid, uuid, timestamptz, jsonb);
DROP FUNCTION IF EXISTS public.capture_clock_naive_utc_revert(uuid, boolean);

-- Revert 20261126103500_deep_reading_feed.sql: drop the reader and its policy-copy row. Move the pages back to the
-- direct select first.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DROP FUNCTION IF EXISTS public.vehicle_deep_reading_feed(uuid, timestamptz, integer, uuid);
DO $r$ BEGIN
  IF to_regclass('public.private_row_policy_copies') IS NOT NULL THEN
    EXECUTE $d$DELETE FROM public.private_row_policy_copies
      WHERE reader = 'vehicle_deep_reading_feed(uuid, timestamp with time zone, integer, uuid)'$d$;
  END IF;
END $r$;
COMMIT;

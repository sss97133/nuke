-- Revert of 20261121101500_timeline_events_read_rule.sql: puts back the open USING (true) read policy and removes
-- the two signed-in read policies that migration added. Not a migration: run only on a decision to go back, through
-- the same deploy path as a migration (copy into a new migration file). Re-running it changes nothing.
--
-- What comes back with it: every row of timeline_events is readable by every role through the API again, apart from
-- the five sources timeline_events_private_source_read (RESTRICTIVE, 20261118160000) holds back. That policy and
-- every other policy on the table are left as they are.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $guard$
DECLARE
  v_open text;
BEGIN
  SELECT qual INTO v_open FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'timeline_events' AND policyname = 'Public can view all timeline events';
  IF FOUND AND v_open IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION '"Public can view all timeline events" exists and is not USING (true); not replacing it: %', v_open;
  END IF;
END $guard$;

DROP POLICY IF EXISTS "Public can view all timeline events" ON public.timeline_events;
CREATE POLICY "Public can view all timeline events" ON public.timeline_events
  AS PERMISSIVE FOR SELECT TO public
  USING (true);

DROP POLICY IF EXISTS timeline_events_author_read ON public.timeline_events;
DROP POLICY IF EXISTS timeline_events_vehicle_reader_read ON public.timeline_events;

COMMIT;

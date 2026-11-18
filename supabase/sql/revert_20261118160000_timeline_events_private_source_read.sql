-- Revert 20261118160000 timeline_events_private_source_read.
-- Drops the restrictive read policy. After this, rows from the account-private sources are readable through the API
-- by anon and authenticated again (the permissive policy "Public can view all timeline events" is USING true), so
-- revert only together with moving those rows out of public.timeline_events.
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP POLICY IF EXISTS timeline_events_private_source_read ON public.timeline_events;
COMMIT;

-- Writes through vehicle_timeline_events obey timeline_events' row policies.
--
-- Measured 2026-10-14. vehicle_timeline_events is `SELECT <every column> FROM timeline_events`. It is owned by
-- postgres (BYPASSRLS), sets no security_invoker, is auto-updatable, and grants INSERT, UPDATE, DELETE and TRUNCATE to
-- anon and authenticated. A plan-only probe as anon (`begin; set local role anon; explain delete from
-- public.vehicle_timeline_events; rollback;`, nothing executed) plans "Delete on timeline_events" with no policy
-- filter, so the public key could delete or rewrite any timeline event and insert events in anyone's name. The web
-- reads the view at 28 sites and writes through it at 12 (inserts by signed-in users with their own user_id;
-- updates by the author; a geocode backfill), so its grants stay and the view runs as its caller instead.
--
-- With security_invoker the caller's row policies apply to reads and writes through the view. Reads are unchanged
-- ("Public can view all timeline events" is USING (true), and anon and authenticated hold SELECT on the table).
-- Inserts keep working for any signed-in user writing their own user_id. One path would break: "Users can update
-- their own timeline events" also requires the author to be vehicles.user_id, so a contributor could no longer attach
-- images to (AddEventWizard) or annotate (CommentService.updateEventNotes) the event they wrote. The added policy lets
-- an author update their own event. All time, 643 events have an author (258 not the vehicle's user_id), the latest
-- on 2026-07-02; the 184,526 events of the last 90 days were all written by the system.
-- Contract: supabase/sql/test_vehicle_timeline_events_invoker.sql (CI job timeline-view-invoker-contract).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';

DO $guard$
DECLARE v text;
BEGIN
  SELECT encode(sha256(convert_to(pg_get_viewdef('public.vehicle_timeline_events'::regclass), 'UTF8')), 'base64') INTO v;
  IF v IS DISTINCT FROM 'kNvtw6hwmei/XvNbqDYisB+PpKwDXR2t2vUGY4sgOQI=' THEN
    RAISE EXCEPTION 'vehicle_timeline_events is not the 2026-10-14 definition this migration was written from (sha256 %)', v;
  END IF;
END $guard$;

ALTER VIEW public.vehicle_timeline_events SET (security_invoker = true);

DROP POLICY IF EXISTS "Authors can update their own timeline events" ON public.timeline_events;
CREATE POLICY "Authors can update their own timeline events" ON public.timeline_events
  AS PERMISSIVE FOR UPDATE TO public
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c, pg_options_to_table(c.reloptions) o
                 WHERE c.oid = 'public.vehicle_timeline_events'::regclass
                   AND o.option_name = 'security_invoker' AND o.option_value IN ('true', 'on'))
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'timeline_events'
                      AND policyname = 'Authors can update their own timeline events' AND cmd = 'UPDATE')
     OR NOT has_table_privilege('anon', 'public.vehicle_timeline_events', 'SELECT') THEN
    RAISE EXCEPTION 'vehicle_timeline_events invoker change did not land as written';
  END IF;
END $check$;

COMMIT;

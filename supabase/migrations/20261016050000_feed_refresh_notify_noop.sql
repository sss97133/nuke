-- Stop serializing every commit that touches vehicles or timeline_events.
--
-- trigger_refresh_feed_items_view() (20250914000001_feed_optimization.sql) runs pg_notify('feed_refresh') once per
-- statement on vehicles, timeline_events and vehicle_images. A transaction holding a pending NOTIFY takes the
-- database-wide notify-queue lock at COMMIT, so every such commit waits for the one before it. Nothing listens on
-- 'feed_refresh': no LISTEN in the repo, and the bulk BaT loader already disables the vehicles trigger as heavy.
-- 2026-10-15 10:51Z (skylar-83): 29 of 42 active backends were COMMITs waiting on Lock/object while intake wrote
-- vehicles; logged-out home-page reads took 8-13 s.
--
-- Replace the function body with a no-op. CREATE OR REPLACE FUNCTION takes no lock on the tables, unlike DROP
-- TRIGGER (ACCESS EXCLUSIVE on vehicles). The triggers stay defined and can be dropped later on a quiet DB.
-- Revert: re-create the function with PERFORM pg_notify('feed_refresh', 'refresh_needed').
SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.trigger_refresh_feed_items_view()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- No-op since 2026-10-16 (see 20261016050000_feed_refresh_notify_noop.sql): nothing listens on 'feed_refresh',
  -- and the NOTIFY serialized every commit on vehicles / timeline_events / vehicle_images.
  RETURN NULL;
END;
$function$;

DO $$
BEGIN
  IF pg_get_functiondef('public.trigger_refresh_feed_items_view'::regproc) ILIKE '%pg_notify%' THEN
    RAISE EXCEPTION 'trigger_refresh_feed_items_view still calls pg_notify';
  END IF;
END $$;

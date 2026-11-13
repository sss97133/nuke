-- vehicle_profile_read: a photo-upload day reads as a photo upload, not "pending analysis".
--
-- WHY. The photo trigger (trg_auto_group_photos, 20261109000400) writes one timeline_events row per photo day with
-- event_type 'pending_analysis' and source 'photo_upload'. Nothing resolves it, and the profile's timeline section
-- folds days by event_type, so the phone printed "pending analysis" for days whose photos were all read (proof
-- vehicle: 6 events on 5 days, every one of them this placeholder, read 2026-11-13 02:04 UTC). The event records
-- that photos were uploaded that day; that is what the day's kind now says.
--
-- WHAT. Anchor patch of the deployed body (marker profile_timeline_photo_upload_v1): in the timeline fold the kind of
-- a 'pending_analysis' event is 'photo_upload'. Counts, days, coverage and every other kind are unchanged; the stored
-- events are untouched.
BEGIN;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '3s';

DO $migration$
DECLARE
  d text := pg_get_functiondef('public.vehicle_profile_read(uuid)'::regprocedure);
  anchor text := $a$coalesce(nullif(btrim(event_type), ''), 'event') AS kind$a$;
  n integer;
BEGIN
  IF position('profile_timeline_photo_upload_v1' in d) = 0 THEN
    n := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    IF n <> 1 THEN RAISE EXCEPTION 'vehicle_profile_read timeline anchor drifted (found % times)', n; END IF;
    d := replace(d, anchor,
      $a$CASE WHEN event_type = 'pending_analysis' THEN 'photo_upload' /* profile_timeline_photo_upload_v1 */
                    ELSE coalesce(nullif(btrim(event_type), ''), 'event') END AS kind$a$);
    EXECUTE d;
  END IF;
END
$migration$;

COMMIT;

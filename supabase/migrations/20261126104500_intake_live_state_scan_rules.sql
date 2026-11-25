-- intake_live_state: the feed's photo readings through the image rule rows.
--
-- WHY. intake_live_state(integer, integer) is SECURITY DEFINER and anon may execute it. Its feed reads each returned
-- photo's byok_deep_analysis raw from vehicle_images.ai_scan_metadata and hands every caller 'line'
-- (narrative_one_line), a path 20261125200000 withholds from strangers (rule row: "model narrative: restates place
-- text"). Live as anon, 2026-11-25 (ta-skeptic2): 50 of 50 feed items carried narrative_one_line raw.
--
-- WHAT. Two anchored edits where the feed reads the analysis after its limit: fi.ai_scan_metadata becomes
-- vehicle_image_scan_metadata(k.id), the id-keyed reader of 20261125200000 (the shown-photo test, then the worker with
-- the compiled rule rows), and that level gets OFFSET 0: the reader is COST 1 and the outer jsonb_build_object names
-- t.bda five times, so a flattened level would call it five times a frame (15 for 3 items, PG17). A stranger's feed
-- item keeps id, car, photo, taken_at, analyzed_at, scene_type, build_phase, intent and confidence, and gets line NULL; the uploader, a tied viewer and service_role read it as before.
-- The reader runs once per returned item (at most 100, the clamped p_feed_limit), after the limit. fleet counts
-- (ai_scan_metadata ? 'byok_deep_analysis') return no reading text and are unchanged; sessions_today is untouched.
-- Guard: the live body is 20261125183500's (prosrc md5 88055328...) or already carries this edit; the reader is live.
-- CONTRACT: supabase/sql/test_intake_live_state_scan_rules.sql (PG17). REVERSAL:
-- supabase/sql/revert_20261126104500_intake_live_state_scan_rules.sql (the 20261125183500 body, md5 checked).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF to_regprocedure('public.vehicle_image_scan_metadata(uuid)') IS NULL THEN
    RAISE EXCEPTION 'vehicle_image_scan_metadata(uuid) is not live; deploy 20261125200000 first';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.intake_live_state(integer,integer)'::regprocedure)
       IS DISTINCT FROM '880553287506d9f991040ba9a2370af5'
     AND position('intake_live_state_scan_rules_v1' IN (SELECT prosrc FROM pg_proc
                    WHERE oid = 'public.intake_live_state(integer,integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'intake_live_state is not the 20261125183500 body; deploy that first or review';
  END IF;
END
$guard$;

DO $edit$
DECLARE
  d text := pg_get_functiondef('public.intake_live_state(integer,integer)'::regprocedure);
  a1 text := $a1$             fi.ai_scan_metadata -> 'byok_deep_analysis' as bda$a1$;
  b1 text := $b1$             -- intake_live_state_scan_rules_v1 (20261126104500): the reading through the id-keyed reader (shown-photo
             -- test, then the image rule rows), once per returned frame (OFFSET 0 below keeps this level, so the five
             -- references to t.bda read one value)
             public.vehicle_image_scan_metadata(k.id) -> 'byok_deep_analysis' as bda$b1$;
  a2 text := $a2$      join vehicle_images fi on fi.id = k.id
    ) t$a2$;
  b2 text := $b2$      join vehicle_images fi on fi.id = k.id
      offset 0
    ) t$b2$;
BEGIN
  IF (length(d) - length(replace(d, a1, ''))) / length(a1) = 1 AND (length(d) - length(replace(d, a2, ''))) / length(a2) = 1 THEN
    EXECUTE replace(replace(d, a1, b1), a2, b2);
  ELSIF position(b1 IN d) = 0 OR position(b2 IN d) = 0 THEN
    RAISE EXCEPTION 'intake_live_state: the feed''s analysis read was not found exactly once';
  END IF;
END
$edit$;

DO $verify$
DECLARE s text := (SELECT prosrc FROM pg_proc WHERE oid = 'public.intake_live_state(integer,integer)'::regprocedure);
BEGIN
  IF position('intake_live_state_scan_rules_v1' IN s) = 0
     OR position($v$fi.ai_scan_metadata -> 'byok_deep_analysis'$v$ IN s) > 0
     OR NOT has_function_privilege('anon', 'public.intake_live_state(integer,integer)', 'EXECUTE')
     OR (SELECT NOT prosecdef FROM pg_proc WHERE oid = 'public.intake_live_state(integer,integer)'::regprocedure) THEN
    RAISE EXCEPTION 'intake_live_state was not edited as expected';
  END IF;
END
$verify$;
COMMIT;

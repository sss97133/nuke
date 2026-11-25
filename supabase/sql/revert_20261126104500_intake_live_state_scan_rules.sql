-- Revert 20261126104500_intake_live_state_scan_rules.sql: the feed reads the analysis raw again (the 20261125183500
-- body, prosrc md5 checked).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
DO $edit$
DECLARE
  d text := pg_get_functiondef('public.intake_live_state(integer,integer)'::regprocedure);
  a1 text := $a1$             -- intake_live_state_scan_rules_v1 (20261126104500): the reading through the id-keyed reader (shown-photo
             -- test, then the image rule rows), once per returned frame (OFFSET 0 below keeps this level, so the five
             -- references to t.bda read one value)
             public.vehicle_image_scan_metadata(k.id) -> 'byok_deep_analysis' as bda$a1$;
  b1 text := $b1$             fi.ai_scan_metadata -> 'byok_deep_analysis' as bda$b1$;
  a2 text := $a2$      join vehicle_images fi on fi.id = k.id
      offset 0
    ) t$a2$;
  b2 text := $b2$      join vehicle_images fi on fi.id = k.id
    ) t$b2$;
BEGIN
  IF (length(d) - length(replace(d, a1, ''))) / length(a1) = 1 AND (length(d) - length(replace(d, a2, ''))) / length(a2) = 1 THEN
    EXECUTE replace(replace(d, a1, b1), a2, b2);
  END IF;
END
$edit$;
DO $verify$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.intake_live_state(integer,integer)'::regprocedure)
     <> '880553287506d9f991040ba9a2370af5' THEN
    RAISE EXCEPTION 'revert did not restore the 20261125183500 body';
  END IF;
END
$verify$;
COMMIT;

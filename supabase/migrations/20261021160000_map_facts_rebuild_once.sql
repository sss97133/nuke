-- map_facts: one full rebuild now, not tomorrow at 09:20 UTC.
--
-- WHY. The first nightly rebuild (2026-10-20 09:20Z) failed on a '_none' county code before any layer landed; #2386
-- (20261021143000) folds such a code as "no county". Until a rebuild runs, the photo layer is empty and the organization
-- snapshot is the hand-run of 05:37Z. The next scheduled run is 2026-10-21 09:20Z.
--
-- WHAT. A one-shot cron job (precedent 20261014031500) that runs rebuild_map_facts() at the next minute with the nightly
-- job's 25-minute budget and removes itself. map-facts-nightly keeps its schedule. Its receipt lands in write_receipts
-- (writer rebuild_map_facts) and in cron.job_run_details; assay_map_facts() reads ok for every layer afterwards.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
SELECT cron.schedule('map-facts-rebuild-once-20261021', '* * * * *',
  $once$SET statement_timeout = '25min'; SELECT public.rebuild_map_facts(); SELECT cron.unschedule('map-facts-rebuild-once-20261021');$once$);
DO $check$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'map-facts-rebuild-once-20261021') THEN
    RAISE EXCEPTION 'the one-shot rebuild was not scheduled';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'map-facts-nightly' AND active) THEN
    RAISE EXCEPTION 'map-facts-nightly is not active';
  END IF;
END $check$;
COMMIT;

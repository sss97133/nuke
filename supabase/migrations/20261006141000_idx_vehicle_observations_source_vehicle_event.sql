-- Index the referencing side of the restrict FK vehicle_observations.source_vehicle_event_id -> vehicle_events(id).
--
-- WHY: migration 20261004162325 added that FK (ON DELETE RESTRICT NOT VALID) "without ... an observation-side index".
-- A NOT VALID FK still installs its RI triggers, so every DELETE on vehicle_events runs
--   SELECT 1 FROM ONLY vehicle_observations WHERE source_vehicle_event_id = $1 FOR KEY SHARE
-- and prod plans it as a Seq Scan over the 7,779 MB heap (10.09M rows; EXPLAIN on prod 2026-10-06, before 13:00Z). That already
-- applies to correct_vehicle_event_link's retire path, and the episode supersession writer (next migration) retires
-- rows the same way. The writer refuses to run until this index is valid.
--
-- Partial (IS NOT NULL): the RI query's "= $1" implies NOT NULL, so the planner can use it, and only the few rows
-- written by the protected BaT archived-sale path carry the column, so the index is small. No row changes.
--
-- Steps (the #691 pattern, made conditional): if an index of this name exists and is INVALID (the artefact of a killed
-- CONCURRENTLY build), drop it CONCURRENTLY; build CONCURRENTLY; then assert the index is valid and RAISE if not, so a
-- failed build fails the deploy instead of leaving an index that IF NOT EXISTS would silently accept next time.
-- The conditional drop uses psql's \gset/\if: the deploy applies each file with psql -f, and DROP/CREATE INDEX
-- CONCURRENTLY cannot run inside a DO block or a transaction. A valid index of this name is kept (re-apply = no-op).
--
-- No BEGIN in this file on purpose (autocommit). The deploy role carries statement_timeout=10s and the deploy sets
-- PGOPTIONS statement_timeout=120s; the build reads the heap twice, so the session override is bounded, never 0.
-- lock_timeout covers CONCURRENTLY's wait for older transactions' virtual xids (the 12:35Z rule after #686), so it is
-- 10 min for the drop and the build, and 5 s for the comment.
SET statement_timeout = '30min';
SET lock_timeout = '10min';

SELECT EXISTS (
  SELECT 1 FROM pg_index
  WHERE indexrelid = to_regclass('public.idx_vehicle_observations_source_vehicle_event') AND NOT indisvalid
) AS v_idx_invalid \gset
\if :v_idx_invalid
DROP INDEX CONCURRENTLY IF EXISTS public.idx_vehicle_observations_source_vehicle_event;
\endif

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicle_observations_source_vehicle_event
  ON public.vehicle_observations (source_vehicle_event_id)
  WHERE source_vehicle_event_id IS NOT NULL;

DO $assert$
BEGIN
  IF NOT coalesce((SELECT indisvalid FROM pg_index
                   WHERE indexrelid = to_regclass('public.idx_vehicle_observations_source_vehicle_event')), false) THEN
    RAISE EXCEPTION 'idx_vehicle_observations_source_vehicle_event is missing or INVALID after the build';
  END IF;
  IF pg_get_indexdef(to_regclass('public.idx_vehicle_observations_source_vehicle_event'))
     NOT LIKE '%(source_vehicle_event_id) WHERE (source_vehicle_event_id IS NOT NULL)' THEN
    RAISE EXCEPTION 'idx_vehicle_observations_source_vehicle_event exists with another definition: %',
      pg_get_indexdef(to_regclass('public.idx_vehicle_observations_source_vehicle_event'));
  END IF;
END;
$assert$;

SET lock_timeout = '5s';
COMMENT ON INDEX public.idx_vehicle_observations_source_vehicle_event IS
'Referencing side of the restrict FK vehicle_observations_source_vehicle_event_id_fkey: makes the RI check behind every vehicle_events DELETE an index probe instead of a scan of the observation heap, and answers "does any observation cite this episode" for supersede_vehicle_event_episode. Partial on IS NOT NULL. Built CONCURRENTLY 2026-10-06.';

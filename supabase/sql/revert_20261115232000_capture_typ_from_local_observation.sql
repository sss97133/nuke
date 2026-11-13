-- Revert 20261115232000 capture_typ_from_local_observation.
-- Refuses while unreverted log rows remain.

DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.capture_typ_from_local_observation_log') IS NOT NULL THEN
    SELECT count(*) INTO n FROM public.capture_typ_from_local_observation_log WHERE reverted_at IS NULL;
    IF n > 0 THEN
      RAISE EXCEPTION 'capture_typ_from_local_observation: % unreverted log rows; revert those runs first', n;
    END IF;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.capture_typ_from_local_observation_v1(uuid, uuid, uuid, boolean, integer);
DROP FUNCTION IF EXISTS public.capture_typ_from_local_observation_revert_v1(uuid, uuid);
DROP TABLE IF EXISTS public.capture_typ_from_local_observation_log;

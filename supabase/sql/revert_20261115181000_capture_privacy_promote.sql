-- Revert 20261115181000 capture_privacy_promote.
-- Refuses to drop the objects if an unreverted promote log row still exists.

DO $$
BEGIN
  IF to_regclass('public.capture_privacy_promote_log') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.capture_privacy_promote_log WHERE reverted_at IS NULL) THEN
    RAISE EXCEPTION 'capture_privacy_promote revert: unreverted log rows remain; run capture_privacy_promote_revert_v1 first';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.capture_privacy_promote_v1(uuid, uuid, uuid, boolean, integer);
DROP FUNCTION IF EXISTS public.capture_privacy_promote_revert_v1(uuid, uuid);
DROP FUNCTION IF EXISTS public.capture_privacy_promote_exclude_add_v1(uuid[], uuid, text);
DROP TABLE IF EXISTS public.capture_privacy_promote_log;
DROP TABLE IF EXISTS public.capture_privacy_promote_exclude;

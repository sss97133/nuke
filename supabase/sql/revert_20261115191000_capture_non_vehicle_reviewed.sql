-- Revert non_vehicle reviewed producer. Refuses if unreverted log rows remain.
-- Restores the 20261115190000 ledger bodies (timeout fix, no non_vehicle state).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.capture_non_vehicle_log WHERE reverted_at IS NULL) THEN
    RAISE EXCEPTION 'capture_non_vehicle_review: revert each run with capture_non_vehicle_review_revert_v1 first';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.capture_non_vehicle_review_revert_v1(uuid, uuid);
DROP FUNCTION IF EXISTS public.capture_non_vehicle_review_v1(uuid, uuid, uuid, jsonb, boolean, integer);
DROP TABLE IF EXISTS public.capture_non_vehicle_log;

\i supabase/sql/helpers/capture_ledger_timeout_20261115190000.sql

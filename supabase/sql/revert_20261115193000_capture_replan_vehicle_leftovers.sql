DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.capture_replan_vehicle_log WHERE reverted_at IS NULL) THEN
    RAISE EXCEPTION 'capture_replan_vehicle_leftovers: revert each run with capture_replan_vehicle_leftovers_revert_v1 first';
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.capture_replan_vehicle_leftovers_revert_v1(uuid, uuid);
DROP FUNCTION IF EXISTS public.capture_replan_vehicle_leftovers_v1(uuid, uuid, uuid, boolean, integer);
DROP TABLE IF EXISTS public.capture_replan_vehicle_log;

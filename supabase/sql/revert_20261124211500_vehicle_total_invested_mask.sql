-- Revert 20261124211500_vehicle_total_invested_mask: the computation takes its name back and answers every caller with
-- amounts again. Re-opens the logged-out spend leak the migration closed; run only to back the change out.
SET statement_timeout = '60s';
SET lock_timeout = '5s';

DO $revert$
BEGIN
  IF to_regprocedure('public.get_vehicle_total_invested_unmasked(uuid)') IS NOT NULL THEN
    DROP FUNCTION public.get_vehicle_total_invested(uuid);
    ALTER FUNCTION public.get_vehicle_total_invested_unmasked(uuid) RENAME TO get_vehicle_total_invested;
  END IF;
END
$revert$;
GRANT EXECUTE ON FUNCTION public.get_vehicle_total_invested(uuid) TO anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.vehicle_viewer_tied(uuid);

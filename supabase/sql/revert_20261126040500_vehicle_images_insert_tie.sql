-- Revert 20261126040500_vehicle_images_insert_tie: removes the restrictive INSERT policy and the client move guard,
-- leaving the seven permissive INSERT policies and the UPDATE policies as they were before it.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
DROP POLICY IF EXISTS vehicle_images_insert_uploader_tied ON public.vehicle_images;
DROP TRIGGER IF EXISTS zz_vehicle_images_client_move_guard ON public.vehicle_images;
DROP FUNCTION IF EXISTS public.vehicle_images_client_move_guard();
COMMIT;

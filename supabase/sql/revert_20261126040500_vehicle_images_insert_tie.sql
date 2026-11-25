-- Revert 20261126040500_vehicle_images_insert_tie: restores the five end-user INSERT policies as they were live on
-- 2026-11-26 (pg_policies text), and removes the two new policies and both guards.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
DROP POLICY IF EXISTS vehicle_images_insert_uploader_tied ON public.vehicle_images;
DROP POLICY IF EXISTS vehicle_images_insert_uploader ON public.vehicle_images;
DROP TRIGGER IF EXISTS a000_vehicle_images_client_insert_guard ON public.vehicle_images;
DROP FUNCTION IF EXISTS public.vehicle_images_client_insert_guard();
DROP TRIGGER IF EXISTS zz_vehicle_images_client_move_guard ON public.vehicle_images;
DROP FUNCTION IF EXISTS public.vehicle_images_client_move_guard();

DROP POLICY IF EXISTS "Authenticated can upload vehicle images" ON public.vehicle_images;
CREATE POLICY "Authenticated can upload vehicle images" ON public.vehicle_images FOR INSERT
  WITH CHECK ((( SELECT auth.uid() AS uid) = submitted_by) OR ((submitted_by IS NULL) AND (( SELECT auth.uid() AS uid) IS NOT NULL)));
DROP POLICY IF EXISTS "Authenticated users can upload images to any vehicle" ON public.vehicle_images;
CREATE POLICY "Authenticated users can upload images to any vehicle" ON public.vehicle_images FOR INSERT
  WITH CHECK ((( SELECT auth.uid() AS uid) IS NOT NULL) AND (( SELECT auth.uid() AS uid) = user_id) AND (vehicle_id IS NOT NULL));
DROP POLICY IF EXISTS "Logged in users can upload images" ON public.vehicle_images;
CREATE POLICY "Logged in users can upload images" ON public.vehicle_images FOR INSERT
  WITH CHECK ((( SELECT auth.uid() AS uid) IS NOT NULL) AND (( SELECT auth.uid() AS uid) = user_id));
DROP POLICY IF EXISTS "Users can insert images for their own vehicles" ON public.vehicle_images;
CREATE POLICY "Users can insert images for their own vehicles" ON public.vehicle_images FOR INSERT
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id) AND ((vehicle_id IS NULL) OR (EXISTS ( SELECT 1 FROM vehicles
    WHERE ((vehicles.id = vehicle_images.vehicle_id) AND (vehicles.user_id = ( SELECT auth.uid() AS uid)))))));
DROP POLICY IF EXISTS users_can_insert_own_images ON public.vehicle_images;
CREATE POLICY users_can_insert_own_images ON public.vehicle_images FOR INSERT
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id) AND ((vehicle_id IS NULL) OR (EXISTS ( SELECT 1 FROM vehicles
    WHERE ((vehicles.id = vehicle_images.vehicle_id) AND (vehicles.user_id = ( SELECT auth.uid() AS uid)))))));
COMMIT;

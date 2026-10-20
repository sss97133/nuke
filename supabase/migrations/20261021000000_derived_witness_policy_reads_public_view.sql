-- observation_witnesses "public_derived_image_witness_read" passed a whole vehicle_images row to
-- vehicle_image_gallery_eligible. Since the anon column grants (20261020190000) anon cannot form that row, so every
-- logged-out read of observation_witnesses failed with 42501 "permission denied for table vehicle_images" (found
-- 2026-10-19 while auditing consumers of the gate after #2320). The view vehicle_images_public carries the same rows and
-- the same gate for a caller without the location/EXIF/device columns (20261020190500); same predicate, read through it.
DROP POLICY IF EXISTS public_derived_image_witness_read ON public.observation_witnesses;
CREATE POLICY public_derived_image_witness_read ON public.observation_witnesses
  FOR SELECT TO anon, authenticated
  USING (
    witness_role = 'derived'
    AND EXISTS (
      SELECT 1
      FROM public.vehicle_observations o
      JOIN public.vehicle_images_public i ON i.id = observation_witnesses.image_id AND i.vehicle_id = o.vehicle_id
      JOIN public.vehicles v ON v.id = o.vehicle_id AND v.is_public IS TRUE
      WHERE o.id = observation_witnesses.observation_id
        AND COALESCE(o.is_superseded, false) = false
        AND (o.structured_data ->> 'image_id') = i.id::text
        AND public.observation_is_public(o.kind, o.structured_data)
        AND COALESCE(i.is_sensitive, false) = false
        AND public.vehicle_image_gallery_eligible(i.*)
    )
  );

-- vehicle_field_sources_read_v1: a car's field sources are read where the car itself is readable.
--
-- WHY. Three permissive SELECT policies opened every row: 'Public read access to field sources' (USING true),
-- 'vfs_select_all' (anon, authenticated, USING true) and 'select readable' (a public car, or any signed-in caller).
-- The hourly exposure assay (private-row-exposure-watch, probe vehicle_field_sources) read 50 of 50 sampled rows of
-- private cars as anon.
--
-- WHAT CHANGES. One SELECT policy for anon and authenticated: the row's vehicle is public and not deleted
-- (is_public = true AND deleted_at IS NULL, stated on vehicles itself), or the caller is tied to it
-- (vehicle_viewer_tied: owner, user, creator, uploader, or a permission holder; true for the service role).
-- Insert and update policies are unchanged.
--
-- CONSUMERS. Every frontend read (VehicleBasicInfo, DataValidationPopup, ValidationPopupV2, UniversalFieldEditor,
-- InlineVINEditor, TitleValidationModal, VehicleDataQualityRating, dynamicFieldService, priceSourceService) filters by
-- the vehicle on screen: a public car keeps every row, and a private car's page is reached only by tied users. SQL
-- readers that are SECURITY DEFINER (get_field_provenance, get_field_audit_trail, get_vehicle_specs,
-- treemap_family_models, ensure_field_evidence, add_dynamic_vehicle_field) and service-role edge functions do not pass
-- through these policies.
-- Contract: supabase/sql/test_vehicle_field_sources_read_policy.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DROP POLICY IF EXISTS "Public read access to field sources" ON public.vehicle_field_sources;
DROP POLICY IF EXISTS vfs_select_all ON public.vehicle_field_sources;
DROP POLICY IF EXISTS "select readable" ON public.vehicle_field_sources;
DROP POLICY IF EXISTS vehicle_field_sources_read ON public.vehicle_field_sources;
CREATE POLICY vehicle_field_sources_read ON public.vehicle_field_sources FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.vehicles v
                  WHERE v.id = vehicle_field_sources.vehicle_id AND v.is_public = true AND v.deleted_at IS NULL)
         OR public.vehicle_viewer_tied(vehicle_field_sources.vehicle_id));

DO $chk$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'vehicle_field_sources'
               AND cmd IN ('SELECT', 'ALL') AND policyname <> 'vehicle_field_sources_read') THEN
    RAISE EXCEPTION 'vehicle_field_sources still has another read policy';
  END IF;
END $chk$;

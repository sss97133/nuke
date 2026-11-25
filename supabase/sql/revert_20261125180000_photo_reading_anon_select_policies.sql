-- Revert of 20261125180000_photo_reading_anon_select_policies.sql: puts back the SELECT policies and grants production
-- held on 2026-11-25. This re-opens every mismatch and condition reading, and the appraisal_canon_checks materialized
-- view, to anon and to every signed-in user, unfiled photos and private cars included.
SET statement_timeout = '30s';
SET lock_timeout = '5s';

BEGIN;
DROP POLICY IF EXISTS image_vehicle_mismatches_select ON public.image_vehicle_mismatches;
DROP POLICY IF EXISTS "Public can view mismatches" ON public.image_vehicle_mismatches;
CREATE POLICY "Public can view mismatches" ON public.image_vehicle_mismatches FOR SELECT USING (true);

DROP POLICY IF EXISTS image_condition_observations_select ON public.image_condition_observations;
DROP POLICY IF EXISTS "Public read image_condition_observations" ON public.image_condition_observations;
CREATE POLICY "Public read image_condition_observations" ON public.image_condition_observations FOR SELECT USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.appraisal_canon_checks TO anon, authenticated;
COMMIT;

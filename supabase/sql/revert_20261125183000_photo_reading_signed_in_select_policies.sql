-- Revert of 20261125183000_photo_reading_signed_in_select_policies.sql: puts back the SELECT policies production held on
-- 2026-11-25 (FOR SELECT TO authenticated USING (true)). This re-opens every angle, spatial and question reading,
-- unfiled photos and private cars included, to every signed-in user.
SET statement_timeout = '30s';
SET lock_timeout = '5s';

BEGIN;
DROP POLICY IF EXISTS image_angle_observations_select ON public.image_angle_observations;
DROP POLICY IF EXISTS allow_authenticated_read_image_angle_observations ON public.image_angle_observations;
CREATE POLICY allow_authenticated_read_image_angle_observations ON public.image_angle_observations FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS ai_angle_classifications_audit_select ON public.ai_angle_classifications_audit;
DROP POLICY IF EXISTS allow_authenticated_read_ai_angle_classifications_audit ON public.ai_angle_classifications_audit;
CREATE POLICY allow_authenticated_read_ai_angle_classifications_audit ON public.ai_angle_classifications_audit FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS image_spatial_metadata_select ON public.image_spatial_metadata;
DROP POLICY IF EXISTS allow_authenticated_read_image_spatial_metadata ON public.image_spatial_metadata;
CREATE POLICY allow_authenticated_read_image_spatial_metadata ON public.image_spatial_metadata FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS image_question_answers_select ON public.image_question_answers;
DROP POLICY IF EXISTS allow_authenticated_read_image_question_answers ON public.image_question_answers;
CREATE POLICY allow_authenticated_read_image_question_answers ON public.image_question_answers FOR SELECT TO authenticated USING (true);
COMMIT;

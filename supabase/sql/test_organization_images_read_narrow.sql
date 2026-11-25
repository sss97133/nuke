-- Disposable PG17 contract for 20261125080000_organization_images_read_narrow (organization_images_read_v1).
-- Synthetic rows only. The table, its grants and its SELECT policies are copied from live (2026-11-24); reads run under
-- SET ROLE anon / authenticated so RLS and column privileges are really applied. Asserts counts and errors only:
--   * anon reads public non-sensitive rows only, never ocr_extracted_data / ai_analysis / ai_description (42501);
--   * a second signed-in user (no tie) reads the same rows as anon and no OCR;
--   * the uploader and the organisation's active owner also read the internal_only row; nobody reads OCR through the API;
--   * the logged-out profile select (its live column list) still succeeds for anon;
--   * extract_work_order_data finds an internal row only for callers RLS admits;
--   * anon has no UPDATE / DELETE; the migration applies twice.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regclass('public.organization_images') IS NOT NULL THEN RAISE EXCEPTION 'Requires an empty disposable database'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
CREATE FUNCTION public.assert(ok boolean, what text) RETURNS void LANGUAGE plpgsql AS
  $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'contract failed: %', what; END IF; END $$;
GRANT EXECUTE ON FUNCTION public.assert(boolean, text) TO anon, authenticated;
-- denied(sql): true when running sql raises insufficient_privilege (42501).
CREATE FUNCTION public.denied(q text) RETURNS boolean LANGUAGE plpgsql AS
  $$ BEGIN EXECUTE q; RETURN false; EXCEPTION WHEN insufficient_privilege THEN RETURN true; END $$;
GRANT EXECUTE ON FUNCTION public.denied(text) TO anon, authenticated;

CREATE TABLE public.business_ownership (business_id uuid, owner_id uuid, status text);
CREATE TABLE public.organization_contributors (organization_id uuid, user_id uuid, status text);
GRANT SELECT ON public.business_ownership, public.organization_contributors TO anon, authenticated;
CREATE TABLE public.organization_images (
  id uuid PRIMARY KEY, organization_id uuid, user_id uuid, image_url text, thumbnail_url text, medium_url text, large_url text,
  taken_at timestamptz, uploaded_at timestamptz, caption text, is_primary boolean, category text, exif_data jsonb,
  latitude numeric, longitude numeric, location_name text, timeline_event_id uuid, created_at timestamptz DEFAULT now(),
  updated_at timestamptz, ai_scanned boolean, ai_scan_date timestamptz, ai_description text, ai_confidence numeric,
  is_sensitive boolean, sensitivity_type text, visibility_level text DEFAULT 'public', blur_preview boolean,
  ocr_extracted_data jsonb, contains_financial_data boolean, ai_analysis jsonb, ai_tags text[], processed_at timestamptz,
  queued_for_analysis boolean, analysis_attempts integer, last_analysis_attempt timestamptz);
ALTER TABLE public.organization_images ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE, DELETE, REFERENCES, TRIGGER ON public.organization_images TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, REFERENCES, TRIGGER ON public.organization_images TO authenticated;
GRANT ALL ON public.organization_images TO service_role;
-- The live SELECT policies (2026-11-24).
CREATE POLICY "Anyone views org images" ON public.organization_images FOR SELECT USING (true);
CREATE POLICY "Public can view org images" ON public.organization_images FOR SELECT USING (true);
CREATE POLICY org_images_contributor_view ON public.organization_images FOR SELECT USING (
  (visibility_level = 'contributor_only') AND ((user_id = (SELECT auth.uid())) OR (organization_id IN (SELECT business_ownership.business_id
   FROM business_ownership WHERE ((business_ownership.owner_id = (SELECT auth.uid())) AND (business_ownership.status = 'active'))))));
CREATE POLICY org_images_internal_view ON public.organization_images FOR SELECT USING (
  (visibility_level = 'internal_only') AND ((organization_id IN (SELECT business_ownership.business_id FROM business_ownership
   WHERE ((business_ownership.owner_id = (SELECT auth.uid())) AND (business_ownership.status = 'active')))) OR (organization_id IN
   (SELECT organization_contributors.organization_id FROM organization_contributors WHERE ((organization_contributors.user_id = (SELECT auth.uid()))
   AND (organization_contributors.status = 'active')))) OR (user_id = (SELECT auth.uid()))));
CREATE POLICY org_images_owner_view ON public.organization_images FOR SELECT USING (
  (visibility_level = 'owner_only') AND ((user_id = (SELECT auth.uid())) OR (organization_id IN (SELECT business_ownership.business_id
   FROM business_ownership WHERE ((business_ownership.owner_id = (SELECT auth.uid())) AND (business_ownership.status = 'active'))))));
CREATE POLICY org_images_public_view ON public.organization_images FOR SELECT USING (
  (((visibility_level = 'public') AND ((is_sensitive IS NULL) OR (is_sensitive = false))) OR ((visibility_level = 'public') AND (user_id = (SELECT auth.uid())))));
CREATE POLICY "Users can update own org images" ON public.organization_images FOR UPDATE
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

-- The live function before the migration: SECURITY DEFINER, anon may execute.
CREATE FUNCTION public.extract_work_order_data(image_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE result JSONB := '{}'::jsonb; img RECORD;
BEGIN
  SELECT * INTO img FROM organization_images WHERE id = image_id;
  IF NOT FOUND THEN RETURN '{"error": "Image not found"}'::jsonb; END IF;
  result := jsonb_build_object('status', 'pending_ocr', 'image_url', img.image_url, 'requires_manual_entry', TRUE);
  RETURN result;
END; $function$;
GRANT EXECUTE ON FUNCTION public.extract_work_order_data(uuid) TO anon, authenticated;
-- The live tie test (20261019210000): active owner or active contributor; callers are not granted it.
CREATE FUNCTION public.work_order_org_member(p_user uuid, p_organization_id uuid) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public' AS $function$
BEGIN
  RETURN p_user IS NOT NULL AND p_organization_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.business_ownership bo WHERE bo.business_id = p_organization_id AND bo.owner_id = p_user AND bo.status = 'active')
    OR EXISTS (SELECT 1 FROM public.organization_contributors oc WHERE oc.organization_id = p_organization_id AND oc.user_id = p_user
      AND oc.status = 'active'));
END $function$;
REVOKE ALL ON FUNCTION public.work_order_org_member(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Organisation 0e1; uploader ...f1, organisation owner ...f2, a stranger ...f3, another organisation's owner ...f4,
-- an active contributor of 0e1 ...f5.
INSERT INTO public.business_ownership VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f2', 'active'),
                                             ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000f4', 'active');
INSERT INTO public.organization_contributors VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f5', 'active');
INSERT INTO public.organization_images (id, organization_id, user_id, image_url, visibility_level, is_sensitive, ocr_extracted_data,
                                        latitude, longitude, exif_data, contains_financial_data) VALUES
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1', 'u1', 'public', false, '{"t":"x"}', 1, 1, '{"location":{}}', false),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1', 'u2', 'public', NULL, '{"t":"x"}', NULL, NULL, NULL, false),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1', 'u3', 'internal_only', true, '{"t":"x"}', 1, 1, '{}', true),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1', 'u4', 'owner_only', false, '{"t":"x"}', 1, 1, '{}', false);

-- Before: the exposure the audit measured.
SET ROLE anon; SELECT set_config('test.uid', '', false);
SELECT public.assert((SELECT count(*) FROM public.organization_images) = 4, 'before: anon reads all 4 rows');
SELECT public.assert((SELECT count(ocr_extracted_data) FROM public.organization_images) = 4, 'before: anon reads OCR');
SELECT public.assert(public.extract_work_order_data('00000000-0000-0000-0000-0000000000b3') ? 'image_url', 'before: anon gets the internal url');
RESET ROLE;

\ir ../migrations/20261125080000_organization_images_read_narrow.sql
\ir ../migrations/20261125080000_organization_images_read_narrow.sql

-- The logged-out profile page's select (OrganizationProfile.tsx, live column list).
\set profile_select 'SELECT id, organization_id, user_id, image_url, thumbnail_url, medium_url, large_url, category, caption, is_primary, taken_at, latitude, longitude, uploaded_at, created_at, is_sensitive, blur_preview, contains_financial_data, location_name, exif_data FROM public.organization_images'

\set base_select 'SELECT id, organization_id, user_id, image_url, thumbnail_url, medium_url, large_url, category, caption, is_primary, taken_at, uploaded_at, created_at, is_sensitive, blur_preview, contains_financial_data FROM public.organization_images'
\set locations 'SELECT count(*) FROM public.organization_image_locations(''00000000-0000-0000-0000-0000000000e1'')'

-- Logged out.
SET ROLE anon; SELECT set_config('test.uid', '', false);
SELECT public.assert((SELECT count(id) FROM public.organization_images) = 2, 'anon: the 2 public non-sensitive rows only');
SELECT public.assert(NOT public.denied(:'profile_select'), 'anon: the old profile select still succeeds');
SELECT public.assert(NOT public.denied(:'base_select'), 'anon: the new base select succeeds');
SELECT public.assert(public.denied(:'locations'), 'anon: cannot execute organization_image_locations');
SELECT public.assert(public.denied('SELECT ocr_extracted_data FROM public.organization_images'), 'anon: OCR denied');
SELECT public.assert(public.denied('SELECT ai_analysis FROM public.organization_images'), 'anon: ai_analysis denied');
SELECT public.assert(public.denied('SELECT ai_description FROM public.organization_images'), 'anon: ai_description denied');
SELECT public.assert(public.denied('SELECT * FROM public.organization_images'), 'anon: select * denied (no whole-row path to OCR)');
SELECT public.assert(public.extract_work_order_data('00000000-0000-0000-0000-0000000000b3') ? 'error', 'anon: internal row not found');
SELECT public.assert(public.extract_work_order_data('00000000-0000-0000-0000-0000000000b1') ? 'image_url', 'anon: public row found');
SELECT public.assert(public.denied('UPDATE public.organization_images SET caption = caption'), 'anon: no UPDATE');
SELECT public.assert(public.denied('DELETE FROM public.organization_images'), 'anon: no DELETE');
RESET ROLE;

-- A second signed-in user with no tie, and another organisation's owner.
SET ROLE authenticated;
SELECT set_config('test.uid', '00000000-0000-0000-0000-0000000000f3', false);
SELECT public.assert((SELECT count(id) FROM public.organization_images) = 2, 'stranger: public rows only');
SELECT public.assert(public.denied('SELECT ocr_extracted_data FROM public.organization_images'), 'stranger: OCR denied');
SELECT public.assert(public.extract_work_order_data('00000000-0000-0000-0000-0000000000b3') ? 'error', 'stranger: internal row not found');
SELECT public.assert((SELECT count(*) FROM public.organization_image_locations('00000000-0000-0000-0000-0000000000e1')) = 0, 'stranger: no locations');
SELECT set_config('test.uid', '00000000-0000-0000-0000-0000000000f4', false);
SELECT public.assert((SELECT count(id) FROM public.organization_images) = 2, 'other organisation owner: public rows only');
SELECT public.assert((SELECT count(*) FROM public.organization_image_locations('00000000-0000-0000-0000-0000000000e1')) = 0, 'other organisation owner: no locations');
SELECT set_config('test.uid', '00000000-0000-0000-0000-0000000000f5', false);
SELECT public.assert((SELECT count(*) FROM public.organization_image_locations('00000000-0000-0000-0000-0000000000e1')) = 3, 'contributor: locations of public + internal rows, not owner_only');

-- Tied: the uploader and the organisation's active owner.
SELECT set_config('test.uid', '00000000-0000-0000-0000-0000000000f1', false);
SELECT public.assert((SELECT count(id) FROM public.organization_images) = 4, 'uploader: all 4 including internal and owner_only');
SELECT public.assert(NOT public.denied(:'profile_select'), 'uploader: the profile select succeeds');
SELECT public.assert(public.extract_work_order_data('00000000-0000-0000-0000-0000000000b3') ? 'image_url', 'uploader: internal row found');
SELECT public.assert(public.denied('SELECT ocr_extracted_data FROM public.organization_images'), 'uploader: OCR stays server-side');
SELECT public.assert((SELECT count(*) FROM public.organization_image_locations('00000000-0000-0000-0000-0000000000e1')) = 4, 'uploader: all 4 locations');
SELECT set_config('test.uid', '00000000-0000-0000-0000-0000000000f2', false);
SELECT public.assert((SELECT count(id) FROM public.organization_images WHERE visibility_level = 'internal_only') = 1, 'org owner: reads the internal row');
SELECT public.assert((SELECT count(*) FROM public.organization_image_locations('00000000-0000-0000-0000-0000000000e1')) = 4, 'org owner: all 4 locations');
RESET ROLE;

SELECT public.assert((SELECT count(*) FROM pg_policies WHERE tablename = 'organization_images' AND cmd = 'SELECT' AND qual = 'true') = 0,
                     'no USING (true) SELECT policy remains');
SELECT public.assert(NOT has_function_privilege('anon', 'public.extract_work_order_data(uuid)', 'execute')
                     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.extract_work_order_data(uuid)'::regprocedure),
                     'extract_work_order_data runs as the caller');

-- The revert restores the before state.
\ir revert_20261125080000_organization_images_read_narrow.sql
SET ROLE anon; SELECT set_config('test.uid', '', false);
SELECT public.assert((SELECT count(ocr_extracted_data) FROM public.organization_images) = 4, 'revert: before state restored');
RESET ROLE;
\echo organization_images_read_narrow: ok

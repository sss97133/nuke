\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' THEN RAISE EXCEPTION 'disposable contract database required'; END IF;
END $$;
CREATE EXTENSION pgcrypto;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;

CREATE TABLE public.vehicle_images (
  id uuid PRIMARY KEY, vehicle_id uuid NOT NULL, user_id uuid,
  is_public boolean DEFAULT true, image_url text, is_primary boolean DEFAULT false,
  taken_at timestamptz, created_at timestamptz DEFAULT '2026-01-01',
  is_duplicate boolean DEFAULT false, is_superseded boolean DEFAULT false,
  is_document boolean DEFAULT false, is_video boolean DEFAULT false,
  source text DEFAULT 'user_upload', image_vehicle_match_status text,
  image_medium text, image_category text, ai_detected_angle text,
  photo_quality_score numeric, vehicle_image_gallery_eligible boolean DEFAULT true,
  exif_data jsonb DEFAULT '{"private":"not exposed"}'
);
ALTER TABLE public.vehicle_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY viewer_images ON public.vehicle_images FOR SELECT USING (is_public OR user_id = auth.uid());
CREATE VIEW public.vehicle_images_public WITH (security_invoker = true) AS
  SELECT id, vehicle_id, image_url, is_primary, taken_at, created_at, is_duplicate,
    is_superseded, is_document, is_video, source, image_vehicle_match_status,
    image_medium, image_category, ai_detected_angle, photo_quality_score,
    vehicle_image_gallery_eligible
  FROM public.vehicle_images;
GRANT SELECT(id, vehicle_id, image_url, is_primary, taken_at, created_at, is_duplicate,
  is_superseded, is_document, is_video, source, image_vehicle_match_status,
  image_medium, image_category, ai_detected_angle, photo_quality_score,
  vehicle_image_gallery_eligible) ON public.vehicle_images TO anon, authenticated;
GRANT SELECT ON public.vehicle_images_public TO anon, authenticated;

INSERT INTO public.vehicle_images(id, vehicle_id, image_url, image_category, ai_detected_angle,
  is_primary, photo_quality_score, taken_at) VALUES
 ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000001',
  'https://example.invalid/exterior.jpg','exterior_body','exterior_three_quarter',false,50,'2025-01-01'),
 ('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000001',
  'https://example.invalid/interior.jpg','interior','interior_dashboard',true,90,'2026-01-01'),
 ('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000002',
  'https://example.invalid/interior-only.jpg','interior','interior_dashboard',true,90,'2026-01-01'),
 ('00000000-0000-4000-8000-000000000402','00000000-0000-4000-8000-000000000004',
  'https://example.invalid/tie-b.jpg','exterior_body','exterior_front',false,50,'2025-01-01'),
 ('00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000004',
  'https://example.invalid/tie-a.jpg','exterior_body','exterior_front',false,50,'2025-01-01');
INSERT INTO public.vehicle_images(id, vehicle_id, image_url, image_category, ai_detected_angle,
  photo_quality_score, vehicle_image_gallery_eligible, is_document, is_video, image_medium)
VALUES
 ('00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000001',
  'https://example.invalid/held.jpg','exterior_body','exterior_three_quarter',999,false,false,false,'photograph'),
 ('00000000-0000-4000-8000-000000000104','00000000-0000-4000-8000-000000000001',
  'https://example.invalid/document.jpg','exterior_body','exterior_three_quarter',999,true,true,false,'photograph'),
 ('00000000-0000-4000-8000-000000000105','00000000-0000-4000-8000-000000000001',
  'https://example.invalid/video.mov','exterior_body','exterior_three_quarter',999,true,false,true,'video'),
 ('00000000-0000-4000-8000-000000000106','00000000-0000-4000-8000-000000000001',
  'https://example.invalid/rendering.jpg','exterior_body','exterior_three_quarter',999,true,false,false,'rendering');
INSERT INTO public.vehicle_images(id, vehicle_id, image_url, source, image_category, ai_detected_angle,
  is_primary, photo_quality_score) VALUES
 ('00000000-0000-4000-8000-000000000107','00000000-0000-4000-8000-000000000001',
  'https://example.invalid/archive.jpg','ssd_blast','exterior_body','exterior_three_quarter',false,999),
 ('00000000-0000-4000-8000-000000000108','00000000-0000-4000-8000-000000000001',
  'https://example.invalid/import.jpg','bat_import','exterior_body','exterior_three_quarter',false,999),
 ('00000000-0000-4000-8000-000000000501','00000000-0000-4000-8000-000000000005',
  'https://example.invalid/native.jpg','capture_relay_ios','exterior_body','exterior_front',false,50),
 ('00000000-0000-4000-8000-000000000601','00000000-0000-4000-8000-000000000006',
  'https://example.invalid/primary-import.jpg','bat_import','exterior_body','exterior_front',true,50);
INSERT INTO public.vehicle_images(id, vehicle_id, image_url, user_id, is_public,
  image_category, ai_detected_angle) VALUES
 ('00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000003',
  'https://example.invalid/private.jpg','00000000-0000-4000-8000-000000000099',false,
  'exterior_body','exterior_front');

\ir ../migrations/20260610120002_first_image_owner_trust_fallback.sql
DO $$ BEGIN
  IF (SELECT image_url FROM public.get_first_image_batch(ARRAY['00000000-0000-4000-8000-000000000001'::uuid]))
      <> 'https://example.invalid/interior.jpg' THEN RAISE EXCEPTION 'baseline failure not reproduced'; END IF;
END $$;
\ir ../migrations/20261031062121_select_structured_garage_covers.sql
SELECT encode(digest(pg_get_functiondef('public.get_first_image_batch(uuid[])'::regprocedure), 'sha256'), 'base64') AS reapply_hash;

SET ROLE anon;
DO $$ BEGIN
  IF has_column_privilege('anon','public.vehicle_images','exif_data','SELECT') THEN RAISE EXCEPTION 'private EXIF grant'; END IF;
  IF (SELECT image_url FROM public.get_first_image_batch(ARRAY['00000000-0000-4000-8000-000000000001'::uuid]))
      <> 'https://example.invalid/exterior.jpg' THEN RAISE EXCEPTION 'exterior must beat legacy interior primary and ineligible media'; END IF;
  IF (SELECT image_url FROM public.get_first_image_batch(ARRAY['00000000-0000-4000-8000-000000000002'::uuid]))
      <> 'https://example.invalid/interior-only.jpg' THEN RAISE EXCEPTION 'retain honest detail-only fallback'; END IF;
  IF EXISTS(SELECT FROM public.get_first_image_batch(ARRAY['00000000-0000-4000-8000-000000000003'::uuid]))
      THEN RAISE EXCEPTION 'private image leaked'; END IF;
  IF (SELECT image_url FROM public.get_first_image_batch(ARRAY['00000000-0000-4000-8000-000000000004'::uuid]))
      <> 'https://example.invalid/tie-a.jpg' THEN RAISE EXCEPTION 'stable ID tie break'; END IF;
  IF (SELECT image_url FROM public.get_first_image_batch(ARRAY['00000000-0000-4000-8000-000000000005'::uuid]))
      <> 'https://example.invalid/native.jpg' THEN RAISE EXCEPTION 'native capture fallback missing'; END IF;
  IF (SELECT image_url FROM public.get_first_image_batch(ARRAY['00000000-0000-4000-8000-000000000006'::uuid]))
      <> 'https://example.invalid/primary-import.jpg' THEN RAISE EXCEPTION 'existing external primary policy changed'; END IF;
  IF (SELECT count(*) FROM public.get_first_image_batch(ARRAY['00000000-0000-4000-8000-000000000001'::uuid,
      '00000000-0000-4000-8000-000000000001'::uuid])) <> 1 THEN RAISE EXCEPTION 'duplicate input multiplied covers'; END IF;
END $$;
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000098',false);
DO $$ BEGIN
  IF EXISTS(SELECT FROM public.get_first_image_batch(ARRAY['00000000-0000-4000-8000-000000000003'::uuid]))
      THEN RAISE EXCEPTION 'another viewer sees private image'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',false);
DO $$ BEGIN
  IF (SELECT image_url FROM public.get_first_image_batch(ARRAY['00000000-0000-4000-8000-000000000003'::uuid]))
      <> 'https://example.invalid/private.jpg' THEN RAISE EXCEPTION 'owner image missing'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT prosecdef FROM pg_proc WHERE oid='public.get_first_image_batch(uuid[])'::regprocedure)
    THEN RAISE EXCEPTION 'selection must retain invoker authorization'; END IF;
END $$;
\ir ../migrations/20261031062121_select_structured_garage_covers.sql
SELECT 'structured garage cover contract passed' AS result;

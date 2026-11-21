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
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;

CREATE TABLE public.vehicle_images (
  id uuid PRIMARY KEY, vehicle_id uuid NOT NULL, user_id uuid,
  is_public boolean DEFAULT true, image_url text, is_primary boolean DEFAULT false,
  taken_at timestamptz, created_at timestamptz DEFAULT '2026-01-01',
  is_duplicate boolean DEFAULT false, is_superseded boolean DEFAULT false,
  is_document boolean DEFAULT false, is_video boolean DEFAULT false,
  source text DEFAULT 'user_upload', image_vehicle_match_status text,
  image_medium text, image_category text, ai_detected_angle text, angle text, vehicle_zone text,
  photo_quality_score numeric, vehicle_image_gallery_eligible boolean DEFAULT true,
  exif_data jsonb DEFAULT '{"private":"not exposed"}',
  vision_gate_status text DEFAULT 'approved', is_sensitive boolean, ai_scan_metadata jsonb
);
ALTER TABLE public.vehicle_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY viewer_images ON public.vehicle_images FOR SELECT USING (is_public OR user_id = auth.uid());
CREATE VIEW public.vehicle_images_public WITH (security_invoker = true) AS
  SELECT id, vehicle_id, image_url, is_primary, taken_at, created_at, is_duplicate,
    is_superseded, is_document, is_video, source, image_vehicle_match_status,
    image_medium, image_category, ai_detected_angle, photo_quality_score,
    vehicle_image_gallery_eligible, angle, vehicle_zone, vision_gate_status, is_sensitive, ai_scan_metadata
  FROM public.vehicle_images;
GRANT SELECT(id, vehicle_id, image_url, is_primary, taken_at, created_at, is_duplicate,
  is_superseded, is_document, is_video, source, image_vehicle_match_status,
  image_medium, image_category, ai_detected_angle, photo_quality_score,
  vehicle_image_gallery_eligible, angle, vehicle_zone, vision_gate_status, is_sensitive, ai_scan_metadata)
  ON public.vehicle_images TO anon, authenticated;
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

-- v3: the lead angle (front three-quarter, driver side first) leads every card that has one; then the primary.
INSERT INTO public.vehicle_images(id, vehicle_id, image_url, image_category, ai_detected_angle, vehicle_zone,
  is_primary, photo_quality_score, taken_at) VALUES
 -- car 7: a better-scored side view, a primary front view and the other front corner lose to the driver side
 ('00000000-0000-4000-8000-000000000701','00000000-0000-4000-8000-000000000007',
  'https://example.invalid/side.jpg','exterior_body','exterior_side','ext_driver_side',false,99,'2026-01-01'),
 ('00000000-0000-4000-8000-000000000702','00000000-0000-4000-8000-000000000007',
  'https://example.invalid/primary-front.jpg','exterior_body','exterior_front','ext_front',true,99,'2026-01-01'),
 ('00000000-0000-4000-8000-000000000703','00000000-0000-4000-8000-000000000007',
  'https://example.invalid/lead-passenger.jpg','exterior_body','exterior_three_quarter','ext_front_passenger',false,80,'2026-01-01'),
 ('00000000-0000-4000-8000-000000000704','00000000-0000-4000-8000-000000000007',
  'https://example.invalid/lead-driver.jpg','exterior_body','exterior_three_quarter','ext_front_driver',false,10,'2025-01-01'),
 -- a close-up of the same corner is not the lead
 ('00000000-0000-4000-8000-000000000705','00000000-0000-4000-8000-000000000007',
  'https://example.invalid/fender-detail.jpg','exterior_body','detail_shot','ext_front_driver',false,99,'2026-02-01'),
 -- car 8: a three-quarter placed at the rear is not a lead; the primary follows
 ('00000000-0000-4000-8000-000000000801','00000000-0000-4000-8000-000000000008',
  'https://example.invalid/rear-34.jpg','exterior_body','exterior_three_quarter','ext_rear_driver',false,99,'2026-01-01'),
 ('00000000-0000-4000-8000-000000000802','00000000-0000-4000-8000-000000000008',
  'https://example.invalid/primary-side.jpg','exterior_body','exterior_side',NULL,true,10,'2025-01-01'),
 -- car 9: an unplaced three-quarter (no zone) is still a lead, over the primary interior
 ('00000000-0000-4000-8000-000000000901','00000000-0000-4000-8000-000000000009',
  'https://example.invalid/unplaced-34.jpg','exterior_body','exterior_three_quarter',NULL,false,10,'2025-01-01'),
 ('00000000-0000-4000-8000-000000000902','00000000-0000-4000-8000-000000000009',
  'https://example.invalid/primary-interior.jpg','interior','interior_dashboard',NULL,true,99,'2026-01-01');
\ir ../migrations/20261121030000_garage_cover_lead_angle.sql
-- The owner's claim from the checks above is still set on this session; a visitor has none.
SELECT set_config('request.jwt.claim.sub','',false);
SET ROLE anon;
DO $$ BEGIN
  IF (SELECT image_url FROM public.get_first_image_batch(ARRAY['00000000-0000-4000-8000-000000000007'::uuid]))
      <> 'https://example.invalid/lead-driver.jpg' THEN RAISE EXCEPTION 'driver-side front three-quarter must lead'; END IF;
  IF (SELECT image_url FROM public.get_first_image_batch(ARRAY['00000000-0000-4000-8000-000000000008'::uuid]))
      <> 'https://example.invalid/primary-side.jpg' THEN RAISE EXCEPTION 'a rear three-quarter is not a lead; the primary follows'; END IF;
  IF (SELECT image_url FROM public.get_first_image_batch(ARRAY['00000000-0000-4000-8000-000000000009'::uuid]))
      <> 'https://example.invalid/unplaced-34.jpg' THEN RAISE EXCEPTION 'an unplaced three-quarter leads over the primary'; END IF;
  -- cars with no lead keep the v2 answers
  IF (SELECT image_url FROM public.get_first_image_batch(ARRAY['00000000-0000-4000-8000-000000000002'::uuid]))
      <> 'https://example.invalid/interior-only.jpg' THEN RAISE EXCEPTION 'v3 lost the detail-only fallback'; END IF;
  IF EXISTS(SELECT FROM public.get_first_image_batch(ARRAY['00000000-0000-4000-8000-000000000003'::uuid]))
      THEN RAISE EXCEPTION 'v3 leaked a private image'; END IF;
  IF (SELECT image_url FROM public.get_first_image_batch(ARRAY['00000000-0000-4000-8000-000000000004'::uuid]))
      <> 'https://example.invalid/tie-a.jpg' THEN RAISE EXCEPTION 'v3 lost the stable ID tie break'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT prosecdef FROM pg_proc WHERE oid='public.get_first_image_batch(uuid[])'::regprocedure)
    THEN RAISE EXCEPTION 'v3 must retain invoker authorization'; END IF;
END $$;
-- v4: the best whole-car exterior leads (garage_cover_class); a car with none keeps the v3 answer.

INSERT INTO public.vehicle_images(id, vehicle_id, image_url, source, is_primary, vehicle_zone, ai_detected_angle,
  image_category, photo_quality_score, taken_at, vision_gate_status, is_sensitive, ai_scan_metadata) VALUES
 -- car 10: the primary is a loose door panel; the whole car is in the owner's cloud import, read by the photo reading only
 ('00000000-0000-4000-8000-000000001001','00000000-0000-4000-8000-000000000010','https://example.invalid/door-panel.jpg',
  'user_upload',true,'panel_door_fl',NULL,NULL,4,'2021-04-07','approved',NULL,
  '{"byok_deep_analysis":{"scene_type":"body_exterior","camera_pose":{"distance_est":"~1.5m","framing":"vertical panel propped against shop steps"},"narrative_one_line":"White door inner panel propped against the steps."}}'),
 ('00000000-0000-4000-8000-000000001002','00000000-0000-4000-8000-000000000010','https://example.invalid/red-coupe.jpg',
  'dropbox_import',false,NULL,NULL,NULL,NULL,'2025-04-30','approved',NULL,
  '{"byok_deep_analysis":{"scene_type":"body_exterior","camera_pose":{"distance_est":"~3.5m","framing":"front driver angled, whole car"},"narrative_one_line":"Front three-quarter of the red coupe on the lot."}}'),
 -- car 11: the zone puts both at the front corner; the reading's words say which is the rear
 ('00000000-0000-4000-8000-000000001101','00000000-0000-4000-8000-000000000011','https://example.invalid/rear-34.jpg',
  'user_upload',false,'ext_front_driver','exterior_three_quarter','exterior_body',99,'2026-01-01','approved',NULL,
  '{"byok_deep_analysis":{"scene_type":"body_exterior","camera_pose":{"azimuth_deg":30,"distance_est":"~3m","framing":"rear passenger angled of whole car"},"narrative_one_line":"Rear 3/4 of the black coupe."}}'),
 ('00000000-0000-4000-8000-000000001102','00000000-0000-4000-8000-000000000011','https://example.invalid/front-34.jpg',
  'user_upload',false,'ext_driver_side','exterior_three_quarter','exterior_body',10,'2024-01-01','approved',NULL,
  '{"byok_deep_analysis":{"scene_type":"body_exterior","camera_pose":{"azimuth_deg":200,"distance_est":"~3m","framing":"front driver angled, whole car"},"narrative_one_line":"Front three-quarter of the black coupe."}}'),
 -- car 12: finished but loaded on a trailer, in primer on open ground, and the dog in a finished frame
 ('00000000-0000-4000-8000-000000001201','00000000-0000-4000-8000-000000000012','https://example.invalid/on-trailer.jpg',
  'user_upload',false,'ext_front_driver','exterior_three_quarter','exterior_body',99,'2026-01-01','approved',NULL,
  '{"byok_deep_analysis":{"scene_type":"off_property","build_phase_guess":"show_finish","state_observations":{"completeness":"assembled"},"camera_pose":{"distance_est":"~4m","framing":"front angled"},"narrative_one_line":"Front three-quarter of the finished truck loaded on the trailer."}}'),
 ('00000000-0000-4000-8000-000000001202','00000000-0000-4000-8000-000000000012','https://example.invalid/primer.jpg',
  'user_upload',false,'ext_front_driver','exterior_three_quarter','exterior_body',10,'2024-01-01','approved',NULL,
  '{"byok_deep_analysis":{"scene_type":"body_exterior","build_phase_guess":"paint_prep","state_observations":{"completeness":"partial"},"camera_pose":{"distance_est":"~4m","framing":"front angled"},"narrative_one_line":"Front three-quarter of the truck in primer on gravel."}}'),
 -- car 13: no frame is classed (one not yet approved, one a close-up the zone calls the front corner): v3 holds
 ('00000000-0000-4000-8000-000000001301','00000000-0000-4000-8000-000000000013','https://example.invalid/unapproved.jpg',
  'user_upload',false,NULL,'exterior_side','exterior_body',99,'2026-01-01',NULL,NULL,
  '{"byok_deep_analysis":{"scene_type":"body_exterior","camera_pose":{"distance_est":"~5m","framing":"full profile"},"narrative_one_line":"Driver-side profile of the truck."}}'),
 ('00000000-0000-4000-8000-000000001302','00000000-0000-4000-8000-000000000013','https://example.invalid/macro.jpg',
  'user_upload',false,'ext_front_driver',NULL,NULL,10,'2024-01-01','approved',NULL,
  '{"byok_deep_analysis":{"scene_type":"body_exterior","camera_pose":{"distance_est":"~0.25m","framing":"macro on a paint blemish"},"narrative_one_line":"Close-up of a clearcoat blemish."}}'),
 -- car 14: a sensitive whole-car frame is never the cover, nor a cloud-import frame that is not a whole car
 ('00000000-0000-4000-8000-000000001401','00000000-0000-4000-8000-000000000014','https://example.invalid/sensitive.jpg',
  'user_upload',false,'ext_front_driver','exterior_three_quarter','exterior_body',99,'2026-01-01','approved',true,NULL),
 ('00000000-0000-4000-8000-000000001402','00000000-0000-4000-8000-000000000014','https://example.invalid/dash.jpg',
  'user_upload',false,'int_dashboard','interior_dashboard','interior',10,'2024-01-01','approved',NULL,NULL),
 ('00000000-0000-4000-8000-000000001403','00000000-0000-4000-8000-000000000014','https://example.invalid/cloud-engine.jpg',
  'dropbox_import',false,'mech_engine_bay',NULL,'engine_mechanical',99,'2026-02-01','approved',NULL,NULL);

-- The failure, reproduced on v3: the door-panel primary and the rear three-quarter lead.
DO $$ BEGIN
  IF (SELECT image_url FROM public.get_first_image_batch(ARRAY['00000000-0000-4000-8000-000000000010'::uuid]))
      <> 'https://example.invalid/door-panel.jpg' THEN RAISE EXCEPTION 'v3 door-panel cover not reproduced'; END IF;
  IF (SELECT image_url FROM public.get_first_image_batch(ARRAY['00000000-0000-4000-8000-000000000011'::uuid]))
      <> 'https://example.invalid/rear-34.jpg' THEN RAISE EXCEPTION 'v3 rear three-quarter cover not reproduced'; END IF;
END $$;
CREATE TEMP TABLE v3_answers AS
  SELECT * FROM public.get_first_image_batch(ARRAY['00000000-0000-4000-8000-000000000002'::uuid,
    '00000000-0000-4000-8000-000000000004'::uuid, '00000000-0000-4000-8000-000000000005'::uuid,
    '00000000-0000-4000-8000-000000000006'::uuid, '00000000-0000-4000-8000-000000000007'::uuid,
    '00000000-0000-4000-8000-000000000008'::uuid, '00000000-0000-4000-8000-000000000009'::uuid,
    '00000000-0000-4000-8000-000000000013'::uuid]);
GRANT SELECT ON v3_answers TO anon, authenticated;

\ir ../migrations/20261121213500_garage_cover_whole_car_rule.sql

-- The rule by itself.
DO $$ BEGIN
  IF public.garage_cover_class(NULL, NULL, NULL, NULL) IS NOT NULL THEN RAISE EXCEPTION 'an unread frame is not a whole car'; END IF;
  IF public.garage_cover_class('int_dashboard', 'interior_dashboard', 'interior', NULL) IS NOT NULL
    THEN RAISE EXCEPTION 'an interior is not a whole car'; END IF;
  IF public.garage_cover_class('ext_front_driver', 'detail_shot', 'exterior_body', NULL) IS NOT NULL
    THEN RAISE EXCEPTION 'one dissenting reading vetoes the frame'; END IF;
  IF public.garage_cover_class('ext_front_driver', NULL, NULL, NULL) <> 102
    THEN RAISE EXCEPTION 'a zone-only front corner: unread finish (100), front three-quarter (0), two readings silent (2)'; END IF;
  IF public.garage_cover_class(NULL, NULL, NULL,
      '{"scene_type":"body_exterior","build_phase_guess":"drivable","state_observations":{"completeness":"assembled"},"presence":{"dog":true},"camera_pose":{"distance_est":"~3m"},"narrative_one_line":"Driver-side profile of the finished car."}') <> 212
    THEN RAISE EXCEPTION 'a finished profile with a dog: dog and side (200), side again as the tie-break (10), two readings silent (2)'; END IF;
END $$;

-- The cover reader, for a visitor.
SELECT set_config('request.jwt.claim.sub','',false);
SET ROLE anon;
DO $$ BEGIN
  IF (SELECT image_url FROM public.get_first_image_batch(ARRAY['00000000-0000-4000-8000-000000000010'::uuid]))
      <> 'https://example.invalid/red-coupe.jpg' THEN RAISE EXCEPTION 'the whole car must beat the door-panel primary'; END IF;
  IF (SELECT image_url FROM public.get_first_image_batch(ARRAY['00000000-0000-4000-8000-000000000011'::uuid]))
      <> 'https://example.invalid/front-34.jpg' THEN RAISE EXCEPTION 'the reading''s words must beat the zone'; END IF;
  IF (SELECT image_url FROM public.get_first_image_batch(ARRAY['00000000-0000-4000-8000-000000000012'::uuid]))
      <> 'https://example.invalid/primer.jpg' THEN RAISE EXCEPTION 'a car on a trailer must not lead over open ground'; END IF;
  IF (SELECT image_url FROM public.get_first_image_batch(ARRAY['00000000-0000-4000-8000-000000000014'::uuid]))
      <> 'https://example.invalid/dash.jpg' THEN RAISE EXCEPTION 'a sensitive frame, or a cloud import that is not a whole car, must never be the cover'; END IF;
  -- every car with no classed frame keeps its v3 answer, the unapproved and close-up car included
  IF EXISTS (SELECT * FROM v3_answers EXCEPT SELECT * FROM public.get_first_image_batch(ARRAY(SELECT vehicle_id FROM v3_answers)))
    OR EXISTS (SELECT * FROM public.get_first_image_batch(ARRAY(SELECT vehicle_id FROM v3_answers)) EXCEPT SELECT * FROM v3_answers)
    THEN RAISE EXCEPTION 'v4 changed a cover with no whole-car frame'; END IF;
  IF EXISTS(SELECT FROM public.get_first_image_batch(ARRAY['00000000-0000-4000-8000-000000000003'::uuid]))
      THEN RAISE EXCEPTION 'v4 leaked a private image'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT prosecdef FROM pg_proc WHERE oid='public.get_first_image_batch(uuid[])'::regprocedure)
    THEN RAISE EXCEPTION 'v4 must retain invoker authorization'; END IF;
END $$;

SELECT 'structured garage cover contract passed' AS result;

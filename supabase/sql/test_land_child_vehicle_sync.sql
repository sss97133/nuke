-- Contract: 20261122232000_land_child_vehicle_sync. Landed classifier rows follow their photo's vehicle: the backfill
-- plans (backs up) every mismatched row, applies in verified batches, skips rows that must be left alone (no stored
-- picture, private, privacy-excluded, the excluded vehicle), and its revert restores exactly what it changed; a re-land
-- and any change to vehicle_images.vehicle_id / vision_gate_status bring the rows along; the three exterior labels get
-- an angle, and the angle re-land is revertible. Other producers' rows in the same tables are not touched.
-- Disposable PG17 only, synthetic rows only.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','p','v','m')) THEN
    RAISE EXCEPTION 'Refusing fixtures outside an empty disposable PG17 database';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE FUNCTION public.t_assert(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;

CREATE TYPE public.vision_gate_status AS ENUM ('approved','pending','rejected_misattributed','rejected_personal','review_needed');
CREATE TABLE public.vehicles(id uuid PRIMARY KEY);
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid REFERENCES public.vehicles(id),
  image_url text, is_sensitive boolean DEFAULT false, vision_gate_status public.vision_gate_status,
  ai_processing_status text, ai_scan_metadata jsonb);
CREATE TABLE public.capture_privacy_promote_exclude(image_id uuid PRIMARY KEY, reason text);
CREATE TABLE public.angle_taxonomy(angle_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), canonical_key text UNIQUE NOT NULL,
  domain text, display_label text, side_applicability text, deprecated_at timestamptz, created_at timestamptz DEFAULT now(),
  replaced_by_angle_id uuid);
INSERT INTO public.angle_taxonomy(canonical_key, domain) VALUES ('engine.bay', 'engine'), ('exterior.front.center', 'exterior');
CREATE TABLE public.image_descriptions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), image_id uuid REFERENCES public.vehicle_images(id),
  vehicle_id uuid, description text, description_type text, source text, source_version text, confidence numeric, evidence jsonb);
CREATE TABLE public.photo_extracted_fields(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), image_id uuid, user_id uuid, vehicle_id uuid,
  field_name text, value text, quote text, confidence numeric, source text, prompt_version text, meta jsonb,
  UNIQUE (image_id, field_name, source));
CREATE TABLE public.photo_text_lines(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), image_id uuid, user_id uuid, vehicle_id uuid,
  line_idx int, text text, region jsonb, confidence numeric, source text, prompt_version text, UNIQUE (image_id, line_idx, source));
CREATE TABLE public.field_evidence(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, field_name text, proposed_value text,
  source_type text, source_confidence int, extraction_context text, raw_extraction_data jsonb,
  UNIQUE (vehicle_id, field_name, source_type, proposed_value));
CREATE TABLE public.image_angle_observations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), image_id uuid, vehicle_id uuid NOT NULL,
  angle_id uuid, confidence numeric, source text, source_version text, evidence jsonb, observed_at timestamptz DEFAULT now());
CREATE TABLE public.image_camera_position(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), image_id uuid, vehicle_id uuid,
  subject_key text, azimuth_deg numeric, elevation_deg numeric, distance_mm numeric, confidence numeric, source text,
  source_version text, evidence jsonb, UNIQUE (image_id, subject_key, source, source_version));
CREATE TABLE public.photo_land_progress(image_id uuid PRIMARY KEY, landed_at timestamptz DEFAULT now(), result jsonb);
CREATE FUNCTION public.photo_plate_code_kind(text) RETURNS TABLE(kind text, code text) LANGUAGE sql AS $$ SELECT NULL::text, NULL::text WHERE false $$;
CREATE FUNCTION public.photo_field_not_about_vehicle(text, text, text, text) RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;

\set v1 '''11111111-0000-4000-8000-000000000001'''
\set v2 '''22222222-0000-4000-8000-000000000002'''
\set vx '''9cf5b7a4-0000-4000-8000-000000000003'''
INSERT INTO vehicles VALUES (:v1), (:v2), (:vx);
-- p1 filed, rows landed while unfiled (NULL); p2 filed on v1, rows still on v2; p3 no stored picture; p4 private;
-- p5 pulled (rejected_misattributed) but rows still on v1; p6 on the excluded vehicle; p7 privacy-excluded.
INSERT INTO vehicle_images (id, vehicle_id, image_url, is_sensitive, vision_gate_status, ai_processing_status, ai_scan_metadata) VALUES
  ('a0000000-0000-4000-8000-000000000001', :v1, 'https://x/1.jpg', false, 'approved', 'completed',
   '{"classification": {"image_type": "vehicle", "confidence": 0.9, "description": "left side of the car", "v2": {"angle": {"value": "exterior_side", "confidence": 0.8}}}}'),
  ('a0000000-0000-4000-8000-000000000002', :v1, 'https://x/2.jpg', false, 'approved', 'completed',
   '{"classification": {"image_type": "vehicle", "confidence": 0.9, "description": "front", "v2": {"angle": {"value": "exterior_front"}}}}'),
  ('a0000000-0000-4000-8000-000000000003', :v1, '', false, 'approved', 'completed', '{}'),
  ('a0000000-0000-4000-8000-000000000004', :v1, 'https://x/4.jpg', false, 'rejected_personal', 'completed', '{}'),
  ('a0000000-0000-4000-8000-000000000005', :v1, 'https://x/5.jpg', false, 'rejected_misattributed', 'completed', '{}'),
  ('a0000000-0000-4000-8000-000000000006', :vx, 'https://x/6.jpg', false, 'approved', 'completed', '{}'),
  ('a0000000-0000-4000-8000-000000000007', :v1, 'https://x/7.jpg', false, 'approved', 'completed', '{}');
INSERT INTO capture_privacy_promote_exclude VALUES ('a0000000-0000-4000-8000-000000000007', 'fixture');
INSERT INTO photo_extracted_fields (image_id, vehicle_id, field_name, value, source) VALUES
  ('a0000000-0000-4000-8000-000000000001', NULL, 'core.image_type', 'vehicle', 'classifier_v2'),
  ('a0000000-0000-4000-8000-000000000001', NULL, 'paint.color', 'red', 'classifier_v2'),
  ('a0000000-0000-4000-8000-000000000002', :v2, 'core.image_type', 'vehicle', 'classifier_v2'),
  ('a0000000-0000-4000-8000-000000000003', NULL, 'core.image_type', 'vehicle', 'classifier_v2'),
  ('a0000000-0000-4000-8000-000000000004', :v1, 'core.image_type', 'vehicle', 'classifier_v2'),
  ('a0000000-0000-4000-8000-000000000005', :v1, 'core.image_type', 'vehicle', 'classifier_v2'),
  ('a0000000-0000-4000-8000-000000000006', NULL, 'core.image_type', 'vehicle', 'classifier_v2'),
  ('a0000000-0000-4000-8000-000000000007', NULL, 'core.image_type', 'vehicle', 'classifier_v2'),
  ('a0000000-0000-4000-8000-000000000001', NULL, 'other.reader', 'x', 'some_other_reader');
INSERT INTO photo_text_lines (image_id, vehicle_id, line_idx, text, source) VALUES
  ('a0000000-0000-4000-8000-000000000001', NULL, 0, 'TRANS AM', 'classifier_v2');
INSERT INTO image_descriptions (image_id, vehicle_id, description, description_type, source) VALUES
  ('a0000000-0000-4000-8000-000000000001', NULL, 'left side', 'classifier_v2', 'photo-pipeline-classifier'),
  ('a0000000-0000-4000-8000-000000000001', NULL, 'a car', 'auto', 'florence2_caption');
INSERT INTO image_angle_observations (image_id, vehicle_id, angle_id, source)
  SELECT 'a0000000-0000-4000-8000-000000000002', :v2, angle_id, 'classifier_v2' FROM angle_taxonomy WHERE canonical_key = 'exterior.front.center';
INSERT INTO image_angle_observations (image_id, vehicle_id, angle_id, source)
  SELECT 'a0000000-0000-4000-8000-000000000005', :v1, angle_id, 'classifier_v2' FROM angle_taxonomy WHERE canonical_key = 'engine.bay';
INSERT INTO image_camera_position (image_id, vehicle_id, subject_key, source, source_version) VALUES
  ('a0000000-0000-4000-8000-000000000002', NULL, 'vehicle', 'byok_deep_analysis', 'review:x');
CREATE TEMP TABLE t_before AS
  SELECT 'pef' t, id, vehicle_id FROM photo_extracted_fields UNION ALL SELECT 'ptl', id, vehicle_id FROM photo_text_lines
  UNION ALL SELECT 'id', id, vehicle_id FROM image_descriptions UNION ALL SELECT 'iao', id, vehicle_id FROM image_angle_observations
  UNION ALL SELECT 'icp', id, vehicle_id FROM image_camera_position;
CREATE TEMP VIEW t_now AS
  SELECT 'pef' t, id, vehicle_id FROM photo_extracted_fields UNION ALL SELECT 'ptl', id, vehicle_id FROM photo_text_lines
  UNION ALL SELECT 'id', id, vehicle_id FROM image_descriptions UNION ALL SELECT 'iao', id, vehicle_id FROM image_angle_observations
  UNION ALL SELECT 'icp', id, vehicle_id FROM image_camera_position;

\ir ../migrations/20261122232000_land_child_vehicle_sync.sql
\ir ../migrations/20261122234500_land_child_vehicle_sync_angle_needs_vehicle.sql
\ir ../migrations/20261122235500_land_child_vehicle_sync_revert_latest_first.sql
SELECT t_assert(NOT has_function_privilege('authenticated', 'public.land_child_vehicle_sync_v1(uuid,integer,integer,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.land_child_vehicle_sync_revert_v1(text)', 'EXECUTE')
  AND NOT has_table_privilege('authenticated', 'public.land_child_vehicle_sync_log', 'SELECT')
  AND has_function_privilege('service_role', 'public.land_child_vehicle_sync_v1(uuid,integer,integer,boolean)', 'EXECUTE'),
  'grants: service_role only');

\set run '''b0000000-0000-4000-8000-000000000001'''
CREATE TEMP TABLE t_plan AS SELECT land_child_vehicle_sync_plan_v1(:run, :v1) AS r;
SELECT t_assert((SELECT count(*) FROM land_child_vehicle_sync_log WHERE run_id = :run AND state = 'planned') = 8,
  'plan: p1 two fields, text line, description; p2 field, angle, camera; p5 field (pulled -> NULL)');
SELECT t_assert((SELECT count(*) FROM land_child_vehicle_sync_log WHERE run_id = :run AND state = 'skipped') = 4
  AND (SELECT array_agg(skip_reason ORDER BY skip_reason) FROM land_child_vehicle_sync_log WHERE run_id = :run AND state = 'skipped')
      = ARRAY['no_stored_picture','privacy_excluded','private','vehicle_required'],
  'plan: no stored picture, private, privacy-excluded rows and a pulled photo''s angle (NOT NULL vehicle) recorded as skipped');
SELECT t_assert(NOT EXISTS (SELECT 1 FROM land_child_vehicle_sync_log l JOIN photo_extracted_fields c ON c.id = l.row_id
  WHERE c.image_id = 'a0000000-0000-4000-8000-000000000006'), 'plan: excluded vehicle not even planned under a v1 scope');
SELECT t_assert((SELECT count(*) FROM t_now n JOIN t_before b USING (t, id) WHERE n.vehicle_id IS DISTINCT FROM b.vehicle_id) = 0,
  'plan writes no child row');
SELECT t_assert((land_child_vehicle_sync_v1(:run, 2, 100, true) ->> 'dry')::boolean, 'dry apply');
SELECT t_assert((SELECT count(*) FROM t_now n JOIN t_before b USING (t, id) WHERE n.vehicle_id IS DISTINCT FROM b.vehicle_id) = 0,
  'dry apply writes nothing');

CREATE TEMP TABLE t_apply AS SELECT land_child_vehicle_sync_v1(:run, 2, 100, false) AS r;
SELECT t_assert((SELECT (r ->> 'batches')::int = 4 AND (r ->> 'still_planned')::int = 0 FROM t_apply), 'apply: 4 batches of 2, none left');
SELECT t_assert((SELECT count(*) FROM photo_extracted_fields WHERE image_id = 'a0000000-0000-4000-8000-000000000001' AND source = 'classifier_v2' AND vehicle_id = :v1) = 2
  AND (SELECT vehicle_id FROM photo_text_lines) = :v1
  AND (SELECT vehicle_id FROM image_descriptions WHERE description_type = 'classifier_v2') = :v1
  AND (SELECT vehicle_id FROM photo_extracted_fields WHERE image_id = 'a0000000-0000-4000-8000-000000000002') = :v1
  AND (SELECT vehicle_id FROM image_angle_observations WHERE image_id = 'a0000000-0000-4000-8000-000000000002') = :v1
  AND (SELECT vehicle_id FROM image_camera_position) = :v1
  AND (SELECT vehicle_id FROM photo_extracted_fields WHERE image_id = 'a0000000-0000-4000-8000-000000000005') IS NULL,
  'apply: rows on the photo''s vehicle, pulled photo''s rows on none');
SELECT t_assert((SELECT vehicle_id FROM photo_extracted_fields WHERE image_id = 'a0000000-0000-4000-8000-000000000003') IS NULL
  AND (SELECT vehicle_id FROM photo_extracted_fields WHERE image_id = 'a0000000-0000-4000-8000-000000000004') = :v1
  AND (SELECT vehicle_id FROM photo_extracted_fields WHERE image_id = 'a0000000-0000-4000-8000-000000000006') IS NULL
  AND (SELECT vehicle_id FROM photo_extracted_fields WHERE image_id = 'a0000000-0000-4000-8000-000000000007') IS NULL
  AND (SELECT vehicle_id FROM photo_extracted_fields WHERE source = 'some_other_reader') IS NULL
  AND (SELECT vehicle_id FROM image_descriptions WHERE description_type = 'auto') IS NULL,
  'apply: skipped photos and other producers'' rows untouched');

CREATE TEMP TABLE t_rev AS SELECT land_child_vehicle_sync_revert_v1(:run) AS r;
SELECT t_assert((SELECT count(*) FROM t_now n JOIN t_before b USING (t, id) WHERE n.vehicle_id IS DISTINCT FROM b.vehicle_id) = 0,
  'revert: every row back to its old vehicle_id');
SELECT t_assert((SELECT count(*) FROM land_child_vehicle_sync_log WHERE run_id = :run AND state = 'reverted') = 8, 'revert: 8 rows marked');

\set run2 '''b0000000-0000-4000-8000-000000000002'''
SELECT land_child_vehicle_sync_plan_v1(:run2, NULL);
SELECT land_child_vehicle_sync_v1(:run2, 50, 1, false);
SELECT t_assert((SELECT vehicle_id FROM photo_extracted_fields WHERE image_id = 'a0000000-0000-4000-8000-000000000006') IS NULL
  AND (SELECT skip_reason FROM land_child_vehicle_sync_log l JOIN photo_extracted_fields c ON c.id = l.row_id
        WHERE l.run_id = :run2 AND c.image_id = 'a0000000-0000-4000-8000-000000000006') = 'excluded_vehicle',
  'platform plan: excluded vehicle skipped');

-- live: off a vehicle and back on
UPDATE vehicle_images SET vehicle_id = NULL WHERE id = 'a0000000-0000-4000-8000-000000000001';
SELECT t_assert((SELECT count(*) FROM photo_extracted_fields WHERE image_id = 'a0000000-0000-4000-8000-000000000001' AND source = 'classifier_v2' AND vehicle_id IS NULL) = 2
  AND (SELECT vehicle_id FROM photo_text_lines) IS NULL AND (SELECT vehicle_id FROM image_descriptions WHERE description_type = 'classifier_v2') IS NULL,
  'live: rows leave with the photo');
UPDATE vehicle_images SET vehicle_id = :v2 WHERE id = 'a0000000-0000-4000-8000-000000000001';
SELECT t_assert((SELECT count(*) FROM photo_extracted_fields WHERE image_id = 'a0000000-0000-4000-8000-000000000001' AND source = 'classifier_v2' AND vehicle_id = :v2) = 2,
  'live: rows follow the photo onto another vehicle');
UPDATE vehicle_images SET vision_gate_status = 'rejected_misattributed' WHERE id = 'a0000000-0000-4000-8000-000000000001';
SELECT t_assert((SELECT vehicle_id FROM photo_text_lines) IS NULL, 'live: a pulled photo''s rows go to no vehicle');
UPDATE vehicle_images SET vision_gate_status = 'approved', vehicle_id = :v1 WHERE id = 'a0000000-0000-4000-8000-000000000001';
SELECT t_assert((SELECT vehicle_id FROM photo_text_lines) = :v1
  AND (SELECT count(*) FROM land_child_vehicle_sync_log WHERE run_id = 'live') > 0, 'live: back on v1, logged as live');
UPDATE vehicle_images SET vehicle_id = :v2 WHERE id = 'a0000000-0000-4000-8000-000000000004';
SELECT t_assert((SELECT vehicle_id FROM photo_extracted_fields WHERE image_id = 'a0000000-0000-4000-8000-000000000004') = :v1,
  'live: a private photo''s rows are left alone');

UPDATE vehicle_images SET vehicle_id = NULL WHERE id = 'a0000000-0000-4000-8000-000000000002';
SELECT t_assert((SELECT vehicle_id FROM photo_extracted_fields WHERE image_id = 'a0000000-0000-4000-8000-000000000002') IS NULL
  AND (SELECT vehicle_id FROM image_camera_position) IS NULL
  AND (SELECT vehicle_id FROM image_angle_observations WHERE image_id = 'a0000000-0000-4000-8000-000000000002') = :v1,
  'live: off a vehicle, rows go to none except the angle row (vehicle required)');
UPDATE vehicle_images SET vehicle_id = :v1 WHERE id = 'a0000000-0000-4000-8000-000000000002';
SELECT t_assert((SELECT vehicle_id FROM photo_extracted_fields WHERE image_id = 'a0000000-0000-4000-8000-000000000002') = :v1, 'live: back on v1');

-- a 'live' revert walks a row's moves back newest first: p1's text line went v1 -> NULL -> v2 -> NULL (pulled) -> v1
-- above; to check the order, move it once more (v1 -> v2) and revert: every entry must unwind, ending on v1.
UPDATE vehicle_images SET vehicle_id = :v2 WHERE id = 'a0000000-0000-4000-8000-000000000001';
SELECT t_assert((SELECT count(*) FROM land_child_vehicle_sync_log l JOIN photo_text_lines c ON c.id = l.row_id
  WHERE l.run_id = 'live' AND l.state = 'applied') = 5, 'live: five moves of the text line logged');
SELECT land_child_vehicle_sync_revert_v1('live');
SELECT t_assert((SELECT vehicle_id FROM photo_text_lines) = :v1
  AND (SELECT count(*) FROM land_child_vehicle_sync_log l JOIN photo_text_lines c ON c.id = l.row_id
        WHERE l.run_id = 'live' AND l.state = 'reverted') = 5,
  'live revert: all five moves unwound newest first, back to the value before the first live change');
UPDATE vehicle_images SET vehicle_id = :v1 WHERE id = 'a0000000-0000-4000-8000-000000000001';
SELECT land_child_vehicle_sync_image(id, 'resync') FROM vehicle_images;

-- re-land updates vehicle_id
UPDATE photo_extracted_fields SET vehicle_id = :v2 WHERE image_id = 'a0000000-0000-4000-8000-000000000002';
CREATE TEMP TABLE t_reland AS SELECT photo_land_classification('a0000000-0000-4000-8000-000000000002', true) AS r;
SELECT t_assert((SELECT (r ->> 'vehicle_synced')::int FROM t_reland) = 1
  AND (SELECT vehicle_id FROM photo_extracted_fields WHERE image_id = 'a0000000-0000-4000-8000-000000000002' AND field_name = 'core.image_type') = :v1,
  're-land: stale vehicle_id updated');

-- angles
SELECT t_assert(photo_land_angle_key('exterior_three_quarter') = 'exterior.three_quarter.unknown' AND photo_land_angle_key('nope') IS NULL, 'angle map');
\set run3 '''b0000000-0000-4000-8000-000000000003'''
SELECT t_assert((land_angle_reland_v1(:run3, :v1, 50, true) ->> 'would_insert')::int = 1, 'angle re-land dry: p1 only');
SELECT t_assert(NOT EXISTS (SELECT 1 FROM image_angle_observations WHERE image_id = 'a0000000-0000-4000-8000-000000000001'), 'angle re-land dry writes nothing');
CREATE TEMP TABLE t_ang AS SELECT land_angle_reland_v1(:run3, :v1, 50, false) AS r;
SELECT t_assert((SELECT (r ->> 'inserted')::int FROM t_ang) = 1
  AND (SELECT a.canonical_key FROM image_angle_observations o JOIN angle_taxonomy a USING (angle_id) WHERE o.image_id = 'a0000000-0000-4000-8000-000000000001') = 'exterior.side.unknown',
  'angle re-land: exterior_side lands as exterior.side.unknown on v1');
SELECT t_assert((land_angle_reland_v1(:run3, :v1, 50, true) ->> 'would_insert')::int = 0, 'angle re-land is idempotent');
SELECT land_child_vehicle_sync_revert_v1(:run3);
SELECT t_assert(NOT EXISTS (SELECT 1 FROM image_angle_observations WHERE image_id = 'a0000000-0000-4000-8000-000000000001'), 'angle re-land revert deletes it');
INSERT INTO vehicle_images (id, vehicle_id, image_url, vision_gate_status, ai_processing_status, ai_scan_metadata) VALUES
  ('a0000000-0000-4000-8000-000000000008', :v1, 'https://x/8.jpg', 'approved', 'completed',
   '{"classification": {"image_type": "vehicle", "confidence": 0.7, "description": "rear quarter", "v2": {"angle": {"value": "exterior_three_quarter"}}}}');
CREATE TEMP TABLE t_land8 AS SELECT photo_land_classification('a0000000-0000-4000-8000-000000000008', true) AS r;
SELECT t_assert((SELECT (r ->> 'angles')::int FROM t_land8) = 1
  AND (SELECT a.canonical_key FROM image_angle_observations o JOIN angle_taxonomy a USING (angle_id) WHERE o.image_id = 'a0000000-0000-4000-8000-000000000008') = 'exterior.three_quarter.unknown',
  'landing: exterior_three_quarter now lands an angle');

-- the follow-ups are re-runnable; the revert file removes all three files' functions
\ir ../migrations/20261122234500_land_child_vehicle_sync_angle_needs_vehicle.sql
\ir ../migrations/20261122235500_land_child_vehicle_sync_revert_latest_first.sql
\ir revert_20261122232000_land_child_vehicle_sync.sql
SELECT t_assert(to_regproc('public.land_child_vehicle_sync_v1') IS NULL AND to_regproc('public.photo_land_angle_key') IS NULL
  AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'a08_trg_land_child_vehicle_sync')
  AND NOT EXISTS (SELECT 1 FROM angle_taxonomy WHERE canonical_key = 'exterior.general')
  AND EXISTS (SELECT 1 FROM angle_taxonomy WHERE canonical_key = 'exterior.three_quarter.unknown'),
  'revert: functions and trigger gone; unused new angle keys removed, used one kept');
SELECT t_assert(NOT (photo_land_classification('a0000000-0000-4000-8000-000000000002', true) ? 'vehicle_synced'), 'revert: previous landing body restored');

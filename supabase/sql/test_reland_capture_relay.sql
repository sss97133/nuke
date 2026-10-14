-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_reland -f supabase/sql/test_reland_capture_relay.sql
-- Proves the re-land writer: it lands a row only for a capture-relay object that exists in storage, takes the uploader
-- from the path, writes the phone's row shape with its provenance, is idempotent by path, and that the orphan lister
-- returns only objects without a row. Stub tables in a disposable database: -- ALLOW_RAW_TESTIMONY_WRITE
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE SCHEMA storage;
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, created_at timestamptz DEFAULT now(), metadata jsonb);
CREATE FUNCTION public.get_service_url() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'https://project.example' $$;
CREATE TABLE public.vehicle_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), image_url text NOT NULL, storage_path text, source text DEFAULT 'user_upload',
  mime_type text, file_name text, file_size bigint, is_external boolean DEFAULT false, ai_processing_status text DEFAULT 'pending',
  user_id uuid, documented_by_user_id uuid, latitude numeric, longitude numeric, taken_at timestamptz, file_hash text,
  apple_ml_labels text[], exif_data jsonb, vehicle_id uuid, created_at timestamptz DEFAULT now());

-- ALLOW_RAW_TESTIMONY_WRITE (stub rows in a disposable database)
INSERT INTO storage.objects (bucket_id, name, created_at, metadata) VALUES
  ('vehicle-photos', 'users/0b9f107a-0000-4000-8000-000000000001/capture-relay/IMG_0001.HEIC', '2026-06-25 18:00+00', '{"size": 3000000, "mimetype": "image/heic"}'),
  ('vehicle-photos', 'users/0b9f107a-0000-4000-8000-000000000001/capture-relay/IMG_0002.HEIC', '2026-06-25 18:01+00', '{"size": 3100000, "mimetype": "image/heic"}'),
  ('vehicle-photos', 'users/0b9f107a-0000-4000-8000-000000000001/capture-relay/IMG_0003.JPG',  '2026-06-26 18:00+00', '{"size": 2000000, "mimetype": "image/jpeg"}'),
  ('vehicle-photos', 'users/0b9f107a-0000-4000-8000-000000000001/other/IMG_0004.HEIC',         '2026-06-26 18:00+00', '{"size": 1000000, "mimetype": "image/heic"}'),
  ('other-bucket',   'users/0b9f107a-0000-4000-8000-000000000001/capture-relay/IMG_0005.HEIC', '2026-06-26 18:00+00', '{"size": 1000000, "mimetype": "image/heic"}');
-- IMG_0002 already has its row (the phone landed it before 06-21).
INSERT INTO public.vehicle_images (image_url, storage_path, source, user_id) VALUES
  ('https://project.example/x', 'users/0b9f107a-0000-4000-8000-000000000001/capture-relay/IMG_0002.HEIC', 'capture_relay_ios', '0b9f107a-0000-4000-8000-000000000001');

\ir ../migrations/20261014034000_reland_capture_relay.sql

DO $$
DECLARE r jsonb; n int; row record; h text := repeat('ab', 32);
BEGIN
  -- The lister: IMG_0001 and IMG_0003 only (0002 has a row; 0004 is outside capture-relay; 0005 is another bucket).
  SELECT count(*) INTO n FROM public.capture_relay_orphans('', 100);
  IF n <> 2 THEN RAISE EXCEPTION 'orphans: % (expected 2)', n; END IF;
  SELECT count(*) INTO n FROM public.capture_relay_orphans('users/0b9f107a-0000-4000-8000-000000000001/capture-relay/IMG_0001.HEIC', 100);
  IF n <> 1 THEN RAISE EXCEPTION 'keyset page after IMG_0001: % (expected 1)', n; END IF;

  -- Lands one frame in the phone's row shape.
  r := public.reland_capture_relay_frame(jsonb_build_object(
    'storage_path', 'users/0b9f107a-0000-4000-8000-000000000001/capture-relay/IMG_0001.HEIC', 'file_hash', h,
    'taken_at', '2026-06-25T17:58:12Z', 'latitude', 36.1, 'longitude', -115.2, 'camera_make', 'Apple', 'camera_model', 'iPhone 11 Pro',
    'user_id', '11111111-1111-4111-8111-111111111111'));  -- a caller-supplied user is ignored: the path decides
  IF r->>'status' <> 'landed' THEN RAISE EXCEPTION 'first land: %', r; END IF;
  SELECT * INTO row FROM public.vehicle_images WHERE id = (r->>'id')::uuid;
  IF row.source <> 'capture_relay_ios' OR row.user_id <> '0b9f107a-0000-4000-8000-000000000001' OR row.documented_by_user_id <> row.user_id
     OR row.image_url <> 'https://project.example/storage/v1/object/public/vehicle-photos/users/0b9f107a-0000-4000-8000-000000000001/capture-relay/IMG_0001.HEIC'
     OR row.mime_type <> 'image/heic' OR row.file_name <> 'IMG_0001.HEIC' OR row.file_size <> 3000000 OR row.is_external
     OR row.ai_processing_status <> 'pending' OR row.vehicle_id IS NOT NULL OR row.file_hash <> h
     OR row.taken_at <> '2026-06-25T17:58:12Z' OR row.latitude <> 36.1 OR row.apple_ml_labels IS NOT NULL THEN
    RAISE EXCEPTION 'row shape: %', row_to_json(row);
  END IF;
  IF row.exif_data->>'synced_by' <> 'capture-relay-ios' OR (row.exif_data->>'owner_verified')::boolean IS NOT TRUE
     OR row.exif_data ? 'uuid' OR row.exif_data->'relanded'->>'by' <> 'reland_capture_relay_frame'
     OR row.exif_data->'relanded'->>'taken_at_basis' <> 'EXIF DateTimeOriginal' THEN
    RAISE EXCEPTION 'provenance: %', row.exif_data;
  END IF;

  -- Idempotent by path: a rerun returns exists, and so does an object the phone already landed.
  r := public.reland_capture_relay_frame(jsonb_build_object('storage_path', 'users/0b9f107a-0000-4000-8000-000000000001/capture-relay/IMG_0001.HEIC', 'file_hash', h));
  IF r->>'status' <> 'exists' THEN RAISE EXCEPTION 'rerun: %', r; END IF;
  r := public.reland_capture_relay_frame(jsonb_build_object('storage_path', 'users/0b9f107a-0000-4000-8000-000000000001/capture-relay/IMG_0002.HEIC', 'file_hash', h));
  IF r->>'status' <> 'exists' THEN RAISE EXCEPTION 'phone row: %', r; END IF;
  SELECT count(*) INTO n FROM public.vehicle_images WHERE storage_path LIKE '%IMG_0001.HEIC';
  IF n <> 1 THEN RAISE EXCEPTION 'rows for IMG_0001: %', n; END IF;

  -- Refusals: not a capture-relay path, an object that does not exist, a bad hash, another bucket.
  r := public.reland_capture_relay_frame(jsonb_build_object('storage_path', 'users/0b9f107a-0000-4000-8000-000000000001/other/IMG_0004.HEIC', 'file_hash', h));
  IF r->>'status' <> 'refused' THEN RAISE EXCEPTION 'other folder: %', r; END IF;
  r := public.reland_capture_relay_frame(jsonb_build_object('storage_path', 'users/0b9f107a-0000-4000-8000-000000000001/capture-relay/IMG_9999.HEIC', 'file_hash', h));
  IF r->>'status' <> 'refused' OR r->>'reason' <> 'no such object in vehicle-photos' THEN RAISE EXCEPTION 'missing object: %', r; END IF;
  r := public.reland_capture_relay_frame(jsonb_build_object('storage_path', 'users/0b9f107a-0000-4000-8000-000000000001/capture-relay/IMG_0003.JPG', 'file_hash', 'nothex'));
  IF r->>'status' <> 'refused' THEN RAISE EXCEPTION 'bad hash: %', r; END IF;

  -- No EXIF date: taken_at stays null and the basis says so.
  r := public.reland_capture_relay_frame(jsonb_build_object('storage_path', 'users/0b9f107a-0000-4000-8000-000000000001/capture-relay/IMG_0003.JPG', 'file_hash', h));
  SELECT * INTO row FROM public.vehicle_images WHERE id = (r->>'id')::uuid;
  IF row.taken_at IS NOT NULL OR row.exif_data->'relanded'->>'taken_at_basis' <> 'absent from the object EXIF' OR row.exif_data ? 'camera_make' THEN
    RAISE EXCEPTION 'no-exif row: %', row_to_json(row);
  END IF;
  SELECT count(*) INTO n FROM public.capture_relay_orphans('', 100);
  IF n <> 0 THEN RAISE EXCEPTION 'orphans after re-land: %', n; END IF;

  -- Only the service role may call either function.
  IF has_function_privilege('anon', 'public.reland_capture_relay_frame(jsonb)', 'execute')
     OR has_function_privilege('authenticated', 'public.capture_relay_orphans(text,integer)', 'execute')
     OR NOT has_function_privilege('service_role', 'public.reland_capture_relay_frame(jsonb)', 'execute') THEN
    RAISE EXCEPTION 'grants are wrong';
  END IF;
  RAISE NOTICE 'reland_capture_relay: lands the phone row shape, idempotent by path, refuses what is not a stranded frame';
END $$;

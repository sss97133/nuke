-- Contract for 20261113130000_private_photo_objects.sql. Synthetic rows only; never production.
--   createdb dm_refinement_private_photo_objects
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_private_photo_objects -f supabase/sql/test_private_photo_objects.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET client_min_messages = notice;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

-- Platform stubs: auth.uid()/auth.role() read settings the test sets; storage as the platform shapes it.
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('test.role', true), ''), 'authenticated') $$;
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
INSERT INTO storage.buckets VALUES ('vehicle-photos', 'vehicle-photos', true), ('vehicle-images', 'vehicle-images', true);

CREATE TABLE public.vehicles (id uuid PRIMARY KEY, owner_id uuid, uploaded_by uuid);
CREATE TABLE public.vehicle_user_permissions (vehicle_id uuid, user_id uuid, role text, is_active boolean);
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY, vehicle_id uuid, user_id uuid, image_url text, thumbnail_url text,
  medium_url text, large_url text, variants jsonb, storage_path text, is_sensitive boolean, redacted_at timestamptz);

\i supabase/migrations/20261113130000_private_photo_objects.sql

\set base 'https://x.supabase.co/storage/v1/object/public'
INSERT INTO vehicles VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000c', NULL);
INSERT INTO vehicle_images (id, vehicle_id, user_id, image_url, variants, storage_path, is_sensitive) VALUES
  -- a title: image_url plus two variants in another public bucket
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000c',
   :'base' || '/vehicle-images/a1/title.jpeg',
   jsonb_build_object('full', :'base' || '/vehicle-images/a1/title.jpeg', 'thumb', :'base' || '/vehicle-images/a1/title_t.jpeg', 'ext', 'https://elsewhere.example/x.jpg'),
   'a1/title.jpeg', true),
  -- a shipping label whose file a public duplicate row also uses
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000c',
   :'base' || '/vehicle-photos/users/c/label.heic', '{}', NULL, true),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000c',
   :'base' || '/vehicle-photos/users/c/label.heic', '{}', NULL, false),
  -- a public photo: never queued
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000c',
   :'base' || '/vehicle-photos/users/c/truck.jpg', '{}', NULL, false);

SELECT pg_temp.ok('private bucket is not public', (SELECT NOT public FROM storage.buckets WHERE id = 'vehicle-photos-private'));
SELECT pg_temp.ok('photo_public_objects reads image_url and variants, ignores outside URLs',
  (SELECT count(*) = 2 AND bool_and(bucket = 'vehicle-images') FROM photo_public_objects('00000000-0000-0000-0000-0000000000e1')));

CREATE TABLE pg_temp.p1 AS SELECT plan_private_photo_moves(100, 'contract') r;
SELECT pg_temp.ok('two title files queued, the shared label skipped',
  (SELECT (r->>'queued')::int = 2 AND (r->>'skipped_shared')::int = 1 FROM pg_temp.p1));
SELECT pg_temp.ok('private key keeps the way back', (SELECT bool_and(private_key = source_bucket || '/' || source_key) FROM private_photo_objects));
SELECT pg_temp.ok('the public photo is not queued',
  NOT EXISTS (SELECT 1 FROM private_photo_objects WHERE image_id = '00000000-0000-0000-0000-0000000000e4'));
SELECT pg_temp.ok('planning twice queues nothing new', (plan_private_photo_moves(100, 'again')->>'queued')::int = 0);

-- The mover marks the title files moved (simulated) and the files exist in the private bucket.
UPDATE private_photo_objects SET status = 'moved', moved_at = now() WHERE image_id = '00000000-0000-0000-0000-0000000000e1';
INSERT INTO storage.objects (bucket_id, name) SELECT 'vehicle-photos-private', private_key FROM private_photo_objects WHERE status = 'moved';

-- Read rules.
GRANT USAGE ON SCHEMA storage, public, auth TO authenticated, anon;
GRANT SELECT ON storage.objects TO authenticated, anon;
SET test.uid = '00000000-0000-0000-0000-00000000000c';
SET ROLE authenticated;
SELECT pg_temp.ok('owner reads both moved files', (SELECT count(*) = 2 FROM storage.objects WHERE bucket_id = 'vehicle-photos-private'));
SELECT pg_temp.ok('owner gets signing keys', (SELECT count(*) = 2 FROM private_photo_signing_keys('00000000-0000-0000-0000-0000000000e1')));
RESET ROLE;
SET test.uid = '00000000-0000-0000-0000-0000000000ff';
SET ROLE authenticated;
SELECT pg_temp.ok('another signed-in user reads nothing', (SELECT count(*) = 0 FROM storage.objects WHERE bucket_id = 'vehicle-photos-private'));
SELECT pg_temp.ok('another user gets no signing keys', (SELECT count(*) = 0 FROM private_photo_signing_keys('00000000-0000-0000-0000-0000000000e1')));
RESET ROLE;
SET ROLE anon;
SELECT pg_temp.ok('anon reads nothing', (SELECT count(*) = 0 FROM storage.objects WHERE bucket_id = 'vehicle-photos-private'));
RESET ROLE;
SELECT pg_temp.ok('anon cannot read the queue', NOT has_table_privilege('anon', 'public.private_photo_objects', 'SELECT'));
SELECT pg_temp.ok('anon cannot plan', NOT has_function_privilege('anon', 'public.plan_private_photo_moves(integer,text)', 'EXECUTE'));

-- Un-hiding the title sends its files back; re-hiding queues them again.
UPDATE vehicle_images SET is_sensitive = false WHERE id = '00000000-0000-0000-0000-0000000000e1';
SELECT pg_temp.ok('un-hidden photo goes to restore_pending', (plan_private_photo_moves(100, 'unhide')->>'restore_pending')::int = 2);
UPDATE private_photo_objects SET status = 'restored', restored_at = now() WHERE status = 'restore_pending';
UPDATE vehicle_images SET is_sensitive = true WHERE id = '00000000-0000-0000-0000-0000000000e1';
SELECT pg_temp.ok('re-hidden photo is queued again', (plan_private_photo_moves(100, 'rehide')->>'requeued')::int = 2);

SELECT 'test_private_photo_objects: all contracts passed' AS result;

-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_storage_policies -f this-file.sql
-- Proves the open storage policies and their fix. With the policies production has on storage.objects for the
-- vehicle-images and dealerscan-documents buckets (2026-10-14), a caller with no identity lists every object in both,
-- uploads into vehicle-images, and overwrites or deletes any of its objects. After the migration that caller does
-- none of it; a signed-in user uploads, and lists, overwrites and deletes only their own objects; dealer documents
-- stay per-user; a role that bypasses row security (the service role) still reads everything. A second run is a
-- no-op, and a drifted policy stops the migration unchanged.
-- The rows below are a disposable test database's rows, never production objects.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regnamespace('storage') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
-- As on production (pg_roles.rolbypassrls, 2026-10-14).
ALTER ROLE service_role BYPASSRLS;

-- storage.objects as the storage server shapes it, the columns the policies touch.
CREATE SCHEMA storage;
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text,
  owner uuid, owner_id text, UNIQUE (bucket_id, name));
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE _parts text[];
BEGIN
  SELECT string_to_array(name, '/') INTO _parts;
  RETURN _parts[1:array_length(_parts, 1) - 1];
END $$;
GRANT USAGE ON SCHEMA storage, auth TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated, service_role;

-- The policies production has for the two buckets on 2026-10-14, plus one unrelated bucket's read.
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicle_images_read ON storage.objects FOR SELECT USING (bucket_id = 'vehicle-images');
CREATE POLICY vehicle_images_upload ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'vehicle-images');
CREATE POLICY vehicle_images_update ON storage.objects FOR UPDATE USING (bucket_id = 'vehicle-images') WITH CHECK (bucket_id = 'vehicle-images');
CREATE POLICY vehicle_images_delete ON storage.objects FOR DELETE USING (bucket_id = 'vehicle-images');
CREATE POLICY "ds_storage_user_upload" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'dealerscan-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "ds_storage_user_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'dealerscan-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "ds_storage_user_delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'dealerscan-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "ds_storage_service_all" ON storage.objects FOR ALL USING (bucket_id = 'dealerscan-documents');
CREATE POLICY "magazines public read" ON storage.objects FOR SELECT USING (bucket_id = 'magazines');

-- U1 and U2 are signed-in users. vehicle-images holds one object each and one an import wrote (no owner);
-- dealerscan-documents holds one document in each user's folder; magazines holds one public object.
INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES
 ('vehicle-images', 'v1/u1-frame.jpg', '60000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001'),
 ('vehicle-images', 'v2/u2-frame.jpg', '60000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002'),
 ('vehicle-images', 'receipts/import.jpg', NULL, NULL),
 ('dealerscan-documents', '60000000-0000-0000-0000-000000000001/jacket.pdf', '60000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001'),
 ('dealerscan-documents', '60000000-0000-0000-0000-000000000002/jacket.pdf', '60000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002'),
 ('magazines', 'issue-1.pdf', NULL, NULL);

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text) TO anon, authenticated, service_role;
-- The objects a role sees, as a sorted list.
CREATE FUNCTION public.t_seen() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(string_agg(bucket_id || ':' || name, ',' ORDER BY bucket_id, name), '') FROM storage.objects $$;
GRANT EXECUTE ON FUNCTION public.t_seen() TO anon, authenticated, service_role;

-- 1. Before the fix: no identity lists both buckets, uploads, overwrites and deletes. Rolled back after.
SET ROLE anon;
SET test.auth_uid = '';
DO $$
DECLARE n int;
BEGIN
  BEGIN
    PERFORM public.t_assert(public.t_seen() = 'dealerscan-documents:60000000-0000-0000-0000-000000000001/jacket.pdf,'
      || 'dealerscan-documents:60000000-0000-0000-0000-000000000002/jacket.pdf,magazines:issue-1.pdf,'
      || 'vehicle-images:receipts/import.jpg,vehicle-images:v1/u1-frame.jpg,vehicle-images:v2/u2-frame.jpg',
      format('before the fix anon lists both buckets; got %s', public.t_seen()));
    INSERT INTO storage.objects (bucket_id, name) VALUES ('vehicle-images', 'anon/planted.jpg');
    UPDATE storage.objects SET name = 'v1/replaced.jpg' WHERE bucket_id = 'vehicle-images' AND name = 'v1/u1-frame.jpg';
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM public.t_assert(n = 1, 'before the fix anon overwrites a user''s object');
    DELETE FROM storage.objects WHERE bucket_id = 'vehicle-images' AND name = 'receipts/import.jpg';
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM public.t_assert(n = 1, 'before the fix anon deletes an object');
    DELETE FROM storage.objects WHERE bucket_id = 'dealerscan-documents';
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM public.t_assert(n = 2, 'before the fix anon deletes dealer documents');
    RAISE EXCEPTION 'roll back the before-state writes';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'roll back the before-state writes' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
SELECT public.t_assert((SELECT count(*) FROM storage.objects) = 6, 'the before-state writes rolled back');

-- 2. The fix.
\ir ../migrations/20261014023000_storage_objects_close_open_policies.sql

-- 3. After the fix: no identity sees, uploads, overwrites or deletes anything in either bucket.
SET ROLE anon;
SET test.auth_uid = '';
DO $$
DECLARE n int; refused boolean := false;
BEGIN
  PERFORM public.t_assert(public.t_seen() = 'magazines:issue-1.pdf', format('after the fix anon lists neither bucket; got %s', public.t_seen()));
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('vehicle-images', 'anon/planted.jpg');
  EXCEPTION WHEN insufficient_privilege THEN refused := true;
  END;
  PERFORM public.t_assert(refused, 'after the fix anon cannot upload into vehicle-images');
  UPDATE storage.objects SET name = 'v1/replaced.jpg' WHERE bucket_id = 'vehicle-images' AND name = 'v1/u1-frame.jpg';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public.t_assert(n = 0, 'after the fix anon overwrites nothing');
  DELETE FROM storage.objects WHERE bucket_id IN ('vehicle-images', 'dealerscan-documents');
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public.t_assert(n = 0, 'after the fix anon deletes nothing');
END $$;
RESET ROLE;

-- 4. A signed-in user uploads, and lists, overwrites and deletes only their own objects.
SET ROLE authenticated;
SET test.auth_uid = '60000000-0000-0000-0000-000000000002';
DO $$
DECLARE n int;
BEGIN
  PERFORM public.t_assert(public.t_seen() = 'dealerscan-documents:60000000-0000-0000-0000-000000000002/jacket.pdf,'
    || 'magazines:issue-1.pdf,vehicle-images:v2/u2-frame.jpg', format('U2 lists only its own; got %s', public.t_seen()));
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES
    ('vehicle-images', 'v2/u2-second.jpg', '60000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002');
  UPDATE storage.objects SET name = 'v1/replaced.jpg' WHERE bucket_id = 'vehicle-images' AND name = 'v1/u1-frame.jpg';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public.t_assert(n = 0, 'U2 cannot overwrite U1''s object');
  DELETE FROM storage.objects WHERE bucket_id = 'vehicle-images' AND name IN ('v1/u1-frame.jpg', 'receipts/import.jpg');
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public.t_assert(n = 0, 'U2 cannot delete U1''s object or the import''s');
  UPDATE storage.objects SET name = 'v2/u2-renamed.jpg' WHERE bucket_id = 'vehicle-images' AND name = 'v2/u2-frame.jpg';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public.t_assert(n = 1, 'U2 overwrites its own object');
  DELETE FROM storage.objects WHERE bucket_id = 'vehicle-images' AND name = 'v2/u2-second.jpg';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public.t_assert(n = 1, 'U2 deletes its own object');
END $$;
SET test.auth_uid = '60000000-0000-0000-0000-000000000001';
SELECT public.t_assert(public.t_seen() = 'dealerscan-documents:60000000-0000-0000-0000-000000000001/jacket.pdf,'
  || 'magazines:issue-1.pdf,vehicle-images:v1/u1-frame.jpg', format('U1 lists only its own; got %s', public.t_seen()));
RESET ROLE;
SET test.auth_uid = '';

-- 5. The service role bypasses row security and still reads everything.
SET ROLE service_role;
SELECT public.t_assert((SELECT count(*) FROM storage.objects) = 6, format('the service role reads all six; got %s', public.t_seen()));
RESET ROLE;

-- 6. A second run is a no-op.
\ir ../migrations/20261014023000_storage_objects_close_open_policies.sql
SELECT public.t_assert((SELECT count(*) FROM pg_policy WHERE polrelid = 'storage.objects'::regclass) = 8, 'eight policies after the rerun');
SELECT public.t_assert(NOT EXISTS (SELECT FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname = 'ds_storage_service_all'),
  'the open dealer-document policy is gone');

-- 7. A drifted policy stops the migration and is left as found.
DROP POLICY vehicle_images_read ON storage.objects;
CREATE POLICY vehicle_images_read ON storage.objects FOR SELECT USING (bucket_id = 'vehicle-images' AND name LIKE 'public/%');
\echo 'Expected: one ERROR from the drift guard below.'
\set ON_ERROR_STOP off
\ir ../migrations/20261014023000_storage_objects_close_open_policies.sql
\set ON_ERROR_STOP on
SELECT public.t_assert(
  (SELECT pg_get_expr(polqual, polrelid) FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname = 'vehicle_images_read')
    LIKE '%public/%', 'a drifted policy is not overwritten');
SELECT 'storage objects open policies contract: PASS' AS result;

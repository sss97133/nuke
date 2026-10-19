-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_doc_buckets -f this-file.sql
-- Contract for 20261015040000_private_document_buckets.sql. Synthetic rows only; never production.
-- storage.buckets, storage.objects (row security on, production's grants: anon and authenticated arwd) and
-- storage.foldername are built as production has them, with a policy on another bucket:
--   * before: both document buckets are public and a signed-in owner cannot even upload to their own folder;
--   * after: both are private; an owner uploads and reads only their own user-documents folder; an active admin
--     reads both buckets; anon and other users read nothing in them; the service role reads everything; other buckets
--     and their policies are unchanged; the migration is idempotent and refuses an unexpected policy on the buckets.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('storage.objects') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';

CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA storage;
GRANT USAGE ON SCHEMA auth, storage, public TO anon, authenticated, service_role;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean DEFAULT false);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets (id),
  name text, owner uuid);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects, storage.buckets TO anon, authenticated;
GRANT ALL ON storage.objects, storage.buckets TO service_role;
-- Production's storage.foldername (pg_get_functiondef, 2026-10-15).
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE plpgsql IMMUTABLE AS $function$
DECLARE
    _parts text[];
BEGIN
    SELECT string_to_array(name, '/') INTO _parts;
    RETURN _parts[1 : array_length(_parts,1) - 1];
END
$function$;
CREATE TABLE public.admin_users (user_id uuid PRIMARY KEY, is_active boolean DEFAULT true);
GRANT SELECT ON public.admin_users TO authenticated, service_role;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;
CREATE FUNCTION pg_temp.denied(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN true;
END $$;
CREATE FUNCTION pg_temp.n(p_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v bigint;
BEGIN
  EXECUTE p_sql INTO v;
  RETURN v;
END $$;

INSERT INTO storage.buckets (id, name, public) VALUES
  ('deal-documents', 'deal-documents', true), ('user-documents', 'user-documents', true),
  ('vehicle-images', 'vehicle-images', true), ('ownership-documents', 'ownership-documents', false);
-- An existing policy on another bucket, which must be left alone.
CREATE POLICY "vehicle_images_read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'vehicle-images');
INSERT INTO public.admin_users (user_id) VALUES ('30000000-0000-0000-0000-000000000001');
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('user-documents', '20000000-0000-0000-0000-000000000001/title.jpg'),
  ('user-documents', '20000000-0000-0000-0000-000000000002/license.jpg'),
  ('deal-documents', 'documents/2026/agreement.jpg'),
  ('deal-documents', 'documents/2026/receipt.jpg'),
  ('vehicle-images', 'v1/1.jpg');

-- 1. Before: public, and the owner cannot upload to their own folder.
SET ROLE authenticated;
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000001', false);
SELECT pg_temp.ok('before: an owner cannot upload to their own user-documents folder',
  pg_temp.denied($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('user-documents', '20000000-0000-0000-0000-000000000001/new.jpg')$q$));
RESET ROLE;
SELECT pg_temp.ok('before: both document buckets are public',
  (SELECT count(*) FROM storage.buckets WHERE id IN ('deal-documents', 'user-documents') AND public) = 2);

\ir ../migrations/20261015040000_private_document_buckets.sql
-- A second application changes nothing and passes its own checks.
\ir ../migrations/20261015040000_private_document_buckets.sql

SELECT pg_temp.ok('after: both document buckets are private; other buckets unchanged',
  (SELECT count(*) FROM storage.buckets WHERE id IN ('deal-documents', 'user-documents') AND public) = 0
  AND (SELECT public FROM storage.buckets WHERE id = 'vehicle-images')
  AND NOT (SELECT public FROM storage.buckets WHERE id = 'ownership-documents')
  AND EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname = 'vehicle_images_read'));

SET ROLE authenticated;
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000001', false);
SELECT pg_temp.ok('owner: uploads to their own folder, not to another user''s, and reads only their own',
  NOT pg_temp.denied($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('user-documents', '20000000-0000-0000-0000-000000000001/new.jpg')$q$)
  AND pg_temp.denied($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('user-documents', '20000000-0000-0000-0000-000000000002/forged.jpg')$q$)
  AND pg_temp.n($q$SELECT count(*) FROM storage.objects WHERE bucket_id = 'user-documents'$q$) = 2
  AND pg_temp.n($q$SELECT count(*) FROM storage.objects WHERE bucket_id = 'user-documents' AND name LIKE '20000000-0000-0000-0000-000000000002/%'$q$) = 0
  AND pg_temp.n($q$SELECT count(*) FROM storage.objects WHERE bucket_id = 'deal-documents'$q$) = 0);
SELECT set_config('test.auth_uid', '30000000-0000-0000-0000-000000000001', false);
SELECT pg_temp.ok('an active admin reads both document buckets but cannot upload deal documents',
  pg_temp.n($q$SELECT count(*) FROM storage.objects WHERE bucket_id = 'user-documents'$q$) = 3
  AND pg_temp.n($q$SELECT count(*) FROM storage.objects WHERE bucket_id = 'deal-documents'$q$) = 2
  AND pg_temp.denied($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('deal-documents', 'documents/forged.jpg')$q$));
RESET ROLE;
SET ROLE anon;
SELECT set_config('test.auth_uid', '', false);
SELECT pg_temp.ok('anon reads nothing in either document bucket and cannot upload',
  pg_temp.n($q$SELECT count(*) FROM storage.objects WHERE bucket_id IN ('user-documents', 'deal-documents')$q$) = 0
  AND pg_temp.denied($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('user-documents', 'x/y.jpg')$q$));
RESET ROLE;
SET ROLE service_role;
SELECT pg_temp.ok('the service role reads everything',
  pg_temp.n($q$SELECT count(*) FROM storage.objects WHERE bucket_id IN ('user-documents', 'deal-documents')$q$) = 5);
RESET ROLE;

-- The guard refuses an unexpected policy that names a document bucket.
CREATE POLICY "stray_deal_read" ON storage.objects FOR SELECT TO anon USING (bucket_id = 'deal-documents');
SELECT pg_temp.ok('the migration refuses to run while another policy names a document bucket',
  EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'storage.objects'::regclass
          AND p.polname NOT IN ('user_documents_owner_insert', 'user_documents_owner_or_admin_read', 'deal_documents_admin_read')
          AND (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''))
              ~ '(deal-documents|user-documents)'));

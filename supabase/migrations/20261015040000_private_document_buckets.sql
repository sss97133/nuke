-- deal-documents and user-documents become private; owners and active admins read through signed URLs.
--
-- Measured 2026-10-14/15: both buckets were public, so storage served any file to anyone holding its URL (a
-- logged-out HEAD on one object of each returned 200). deal-documents holds 919 title, agreement and receipt photos
-- (913 deal_documents.photo_path rows and 1 vehicle_documents.file_url row store full public URLs to it);
-- user-documents holds 43 title and ID scans, each under its owner's user-id folder. No storage.objects policy named
-- either bucket, so a signed-in owner could neither upload nor sign their own file: only the public URL worked.
-- Readers were moved to signed URLs first (fix(storage): sign reads of the document buckets, #1260): TitleScan,
-- secureDocumentService and adminNotificationService already signed; derive-title-ownership and document-ocr-worker
-- read with the service key, which bypasses these policies.
-- Policies added (TO authenticated; anon gets nothing; the service role bypasses row security):
--   user-documents: an owner inserts and reads objects under their own user-id folder; an active admin reads all.
--   deal-documents: an active admin reads (uploads come from service-role pipelines only).
-- Then both buckets are set public = false. Other buckets are untouched.
-- Contract: supabase/sql/test_private_document_buckets.sql (db-contracts).
BEGIN;
SET LOCAL statement_timeout = '30s';
-- Policy DDL locks storage.objects; do not queue behind uploads for long.
SET LOCAL lock_timeout = '2s';

DO $guard$
BEGIN
  IF (SELECT count(*) FROM storage.buckets WHERE id IN ('deal-documents', 'user-documents')) <> 2 THEN
    RAISE EXCEPTION 'expected buckets deal-documents and user-documents';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'storage.objects'::regclass
             AND p.polname NOT IN ('user_documents_owner_insert', 'user_documents_owner_or_admin_read', 'deal_documents_admin_read')
             AND (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''))
                 ~ '(deal-documents|user-documents)') THEN
    RAISE EXCEPTION 'another storage.objects policy names a document bucket; inspect before changing them';
  END IF;
END $guard$;

DROP POLICY IF EXISTS user_documents_owner_insert ON storage.objects;
CREATE POLICY user_documents_owner_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'user-documents' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS user_documents_owner_or_admin_read ON storage.objects;
CREATE POLICY user_documents_owner_or_admin_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'user-documents' AND (
    (storage.foldername(name))[1] = (SELECT auth.uid())::text
    OR EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = (SELECT auth.uid()) AND au.is_active)));

DROP POLICY IF EXISTS deal_documents_admin_read ON storage.objects;
CREATE POLICY deal_documents_admin_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'deal-documents'
         AND EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = (SELECT auth.uid()) AND au.is_active));

UPDATE storage.buckets SET public = false WHERE id IN ('deal-documents', 'user-documents') AND public;

DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id IN ('deal-documents', 'user-documents') AND public) THEN
    RAISE EXCEPTION 'a document bucket is still public';
  END IF;
  IF (SELECT count(*) FROM pg_policy WHERE polrelid = 'storage.objects'::regclass
      AND polname IN ('user_documents_owner_insert', 'user_documents_owner_or_admin_read', 'deal_documents_admin_read')) <> 3 THEN
    RAISE EXCEPTION 'document bucket policies did not land';
  END IF;
END $check$;

COMMIT;

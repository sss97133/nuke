-- storage.objects: close the policies that let anyone holding the public anon key list, upload, overwrite or
-- delete objects in two buckets.
--
-- Found 2026-10-14. Five policies for role public checked nothing but the bucket:
--   vehicle-images (a public bucket)        vehicle_images_read (SELECT), vehicle_images_upload (INSERT),
--                                           vehicle_images_update (UPDATE), vehicle_images_delete (DELETE).
--   dealerscan-documents (private, 32 objects, 2026-02-08 to 2026-02-15)
--                                           ds_storage_service_all (ALL), written for the service role
--                                           (20260208_f_dealerscan_schema.sql), which bypasses row security and
--                                           never needed it.
-- So a logged-out caller could list and download every dealer document, list vehicle-images (frames the vision
-- gate rejected as personal, receipts uploaded by ReceiptManager), and overwrite or delete any of its objects.
--
-- After:
--   vehicle-images     uploading needs a signed-in user; listing, overwriting and deleting belong to the object's
--                      owner (storage records owner and owner_id from the uploader's token). The bucket stays
--                      public, so public URLs still serve the bytes.
--   dealerscan-documents keeps its three per-user folder policies.
-- Edge functions use the service role (process-file-upload) and are unaffected. Web callers on main: uploads
-- without upsert (uploadManager, aiDataIngestion, ReceiptManager, EnhancedTimelineEventForm), getPublicUrl, and
-- duplicateDetectionService's remove, which now removes only the caller's own objects. The phone uploads to
-- vehicle-photos, not here.
--
-- Each policy is replaced only from its known open form; any other form stops the migration unchanged, and a
-- second run is a no-op. Policy DDL locks storage.objects, so the wait is capped at 2 s.
-- Contract: supabase/sql/test_storage_objects_close_open_policies.sql (CI job storage-policies-contract).
SET lock_timeout = '2s';
SET statement_timeout = '30s';

DO $close$
DECLARE
  open_bucket constant text := '(bucket_id=''vehicle-images''::text)';
  pol record;
  n_open int := 0;
  n_closed int := 0;
BEGIN
  PERFORM set_config('search_path', 'storage', true);
  -- vehicle-images: four policies, all open or all already closed.
  FOR pol IN
    SELECT p.polname, p.polroles, p.polcmd,
           regexp_replace(coalesce(pg_get_expr(p.polqual, p.polrelid), ''), '\s+', '', 'g') AS q,
           regexp_replace(coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''), '\s+', '', 'g') AS c
      FROM pg_policy p
     WHERE p.polrelid = 'storage.objects'::regclass
       AND p.polname IN ('vehicle_images_read', 'vehicle_images_upload', 'vehicle_images_update', 'vehicle_images_delete')
  LOOP
    IF pol.polroles = ARRAY[0::oid]
       AND ((pol.polname = 'vehicle_images_read'   AND pol.polcmd = 'r' AND pol.q = open_bucket AND pol.c = '')
         OR (pol.polname = 'vehicle_images_upload' AND pol.polcmd = 'a' AND pol.q = ''          AND pol.c = open_bucket)
         OR (pol.polname = 'vehicle_images_update' AND pol.polcmd = 'w' AND pol.q = open_bucket AND pol.c = open_bucket)
         OR (pol.polname = 'vehicle_images_delete' AND pol.polcmd = 'd' AND pol.q = open_bucket AND pol.c = '')) THEN
      n_open := n_open + 1;
    ELSIF pol.polroles = ARRAY['authenticated'::regrole::oid]
       AND (pol.polname = 'vehicle_images_upload' OR pol.q LIKE '%owner_id=%auth.uid()%') THEN
      n_closed := n_closed + 1;
    ELSE
      RAISE EXCEPTION 'storage.objects policy % has drifted (roles %, using %, check %); inspect before retry',
        pol.polname, pol.polroles, pol.q, pol.c;
    END IF;
  END LOOP;

  IF n_open = 4 THEN
    DROP POLICY vehicle_images_read ON storage.objects;
    DROP POLICY vehicle_images_upload ON storage.objects;
    DROP POLICY vehicle_images_update ON storage.objects;
    DROP POLICY vehicle_images_delete ON storage.objects;
    CREATE POLICY vehicle_images_read ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'vehicle-images'
             AND (owner_id = (SELECT auth.uid())::text OR owner = (SELECT auth.uid())));
    CREATE POLICY vehicle_images_upload ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'vehicle-images');
    CREATE POLICY vehicle_images_update ON storage.objects FOR UPDATE TO authenticated
      USING (bucket_id = 'vehicle-images'
             AND (owner_id = (SELECT auth.uid())::text OR owner = (SELECT auth.uid())))
      WITH CHECK (bucket_id = 'vehicle-images'
             AND (owner_id = (SELECT auth.uid())::text OR owner = (SELECT auth.uid())));
    CREATE POLICY vehicle_images_delete ON storage.objects FOR DELETE TO authenticated
      USING (bucket_id = 'vehicle-images'
             AND (owner_id = (SELECT auth.uid())::text OR owner = (SELECT auth.uid())));
  ELSIF n_closed = 4 THEN
    RAISE NOTICE 'vehicle-images policies already closed; nothing to do';
  ELSE
    RAISE EXCEPTION 'vehicle-images policies: % open and % closed of 4; inspect before retry', n_open, n_closed;
  END IF;

  -- dealerscan-documents: drop the open service policy, only from its known form.
  SELECT p.polroles, p.polcmd,
         regexp_replace(coalesce(pg_get_expr(p.polqual, p.polrelid), ''), '\s+', '', 'g') AS q,
         regexp_replace(coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''), '\s+', '', 'g') AS c
    INTO pol
    FROM pg_policy p
   WHERE p.polrelid = 'storage.objects'::regclass AND p.polname = 'ds_storage_service_all';
  IF FOUND THEN
    IF pol.polroles = ARRAY[0::oid] AND pol.polcmd = '*'
       AND pol.q = '(bucket_id=''dealerscan-documents''::text)' AND pol.c = '' THEN
      DROP POLICY ds_storage_service_all ON storage.objects;
    ELSE
      RAISE EXCEPTION 'storage.objects policy ds_storage_service_all has drifted (roles %, cmd %, using %, check %); inspect before retry',
        pol.polroles, pol.polcmd, pol.q, pol.c;
    END IF;
  END IF;

  -- Verify: no write or read policy on storage.objects is open to public without an identity check for these buckets.
  IF EXISTS (
    SELECT FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects' AND roles::text IN ('{public}', '{anon}')
       AND (coalesce(qual, '') || coalesce(with_check, '')) ~ '(vehicle-images|dealerscan-documents)'
       AND (coalesce(qual, '') || coalesce(with_check, '')) !~* '(auth\.uid|auth\.role|auth\.jwt)'
  ) THEN
    RAISE EXCEPTION 'an open storage policy remains on vehicle-images or dealerscan-documents';
  END IF;
END
$close$;

RESET statement_timeout;
RESET lock_timeout;

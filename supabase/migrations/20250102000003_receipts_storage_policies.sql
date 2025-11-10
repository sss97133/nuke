-- Storage policies for receipts bucket
-- These policies control who can upload, view, and delete files.
-- Supabase's pooler user is not the owner of storage.objects, so we guard every DDL.

DO $$
DECLARE
  obj_oid oid;
  owner_usesysid oid;
  is_owner BOOLEAN := FALSE;
BEGIN
  -- Resolve the storage.objects relation; bail if it does not exist.
  BEGIN
    SELECT 'storage.objects'::regclass INTO obj_oid;
  EXCEPTION WHEN undefined_table THEN
    RAISE NOTICE 'storage.objects not found; skipping receipts storage policy migration.';
    RETURN;
  END;

  SELECT usesysid INTO owner_usesysid FROM pg_user WHERE usename = current_user;
  SELECT relowner = owner_usesysid INTO is_owner FROM pg_class WHERE oid = obj_oid;

  IF NOT is_owner THEN
    RAISE NOTICE 'Skipping receipts storage policy migration because user % is not the owner of storage.objects.', current_user;
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY';

  EXECUTE 'DROP POLICY IF EXISTS "Anyone can view receipts" ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS "Authenticated users can upload receipts" ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS "Users can delete their own receipts" ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS "Users can update their own receipts" ON storage.objects';
  EXECUTE '' ||
    'DROP POLICY IF EXISTS "Allow anonymous test uploads" ON storage.objects';

  EXECUTE 'CREATE POLICY "Anyone can view receipts" ON storage.objects ' ||
          'FOR SELECT USING (bucket_id = ''receipts'')';

  EXECUTE 'CREATE POLICY "Authenticated users can upload receipts" ON storage.objects ' ||
          'FOR INSERT WITH CHECK (' ||
          'bucket_id = ''receipts'' ' ||
          'AND auth.role() = ''authenticated'' ' ||
          'AND (storage.foldername(name))[1] = auth.uid()::text' ||
          ')';

  EXECUTE 'CREATE POLICY "Users can delete their own receipts" ON storage.objects ' ||
          'FOR DELETE USING (' ||
          'bucket_id = ''receipts'' ' ||
          'AND auth.uid()::text = (storage.foldername(name))[1]' ||
          ')';

  EXECUTE 'CREATE POLICY "Users can update their own receipts" ON storage.objects ' ||
          'FOR UPDATE USING (' ||
          'bucket_id = ''receipts'' ' ||
          'AND auth.uid()::text = (storage.foldername(name))[1]' ||
          ')';

  EXECUTE 'CREATE POLICY "Allow anonymous test uploads" ON storage.objects ' ||
          'FOR INSERT WITH CHECK (' ||
          'bucket_id = ''receipts'' ' ||
          'AND (storage.foldername(name))[1] = ''test''' ||
          ')';

  EXECUTE 'GRANT ALL ON storage.objects TO authenticated';
  EXECUTE 'GRANT SELECT ON storage.objects TO anon';

  RAISE NOTICE 'Storage policies for receipts bucket have been configured.';
  RAISE NOTICE 'Authenticated users can now upload to their own folders.';
  RAISE NOTICE 'Public read access is enabled for all receipts.';
END $$;

-- LAUNCH GATE: storage RLS for the iOS capture app's upload path.
--
-- WHY: storage.objects had 24 policies and ZERO covering bucket
-- 'vehicle-photos' for user JWTs. The shipped iOS app (and the Mac relay)
-- uploads to vehicle-photos at users/<auth.uid()>/capture-relay/<filename>
-- (apps/nuke-capture-ios Config.swift), so every app upload died at the
-- storage step with an RLS denial. The app has NEVER landed a photo in prod.
--
-- SHAPE: owner-scoped INSERT only, matching the path convention. The client
-- uploads with upsert:false and tolerates "already exists" (SupabaseService
-- .uploadPhoto), so no UPDATE policy is needed. The bucket is public-read
-- (storage.buckets.public = true), so no SELECT policy is needed for
-- retrieval — getPublicURL serves the bytes.
--
-- Naming/style mirrors the existing per-bucket policies
-- ("ownership-documents: owner insert" etc.).

DROP POLICY IF EXISTS "vehicle-photos: owner insert" ON storage.objects;
CREATE POLICY "vehicle-photos: owner insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'vehicle-photos'
  AND (storage.foldername(name))[1] = 'users'
  AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
);

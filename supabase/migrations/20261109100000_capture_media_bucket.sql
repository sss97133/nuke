-- Private bucket and storage policies for vehicle-matched videos, screen recordings and screenshots.
--
-- STATUS: written, NOT applied. `supabase-deploy.yml` applies new migrations when a PR merges to main, so this
-- must not merge until the owner approves it. It creates one bucket and four storage policies. It changes no
-- table, no column and no existing policy or bucket, and writes no row.
--
-- Owner scope (2026-11-04): no bulk sync. The iOS app picks up a video, screen recording or screenshot only inside
-- an existing vehicle capture context (photo filed to a vehicle within 30 min / 150 m, or the 7-days-before to
-- 2-days-after acquisition window), or for a screenshot, when on-device text recognition finds a VIN or a
-- year + make. A match uploads a low-resolution PREVIEW first plus ONE vehicle_images row; the full file stays on the
-- phone until that row has a vehicle_id and user_confirmed_vehicle = true.
--
-- Why a new bucket (verified read-only 2026-11-04):
--   vehicle-images  public, 50 MB, allowed_mime_types = jpeg/jpg/png/gif/webp only: no video, no heic.
--   vehicle-photos  public, no size limit, no mime filter (where the photo sync writes).
--   Both are PUBLIC. A screen recording or screenshot of a private conversation must not sit in a public bucket,
--   and loosening allowed_mime_types on vehicle-images would let video into a public bucket that the web app
--   serves by URL. So: a separate PRIVATE bucket with its own mime list, size cap and policies.
--   (The alternative, not recommended: UPDATE storage.buckets SET allowed_mime_types = ... for vehicle-images.)
--
-- Why no new table: vehicle_images already has is_video, duration_seconds, video_codec, video_resolution and
-- mime_type, and table-wide planner statistics (pg_stats, 2026-11-04) show is_video false for 100% of rows and
-- video_codec / video_resolution / duration_seconds null for 100%; mime_type is null for 99.8% and holds only
-- image/* values. The app fills those columns. Rows have source 'capture_relay_ios_media' (not capture_relay_ios), so
-- the capture_upload_status and clip-carrier triggers and the photo pipeline (ai_processing_status = 'skipped')
-- do not run on them. See apps/nuke-capture-ios/docs/VIDEO_SYNC_PLAN.md for the reader risks of sharing the table.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- ─── Private bucket ──────────────────────────────────────────────────────────
-- file_size_limit is this bucket's; the project-wide Storage limit (Dashboard > Storage > Settings) also applies
-- and cannot be read from SQL.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('capture-media', 'capture-media', false, 524288000,
        ARRAY['video/mp4', 'video/quicktime', 'video/x-m4v',
              'image/jpeg', 'image/png', 'image/heic', 'image/heif'])
ON CONFLICT (id) DO NOTHING;

-- ─── Storage policies ────────────────────────────────────────────────────────
-- Object names: users/<uid>/previews/<asset_key>.<mp4|jpg>   and   users/<uid>/full/<vehicle_images.id>.<ext>

-- The owner reads their own objects (a private bucket is only reachable by signed URL or this policy).
DROP POLICY IF EXISTS "capture-media: owner read" ON storage.objects;
CREATE POLICY "capture-media: owner read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'capture-media'
         AND (storage.foldername(name))[1] = 'users'
         AND (storage.foldername(name))[2] = (SELECT auth.uid())::text);

-- Previews: only into the owner's own previews/ folder.
DROP POLICY IF EXISTS "capture-media: owner insert preview" ON storage.objects;
CREATE POLICY "capture-media: owner insert preview" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'capture-media'
              AND (storage.foldername(name))[1] = 'users'
              AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
              AND (storage.foldername(name))[3] = 'previews');

-- Full files: refused by storage itself unless the vehicle_images row named in the object name belongs to
-- the caller, was written by this feature, has a vehicle_id AND the owner's confirmation. A vehicle_id alone is
-- not enough: automatic attribution also sets it. The lookup is by primary key.
DROP POLICY IF EXISTS "capture-media: owner insert full after attribution" ON storage.objects;
CREATE POLICY "capture-media: owner insert full after attribution" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'capture-media'
    AND (storage.foldername(name))[1] = 'users'
    AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
    AND (storage.foldername(name))[3] = 'full'
    AND EXISTS (
      SELECT 1 FROM public.vehicle_images vi
       WHERE vi.id = (CASE
               WHEN split_part(storage.filename(name), '.', 1)
                    ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               THEN split_part(storage.filename(name), '.', 1)::uuid END)
         AND vi.user_id = (SELECT auth.uid())
         AND vi.source = 'capture_relay_ios_media'
         AND vi.vehicle_id IS NOT NULL
         AND vi.user_confirmed_vehicle IS TRUE
    )
  );

-- No UPDATE or DELETE policy on this bucket: an object, once written, is changed only by the service role.

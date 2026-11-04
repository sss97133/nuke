-- Private bucket and storage policies for vehicle videos attributed by their own content.
--
-- STATUS: written, NOT applied. `supabase-deploy.yml` applies new migrations when a PR merges to main, so this
-- must not merge until the owner approves it. It creates one bucket and two storage policies. It changes no
-- table, no column and no existing policy or bucket, and writes no row.
--
-- Owner rule (2026-11-04): NO confirm tap. A video is attributed to a vehicle only when its frames, read on the
-- phone by the same classifier, VIN/plate readers and filing gate as photos, clear the photo confidence threshold.
-- Time and GPS only narrow the candidate vehicles. Anything below the threshold stays on the phone and nothing
-- about it is sent. Once a clip is attributed, a low-resolution preview and the full file may upload.
--
-- How the order is enforced (the photo gate's server half, device_file_images, works on an existing
-- vehicle_images row, so the sequence is: metadata-only row -> device_file_images sets vehicle_id -> objects):
--   * the app inserts a row with no pixels, no object and no vehicle_id;
--   * device_file_images (method vin_ocr / serial_ocr, confidence >= 0.9) checks ownership, association of the
--     vehicle with the user, supersession and vision-gate state, writes the audit row and sets vehicle_id;
--   * THIS policy refuses a preview or a full object until that row has a vehicle_id. user_confirmed_vehicle is
--     not consulted: nothing waits for a person.
-- Both objects stay private: the bucket is private and only the owner can read their own folder.
--
-- Why a new bucket (verified read-only 2026-11-04):
--   vehicle-images  public, 50 MB, allowed_mime_types = jpeg/jpg/png/gif/webp only: no video.
--   vehicle-photos  public, no size limit, no mime filter (where the photo sync writes).
--   Both are PUBLIC. A clip must not sit in a public bucket, and loosening allowed_mime_types on vehicle-images
--   would let video into a public bucket that the web app serves by URL. So: a separate PRIVATE bucket with its
--   own mime list, size cap and policies.
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
-- Video only: screenshots and screen recordings never auto-attribute under the photo gate, so no image types.
-- file_size_limit is this bucket's; the project-wide Storage limit (Dashboard > Storage > Settings) also applies
-- and cannot be read from SQL.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('capture-media', 'capture-media', false, 524288000,
        ARRAY['video/mp4', 'video/quicktime', 'video/x-m4v'])
ON CONFLICT (id) DO NOTHING;

-- ─── Storage policies ────────────────────────────────────────────────────────
-- Object names (both keyed by the vehicle_images row id):
--   users/<uid>/previews/<vehicle_images.id>.mp4      users/<uid>/full/<vehicle_images.id>.<ext>

-- The owner reads their own objects (a private bucket is only reachable by signed URL or this policy).
DROP POLICY IF EXISTS "capture-media: owner read" ON storage.objects;
CREATE POLICY "capture-media: owner read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'capture-media'
         AND (storage.foldername(name))[1] = 'users'
         AND (storage.foldername(name))[2] = (SELECT auth.uid())::text);

-- Preview and full file: into the owner's own previews/ or full/ folder, and only when the vehicle_images row named
-- in the object name belongs to the caller, was written by this feature, and already has a vehicle_id (set by the
-- server's filing gate, device_file_images). Without that row state, storage itself refuses the object, so nothing
-- about an unattributed clip can land in the bucket. The lookup is by primary key.
DROP POLICY IF EXISTS "capture-media: owner insert after attribution" ON storage.objects;
CREATE POLICY "capture-media: owner insert after attribution" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'capture-media'
    AND (storage.foldername(name))[1] = 'users'
    AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
    AND (storage.foldername(name))[3] IN ('previews', 'full')
    AND EXISTS (
      SELECT 1 FROM public.vehicle_images vi
       WHERE vi.id = (CASE
               WHEN split_part(storage.filename(name), '.', 1)
                    ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               THEN split_part(storage.filename(name), '.', 1)::uuid END)
         AND vi.user_id = (SELECT auth.uid())
         AND vi.source = 'capture_relay_ios_media'
         AND vi.vehicle_id IS NOT NULL
    )
  );

-- No UPDATE or DELETE policy on this bucket: an object, once written, is changed only by the service role.

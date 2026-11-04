-- Capture video assets: videos and screen recordings that belong to a vehicle capture context.
-- Owner scope (2026-11-04): no bulk video sync. The phone previews a clip only when it falls inside an existing
-- vehicle capture context (a photo already filed to a vehicle within 30 minutes and 150 m, or a screen recording
-- inside a vehicle's acquisition window: 7 days before through 2 days after vehicles.purchase_date). Anything that
-- does not match stays on the phone. A matching clip uploads a low-resolution silent PREVIEW plus metadata first;
-- the full file stays on the phone until a vehicle is attributed (and, for a screen recording, the owner confirms).
--
-- STATUS: written, NOT applied. Needs the owner's approval before it runs against production.
-- Applying it creates one table, one PRIVATE storage bucket, storage policies and three functions. It writes no
-- existing row and changes no existing table, policy or bucket.
--
-- Why a new table and not columns on vehicle_images (recommendation, see apps/nuke-capture-ios/docs/VIDEO_SYNC_PLAN.md):
--   * vehicle_images already has is_video, duration_seconds, video_codec, video_resolution, mime_type and a
--     ingest_kind column, but 0 of the owner's 29,749 rows use them, and every reader of that table (gallery
--     eligibility, the vision gate, the INSERT trigger on ai_processing_status='pending', public SELECT policies)
--     assumes a still image with a public image_url. A video row there would meet all of them.
--   * a clip has a two-step life (preview, then full file after attribution) that a still never has.
--   * the table is private by RLS: owner-only, no public policy. vehicle_images's public policy is what a screen
--     recording must never meet.
--   When a clip is attributed and the full file landed, promoting it into vehicle_images (is_video = true,
--   source 'capture_relay_ios_video') is a separate, reviewed change.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- ─── Private bucket ──────────────────────────────────────────────────────────
-- vehicle-photos is PUBLIC; a video must never go there. file_size_limit here is the bucket's; the project-wide
-- storage limit (Dashboard > Storage > Settings) also applies and is not readable from SQL.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('capture-video', 'capture-video', false, 524288000,
        ARRAY['video/mp4', 'video/quicktime', 'video/x-m4v'])
ON CONFLICT (id) DO NOTHING;

-- ─── Table ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.capture_video_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  -- sha256(user_id|PhotoKit localIdentifier): the id the server sees; the PhotoKit id never leaves the phone.
  asset_key text NOT NULL CHECK (asset_key ~ '^[0-9a-f]{64}$'),
  kind text NOT NULL CHECK (kind IN ('camera_video', 'screen_recording')),
  taken_at timestamptz NOT NULL,
  duration_seconds numeric NOT NULL CHECK (duration_seconds > 0 AND duration_seconds <= 600),
  latitude numeric(10, 8),
  longitude numeric(11, 8),
  device_model text,
  device_os text,
  width integer,
  height integer,
  preview_path text NOT NULL,
  preview_size_bytes bigint,
  -- how the phone matched the clip, and to what: the exact rule and its numbers, for audit
  match_rule text NOT NULL CHECK (match_rule IN ('filed_photo_time_place_v1', 'acquisition_window_v1')),
  match_basis jsonb NOT NULL DEFAULT '{}'::jsonb,
  suggested_vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  -- set only by capture_video_attribute(); null until the owner (or a reviewed server step) attributes the clip
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  state text NOT NULL DEFAULT 'preview_uploaded'
    CHECK (state IN ('preview_uploaded', 'attributed', 'full_uploaded', 'rejected')),
  -- a screen recording's full file needs this, set only by capture_video_confirm_full()
  owner_confirmed_full boolean NOT NULL DEFAULT false,
  full_path text,
  -- a clip is private by construction: there is no public path from this table
  privacy text NOT NULL DEFAULT 'private' CHECK (privacy = 'private'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, asset_key),
  CHECK (kind = 'camera_video' OR (latitude IS NULL AND longitude IS NULL))  -- a screen recording carries no GPS
);

CREATE INDEX IF NOT EXISTS capture_video_assets_user_state_idx ON public.capture_video_assets (user_id, state);
CREATE INDEX IF NOT EXISTS capture_video_assets_vehicle_idx ON public.capture_video_assets (vehicle_id) WHERE vehicle_id IS NOT NULL;

COMMENT ON TABLE public.capture_video_assets IS
  'Videos and screen recordings picked up by the iOS app only inside an existing vehicle capture context. Private; owner-only. The preview lands first; the full file waits for attribution (and owner confirmation for a screen recording).';
COMMENT ON COLUMN public.capture_video_assets.suggested_vehicle_id IS 'The phone''s match. A suggestion, never an attribution.';
COMMENT ON COLUMN public.capture_video_assets.vehicle_id IS 'Set only by capture_video_attribute(). Null = not attributed; the full file stays on the phone.';

ALTER TABLE public.capture_video_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS capture_video_assets_owner_select ON public.capture_video_assets;
CREATE POLICY capture_video_assets_owner_select ON public.capture_video_assets
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

-- A client may insert only a fresh preview row for itself: not attributed, no full file, not confirmed.
DROP POLICY IF EXISTS capture_video_assets_owner_insert ON public.capture_video_assets;
CREATE POLICY capture_video_assets_owner_insert ON public.capture_video_assets
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND state = 'preview_uploaded'
    AND vehicle_id IS NULL
    AND full_path IS NULL
    AND owner_confirmed_full = false
    AND preview_path LIKE 'users/' || (SELECT auth.uid())::text || '/previews/%'
  );
-- No UPDATE or DELETE policy: every later change goes through the functions below.

REVOKE ALL ON public.capture_video_assets FROM anon, public;
GRANT SELECT, INSERT ON public.capture_video_assets TO authenticated;

-- ─── State changes (SECURITY DEFINER, owner-checked) ─────────────────────────

-- The owner attributes a clip to one of their own vehicles. Required before any full file may upload.
CREATE OR REPLACE FUNCTION public.capture_video_attribute(p_id uuid, p_vehicle_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '28000'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = p_vehicle_id AND v.owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'vehicle is not yours' USING ERRCODE = '42501';
  END IF;
  UPDATE public.capture_video_assets
     SET vehicle_id = p_vehicle_id, state = 'attributed', updated_at = now()
   WHERE id = p_id AND user_id = auth.uid() AND state = 'preview_uploaded';
  IF NOT FOUND THEN RAISE EXCEPTION 'clip not found or already attributed' USING ERRCODE = 'P0002'; END IF;
END $$;

-- The owner confirms that a screen recording's full file may leave the phone. Camera video does not need this.
CREATE OR REPLACE FUNCTION public.capture_video_confirm_full(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '28000'; END IF;
  UPDATE public.capture_video_assets
     SET owner_confirmed_full = true, updated_at = now()
   WHERE id = p_id AND user_id = auth.uid() AND state = 'attributed';
  IF NOT FOUND THEN RAISE EXCEPTION 'clip is not attributed' USING ERRCODE = 'P0002'; END IF;
END $$;

-- The phone reports that the full file landed. Refused unless the clip is attributed and, for a screen
-- recording, confirmed; the path must be this user's full/ path for this clip.
CREATE OR REPLACE FUNCTION public.capture_video_mark_full_uploaded(p_id uuid, p_path text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.capture_video_assets;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '28000'; END IF;
  SELECT * INTO r FROM public.capture_video_assets WHERE id = p_id AND user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'clip not found' USING ERRCODE = 'P0002'; END IF;
  IF r.state <> 'attributed' OR (r.kind = 'screen_recording' AND NOT r.owner_confirmed_full) THEN
    RAISE EXCEPTION 'full file not allowed for this clip' USING ERRCODE = '42501';
  END IF;
  IF p_path NOT LIKE 'users/' || auth.uid()::text || '/full/' || r.asset_key || '.%' THEN
    RAISE EXCEPTION 'unexpected path' USING ERRCODE = '22023';
  END IF;
  UPDATE public.capture_video_assets
     SET full_path = p_path, state = 'full_uploaded', updated_at = now()
   WHERE id = p_id;
END $$;

REVOKE ALL ON FUNCTION public.capture_video_attribute(uuid, uuid) FROM anon, public;
REVOKE ALL ON FUNCTION public.capture_video_confirm_full(uuid) FROM anon, public;
REVOKE ALL ON FUNCTION public.capture_video_mark_full_uploaded(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.capture_video_attribute(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.capture_video_confirm_full(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.capture_video_mark_full_uploaded(uuid, text) TO authenticated;

-- ─── Storage policies on the private bucket ──────────────────────────────────
-- Owner reads their own objects (a private bucket is never served publicly).
DROP POLICY IF EXISTS "capture-video: owner read" ON storage.objects;
CREATE POLICY "capture-video: owner read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'capture-video' AND (storage.foldername(name))[1] = 'users'
         AND (storage.foldername(name))[2] = (SELECT auth.uid())::text);

-- Previews: the owner's own previews/ folder.
DROP POLICY IF EXISTS "capture-video: owner insert preview" ON storage.objects;
CREATE POLICY "capture-video: owner insert preview" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'capture-video' AND (storage.foldername(name))[1] = 'users'
              AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
              AND (storage.foldername(name))[3] = 'previews');

-- Full files: refused by storage itself unless the clip is attributed and, for a screen recording, confirmed.
-- The object name is users/<uid>/full/<asset_key>.<ext>.
DROP POLICY IF EXISTS "capture-video: owner insert full after attribution" ON storage.objects;
CREATE POLICY "capture-video: owner insert full after attribution" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'capture-video' AND (storage.foldername(name))[1] = 'users'
    AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
    AND (storage.foldername(name))[3] = 'full'
    AND EXISTS (
      SELECT 1 FROM public.capture_video_assets a
       WHERE a.user_id = (SELECT auth.uid())
         AND a.asset_key = split_part(storage.filename(name), '.', 1)
         AND a.state = 'attributed'
         AND a.vehicle_id IS NOT NULL
         AND (a.kind = 'camera_video' OR a.owner_confirmed_full)
    )
  );

-- Private photos stop loading from their public link: the file moves into a private bucket and owners read it signed.
--
-- WHY (2026-11-09, measured): set_image_sensitivity (20260928213000) hides a row from every app reader (anon REST reads
-- 0 of the 448 rows made private on 2026-11-09: titles, bills of sale, DMV forms, a driver licence, a shipping label
-- with a home address), but the file stays in a public bucket (vehicle-photos, vehicle-images, ...), so anyone holding a
-- saved direct URL still downloads it. Storage serves a public bucket without checking row security.
--
-- This migration (the file move itself runs in the edge function move-private-photo-objects; nothing moves here):
--   1. bucket vehicle-photos-private, public = false.
--   2. private_photo_objects: one row per stored file of a private photo (image_url, thumbnail/medium/large, every
--      variants URL that points at a public photo bucket): source bucket/key, private key (= '<bucket>/<key>' so the way
--      back is in the key), status pending -> moved -> restore_pending -> restored, or skipped_shared / failed.
--      Service role only.
--   3. plan_private_photo_moves(limit, run): queues the files of sensitive photos; a file another NON-sensitive photo row
--      also points at is skipped_shared (moving it would break a public photo), for a person to look at. A moved file
--      whose photo is no longer sensitive goes to restore_pending, so un-hiding a photo brings its link back.
--   4. Owners keep seeing their own private photos through signed URLs: a storage.objects SELECT policy on the private
--      bucket lets the photo's uploader or the vehicle's owner (owner_id / uploaded_by / active owner or co_owner
--      permission) read and sign a moved file; private_photo_signing_keys(image_id) returns the keys to sign for them.
--      anon gets nothing.
--
-- ORDER OF OPERATIONS (do not skip): readers that show a private photo to its owner (web PhotoViewer / gallery, iOS
-- library) must sign keys from private_photo_signing_keys before the mover runs live, or the owner's own view of a
-- moved photo breaks too. The mover defaults to dry_run.
-- Contract: supabase/sql/test_private_photo_objects.sql (dm_refinement_* database).
-- Reversal: set status = 'restore_pending' on every moved row and run the mover (files go back to their public bucket
-- and key); then drop the policy, functions, table and bucket.

SET statement_timeout = '60s';
SET lock_timeout = '5s';

INSERT INTO storage.buckets (id, name, public)
VALUES ('vehicle-photos-private', 'vehicle-photos-private', false)
ON CONFLICT (id) DO UPDATE SET public = false;

CREATE TABLE IF NOT EXISTS public.private_photo_objects (
  id bigserial PRIMARY KEY,
  image_id uuid NOT NULL REFERENCES public.vehicle_images (id) ON DELETE CASCADE,
  source_bucket text NOT NULL,
  source_key text NOT NULL,
  private_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'moved', 'restore_pending', 'restored', 'skipped_shared', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  error text,
  public_url_status integer,
  run text,
  planned_at timestamptz NOT NULL DEFAULT now(),
  moved_at timestamptz,
  restored_at timestamptz,
  UNIQUE (source_bucket, source_key)
);
CREATE INDEX IF NOT EXISTS private_photo_objects_image_idx ON public.private_photo_objects (image_id);
CREATE INDEX IF NOT EXISTS private_photo_objects_private_key_idx ON public.private_photo_objects (private_key) WHERE status = 'moved';
CREATE INDEX IF NOT EXISTS private_photo_objects_status_idx ON public.private_photo_objects (status) WHERE status IN ('pending', 'restore_pending');
ALTER TABLE public.private_photo_objects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.private_photo_objects FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.private_photo_objects TO service_role;
GRANT USAGE ON SEQUENCE public.private_photo_objects_id_seq TO service_role;

-- The public photo buckets a private photo's file can sit in.
CREATE OR REPLACE FUNCTION public.private_photo_source_buckets() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['vehicle-photos', 'vehicle-images', 'vehicle-uploads', 'vehicles', 'vehicle-data']::text[]
$$;

-- Every stored file a photo row points at, as (bucket, key), from its public storage URLs.
CREATE OR REPLACE FUNCTION public.photo_public_objects(p_image_id uuid)
RETURNS TABLE (bucket text, key text) LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp' AS $$
  WITH urls AS (
    SELECT u FROM vehicle_images vi,
      LATERAL unnest(ARRAY[vi.image_url, vi.thumbnail_url, vi.medium_url, vi.large_url]
                     || COALESCE((SELECT array_agg(value) FROM jsonb_each_text(
                          CASE WHEN jsonb_typeof(vi.variants) = 'object' THEN vi.variants ELSE '{}'::jsonb END)), '{}')) u
     WHERE vi.id = p_image_id AND u IS NOT NULL
  ), parsed AS (
    SELECT regexp_match(u, '/storage/v1/object/public/([^/?#]+)/([^?#]+)') m FROM urls
  )
  SELECT DISTINCT m[1], m[2] FROM parsed
   WHERE m IS NOT NULL AND m[1] = ANY (public.private_photo_source_buckets())
$$;
REVOKE EXECUTE ON FUNCTION public.photo_public_objects(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.photo_public_objects(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.plan_private_photo_moves(p_limit integer DEFAULT 500, p_run text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_queued int := 0; v_shared int := 0; v_restore int := 0; v_requeued int := 0;
  r record; o record; v_url text; v_shared_hit boolean;
BEGIN
  -- Sensitive photos with a public file not yet queued.
  FOR r IN
    SELECT vi.id FROM vehicle_images vi
     WHERE vi.is_sensitive IS TRUE
       AND EXISTS (SELECT 1 FROM public.photo_public_objects(vi.id) po
                    WHERE NOT EXISTS (SELECT 1 FROM private_photo_objects x WHERE x.source_bucket = po.bucket AND x.source_key = po.key))
     ORDER BY vi.redacted_at DESC NULLS LAST, vi.id
     LIMIT GREATEST(p_limit, 0)
  LOOP
    FOR o IN SELECT * FROM public.photo_public_objects(r.id) LOOP
      CONTINUE WHEN EXISTS (SELECT 1 FROM private_photo_objects x WHERE x.source_bucket = o.bucket AND x.source_key = o.key);
      v_url := '%/storage/v1/object/public/' || o.bucket || '/' || o.key;
      SELECT EXISTS (
        SELECT 1 FROM vehicle_images s
         WHERE s.id <> r.id AND s.is_sensitive IS NOT TRUE
           AND (s.image_url LIKE v_url OR s.thumbnail_url LIKE v_url OR s.medium_url LIKE v_url OR s.large_url LIKE v_url
                OR s.storage_path = o.key)
      ) INTO v_shared_hit;
      INSERT INTO private_photo_objects (image_id, source_bucket, source_key, private_key, status, run, error)
      VALUES (r.id, o.bucket, o.key, o.bucket || '/' || o.key,
              CASE WHEN v_shared_hit THEN 'skipped_shared' ELSE 'pending' END, p_run,
              CASE WHEN v_shared_hit THEN 'a non-sensitive photo row points at the same file' END)
      ON CONFLICT (source_bucket, source_key) DO NOTHING;
      IF v_shared_hit THEN v_shared := v_shared + 1; ELSE v_queued := v_queued + 1; END IF;
    END LOOP;
  END LOOP;

  -- Un-hidden photos: moved files go back.
  UPDATE private_photo_objects x SET status = 'restore_pending', run = COALESCE(p_run, x.run)
    FROM vehicle_images vi
   WHERE vi.id = x.image_id AND x.status = 'moved' AND vi.is_sensitive IS NOT TRUE;
  GET DIAGNOSTICS v_restore = ROW_COUNT;

  -- Re-hidden photos: restored files go private again.
  UPDATE private_photo_objects x SET status = 'pending', run = COALESCE(p_run, x.run)
    FROM vehicle_images vi
   WHERE vi.id = x.image_id AND x.status = 'restored' AND vi.is_sensitive IS TRUE;
  GET DIAGNOSTICS v_requeued = ROW_COUNT;

  RETURN jsonb_build_object('queued', v_queued, 'skipped_shared', v_shared, 'restore_pending', v_restore, 'requeued', v_requeued, 'run', p_run);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.plan_private_photo_moves(integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plan_private_photo_moves(integer, text) TO service_role;

-- May this signed-in user read this private photo? Its uploader, or the vehicle's owner.
CREATE OR REPLACE FUNCTION public.can_read_private_photo(p_image_id uuid, p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  SELECT p_user IS NOT NULL AND EXISTS (
    SELECT 1 FROM vehicle_images vi
      LEFT JOIN vehicles v ON v.id = vi.vehicle_id
     WHERE vi.id = p_image_id
       AND (vi.user_id = p_user OR v.owner_id = p_user OR v.uploaded_by = p_user
            OR EXISTS (SELECT 1 FROM vehicle_user_permissions p WHERE p.vehicle_id = vi.vehicle_id AND p.user_id = p_user
                       AND p.is_active AND p.role IN ('owner', 'co_owner'))))
$$;
REVOKE EXECUTE ON FUNCTION public.can_read_private_photo(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_private_photo(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.private_photo_object_readable(p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  SELECT EXISTS (SELECT 1 FROM private_photo_objects o
                  WHERE o.private_key = p_name AND o.status = 'moved'
                    AND public.can_read_private_photo(o.image_id, auth.uid()))
$$;
REVOKE EXECUTE ON FUNCTION public.private_photo_object_readable(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.private_photo_object_readable(text) TO authenticated, service_role;

-- The keys an owner signs (supabase.storage.from('vehicle-photos-private').createSignedUrl(key, ttl)).
CREATE OR REPLACE FUNCTION public.private_photo_signing_keys(p_image_id uuid)
RETURNS TABLE (source_url_kind text, private_key text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  SELECT CASE WHEN vi.image_url LIKE '%/' || o.source_bucket || '/' || o.source_key THEN 'image_url' ELSE 'variant' END, o.private_key
    FROM private_photo_objects o JOIN vehicle_images vi ON vi.id = o.image_id
   WHERE o.image_id = p_image_id AND o.status = 'moved'
     AND (auth.role() = 'service_role' OR public.can_read_private_photo(p_image_id, auth.uid()))
$$;
REVOKE EXECUTE ON FUNCTION public.private_photo_signing_keys(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.private_photo_signing_keys(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS vehicle_photos_private_owner_read ON storage.objects;
CREATE POLICY vehicle_photos_private_owner_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'vehicle-photos-private' AND public.private_photo_object_readable(name));

DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'vehicle-photos-private' AND public) THEN
    RAISE EXCEPTION 'vehicle-photos-private is public';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'storage.objects'::regclass
              AND p.polname <> 'vehicle_photos_private_owner_read'
              AND (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) ~ 'vehicle-photos-private') THEN
    RAISE EXCEPTION 'another storage.objects policy names vehicle-photos-private';
  END IF;
END $check$;
